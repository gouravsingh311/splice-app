"""PRD-10 notification routes for inbox and dispatch retry flows."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.core.logging import get_logger
from app.core.security import (
    ActorContext,
    assert_actor_payload_matches_context,
    get_actor_context,
    require_internal_access,
)
from app.features.notifications.contracts import (
    EmitNotificationRequest,
    EmitNotificationResponse,
    ListNotificationsRequest,
    ListNotificationsResponse,
    MarkAllNotificationsReadRequest,
    MarkAllNotificationsReadResponse,
    MarkNotificationsReadRequest,
    MarkNotificationsReadResponse,
    NotificationActorRole,
    RetryNotificationRequest,
    RetryNotificationResponse,
)
from app.features.notifications.service import NotificationService

router = APIRouter(tags=["notifications"])
logger = get_logger(__name__)


def get_notification_service(request: Request) -> NotificationService:
    return request.app.state.notification_service


@router.get("/notifications", response_model=ListNotificationsResponse)
async def list_notifications(
    request: Request,
    actor_id: str = Query(min_length=1),
    actor_role: str = Query(min_length=1),
    include_read: bool = Query(default=True),
    actor_context: ActorContext = Depends(get_actor_context),
) -> ListNotificationsResponse:
    logger.info(
        "Listing notifications.",
        extra={"actor_id": actor_id, "actor_role": actor_role, "include_read": include_read},
    )
    assert_actor_payload_matches_context(
        actor_id=actor_id,
        actor_role=actor_role,
        actor_context=actor_context,
    )
    payload = ListNotificationsRequest(
        actor_id=actor_context.actor_id,
        actor_role=NotificationActorRole(actor_context.actor_role),
        include_read=include_read,
    )
    return get_notification_service(request).list_notifications(payload)


@router.post("/notifications/mark-read", response_model=MarkNotificationsReadResponse)
async def mark_notifications_read(
    payload: MarkNotificationsReadRequest,
    request: Request,
    actor_context: ActorContext = Depends(get_actor_context),
) -> MarkNotificationsReadResponse:
    logger.info(
        "Marking notifications read.",
        extra={"actor_id": payload.actor_id, "count": len(payload.notification_ids)},
    )
    assert_actor_payload_matches_context(
        actor_id=payload.actor_id,
        actor_role=payload.actor_role.value,
        actor_context=actor_context,
    )
    resolved_payload = payload.model_copy(
        update={
            "actor_id": actor_context.actor_id,
            "actor_role": NotificationActorRole(actor_context.actor_role),
        }
    )
    return get_notification_service(request).mark_read(resolved_payload)


@router.post("/notifications/mark-all-read", response_model=MarkAllNotificationsReadResponse)
async def mark_all_notifications_read(
    payload: MarkAllNotificationsReadRequest,
    request: Request,
    actor_context: ActorContext = Depends(get_actor_context),
) -> MarkAllNotificationsReadResponse:
    logger.info("Marking all notifications read.", extra={"actor_id": payload.actor_id})
    assert_actor_payload_matches_context(
        actor_id=payload.actor_id,
        actor_role=payload.actor_role.value,
        actor_context=actor_context,
    )
    resolved_payload = payload.model_copy(
        update={
            "actor_id": actor_context.actor_id,
            "actor_role": NotificationActorRole(actor_context.actor_role),
        }
    )
    return get_notification_service(request).mark_all_read(resolved_payload)


@router.post("/notifications/retry", response_model=RetryNotificationResponse)
async def retry_notification(
    payload: RetryNotificationRequest,
    request: Request,
    actor_context: ActorContext = Depends(get_actor_context),
) -> RetryNotificationResponse:
    logger.info(
        "Retrying notification.",
        extra={"notification_id": payload.notification_id, "actor_id": payload.actor_id},
    )
    assert_actor_payload_matches_context(
        actor_id=payload.actor_id,
        actor_role=payload.actor_role.value,
        actor_context=actor_context,
    )
    resolved_payload = payload.model_copy(
        update={
            "actor_id": actor_context.actor_id,
            "actor_role": NotificationActorRole(actor_context.actor_role),
        }
    )
    return get_notification_service(request).retry(resolved_payload)


@router.post("/internal/notifications/emit", response_model=EmitNotificationResponse)
async def emit_notification(
    payload: EmitNotificationRequest,
    request: Request,
    _internal_access: None = Depends(require_internal_access),
) -> EmitNotificationResponse:
    """Internal system endpoint for dispatching new notifications."""
    logger.info(
        "Emitting notification.",
        extra={"submission_id": payload.submission_id, "channel": payload.channel},
    )
    return get_notification_service(request).emit_notification(payload)
