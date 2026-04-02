"""FastAPI entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from os import environ
from time import monotonic
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.db.session import init_db
from app.features.ai.ws_handler import router as ai_router
from app.core.logging import (
    clear_correlation_id,
    configure_logging,
    get_logger,
    set_correlation_id,
)

SERVICE_NAME = "splice-api"
DEFAULT_VERSION = "0.1.0"
DEFAULT_ENVIRONMENT = "local"
logger = get_logger(__name__)


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    yield


def create_app() -> FastAPI:
    """Create a FastAPI app with health endpoints."""
    app_version = environ.get("SPLICE_API_VERSION", DEFAULT_VERSION)
    environment = environ.get("SPLICE_ENV", DEFAULT_ENVIRONMENT)
    log_file_path = configure_logging(service=SERVICE_NAME, environment=environment)
    init_db()
    logger.info("Configured backend logging.", extra={"log_file_path": str(log_file_path)})

    app = FastAPI(
        title="Splice API",
        version=app_version,
        lifespan=app_lifespan,
    )

    # --- Feature routers ---
    app.include_router(ai_router, prefix="/ai", tags=["AI"])

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

    logger.info("Splice API app created.", extra={"version": app_version})

    return app


app = create_app()
