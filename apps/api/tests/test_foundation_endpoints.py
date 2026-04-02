from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_health_live_endpoint() -> None:
    client = TestClient(app)

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "service": "splice-api",
        "status": "live",
        "environment": "local",
    }


def test_health_ready_endpoint() -> None:
    client = TestClient(app)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "service": "splice-api",
        "status": "ready",
        "environment": "local",
    }


def test_version_endpoint() -> None:
    client = TestClient(app)

    response = client.get("/version")

    assert response.status_code == 200
    assert response.json() == {
        "service": "splice-api",
        "version": "0.1.0",
        "environment": "local",
    }

