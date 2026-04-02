"""SQLite-backed PRD-01 auth service for FastAPI endpoints."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import sqlite3
from datetime import UTC, datetime
from typing import Final

from app.core.logging import get_logger
from app.features.auth.contracts import (
    RoleCode,
)

from .models import AuthError, SigningKey, UserRecord

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ROLE_CODES: Final[set[RoleCode]] = {"creator", "reviewer", "admin"}
ROLE_PERMISSION_MAP: Final[dict[RoleCode, tuple[str, ...]]] = {
    "creator": ("submission:create", "submission:read:own"),
    "reviewer": ("submission:read:all", "submission:review", "audit:read"),
    "admin": ("*",),
}
logger = get_logger(__name__)


class AuthBaseMixin:
    """Extracted mixin for AuthService."""

    def _now(self) -> datetime:
        now = self._now_provider()
        if now.tzinfo is None:
            return now.replace(tzinfo=UTC)
        return now.astimezone(UTC)

    def _normalize_email(self, email: str) -> str:
        normalized = email.strip().lower()
        if not EMAIL_PATTERN.match(normalized):
            raise AuthError("VALIDATION_ERROR", 400, "Email must be valid")
        return normalized

    def _hash_value(self, value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _random_id(self, prefix: str) -> str:
        return f"{prefix}_{secrets.token_hex(10)}"

    def _random_token(self, size: int) -> str:
        return secrets.token_urlsafe(size)

    def _user_from_row(self, row: sqlite3.Row) -> UserRecord:
        role_rows = self._connection.execute(
            "SELECT role FROM auth_user_roles WHERE user_id = ? ORDER BY role ASC",
            (row["user_id"],),
        ).fetchall()
        roles = [role_row["role"] for role_row in role_rows if role_row["role"] in ROLE_CODES]

        return UserRecord(
            user_id=row["user_id"],
            email=row["email"],
            password_hash=row["password_hash"],
            roles=roles,
            status=row["status"],
            created_at=self._parse_iso(row["created_at"]),
            updated_at=self._parse_iso(row["updated_at"]),
        )

    def _parse_iso(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    def _parse_nullable_iso(self, value: str | None) -> datetime | None:
        if value is None:
            return None
        return self._parse_iso(value)

    def _active_signing_key(self) -> SigningKey:
        for key in self._key_ring:
            if key.active:
                return key
        return self._key_ring[0]

    def _base64url_json(self, data: dict[str, object]) -> str:
        raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("utf-8")

    def _decode_base64url_json(self, token: str) -> dict[str, object]:
        padding = "=" * (-len(token) % 4)
        decoded = base64.urlsafe_b64decode((token + padding).encode("utf-8"))
        payload = json.loads(decoded.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Decoded payload must be an object")
        return payload

    def _user_by_email(self, email: str) -> UserRecord | None:
        row = self._connection.execute(
            """
            SELECT user_id, email, password_hash, status, created_at, updated_at
            FROM auth_users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()
        return self._user_from_row(row) if row is not None else None

    def _user_by_id(self, user_id: str) -> UserRecord | None:
        row = self._connection.execute(
            """
            SELECT user_id, email, password_hash, status, created_at, updated_at
            FROM auth_users
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
        return self._user_from_row(row) if row is not None else None

    def _require_user_by_id(self, user_id: str) -> UserRecord:
        user = self._user_by_id(user_id)
        if user is None:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token user unavailable")
        return user
