"""SQLite-backed PRD-01 auth service for FastAPI endpoints."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta
from typing import Final

from app.core.logging import get_logger
from app.features.auth.contracts import (
    LoginRequest,
    OtpPurpose,
    RefreshRequest,
    RegisterRequest,
    RevocationResponse,
    RoleCode,
    TokenBundleResponse,
)

from .models import AuthError, SessionRecord, UserRecord

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ROLE_CODES: Final[set[RoleCode]] = {"creator", "reviewer", "admin"}
ROLE_PERMISSION_MAP: Final[dict[RoleCode, tuple[str, ...]]] = {
    "creator": ("submission:create", "submission:read:own"),
    "reviewer": ("submission:read:all", "submission:review", "audit:read"),
    "admin": ("*",),
}
logger = get_logger(__name__)


class AuthSessionMixin:
    """Extracted mixin for AuthService."""

    def register(self, payload: RegisterRequest) -> TokenBundleResponse:
        logger.info("Registering user.", extra={"email": payload.email})
        normalized_email = self._normalize_email(payload.email)
        existing_user = self._connection.execute(
            "SELECT 1 FROM auth_users WHERE email = ?",
            (normalized_email,),
        ).fetchone()
        if existing_user is not None:
            raise AuthError("VALIDATION_ERROR", 409, "User already exists")

        self._consume_verification_token(
            otp_verification_token=payload.otp_verification_token,
            target=normalized_email,
            purpose=OtpPurpose.REGISTER,
        )

        requested_roles = payload.roles or ["creator"]
        roles = self._normalize_roles(requested_roles)

        now = self._now()
        user_id = self._random_id("user")
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO auth_users (
                    user_id,
                    email,
                    password_hash,
                    status,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    normalized_email,
                    self._create_password_hash(payload.password),
                    "active",
                    now.isoformat(),
                    now.isoformat(),
                ),
            )
            self._connection.executemany(
                "INSERT INTO auth_user_roles (user_id, role) VALUES (?, ?)",
                [(user_id, role) for role in roles],
            )

        user = self._require_user_by_id(user_id)
        return self._create_session_bundle(user, device_id=payload.device_id)

    def login(self, payload: LoginRequest) -> TokenBundleResponse:
        logger.info("Login request in auth service.", extra={"email": payload.email})
        normalized_email = self._normalize_email(payload.email)
        self._assert_not_locked(normalized_email)

        user = self._user_by_email(normalized_email)
        if user is None or not self._verify_password_hash(payload.password, user.password_hash):
            self._record_login_failure(normalized_email)
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Invalid credentials")

        with self._connection:
            self._connection.execute(
                "DELETE FROM auth_login_failures WHERE email = ?",
                (normalized_email,),
            )

        return self._create_session_bundle(user, device_id=payload.device_id)

    def refresh(self, payload: RefreshRequest) -> TokenBundleResponse:
        logger.info("Refreshing auth session token.")
        refresh_hash = self._hash_value(payload.refresh_token)
        now = self._now()
        session = self._session_by_refresh_hash(refresh_hash)
        if session is None:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Refresh token is invalid")

        if session.revoked_at is not None:
            if session.replaced_by_hash:
                self._revoke_family(session.family_id, "refresh_token_reuse", now)
                self._connection.commit()
                raise AuthError("AUTH_TOKEN_REUSE", 401, "Refresh token reuse detected")
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Refresh token is revoked")

        if session.expires_at <= now:
            self._connection.execute(
                """
                UPDATE auth_sessions
                SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
                WHERE refresh_token_hash = ?
                """,
                (now.isoformat(), "refresh_expired", refresh_hash),
            )
            self._connection.commit()
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Refresh token has expired")

        if payload.device_id and session.device_id and payload.device_id != session.device_id:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Refresh token device mismatch")

        user = self._require_user_by_id(session.user_id)
        rotated_bundle = self._create_session_bundle(
            user,
            device_id=session.device_id or payload.device_id,
            family_id=session.family_id,
        )
        self._connection.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?, revoke_reason = ?, replaced_by_hash = ?
            WHERE refresh_token_hash = ?
            """,
            (
                now.isoformat(),
                "refresh_rotated",
                self._hash_value(rotated_bundle.refresh_token),
                refresh_hash,
            ),
        )
        self._connection.commit()
        return rotated_bundle

    def logout(self, refresh_token: str) -> RevocationResponse:
        logger.info("Logging out session.")
        refresh_hash = self._hash_value(refresh_token)
        now = self._now()
        with self._connection:
            session = self._session_by_refresh_hash(refresh_hash)
            if session is None:
                return RevocationResponse(revoked_session_count=0)

            revoked = self._revoke_session_by_hash(refresh_hash, "logout", now)
        return RevocationResponse(revoked_session_count=revoked)

    def logout_all(self, access_token: str) -> RevocationResponse:
        logger.info("Logging out all user sessions.")
        claims = self._verify_access_token(access_token)
        now = self._now()
        with self._connection:
            revoked_count = self._revoke_all_user_sessions(str(claims["sub"]), "logout_all", now)
        return RevocationResponse(revoked_session_count=revoked_count)

    def _create_password_hash(self, password: str) -> str:
        if len(password) < 12:
            raise AuthError("VALIDATION_ERROR", 400, "Password must be at least 12 characters")

        salt = secrets.token_hex(16)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt.encode("utf-8"),
            n=2**14,
            r=8,
            p=1,
            dklen=64,
        ).hex()
        return f"scrypt${salt}${digest}"

    def _verify_password_hash(self, password: str, password_hash: str) -> bool:
        if not password_hash.startswith("scrypt$"):
            return False

        parts = password_hash.split("$")
        if len(parts) != 3:
            return False

        _, salt, expected_digest = parts
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt.encode("utf-8"),
            n=2**14,
            r=8,
            p=1,
            dklen=64,
        ).hex()

        return hmac.compare_digest(digest, expected_digest)

    def _issue_access_token(self, user: UserRecord) -> tuple[str, datetime]:
        now = self._now()
        expires_at = now + timedelta(seconds=self.access_token_ttl_seconds)
        key = self._active_signing_key()

        header = {"alg": "HS256", "typ": "JWT", "kid": key.kid}
        payload = {
            "jti": self._random_id("jti"),
            "sub": user.user_id,
            "email": user.email,
            "roles": user.roles,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
        }

        header_token = self._base64url_json(header)
        payload_token = self._base64url_json(payload)
        message = f"{header_token}.{payload_token}".encode()
        signature = hmac.new(key.secret.encode("utf-8"), message, hashlib.sha256).digest()
        signature_token = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("utf-8")

        return f"{header_token}.{payload_token}.{signature_token}", expires_at

    def _verify_access_token(self, access_token: str) -> dict[str, object]:
        parts = access_token.split(".")
        if len(parts) != 3:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token is malformed")

        header_token, payload_token, signature_token = parts

        try:
            header = self._decode_base64url_json(header_token)
            payload = self._decode_base64url_json(payload_token)
        except (ValueError, json.JSONDecodeError):
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token is malformed") from None

        header_kid = str(header.get("kid", "")).strip()
        candidate_keys = [key for key in self._key_ring if not header_kid or key.kid == header_kid]
        message = f"{header_token}.{payload_token}".encode()

        signature_valid = False
        for key in candidate_keys:
            expected_signature = hmac.new(
                key.secret.encode("utf-8"),
                message,
                hashlib.sha256,
            ).digest()
            expected_token = (
                base64.urlsafe_b64encode(expected_signature).rstrip(b"=").decode("utf-8")
            )
            if hmac.compare_digest(expected_token, signature_token):
                signature_valid = True
                break

        if not signature_valid:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token signature is invalid")

        exp = payload.get("exp")
        sub = payload.get("sub")
        roles = payload.get("roles")

        if not isinstance(exp, int) or exp <= int(self._now().timestamp()):
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token is expired")

        if not isinstance(sub, str) or not isinstance(roles, list):
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token payload is invalid")

        return payload

    def _record_login_failure(self, email: str) -> None:
        now = self._now()
        row = self._connection.execute(
            "SELECT failed_count, locked_until FROM auth_login_failures WHERE email = ?",
            (email,),
        ).fetchone()

        failed_count = int(row["failed_count"]) if row is not None else 0
        failed_count += 1

        if failed_count >= self.login_max_failures:
            self._connection.execute(
                """
                INSERT INTO auth_login_failures (email, failed_count, locked_until)
                VALUES (?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                  failed_count = excluded.failed_count,
                  locked_until = excluded.locked_until
                """,
                (email, 0, (now + self.login_lockout).isoformat()),
            )
            self._connection.commit()
            raise AuthError("AUTH_LOCKED", 423, "Account temporarily locked")

        self._connection.execute(
            """
            INSERT INTO auth_login_failures (email, failed_count, locked_until)
            VALUES (?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              failed_count = excluded.failed_count,
              locked_until = excluded.locked_until
            """,
            (email, failed_count, None),
        )
        self._connection.commit()

    def _assert_not_locked(self, email: str) -> None:
        now = self._now()
        with self._connection:
            row = self._connection.execute(
                "SELECT failed_count, locked_until FROM auth_login_failures WHERE email = ?",
                (email,),
            ).fetchone()
            if row is None:
                return

            locked_until = self._parse_nullable_iso(row["locked_until"])
            if locked_until is None:
                return

            if locked_until > now:
                raise AuthError("AUTH_LOCKED", 423, "Account temporarily locked")

            self._connection.execute(
                (
                    "UPDATE auth_login_failures "
                    "SET failed_count = 0, locked_until = NULL WHERE email = ?"
                ),
                (email,),
            )

    def _create_session_bundle(
        self,
        user: UserRecord,
        device_id: str | None,
        family_id: str | None = None,
    ) -> TokenBundleResponse:
        now = self._now()
        refresh_token = self._random_token(48)
        refresh_hash = self._hash_value(refresh_token)

        session = SessionRecord(
            session_id=self._random_id("session"),
            user_id=user.user_id,
            family_id=family_id or self._random_id("family"),
            refresh_token_hash=refresh_hash,
            created_at=now,
            expires_at=now + self.refresh_token_ttl,
            device_id=device_id,
        )

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO auth_sessions (
                    refresh_token_hash,
                    session_id,
                    user_id,
                    family_id,
                    created_at,
                    expires_at,
                    device_id,
                    revoked_at,
                    revoke_reason,
                    replaced_by_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.refresh_token_hash,
                    session.session_id,
                    session.user_id,
                    session.family_id,
                    session.created_at.isoformat(),
                    session.expires_at.isoformat(),
                    session.device_id,
                    None,
                    None,
                    None,
                ),
            )

        access_token, access_token_expires_at = self._issue_access_token(user)

        return TokenBundleResponse(
            access_token=access_token,
            access_token_expires_at=access_token_expires_at,
            refresh_token=refresh_token,
            refresh_token_expires_at=session.expires_at,
            user=self._build_user_response(user),
        )

    def _revoke_session_by_hash(self, refresh_token_hash: str, reason: str, now: datetime) -> int:
        return self._connection.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?, revoke_reason = ?
            WHERE refresh_token_hash = ? AND revoked_at IS NULL
            """,
            (now.isoformat(), reason, refresh_token_hash),
        ).rowcount

    def _revoke_family(self, family_id: str, reason: str, now: datetime) -> int:
        return self._connection.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?, revoke_reason = ?
            WHERE family_id = ? AND revoked_at IS NULL
            """,
            (now.isoformat(), reason, family_id),
        ).rowcount

    def _revoke_all_user_sessions(self, user_id: str, reason: str, now: datetime) -> int:
        return self._connection.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?, revoke_reason = ?
            WHERE user_id = ? AND revoked_at IS NULL
            """,
            (now.isoformat(), reason, user_id),
        ).rowcount

    def _session_by_refresh_hash(self, refresh_hash: str) -> SessionRecord | None:
        row = self._connection.execute(
            """
            SELECT
              session_id,
              user_id,
              family_id,
              refresh_token_hash,
              created_at,
              expires_at,
              device_id,
              revoked_at,
              revoke_reason,
              replaced_by_hash
            FROM auth_sessions
            WHERE refresh_token_hash = ?
            """,
            (refresh_hash,),
        ).fetchone()
        if row is None:
            return None

        return SessionRecord(
            session_id=row["session_id"],
            user_id=row["user_id"],
            family_id=row["family_id"],
            refresh_token_hash=row["refresh_token_hash"],
            created_at=self._parse_iso(row["created_at"]),
            expires_at=self._parse_iso(row["expires_at"]),
            device_id=row["device_id"],
            revoked_at=self._parse_nullable_iso(row["revoked_at"]),
            revoke_reason=row["revoke_reason"],
            replaced_by_hash=row["replaced_by_hash"],
        )
