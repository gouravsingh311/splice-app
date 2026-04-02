from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.jobs.contracts import (
    EnqueueJobRequest,
    IncidentAnnotationRequest,
    ReleaseTriggerRequest,
    ReplayJobRequest,
    ScheduleOverrideRequest,
    ScheduleResolveRequest,
)
from app.features.submissions.contracts import (
    SUBMISSION_APPROVED_SCHEDULING_EVENT,
    SchedulingTriggerEvent,
)


def build_scheduling_event(**overrides) -> SchedulingTriggerEvent:
    payload = {
        "event_name": SUBMISSION_APPROVED_SCHEDULING_EVENT,
        "schema_version": 1,
        "submission_id": "sub-contract-1",
        "preferred_release_month": "2026-04",
        "idempotency_key": "submission.approved.scheduling.v1:sub-contract-1:2",
        "approved_at": datetime.now(tz=UTC),
        "triggered_by": "reviewer-1",
        "correlation_id": "evt:sub-contract-1:2",
    }
    payload.update(overrides)
    return SchedulingTriggerEvent(**payload)


def test_schedule_resolve_request_accepts_valid_timezone() -> None:
    request = ScheduleResolveRequest(
        request_id="req-1",
        scheduling_event=build_scheduling_event(),
        timezone="UTC",
    )

    assert request.timezone == "UTC"
    assert request.scheduling_event.event_name == SUBMISSION_APPROVED_SCHEDULING_EVENT


def test_schedule_resolve_request_rejects_unknown_timezone() -> None:
    with pytest.raises(ValidationError):
        ScheduleResolveRequest(
            request_id="req-1",
            scheduling_event=build_scheduling_event(),
            timezone="Mars/Phobos",
        )


def test_schedule_override_request_rejects_non_admin_reviewer_role() -> None:
    with pytest.raises(ValidationError):
        ScheduleOverrideRequest(
            request_id="req-2",
            new_release_at="2026-04-03T10:00:00Z",
            reason="Need coordination",
            actor_id="creator-1",
            actor_role="creator",
            timezone="UTC",
        )


def test_release_trigger_request_restricts_actor_role() -> None:
    with pytest.raises(ValidationError):
        ReleaseTriggerRequest(
            request_id="req-3",
            actor_id="reviewer-1",
            actor_role="reviewer",
            force=True,
        )


def test_enqueue_job_request_validates_attempt_range() -> None:
    request = EnqueueJobRequest(
        request_id="req-4",
        job_type="release.trigger",
        idempotency_key="job:sub-contract-1:1",
        payload_json={"submission_id": "sub-contract-1"},
        max_attempts=5,
    )

    assert request.max_attempts == 5

    with pytest.raises(ValidationError):
        EnqueueJobRequest(
            request_id="req-4",
            job_type="release.trigger",
            idempotency_key="job:sub-contract-1:1",
            payload_json={"submission_id": "sub-contract-1"},
            max_attempts=0,
        )


def test_replay_job_request_requires_confirmation() -> None:
    request = ReplayJobRequest(
        request_id="replay-1",
        actor_id="admin-1",
        reason="Recover dead letter",
        confirmation="REPLAY",
    )
    assert request.confirmation == "REPLAY"

    with pytest.raises(ValidationError):
        ReplayJobRequest(
            request_id="replay-2",
            actor_id="admin-1",
            reason="Recover dead letter",
            confirmation="",
        )


def test_incident_annotation_request_accepts_failure_context_fields() -> None:
    payload = IncidentAnnotationRequest(
        source="desktop-operations-ui",
        severity="critical",
        note="release trigger exhausted retries",
        linked_entity="submission:sub-contract-1",
        failure_class="scheduling_terminal_failure",
        correlation_id="job:job-1",
        remediation_status="acknowledged",
        remediation_owner="ops-1",
        remediation_link="/admin/jobs/job-1",
        audit_event_id="audit:evt-1",
        idempotency_key="incident:key-1",
    )

    assert payload.failure_class.value == "scheduling_terminal_failure"
    assert payload.remediation_status.value == "acknowledged"
    assert payload.correlation_id == "job:job-1"
