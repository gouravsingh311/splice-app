from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.features.jobs.services.integrations import register_integration_job_handlers
from app.main import create_app


def create_client() -> TestClient:
    app = create_app()
    app.state.job_queue_service.close()
    app.state.intake_storage_service._build_dropbox_client = (  # type: ignore[method-assign]
        lambda: object()
    )
    app.state.intake_storage_service._upload_manifest_files_to_dropbox = (  # type: ignore[method-assign]
        lambda **_kwargs: None
    )
    app.state.intake_storage_service._verify_dropbox_delivery = (  # type: ignore[method-assign]
        lambda _handoff: None
    )
    register_integration_job_handlers(
        app.state.job_queue_service,
        connection=app.state.job_queue_service._connection,
        storage_service=app.state.intake_storage_service,
        workflow_service=app.state.submission_workflow_service,
    )
    app.state.job_queue_service.close()
    return TestClient(app)


def create_intake_session(client: TestClient, submission_id: str) -> str:
    response = client.post(
        "/intake/sessions",
        json={
            "request_id": "req-start-1",
            "submission_id": submission_id,
            "creator_id": "creator-1",
            "pack_name": "Pack A",
            "declared_top_level_folders": ["Audio", "Artwork"],
        },
    )
    assert response.status_code == 200
    return response.json()["session"]["intake_session_id"]


def manifest_payload(*, request_id: str, lock_manifest: bool) -> dict:
    return {
        "request_id": request_id,
        "files": [
            {
                "relative_path": "Audio/Label - Pack.zip",
                "size_bytes": 2048,
                "sha256": "a" * 64,
                "mime_type": "application/zip",
                "category": "audio_zip",
                "required_asset": True,
            }
        ],
        "lock_manifest": lock_manifest,
    }


def seed_submission_state(client: TestClient, submission_id: str, *, current_state: str) -> None:
    now = datetime.now(tz=UTC).isoformat()
    connection = client.app.state.intake_storage_service._connection
    connection.execute(
        """
        INSERT INTO submissions (id, creator_id, current_state, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (submission_id, "creator-1", current_state, 0, now, now),
    )
    connection.commit()


def test_intake_manifest_inventory_flow() -> None:
    client = create_client()
    session_id = create_intake_session(client, "sub-api-intake-1")

    upsert = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-1", lock_manifest=False),
    )
    assert upsert.status_code == 200
    upsert_payload = upsert.json()
    assert upsert_payload["manifest"]["summary"]["required_audio_zip_present"] is True
    assert upsert_payload["event"]["event_name"] == "intake.manifest.indexed.v1"

    inventory = client.get(f"/intake/sessions/{session_id}/inventory")
    assert inventory.status_code == 200
    assert inventory.json()["manifest"]["manifest_version"] == 1


def test_storage_handoff_create_and_status_flow() -> None:
    client = create_client()
    session_id = create_intake_session(client, "sub-api-intake-2")
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-1", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    handoff = client.post(
        f"/intake/sessions/{session_id}/handoff",
        json={
            "request_id": "req-handoff-1",
            "intake_session_id": session_id,
            "actor_id": "creator-1",
            "actor_role": "creator",
        },
    )
    assert handoff.status_code == 200
    assert handoff.json()["event"]["event_name"] == "storage.handoff.status.v1"
    assert handoff.json()["handoff"]["status"] == "queued"
    assert handoff.json()["handoff"]["progress_percent"] == 0
    assert handoff.json()["handoff"]["uploaded_bytes"] == 0
    assert handoff.json()["handoff"]["total_bytes"] == 2048

    handoff_id = handoff.json()["handoff"]["handoff_id"]
    status = client.get(f"/storage/handoffs/{handoff_id}")
    assert status.status_code == 200
    assert status.json()["handoff"]["status"] == "queued"
    assert status.json()["handoff"]["progress_percent"] == 0
    assert status.json()["handoff"]["uploaded_bytes"] == 0
    assert status.json()["handoff"]["total_bytes"] == 2048

    client.app.state.job_queue_service.execute_due_jobs()
    completed = client.get(f"/storage/handoffs/{handoff_id}")
    assert completed.status_code == 200
    assert completed.json()["handoff"]["status"] == "completed"
    assert completed.json()["handoff"]["progress_percent"] == 100
    assert completed.json()["handoff"]["uploaded_bytes"] == 2048


def test_storage_handoff_control_endpoint_supports_pause_resume_cancel() -> None:
    client = create_client()
    session_id = create_intake_session(client, "sub-api-intake-control-1")
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-control", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    handoff = client.post(
        f"/intake/sessions/{session_id}/handoff",
        json={
            "request_id": "req-handoff-control",
            "intake_session_id": session_id,
            "actor_id": "creator-1",
            "actor_role": "creator",
        },
    )
    assert handoff.status_code == 200
    handoff_id = handoff.json()["handoff"]["handoff_id"]

    pause = client.post(
        f"/storage/handoffs/{handoff_id}/control",
        json={
            "request_id": "req-control-pause",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "action": "pause",
        },
    )
    assert pause.status_code == 200
    assert pause.json()["handoff"]["status"] == "paused"

    resume = client.post(
        f"/storage/handoffs/{handoff_id}/control",
        json={
            "request_id": "req-control-resume",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "action": "resume",
        },
    )
    assert resume.status_code == 200
    assert resume.json()["handoff"]["status"] == "queued"

    cancel = client.post(
        f"/storage/handoffs/{handoff_id}/control",
        json={
            "request_id": "req-control-cancel",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "action": "cancel",
        },
    )
    assert cancel.status_code == 200
    assert cancel.json()["handoff"]["status"] == "canceled"


def test_storage_handoff_rejects_unlocked_manifest() -> None:
    client = create_client()
    session_id = create_intake_session(client, "sub-api-intake-3")
    upsert_unlocked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-1", lock_manifest=False),
    )
    assert upsert_unlocked.status_code == 200

    handoff = client.post(
        "/storage/handoffs",
        json={
            "request_id": "req-handoff-1",
            "intake_session_id": session_id,
            "actor_id": "creator-1",
            "actor_role": "creator",
        },
    )
    assert handoff.status_code == 409
    assert handoff.json()["error"]["code"] == "STORAGE_HANDOFF_PRECONDITION_FAILED"


def test_storage_handoff_rejects_forbidden_role() -> None:
    client = create_client()
    session_id = create_intake_session(client, "sub-api-intake-4")
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-1", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    handoff = client.post(
        "/storage/handoffs",
        json={
            "request_id": "req-handoff-1",
            "intake_session_id": session_id,
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
        },
    )
    assert handoff.status_code == 403
    assert handoff.json()["error"]["code"] == "STORAGE_HANDOFF_FORBIDDEN"


def test_intake_invalid_payload_returns_contract_error_code() -> None:
    client = create_client()
    invalid_response = client.post(
        "/intake/sessions",
        json={
            "submission_id": "sub-api-intake-5",
            "creator_id": "creator-1",
            "pack_name": "Pack A",
        },
    )
    assert invalid_response.status_code == 422
    assert invalid_response.json()["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"


def test_lock_files_endpoint_locks_manifest_rows() -> None:
    client = create_client()
    session_id = create_intake_session(client, "sub-api-intake-6")
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-lock", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    lock_response = client.post(
        "/submissions/sub-api-intake-6/lock-files",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "intake_session_id": session_id,
        },
    )
    assert lock_response.status_code == 200
    assert lock_response.json()["locked_count"] >= 1


def test_unlock_files_endpoint_rejects_forbidden_role() -> None:
    client = create_client()
    submission_id = "sub-api-intake-7"
    seed_submission_state(client, submission_id, current_state="rejected")
    session_id = create_intake_session(client, submission_id)
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-unlock", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    unlock_response = client.post(
        f"/submissions/{submission_id}/unlock-files",
        json={
            "request_id": "req-unlock-1",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "notes": "Please unlock.",
        },
    )
    assert unlock_response.status_code == 403
    assert unlock_response.json()["error"]["code"] == "SUBMISSION_UNLOCK_FORBIDDEN"


def test_unlock_files_endpoint_requires_rejected_state() -> None:
    client = create_client()
    submission_id = "sub-api-intake-8"
    seed_submission_state(client, submission_id, current_state="under_review")
    session_id = create_intake_session(client, submission_id)
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-unlock", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    unlock_response = client.post(
        f"/submissions/{submission_id}/unlock-files",
        json={
            "request_id": "req-unlock-2",
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "notes": "Needs fixes.",
        },
    )
    assert unlock_response.status_code == 409
    assert unlock_response.json()["error"]["code"] == "SUBMISSION_UNLOCK_INVALID_STATE"


def test_unlock_files_endpoint_unlocks_manifest_and_writes_audit_event() -> None:
    client = create_client()
    submission_id = "sub-api-intake-9"
    seed_submission_state(client, submission_id, current_state="rejected")
    session_id = create_intake_session(client, submission_id)
    upsert_locked = client.put(
        f"/intake/sessions/{session_id}/manifest",
        json=manifest_payload(request_id="req-man-unlock", lock_manifest=True),
    )
    assert upsert_locked.status_code == 200

    unlock_response = client.post(
        f"/submissions/{submission_id}/unlock-files",
        json={
            "request_id": "req-unlock-3",
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "notes": "Re-opened for amendments.",
        },
    )
    assert unlock_response.status_code == 200
    assert unlock_response.json()["unlocked_count"] >= 1

    inventory = client.get(f"/intake/sessions/{session_id}/inventory")
    assert inventory.status_code == 200
    assert inventory.json()["manifest"]["locked"] is False

    audit_events = client.get(
        "/audit/events",
        params={
            "action": "submission.reopen.requested",
            "entity_type": "submission",
            "entity_id": submission_id,
        },
    )
    assert audit_events.status_code == 200
    payload = audit_events.json()
    assert payload["total"] >= 1
    assert payload["events"][0]["metadata"]["unlocked_count"] >= 1
