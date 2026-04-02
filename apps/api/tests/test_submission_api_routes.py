from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import create_app


def create_client() -> TestClient:
    return TestClient(create_app())


def auth_headers(*, actor_id: str, actor_role: str) -> dict[str, str]:
    return {
        "X-Actor-Id": actor_id,
        "X-Actor-Role": actor_role,
    }


def internal_headers() -> dict[str, str]:
    return {
        "X-Internal-Token": "test-internal-token",
    }


def create_draft(client: TestClient, submission_id: str) -> None:
    response = client.post(
        "/submissions/draft",
        json={
            "submission_id": submission_id,
            "creator_id": "creator-1",
            "preferred_release_month": "2026-04",
            "metadata": {"genre": "house"},
        },
    )
    assert response.status_code == 200
    assert response.json()["submission"]["current_state"] == "draft"


def seed_creator_submit_gate_ready(client: TestClient, submission_id: str) -> None:
    now = datetime.now(tz=UTC).isoformat()
    connection = client.app.state.submission_workflow_service._connection
    connection.execute(
        """
        INSERT INTO submission_metadata (
            submission_id,
            creator_id,
            pack_name,
            release_month,
            notes,
            tags_json,
            airtable_form_completed,
            airtable_payload_checksum,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          airtable_form_completed = excluded.airtable_form_completed,
          updated_at = excluded.updated_at
        """,
        (
            submission_id,
            "creator-1",
            "Pack",
            "2026-04",
            None,
            "[]",
            1,
            "checksum-1",
            now,
            now,
        ),
    )
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


def test_submission_lifecycle_route_emits_orchestration_events() -> None:
    client = create_client()
    create_draft(client, "sub-api-1")
    seed_creator_submit_gate_ready(client, "sub-api-1")

    under_review = client.post(
        "/submissions/sub-api-1/transition",
        json={
            "request_id": "req-1",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert under_review.status_code == 200
    assert under_review.json()["orchestration"]["integration_events"] == []

    approved = client.post(
        "/submissions/sub-api-1/transition",
        json={
            "request_id": "req-2",
            "to_state": "approved",
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "expected_version": 1,
        },
        headers=auth_headers(actor_id="reviewer-1", actor_role="reviewer"),
    )
    assert approved.status_code == 200
    payload = approved.json()
    assert payload["orchestration"]["integration_events"][1]["event_name"] == (
        "submission.approved.scheduling.v1"
    )
    assert payload["orchestration"]["integration_events"][1]["payload"]["schema_version"] == 1

    transitions = client.get("/submissions/sub-api-1/transitions")
    assert transitions.status_code == 200
    assert len(transitions.json()) == 2

    integrations = client.get("/submissions/sub-api-1/integrations")
    assert integrations.status_code == 200
    assert len(integrations.json()) == 3


def test_transition_forbidden_path_returns_deterministic_error() -> None:
    client = create_client()
    create_draft(client, "sub-api-2")
    seed_creator_submit_gate_ready(client, "sub-api-2")

    move_under_review = client.post(
        "/submissions/sub-api-2/transition",
        json={
            "request_id": "req-1",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert move_under_review.status_code == 200

    forbidden = client.post(
        "/submissions/sub-api-2/transition",
        json={
            "request_id": "req-2",
            "to_state": "approved",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 1,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "TRANSITION_FORBIDDEN"


def test_dispatch_endpoint_consumes_transition_event_contract() -> None:
    client = create_client()
    dispatch = client.post(
        "/internal/integrations/dispatch",
        json={
            "transition_event": {
                "event_name": "submission.state.transitioned.v1",
                "event_id": "evt:sub-900:2",
                "submission_id": "sub-900",
                "from_state": "under_review",
                "to_state": "approved",
                "actor_id": "reviewer-1",
                "actor_role": "reviewer",
                "transition_version": 2,
                "occurred_at": "2026-02-25T12:00:00Z",
                "idempotency_key": "submission.transition:sub-900:2:approved",
                "preferred_release_month": "2026-09",
            }
        },
        headers=internal_headers(),
    )
    assert dispatch.status_code == 202
    assert (
        dispatch.json()["integration_events"][1]["event_name"]
        == "submission.approved.scheduling.v1"
    )


def test_invalid_transition_payload_returns_contract_error_code() -> None:
    client = create_client()
    create_draft(client, "sub-api-3")

    invalid_payload_response = client.post(
        "/submissions/sub-api-3/transition",
        json={
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert invalid_payload_response.status_code == 422
    payload = invalid_payload_response.json()
    assert payload["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"


def test_transition_to_under_review_requires_airtable_completion_and_linked_status() -> None:
    client = create_client()
    create_draft(client, "sub-api-gate-1")
    now = datetime.now(tz=UTC).isoformat()
    connection = client.app.state.submission_workflow_service._connection
    connection.execute(
        """
        INSERT INTO submission_metadata (
            submission_id,
            creator_id,
            pack_name,
            release_month,
            notes,
            tags_json,
            airtable_form_completed,
            airtable_payload_checksum,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "sub-api-gate-1",
            "creator-1",
            "Pack",
            "2026-04",
            None,
            "[]",
            0,
            None,
            now,
            now,
        ),
    )
    connection.commit()

    blocked = client.post(
        "/submissions/sub-api-gate-1/transition",
        json={
            "request_id": "req-gate-1",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert blocked.status_code == 409
    payload = blocked.json()
    assert payload["error"]["code"] == "TRANSITION_NOT_ALLOWED"
    assert payload["error"]["details"]["actual_gates"]["airtable_form_completed"] is False
    assert payload["error"]["details"]["actual_gates"]["airtable_sync_status"] is None


def test_transition_rejects_spoofed_actor_context() -> None:
    client = create_client()
    create_draft(client, "sub-api-spoof-1")
    seed_creator_submit_gate_ready(client, "sub-api-spoof-1")

    spoofed = client.post(
        "/submissions/sub-api-spoof-1/transition",
        json={
            "request_id": "req-spoof-1",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="reviewer-9", actor_role="reviewer"),
    )

    assert spoofed.status_code == 403
    assert spoofed.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_internal_dispatch_rejects_missing_service_token() -> None:
    client = create_client()
    response = client.post(
        "/internal/integrations/dispatch",
        json={
            "transition_event": {
                "event_name": "submission.state.transitioned.v1",
                "event_id": "evt:sub-901:2",
                "submission_id": "sub-901",
                "from_state": "under_review",
                "to_state": "approved",
                "actor_id": "reviewer-1",
                "actor_role": "reviewer",
                "transition_version": 2,
                "occurred_at": "2026-02-25T12:00:00Z",
                "idempotency_key": "submission.transition:sub-901:2:approved",
                "preferred_release_month": "2026-09",
            }
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
