from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.notifications.contracts import (
    NOTIFICATION_DISPATCH_OUTCOME_EVENT,
    NotificationDispatchOutcomeEvent,
    NotificationItem,
)


def test_notification_dispatch_event_keeps_explicit_versioned_name() -> None:
    payload = NotificationDispatchOutcomeEvent(
        event_name=NOTIFICATION_DISPATCH_OUTCOME_EVENT,
        schema_version=1,
        notification_id="ntf-1",
        status="sent",
        attempt=1,
        max_attempts=3,
        occurred_at=datetime.now(tz=UTC),
    )

    assert payload.event_name == NOTIFICATION_DISPATCH_OUTCOME_EVENT
    assert payload.schema_version == 1


def test_notification_dispatch_event_rejects_invalid_event_name() -> None:
    with pytest.raises(ValidationError):
        NotificationDispatchOutcomeEvent(
            event_name="notification.dispatch.outcome.v2",
            schema_version=1,
            notification_id="ntf-1",
            status="sent",
            attempt=1,
            max_attempts=3,
            occurred_at=datetime.now(tz=UTC),
        )


def test_notification_item_contract_requires_known_status_and_channel() -> None:
    item = NotificationItem(
        notification_id="ntf-1",
        type="qc_failed",
        severity="warning",
        status="failed",
        channel="email",
        title="Dispatch failed",
        message="Retry requested.",
        submission_id="sub-10",
        read=False,
        read_at=None,
        attempts=3,
        max_attempts=5,
        created_at=datetime.now(tz=UTC),
        updated_at=datetime.now(tz=UTC),
    )

    assert item.status.value == "failed"
