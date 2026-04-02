from __future__ import annotations

from fastapi.testclient import TestClient

from app.features.auth.contracts import OtpPurpose
from app.main import create_app


def _register_user(
    client: TestClient,
    email: str,
    password: str,
    roles: list[str] | None = None,
) -> dict[str, object]:
    send_otp_response = client.post(
        "/auth/otp/send",
        json={
            "target": email,
            "purpose": "register",
        },
    )
    assert send_otp_response.status_code == 200

    challenge_id = send_otp_response.json()["challenge_id"]
    otp_code = client.app.state.auth_service.debug_peek_latest_otp_code(email, OtpPurpose.REGISTER)

    verify_response = client.post(
        "/auth/otp/verify",
        json={
            "challenge_id": challenge_id,
            "purpose": "register",
            "otp_code": otp_code,
        },
    )
    assert verify_response.status_code == 200

    register_payload = {
        "email": email,
        "password": password,
        "otp_verification_token": verify_response.json()["otp_verification_token"],
    }
    if roles:
        register_payload["roles"] = roles

    register_response = client.post("/auth/register", json=register_payload)
    assert register_response.status_code == 200
    return register_response.json()


def _build_auth_header(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def test_prd01_auth_endpoints_are_registered() -> None:
    app = create_app()
    client = TestClient(app)

    openapi_response = client.get("/openapi.json")

    assert openapi_response.status_code == 200
    paths = openapi_response.json()["paths"]

    expected_paths = {
        "/auth/register",
        "/auth/otp/send",
        "/auth/otp/verify",
        "/auth/login",
        "/auth/refresh",
        "/auth/logout",
        "/auth/logout-all",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/me",
    }
    assert expected_paths.issubset(paths.keys())


def test_register_login_me_and_rbac_forbidden() -> None:
    app = create_app()
    client = TestClient(app)

    register_result = _register_user(
        client,
        email="creator@example.com",
        password="StrongPassword!123",
        roles=["creator"],
    )

    me_response = client.get(
        "/auth/me",
        headers=_build_auth_header(register_result["access_token"]),
    )
    assert me_response.status_code == 200
    assert me_response.json()["user"]["roles"] == ["creator"]

    forbidden_response = client.get(
        "/auth/me",
        headers=_build_auth_header(register_result["access_token"]),
        params={"require_any_role": "admin"},
    )
    assert forbidden_response.status_code == 403
    assert forbidden_response.json()["error"]["code"] == "AUTH_FORBIDDEN"

    login_response = client.post(
        "/auth/login",
        json={
            "email": "creator@example.com",
            "password": "StrongPassword!123",
            "device_id": "desktop-1",
        },
    )
    assert login_response.status_code == 200
    assert isinstance(login_response.json()["refresh_token"], str)


def test_refresh_rotation_detects_reuse_and_revokes_family() -> None:
    app = create_app()
    client = TestClient(app)

    register_result = _register_user(
        client,
        email="rotate@example.com",
        password="StrongPassword!123",
    )

    first_refresh_token = register_result["refresh_token"]

    first_refresh_response = client.post(
        "/auth/refresh",
        json={"refresh_token": first_refresh_token},
    )
    assert first_refresh_response.status_code == 200

    rotated_refresh_token = first_refresh_response.json()["refresh_token"]
    assert rotated_refresh_token != first_refresh_token

    reuse_response = client.post(
        "/auth/refresh",
        json={"refresh_token": first_refresh_token},
    )
    assert reuse_response.status_code == 401
    assert reuse_response.json()["error"]["code"] == "AUTH_TOKEN_REUSE"

    revoked_family_response = client.post(
        "/auth/refresh",
        json={"refresh_token": rotated_refresh_token},
    )
    assert revoked_family_response.status_code == 401
    assert revoked_family_response.json()["error"]["code"] == "AUTH_UNAUTHORIZED"


def test_forgot_reset_password_revokes_sessions() -> None:
    app = create_app()
    client = TestClient(app)

    register_result = _register_user(
        client,
        email="reset@example.com",
        password="StrongPassword!123",
    )

    second_session = client.post(
        "/auth/login",
        json={
            "email": "reset@example.com",
            "password": "StrongPassword!123",
            "device_id": "desktop-2",
        },
    )
    assert second_session.status_code == 200

    forgot_response = client.post(
        "/auth/forgot-password",
        json={"email": "reset@example.com"},
    )
    assert forgot_response.status_code == 200

    forgot_challenge_id = forgot_response.json()["challenge_id"]
    otp_code = client.app.state.auth_service.debug_peek_latest_otp_code(
        "reset@example.com",
        OtpPurpose.FORGOT_PASSWORD,
    )

    verify_response = client.post(
        "/auth/otp/verify",
        json={
            "challenge_id": forgot_challenge_id,
            "purpose": "forgot-password",
            "otp_code": otp_code,
        },
    )
    assert verify_response.status_code == 200

    reset_response = client.post(
        "/auth/reset-password",
        json={
            "email": "reset@example.com",
            "otp_verification_token": verify_response.json()["otp_verification_token"],
            "new_password": "EvenStrongerPassword!456",
        },
    )
    assert reset_response.status_code == 200
    assert reset_response.json()["revoked_session_count"] >= 2

    old_password_login = client.post(
        "/auth/login",
        json={
            "email": "reset@example.com",
            "password": "StrongPassword!123",
        },
    )
    assert old_password_login.status_code == 401

    old_refresh_response = client.post(
        "/auth/refresh",
        json={"refresh_token": register_result["refresh_token"]},
    )
    assert old_refresh_response.status_code == 401

    new_password_login = client.post(
        "/auth/login",
        json={
            "email": "reset@example.com",
            "password": "EvenStrongerPassword!456",
        },
    )
    assert new_password_login.status_code == 200


def test_forgot_password_unknown_email_uses_generic_response() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.post(
        "/auth/forgot-password",
        json={"email": "missing@example.com"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "challenge_id": None,
        "expires_at": None,
        "cooldown_seconds": 0,
    }


def test_auth_refresh_and_logout_persist_across_app_restart() -> None:
    first_app = create_app()
    first_client = TestClient(first_app)

    register_result = _register_user(
        first_client,
        email="restart-auth@example.com",
        password="StrongPassword!123",
    )

    second_app = create_app()
    second_client = TestClient(second_app)

    refresh_response = second_client.post(
        "/auth/refresh",
        json={"refresh_token": register_result["refresh_token"]},
    )
    assert refresh_response.status_code == 200

    logout_response = second_client.post(
        "/auth/logout",
        json={"refresh_token": refresh_response.json()["refresh_token"]},
    )
    assert logout_response.status_code == 200
    assert logout_response.json()["revoked_session_count"] == 1
