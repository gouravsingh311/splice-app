"""Contract models for PRD-13/17/15 jobs, scheduling, and observability."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.features.submissions.contracts import ActorRole, SchedulingTriggerEvent, SubmissionSnapshot


class JobsSchedulingErrorCode(StrEnum):
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    JOB_REPLAY_NOT_ALLOWED = "JOB_REPLAY_NOT_ALLOWED"
    SCHEDULE_SUBMISSION_MISMATCH = "SCHEDULE_SUBMISSION_MISMATCH"
    SCHEDULE_NOT_FOUND = "SCHEDULE_NOT_FOUND"
    SCHEDULE_NOT_DUE = "SCHEDULE_NOT_DUE"
    SCHEDULE_OVERRIDE_FORBIDDEN = "SCHEDULE_OVERRIDE_FORBIDDEN"


class JobRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DEAD_LETTERED = "dead_lettered"


class JobStatusClass(StrEnum):
    READY = "ready"
    RUNNING = "running"
    PENDING_RETRY = "pending_retry"
    COMPLETED = "completed"
    TERMINAL_FAILURE = "terminal_failure"


class FailureClass(StrEnum):
    TRANSIENT = "transient"
    TERMINAL = "terminal"


class RecommendedAction(StrEnum):
    NONE = "none"
    WAIT_FOR_RETRY = "wait_for_retry"
    REPLAY_SAFE = "replay_safe"
    INSPECT_AND_FIX = "inspect_and_fix"


class ScheduleSource(StrEnum):
    APPROVAL_EVENT = "approval_event"
    MANUAL_OVERRIDE = "manual_override"


class IncidentSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class IncidentFailureClass(StrEnum):
    INTEGRATION_FAILURE = "integration_failure"
    RETRY_EXHAUSTION = "retry_exhaustion"
    SCHEDULING_TERMINAL_FAILURE = "scheduling_terminal_failure"


class IncidentRemediationStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class JobRunSnapshot(BaseModel):
    id: str
    job_type: str
    idempotency_key: str
    status: JobRunStatus
    attempt_count: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    payload_json: dict[str, Any]
    correlation_id: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    scheduled_for: datetime | None = None
    next_retry_at: datetime | None = None
    last_error: str | None = None
    status_class: JobStatusClass
    failure_class: FailureClass | None = None
    recommended_action: RecommendedAction


class DeadLetterJobSnapshot(BaseModel):
    id: str
    job_run_id: str
    payload_json: dict[str, Any]
    failure_reason: str
    created_at: datetime
    replayed_at: datetime | None = None
    status_class: JobStatusClass = JobStatusClass.TERMINAL_FAILURE
    failure_class: FailureClass = FailureClass.TERMINAL
    recommended_action: RecommendedAction = RecommendedAction.REPLAY_SAFE


class EnqueueJobRequest(BaseModel):
    request_id: str = Field(min_length=1)
    job_type: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    payload_json: dict[str, Any] = Field(default_factory=dict)
    max_attempts: int = Field(default=3, ge=1, le=10)
    scheduled_for: datetime | None = None
    correlation_id: str | None = Field(default=None, min_length=1)

    model_config = ConfigDict(extra="forbid")


class EnqueueJobResult(BaseModel):
    idempotent: bool
    job: JobRunSnapshot


class JobDetailResult(BaseModel):
    job: JobRunSnapshot
    dead_letter: DeadLetterJobSnapshot | None


class ReplayJobRequest(BaseModel):
    request_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason", "confirmation")
    @classmethod
    def normalize_required_fields(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized


class ReplayJobResult(BaseModel):
    idempotent: bool
    job: JobRunSnapshot
    dead_letter: DeadLetterJobSnapshot


class ReleaseScheduleSnapshot(BaseModel):
    submission_id: str
    preferred_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    planned_release_at: datetime
    timezone: str
    source: ScheduleSource
    updated_by: str
    updated_at: datetime
    release_triggered_at: datetime | None = None
    version: int = Field(ge=1)


class ScheduleOverrideSnapshot(BaseModel):
    id: str
    submission_id: str
    old_release_at: datetime
    new_release_at: datetime
    reason: str
    actor_id: str
    created_at: datetime


class ScheduleResolveRequest(BaseModel):
    request_id: str = Field(min_length=1)
    scheduling_event: SchedulingTriggerEvent
    timezone: str = Field(default="UTC", min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class ScheduleResolveResult(BaseModel):
    idempotent: bool
    schedule: ReleaseScheduleSnapshot
    release_job: JobRunSnapshot


class ScheduleOverrideRequest(BaseModel):
    request_id: str = Field(min_length=1)
    new_release_at: datetime
    reason: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    timezone: str = Field(default="UTC", min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("actor_role")
    @classmethod
    def validate_actor_role(cls, value: ActorRole) -> ActorRole:
        if value not in (ActorRole.REVIEWER, ActorRole.ADMIN):
            raise ValueError("actor_role must be reviewer or admin")
        return value

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason cannot be blank")
        return normalized

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class ScheduleOverrideResult(BaseModel):
    idempotent: bool
    schedule: ReleaseScheduleSnapshot
    override: ScheduleOverrideSnapshot
    release_job: JobRunSnapshot


class ReleaseTriggerRequest(BaseModel):
    request_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    force: bool = False
    job_run_id: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("actor_role")
    @classmethod
    def validate_actor_role(cls, value: ActorRole) -> ActorRole:
        if value not in (ActorRole.SYSTEM, ActorRole.ADMIN):
            raise ValueError("actor_role must be system or admin")
        return value


class ReleaseTriggerResult(BaseModel):
    idempotent: bool
    schedule: ReleaseScheduleSnapshot
    submission: SubmissionSnapshot


class IncidentAnnotationRequest(BaseModel):
    source: str = Field(min_length=1)
    severity: IncidentSeverity
    note: str = Field(min_length=1)
    linked_entity: str = Field(min_length=1)
    failure_class: IncidentFailureClass | None = None
    correlation_id: str | None = None
    remediation_status: IncidentRemediationStatus = IncidentRemediationStatus.OPEN
    remediation_owner: str | None = None
    remediation_link: str | None = None
    audit_event_id: str | None = None
    request_id: str | None = None
    idempotency_key: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "source",
        "note",
        "linked_entity",
        "correlation_id",
        "remediation_owner",
        "remediation_link",
        "audit_event_id",
        "request_id",
        "idempotency_key",
    )
    @classmethod
    def normalize_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized


class IncidentAnnotationSnapshot(BaseModel):
    id: str
    source: str
    severity: IncidentSeverity
    note: str
    linked_entity: str
    failure_class: IncidentFailureClass | None = None
    correlation_id: str | None = None
    remediation_status: IncidentRemediationStatus = IncidentRemediationStatus.OPEN
    remediation_owner: str | None = None
    remediation_link: str | None = None
    audit_event_id: str | None = None
    created_at: datetime


class IncidentAnnotationResult(BaseModel):
    idempotent: bool
    annotation: IncidentAnnotationSnapshot
