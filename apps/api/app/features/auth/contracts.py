"""Pydantic request/response contracts for PRD-01 auth endpoints."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RoleCode = Literal["creator", "reviewer", "admin"]


class OtpPurpose(StrEnum):
    REGISTER = "register"
    FORGOT_PASSWORD = "forgot-password"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OtpSendRequest(StrictModel):
    target: str = Field(min_length=3)
    purpose: OtpPurpose


class OtpSendResponse(StrictModel):
    challenge_id: str | None
    expires_at: datetime | None
    cooldown_seconds: int = Field(ge=0)


class OtpVerifyRequest(StrictModel):
    challenge_id: str = Field(min_length=1)
    purpose: OtpPurpose
    otp_code: str = Field(min_length=4, max_length=8)


class OtpVerifyResponse(StrictModel):
    otp_verification_token: str
    expires_at: datetime


class RegisterRequest(StrictModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=12)
    otp_verification_token: str = Field(min_length=1)
    roles: list[RoleCode] | None = None
    device_id: str | None = None


class LoginRequest(StrictModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)
    device_id: str | None = None


class RefreshRequest(StrictModel):
    refresh_token: str = Field(min_length=1)
    device_id: str | None = None


class LogoutRequest(StrictModel):
    refresh_token: str = Field(min_length=1)


class LogoutAllRequest(StrictModel):
    access_token: str = Field(min_length=1)


class ForgotPasswordRequest(StrictModel):
    email: str = Field(min_length=3)


class ResetPasswordRequest(StrictModel):
    email: str = Field(min_length=3)
    otp_verification_token: str = Field(min_length=1)
    new_password: str = Field(min_length=12)


class UserResponse(StrictModel):
    id: str
    email: str
    roles: list[RoleCode]
    permissions: list[str]
    status: str
    created_at: datetime
    updated_at: datetime


class TokenBundleResponse(StrictModel):
    access_token: str
    access_token_expires_at: datetime
    refresh_token: str
    refresh_token_expires_at: datetime
    user: UserResponse


class RevocationResponse(StrictModel):
    revoked_session_count: int = Field(ge=0)


class MeResponse(StrictModel):
    user: UserResponse


class ErrorDetail(StrictModel):
    code: str
    message: str
    status: int


class ErrorEnvelope(StrictModel):
    error: ErrorDetail
