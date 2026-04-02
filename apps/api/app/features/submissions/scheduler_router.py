"""PRD-17 routes for release scheduling and trigger orchestration."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.logging import get_logger
from app.core.security import (
    ActorContext,
    assert_actor_payload_matches_context,
    get_actor_context,
)
from app.features.jobs.contracts import (
    ActorRole,
    ReleaseTriggerRequest,
    ReleaseTriggerResult,
    ScheduleOverrideRequest,
    ScheduleOverrideResult,
    ScheduleResolveRequest,
    ScheduleResolveResult,
)
from app.features.submissions.scheduler import ReleaseSchedulerService

router = APIRouter(tags=["release-scheduling"])
logger = get_logger(__name__)


def get_scheduler_service(request: Request) -> ReleaseSchedulerService:
    return request.app.state.release_scheduler_service


@router.post("/submissions/{id}/schedule/resolve", response_model=ScheduleResolveResult)
async def resolve_schedule(
    id: str,
    payload: ScheduleResolveRequest,
    request: Request,
) -> ScheduleResolveResult:
    logger.info(
        "Resolving release schedule.",
        extra={"submission_id": id, "request_id": payload.request_id},
    )
    scheduler = get_scheduler_service(request)
    return scheduler.resolve_schedule(id, payload)


@router.put("/submissions/{id}/schedule", response_model=ScheduleOverrideResult)
async def override_schedule(
    id: str,
    payload: ScheduleOverrideRequest,
    request: Request,
    actor_context: ActorContext = Depends(get_actor_context),
) -> ScheduleOverrideResult:
    logger.info(
        "Overriding release schedule.",
        extra={"submission_id": id, "request_id": payload.request_id},
    )
    assert_actor_payload_matches_context(
        actor_id=payload.actor_id,
        actor_role=payload.actor_role.value,
        actor_context=actor_context,
    )
    scheduler = get_scheduler_service(request)
    resolved_payload = payload.model_copy(
        update={
            "actor_id": actor_context.actor_id,
            "actor_role": ActorRole(actor_context.actor_role),
        }
    )
    return scheduler.override_schedule(id, resolved_payload)


@router.post("/submissions/{id}/release/trigger", response_model=ReleaseTriggerResult)
async def trigger_release(
    id: str,
    payload: ReleaseTriggerRequest,
    request: Request,
    actor_context: ActorContext = Depends(get_actor_context),
) -> ReleaseTriggerResult:
    logger.info(
        "Triggering release.",
        extra={"submission_id": id, "request_id": payload.request_id, "force": payload.force},
    )
    assert_actor_payload_matches_context(
        actor_id=payload.actor_id,
        actor_role=payload.actor_role.value,
        actor_context=actor_context,
    )
    scheduler = get_scheduler_service(request)
    resolved_payload = payload.model_copy(
        update={
            "actor_id": actor_context.actor_id,
            "actor_role": ActorRole(actor_context.actor_role),
        }
    )
    return scheduler.trigger_release(id, resolved_payload)
