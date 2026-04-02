"""SQLite-backed PRD-01 auth service for FastAPI endpoints."""

from __future__ import annotations

import hmac
import re
import secrets
from datetime import datetime
from typing import Final

from app.core.logging import get_logger
from app.features.auth.contracts import (
    ForgotPasswordRequest,
    OtpPurpose,
    OtpSendRequest,
    OtpSendResponse,
    OtpVerifyRequest,
    OtpVerifyResponse,
    ResetPasswordRequest,
    RevocationResponse,
    RoleCode,
)

from .models import AuthError, OtpDeliveryRecord

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ROLE_CODES: Final[set[RoleCode]] = {"creator", "reviewer", "admin"}
ROLE_PERMISSION_MAP: Final[dict[RoleCode, tuple[str, ...]]] = {
    "creator": ("submission:create", "submission:read:own"),
    "reviewer": ("submission:read:all", "submission:review", "audit:read"),
    "admin": ("*",),
}
logger = get_logger(__name__)


class AuthOtpMixin:
    """Extracted mixin for AuthService."""

    def send_otp(self, payload: OtpSendRequest) -> OtpSendResponse:
        logger.info(
            "Sending OTP challenge.",
            extra={"target": payload.target, "purpose": payload.purpose.value},
        )
        normalized_target = self._normalize_email(payload.target)
        now = self._now()
        challenge_id = self._random_id("otp")
        otp_code = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = now + self.otp_ttl

        with self._connection:
            self._assert_otp_send_allowed(normalized_target, payload.purpose, now)
            self._connection.execute(
                """
                INSERT INTO auth_otp_challenges (
                    challenge_id,
                    target,
                    purpose,
                    otp_hash,
                    attempts,
                    expires_at,
                    verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    challenge_id,
                    normalized_target,
                    payload.purpose.value,
                    self._hash_value(otp_code),
                    0,
                    expires_at.isoformat(),
                    None,
                ),
            )

        self._otp_deliveries.append(
            OtpDeliveryRecord(
                challenge_id=challenge_id,
                target=normalized_target,
                purpose=payload.purpose,
                otp_code=otp_code,
                expires_at=expires_at,
            )
        )
        self._dispatch_otp_email(
            target=normalized_target,
            purpose=payload.purpose,
            otp_code=otp_code,
            expires_at=expires_at,
        )

        return OtpSendResponse(
            challenge_id=challenge_id,
            expires_at=expires_at,
            cooldown_seconds=int(self.otp_cooldown.total_seconds()),
        )

    def _dispatch_otp_email(
        self,
        *,
        target: str,
        purpose: OtpPurpose,
        otp_code: str,
        expires_at: datetime,
    ) -> None:
        email_adapter = getattr(self, "_email_adapter", None)
        if email_adapter is None:
            return

        purpose_label_map = {
            OtpPurpose.REGISTER: "registration verification",
            OtpPurpose.FORGOT_PASSWORD: "password reset",
        }
        purpose_label = purpose_label_map.get(purpose, purpose.value)
        subject = f"FileEaters OTP for {purpose_label}"
        html_body = (
            f"<p>Your one-time password is <strong>{otp_code}</strong>.</p>"
            f"<p>This code is for {purpose_label} and expires at <strong>{expires_at.isoformat()}</strong>.</p>"
            "<p>If you did not request this, you can ignore this email.</p>"
        )
        try:
            delivered = bool(email_adapter.send_email(to_email=target, subject=subject, html_body=html_body))
            if delivered:
                logger.info("OTP email delivered.", extra={"target": target, "purpose": purpose.value})
            else:
                logger.warning("OTP email delivery reported failure.", extra={"target": target, "purpose": purpose.value})
        except Exception as error:
            logger.exception(
                "OTP email delivery raised an unexpected error.",
                extra={"target": target, "purpose": purpose.value, "error_message": str(error)},
            )

    def verify_otp(self, payload: OtpVerifyRequest) -> OtpVerifyResponse:
        logger.info(
            "Verifying OTP challenge.",
            extra={"challenge_id": payload.challenge_id, "purpose": payload.purpose.value},
        )
        now = self._now()
        with self._connection:
            challenge_row = self._connection.execute(
                """
                SELECT challenge_id, target, purpose, otp_hash, attempts, expires_at, verified_at
                FROM auth_otp_challenges
                WHERE challenge_id = ?
                """,
                (payload.challenge_id,),
            ).fetchone()
            if challenge_row is None or challenge_row["purpose"] != payload.purpose.value:
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP challenge is invalid")

            verified_at = self._parse_nullable_iso(challenge_row["verified_at"])
            expires_at = self._parse_iso(challenge_row["expires_at"])
            attempts = int(challenge_row["attempts"])

            if verified_at is not None:
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP challenge already verified")
            if expires_at <= now:
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP challenge has expired")
            if attempts >= self.otp_max_attempts:
                raise AuthError("AUTH_RATE_LIMITED", 429, "OTP attempt limit reached")

            if not hmac.compare_digest(
                challenge_row["otp_hash"], self._hash_value(payload.otp_code)
            ):
                attempts += 1
                self._connection.execute(
                    "UPDATE auth_otp_challenges SET attempts = ? WHERE challenge_id = ?",
                    (attempts, payload.challenge_id),
                )
                if attempts >= self.otp_max_attempts:
                    raise AuthError("AUTH_RATE_LIMITED", 429, "OTP attempt limit reached")
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP code is invalid")

            self._connection.execute(
                "UPDATE auth_otp_challenges SET verified_at = ? WHERE challenge_id = ?",
                (now.isoformat(), payload.challenge_id),
            )

            verification_token = self._random_token(32)
            token_expires_at = now + self.otp_verification_ttl
            self._connection.execute(
                """
                INSERT INTO auth_verification_tokens (
                    token_hash,
                    target,
                    purpose,
                    expires_at,
                    used_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    self._hash_value(verification_token),
                    challenge_row["target"],
                    payload.purpose.value,
                    token_expires_at.isoformat(),
                    None,
                ),
            )

        return OtpVerifyResponse(
            otp_verification_token=verification_token,
            expires_at=token_expires_at,
        )

    def forgot_password(self, payload: ForgotPasswordRequest) -> OtpSendResponse:
        logger.info("Forgot password request.", extra={"email": payload.email})
        normalized_email = self._normalize_email(payload.email)
        user = self._user_by_email(normalized_email)
        if user is None:
            return OtpSendResponse(challenge_id=None, expires_at=None, cooldown_seconds=0)

        return self.send_otp(
            OtpSendRequest(
                target=user.email,
                purpose=OtpPurpose.FORGOT_PASSWORD,
            )
        )

    def reset_password(self, payload: ResetPasswordRequest) -> RevocationResponse:
        logger.info("Reset password request.", extra={"email": payload.email})
        normalized_email = self._normalize_email(payload.email)
        user = self._user_by_email(normalized_email)
        if user is None:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Invalid credentials")

        self._consume_verification_token(
            otp_verification_token=payload.otp_verification_token,
            target=normalized_email,
            purpose=OtpPurpose.FORGOT_PASSWORD,
        )

        now = self._now()
        with self._connection:
            self._connection.execute(
                """
                UPDATE auth_users
                SET password_hash = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (
                    self._create_password_hash(payload.new_password),
                    now.isoformat(),
                    user.user_id,
                ),
            )
            revoked_count = self._revoke_all_user_sessions(user.user_id, "password_reset", now)

        return RevocationResponse(revoked_session_count=revoked_count)

    def debug_peek_latest_otp_code(self, target: str, purpose: OtpPurpose) -> str:
        normalized_target = self._normalize_email(target)
        for delivery in reversed(self._otp_deliveries):
            if delivery.target == normalized_target and delivery.purpose == purpose:
                return delivery.otp_code
        raise AssertionError("OTP code not found for target/purpose")

    def _assert_otp_send_allowed(self, target: str, purpose: OtpPurpose, now: datetime) -> None:
        key = f"{purpose.value}:{target}"
        throttle = self._connection.execute(
            """
            SELECT throttle_key, window_started_at, send_count, last_sent_at
            FROM auth_otp_throttles
            WHERE throttle_key = ?
            """,
            (key,),
        ).fetchone()

        if throttle is None:
            self._connection.execute(
                """
                INSERT INTO auth_otp_throttles (
                    throttle_key,
                    window_started_at,
                    send_count,
                    last_sent_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (key, now.isoformat(), 1, now.isoformat()),
            )
            return

        window_started_at = self._parse_iso(throttle["window_started_at"])
        send_count = int(throttle["send_count"])
        last_sent_at = self._parse_nullable_iso(throttle["last_sent_at"])

        if now - window_started_at >= self.otp_window:
            window_started_at = now
            send_count = 0
            last_sent_at = None

        if last_sent_at and now - last_sent_at < self.otp_cooldown:
            raise AuthError("AUTH_RATE_LIMITED", 429, "OTP send is cooling down")

        if send_count >= self.otp_max_per_window:
            raise AuthError("AUTH_RATE_LIMITED", 429, "OTP send rate limit reached")

        self._connection.execute(
            """
            UPDATE auth_otp_throttles
            SET window_started_at = ?, send_count = ?, last_sent_at = ?
            WHERE throttle_key = ?
            """,
            (window_started_at.isoformat(), send_count + 1, now.isoformat(), key),
        )

    def _consume_verification_token(
        self,
        otp_verification_token: str,
        target: str,
        purpose: OtpPurpose,
    ) -> None:
        token_hash = self._hash_value(otp_verification_token)
        now = self._now()

        with self._connection:
            token = self._connection.execute(
                """
                SELECT token_hash, target, purpose, expires_at, used_at
                FROM auth_verification_tokens
                WHERE token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
            if token is None:
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP verification token is invalid")

            used_at = self._parse_nullable_iso(token["used_at"])
            if used_at is not None:
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP verification token already used")

            if token["target"] != target or token["purpose"] != purpose.value:
                raise AuthError(
                    "AUTH_UNAUTHORIZED",
                    401,
                    "OTP verification token does not match request",
                )

            if self._parse_iso(token["expires_at"]) <= now:
                raise AuthError("AUTH_UNAUTHORIZED", 401, "OTP verification token has expired")

            self._connection.execute(
                "UPDATE auth_verification_tokens SET used_at = ? WHERE token_hash = ?",
                (now.isoformat(), token_hash),
            )
