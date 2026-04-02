"""SQLite-backed PRD-01 auth service for FastAPI endpoints."""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Final, Protocol

from app.core.db.session import get_connection, init_db
from app.core.logging import get_logger
from app.features.auth.contracts import (
    RoleCode,
)

from .base import AuthBaseMixin
from .models import OtpDeliveryRecord, SigningKey
from .otp import AuthOtpMixin
from .rbac import AuthRbacMixin
from .session import AuthSessionMixin

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ROLE_CODES: Final[set[RoleCode]] = {"creator", "reviewer", "admin"}
ROLE_PERMISSION_MAP: Final[dict[RoleCode, tuple[str, ...]]] = {
    "creator": ("submission:create", "submission:read:own"),
    "reviewer": ("submission:read:all", "submission:review", "audit:read"),
    "admin": ("*",),
}
logger = get_logger(__name__)


class AuthOtpEmailAdapter(Protocol):
    def send_email(self, to_email: str, subject: str, html_body: str) -> bool: ...


class AuthService(AuthOtpMixin, AuthRbacMixin, AuthSessionMixin, AuthBaseMixin):
    access_token_ttl_seconds: Final[int] = 15 * 60
    refresh_token_ttl: Final[timedelta] = timedelta(days=30)
    otp_ttl: Final[timedelta] = timedelta(minutes=10)
    otp_verification_ttl: Final[timedelta] = timedelta(minutes=15)
    otp_cooldown: Final[timedelta] = timedelta(seconds=45)
    otp_window: Final[timedelta] = timedelta(minutes=15)
    otp_max_per_window: Final[int] = 3
    otp_max_attempts: Final[int] = 5
    login_max_failures: Final[int] = 5
    login_lockout: Final[timedelta] = timedelta(minutes=15)

    def __init__(
        self,
        now_provider: Callable[[], datetime] | None = None,
        key_ring: list[SigningKey] | None = None,
        connection: sqlite3.Connection | None = None,
        email_adapter: AuthOtpEmailAdapter | None = None,
    ) -> None:
        self._now_provider = now_provider or (lambda: datetime.now(UTC))

        resolved_key_ring = key_ring or []
        if not resolved_key_ring:
            msg = "At least one signing key is required"
            raise ValueError(msg)

        self._key_ring = resolved_key_ring
        if connection is None:
            init_db()
            connection = get_connection()
        self._connection = connection
        self._otp_deliveries: list[OtpDeliveryRecord] = []
        self._email_adapter = email_adapter

    def seed_default_users(
        self,
        users: list[tuple[str, str, list[RoleCode]]],
    ) -> list[str]:
        created: list[str] = []
        now = self._now()
        with self._connection:
            for email, password, roles in users:
                normalized_email = self._normalize_email(email)
                user_row = self._connection.execute(
                    "SELECT user_id FROM auth_users WHERE email = ?",
                    (normalized_email,),
                ).fetchone()
                if user_row is None:
                    user_id = self._random_id("user")
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
                            self._create_password_hash(password),
                            "active",
                            now.isoformat(),
                            now.isoformat(),
                        ),
                    )
                    self._connection.executemany(
                        "INSERT INTO auth_user_roles (user_id, role) VALUES (?, ?)",
                        [(user_id, role) for role in self._normalize_roles(roles)],
                    )
                    created.append(normalized_email)
                else:
                    user_id = user_row["user_id"]
                    existing_roles = {
                        row["role"]
                        for row in self._connection.execute(
                            "SELECT role FROM auth_user_roles WHERE user_id = ?",
                            (user_id,),
                        ).fetchall()
                    }
                    desired_roles = set(self._normalize_roles(roles))
                    missing_roles = desired_roles - existing_roles
                    if missing_roles:
                        self._connection.executemany(
                            "INSERT INTO auth_user_roles (user_id, role) VALUES (?, ?)",
                            [(user_id, role) for role in missing_roles],
                        )
        if created:
            logger.info(
                "Seeded default auth users.",
                extra={"created_count": len(created), "emails": created},
            )
        return created
