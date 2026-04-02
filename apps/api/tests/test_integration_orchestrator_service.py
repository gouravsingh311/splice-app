from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

import pytest

from app.core.errors import DomainError
from app.core.observability import ObservabilityService
from app.features.jobs.contracts import FailureClass, JobRunStatus, RecommendedAction
from app.features.jobs.service import BackgroundJobQueueService
from app.features.submissions.contracts import (
    SUBMISSION_APPROVED_SCHEDULING_EVENT,
    ActorRole,
    SubmissionState,
    TransitionDomainEvent,
    TransitionErrorCode,
)
from app.features.submissions.orchestrator import IntegrationOrchestratorService


def build_transition_event(**overrides) -> TransitionDomainEvent:
    payload = {
        "event_name": "submission.state.transitioned.v1",
        "event_id": "evt:sub-500:2",
        "submission_id": "sub-500",
        "from_state": SubmissionState.UNDER_REVIEW,
        "to_state": SubmissionState.APPROVED,
        "actor_id": "reviewer-1",
        "actor_role": ActorRole.REVIEWER,
        "transition_version": 2,
        "occurred_at": datetime.now(tz=UTC),
        "idempotency_key": "submission.transition:sub-500:2:approved",
        "reason": None,
        "preferred_release_month": "2026-12",
    }
    payload.update(overrides)
    return TransitionDomainEvent(**payload)


def test_orchestrator_emits_required_scheduling_contract(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = IntegrationOrchestratorService(connection=in_memory_db_connection)
    result = service.consume_transition_event(build_transition_event())

    assert result.idempotent is False
    assert len(result.integration_events) == 3
    assert "cms" not in {event.target for event in result.integration_events}
    scheduling = next(
        event
        for event in result.integration_events
        if event.event_name == SUBMISSION_APPROVED_SCHEDULING_EVENT
    )
    assert scheduling.payload["event_name"] == SUBMISSION_APPROVED_SCHEDULING_EVENT
    assert scheduling.payload["schema_version"] == 1
    job_rows = in_memory_db_connection.execute(
        """
        SELECT job_type, idempotency_key, status, attempt_count, max_attempts
        FROM job_runs
        ORDER BY job_type ASC
        """
    ).fetchall()
    assert [row["job_type"] for row in job_rows] == [
        "integration.airtable.sync",
        "integration.dropbox.delivery",
    ]
    assert all(row["status"] == JobRunStatus.QUEUED.value for row in job_rows)
    assert all(row["attempt_count"] == 0 for row in job_rows)
    assert all(row["max_attempts"] == 3 for row in job_rows)

    airtable = next(event for event in result.integration_events if event.target == "airtable")
    assert airtable.payload["job_status"] == JobRunStatus.QUEUED.value
    assert airtable.payload["job_status_class"] == "ready"
    assert airtable.payload["job_recommended_action"] == RecommendedAction.NONE.value


def test_orchestrator_transition_event_idempotency(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = IntegrationOrchestratorService(connection=in_memory_db_connection)
    event = build_transition_event()
    first = service.consume_transition_event(event)
    second = service.consume_transition_event(event)

    assert first.idempotent is False
    assert second.idempotent is True
    assert len(service.list_integration_events(event.submission_id)) == 3


def test_orchestrator_repairs_missing_provider_jobs_on_replay(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = IntegrationOrchestratorService(connection=in_memory_db_connection)
    event = build_transition_event()
    first = service.consume_transition_event(event)

    in_memory_db_connection.execute("DELETE FROM job_runs")
    in_memory_db_connection.commit()

    replay = service.consume_transition_event(event)

    assert first.idempotent is False
    assert replay.idempotent is True
    job_rows = in_memory_db_connection.execute(
        """
        SELECT COUNT(*) AS count
        FROM job_runs
        WHERE job_type LIKE 'integration.%'
        """
    ).fetchone()
    assert job_rows is not None
    assert job_rows["count"] == 2
    dropbox = next(event for event in replay.integration_events if event.target == "dropbox")
    assert dropbox.payload["job_status"] == JobRunStatus.QUEUED.value


def test_orchestrator_requires_release_month_for_approved_transition(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = IntegrationOrchestratorService(connection=in_memory_db_connection)

    with pytest.raises(DomainError) as exc_info:
        service.consume_transition_event(build_transition_event(preferred_release_month=None))
    assert exc_info.value.code == TransitionErrorCode.MISSING_PREFERRED_RELEASE_MONTH


def test_orchestrator_handles_rejected_transition(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = IntegrationOrchestratorService(connection=in_memory_db_connection)
    outcome = service.consume_transition_event(
        build_transition_event(
            event_id="evt:sub-600:2",
            submission_id="sub-600",
            to_state=SubmissionState.REJECTED,
            idempotency_key="submission.transition:sub-600:2:rejected",
            reason="Missing artwork",
        )
    )

    assert len(outcome.integration_events) == 1
    assert outcome.integration_events[0].event_name == "submission.rejected"


def test_orchestrator_provider_job_failure_progresses_to_dead_letter_visibility(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = IntegrationOrchestratorService(connection=in_memory_db_connection)
    service.consume_transition_event(build_transition_event())

    job_row = in_memory_db_connection.execute(
        """
        SELECT id
        FROM job_runs
        WHERE job_type = ?
        ORDER BY created_at ASC
        LIMIT 1
        """,
        ("integration.dropbox.delivery",),
    ).fetchone()
    assert job_row is not None

    queue = BackgroundJobQueueService(
        observability=ObservabilityService(
            service="splice-api",
            environment="test",
            connection=in_memory_db_connection,
        ),
        connection=in_memory_db_connection,
        start_executor=False,
    )

    retrying = queue.mark_failed(job_row["id"], failure_reason="dropbox-timeout")
    assert retrying.status == JobRunStatus.RETRYING
    assert retrying.failure_class == FailureClass.TRANSIENT
    assert retrying.recommended_action == RecommendedAction.WAIT_FOR_RETRY

    retrying_again = queue.mark_failed(job_row["id"], failure_reason="dropbox-timeout")
    assert retrying_again.status == JobRunStatus.RETRYING
    assert retrying_again.failure_class == FailureClass.TRANSIENT
    assert retrying_again.recommended_action == RecommendedAction.WAIT_FOR_RETRY

    dead_lettered = queue.mark_failed(job_row["id"], failure_reason="dropbox-timeout")
    assert dead_lettered.status == JobRunStatus.DEAD_LETTERED
    assert dead_lettered.failure_class == FailureClass.TRANSIENT
    assert dead_lettered.recommended_action == RecommendedAction.REPLAY_SAFE

    details = queue.get_job(job_row["id"])
    assert details.dead_letter is not None
    assert details.dead_letter.failure_reason == "dropbox-timeout"
    assert details.dead_letter.failure_class == FailureClass.TRANSIENT
    assert details.dead_letter.recommended_action == RecommendedAction.REPLAY_SAFE

    enriched_dropbox = next(
        event for event in service.list_integration_events("sub-500") if event.target == "dropbox"
    )
    assert enriched_dropbox.payload["job_status"] == JobRunStatus.DEAD_LETTERED.value
    assert enriched_dropbox.payload["job_status_class"] == "terminal_failure"
    assert enriched_dropbox.payload["job_failure_class"] == FailureClass.TRANSIENT.value
    assert enriched_dropbox.payload["job_recommended_action"] == RecommendedAction.REPLAY_SAFE.value
    assert enriched_dropbox.payload["job_dead_letter_failure_reason"] == "dropbox-timeout"
