from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.features.creator.airtable_sync import _AirtableFetchResult, _MappedAirtableRecord
from app.main import create_app


def create_client() -> TestClient:
    app = create_app()
    app.state.job_queue_service.close()
    return TestClient(app)


def auth_headers(*, actor_id: str, actor_role: str) -> dict[str, str]:
    return {
        "X-Actor-Id": actor_id,
        "X-Actor-Role": actor_role,
    }


def seed_airtable_link(client: TestClient, submission_id: str) -> None:
    now = datetime.now(tz=UTC).isoformat()
    connection = client.app.state.submission_workflow_service._connection
    connection.execute(
        """
        INSERT INTO airtable_submission_links (
            submission_id,
            airtable_base_id,
            airtable_table_name,
            airtable_view_name,
            airtable_record_id,
            airtable_record_url,
            airtable_payload_checksum,
            sync_status,
            last_synced_at,
            last_error_code,
            last_error_detail,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          sync_status = excluded.sync_status,
          updated_at = excluded.updated_at
        """,
        (
            submission_id,
            "base-1",
            "Submissions",
            "Desktop Completion Lookup v1",
            f"rec-{submission_id}",
            None,
            "checksum-1",
            "linked",
            now,
            None,
            None,
            now,
            now,
        ),
    )
    connection.commit()


def seed_upload_session(
    client: TestClient,
    submission_id: str,
    *,
    status: str = "manifest_ready",
    upload_status: str = "in_progress",
    progress_percent: int = 42,
    uploaded_bytes: int = 4096,
    total_bytes: int = 8192,
) -> None:
    now = datetime.now(tz=UTC).isoformat()
    connection = client.app.state.submission_workflow_service._connection
    connection.execute(
        """
        INSERT INTO upload_sessions (
            id,
            submission_id,
            status,
            local_pack_path,
            dropbox_dest_path,
            sha256_manifest_json,
            chunk_state_json,
            created_at,
            expires_at,
            completed_at,
            locked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"intake:{submission_id}:1",
            submission_id,
            status,
            "/tmp/local-pack",
            f"/deliveries/{submission_id}",
            None,
            (
                "{"
                f'"upload_status":"{upload_status}",'
                f'"upload_progress_percent":{progress_percent},'
                f'"upload_uploaded_bytes":{uploaded_bytes},'
                f'"upload_total_bytes":{total_bytes},'
                '"manifest_version":1,'
                '"upload_error":null,'
                f'"upload_updated_at":"{now}"'
                "}"
            ),
            now,
            None,
            None,
            now,
        ),
    )
    connection.commit()


def test_creator_profile_get_and_put_roundtrip() -> None:
    client = create_client()

    empty = client.get("/creator/profile", params={"user_id": "me", "actor_id": "creator-1"})
    assert empty.status_code == 200
    assert empty.json()["user_id"] == "creator-1"
    assert empty.json()["display_name"] is None
    assert empty.json()["defaults_json"] == {
        "notifications": {"approval_email_enabled": False}
    }

    updated = client.put(
        "/creator/profile",
        json={
            "actor_id": "creator-1",
            "user_id": "me",
            "display_name": "Creator One",
            "label_name": "Splice",
            "defaults_json": {"genre": "house"},
        },
    )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["user_id"] == "creator-1"
    assert payload["display_name"] == "Creator One"
    assert payload["label_name"] == "Splice"
    assert payload["defaults_json"] == {
        "genre": "house",
        "notifications": {"approval_email_enabled": False},
    }


def test_creator_submission_draft_metadata_and_list_flow() -> None:
    client = create_client()

    draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-1",
            "creator_id": "creator-1",
            "pack_name": "Neon Drums",
            "release_month": "2026-08",
            "notes": "Initial draft",
            "tags": ["drums", "electronic"],
            "airtable_form_completed": True,
            "airtable_payload_checksum": "abc123",
            "autosave_json": {"step": "metadata"},
        },
    )

    assert draft.status_code == 200
    draft_payload = draft.json()["submission"]
    assert draft_payload["submission_id"] == "creator-sub-1"
    assert draft_payload["current_state"] == "draft"
    assert draft_payload["pack_name"] == "Neon Drums"
    assert draft_payload["airtable_form_completed"] is True

    metadata = client.put(
        "/creator/submissions/creator-sub-1/metadata",
        json={
            "creator_id": "creator-1",
            "pack_name": "Neon Drums Vol. 2",
            "notes": "Updated metadata",
            "tags": ["drums", "electronic", "updated"],
            "autosave_json": {"step": "ready"},
        },
    )

    assert metadata.status_code == 200
    metadata_payload = metadata.json()["submission"]
    assert metadata_payload["pack_name"] == "Neon Drums Vol. 2"
    assert metadata_payload["notes"] == "Updated metadata"
    assert metadata_payload["tags"] == ["drums", "electronic", "updated"]

    seed_upload_session(client, "creator-sub-1")

    listing = client.get("/creator/submissions", params={"creator_id": "creator-1"})
    assert listing.status_code == 200
    list_payload = listing.json()
    listed_submission = next(
        (submission for submission in list_payload if submission["submission_id"] == "creator-sub-1"),
        None,
    )
    assert listed_submission is not None
    assert listed_submission["current_state"] == "draft"
    assert listed_submission["upload_status"] == "in_progress"
    assert listed_submission["upload_progress_percent"] == 42
    assert listed_submission["upload_uploaded_bytes"] == 4096
    assert listed_submission["upload_total_bytes"] == 8192
    assert listed_submission["upload_manifest_version"] == 1
    assert listed_submission["upload_handoff_id"] == "handoff:intake:creator-sub-1:1:1"
    assert listed_submission["upload_error"] is None
    assert listed_submission["upload_updated_at"] is not None


def test_creator_submission_timeline_reads_submission_transitions() -> None:
    client = create_client()

    create_draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-2",
            "creator_id": "creator-1",
            "pack_name": "Timeline Pack",
            "release_month": "2026-09",
            "airtable_form_completed": True,
        },
    )
    assert create_draft.status_code == 200
    seed_airtable_link(client, "creator-sub-2")

    transition = client.post(
        "/submissions/creator-sub-2/transition",
        json={
            "request_id": "req-timeline-1",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert transition.status_code == 200

    timeline = client.get(
        "/creator/submissions/creator-sub-2/timeline",
        params={"creator_id": "creator-1"},
    )
    assert timeline.status_code == 200

    timeline_payload = timeline.json()
    assert len(timeline_payload) == 1
    assert timeline_payload[0]["to_state"] == "under_review"
    assert timeline_payload[0]["request_id"] == "req-timeline-1"


def test_creator_submission_timeline_includes_rejection_reason_and_notes() -> None:
    client = create_client()

    create_draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-2b",
            "creator_id": "creator-1",
            "pack_name": "Timeline Pack Reject",
            "release_month": "2026-09",
            "airtable_form_completed": True,
        },
    )
    assert create_draft.status_code == 200
    seed_airtable_link(client, "creator-sub-2b")

    transition = client.post(
        "/submissions/creator-sub-2b/transition",
        json={
            "request_id": "req-timeline-2b-under-review",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert transition.status_code == 200

    reject = client.post(
        "/reviews/submissions/creator-sub-2b/reject",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "req-timeline-2b-reject",
            "reason_code": "QUALITY_ISSUES",
            "notes": "Please fix artwork and metadata before resubmitting.",
        },
        headers=auth_headers(actor_id="reviewer-1", actor_role="reviewer"),
    )
    assert reject.status_code == 200

    timeline = client.get(
        "/creator/submissions/creator-sub-2b/timeline",
        params={"creator_id": "creator-1"},
    )
    assert timeline.status_code == 200

    timeline_payload = timeline.json()
    assert len(timeline_payload) == 2
    assert timeline_payload[0]["to_state"] == "rejected"
    assert timeline_payload[0]["review_decision"] == "REJECTED"
    assert timeline_payload[0]["review_reason_code"] == "QUALITY_ISSUES"
    assert timeline_payload[0]["review_notes"] == "Please fix artwork and metadata before resubmitting."


def test_creator_submission_list_includes_airtable_link_fields() -> None:
    client = create_client()

    draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-airtable",
            "creator_id": "creator-1",
            "pack_name": "Linked Pack",
            "release_month": "2026-08",
            "airtable_form_completed": True,
            "airtable_payload_checksum": "checksum-1",
        },
    )
    assert draft.status_code == 200
    seed_airtable_link(client, "creator-sub-airtable")

    listing = client.get("/creator/submissions", params={"creator_id": "creator-1"})
    assert listing.status_code == 200
    payload = listing.json()[0]
    assert payload["airtable_sync_status"] == "linked"
    assert payload["airtable_record_id"] == "rec-creator-sub-airtable"


def test_sync_submission_airtable_links_single_record() -> None:
    client = create_client()
    create_draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-sync",
            "creator_id": "creator-1",
            "pack_name": "Draft Pack",
            "release_month": "2026-09",
            "airtable_form_completed": False,
        },
    )
    assert create_draft.status_code == 200

    with patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch:
        mock_fetch.return_value = _AirtableFetchResult(
            records=[
                _MappedAirtableRecord(
                    record_id="rec-sync",
                    record_url="https://airtable.com/base/rec-sync",
                    created_at="2026-03-06T10:00:00.000Z",
                    label_name="Splice",
                    pack_name="Draft Pack",
                    release_month="2026-09",
                    notes="Ready for review",
                    tags=["house"],
                    checksum="checksum-2",
                )
            ],
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )

        response = client.post(
            "/creator/submissions/creator-sub-sync/airtable/sync",
            json={"creator_id": "creator-1", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "linked"
    assert payload["airtable_form_completed"] is True
    assert payload["airtable_record_id"] == "rec-sync"
    assert payload["mapped_payload"]["pack_name"] == "Draft Pack"


def test_sync_submission_airtable_marks_duplicate_records() -> None:
    client = create_client()
    create_draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-duplicate",
            "creator_id": "creator-1",
            "pack_name": "Draft Pack",
            "release_month": "2026-09",
            "airtable_form_completed": False,
        },
    )
    assert create_draft.status_code == 200

    duplicate_records = [
        _MappedAirtableRecord(
            record_id="rec-1",
            record_url="https://airtable.com/base/rec-1",
            created_at="2026-03-06T09:00:00.000Z",
            label_name="Splice",
            pack_name="Draft Pack",
            release_month="2026-09",
            notes=None,
            tags=[],
            checksum="checksum-a",
        ),
        _MappedAirtableRecord(
            record_id="rec-2",
            record_url="https://airtable.com/base/rec-2",
            created_at="2026-03-06T10:00:00.000Z",
            label_name="Splice",
            pack_name="Draft Pack",
            release_month="2026-09",
            notes=None,
            tags=[],
            checksum="checksum-b",
        ),
    ]

    with patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch:
        mock_fetch.return_value = _AirtableFetchResult(
            records=duplicate_records,
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )

        response = client.post(
            "/creator/submissions/creator-sub-duplicate/airtable/sync",
            json={"creator_id": "creator-1", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "duplicate_detected"
    assert payload["canonical_record_id"] == "rec-1"
    assert payload["last_error_code"] == "AIRTABLE_DUPLICATE_SUBMISSION_ID"


def test_reset_submission_airtable_clears_completion_gate() -> None:
    client = create_client()
    create_draft = client.post(
        "/creator/submissions/draft",
        json={
            "submission_id": "creator-sub-reset",
            "creator_id": "creator-1",
            "pack_name": "Reset Pack",
            "release_month": "2026-09",
            "airtable_form_completed": True,
            "airtable_payload_checksum": "checksum-reset",
        },
    )
    assert create_draft.status_code == 200
    seed_airtable_link(client, "creator-sub-reset")

    response = client.post(
        "/creator/submissions/creator-sub-reset/airtable/reset",
        json={"creator_id": "creator-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["airtable_form_completed"] is False
    assert payload["airtable_payload_checksum"] is None
    assert payload["sync_status"] == "missing_remote"
