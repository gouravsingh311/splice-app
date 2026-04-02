"""Contract models for PRD-03 intake flow and PRD-12 storage handoff foundations."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.features.submissions.contracts import ActorRole

SHA256_PATTERN = r"^[A-Fa-f0-9]{64}$"

INTAKE_SESSION_STARTED_EVENT = "intake.session.started.v1"
INTAKE_MANIFEST_INDEXED_EVENT = "intake.manifest.indexed.v1"
STORAGE_HANDOFF_STATUS_EVENT = "storage.handoff.status.v1"


class IntakeStorageErrorCode(StrEnum):
    INVALID_CONTRACT_PAYLOAD = "INVALID_CONTRACT_PAYLOAD"
    INTAKE_SESSION_NOT_FOUND = "INTAKE_SESSION_NOT_FOUND"
    INTAKE_MANIFEST_LOCKED = "INTAKE_MANIFEST_LOCKED"
    INTAKE_MANIFEST_VERSION_CONFLICT = "INTAKE_MANIFEST_VERSION_CONFLICT"
    STORAGE_HANDOFF_NOT_FOUND = "STORAGE_HANDOFF_NOT_FOUND"
    STORAGE_HANDOFF_PRECONDITION_FAILED = "STORAGE_HANDOFF_PRECONDITION_FAILED"
    STORAGE_HANDOFF_FORBIDDEN = "STORAGE_HANDOFF_FORBIDDEN"
    STORAGE_HANDOFF_INVALID_CONTROL = "STORAGE_HANDOFF_INVALID_CONTROL"
    SUBMISSION_NOT_FOUND = "SUBMISSION_NOT_FOUND"
    SUBMISSION_UNLOCK_FORBIDDEN = "SUBMISSION_UNLOCK_FORBIDDEN"
    SUBMISSION_UNLOCK_INVALID_STATE = "SUBMISSION_UNLOCK_INVALID_STATE"


class IntakeSessionStatus(StrEnum):
    INITIATED = "initiated"
    MANIFEST_READY = "manifest_ready"
    TRANSFER_COMPLETED = "transfer_completed"


class StorageHandoffStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELED = "canceled"
    FAILED = "failed"


class StorageHandoffControlAction(StrEnum):
    PAUSE = "pause"
    RESUME = "resume"
    CANCEL = "cancel"


class StartIntakeSessionRequest(BaseModel):
    request_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    creator_id: str = Field(min_length=1)
    pack_name: str = Field(min_length=1)
    declared_top_level_folders: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")

    @field_validator("declared_top_level_folders")
    @classmethod
    def normalize_top_level_folders(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for item in value:
            cleaned = item.strip()
            if cleaned:
                normalized.append(cleaned)
        return normalized


class IntakeSessionSnapshot(BaseModel):
    intake_session_id: str
    submission_id: str
    creator_id: str
    pack_name: str
    declared_top_level_folders: list[str]
    status: IntakeSessionStatus
    manifest_version: int = Field(ge=0)
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class IntakeLifecycleEvent(BaseModel):
    event_name: Literal[INTAKE_SESSION_STARTED_EVENT, INTAKE_MANIFEST_INDEXED_EVENT]
    event_id: str = Field(min_length=1)
    intake_session_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    occurred_at: datetime
    idempotency_key: str = Field(min_length=1)
    manifest_version: int | None = Field(default=None, ge=1)
    file_count: int | None = Field(default=None, ge=0)

    model_config = ConfigDict(extra="forbid")


class StartIntakeSessionResult(BaseModel):
    created: bool
    idempotent: bool
    session: IntakeSessionSnapshot
    event: IntakeLifecycleEvent | None


class ManifestFileEntry(BaseModel):
    relative_path: str = Field(min_length=1)
    size_bytes: int = Field(ge=1)
    sha256: str = Field(pattern=SHA256_PATTERN)
    mime_type: str = Field(min_length=1)
    category: str = Field(min_length=1, default="other")
    required_asset: bool = False

    model_config = ConfigDict(extra="forbid")

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        normalized = value.strip().replace("\\", "/")
        if not normalized:
            raise ValueError("relative_path must be non-empty.")
        if normalized.startswith("/"):
            raise ValueError("relative_path must be relative.")
        if ".." in normalized:
            raise ValueError("relative_path must not contain parent directory traversal.")
        return normalized


class ManifestSummary(BaseModel):
    total_file_count: int = Field(ge=0)
    total_bytes: int = Field(ge=0)
    counts_by_category: dict[str, int]
    required_audio_zip_present: bool


class ManifestSnapshot(BaseModel):
    manifest_version: int = Field(ge=0)
    locked: bool
    files: list[ManifestFileEntry]
    summary: ManifestSummary
    updated_at: datetime


class UpsertIntakeManifestRequest(BaseModel):
    request_id: str = Field(min_length=1)
    expected_manifest_version: int | None = Field(default=None, ge=0)
    files: list[ManifestFileEntry] = Field(min_length=1)
    lock_manifest: bool = False

    model_config = ConfigDict(extra="forbid")


class UpsertIntakeManifestResult(BaseModel):
    idempotent: bool
    session: IntakeSessionSnapshot
    manifest: ManifestSnapshot
    event: IntakeLifecycleEvent


class IntakeInventoryResult(BaseModel):
    session: IntakeSessionSnapshot
    manifest: ManifestSnapshot | None


class CreateStorageHandoffRequest(BaseModel):
    request_id: str = Field(min_length=1)
    intake_session_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    target: Literal["temporary-object-storage"] = "temporary-object-storage"

    model_config = ConfigDict(extra="forbid")


class StorageHandoffControlRequest(BaseModel):
    request_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    action: StorageHandoffControlAction

    model_config = ConfigDict(extra="forbid")


class StorageHandoffSnapshot(BaseModel):
    handoff_id: str
    submission_id: str
    intake_session_id: str
    status: StorageHandoffStatus
    target: str
    progress_percent: int = Field(ge=0, le=100)
    uploaded_bytes: int = Field(ge=0)
    total_bytes: int = Field(ge=0)
    object_count: int = Field(ge=0)
    uploaded_files: int = Field(ge=0)
    total_files: int = Field(ge=0)
    completed_object_count: int = Field(ge=0, default=0)
    checksum_verified: bool
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    error: str | None = None


class StorageHandoffEvent(BaseModel):
    event_name: Literal[STORAGE_HANDOFF_STATUS_EVENT]
    event_id: str = Field(min_length=1)
    handoff_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    intake_session_id: str = Field(min_length=1)
    status: StorageHandoffStatus
    target: str = Field(min_length=1)
    object_count: int = Field(ge=0)
    occurred_at: datetime
    idempotency_key: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class CreateStorageHandoffResult(BaseModel):
    idempotent: bool
    handoff: StorageHandoffSnapshot
    event: StorageHandoffEvent


class StorageHandoffStatusResult(BaseModel):
    handoff: StorageHandoffSnapshot


class StorageHandoffControlResult(BaseModel):
    handoff: StorageHandoffSnapshot
    job_reenqueued: bool = False
    event: StorageHandoffEvent | None = None


class LockSubmissionFilesRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    intake_session_id: str | None = None

    model_config = ConfigDict(extra="forbid")


class LockSubmissionFilesResult(BaseModel):
    submission_id: str
    intake_session_id: str
    locked_count: int = Field(ge=0)
    locked_at: datetime

    model_config = ConfigDict(extra="forbid")


class UnlockSubmissionFilesRequest(BaseModel):
    request_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: ActorRole
    notes: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized if normalized else None


class UnlockSubmissionFilesResult(BaseModel):
    submission_id: str
    intake_session_id: str
    unlocked_count: int = Field(ge=0)
    unlocked_at: datetime

    model_config = ConfigDict(extra="forbid")


class IntakeStorageErrorPayload(BaseModel):
    code: str
    message: str
    details: Mapping[str, Any] = Field(default_factory=dict)


class IntakeStorageErrorResponse(BaseModel):
    error: IntakeStorageErrorPayload
