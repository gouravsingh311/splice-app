"""FastAPI router wiring for PRD-01 auth and RBAC endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.logging import get_logger
from app.features.auth.contracts import (
    ForgotPasswordRequest,
    LoginRequest,
    LogoutAllRequest,
    LogoutRequest,
    MeResponse,
    OtpSendRequest,
    OtpSendResponse,
    OtpVerifyRequest,
    OtpVerifyResponse,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    RevocationResponse,
    RoleCode,
    TokenBundleResponse,
)
from app.features.auth.service import AuthError, AuthService

http_bearer = HTTPBearer(auto_error=False)
logger = get_logger(__name__)


def _extract_bearer_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise AuthError("AUTH_UNAUTHORIZED", 401, "Access token is required")
    return credentials.credentials


def create_auth_router(auth_service: AuthService) -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.post("/register", response_model=TokenBundleResponse)
    def register(payload: RegisterRequest) -> TokenBundleResponse:
        logger.info("Register request received.", extra={"email": payload.email})
        return auth_service.register(payload)

    @router.post("/otp/send", response_model=OtpSendResponse)
    def send_otp(payload: OtpSendRequest) -> OtpSendResponse:
        logger.info(
            "OTP send request received.",
            extra={"target": payload.target, "purpose": payload.purpose.value},
        )
        return auth_service.send_otp(payload)

    @router.post("/otp/verify", response_model=OtpVerifyResponse)
    def verify_otp(payload: OtpVerifyRequest) -> OtpVerifyResponse:
        logger.info(
            "OTP verify request received.",
            extra={"challenge_id": payload.challenge_id, "purpose": payload.purpose.value},
        )
        return auth_service.verify_otp(payload)

    @router.post("/login", response_model=TokenBundleResponse)
    def login(payload: LoginRequest) -> TokenBundleResponse:
        logger.info("Login request received.", extra={"email": payload.email})
        return auth_service.login(payload)

    @router.post("/refresh", response_model=TokenBundleResponse)
    def refresh(payload: RefreshRequest) -> TokenBundleResponse:
        logger.info("Token refresh request received.")
        return auth_service.refresh(payload)

    @router.post("/logout", response_model=RevocationResponse)
    def logout(payload: LogoutRequest) -> RevocationResponse:
        logger.info("Logout request received.")
        return auth_service.logout(payload.refresh_token)

    @router.post("/logout-all", response_model=RevocationResponse)
    def logout_all(payload: LogoutAllRequest) -> RevocationResponse:
        logger.info("Logout-all request received.")
        return auth_service.logout_all(payload.access_token)

    @router.post("/forgot-password", response_model=OtpSendResponse)
    def forgot_password(payload: ForgotPasswordRequest) -> OtpSendResponse:
        logger.info("Forgot-password request received.", extra={"email": payload.email})
        return auth_service.forgot_password(payload)

    @router.post("/reset-password", response_model=RevocationResponse)
    def reset_password(payload: ResetPasswordRequest) -> RevocationResponse:
        logger.info("Reset-password request received.", extra={"email": payload.email})
        return auth_service.reset_password(payload)

    @router.get("/me", response_model=MeResponse)
    def me(
        require_any_role: list[RoleCode] | None = Query(default=None),
        credentials: HTTPAuthorizationCredentials | None = Depends(http_bearer),
    ) -> MeResponse:
        logger.info("Auth me request received.")
        access_token = _extract_bearer_token(credentials)
        return auth_service.me(access_token=access_token, require_any_role=require_any_role)

    return router
