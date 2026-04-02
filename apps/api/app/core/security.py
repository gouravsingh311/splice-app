"""Shared security dependencies for privileged API routes."""

from __future__ import annotations

from dataclasses import dataclass
from os import environ

from fastapi import Header, Request

from app.core.errors import DomainError
from app.features.auth.service import AuthError

_INTERNAL_TOKEN_ENV = "SPLICE_INTERNAL_API_TOKEN"
_ALLOWED_ACTOR_ROLES = {"creator", "reviewer", "admin", "system"}


@dataclass(frozen=True, slots=True)
class ActorContext:
    actor_id: str
    actor_role: str
    auth_source: str


def _resolve_actor_role_from_user(roles: list[str]) -> str:
    normalized_roles = {str(role).strip().lower() for role in roles if str(role).strip()}
    if "admin" in normalized_roles:
        return "admin"
    if "reviewer" in normalized_roles:
        return "reviewer"
    if "creator" in normalized_roles:
        return "creator"
    raise DomainError(
        code="AUTH_FORBIDDEN",
        message="Authenticated user does not have a supported actor role.",
        status_code=403,
        details={"roles": sorted(normalized_roles)},
    )


def _normalize_role(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in _ALLOWED_ACTOR_ROLES:
        raise DomainError(
            code="AUTH_FORBIDDEN",
            message="Actor role is not permitted for this operation.",
            status_code=403,
            details={"actor_role": value},
        )
    return normalized


def get_actor_context(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_actor_id: str | None = Header(default=None, alias="X-Actor-Id"),
    x_actor_role: str | None = Header(default=None, alias="X-Actor-Role"),
) -> ActorContext:
    raw_scope_headers = {
        key.decode("latin1").lower(): value.decode("latin1")
        for key, value in request.scope.get("headers", [])
    }
    header_actor_id = (
        raw_scope_headers.get("x-actor-id")
        or request.headers.get("x-actor-id")
        or x_actor_id
        or ""
    ).strip()
    header_actor_role = (
        raw_scope_headers.get("x-actor-role")
        or request.headers.get("x-actor-role")
        or x_actor_role
        or ""
    ).strip()
    auth_header = (
        raw_scope_headers.get("authorization")
        or request.headers.get("authorization")
        or authorization
        or ""
    ).strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if not token:
            raise DomainError(
                code="AUTH_UNAUTHORIZED",
                message="Bearer token is required.",
                status_code=401,
            )
        try:
            me_response = request.app.state.auth_service.me(access_token=token)
        except AuthError as exc:
            raise DomainError(
                code=exc.code,
                message=exc.message,
                status_code=exc.status,
            ) from exc

        actor_role = _resolve_actor_role_from_user(me_response.user.roles)
        return ActorContext(
            actor_id=me_response.user.id,
            actor_role=actor_role,
            auth_source="bearer",
        )

    if header_actor_id and header_actor_role:
        return ActorContext(
            actor_id=header_actor_id,
            actor_role=_normalize_role(header_actor_role),
            auth_source="forwarded",
        )

    raise DomainError(
        code="AUTH_UNAUTHORIZED",
        message="Authenticated actor context is required.",
        status_code=401,
    )


def require_internal_access(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    expected = environ.get(_INTERNAL_TOKEN_ENV, "").strip()
    if not expected:
        raise DomainError(
            code="INTERNAL_ERROR",
            message="Internal API token is not configured.",
            status_code=500,
            details={"env": _INTERNAL_TOKEN_ENV},
        )
    provided = str(x_internal_token or "").strip()
    if not provided or provided != expected:
        raise DomainError(
            code="AUTH_FORBIDDEN",
            message="Internal endpoint requires trusted service credentials.",
            status_code=403,
            details={"auth_scope": "internal"},
        )


def assert_actor_payload_matches_context(
    *,
    actor_id: str | None,
    actor_role: str | None,
    actor_context: ActorContext,
) -> None:
    normalized_payload_role = str(actor_role or "").strip().lower()
    if actor_id and str(actor_id).strip() != actor_context.actor_id:
        raise DomainError(
            code="AUTH_FORBIDDEN",
            message="Actor identity mismatch between payload and authenticated context.",
            status_code=403,
            details={
                "payload_actor_id": actor_id,
                "context_actor_id": actor_context.actor_id,
            },
        )
    if normalized_payload_role and normalized_payload_role != actor_context.actor_role:
        raise DomainError(
            code="AUTH_FORBIDDEN",
            message="Actor role mismatch between payload and authenticated context.",
            status_code=403,
            details={
                "payload_actor_role": actor_role,
                "context_actor_role": actor_context.actor_role,
            },
        )
