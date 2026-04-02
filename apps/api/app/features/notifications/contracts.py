"""Contract-first models for PRD-10 notification service interfaces and events."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NOTIFICATION_DISPATCH_OUTCOME_EVENT = "notification.dispatch.outcome.v1"


class EmitNotificationRequest(BaseModel):
    # Keep as string to avoid enum coupling across producer/consumer boundaries.
    type: str
    severity: str
    channel: Literal["in_app", "email"]
    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    submission_id: str | None = None
    recipient_email: str | None = None
    max_attempts: int | None = 3

    model_config = ConfigDict(extra="forbid")


class EmitNotificationResponse(BaseModel):
    notification: NotificationItem

    model_config = ConfigDict(extra="forbid")


class NotificationActorRole(StrEnum):
    CREATOR = "creator"
    REVIEWER = "reviewer"
    ADMIN = "admin"


class NotificationSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class NotificationStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class NotificationType(StrEnum):
    QC_FAILED = "qc_failed"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    SCHEDULED = "scheduled"
    RELEASED = "released"


class NotificationErrorCode(StrEnum):
    INVALID_CONTRACT_PAYLOAD = "INVALID_CONTRACT_PAYLOAD"
    NOTIFICATION_NOT_FOUND = "NOTIFICATION_NOT_FOUND"
    NOTIFICATION_SCOPE_FORBIDDEN = "NOTIFICATION_SCOPE_FORBIDDEN"
    NOTIFICATION_RETRY_FORBIDDEN = "NOTIFICATION_RETRY_FORBIDDEN"
    INVALID_EVENT_NAME = "INVALID_EVENT_NAME"


class NotificationItem(BaseModel):
    notification_id: str = Field(min_length=1)
    type: NotificationType
    severity: NotificationSeverity
    status: NotificationStatus
    channel: Literal["in_app", "email"]
    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    submission_id: str | None = None
    read: bool
    read_at: datetime | None = None
    attempts: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(extra="forbid")


class ListNotificationsRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: NotificationActorRole
    include_read: bool = True

    model_config = ConfigDict(extra="forbid")


class ListNotificationsResponse(BaseModel):
    notifications: list[NotificationItem]

    model_config = ConfigDict(extra="forbid")


class MarkNotificationsReadRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: NotificationActorRole
    notification_ids: list[str] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class MarkNotificationsReadResponse(BaseModel):
    updated_count: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")


class MarkAllNotificationsReadRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: NotificationActorRole

    model_config = ConfigDict(extra="forbid")


class MarkAllNotificationsReadResponse(BaseModel):
    updated_count: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")


class RetryNotificationRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: NotificationActorRole
    notification_id: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class RetryNotificationResponse(BaseModel):
    notification: NotificationItem

    model_config = ConfigDict(extra="forbid")


class NotificationDispatchOutcomeEvent(BaseModel):
    event_name: Literal[NOTIFICATION_DISPATCH_OUTCOME_EVENT]
    schema_version: Literal[1]
    notification_id: str = Field(min_length=1)
    status: NotificationStatus
    attempt: int = Field(ge=1)
    max_attempts: int = Field(ge=1)
    occurred_at: datetime

    model_config = ConfigDict(extra="forbid")
