"""PRD-13 routes for background job queue operations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.errors import DomainError
from app.core.logging import get_logger
from app.core.security import require_internal_access
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType
from app.features.jobs.contracts import (
    EnqueueJobRequest,
    EnqueueJobResult,
    JobDetailResult,
    ReplayJobRequest,
    ReplayJobResult,
)
from app.features.jobs.service import BackgroundJobQueueService

router = APIRouter(tags=["background-jobs"])
logger = get_logger(__name__)


def get_job_service(request: Request) -> BackgroundJobQueueService:
    return request.app.state.job_queue_service


@router.post("/internal/jobs/enqueue", response_model=EnqueueJobResult, status_code=202)
async def enqueue_job(
    payload: EnqueueJobRequest,
    request: Request,
    _internal_access: None = Depends(require_internal_access),
) -> EnqueueJobResult:
    logger.info(
        "Enqueueing job.",
        extra={"job_type": payload.job_type, "idempotency_key": payload.idempotency_key},
    )
    service = get_job_service(request)
    return service.enqueue(payload)


@router.get("/admin/jobs/{id}", response_model=JobDetailResult)
async def get_job(id: str, request: Request) -> JobDetailResult:
    logger.info("Fetching job.", extra={"job_id": id})
    service = get_job_service(request)
    return service.get_job(id)


@router.post("/admin/jobs/{id}/replay", response_model=ReplayJobResult)
async def replay_job(id: str, payload: ReplayJobRequest, request: Request) -> ReplayJobResult:
    logger.info("Replaying job.", extra={"job_id": id, "request_id": payload.request_id})
    if payload.confirmation.strip().upper() != "REPLAY":
        raise DomainError(
            code="VALIDATION_ERROR",
            message="Confirmation text must be 'REPLAY' before replaying a job.",
            status_code=422,
            details={"expected": "REPLAY", "provided": payload.confirmation},
        )

    service = get_job_service(request)
    result = service.replay(id, payload)
    if not result.idempotent:
        request.app.state.audit_service.append_event(
            AuditAppendRequest(
                actor_id=payload.actor_id,
                action=AuditAction.admin_job_replayed,
                entity_type=AuditEntityType.system,
                entity_id=id,
                metadata={"reason": payload.reason, "request_id": payload.request_id},
                request_id=payload.request_id,
                idempotency_key=f"{AuditAction.admin_job_replayed.value}:{id}:{payload.request_id}",
            )
        )
    return result
