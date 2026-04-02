"""Contract-first models for PRD-07 submission lifecycle and PRD-09 orchestration."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RELEASE_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"

SUBMISSION_STATE_TRANSITIONED_EVENT = "submission.state.transitioned.v1"
SUBMISSION_APPROVED_SCHEDULING_EVENT = "submission.approved.scheduling.v1"


class SubmissionState(StrEnum):
    DRAFT = "draft"
    QC_FAILED = "qc_failed"
    UPLOADING = "uploading"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    SCHEDULED = "scheduled"
    RELEASED = "released"


class ActorRole(StrEnum):
    CREATOR = "creator"
    REVIEWER = "reviewer"
    ADMIN = "admin"
    SYSTEM = "system"


class TransitionErrorCode(StrEnum):
    INVALID_CONTRACT_PAYLOAD = "INVALID_CONTRACT_PAYLOAD"
    SUBMISSION_NOT_FOUND = "SUBMISSION_NOT_FOUND"
    VERSION_CONFLICT = "VERSION_CONFLICT"
    TRANSITION_NOT_ALLOWED = "TRANSITION_NOT_ALLOWED"
    TRANSITION_FORBIDDEN = "TRANSITION_FORBIDDEN"
    MISSING_REQUIRED_REASON = "MISSING_REQUIRED_REASON"
    INVALID_EVENT_NAME = "INVALID_EVENT_NAME"
    MISSING_PREFERRED_RELEASE_MONTH = "MISSING_PREFERRED_RELEASE_MONTH"


class ErrorPayload(BaseModel):
    code: str
    message: str
    details: Mapping[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorPayload


class CreateDraftRequest(BaseModel):
    submission_id: str = Field(min_length=1)
    creator_id: str = Field(min_length=1)
    preferred_release_month: str = Field(pattern=RELEASE_MONTH_PATTERN)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class TransitionRequest(BaseModel):
    request_id: str = Field(min_length=1)
    to_state: SubmissionState
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    reason: str | None = None
    expected_version: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized if normalized else None


class SubmissionSnapshot(BaseModel):
    submission_id: str
    creator_id: str
    current_state: SubmissionState
    version: int = Field(ge=0)
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class TransitionRecord(BaseModel):
    transition_id: str
    request_id: str
    submission_id: str
    from_state: SubmissionState
    to_state: SubmissionState
    actor_id: str
    actor_role: ActorRole
    reason: str | None = None
    occurred_at: datetime
    transition_version: int = Field(ge=1)


class TransitionDomainEvent(BaseModel):
    event_name: Literal[SUBMISSION_STATE_TRANSITIONED_EVENT]
    event_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    from_state: SubmissionState
    to_state: SubmissionState
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    transition_version: int = Field(ge=1)
    occurred_at: datetime
    idempotency_key: str = Field(min_length=1)
    reason: str | None = None
    preferred_release_month: str | None = Field(default=None, pattern=RELEASE_MONTH_PATTERN)

    model_config = ConfigDict(extra="forbid")


class SchedulingTriggerEvent(BaseModel):
    event_name: Literal[SUBMISSION_APPROVED_SCHEDULING_EVENT]
    schema_version: Literal[1]
    submission_id: str = Field(min_length=1)
    preferred_release_month: str = Field(pattern=RELEASE_MONTH_PATTERN)
    idempotency_key: str = Field(min_length=1)
    approved_at: datetime
    triggered_by: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class IntegrationEvent(BaseModel):
    target: str = Field(min_length=1)
    event_name: str = Field(min_length=1)
    emitted_at: datetime
    payload: dict[str, Any]


class TransitionResult(BaseModel):
    submission: SubmissionSnapshot
    transition: TransitionRecord | None
    domain_event: TransitionDomainEvent | None
    idempotent: bool


class OrchestrationResult(BaseModel):
    transition_event_id: str | None
    submission_id: str
    idempotent: bool
    integration_events: list[IntegrationEvent]


class TransitionExecutionResult(BaseModel):
    submission: SubmissionSnapshot
    transition: TransitionRecord | None
    domain_event: TransitionDomainEvent | None
    idempotent: bool
    orchestration: OrchestrationResult


class CreateDraftResult(BaseModel):
    created: bool
    idempotent: bool
    submission: SubmissionSnapshot


class IntegrationDispatchRequest(BaseModel):
    transition_event: TransitionDomainEvent

    model_config = ConfigDict(extra="forbid")
