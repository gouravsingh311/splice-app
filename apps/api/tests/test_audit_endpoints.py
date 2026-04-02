from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def create_client() -> TestClient:
    app = create_app()
    return TestClient(app)


def append_sample_event(
    client: TestClient,
    *,
    action: str = "desktop.ipc.denied.v1",
    entity_id: str = "splice.audit.security-events.list.v1",
    actor_id: str = "reviewer-1",
    idempotency_key: str | None = None,
) -> dict:
    payload = {
        "schema_version": 1,
        "actor_id": actor_id,
        "action": action,
        "entity_type": "desktop",
        "entity_id": entity_id,
        "metadata": {"channel": entity_id, "reason": "ROLE_FORBIDDEN"},
    }
    if idempotency_key:
        payload["idempotency_key"] = idempotency_key

    response = client.post("/internal/audit/append", json=payload)
    assert response.status_code == 200
    return response.json()


def test_append_and_get_event_with_hash_chain() -> None:
    client = create_client()

    first = append_sample_event(client, action="desktop.ipc.allowed.v1")
    second = append_sample_event(client, action="desktop.ipc.denied.v1")

    assert first["prev_hash"] is not None
    assert first["envelope"]["resource"] == "audit.event.v1"
    assert first["envelope"]["schema_version"] == 1
    assert second["prev_hash"] == first["event_hash"]
    assert second["envelope"]["resource"] == "audit.event.v1"

    get_response = client.get(f"/audit/events/{second['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["event_hash"] == second["event_hash"]
    assert get_response.json()["envelope"]["resource"] == "audit.event.v1"


def test_append_idempotency_key_returns_existing_event() -> None:
    client = create_client()

    first = append_sample_event(client, idempotency_key="event-1")
    second = append_sample_event(client, idempotency_key="event-1")

    assert first["id"] == second["id"]


def test_list_events_supports_filters() -> None:
    client = create_client()

    append_sample_event(client, action="desktop.ipc.allowed.v1", actor_id="admin-1")
    append_sample_event(client, action="desktop.ipc.denied.v1", actor_id="admin-1")
    append_sample_event(client, action="desktop.ipc.denied.v1", actor_id="reviewer-1")

    response = client.get(
        "/audit/events",
        params={"actor_id": "admin-1", "action": "desktop.ipc.denied.v1", "limit": 10},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["events"][0]["action"] == "desktop.ipc.denied.v1"
    assert payload["events"][0]["actor_id"] == "admin-1"
    assert payload["envelope"]["resource"] == "audit.events.list.v1"
    assert payload["envelope"]["schema_version"] == 1


def test_export_supports_json_and_csv() -> None:
    client = create_client()
    append_sample_event(client, action="desktop.ipc.denied.v1")

    json_response = client.get("/audit/export", params={"format": "json"})
    assert json_response.status_code == 200
    json_payload = json_response.json()
    assert json_payload["format"] == "json"
    assert '"events"' in json_payload["content"]
    assert json_payload["envelope"]["resource"] == "audit.events.export.v1"
    assert json_payload["envelope"]["schema_version"] == 1

    csv_response = client.get("/audit/export", params={"format": "csv"})
    assert csv_response.status_code == 200
    csv_payload = csv_response.json()
    assert csv_payload["format"] == "csv"
    assert "event_hash" in csv_payload["content"]
    assert csv_payload["envelope"]["resource"] == "audit.events.export.v1"


def test_append_rejects_unknown_action() -> None:
    client = create_client()
    response = client.post(
        "/internal/audit/append",
        json={
            "schema_version": 1,
            "actor_id": "admin-1",
            "action": "desktop.ipc.unknown.v1",
            "entity_type": "desktop",
            "entity_id": "channel-1",
        },
    )

    assert response.status_code == 422


def test_get_event_returns_404_for_missing_event() -> None:
    client = create_client()
    response = client.get("/audit/events/7cf6f095-b1eb-4a7f-abf4-f1ce6f6eddbe")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "AUDIT_EVENT_NOT_FOUND"
    assert body["error"]["details"]["event_id"] == "7cf6f095-b1eb-4a7f-abf4-f1ce6f6eddbe"


def test_list_rejects_inverted_time_window_with_deterministic_error_envelope() -> None:
    client = create_client()
    response = client.get(
        "/audit/events",
        params={
            "from": "2026-03-03T01:00:00Z",
            "to": "2026-03-02T01:00:00Z",
        },
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "AUDIT_INVALID_TIME_WINDOW"
    assert body["error"]["details"]["from"] == "2026-03-03T01:00:00+00:00"
    assert body["error"]["details"]["to"] == "2026-03-02T01:00:00+00:00"


def test_export_rejects_inverted_time_window_with_deterministic_error_envelope() -> None:
    client = create_client()
    response = client.get(
        "/audit/export",
        params={
            "format": "json",
            "from": "2026-03-03T01:00:00Z",
            "to": "2026-03-02T01:00:00Z",
        },
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "AUDIT_INVALID_TIME_WINDOW"
