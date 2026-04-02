"""Contract models for PRD-08 review queue and decision flows."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.features.submissions.contracts import (
    IntegrationEvent,
    SubmissionState,
    TransitionExecutionResult,
    TransitionRecord,
)


class ReviewActorRole(StrEnum):
    CREATOR = "creator"
    REVIEWER = "reviewer"
    ADMIN = "admin"


class ReviewDecisionType(StrEnum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REOPENED = "REOPENED"


class RejectReasonCode(StrEnum):
    QUALITY_ISSUES = "QUALITY_ISSUES"
    METADATA_MISSING = "METADATA_MISSING"
    POLICY_VIOLATION = "POLICY_VIOLATION"
    OTHER = "OTHER"


class ReviewErrorCode(StrEnum):
    REVIEW_FORBIDDEN = "REVIEW_FORBIDDEN"
    REVIEW_INVALID_STATE = "REVIEW_INVALID_STATE"
    REVIEW_REASON_REQUIRED = "REVIEW_REASON_REQUIRED"


class ReviewFlagItem(BaseModel):
    id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    flag_type: str = Field(min_length=1)
    severity: str = Field(min_length=1)
    added_by: str | None = None
    created_at: datetime

    model_config = ConfigDict(extra="forbid")


class ReviewTagItem(BaseModel):
    id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    tag: str = Field(min_length=1)
    added_by: str | None = None
    created_at: datetime

    model_config = ConfigDict(extra="forbid")


class ReviewDecisionItem(BaseModel):
    id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    reviewer_id: str = Field(min_length=1)
    decision: ReviewDecisionType
    reason_code: RejectReasonCode | None = None
    notes: str | None = None
    created_at: datetime

    model_config = ConfigDict(extra="forbid")


class ReviewQueueItem(BaseModel):
    submission_id: str = Field(min_length=1)
    pack_name: str = Field(min_length=1)
    creator_id: str = Field(min_length=1)
    submitted_at: datetime
    state: SubmissionState
    age_days: int = Field(ge=0)
    tags: list[str] = Field(default_factory=list)
    flags: list[ReviewFlagItem] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class ReviewQueueRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: ReviewActorRole
    state: str | None = None
    tag: str | None = None
    flag: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("state", "tag", "flag")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized if normalized else None


class ReviewQueueResponse(BaseModel):
    items: list[ReviewQueueItem]

    model_config = ConfigDict(extra="forbid")


class ReviewSubmissionRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: ReviewActorRole

    model_config = ConfigDict(extra="forbid")


class ReviewSubmissionDetailResponse(BaseModel):
    submission: ReviewQueueItem
    metadata: dict[str, Any]
    qc_findings: list[dict[str, Any]]
    transitions: list[TransitionRecord]
    integration_events: list[IntegrationEvent]
    decisions: list[ReviewDecisionItem]
    tags: list[ReviewTagItem]
    flags: list[ReviewFlagItem]

    model_config = ConfigDict(extra="forbid")


class ReviewActionBaseRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: ReviewActorRole
    request_id: str | None = None
    expected_version: int | None = Field(default=None, ge=0)
    notes: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("request_id", "notes")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized if normalized else None


class ApproveSubmissionRequest(ReviewActionBaseRequest):
    pass


class RejectSubmissionRequest(ReviewActionBaseRequest):
    reason_code: RejectReasonCode | None = None


class ReopenSubmissionRequest(ReviewActionBaseRequest):
    pass


class ReviewDecisionResponse(BaseModel):
    decision: ReviewDecisionItem
    transition: TransitionExecutionResult

    model_config = ConfigDict(extra="forbid")


class AddReviewTagRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: ReviewActorRole
    tag: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("tag")
    @classmethod
    def normalize_tag(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("tag must not be empty")
        return normalized


class AddReviewTagResponse(BaseModel):
    tag: ReviewTagItem

    model_config = ConfigDict(extra="forbid")


class AddReviewFlagRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: ReviewActorRole
    flag_type: str = Field(min_length=1)
    severity: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("flag_type", "severity")
    @classmethod
    def normalize_fields(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("flag fields must not be empty")
        return normalized


class AddReviewFlagResponse(BaseModel):
    flag: ReviewFlagItem

    model_config = ConfigDict(extra="forbid")
