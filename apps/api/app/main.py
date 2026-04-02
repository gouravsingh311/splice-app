"""FastAPI entrypoint for Phase 1 backend contracts (PRD-01/03/07/09/10/11/12/13/15/17)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from os import environ
from time import monotonic
from typing import Final
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.db.session import init_db
from app.core.errors import DomainError
from app.core.logging import (
    clear_correlation_id,
    configure_logging,
    get_logger,
    set_correlation_id,
)
from app.core.observability import ObservabilityService
from app.core.observability_router import router as observability_router
from app.features.admin.qc_policy import AdminQcPolicyService
from app.features.admin.router import router as admin_router
from app.features.admin.service import AdminConfigService
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType
from app.features.audit.router import router as audit_router
from app.features.audit.service import AuditEventStore
from app.features.auth.contracts import ErrorEnvelope
from app.features.auth.router import create_auth_router
from app.features.auth.service import AuthError, AuthService, SigningKey
from app.features.creator.router import router as creator_router
from app.features.jobs.router import router as jobs_router
from app.features.jobs.service import BackgroundJobQueueService, register_integration_job_handlers
from app.features.notifications.router import router as notifications_router
from app.features.notifications.service import NotificationService
from app.features.notifications.smtp_adapter import SmtpEmailAdapter
from app.features.qc.router import router as qc_router
from app.features.qc.rules import QcRulesRegistryService
from app.features.qc.service import QcEngineService
from app.features.review.router import router as reviews_router
from app.features.review.service import ReviewConsoleService
from app.features.submissions.contracts import ErrorPayload, ErrorResponse, TransitionErrorCode
from app.features.submissions.router import router as submissions_router
from app.features.submissions.scheduler import ReleaseSchedulerService
from app.features.submissions.scheduler_router import router as release_scheduling_router
from app.features.submissions.service import SubmissionWorkflowService
from app.features.submissions.storage import IntakeStorageService
from app.features.submissions.storage_router import router as intake_storage_router

SERVICE_NAME: Final[str] = "splice-api"
DEFAULT_VERSION: Final[str] = "0.1.0"
DEFAULT_ENVIRONMENT: Final[str] = "local"
logger = get_logger(__name__)


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    yield


def create_app() -> FastAPI:
    """Create a FastAPI app with health endpoints and module routes."""
    app_version = environ.get("SPLICE_API_VERSION", DEFAULT_VERSION)
    environment = environ.get("SPLICE_ENV", DEFAULT_ENVIRONMENT)
    seed_default_users = environ.get("SPLICE_SEED_DEFAULT_USERS")
    log_file_path = configure_logging(service=SERVICE_NAME, environment=environment)
    init_db()
    logger.info("Configured backend logging.", extra={"log_file_path": str(log_file_path)})
    auth_signing_key = environ.get("SPLICE_AUTH_ACCESS_SECRET", "").strip()
    if not auth_signing_key:
        raise RuntimeError("Missing required environment variable: SPLICE_AUTH_ACCESS_SECRET")

    # Optional SMTP configuration for notifications
    smtp_host = environ.get("SMTP_HOST")
    smtp_port = int(environ.get("SMTP_PORT", "2525"))
    smtp_username = environ.get("SMTP_USERNAME")
    smtp_password = environ.get("SMTP_PASSWORD")
    smtp_from_email = environ.get("SMTP_FROM_EMAIL", "system@fileeaters.local")

    email_adapter = None
    if smtp_host:
        email_adapter = SmtpEmailAdapter(
            host=smtp_host,
            port=smtp_port,
            username=smtp_username,
            password=smtp_password,
            from_email=smtp_from_email,
        )

    app = FastAPI(
        title="Splice API",
        version=app_version,
        lifespan=app_lifespan,
    )

    audit_service = AuditEventStore()
    app.state.audit_service = audit_service

    app.state.observability_service = ObservabilityService(
        service=SERVICE_NAME,
        environment=environment,
    )
    app.state.intake_storage_service = IntakeStorageService()
    app.state.submission_workflow_service = SubmissionWorkflowService()
    app.state.notification_service = NotificationService(email_adapter=email_adapter)
    app.state.review_console_service = ReviewConsoleService(
        workflow=app.state.submission_workflow_service,
        audit=app.state.audit_service,
        notification_service=app.state.notification_service,
    )
    app.state.job_queue_service = BackgroundJobQueueService(
        observability=app.state.observability_service,
        start_executor=False,
    )
    register_integration_job_handlers(
        app.state.job_queue_service,
        connection=app.state.job_queue_service._connection,
        storage_service=app.state.intake_storage_service,
        workflow_service=app.state.submission_workflow_service,
    )
    app.state.release_scheduler_service = ReleaseSchedulerService(
        workflow=app.state.submission_workflow_service,
        jobs=app.state.job_queue_service,
        observability=app.state.observability_service,
        audit=app.state.audit_service,
    )
    if app.state.job_queue_service._executor is not None:
        app.state.job_queue_service._executor.start()
    app.state.qc_rules_registry_service = QcRulesRegistryService()
    app.state.qc_engine_service = QcEngineService(
        rules_registry=app.state.qc_rules_registry_service
    )
    app.state.admin_qc_policy_service = AdminQcPolicyService(
        registry=app.state.qc_rules_registry_service
    )
    app.state.admin_config_service = AdminConfigService(audit=app.state.audit_service)

    auth_service = AuthService(
        key_ring=[SigningKey(kid="local-dev-k1", secret=auth_signing_key, active=True)],
        email_adapter=email_adapter,
    )
    if seed_default_users is None:
        seed_default_users = "1" if environment in ("local", "dev") else "0"
    if seed_default_users == "1":
        logger.info("Seeding default users into the database...", extra={"users": ["admin", "creator", "reviewer"]})
        auth_service.seed_default_users(
            [
                ("admin@fileeaters.local", "AdminPass123!", ["admin"]),
                ("creator@fileeaters.local", "CreatorPass123!", ["creator"]),
                ("reviewer@fileeaters.local", "ReviewerPass123!", ["reviewer"]),
            ]
        )
    app.state.auth_service = auth_service
    app.include_router(create_auth_router(auth_service))

    @app.exception_handler(AuthError)
    def handle_auth_error(_request, exc: AuthError) -> JSONResponse:
        logger.warning(
            "Auth error raised.",
            extra={"error_code": exc.code, "status_code": exc.status},
        )
        payload = ErrorEnvelope(
            error={
                "code": exc.code,
                "message": exc.message,
                "status": exc.status,
            }
        )
        return JSONResponse(status_code=exc.status, content=payload.model_dump())

    @app.middleware("http")
    async def record_http_metrics(request: Request, call_next):
        correlation_id = request.headers.get("X-Correlation-ID") or str(uuid4())
        set_correlation_id(correlation_id)
        
        # --- Internal Secret Verification ---
        internal_secret = environ.get("SPLICE_INTERNAL_SECRET")
        if internal_secret:
            is_health_check = request.url.path.startswith("/health") or request.url.path == "/version"
            if not is_health_check:
                provided_secret = request.headers.get("X-Internal-Secret")
                if provided_secret != internal_secret:
                    logger.warning(
                        "Unauthorized internal API access attempt.",
                        extra={"path": request.url.path, "client": request.client.host if request.client else None}
                    )
                    return JSONResponse(
                        status_code=403,
                        content={"error": "Forbidden: Internal access only."}
                    )

        started_at = monotonic()
        logger.info(
            "HTTP request started.",
            extra={
                "method": request.method,
                "path": request.url.path,
                "client": request.client.host if request.client else None,
            },
        )
        try:
            response = await call_next(request)
        except Exception:
            elapsed = max(0.0, monotonic() - started_at)
            app.state.observability_service.record_http_request(
                method=request.method,
                path=request.url.path,
                status_code=500,
                duration_seconds=elapsed,
            )
            logger.exception(
                "HTTP request failed.",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": 500,
                    "duration_ms": round(elapsed * 1000, 2),
                },
            )
            raise
        else:
            elapsed = max(0.0, monotonic() - started_at)
            app.state.observability_service.record_http_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_seconds=elapsed,
            )
            response.headers["X-Correlation-ID"] = correlation_id
            logger.info(
                "HTTP request completed.",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round(elapsed * 1000, 2),
                },
            )
            return response
        finally:
            clear_correlation_id()

    @app.exception_handler(DomainError)
    async def handle_domain_error(_request, exc: DomainError) -> JSONResponse:
        logger.warning(
            "Domain error raised.",
            extra={"error_code": exc.code, "status_code": exc.status_code},
        )
        payload = ErrorResponse(
            error=ErrorPayload(
                code=exc.code,
                message=exc.message,
                details=dict(exc.details),
            )
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump(mode="json"))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request, exc: RequestValidationError) -> JSONResponse:
        logger.warning("Request validation failed.", extra={"error_count": len(exc.errors())})
        serialized_errors: list[dict[str, object]] = []
        for error in exc.errors():
            normalized_error = dict(error)
            context = normalized_error.get("ctx")
            if isinstance(context, dict):
                normalized_error["ctx"] = {
                    key: str(value) if isinstance(value, Exception) else value
                    for key, value in context.items()
                }
            serialized_errors.append(normalized_error)

        payload = ErrorResponse(
            error=ErrorPayload(
                code=TransitionErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Request payload failed contract validation.",
                details={"errors": serialized_errors},
            )
        )
        return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))

    @app.get("/health/live")
    def health_live() -> dict[str, str]:
        return {
            "service": SERVICE_NAME,
            "status": "live",
            "environment": environment,
        }

    @app.get("/health/ready")
    def health_ready() -> dict[str, str]:
        return {
            "service": SERVICE_NAME,
            "status": "ready",
            "environment": environment,
        }

    @app.get("/version")
    def version() -> dict[str, str]:
        return {
            "service": SERVICE_NAME,
            "version": app_version,
            "environment": environment,
        }

    app.include_router(audit_router)
    app.include_router(intake_storage_router)
    app.include_router(jobs_router)
    app.include_router(observability_router)
    app.include_router(submissions_router)
    app.include_router(reviews_router)
    app.include_router(release_scheduling_router)
    app.include_router(qc_router)
    app.include_router(notifications_router)
    app.include_router(creator_router, prefix="/creator")
    app.include_router(admin_router, prefix="/admin")

    audit_service.append_event(
        AuditAppendRequest(
            actor_id=None,
            action=AuditAction.system_audit_initialized,
            entity_type=AuditEntityType.system,
            entity_id=SERVICE_NAME,
            metadata={"environment": environment, "version": app_version},
        )
    )
    logger.info("Splice API app created.", extra={"version": app_version})

    return app


app = create_app()
