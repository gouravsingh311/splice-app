from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.errors import DomainError
from app.features.notifications.contracts import (
    ListNotificationsRequest,
    MarkAllNotificationsReadRequest,
    MarkNotificationsReadRequest,
    NotificationActorRole,
    NotificationStatus,
    RetryNotificationRequest,
)
from app.features.notifications.service import NotificationService


def create_service() -> NotificationService:
    return NotificationService(now_fn=lambda: datetime(2026, 2, 27, tzinfo=UTC))


def test_list_notifications_can_filter_out_read_items() -> None:
    service = create_service()
    result = service.list_notifications(
        ListNotificationsRequest(
            actor_id="creator-1",
            actor_role=NotificationActorRole.CREATOR,
            include_read=False,
        )
    )

    assert all(item.read is False for item in result.notifications)
    assert {item.notification_id for item in result.notifications} == {"ntf-1"}


def test_list_notifications_limits_creator_scope_to_owned_submissions() -> None:
    service = create_service()
    result = service.list_notifications(
        ListNotificationsRequest(
            actor_id="creator-1",
            actor_role=NotificationActorRole.CREATOR,
            include_read=True,
        )
    )

    assert {item.notification_id for item in result.notifications} == {"ntf-1", "ntf-2"}


def test_mark_read_updates_only_targeted_unread_rows() -> None:
    service = create_service()
    result = service.mark_read(
        MarkNotificationsReadRequest(
            actor_id="creator-1",
            actor_role=NotificationActorRole.CREATOR,
            notification_ids=["ntf-1", "ntf-2"],
        )
    )

    assert result.updated_count == 1


def test_mark_all_read_updates_remaining_unread_rows() -> None:
    service = create_service()

    result = service.mark_all_read(
        MarkAllNotificationsReadRequest(
            actor_id="creator-1",
            actor_role=NotificationActorRole.CREATOR,
        )
    )

    assert result.updated_count == 1


def test_mark_read_rejects_cross_user_notification_ids() -> None:
    service = create_service()

    with pytest.raises(DomainError) as exc_info:
        service.mark_read(
            MarkNotificationsReadRequest(
                actor_id="creator-1",
                actor_role=NotificationActorRole.CREATOR,
                notification_ids=["ntf-3"],
            )
        )

    assert exc_info.value.code == "NOTIFICATION_SCOPE_FORBIDDEN"
    assert exc_info.value.status_code == 403


def test_retry_requires_reviewer_or_admin_role() -> None:
    service = create_service()

    with pytest.raises(DomainError) as exc_info:
        service.retry(
            RetryNotificationRequest(
                actor_id="creator-1",
                actor_role=NotificationActorRole.CREATOR,
                notification_id="ntf-3",
            )
        )

    assert exc_info.value.code == "NOTIFICATION_RETRY_FORBIDDEN"


def test_retry_updates_failed_notification_attempts() -> None:
    service = create_service()

    result = service.retry(
        RetryNotificationRequest(
            actor_id="reviewer-1",
            actor_role=NotificationActorRole.REVIEWER,
            notification_id="ntf-3",
        )
    )

    assert result.notification.attempts == 4
    assert result.notification.status == NotificationStatus.SENT
