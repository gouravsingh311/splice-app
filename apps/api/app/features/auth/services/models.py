"""SQLite-backed PRD-01 auth service for FastAPI endpoints."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from app.core.logging import get_logger
from app.features.auth.contracts import (
    OtpPurpose,
    RoleCode,
)

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ROLE_CODES: Final[set[RoleCode]] = {"creator", "reviewer", "admin"}
ROLE_PERMISSION_MAP: Final[dict[RoleCode, tuple[str, ...]]] = {
    "creator": ("submission:create", "submission:read:own"),
    "reviewer": ("submission:read:all", "submission:review", "audit:read"),
    "admin": ("*",),
}
logger = get_logger(__name__)


class AuthError(Exception):
    """Structured auth error mapped to HTTP responses."""

    def __init__(self, code: str, status: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


@dataclass
class SigningKey:
    kid: str
    secret: str
    active: bool = True


@dataclass
class UserRecord:
    user_id: str
    email: str
    password_hash: str
    roles: list[RoleCode]
    status: str
    created_at: datetime
    updated_at: datetime


@dataclass
class SessionRecord:
    session_id: str
    user_id: str
    family_id: str
    refresh_token_hash: str
    created_at: datetime
    expires_at: datetime
    device_id: str | None = None
    revoked_at: datetime | None = None
    revoke_reason: str | None = None
    replaced_by_hash: str | None = None


@dataclass
class OtpDeliveryRecord:
    challenge_id: str
    target: str
    purpose: OtpPurpose
    otp_code: str
    expires_at: datetime


