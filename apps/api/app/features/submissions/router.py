"""PRD-07/09 FastAPI routes for lifecycle transitions and integration orchestration."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.logging import get_logger
from app.core.security import (
    ActorContext,
    assert_actor_payload_matches_context,
    get_actor_context,
    require_internal_access,
)
from app.features.submissions.contracts import (
    ActorRole,
    CreateDraftRequest,
    CreateDraftResult,
    IntegrationDispatchRequest,
    IntegrationEvent,
    OrchestrationResult,
    TransitionExecutionResult,
    TransitionRecord,
    TransitionRequest,
)
from app.features.submissions.service import SubmissionWorkflowService

router = APIRouter(tags=["submission-lifecycle"])
logger = get_logger(__name__)


def get_workflow_service(request: Request) -> SubmissionWorkflowService:
    return request.app.state.submission_workflow_service


@router.post("/submissions/draft", response_model=CreateDraftResult)
async def create_submission_draft(
    payload: CreateDraftRequest, request: Request
) -> CreateDraftResult:
    logger.info("Creating submission draft.", extra={"submission_id": payload.submission_id})
    workflow = get_workflow_service(request)
    return workflow.create_draft_submission(payload)


@router.post("/submissions/{id}/transition", response_model=TransitionExecutionResult)
async def transition_submission(
    id: str,
    payload: TransitionRequest,
    request: Request,
    actor_context: ActorContext = Depends(get_actor_context),
) -> TransitionExecutionResult:
    logger.info(
        "Transitioning submission.",
        extra={"submission_id": id, "to_state": payload.to_state.value},
    )
    assert_actor_payload_matches_context(
        actor_id=payload.actor_id,
        actor_role=payload.actor_role.value,
        actor_context=actor_context,
    )
    workflow = get_workflow_service(request)
    resolved_payload = payload.model_copy(
        update={
            "actor_id": actor_context.actor_id,
            "actor_role": ActorRole(actor_context.actor_role),
        }
    )
    return workflow.transition_submission(id, resolved_payload)


@router.get("/submissions/{id}/transitions", response_model=list[TransitionRecord])
async def list_submission_transitions(id: str, request: Request) -> list[TransitionRecord]:
    workflow = get_workflow_service(request)
    return workflow.list_transitions(id)


@router.get("/submissions/{id}/integrations", response_model=list[IntegrationEvent])
async def list_submission_integrations(id: str, request: Request) -> list[IntegrationEvent]:
    workflow = get_workflow_service(request)
    return workflow.list_integration_events(id)


@router.post("/internal/integrations/dispatch", response_model=OrchestrationResult, status_code=202)
async def dispatch_integration(
    payload: IntegrationDispatchRequest,
    request: Request,
    _internal_access: None = Depends(require_internal_access),
) -> OrchestrationResult:
    logger.info(
        "Dispatching integration event.",
        extra={"submission_id": payload.transition_event.submission_id},
    )
    workflow = get_workflow_service(request)
    return workflow.dispatch_integration(payload)
