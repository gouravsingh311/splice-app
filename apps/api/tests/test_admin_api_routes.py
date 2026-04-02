from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.features.admin.contracts import IntegrationRecommendedAction, IntegrationStatusClass
from app.main import create_app


def create_client() -> TestClient:
    app = create_app()
    app.state.admin_config_service._test_dropbox_credentials = (  # type: ignore[method-assign]
        lambda: {
            "status_class": IntegrationStatusClass.UNCONFIGURED,
            "recommended_action": IntegrationRecommendedAction.ROTATE_CREDENTIALS,
            "status_copy": "Dropbox is not configured. Complete Dropbox OAuth setup.",
            "credential_status": "missing",
            "error_code": "DROPBOX_NOT_CONFIGURED",
            "error": "Dropbox app key, app secret, or refresh token is missing.",
            "failure_context": "Missing one or more required Dropbox credentials.",
            "latency_ms": 0,
            "account_id": None,
        }
    )
    return TestClient(app)


def test_admin_configs_requires_admin_role() -> None:
    client = create_client()
    response = client.get(
        "/admin/configs",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_admin_draft_publish_and_list_flow() -> None:
    client = create_client()
    draft_response = client.post(
        "/admin/configs/draft",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "config_type": "qc_policy",
            "payload_json": {"rules": [{"rule_id": "pack.folder.audio.required"}]},
        },
    )
    assert draft_response.status_code == 200
    draft_id = draft_response.json()["config"]["id"]
    assert draft_response.json()["config"]["is_draft"] is True
    assert draft_response.json()["config"]["version"] == 1

    publish_response = client.post(
        f"/admin/configs/{draft_id}/publish",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "reason": "Promote validated draft",
            "confirmation": "PUBLISH",
        },
    )
    assert publish_response.status_code == 200
    publish_payload = publish_response.json()
    assert publish_payload["config"]["is_draft"] is False
    assert publish_payload["config"]["version"] == 2
    assert publish_payload["config"]["published_by"] == "admin-1"

    list_response = client.get(
        "/admin/configs",
        params={"actor_id": "admin-1", "actor_role": "admin"},
    )
    assert list_response.status_code == 200
    configs = list_response.json()["configs"]
    assert len(configs) >= 1
    assert any(item["id"] == draft_id for item in configs)


def test_admin_qc_policy_routes_delegate_and_enforce_admin() -> None:
    client = create_client()
    forbidden_response = client.get(
        "/admin/qc/policy",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert forbidden_response.status_code == 403

    allowed_response = client.get(
        "/admin/qc/policy",
        params={"actor_id": "admin-1", "actor_role": "admin"},
    )
    assert allowed_response.status_code == 200
    assert allowed_response.json()["policy"]["policy_id"] == "default-wave2-policy"


def test_admin_integration_test_returns_status_payload() -> None:
    client = create_client()
    response = client.post(
        "/admin/integrations/dropbox/test",
        json={"actor_id": "admin-1", "actor_role": "admin"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "dropbox"
    assert payload["ok"] is False
    assert payload["status_class"] in {"unconfigured", "unavailable"}
    assert payload["recommended_action"] in {
        "rotate_credentials",
        "check_connectivity",
        "verify_provider_configuration",
    }
    assert isinstance(payload["latency_ms"], int)
    assert payload["error_code"] in {
        "DROPBOX_NOT_CONFIGURED",
        "DROPBOX_CONNECTIVITY_ERROR",
        None,
    }


def test_admin_publish_requires_explicit_confirmation() -> None:
    client = create_client()
    draft_response = client.post(
        "/admin/configs/draft",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "config_type": "qc_policy",
            "payload_json": {"rules": []},
        },
    )
    draft_id = draft_response.json()["config"]["id"]

    publish_response = client.post(
        f"/admin/configs/{draft_id}/publish",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "reason": "test",
            "confirmation": "wrong",
        },
    )
    assert publish_response.status_code == 422
    assert publish_response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_integration_rotate_health_and_history_flow() -> None:
    client = create_client()

    rotate = client.post(
        "/admin/integrations/dropbox/rotate",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "reason": "Credential rollover",
            "confirmation": "ROTATE",
            "key_ref": "dropbox-key-v2",
        },
    )
    assert rotate.status_code == 200
    assert rotate.json()["provider"] == "dropbox"

    health = client.get(
        "/admin/integrations/health",
        params={"actor_id": "admin-1", "actor_role": "admin"},
    )
    assert health.status_code == 200
    dropbox = next(
        item for item in health.json()["integrations"] if item["provider"] == "dropbox"
    )
    assert dropbox["status_class"] in {"unconfigured", "unavailable"}
    assert dropbox["recommended_action"] in {
        "rotate_credentials",
        "check_connectivity",
        "verify_provider_configuration",
    }

    history = client.get(
        "/admin/ops/history",
        params={"actor_id": "admin-1", "actor_role": "admin", "limit": 10},
    )
    assert history.status_code == 200
    assert any(
        item["action"] == "admin.integration.credentials.rotated"
        for item in history.json()["entries"]
    )


def test_dropbox_readiness_returns_not_configured_without_credentials() -> None:
    client = create_client()
    response = client.get(
        "/admin/integrations/dropbox/readiness",
        params={"actor_id": "admin-1", "actor_role": "admin"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "dropbox"
    assert payload["status"] == "NOT_CONFIGURED"


def test_dropbox_oauth_start_and_complete_flow_persists_credentials() -> None:
    client = create_client()
    service = client.app.state.admin_config_service
    service._exchange_dropbox_auth_code = lambda **_kwargs: {  # type: ignore[method-assign]
        "refresh_token": "refresh-token-1",
        "access_token": "access-token-1",
        "token_type": "bearer",
        "scope": "files.content.write",
        "account_id": "dbid:123",
    }
    service._test_dropbox_credentials = lambda: {  # type: ignore[method-assign]
        "status_class": IntegrationStatusClass.HEALTHY,
        "recommended_action": IntegrationRecommendedAction.NONE,
        "status_copy": "Dropbox connection check passed.",
        "credential_status": "configured",
        "error_code": None,
        "error": None,
        "failure_context": None,
        "latency_ms": 1,
        "account_id": "dbid:123",
    }

    start = client.post(
        "/admin/integrations/dropbox/oauth/start",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "app_key": "app-key-1",
        },
    )
    assert start.status_code == 200
    assert "dropbox.com/oauth2/authorize" in start.json()["authorize_url"]

    complete = client.post(
        "/admin/integrations/dropbox/oauth/complete",
        json={
            "actor_id": "admin-1",
            "actor_role": "admin",
            "auth_code": "code-1",
            "app_key": "app-key-1",
            "app_secret": "app-secret-1",
        },
    )
    assert complete.status_code == 200
    assert complete.json()["provider"] == "dropbox"
    assert complete.json()["status"] in {"configured", "unavailable"}
    row = service._connection.execute(
        "SELECT credentials_json FROM integration_credentials WHERE provider = 'dropbox'"
    ).fetchone()
    assert row is not None
    credentials = json.loads(str(row["credentials_json"] or "{}"))
    assert credentials.get("refresh_token") == "refresh-token-1"
