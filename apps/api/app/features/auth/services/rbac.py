"""SQLite-backed PRD-01 auth service for FastAPI endpoints."""

from __future__ import annotations

import re
from typing import Final

from app.core.logging import get_logger
from app.features.auth.contracts import (
    MeResponse,
    RoleCode,
    UserResponse,
)

from .models import AuthError, UserRecord

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ROLE_CODES: Final[set[RoleCode]] = {"creator", "reviewer", "admin"}
ROLE_PERMISSION_MAP: Final[dict[RoleCode, tuple[str, ...]]] = {
    "creator": ("submission:create", "submission:read:own"),
    "reviewer": ("submission:read:all", "submission:review", "audit:read"),
    "admin": ("*",),
}
logger = get_logger(__name__)


class AuthRbacMixin:
    """Extracted mixin for AuthService."""

    def me(self, access_token: str, require_any_role: list[RoleCode] | None = None) -> MeResponse:
        logger.info("Resolving current user profile.")
        claims = self._verify_access_token(access_token)
        user = self._user_by_id(str(claims["sub"]))
        if user is None:
            raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token user unavailable")

        if require_any_role:
            requested_roles = self._normalize_roles(require_any_role)
            if not any(role in user.roles for role in requested_roles):
                raise AuthError("AUTH_FORBIDDEN", 403, "Role check failed")

        return MeResponse(user=self._build_user_response(user))

    def _build_permissions(self, roles: list[RoleCode]) -> list[str]:
        permission_set: set[str] = set()
        for role in roles:
            permission_set.update(ROLE_PERMISSION_MAP.get(role, ()))
        return sorted(permission_set)

    def _build_user_response(self, user: UserRecord) -> UserResponse:
        return UserResponse(
            id=user.user_id,
            email=user.email,
            roles=user.roles,
            permissions=self._build_permissions(user.roles),
            status=user.status,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    def _normalize_roles(self, roles: list[str]) -> list[RoleCode]:
        normalized_roles: list[RoleCode] = []
        for role in roles:
            lowered = role.strip().lower()
            if lowered not in ROLE_CODES:
                raise AuthError("VALIDATION_ERROR", 400, f"Unsupported role: {role}")
            if lowered not in normalized_roles:
                normalized_roles.append(lowered)

        if not normalized_roles:
            raise AuthError("VALIDATION_ERROR", 400, "At least one role is required")

        return normalized_roles
