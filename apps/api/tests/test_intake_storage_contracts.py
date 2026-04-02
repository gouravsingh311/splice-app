from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.submissions.contracts import ActorRole
from app.features.submissions.storage_contracts import (
    INTAKE_MANIFEST_INDEXED_EVENT,
    INTAKE_SESSION_STARTED_EVENT,
    STORAGE_HANDOFF_STATUS_EVENT,
    IntakeLifecycleEvent,
    LockSubmissionFilesRequest,
    ManifestFileEntry,
    StorageHandoffControlAction,
    StorageHandoffControlRequest,
    StorageHandoffEvent,
    StorageHandoffStatus,
    UnlockSubmissionFilesRequest,
)


def test_intake_event_contract_keeps_explicit_versioned_names() -> None:
    started = IntakeLifecycleEvent(
        event_name=INTAKE_SESSION_STARTED_EVENT,
        event_id="evt:intake:sub-1:started",
        intake_session_id="intake:sub-1",
        submission_id="sub-1",
        occurred_at=datetime.now(tz=UTC),
        idempotency_key="intake.session.start:sub-1:req-1",
    )
    indexed = IntakeLifecycleEvent(
        event_name=INTAKE_MANIFEST_INDEXED_EVENT,
        event_id="evt:intake:sub-1:manifest:1",
        intake_session_id="intake:sub-1",
        submission_id="sub-1",
        occurred_at=datetime.now(tz=UTC),
        idempotency_key="intake.manifest.upsert:intake:sub-1:req-2",
        manifest_version=1,
        file_count=4,
    )

    assert started.event_name == INTAKE_SESSION_STARTED_EVENT
    assert indexed.event_name == INTAKE_MANIFEST_INDEXED_EVENT


def test_storage_handoff_event_contract_keeps_explicit_name() -> None:
    event = StorageHandoffEvent(
        event_name=STORAGE_HANDOFF_STATUS_EVENT,
        event_id="evt:handoff:intake:sub-2:1:queued",
        handoff_id="handoff:intake:sub-2:1",
        submission_id="sub-2",
        intake_session_id="intake:sub-2",
        status=StorageHandoffStatus.QUEUED,
        target="temporary-object-storage",
        object_count=3,
        occurred_at=datetime.now(tz=UTC),
        idempotency_key="storage.handoff:handoff:intake:sub-2:1:req-1",
    )
    assert event.event_name == STORAGE_HANDOFF_STATUS_EVENT


def test_storage_handoff_control_request_accepts_action_enum() -> None:
    payload = StorageHandoffControlRequest(
        request_id="req-control-1",
        actor_id="creator-1",
        actor_role=ActorRole.CREATOR,
        action=StorageHandoffControlAction.PAUSE,
    )

    assert payload.action == StorageHandoffControlAction.PAUSE


def test_storage_handoff_status_enum_includes_pause_and_cancel() -> None:
    assert StorageHandoffStatus.PAUSED.value == "paused"
    assert StorageHandoffStatus.CANCELED.value == "canceled"


def test_manifest_file_entry_rejects_relative_path_traversal() -> None:
    with pytest.raises(ValidationError):
        ManifestFileEntry(
            relative_path="../Audio/pack.zip",
            size_bytes=1024,
            sha256="a" * 64,
            mime_type="application/zip",
            category="audio",
        )


def test_unlock_request_contract_normalizes_notes_and_role() -> None:
    payload = UnlockSubmissionFilesRequest(
        request_id="req-unlock-1",
        actor_id="reviewer-1",
        actor_role=ActorRole.REVIEWER,
        notes="  Re-open for fixes.  ",
    )
    assert payload.notes == "Re-open for fixes."
    assert payload.actor_role == ActorRole.REVIEWER


def test_lock_request_contract_requires_valid_actor_role() -> None:
    with pytest.raises(ValidationError):
        LockSubmissionFilesRequest(
            actor_id="actor-1",
            actor_role="invalid-role",
        )
