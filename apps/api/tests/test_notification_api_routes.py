from __future__ import annotations

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


def test_notifications_list_endpoint_returns_inbox_entries() -> None:
    client = create_client()

    response = client.get(
        "/notifications",
        params={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "include_read": "true",
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert response.status_code == 200
    payload = response.json()
    notification_ids = {item["notification_id"] for item in payload["notifications"]}
    assert notification_ids == {"ntf-1", "ntf-2"}


def test_mark_read_endpoint_marks_specific_items() -> None:
    client = create_client()

    response = client.post(
        "/notifications/mark-read",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "notification_ids": ["ntf-1"],
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["updated_count"] == 1


def test_mark_read_endpoint_rejects_cross_user_notifications() -> None:
    client = create_client()

    response = client.post(
        "/notifications/mark-read",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "notification_ids": ["ntf-3"],
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "NOTIFICATION_SCOPE_FORBIDDEN"


def test_mark_all_read_endpoint_marks_remaining_unread_items() -> None:
    client = create_client()

    response = client.post(
        "/notifications/mark-all-read",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["updated_count"] == 1


def test_retry_endpoint_rejects_creator_role() -> None:
    client = create_client()

    response = client.post(
        "/notifications/retry",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "notification_id": "ntf-3",
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "NOTIFICATION_RETRY_FORBIDDEN"


def test_retry_endpoint_allows_reviewer_role() -> None:
    client = create_client()

    response = client.post(
        "/notifications/retry",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "notification_id": "ntf-3",
        },
        headers=auth_headers(actor_id="reviewer-1", actor_role="reviewer"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["notification"]["notification_id"] == "ntf-3"


def test_emit_endpoint_returns_sent_notification_for_in_app_channel() -> None:
    client = create_client()

    response = client.post(
        "/internal/notifications/emit",
        json={
            "type": "approved",
            "severity": "info",
            "channel": "in_app",
            "title": "Approved",
            "message": "Submission approved and queued.",
            "submission_id": "sub-emit-1",
        },
        headers=internal_headers(),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["notification"]["type"] == "approved"
    assert payload["notification"]["status"] == "sent"


def test_emit_endpoint_rejects_non_contract_notification_type() -> None:
    client = create_client()

    response = client.post(
        "/internal/notifications/emit",
        json={
            "type": "submission_approved",
            "severity": "info",
            "channel": "in_app",
            "title": "Approved",
            "message": "Legacy producer payload.",
            "submission_id": "sub-emit-legacy",
        },
        headers=internal_headers(),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"


def test_internal_emit_rejects_missing_service_token() -> None:
    client = create_client()

    response = client.post(
        "/internal/notifications/emit",
        json={
            "type": "approved",
            "severity": "info",
            "channel": "in_app",
            "title": "Approved",
            "message": "Submission approved and queued.",
            "submission_id": "sub-emit-token",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_notifications_mark_read_rejects_spoofed_actor_context() -> None:
    client = create_client()

    response = client.post(
        "/notifications/mark-read",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "notification_ids": ["ntf-1"],
        },
        headers=auth_headers(actor_id="reviewer-1", actor_role="reviewer"),
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"
