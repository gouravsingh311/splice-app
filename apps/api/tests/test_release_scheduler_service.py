from __future__ import annotations

import sqlite3
import time
from datetime import UTC, datetime, timedelta
from threading import Barrier, Lock, Thread

import pytest

from app.core.errors import DomainError
from app.core.observability import ObservabilityService
from app.features.audit.service import AuditEventStore
from app.features.jobs.contracts import (
    JobRunStatus,
    JobsSchedulingErrorCode,
    ReleaseTriggerRequest,
    ScheduleOverrideRequest,
    ScheduleResolveRequest,
)
from app.features.jobs.service import BackgroundJobQueueService
from app.features.submissions.contracts import (
    ActorRole,
    CreateDraftRequest,
    SubmissionState,
    TransitionErrorCode,
    TransitionRequest,
)
from app.features.submissions.scheduler import ReleaseSchedulerService
from app.features.submissions.service import SubmissionWorkflowService


def create_scheduler(
    connection: sqlite3.Connection,
) -> tuple[SubmissionWorkflowService, ReleaseSchedulerService]:
    workflow = SubmissionWorkflowService(connection=connection)
    observability = ObservabilityService(
        service="splice-api",
        environment="test",
        connection=connection,
    )
    jobs = BackgroundJobQueueService(
        observability=observability,
        connection=connection,
        start_executor=False,
    )
    scheduler = ReleaseSchedulerService(
        workflow=workflow,
        jobs=jobs,
        observability=observability,
        audit=AuditEventStore(),
        connection=connection,
    )
    return workflow, scheduler


def create_approved_submission(workflow: SubmissionWorkflowService, submission_id: str) -> dict:
    workflow.create_draft_submission(
        CreateDraftRequest(
            submission_id=submission_id,
            creator_id="creator-1",
            preferred_release_month="2026-04",
        )
    )
    seed_creator_submit_gate_ready(workflow, submission_id)
    workflow.transition_submission(
        submission_id,
        TransitionRequest(
            request_id="req-under-review",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )
    approved = workflow.transition_submission(
        submission_id,
        TransitionRequest(
            request_id="req-approved",
            to_state=SubmissionState.APPROVED,
            actor_id="reviewer-1",
            actor_role=ActorRole.REVIEWER,
            expected_version=1,
        ),
    )
    return next(
        event.payload
        for event in approved.orchestration.integration_events
        if event.event_name == "submission.approved.scheduling.v1"
    )


def seed_creator_submit_gate_ready(workflow: SubmissionWorkflowService, submission_id: str) -> None:
    now = datetime.now(tz=UTC).isoformat()
    connection = workflow._connection
    connection.execute(
        """
        INSERT INTO submission_metadata (
            submission_id,
            creator_id,
            pack_name,
            release_month,
            notes,
            tags_json,
            airtable_form_completed,
            airtable_payload_checksum,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          airtable_form_completed = excluded.airtable_form_completed,
          updated_at = excluded.updated_at
        """,
        (
            submission_id,
            "creator-1",
            "Pack",
            "2026-04",
            None,
            "[]",
            1,
            "checksum-1",
            now,
            now,
        ),
    )
    connection.execute(
        """
        INSERT INTO airtable_submission_links (
            submission_id,
            airtable_base_id,
            airtable_table_name,
            airtable_view_name,
            airtable_record_id,
            airtable_record_url,
            airtable_payload_checksum,
            sync_status,
            last_synced_at,
            last_error_code,
            last_error_detail,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          sync_status = excluded.sync_status,
          updated_at = excluded.updated_at
        """,
        (
            submission_id,
            "base-1",
            "Submissions",
            "Desktop Completion Lookup v1",
            f"rec-{submission_id}",
            None,
            "checksum-1",
            "linked",
            now,
            None,
            None,
            now,
            now,
        ),
    )
    connection.commit()


def test_schedule_resolution_is_idempotent_and_enqueues_release_job(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-1")

    first = scheduler.resolve_schedule(
        "sub-schedule-1",
        ScheduleResolveRequest(
            request_id="resolve-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    second = scheduler.resolve_schedule(
        "sub-schedule-1",
        ScheduleResolveRequest(
            request_id="resolve-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    assert first.idempotent is False
    assert second.idempotent is True
    assert first.release_job.job_type == "release.trigger"
    assert first.schedule.source.value == "approval_event"


def test_schedule_resolution_replay_is_restart_safe(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-restart-resolve-1")

    first = scheduler.resolve_schedule(
        "sub-schedule-restart-resolve-1",
        ScheduleResolveRequest(
            request_id="resolve-restart-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    _, restarted_scheduler = create_scheduler(in_memory_db_connection)
    replay = restarted_scheduler.resolve_schedule(
        "sub-schedule-restart-resolve-1",
        ScheduleResolveRequest(
            request_id="resolve-restart-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    assert first.idempotent is False
    assert replay.idempotent is True
    assert replay.release_job.id == first.release_job.id

    job_count = in_memory_db_connection.execute(
        "SELECT COUNT(*) AS count FROM job_runs WHERE idempotency_key = ?",
        (first.release_job.idempotency_key,),
    ).fetchone()
    assert job_count is not None
    assert job_count["count"] == 1


def test_schedule_resolution_replay_rejects_conflicting_payload_after_restart(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-restart-resolve-2")

    scheduler.resolve_schedule(
        "sub-schedule-restart-resolve-2",
        ScheduleResolveRequest(
            request_id="resolve-restart-2",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    _, restarted_scheduler = create_scheduler(in_memory_db_connection)
    with pytest.raises(DomainError) as exc_info:
        restarted_scheduler.resolve_schedule(
            "sub-schedule-restart-resolve-2",
            ScheduleResolveRequest(
                request_id="resolve-restart-2",
                scheduling_event=event_payload,
                timezone="Europe/London",
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.VERSION_CONFLICT


def test_schedule_override_requires_existing_schedule(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    create_approved_submission(workflow, "sub-schedule-2")

    with pytest.raises(DomainError) as exc_info:
        scheduler.override_schedule(
            "sub-schedule-2",
            ScheduleOverrideRequest(
                request_id="override-1",
                new_release_at="2026-04-08T12:00:00Z",
                reason="Shift calendar",
                actor_id="admin-1",
                actor_role="admin",
                timezone="UTC",
            ),
        )

    assert exc_info.value.code == JobsSchedulingErrorCode.SCHEDULE_NOT_FOUND


def test_schedule_override_and_forced_release_trigger_flow(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-3")
    scheduler.resolve_schedule(
        "sub-schedule-3",
        ScheduleResolveRequest(
            request_id="resolve-2",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    override = scheduler.override_schedule(
        "sub-schedule-3",
        ScheduleOverrideRequest(
            request_id="override-2",
            new_release_at="2026-04-10T09:00:00Z",
            reason="Operational adjustment",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )
    assert override.schedule.source.value == "manual_override"

    release = scheduler.trigger_release(
        "sub-schedule-3",
        ReleaseTriggerRequest(
            request_id="release-1",
            actor_id="system-worker",
            actor_role="system",
            force=True,
            job_run_id=override.release_job.id,
        ),
    )
    assert release.submission.current_state == SubmissionState.RELEASED
    assert release.schedule.release_triggered_at is not None


def test_schedule_override_replay_is_restart_safe(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-restart-override-1")
    scheduler.resolve_schedule(
        "sub-schedule-restart-override-1",
        ScheduleResolveRequest(
            request_id="resolve-restart-override-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    first = scheduler.override_schedule(
        "sub-schedule-restart-override-1",
        ScheduleOverrideRequest(
            request_id="override-restart-1",
            new_release_at="2026-04-10T09:00:00Z",
            reason="Operational adjustment",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    _, restarted_scheduler = create_scheduler(in_memory_db_connection)
    replay = restarted_scheduler.override_schedule(
        "sub-schedule-restart-override-1",
        ScheduleOverrideRequest(
            request_id="override-restart-1",
            new_release_at="2026-04-10T09:00:00Z",
            reason="Operational adjustment",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    assert first.idempotent is False
    assert replay.idempotent is True
    assert replay.override.id == first.override.id
    assert replay.release_job.id == first.release_job.id

    override_count = in_memory_db_connection.execute(
        "SELECT COUNT(*) AS count FROM schedule_overrides WHERE id = ?",
        (first.override.id,),
    ).fetchone()
    assert override_count is not None
    assert override_count["count"] == 1


def test_schedule_override_replay_rejects_conflicting_payload_after_restart(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-restart-override-2")
    scheduler.resolve_schedule(
        "sub-schedule-restart-override-2",
        ScheduleResolveRequest(
            request_id="resolve-restart-override-2",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    scheduler.override_schedule(
        "sub-schedule-restart-override-2",
        ScheduleOverrideRequest(
            request_id="override-restart-2",
            new_release_at="2026-04-10T09:00:00Z",
            reason="Initial override",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    _, restarted_scheduler = create_scheduler(in_memory_db_connection)
    with pytest.raises(DomainError) as exc_info:
        restarted_scheduler.override_schedule(
            "sub-schedule-restart-override-2",
            ScheduleOverrideRequest(
                request_id="override-restart-2",
                new_release_at="2026-04-11T09:00:00Z",
                reason="Conflicting override",
                actor_id="admin-1",
                actor_role="admin",
                timezone="UTC",
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.VERSION_CONFLICT


def test_approval_to_scheduled_to_released_happy_path_via_job_executor(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-happy-1")
    scheduler.resolve_schedule(
        "sub-schedule-happy-1",
        ScheduleResolveRequest(
            request_id="resolve-happy-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    override = scheduler.override_schedule(
        "sub-schedule-happy-1",
        ScheduleOverrideRequest(
            request_id="override-happy-1",
            new_release_at=datetime.now(tz=UTC) - timedelta(minutes=1),
            reason="Immediate release window for test",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    scheduler._jobs.execute_due_jobs()
    submission_row = workflow._connection.execute(
        "SELECT current_state FROM submissions WHERE id = ?",
        ("sub-schedule-happy-1",),
    ).fetchone()
    assert submission_row is not None
    assert submission_row["current_state"] == SubmissionState.RELEASED.value

    job = scheduler._jobs.get_job(override.release_job.id).job
    assert job.status.value == "succeeded"


def test_release_trigger_blocks_when_not_due_without_force(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-4")
    scheduler.resolve_schedule(
        "sub-schedule-4",
        ScheduleResolveRequest(
            request_id="resolve-4",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    with pytest.raises(DomainError) as exc_info:
        scheduler.trigger_release(
            "sub-schedule-4",
            ReleaseTriggerRequest(
                request_id="release-2",
                actor_id="system-worker",
                actor_role="system",
                force=False,
            ),
        )
    assert exc_info.value.code == JobsSchedulingErrorCode.SCHEDULE_NOT_DUE


def test_repeated_release_trigger_replay_is_idempotent_without_schedule_mutation(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-idempotent-1")
    scheduler.resolve_schedule(
        "sub-schedule-idempotent-1",
        ScheduleResolveRequest(
            request_id="resolve-idempotent-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    scheduler.override_schedule(
        "sub-schedule-idempotent-1",
        ScheduleOverrideRequest(
            request_id="override-idempotent-1",
            new_release_at=datetime.now(tz=UTC) - timedelta(minutes=1),
            reason="Make due now",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    first = scheduler.trigger_release(
        "sub-schedule-idempotent-1",
        ReleaseTriggerRequest(
            request_id="release-idempotent-1",
            actor_id="system-worker",
            actor_role="system",
            force=False,
        ),
    )
    second = scheduler.trigger_release(
        "sub-schedule-idempotent-1",
        ReleaseTriggerRequest(
            request_id="release-idempotent-2",
            actor_id="system-worker",
            actor_role="system",
            force=False,
        ),
    )

    assert first.idempotent is False
    assert second.idempotent is True
    assert second.schedule.version == first.schedule.version


def test_release_trigger_replay_is_restart_safe(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-restart-release-1")
    scheduler.resolve_schedule(
        "sub-schedule-restart-release-1",
        ScheduleResolveRequest(
            request_id="resolve-restart-release-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    scheduler.override_schedule(
        "sub-schedule-restart-release-1",
        ScheduleOverrideRequest(
            request_id="override-restart-release-1",
            new_release_at=datetime.now(tz=UTC) - timedelta(minutes=1),
            reason="Make due now",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )
    first = scheduler.trigger_release(
        "sub-schedule-restart-release-1",
        ReleaseTriggerRequest(
            request_id="release-restart-1",
            actor_id="system-worker",
            actor_role="system",
            force=False,
        ),
    )

    _, restarted_scheduler = create_scheduler(in_memory_db_connection)
    replay = restarted_scheduler.trigger_release(
        "sub-schedule-restart-release-1",
        ReleaseTriggerRequest(
            request_id="release-restart-1",
            actor_id="system-worker",
            actor_role="system",
            force=False,
        ),
    )

    assert first.idempotent is False
    assert replay.idempotent is True
    assert replay.submission.current_state == SubmissionState.RELEASED
    assert replay.schedule.release_triggered_at == first.schedule.release_triggered_at


def test_release_trigger_replay_rejects_conflicting_payload_after_restart(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-restart-release-2")
    scheduler.resolve_schedule(
        "sub-schedule-restart-release-2",
        ScheduleResolveRequest(
            request_id="resolve-restart-release-2",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    scheduler.override_schedule(
        "sub-schedule-restart-release-2",
        ScheduleOverrideRequest(
            request_id="override-restart-release-2",
            new_release_at=datetime.now(tz=UTC) - timedelta(minutes=1),
            reason="Make due now",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )
    scheduler.trigger_release(
        "sub-schedule-restart-release-2",
        ReleaseTriggerRequest(
            request_id="release-restart-2",
            actor_id="system-worker",
            actor_role="system",
            force=False,
        ),
    )

    _, restarted_scheduler = create_scheduler(in_memory_db_connection)
    with pytest.raises(DomainError) as exc_info:
        restarted_scheduler.trigger_release(
            "sub-schedule-restart-release-2",
            ReleaseTriggerRequest(
                request_id="release-restart-2",
                actor_id="system-worker",
                actor_role="admin",
                force=False,
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.VERSION_CONFLICT


def test_schedule_resolution_validates_submission_match(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-5")

    with pytest.raises(DomainError) as exc_info:
        scheduler.resolve_schedule(
            "sub-other",
            ScheduleResolveRequest(
                request_id="resolve-5",
                scheduling_event=event_payload,
                timezone="UTC",
            ),
        )
    assert exc_info.value.code == JobsSchedulingErrorCode.SCHEDULE_SUBMISSION_MISMATCH


def test_release_job_terminal_failure_emits_scheduling_failure_annotation(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-6")
    resolved = scheduler.resolve_schedule(
        "sub-schedule-6",
        ScheduleResolveRequest(
            request_id="resolve-6",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    scheduler._jobs.mark_failed(resolved.release_job.id, failure_reason="worker-release-timeout")
    scheduler._jobs.mark_failed(resolved.release_job.id, failure_reason="worker-release-timeout")
    scheduler._jobs.mark_failed(resolved.release_job.id, failure_reason="worker-release-timeout")

    row = in_memory_db_connection.execute(
        """
        SELECT failure_class, linked_entity, correlation_id
        FROM incident_annotations
        WHERE failure_class = 'scheduling_terminal_failure'
        ORDER BY created_at DESC
        LIMIT 1
        """
    ).fetchone()
    assert row is not None
    assert row["linked_entity"] == "submission:sub-schedule-6"
    assert row["correlation_id"] == event_payload["correlation_id"]


def test_stale_release_job_version_is_treated_as_safe_noop(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-7")
    resolved = scheduler.resolve_schedule(
        "sub-schedule-7",
        ScheduleResolveRequest(
            request_id="resolve-7",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    scheduler.override_schedule(
        "sub-schedule-7",
        ScheduleOverrideRequest(
            request_id="override-7",
            new_release_at="2026-04-20T09:00:00Z",
            reason="Move release date",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    scheduler._execute_release_job(resolved.release_job)
    stale_job = scheduler._jobs.get_job(resolved.release_job.id).job
    assert stale_job.status == JobRunStatus.SUCCEEDED

    current_schedule = scheduler._fetch_schedule("sub-schedule-7")
    assert current_schedule is not None
    assert current_schedule.release_triggered_at is None


def test_trigger_release_returns_idempotent_result_when_already_released(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-8")
    resolved = scheduler.resolve_schedule(
        "sub-schedule-8",
        ScheduleResolveRequest(
            request_id="resolve-8",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )

    first = scheduler.trigger_release(
        "sub-schedule-8",
        ReleaseTriggerRequest(
            request_id="release-8-1",
            actor_id="admin-1",
            actor_role="admin",
            force=True,
            job_run_id=resolved.release_job.id,
        ),
    )
    second = scheduler.trigger_release(
        "sub-schedule-8",
        ReleaseTriggerRequest(
            request_id="release-8-2",
            actor_id="admin-1",
            actor_role="admin",
            force=True,
        ),
    )

    assert first.idempotent is False
    assert second.idempotent is True
    assert second.submission.current_state == SubmissionState.RELEASED
    assert second.schedule.version == first.schedule.version


def test_trigger_release_serializes_transition_execution_under_concurrency(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    workflow, scheduler = create_scheduler(in_memory_db_connection)
    event_payload = create_approved_submission(workflow, "sub-schedule-concurrent-1")
    scheduler.resolve_schedule(
        "sub-schedule-concurrent-1",
        ScheduleResolveRequest(
            request_id="resolve-concurrent-1",
            scheduling_event=event_payload,
            timezone="UTC",
        ),
    )
    scheduler.override_schedule(
        "sub-schedule-concurrent-1",
        ScheduleOverrideRequest(
            request_id="override-concurrent-1",
            new_release_at=datetime.now(tz=UTC) - timedelta(minutes=1),
            reason="Open release window now",
            actor_id="admin-1",
            actor_role="admin",
            timezone="UTC",
        ),
    )

    original_transition = scheduler._workflow.transition_submission
    concurrency_lock = Lock()
    active_transitions = 0
    max_active_transitions = 0

    def tracked_transition(*args, **kwargs):
        nonlocal active_transitions, max_active_transitions
        with concurrency_lock:
            active_transitions += 1
            if active_transitions > max_active_transitions:
                max_active_transitions = active_transitions
        try:
            time.sleep(0.05)
            return original_transition(*args, **kwargs)
        finally:
            with concurrency_lock:
                active_transitions -= 1

    scheduler._workflow.transition_submission = tracked_transition

    start_barrier = Barrier(3)
    results: list[object] = []
    errors: list[Exception] = []
    result_lock = Lock()

    def invoke_release(request_id: str) -> None:
        start_barrier.wait()
        try:
            result = scheduler.trigger_release(
                "sub-schedule-concurrent-1",
                ReleaseTriggerRequest(
                    request_id=request_id,
                    actor_id="system-worker",
                    actor_role="system",
                    force=True,
                ),
            )
            with result_lock:
                results.append(result)
        except Exception as exc:  # pragma: no cover - assertion checks concrete errors below
            with result_lock:
                errors.append(exc)

    thread_one = Thread(target=invoke_release, args=("release-concurrent-1",))
    thread_two = Thread(target=invoke_release, args=("release-concurrent-2",))
    thread_one.start()
    thread_two.start()
    start_barrier.wait()
    thread_one.join()
    thread_two.join()

    assert errors == []
    assert len(results) == 2
    assert max_active_transitions == 1
    non_idempotent_count = sum(1 for result in results if getattr(result, "idempotent", True) is False)
    assert non_idempotent_count == 1
