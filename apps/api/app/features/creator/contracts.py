"""Pydantic models and constants for creator workspace features."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

RELEASE_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"

class CreatorProfilePayload(BaseModel):
    actor_id: str = Field(min_length=1)
    user_id: str = Field(default="me", min_length=1)
    display_name: str | None = None
    label_name: str | None = None
    defaults_json: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class CreatorProfileResponse(BaseModel):
    user_id: str
    display_name: str | None
    label_name: str | None
    defaults_json: dict[str, Any]
    updated_at: str | None


class DraftCreatePayload(BaseModel):
    submission_id: str = Field(min_length=1)
    creator_id: str = Field(min_length=1)
    pack_name: str | None = None
    label_name: str | None = None
    release_month: str | None = Field(default=None, pattern=RELEASE_MONTH_PATTERN)
    notes: str | None = None
    tags: list[str] = Field(default_factory=list)
    airtable_form_completed: bool = False
    airtable_payload_checksum: str | None = None
    autosave_json: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")


class MetadataUpdatePayload(BaseModel):
    creator_id: str = Field(min_length=1)
    pack_name: str | None = None
    label_name: str | None = None
    release_month: str | None = Field(default=None, pattern=RELEASE_MONTH_PATTERN)
    notes: str | None = None
    tags: list[str] | None = None
    airtable_form_completed: bool | None = None
    airtable_payload_checksum: str | None = None
    autosave_json: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")


class SubmissionListItem(BaseModel):
    submission_id: str
    creator_id: str
    current_state: str
    version: int
    pack_name: str | None
    label_name: str | None
    release_month: str | None
    notes: str | None
    tags: list[str]
    airtable_form_completed: bool
    airtable_payload_checksum: str | None
    airtable_sync_status: str | None = None
    airtable_record_id: str | None = None
    airtable_record_url: str | None = None
    airtable_last_synced_at: str | None = None
    airtable_last_error_code: str | None = None
    airtable_last_error_detail: str | None = None
    created_at: str
    updated_at: str
    draft_last_saved_at: str | None
    upload_handoff_id: str | None = None
    upload_status: str | None = None
    upload_progress_percent: int | None = None
    upload_uploaded_bytes: int | None = None
    upload_total_bytes: int | None = None
    upload_error: str | None = None
    upload_updated_at: str | None = None
    upload_manifest_version: int | None = None


class TimelineItem(BaseModel):
    transition_id: str
    from_state: str | None
    to_state: str
    actor_id: str | None
    actor_role: str | None
    reason: str | None
    review_decision: str | None = None
    review_reason_code: str | None = None
    review_notes: str | None = None
    request_id: str | None
    created_at: str


class SubmissionDetailResponse(BaseModel):
    submission: SubmissionListItem


class AirtableSyncPayload(BaseModel):
    creator_id: str = Field(min_length=1)
    force_relink: bool = False

    model_config = ConfigDict(extra="forbid")


class AirtableResetPayload(BaseModel):
    creator_id: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class AirtableMappedPayload(BaseModel):
    label_name: str | None
    pack_name: str | None
    release_month: str | None
    notes: str | None
    tags: list[str]


class AirtableLinkStateResponse(BaseModel):
    submission_id: str
    sync_status: str
    airtable_form_completed: bool
    airtable_payload_checksum: str | None
    airtable_record_id: str | None
    airtable_record_url: str | None
    last_synced_at: str | None
    last_error_code: str | None
    last_error_detail: str | None
    canonical_record_id: str | None = None
    mapped_payload: AirtableMappedPayload | None = None
