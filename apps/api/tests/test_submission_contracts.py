from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.submissions.contracts import (
    SUBMISSION_APPROVED_SCHEDULING_EVENT,
    SchedulingTriggerEvent,
    SubmissionState,
    TransitionRequest,
)


def test_scheduling_contract_keeps_explicit_versioned_event_name() -> None:
    payload = SchedulingTriggerEvent(
        event_name=SUBMISSION_APPROVED_SCHEDULING_EVENT,
        schema_version=1,
        submission_id="sub-100",
        preferred_release_month="2026-04",
        idempotency_key="submission.approved.scheduling.v1:sub-100:2",
        approved_at=datetime.now(tz=UTC),
        triggered_by="reviewer-1",
        correlation_id="evt:sub-100:2",
    )

    assert payload.event_name == SUBMISSION_APPROVED_SCHEDULING_EVENT
    assert payload.schema_version == 1


def test_scheduling_contract_rejects_invalid_event_name() -> None:
    with pytest.raises(ValidationError):
        SchedulingTriggerEvent(
            event_name="submission.approved.scheduling.v2",
            schema_version=1,
            submission_id="sub-100",
            preferred_release_month="2026-04",
            idempotency_key="submission.approved.scheduling.v1:sub-100:2",
            approved_at=datetime.now(tz=UTC),
            triggered_by="reviewer-1",
            correlation_id="evt:sub-100:2",
        )


def test_transition_contract_accepts_allowed_enums() -> None:
    request = TransitionRequest(
        request_id="req-1",
        to_state=SubmissionState.UNDER_REVIEW,
        actor_id="creator-1",
        actor_role="creator",
        expected_version=0,
    )

    assert request.to_state == SubmissionState.UNDER_REVIEW
    assert request.expected_version == 0


def test_submission_state_includes_uploading() -> None:
    assert SubmissionState.UPLOADING.value == "uploading"
