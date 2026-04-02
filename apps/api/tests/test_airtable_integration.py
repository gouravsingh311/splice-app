"""
Live Airtable integration tests.

Run ONLY with real .env.local credentials:
    LIVE_INTEGRATION=1 pytest apps/api/tests/test_airtable_integration.py -v

Requires the backend running on http://127.0.0.1:8099 (or PW_API_BASE_URL).

Required env vars:
    AIRTABLE_API_KEY              — Airtable personal access token
    AIRTABLE_SUBMISSIONS_TABLE    — Table: either 'Submissions' name or 'appXXX/tblXXX'

How Airtable is used in this app:
  - submission.rejected   → Airtable gets submission_id + reason + actor_id
  - submission.scheduled  → Airtable gets submission_id + scheduled_at
  The orchestrator emits IntegrationEvent objects with target="airtable".
  Events are persisted to integration_event_log table.
"""

import os
import sqlite3
from datetime import UTC

import pytest
import requests

LIVE = os.getenv("LIVE_INTEGRATION") == "1"
skip_live = pytest.mark.skipif(not LIVE, reason="Set LIVE_INTEGRATION=1 to run")
API_BASE = os.getenv("PW_API_BASE_URL", "http://127.0.0.1:8099")


# ---------------------------------------------------------------------------
# Airtable API connectivity tests (direct Airtable API, no backend needed)
# ---------------------------------------------------------------------------

@skip_live
def test_airtable_api_key_is_valid():
    """Verify AIRTABLE_API_KEY is accepted by Airtable's /meta/whoami endpoint."""
    api_key = os.environ.get("AIRTABLE_API_KEY", "")
    assert api_key, "AIRTABLE_API_KEY must be set in .env.local"

    resp = requests.get(
        "https://api.airtable.com/v0/meta/whoami",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=10,
    )
    assert resp.status_code == 200, (
        f"Airtable API key validation failed: HTTP {resp.status_code} — {resp.text}"
    )
    body = resp.json()
    assert "id" in body, f"Expected token id in whoami: {body}"
    print(f"✅ Airtable API key valid. Token ID: {body.get('id')}")


@skip_live
def test_airtable_submissions_table_accessible():
    """
    Verify the table in AIRTABLE_SUBMISSIONS_TABLE is reachable.
    Format must be: 'appXXX/tblXXX' (base_id/table_id).
    """
    api_key = os.environ.get("AIRTABLE_API_KEY", "")
    table_ref = os.environ.get("AIRTABLE_SUBMISSIONS_TABLE", "")
    assert api_key and table_ref, "AIRTABLE_API_KEY + AIRTABLE_SUBMISSIONS_TABLE required"

    if "/" not in table_ref:
        pytest.skip(
            "Set AIRTABLE_SUBMISSIONS_TABLE=appXXX/tblXXX for table access test. "
            "Current value is just a table name without base ID."
        )

    base_id, table_id = table_ref.split("/", 1)
    resp = requests.get(
        f"https://api.airtable.com/v0/{base_id}/{table_id}",
        headers={"Authorization": f"Bearer {api_key}"},
        params={"maxRecords": 1, "pageSize": 1},
        timeout=10,
    )
    assert resp.status_code == 200, (
        f"Airtable table access failed: HTTP {resp.status_code} — {resp.text}"
    )
    body = resp.json()
    assert "records" in body, f"Expected 'records' in response: {body}"
    print(f"✅ Table accessible. Records in page: {len(body['records'])}")


# ---------------------------------------------------------------------------
# Integration orchestrator tests (correct constructor: connection only)
# ---------------------------------------------------------------------------

@skip_live
def test_orchestrator_emits_airtable_event_for_rejection(tmp_path):
    """
    IntegrationOrchestrator.consume_transition_event for a rejection
    should create an airtable integration event with submission.rejected payload.
    """
    from datetime import datetime
    from pathlib import Path

    from app.features.submissions.contracts import SubmissionState, TransitionDomainEvent
    from app.features.submissions.orchestrator import IntegrationOrchestratorService
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL;")
    db.execute("PRAGMA foreign_keys=ON;")
    schema = (Path(__file__).parent.parent / "app" / "db_schema.sql").read_text("utf-8")
    db.executescript(schema)
    orch = IntegrationOrchestratorService(connection=db)

    now = datetime.now(tz=UTC)
    sid = f"airtable-reject-{int(now.timestamp())}"
    event = TransitionDomainEvent(
        event_name="submission.state.transitioned.v1",
        event_id=f"evt:{sid}:rejected",
        submission_id=sid,
        from_state=SubmissionState.UNDER_REVIEW,
        to_state=SubmissionState.REJECTED,
        actor_id="reviewer-live",
        actor_role="reviewer",
        transition_version=2,
        occurred_at=now,
        idempotency_key=f"transition:{sid}:rejected",
        reason="QUALITY_ISSUES",
        preferred_release_month=None,
    )

    result = orch.consume_transition_event(event)

    # Verify an airtable event was emitted
    emitted = result.integration_events if hasattr(result, 'integration_events') else []
    airtable_events = [e for e in emitted if e.target == "airtable"]
    assert len(airtable_events) >= 1, (
        f"Expected at least 1 Airtable event for rejection. Got: {emitted}"
    )

    evt = airtable_events[0]
    assert evt.event_name == "submission.rejected"
    assert evt.payload["submission_id"] == sid
    assert evt.payload.get("reason") == "QUALITY_ISSUES"


@skip_live
def test_orchestrator_emits_airtable_event_for_scheduling(tmp_path):
    """
    submission.scheduled transition emits Airtable event with scheduled_at.
    """
    from datetime import datetime
    from pathlib import Path

    from app.features.submissions.contracts import SubmissionState, TransitionDomainEvent
    from app.features.submissions.orchestrator import IntegrationOrchestratorService
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL;")
    db.execute("PRAGMA foreign_keys=ON;")
    schema = (Path(__file__).parent.parent / "app" / "db_schema.sql").read_text("utf-8")
    db.executescript(schema)
    orch = IntegrationOrchestratorService(connection=db)

    now = datetime.now(tz=UTC)
    sid = f"airtable-sched-{int(now.timestamp())}"
    event = TransitionDomainEvent(
        event_name="submission.state.transitioned.v1",
        event_id=f"evt:{sid}:scheduled",
        submission_id=sid,
        from_state=SubmissionState.APPROVED,
        to_state=SubmissionState.SCHEDULED,
        actor_id="system-scheduler",
        actor_role="admin",
        transition_version=3,
        occurred_at=now,
        idempotency_key=f"transition:{sid}:scheduled",
        reason=None,
        preferred_release_month="2026-08",
    )

    result = orch.consume_transition_event(event)

    emitted = result.integration_events if hasattr(result, 'integration_events') else []
    airtable_events = [e for e in emitted if e.target == "airtable"]
    assert len(airtable_events) >= 1

    evt = airtable_events[0]
    assert evt.event_name == "submission.scheduled"
    assert "scheduled_at" in evt.payload


@skip_live
def test_orchestrator_does_not_emit_airtable_event_for_submission_draft(tmp_path):
    """
    Transitioning from draft to under_review should NOT trigger an Airtable event
    (Airtable is only synced on rejection and scheduling).
    """
    from datetime import datetime
    from pathlib import Path

    from app.features.submissions.contracts import SubmissionState, TransitionDomainEvent
    from app.features.submissions.orchestrator import IntegrationOrchestratorService
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL;")
    db.execute("PRAGMA foreign_keys=ON;")
    schema = (Path(__file__).parent.parent / "app" / "db_schema.sql").read_text("utf-8")
    db.executescript(schema)
    orch = IntegrationOrchestratorService(connection=db)

    now = datetime.now(tz=UTC)
    sid = f"airtable-draft-{int(now.timestamp())}"
    event = TransitionDomainEvent(
        event_name="submission.state.transitioned.v1",
        event_id=f"evt:{sid}:under_review",
        submission_id=sid,
        from_state=SubmissionState.DRAFT,
        to_state=SubmissionState.UNDER_REVIEW,
        actor_id="creator-live",
        actor_role="creator",
        transition_version=1,
        occurred_at=now,
        idempotency_key=f"transition:{sid}:under_review",
        reason=None,
        preferred_release_month=None,
    )

    result = orch.consume_transition_event(event)
    emitted = result.integration_events if hasattr(result, 'integration_events') else []
    airtable_events = [e for e in emitted if e.target == "airtable"]
    assert len(airtable_events) == 0, (
        f"No Airtable events expected for draft→under_review, got: {airtable_events}"
    )



# ---------------------------------------------------------------------------
# Admin integration test endpoint (backend-level stub test)
# ---------------------------------------------------------------------------

@skip_live
def test_admin_integration_test_endpoint_validates_airtable():
    """
    POST /admin/integrations/airtable/test confirms the provider is recognized.
    Note: this endpoint returns deterministic health classification for operator UX.
    """
    resp = requests.post(
        f"{API_BASE}/admin/integrations/airtable/test",
        json={"actor_id": "admin-live", "actor_role": "admin"},
        timeout=10,
    )
    assert resp.status_code == 200, f"HTTP {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["provider"] == "airtable"
    assert data["status_class"] in {"healthy", "degraded", "unhealthy", "unconfigured"}
