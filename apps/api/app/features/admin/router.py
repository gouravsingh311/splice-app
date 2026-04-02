"""PRD-14 admin routes for configs, integrations, and QC policy operations."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.admin.contracts import (
    AdminConfigMutationResponse,
    AdminConfigsListResponse,
    AdminOpsHistoryResponse,
    ConfigureAirtableIntegrationRequest,
    ConfigureDropboxAppRequest,
    ConfigureDropboxTokensRequest,
    ConfigureSmtpIntegrationRequest,
    CreateAdminConfigDraftRequest,
    DropboxOauthCompleteRequest,
    DropboxOauthCompleteResponse,
    DropboxOauthStartRequest,
    DropboxOauthStartResponse,
    DropboxReadinessResponse,
    IntegrationConfigureResponse,
    IntegrationHealthResponse,
    IntegrationRotateResult,
    IntegrationTestResult,
    ListAdminConfigsRequest,
    ListAdminOpsHistoryRequest,
    PublishAdminConfigRequest,
    RollbackAdminConfigRequest,
    RotateIntegrationRequest,
    TestIntegrationRequest,
)
from app.features.admin.qc_policy import AdminQcPolicyService
from app.features.admin.service import AdminConfigService
from app.features.qc.contracts import (
    GetActiveQcPolicyResponse,
    UpdateActiveQcPolicyRequest,
    UpdateActiveQcPolicyResponse,
)

router = APIRouter(tags=["admin"])
logger = get_logger(__name__)


def get_admin_config_service(request: Request) -> AdminConfigService:
    return request.app.state.admin_config_service


def get_admin_policy_service(request: Request) -> AdminQcPolicyService:
    return request.app.state.admin_qc_policy_service


@router.get("/configs", response_model=AdminConfigsListResponse)
async def list_admin_configs(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: str = Query(min_length=1),
    include_drafts: bool = Query(default=False),
) -> AdminConfigsListResponse:
    logger.info(
        "Listing admin configs.",
        extra={"actor_id": actor_id, "actor_role": actor_role, "include_drafts": include_drafts},
    )
    payload = ListAdminConfigsRequest(
        actor_id=actor_id,
        actor_role=actor_role,
        include_drafts=include_drafts,
    )
    return get_admin_config_service(request).list_configs(payload)


@router.post("/configs/draft", response_model=AdminConfigMutationResponse)
async def create_admin_config_draft(
    payload: CreateAdminConfigDraftRequest,
    request: Request,
) -> AdminConfigMutationResponse:
    logger.info(
        "Creating admin config draft.",
        extra={"config_type": payload.config_type, "actor_id": payload.actor_id},
    )
    return get_admin_config_service(request).create_draft(payload)


@router.post("/configs/{config_id}/publish", response_model=AdminConfigMutationResponse)
async def publish_admin_config(
    config_id: str,
    payload: PublishAdminConfigRequest,
    request: Request,
) -> AdminConfigMutationResponse:
    logger.info(
        "Publishing admin config.",
        extra={"config_id": config_id, "actor_id": payload.actor_id},
    )
    return get_admin_config_service(request).publish_config(config_id=config_id, request=payload)


@router.post("/configs/{config_id}/rollback", response_model=AdminConfigMutationResponse)
async def rollback_admin_config(
    config_id: str,
    payload: RollbackAdminConfigRequest,
    request: Request,
) -> AdminConfigMutationResponse:
    logger.info(
        "Rolling back admin config.",
        extra={"config_id": config_id, "actor_id": payload.actor_id},
    )
    return get_admin_config_service(request).rollback_config(config_id=config_id, request=payload)


@router.post("/integrations/{provider}/test", response_model=IntegrationTestResult)
async def test_admin_integration(
    provider: str,
    payload: TestIntegrationRequest,
    request: Request,
) -> IntegrationTestResult:
    logger.info(
        "Testing admin integration.",
        extra={"provider": provider, "actor_id": payload.actor_id},
    )
    result = get_admin_config_service(request).test_integration(
        provider=provider,
        request=payload,
    )
    return result


@router.post("/integrations/airtable/configure", response_model=IntegrationConfigureResponse)
async def configure_airtable_integration(
    payload: ConfigureAirtableIntegrationRequest,
    request: Request,
) -> IntegrationConfigureResponse:
    logger.info("Configuring Airtable integration.", extra={"actor_id": payload.actor_id})
    return get_admin_config_service(request).configure_airtable_integration(payload)


@router.post("/integrations/smtp/configure", response_model=IntegrationConfigureResponse)
async def configure_smtp_integration(
    payload: ConfigureSmtpIntegrationRequest,
    request: Request,
) -> IntegrationConfigureResponse:
    logger.info("Configuring SMTP integration.", extra={"actor_id": payload.actor_id})
    return get_admin_config_service(request).configure_smtp_integration(payload)


@router.post("/integrations/dropbox/tokens", response_model=IntegrationConfigureResponse)
async def configure_dropbox_tokens(
    payload: ConfigureDropboxTokensRequest,
    request: Request,
) -> IntegrationConfigureResponse:
    logger.info("Updating Dropbox token credentials.", extra={"actor_id": payload.actor_id})
    return get_admin_config_service(request).configure_dropbox_tokens(payload)


@router.post("/integrations/dropbox/app-config", response_model=IntegrationConfigureResponse)
async def configure_dropbox_app_credentials(
    payload: ConfigureDropboxAppRequest,
    request: Request,
) -> IntegrationConfigureResponse:
    logger.info("Updating Dropbox app credentials.", extra={"actor_id": payload.actor_id})
    return get_admin_config_service(request).configure_dropbox_app_credentials(payload)


@router.get("/integrations/health", response_model=IntegrationHealthResponse)
async def list_admin_integration_health(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: str = Query(min_length=1),
) -> IntegrationHealthResponse:
    payload = TestIntegrationRequest(actor_id=actor_id, actor_role=actor_role)
    return get_admin_config_service(request).list_integration_health(payload)


@router.post("/integrations/{provider}/rotate", response_model=IntegrationRotateResult)
async def rotate_admin_integration_credentials(
    provider: str,
    payload: RotateIntegrationRequest,
    request: Request,
) -> IntegrationRotateResult:
    logger.info(
        "Rotating admin integration credentials.",
        extra={"provider": provider, "actor_id": payload.actor_id},
    )
    return get_admin_config_service(request).rotate_integration_credentials(
        provider=provider,
        request=payload,
    )


@router.get("/integrations/dropbox/readiness", response_model=DropboxReadinessResponse)
async def get_dropbox_readiness(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: str = Query(min_length=1),
) -> DropboxReadinessResponse:
    payload = TestIntegrationRequest(actor_id=actor_id, actor_role=actor_role)
    return get_admin_config_service(request).get_dropbox_readiness(payload)


@router.post("/integrations/dropbox/oauth/start", response_model=DropboxOauthStartResponse)
async def start_dropbox_oauth(
    payload: DropboxOauthStartRequest, request: Request
) -> DropboxOauthStartResponse:
    logger.info("Starting Dropbox OAuth setup.", extra={"actor_id": payload.actor_id})
    return get_admin_config_service(request).start_dropbox_oauth(payload)


@router.post("/integrations/dropbox/oauth/complete", response_model=DropboxOauthCompleteResponse)
async def complete_dropbox_oauth(
    payload: DropboxOauthCompleteRequest, request: Request
) -> DropboxOauthCompleteResponse:
    logger.info("Completing Dropbox OAuth setup.", extra={"actor_id": payload.actor_id})
    return get_admin_config_service(request).complete_dropbox_oauth(payload)


@router.get("/ops/history", response_model=AdminOpsHistoryResponse)
async def list_admin_ops_history(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> AdminOpsHistoryResponse:
    payload = ListAdminOpsHistoryRequest(actor_id=actor_id, actor_role=actor_role, limit=limit)
    return get_admin_config_service(request).list_ops_history(payload)


@router.get("/qc/policy", response_model=GetActiveQcPolicyResponse)
async def get_active_qc_policy(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: str = Query(min_length=1),
) -> GetActiveQcPolicyResponse:
    if actor_role != "admin":
        raise DomainError(
            code="AUTH_FORBIDDEN",
            message="Only admin role can access admin operations.",
            status_code=403,
            details={"actor_id": actor_id, "actor_role": actor_role},
        )
    return get_admin_policy_service(request).get_active_policy()


@router.post("/qc/policy", response_model=UpdateActiveQcPolicyResponse)
async def update_active_qc_policy(
    payload: UpdateActiveQcPolicyRequest, request: Request
) -> UpdateActiveQcPolicyResponse:
    logger.info(
        "Updating admin QC policy.",
        extra={"actor_id": payload.actor_id, "policy_id": payload.policy.policy_id},
    )
    return get_admin_policy_service(request).update_active_policy(payload)
