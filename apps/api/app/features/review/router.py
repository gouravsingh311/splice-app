"""PRD-08 review queue and decision routes."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.core.logging import get_logger
from app.features.review.contracts import (
    AddReviewFlagRequest,
    AddReviewFlagResponse,
    AddReviewTagRequest,
    AddReviewTagResponse,
    ApproveSubmissionRequest,
    RejectSubmissionRequest,
    ReopenSubmissionRequest,
    ReviewActorRole,
    ReviewDecisionResponse,
    ReviewQueueRequest,
    ReviewQueueResponse,
    ReviewSubmissionDetailResponse,
    ReviewSubmissionRequest,
)
from app.features.review.service import ReviewConsoleService

router = APIRouter(tags=["reviews"])
logger = get_logger(__name__)


def get_review_service(request: Request) -> ReviewConsoleService:
    return request.app.state.review_console_service


@router.get("/reviews/queue", response_model=ReviewQueueResponse)
async def get_review_queue(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: ReviewActorRole = Query(),
    state: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    flag: str | None = Query(default=None),
) -> ReviewQueueResponse:
    logger.info(
        "Fetching review queue.",
        extra={"actor_id": actor_id, "actor_role": actor_role.value},
    )
    payload = ReviewQueueRequest(
        actor_id=actor_id,
        actor_role=actor_role,
        state=state,
        tag=tag,
        flag=flag,
    )
    return get_review_service(request).list_queue(payload)


@router.get(
    "/reviews/submissions/{submission_id}",
    response_model=ReviewSubmissionDetailResponse,
)
async def get_review_submission(
    submission_id: str,
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: ReviewActorRole = Query(),
) -> ReviewSubmissionDetailResponse:
    logger.info(
        "Fetching review submission detail.",
        extra={
            "submission_id": submission_id,
            "actor_id": actor_id,
            "actor_role": actor_role.value,
        },
    )
    payload = ReviewSubmissionRequest(actor_id=actor_id, actor_role=actor_role)
    return get_review_service(request).get_submission_detail(submission_id, payload)


@router.post(
    "/reviews/submissions/{submission_id}/approve",
    response_model=ReviewDecisionResponse,
)
async def approve_submission(
    submission_id: str,
    payload: ApproveSubmissionRequest,
    request: Request,
) -> ReviewDecisionResponse:
    logger.info(
        "Approving submission.",
        extra={"submission_id": submission_id, "actor_id": payload.actor_id},
    )
    return get_review_service(request).approve_submission(submission_id, payload)


@router.post(
    "/reviews/submissions/{submission_id}/reject",
    response_model=ReviewDecisionResponse,
)
async def reject_submission(
    submission_id: str,
    payload: RejectSubmissionRequest,
    request: Request,
) -> ReviewDecisionResponse:
    logger.info(
        "Rejecting submission.",
        extra={"submission_id": submission_id, "actor_id": payload.actor_id},
    )
    return get_review_service(request).reject_submission(submission_id, payload)


@router.post(
    "/reviews/submissions/{submission_id}/tags",
    response_model=AddReviewTagResponse,
)
async def add_tag(
    submission_id: str,
    payload: AddReviewTagRequest,
    request: Request,
) -> AddReviewTagResponse:
    logger.info(
        "Adding review tag.",
        extra={"submission_id": submission_id, "tag": payload.tag, "actor_id": payload.actor_id},
    )
    return get_review_service(request).add_tag(submission_id, payload)


@router.post(
    "/reviews/submissions/{submission_id}/flags",
    response_model=AddReviewFlagResponse,
)
async def add_flag(
    submission_id: str,
    payload: AddReviewFlagRequest,
    request: Request,
) -> AddReviewFlagResponse:
    logger.info(
        "Adding review flag.",
        extra={
            "submission_id": submission_id,
            "flag_type": payload.flag_type,
            "actor_id": payload.actor_id,
        },
    )
    return get_review_service(request).add_flag(submission_id, payload)


@router.post(
    "/reviews/submissions/{submission_id}/reopen",
    response_model=ReviewDecisionResponse,
)
async def reopen_submission(
    submission_id: str,
    payload: ReopenSubmissionRequest,
    request: Request,
) -> ReviewDecisionResponse:
    logger.info(
        "Reopening submission.",
        extra={"submission_id": submission_id, "actor_id": payload.actor_id},
    )
    return get_review_service(request).reopen_submission(submission_id, payload)
