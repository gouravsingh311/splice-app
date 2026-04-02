"""PRD-15 routes for metrics and incident annotation hooks."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from app.core.logging import get_logger
from app.core.observability import ObservabilityService
from app.features.jobs.contracts import (
    IncidentAnnotationRequest,
    IncidentAnnotationResult,
)

router = APIRouter(tags=["observability"])
logger = get_logger(__name__)


def get_observability_service(request: Request) -> ObservabilityService:
    return request.app.state.observability_service


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics(request: Request) -> PlainTextResponse:
    logger.info("Rendering Prometheus metrics payload.")
    service = get_observability_service(request)
    body = service.render_metrics()
    return PlainTextResponse(content=body, media_type="text/plain; version=0.0.4")


@router.post("/admin/incidents/annotations", response_model=IncidentAnnotationResult)
async def append_incident_annotation(
    payload: IncidentAnnotationRequest, request: Request
) -> IncidentAnnotationResult:
    logger.info(
        "Appending incident annotation.",
        extra={"source": payload.source, "severity": payload.severity.value},
    )
    service = get_observability_service(request)
    return service.append_incident_annotation(payload)
