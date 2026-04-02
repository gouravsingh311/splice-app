"""APUI-T06: Airtable upsert sync backend tests.

Tests the four required scenarios:
  1. No-match -> create: backend creates new Airtable record, returns linked.
  2. No-match + create auth failure: returns sync_error, preserves existing state.
  3. One-match -> update: backend syncs existing record, returns linked.
  4. Duplicate -> duplicate_detected: deterministic canonical handling unchanged.
  5. Previously-linked record goes missing -> desynced (not attempted create).
"""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.features.creator.airtable_sync import (
    _AirtableCreateResult,
    _AirtableFetchResult,
    _MappedAirtableRecord,
)
from app.main import create_app


def make_client() -> TestClient:
    return TestClient(create_app())


def _draft_payload(submission_id: str, *, pack_name: str = "Test Pack", release_month: str = "2026-09") -> dict:
    return {
        "submission_id": submission_id,
        "creator_id": "creator-t06",
        "pack_name": pack_name,
        "label_name": "FileEaters",
        "release_month": release_month,
        "notes": "APUI-T06 test",
        "tags": ["electronic"],
        "airtable_form_completed": False,
    }


def _seed_linked_row(client: TestClient, submission_id: str) -> None:
    """Seed a linked airtable_submission_links row for tests that need pre-existing link."""
    now = datetime.now(tz=UTC).isoformat()
    conn = client.app.state.submission_workflow_service._connection
    conn.execute(
        """
        INSERT INTO airtable_submission_links (
            submission_id, airtable_base_id, airtable_table_name, airtable_view_name,
            airtable_record_id, airtable_record_url, airtable_payload_checksum,
            sync_status, last_synced_at, last_error_code, last_error_detail,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          sync_status = excluded.sync_status, updated_at = excluded.updated_at
        """,
        (
            submission_id, "base-1", "Submissions", "Desktop Completion Lookup v1",
            f"existing-rec-{submission_id}", f"https://airtable.com/base-1/existing-rec-{submission_id}",
            "oldchecksum", "linked", now, None, None, now, now,
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# 1. No-match → create (happy path)
# ---------------------------------------------------------------------------

def test_sync_no_match_creates_record_and_returns_linked() -> None:
    """When 0 Airtable records found, backend creates new record and returns linked."""
    client = make_client()
    client.post("/creator/submissions/draft", json=_draft_payload("t06-create-ok"))

    new_record = _MappedAirtableRecord(
        record_id="rec-new-t06",
        record_url="https://airtable.com/base-1/rec-new-t06",
        created_at="2026-03-13T10:00:00.000Z",
        label_name="FileEaters",
        pack_name="Test Pack",
        release_month="2026-09",
        notes="APUI-T06 test",
        tags=["electronic"],
        checksum="chk-created",
    )
    create_result = _AirtableCreateResult(
        record=new_record,
        base_id="base-1",
        table_name="Submissions",
        view_name="Desktop Completion Lookup v1",
    )

    with (
        patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch,
        patch("app.features.creator.service.create_airtable_record_for_submission") as mock_create,
    ):
        mock_fetch.return_value = _AirtableFetchResult(
            records=[],
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )
        mock_create.return_value = create_result

        response = client.post(
            "/creator/submissions/t06-create-ok/airtable/sync",
            json={"creator_id": "creator-t06", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "linked", f"Expected 'linked', got {payload['sync_status']}"
    assert payload["airtable_record_id"] == "rec-new-t06"
    assert payload["airtable_form_completed"] is True
    assert payload["mapped_payload"] is not None
    assert payload["mapped_payload"]["pack_name"] == "Test Pack"
    assert payload["last_error_code"] is None
    # Verify create was actually called (no silent skip)
    mock_create.assert_called_once()


# ---------------------------------------------------------------------------
# 2. No-match + create auth failure → sync_error preserved
# ---------------------------------------------------------------------------

def test_sync_no_match_create_auth_failure_returns_sync_error() -> None:
    """When 0 records found and create returns AIRTABLE_AUTH_FAILED, returns sync_error."""
    client = make_client()
    client.post("/creator/submissions/draft", json=_draft_payload("t06-create-fail"))

    with (
        patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch,
        patch("app.features.creator.service.create_airtable_record_for_submission") as mock_create,
    ):
        mock_fetch.return_value = _AirtableFetchResult(
            records=[],
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )
        mock_create.return_value = _AirtableCreateResult(
            record=None,
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
            error_code="AIRTABLE_AUTH_FAILED",
            error_detail="Airtable API returned HTTP 403 during create.",
        )

        response = client.post(
            "/creator/submissions/t06-create-fail/airtable/sync",
            json={"creator_id": "creator-t06", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "sync_error"
    assert payload["last_error_code"] == "AIRTABLE_AUTH_FAILED"
    assert payload["airtable_form_completed"] is False


# ---------------------------------------------------------------------------
# 3. One-match → update → linked (existing record)
# ---------------------------------------------------------------------------

def test_sync_one_match_updates_and_returns_linked() -> None:
    """When exactly 1 Airtable record found, backend links it and returns linked."""
    client = make_client()
    client.post("/creator/submissions/draft", json=_draft_payload("t06-update-ok"))

    matched_record = _MappedAirtableRecord(
        record_id="rec-existing-t06",
        record_url="https://airtable.com/base-1/rec-existing-t06",
        created_at="2026-03-12T08:00:00.000Z",
        label_name="FileEaters",
        pack_name="Test Pack",
        release_month="2026-09",
        notes="APUI-T06 test",
        tags=["electronic"],
        checksum="chk-match",
    )

    with patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch:
        mock_fetch.return_value = _AirtableFetchResult(
            records=[matched_record],
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )

        response = client.post(
            "/creator/submissions/t06-update-ok/airtable/sync",
            json={"creator_id": "creator-t06", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "linked"
    assert payload["airtable_record_id"] == "rec-existing-t06"
    assert payload["airtable_form_completed"] is True
    assert payload["airtable_payload_checksum"] == "chk-match"


# ---------------------------------------------------------------------------
# 4. Duplicate → duplicate_detected (unchanged behavior)
# ---------------------------------------------------------------------------

def test_sync_duplicate_returns_duplicate_detected() -> None:
    """When >1 records found, returns duplicate_detected with canonical record id."""
    client = make_client()
    client.post("/creator/submissions/draft", json=_draft_payload("t06-dup"))

    dup_records = [
        _MappedAirtableRecord(
            record_id="rec-dup-a",
            record_url=None,
            created_at="2026-03-12T07:00:00.000Z",
            label_name="FileEaters",
            pack_name="Test Pack",
            release_month="2026-09",
            notes=None,
            tags=[],
            checksum="chk-dup-a",
        ),
        _MappedAirtableRecord(
            record_id="rec-dup-b",
            record_url=None,
            created_at="2026-03-12T09:00:00.000Z",
            label_name="FileEaters",
            pack_name="Test Pack",
            release_month="2026-09",
            notes=None,
            tags=[],
            checksum="chk-dup-b",
        ),
    ]

    with patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch:
        mock_fetch.return_value = _AirtableFetchResult(
            records=dup_records,
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )

        response = client.post(
            "/creator/submissions/t06-dup/airtable/sync",
            json={"creator_id": "creator-t06", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "duplicate_detected"
    assert payload["last_error_code"] == "AIRTABLE_DUPLICATE_SUBMISSION_ID"
    # Canonical is the oldest record by created_at
    assert payload["canonical_record_id"] == "rec-dup-a"


# ---------------------------------------------------------------------------
# 5. Previously-linked record vanishes → desynced (NOT create)
# ---------------------------------------------------------------------------

def test_sync_previously_linked_record_missing_returns_desynced() -> None:
    """If submission was previously linked and record disappears, return desynced not create."""
    client = make_client()
    client.post("/creator/submissions/draft", json=_draft_payload("t06-desynced"))
    _seed_linked_row(client, "t06-desynced")  # establishes sync_status=linked

    with patch("app.features.creator.service.fetch_airtable_records_for_submission") as mock_fetch:
        mock_fetch.return_value = _AirtableFetchResult(
            records=[],
            base_id="base-1",
            table_name="Submissions",
            view_name="Desktop Completion Lookup v1",
        )

        response = client.post(
            "/creator/submissions/t06-desynced/airtable/sync",
            json={"creator_id": "creator-t06", "force_relink": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"] == "desynced"
    assert payload["last_error_code"] == "AIRTABLE_LINKED_RECORD_MISSING"
