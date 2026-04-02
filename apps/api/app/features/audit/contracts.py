"""Pydantic contracts for PRD-11 audit endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

AUDIT_SCHEMA_VERSION = 1


class AuditAction(StrEnum):
    admin_config_published = "admin.config.published"
    admin_config_rolled_back = "admin.config.rolled_back"
    admin_integration_credentials_rotated = "admin.integration.credentials.rotated"
    admin_job_replayed = "admin.job.replayed"
    auth_login_failed = "auth.login.failed"
    auth_login_succeeded = "auth.login.succeeded"
    auth_otp_sent = "auth.otp.sent"
    desktop_ipc_allowed = "desktop.ipc.allowed.v1"
    desktop_ipc_denied = "desktop.ipc.denied.v1"
    integration_event_outcome = "integration.event.outcome"
    notification_dispatch_outcome = "notification.dispatch.outcome"
    submission_approved_scheduling = "submission.approved.scheduling.v1"
    submission_release_triggered = "submission.release.triggered"
    submission_schedule_overridden = "submission.schedule.overridden"
    submission_schedule_resolved = "submission.schedule.resolved"
    submission_reopen_locked = "submission.reopen.locked"
    submission_reopen_requested = "submission.reopen.requested"
    submission_review_access_denied = "submission.review.access.denied"
    submission_transition_changed = "submission.transition.changed"
    system_audit_initialized = "system.audit.service.initialized"


class AuditEntityType(StrEnum):
    desktop = "desktop"
    integration = "integration"
    notification = "notification"
    session = "session"
    submission = "submission"
    system = "system"
    user = "user"


class AuditExportFormat(StrEnum):
    csv = "csv"
    json = "json"


class AuditExportSignatureAlgorithm(StrEnum):
    sha256 = "sha256"


class AuditAppendRequest(BaseModel):
    schema_version: int = Field(default=AUDIT_SCHEMA_VERSION)
    actor_id: str | None = Field(default=None, max_length=256)
    action: AuditAction
    entity_type: AuditEntityType
    entity_id: str = Field(min_length=1, max_length=256)
    before_json: dict[str, Any] | None = None
    after_json: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    occurred_at: datetime | None = None
    request_id: str | None = Field(default=None, max_length=256)
    idempotency_key: str | None = Field(default=None, max_length=256)

    model_config = ConfigDict(extra="forbid")

    @field_validator("schema_version")
    @classmethod
    def validate_schema_version(cls, value: int) -> int:
        if value != AUDIT_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {AUDIT_SCHEMA_VERSION}")
        return value

    @field_validator("actor_id", "entity_id", "request_id", "idempotency_key")
    @classmethod
    def strip_string_fields(cls, value: str | None) -> str | None:
        if value is None:
            return value

        stripped = value.strip()
        if not stripped:
            raise ValueError("field cannot be empty")
        return stripped

    @field_validator("occurred_at")
    @classmethod
    def normalize_occurred_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None

        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)

        return value.astimezone(UTC)


class AuditEvent(BaseModel):
    id: UUID
    schema_version: int
    actor_id: str | None
    action: AuditAction
    entity_type: AuditEntityType
    entity_id: str
    before_json: dict[str, Any] | None
    after_json: dict[str, Any] | None
    metadata: dict[str, Any] | None
    occurred_at: datetime | None
    request_id: str | None
    idempotency_key: str | None
    created_at: datetime
    prev_hash: str | None
    event_hash: str

    model_config = ConfigDict(extra="forbid")


class AuditListResponse(BaseModel):
    events: list[AuditEvent]
    total: int
    limit: int
    offset: int

    model_config = ConfigDict(extra="forbid")


class AuditExportResponse(BaseModel):
    format: AuditExportFormat
    mime_type: str
    file_name: str
    exported_at: datetime
    signed_at: datetime
    signature_algorithm: AuditExportSignatureAlgorithm = Field(
        default=AuditExportSignatureAlgorithm.sha256
    )
    signature: str = Field(min_length=64, max_length=64)
    total: int
    content: str

    model_config = ConfigDict(extra="forbid")

    @field_validator("signed_at")
    @classmethod
    def normalize_signed_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class AuditResponseEnvelope(BaseModel):
    schema_version: int = Field(default=AUDIT_SCHEMA_VERSION)
    resource: str = Field(min_length=1, max_length=128)
    generated_at: datetime

    model_config = ConfigDict(extra="forbid")

    @field_validator("schema_version")
    @classmethod
    def validate_envelope_schema_version(cls, value: int) -> int:
        if value != AUDIT_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {AUDIT_SCHEMA_VERSION}")
        return value

    @field_validator("generated_at")
    @classmethod
    def normalize_generated_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class AuditEventEnvelopeResponse(AuditEvent):
    envelope: AuditResponseEnvelope

    model_config = ConfigDict(extra="forbid")


class AuditListEnvelopeResponse(AuditListResponse):
    envelope: AuditResponseEnvelope

    model_config = ConfigDict(extra="forbid")


class AuditExportEnvelopeResponse(AuditExportResponse):
    envelope: AuditResponseEnvelope

    model_config = ConfigDict(extra="forbid")
