"""FastAPI router for PRD-11 audit endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.core.errors import DomainError
from app.core.logging import get_logger

from .contracts import (
    AuditAppendRequest,
    AuditEntityType,
    AuditEventEnvelopeResponse,
    AuditExportEnvelopeResponse,
    AuditExportFormat,
    AuditListEnvelopeResponse,
    AuditResponseEnvelope,
)
from .service import AuditEventNotFoundError, AuditEventStore

logger = get_logger(__name__)


def _to_utc_or_none(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)

    return value.astimezone(UTC)


def get_audit_service(request: Request) -> AuditEventStore:
    audit_service = getattr(request.app.state, "audit_service", None)
    if audit_service is None:
        raise RuntimeError("Audit service is not configured on app.state")
    return audit_service


router = APIRouter(tags=["audit"])


def _build_envelope(*, resource: str, generated_at: datetime) -> AuditResponseEnvelope:
    return AuditResponseEnvelope(resource=resource, generated_at=generated_at)


@router.post("/internal/audit/append", response_model=AuditEventEnvelopeResponse)
def append_audit_event(
    payload: AuditAppendRequest,
    audit_service: AuditEventStore = Depends(get_audit_service),
) -> AuditEventEnvelopeResponse:
    logger.info(
        "Appending audit event.",
        extra={
            "action": payload.action.value,
            "entity_type": payload.entity_type.value,
            "entity_id": payload.entity_id,
        },
    )
    event = audit_service.append_event(payload)
    return AuditEventEnvelopeResponse(
        **event.model_dump(mode="python"),
        envelope=_build_envelope(resource="audit.event.v1", generated_at=event.created_at),
    )


@router.get("/audit/events", response_model=AuditListEnvelopeResponse)
def list_audit_events(
    actor_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    entity_type: AuditEntityType | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    from_timestamp: datetime | None = Query(default=None, alias="from"),
    to_timestamp: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    audit_service: AuditEventStore = Depends(get_audit_service),
) -> AuditListEnvelopeResponse:
    logger.info(
        "Listing audit events.",
        extra={
            "actor_id": actor_id,
            "action": action,
            "entity_type": entity_type.value if entity_type else None,
        },
    )
    normalized_from = _to_utc_or_none(from_timestamp)
    normalized_to = _to_utc_or_none(to_timestamp)

    if normalized_from and normalized_to and normalized_from > normalized_to:
        raise DomainError(
            code="AUDIT_INVALID_TIME_WINDOW",
            message="`from` must be less than or equal to `to`.",
            status_code=422,
            details={
                "from": normalized_from.isoformat(),
                "to": normalized_to.isoformat(),
            },
        )

    listed = audit_service.list_events(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        from_timestamp=normalized_from,
        to_timestamp=normalized_to,
        limit=limit,
        offset=offset,
    )
    generated_at = (
        listed.events[-1].created_at if listed.events else datetime(1970, 1, 1, tzinfo=UTC)
    )
    return AuditListEnvelopeResponse(
        **listed.model_dump(mode="python"),
        envelope=_build_envelope(resource="audit.events.list.v1", generated_at=generated_at),
    )


@router.get("/audit/events/{event_id}", response_model=AuditEventEnvelopeResponse)
def get_audit_event(
    event_id: UUID,
    audit_service: AuditEventStore = Depends(get_audit_service),
) -> AuditEventEnvelopeResponse:
    logger.info("Fetching audit event.", extra={"event_id": str(event_id)})
    try:
        event = audit_service.get_event(event_id)
        return AuditEventEnvelopeResponse(
            **event.model_dump(mode="python"),
            envelope=_build_envelope(resource="audit.event.v1", generated_at=event.created_at),
        )
    except AuditEventNotFoundError as exc:
        raise DomainError(
            code="AUDIT_EVENT_NOT_FOUND",
            message="Audit event does not exist.",
            status_code=404,
            details={"event_id": str(event_id)},
        ) from exc


@router.get("/audit/export", response_model=AuditExportEnvelopeResponse)
def export_audit_events(
    format: AuditExportFormat = Query(default=AuditExportFormat.json),
    include_hash_chain: bool = Query(default=True),
    actor_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    entity_type: AuditEntityType | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    from_timestamp: datetime | None = Query(default=None, alias="from"),
    to_timestamp: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=5000, ge=1, le=5000),
    audit_service: AuditEventStore = Depends(get_audit_service),
) -> AuditExportEnvelopeResponse:
    logger.info(
        "Exporting audit events.",
        extra={"format": format.value, "include_hash_chain": include_hash_chain},
    )
    normalized_from = _to_utc_or_none(from_timestamp)
    normalized_to = _to_utc_or_none(to_timestamp)

    if normalized_from and normalized_to and normalized_from > normalized_to:
        raise DomainError(
            code="AUDIT_INVALID_TIME_WINDOW",
            message="`from` must be less than or equal to `to`.",
            status_code=422,
            details={
                "from": normalized_from.isoformat(),
                "to": normalized_to.isoformat(),
            },
        )

    exported = audit_service.export_events(
        export_format=format,
        include_hash_chain=include_hash_chain,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        from_timestamp=normalized_from,
        to_timestamp=normalized_to,
        limit=limit,
    )
    return AuditExportEnvelopeResponse(
        **exported.model_dump(mode="python"),
        envelope=_build_envelope(
            resource="audit.events.export.v1",
            generated_at=exported.exported_at,
        ),
    )
