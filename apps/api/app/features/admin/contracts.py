"""Contracts for PRD-14 admin configuration and operations routes."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.features.qc.contracts import QcActorRole

ALLOWED_INTEGRATION_PROVIDERS = frozenset({"dropbox", "airtable", "smtp"})


class IntegrationStatusClass(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNCONFIGURED = "unconfigured"
    UNAVAILABLE = "unavailable"


class IntegrationRecommendedAction(StrEnum):
    NONE = "none"
    RUN_CONNECTION_TEST = "run_connection_test"
    ROTATE_CREDENTIALS = "rotate_credentials"
    VERIFY_PROVIDER_CONFIGURATION = "verify_provider_configuration"


class DropboxReadinessStatus(StrEnum):
    READY = "READY"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    INVALID_TOKEN = "INVALID_TOKEN"


class AdminActorRequest(BaseModel):
    actor_id: str = Field(min_length=1)
    actor_role: QcActorRole

    model_config = ConfigDict(extra="forbid")


class ListAdminConfigsRequest(AdminActorRequest):
    include_drafts: bool = False

    model_config = ConfigDict(extra="forbid")


class CreateAdminConfigDraftRequest(AdminActorRequest):
    config_type: str = Field(min_length=1)
    payload_json: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")

    @field_validator("config_type")
    @classmethod
    def normalize_config_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("config_type must not be empty")
        return normalized


class PublishAdminConfigRequest(AdminActorRequest):
    reason: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason", "confirmation")
    @classmethod
    def normalize_required_strings(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized


class RollbackAdminConfigRequest(AdminActorRequest):
    reason: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason", "confirmation")
    @classmethod
    def normalize_required_strings(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized


class TestIntegrationRequest(AdminActorRequest):
    key_ref: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("key_ref")
    @classmethod
    def normalize_key_ref(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ConfigureAirtableIntegrationRequest(AdminActorRequest):
    api_key: str = Field(min_length=1)
    submissions_table: str | None = None
    completion_view: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("api_key")
    @classmethod
    def normalize_api_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("api_key must not be blank")
        return normalized

    @field_validator("submissions_table", "completion_view")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ConfigureSmtpIntegrationRequest(AdminActorRequest):
    host: str = Field(min_length=1)
    port: int = Field(ge=1, le=65535)
    username: str | None = None
    password: str | None = None
    from_email: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("host")
    @classmethod
    def normalize_host(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("host must not be blank")
        return normalized

    @field_validator("username", "password", "from_email")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ConfigureDropboxTokensRequest(AdminActorRequest):
    refresh_token: str = Field(min_length=1)
    access_token: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("refresh_token")
    @classmethod
    def normalize_refresh_token(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("refresh_token must not be blank")
        return normalized

    @field_validator("access_token")
    @classmethod
    def normalize_access_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ConfigureDropboxAppRequest(AdminActorRequest):
    app_key: str = Field(min_length=1)
    app_secret: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @field_validator("app_key", "app_secret")
    @classmethod
    def normalize_required_fields(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized


class RotateIntegrationRequest(AdminActorRequest):
    reason: str = Field(min_length=1)
    confirmation: str = Field(min_length=1)
    key_ref: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason", "confirmation")
    @classmethod
    def normalize_required_strings(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized

    @field_validator("key_ref")
    @classmethod
    def normalize_key_ref(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ListAdminOpsHistoryRequest(AdminActorRequest):
    limit: int = Field(default=20, ge=1, le=100)

    model_config = ConfigDict(extra="forbid")


class AdminConfigRecord(BaseModel):
    id: str = Field(min_length=1)
    config_type: str = Field(min_length=1)
    version: int = Field(ge=1)
    payload_json: dict[str, Any] = Field(default_factory=dict)
    published_by: str | None = None
    published_at: datetime | None = None
    is_draft: bool = True
    created_at: datetime

    model_config = ConfigDict(extra="forbid")


class AdminConfigsListResponse(BaseModel):
    configs: list[AdminConfigRecord] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class AdminConfigMutationResponse(BaseModel):
    config: AdminConfigRecord

    model_config = ConfigDict(extra="forbid")


class IntegrationTestResult(BaseModel):
    provider: str = Field(min_length=1)
    ok: bool
    latency_ms: int = Field(ge=0)
    status_class: IntegrationStatusClass
    recommended_action: IntegrationRecommendedAction
    status_copy: str = Field(min_length=1)
    credential_status: str = Field(min_length=1)
    error_code: str | None = None
    last_checked_at: datetime
    last_rotated_at: datetime | None = None
    last_failure_context: str | None = None
    error: str | None = None

    model_config = ConfigDict(extra="forbid")


class IntegrationHealthResponse(BaseModel):
    integrations: list[IntegrationTestResult] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class IntegrationConfigureResponse(BaseModel):
    provider: str = Field(min_length=1)
    status: str = Field(min_length=1)
    configured_at: datetime

    model_config = ConfigDict(extra="forbid")


class IntegrationRotateResult(BaseModel):
    provider: str = Field(min_length=1)
    status: str = Field(min_length=1)
    rotated_at: datetime
    key_ref: str

    model_config = ConfigDict(extra="forbid")


class DropboxReadinessResponse(BaseModel):
    provider: str = Field(min_length=1)
    status: DropboxReadinessStatus
    message: str = Field(min_length=1)
    has_app_credentials: bool = False
    authorize_url: str | None = None

    model_config = ConfigDict(extra="forbid")


class DropboxOauthStartRequest(AdminActorRequest):
    app_key: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("app_key")
    @classmethod
    def normalize_optional_app_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DropboxOauthStartResponse(BaseModel):
    provider: str = Field(min_length=1)
    authorize_url: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class DropboxOauthCompleteRequest(AdminActorRequest):
    auth_code: str = Field(min_length=1)
    app_key: str | None = None
    app_secret: str | None = None
    redirect_uri: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("auth_code")
    @classmethod
    def normalize_auth_code(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("auth_code must not be blank")
        return normalized

    @field_validator("app_key", "app_secret", "redirect_uri")
    @classmethod
    def normalize_optional_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DropboxOauthCompleteResponse(BaseModel):
    provider: str = Field(min_length=1)
    status: str = Field(min_length=1)
    account_id: str | None = None
    configured_at: datetime

    model_config = ConfigDict(extra="forbid")


class AdminOpsHistoryEntry(BaseModel):
    id: str = Field(min_length=1)
    action: str = Field(min_length=1)
    actor_id: str | None = None
    reason: str | None = None
    entity: str = Field(min_length=1)
    timestamp: datetime

    model_config = ConfigDict(extra="forbid")


class AdminOpsHistoryResponse(BaseModel):
    entries: list[AdminOpsHistoryEntry] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")
