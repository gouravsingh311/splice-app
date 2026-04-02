from __future__ import annotations

import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.errors import DomainError
from app.core.observability import ObservabilityService
from app.features.jobs.contracts import (
    EnqueueJobRequest,
    FailureClass,
    JobRunStatus,
    JobsSchedulingErrorCode,
    JobStatusClass,
    RecommendedAction,
    ReplayJobRequest,
)
from app.features.jobs.service import BackgroundExecutor, BackgroundJobQueueService
from app.features.jobs.services.integrations import register_integration_job_handlers
from app.features.submissions.contracts import TransitionErrorCode
from app.features.submissions.service import SubmissionWorkflowService
from app.features.submissions.storage import IntakeStorageService


def create_service(connection: sqlite3.Connection) -> BackgroundJobQueueService:
    return BackgroundJobQueueService(
        observability=ObservabilityService(
            service="splice-api",
            environment="test",
            connection=connection,
        ),
        connection=connection,
        start_executor=False,
    )


def test_background_executor_stops_cleanly_on_closed_database_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    closed_db_error = sqlite3.ProgrammingError("Cannot operate on a closed database.")
    call_finished = threading.Event()
    thread_exceptions: list[object] = []

    def record_thread_exception(args: object) -> None:
        thread_exceptions.append(args)

    class FakeQueue:
        def __init__(self) -> None:
            self.calls = 0

        def execute_due_jobs(self) -> None:
            self.calls += 1
            call_finished.set()
            raise closed_db_error

    monkeypatch.setattr(threading, "excepthook", record_thread_exception)

    queue = FakeQueue()
    executor = BackgroundExecutor(queue=queue, poll_interval_seconds=0)
    executor.start()

    assert call_finished.wait(timeout=2)
    executor.stop()

    assert queue.calls == 1
    assert thread_exceptions == []
    assert not executor._thread.is_alive()


def test_enqueue_is_idempotent_by_job_idempotency_key(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    payload = EnqueueJobRequest(
        request_id="req-1",
        job_type="release.trigger",
        idempotency_key="release:sub-1:1",
        payload_json={"submission_id": "sub-1"},
        max_attempts=3,
    )

    first = service.enqueue(payload)
    second = service.enqueue(payload)

    assert first.idempotent is False
    assert second.idempotent is True
    assert first.job.id == second.job.id


def test_failed_attempts_move_job_to_dead_letter_after_max_attempts(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-2",
            job_type="integration.dispatch",
            idempotency_key="integration:sub-1:1",
            payload_json={"submission_id": "sub-1"},
            max_attempts=2,
        )
    ).job

    first_failure = service.mark_failed(job.id, failure_reason="timeout")
    assert first_failure.status == JobRunStatus.RETRYING
    assert first_failure.attempt_count == 1
    assert first_failure.next_retry_at is not None
    assert first_failure.status_class == JobStatusClass.PENDING_RETRY
    assert first_failure.failure_class == FailureClass.TRANSIENT
    assert first_failure.recommended_action == RecommendedAction.WAIT_FOR_RETRY

    terminal_failure = service.mark_failed(job.id, failure_reason="timeout")
    assert terminal_failure.status == JobRunStatus.DEAD_LETTERED
    assert terminal_failure.attempt_count == 2
    assert terminal_failure.status_class == JobStatusClass.TERMINAL_FAILURE
    assert terminal_failure.recommended_action == RecommendedAction.REPLAY_SAFE

    details = service.get_job(job.id)
    assert details.dead_letter is not None
    assert details.dead_letter.failure_reason == "timeout"
    assert details.dead_letter.status_class == JobStatusClass.TERMINAL_FAILURE
    assert details.dead_letter.failure_class == FailureClass.TRANSIENT
    assert details.dead_letter.recommended_action == RecommendedAction.REPLAY_SAFE


def test_dead_letter_job_can_be_replayed_idempotently(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-3",
            job_type="notification.dispatch",
            idempotency_key="notify:sub-1:1",
            payload_json={"submission_id": "sub-1"},
            max_attempts=1,
        )
    ).job
    service.mark_failed(job.id, failure_reason="smtp-down")

    replay_payload = ReplayJobRequest(
        request_id="replay-1",
        actor_id="admin-1",
        reason="Provider recovered",
        confirmation="REPLAY",
    )
    first = service.replay(job.id, replay_payload)
    second = service.replay(job.id, replay_payload)

    assert first.idempotent is False
    assert second.idempotent is True
    assert first.job.status == JobRunStatus.QUEUED
    assert first.job.status_class == JobStatusClass.READY
    assert first.job.recommended_action == RecommendedAction.NONE
    assert first.dead_letter.replayed_at is not None
    replay_rows = in_memory_db_connection.execute(
        """
        SELECT request_key, job_run_id, request_id
        FROM job_replay_requests
        WHERE job_run_id = ?
        """,
        (job.id,),
    ).fetchall()
    assert [dict(row) for row in replay_rows] == [
        {
            "request_key": f"{job.id}:replay-1",
            "job_run_id": job.id,
            "request_id": "replay-1",
        }
    ]


def test_replay_duplicate_request_id_is_idempotent_after_service_restart(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-3b",
            job_type="notification.dispatch",
            idempotency_key="notify:sub-restart:1",
            payload_json={"submission_id": "sub-restart"},
            max_attempts=1,
        )
    ).job
    service.mark_failed(job.id, failure_reason="smtp-down")

    replay_payload = ReplayJobRequest(
        request_id="replay-restart-1",
        actor_id="admin-1",
        reason="Provider recovered",
        confirmation="REPLAY",
    )
    first = service.replay(job.id, replay_payload)

    restarted = create_service(in_memory_db_connection)
    duplicate = restarted.replay(job.id, replay_payload)

    assert first.idempotent is False
    assert duplicate.idempotent is True
    assert duplicate.job.id == first.job.id
    assert duplicate.job.status == JobRunStatus.QUEUED
    assert duplicate.dead_letter.id == first.dead_letter.id
    assert duplicate.dead_letter.replayed_at == first.dead_letter.replayed_at
    replay_count = in_memory_db_connection.execute(
        "SELECT COUNT(*) AS count FROM job_replay_requests WHERE job_run_id = ?",
        (job.id,),
    ).fetchone()
    assert replay_count is not None
    assert replay_count["count"] == 1


def test_replay_requires_current_dead_letter_not_historical_dead_letter_record(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-3c",
            job_type="notification.dispatch",
            idempotency_key="notify:sub-history:1",
            payload_json={"submission_id": "sub-history"},
            max_attempts=1,
        )
    ).job
    service.mark_failed(job.id, failure_reason="smtp-down")
    first_replay = service.replay(
        job.id,
        ReplayJobRequest(
            request_id="replay-history-1",
            actor_id="admin-1",
            reason="Provider recovered",
            confirmation="REPLAY",
        ),
    )

    restarted = create_service(in_memory_db_connection)
    with pytest.raises(DomainError) as exc_info:
        restarted.replay(
            job.id,
            ReplayJobRequest(
                request_id="replay-history-2",
                actor_id="admin-1",
                reason="Try again",
                confirmation="REPLAY",
            ),
        )

    assert exc_info.value.code == JobsSchedulingErrorCode.JOB_REPLAY_NOT_ALLOWED
    assert exc_info.value.details == {
        "job_id": job.id,
        "status": JobRunStatus.QUEUED.value,
        "dead_letter_id": first_replay.dead_letter.id,
    }


def test_replay_requires_dead_lettered_job(in_memory_db_connection: sqlite3.Connection) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-4",
            job_type="release.trigger",
            idempotency_key="release:sub-4:1",
            payload_json={"submission_id": "sub-4"},
            max_attempts=3,
        )
    ).job

    with pytest.raises(DomainError) as exc_info:
        service.replay(
            job.id,
            ReplayJobRequest(
                request_id="replay-2",
                actor_id="admin-1",
                reason="Force replay",
                confirmation="REPLAY",
            ),
        )
    assert exc_info.value.code == JobsSchedulingErrorCode.JOB_REPLAY_NOT_ALLOWED


def test_retry_path_transitions_from_retrying_to_succeeded(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-retry-path",
            job_type="release.trigger",
            idempotency_key="release:sub-retry:1",
            payload_json={"submission_id": "sub-retry"},
            max_attempts=3,
        )
    ).job

    attempts = {"count": 0}

    def flaky_handler(_job):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("timeout")

    service.register_handler("release.trigger", flaky_handler)
    service.execute_due_jobs()
    after_first = service.get_job(job.id).job
    assert after_first.status == JobRunStatus.RETRYING
    assert after_first.status_class == JobStatusClass.PENDING_RETRY
    assert after_first.recommended_action == RecommendedAction.WAIT_FOR_RETRY

    # Make the retry immediately due for deterministic test execution.
    in_memory_db_connection.execute(
        "UPDATE job_runs SET scheduled_for = ? WHERE id = ?",
        ("1970-01-01T00:00:00+00:00", job.id),
    )
    in_memory_db_connection.commit()
    service.execute_due_jobs()

    after_second = service.get_job(job.id).job
    assert after_second.status == JobRunStatus.SUCCEEDED
    assert after_second.status_class == JobStatusClass.COMPLETED
    assert after_second.recommended_action == RecommendedAction.NONE


def test_execute_due_jobs_runs_registered_airtable_and_dropbox_handlers(
    in_memory_db_connection: sqlite3.Connection,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    service = create_service(in_memory_db_connection)
    storage_service = IntakeStorageService(connection=in_memory_db_connection)
    register_integration_job_handlers(
        service,
        connection=in_memory_db_connection,
        storage_service=storage_service,
    )

    submission_id = "sub-integration-1"
    created_at = datetime(2026, 3, 1, 12, 0, tzinfo=UTC).isoformat()
    in_memory_db_connection.execute(
        """
        INSERT INTO submissions (
            id, creator_id, current_state, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (submission_id, "creator-1", "approved", 1, created_at, created_at),
    )
    in_memory_db_connection.execute(
        """
        INSERT INTO submission_metadata (
            submission_id, creator_id, pack_name, label_name, release_month,
            notes, tags_json, airtable_form_completed, airtable_payload_checksum,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            submission_id,
            "creator-1",
            "Neon Nights",
            "Label One",
            "2026-12",
            "Approved pack",
            '["Synth","Bass"]',
            0,
            "checksum-123",
            created_at,
            created_at,
        ),
    )

    pack_root = tmp_path / "pack"
    audio_dir = pack_root / "Audio"
    audio_dir.mkdir(parents=True)
    sample_file = audio_dir / "kick.wav"
    sample_file.write_bytes(b"kick-sample")

    session_id = "session-integration-1"
    in_memory_db_connection.execute(
        """
        INSERT INTO upload_sessions (
            id, submission_id, status, local_pack_path, dropbox_dest_path,
            sha256_manifest_json, chunk_state_json, created_at, expires_at,
            completed_at, locked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            submission_id,
            "manifest_ready",
            str(pack_root),
            None,
            None,
            '{"local_pack_path":"' + str(pack_root).replace('\\', '\\\\') + '","creator_id":"creator-1","pack_name":"Neon Nights"}',
            created_at,
            None,
            None,
            created_at,
        ),
    )
    in_memory_db_connection.execute(
        """
        INSERT INTO asset_manifest (
            id, session_id, submission_id, file_path, file_size, sha256, mime, locked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "asset-1",
            session_id,
            submission_id,
            "Audio/kick.wav",
            sample_file.stat().st_size,
            "a" * 64,
            "audio/wav",
            1,
        ),
    )
    in_memory_db_connection.commit()

    airtable_record = SimpleNamespace(
        record_id="rec-123",
        record_url="https://airtable.example/rec-123",
        created_at=created_at,
        label_name="Label One",
        pack_name="Neon Nights",
        release_month="2026-12",
        notes="Approved pack",
        tags=["Synth", "Bass"],
        checksum="checksum-123",
        required_fields_complete=True,
    )
    fetch_result = SimpleNamespace(
        records=[airtable_record],
        base_id="app-test",
        table_name="Submissions",
        view_name="Desktop Completion Lookup v1",
        error_code=None,
        error_detail=None,
    )
    import app.features.jobs.services.integrations as integration_handlers

    monkeypatch.setattr(
        integration_handlers,
        "fetch_airtable_records_for_submission",
        lambda _submission_id: fetch_result,
    )
    monkeypatch.setattr(
        integration_handlers,
        "update_airtable_record_fields",
        lambda **_kwargs: SimpleNamespace(error_code=None, error_detail=None),
    )

    class FakeDropboxClient:
        def __init__(self) -> None:
            self.uploads: list[tuple[str, bytes]] = []

        def files_upload(self, data, destination_path, mode=None, mute=True):  # noqa: ANN001
            self.uploads.append((destination_path, data))

    fake_dropbox = FakeDropboxClient()
    monkeypatch.setenv("DROPBOX_ACCESS_TOKEN", "token-test")
    monkeypatch.setattr(
        storage_service,
        "_build_dropbox_client",
        lambda: fake_dropbox,
    )

    airtable_job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-airtable",
            job_type="integration.airtable.sync",
            idempotency_key="integration.airtable.sync:sub-integration-1:1",
            payload_json={
                "submission_id": submission_id,
                "integration_event_name": "submission.approved",
            },
            max_attempts=3,
            scheduled_for=datetime(1970, 1, 1, tzinfo=UTC),
        )
    ).job
    dropbox_job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-dropbox",
            job_type="integration.dropbox.delivery",
            idempotency_key="integration.dropbox.delivery:sub-integration-1:1",
            payload_json={
                "submission_id": submission_id,
                "dropbox_destination_root": f"/Splice-Deliveries/{submission_id}",
            },
            max_attempts=3,
            scheduled_for=datetime(1970, 1, 1, tzinfo=UTC),
        )
    ).job

    service.execute_due_jobs()

    airtable_status = service.get_job(airtable_job.id).job
    dropbox_status = service.get_job(dropbox_job.id).job

    assert airtable_status.status == JobRunStatus.SUCCEEDED
    assert airtable_status.recommended_action == RecommendedAction.NONE
    assert dropbox_status.status == JobRunStatus.SUCCEEDED
    assert dropbox_status.recommended_action == RecommendedAction.NONE

    airtable_link = in_memory_db_connection.execute(
        """
        SELECT sync_status, airtable_record_id, airtable_record_url
        FROM airtable_submission_links
        WHERE submission_id = ?
        """,
        (submission_id,),
    ).fetchone()
    assert airtable_link is not None
    assert airtable_link["sync_status"] == "linked"
    assert airtable_link["airtable_record_id"] == "rec-123"
    assert airtable_link["airtable_record_url"] == "https://airtable.example/rec-123"

    upload_session = in_memory_db_connection.execute(
        """
        SELECT status, dropbox_dest_path, completed_at
        FROM upload_sessions
        WHERE id = ?
        """,
        (session_id,),
    ).fetchone()
    assert upload_session is not None
    assert upload_session["status"] == "transfer_completed"
    assert upload_session["dropbox_dest_path"] == f"/Splice-Deliveries/{submission_id}"
    assert upload_session["completed_at"] is not None
    assert fake_dropbox.uploads == [
        (f"/Splice-Deliveries/{submission_id}/Audio/kick.wav", b"kick-sample")
    ]


def test_dropbox_delivery_transitions_submission_to_under_review_when_handoff_finishes_before_uploading_state(
    in_memory_db_connection: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    service = create_service(in_memory_db_connection)
    storage_service = IntakeStorageService(connection=in_memory_db_connection)
    workflow_service = SubmissionWorkflowService(connection=in_memory_db_connection)
    register_integration_job_handlers(
        service,
        connection=in_memory_db_connection,
        storage_service=storage_service,
        workflow_service=workflow_service,
    )

    submission_id = "sub-dropbox-race-1"
    created_at = datetime(2026, 3, 1, 12, 0, tzinfo=UTC).isoformat()
    in_memory_db_connection.execute(
        """
        INSERT INTO submissions (
            id, creator_id, current_state, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (submission_id, "creator-1", "draft", 0, created_at, created_at),
    )

    pack_root = tmp_path / "pack-race"
    audio_dir = pack_root / "Audio"
    audio_dir.mkdir(parents=True)
    sample_file = audio_dir / "kick.wav"
    sample_file.write_bytes(b"kick-sample")
    session_id = "session-dropbox-race-1"
    in_memory_db_connection.execute(
        """
        INSERT INTO upload_sessions (
            id, submission_id, status, local_pack_path, dropbox_dest_path,
            sha256_manifest_json, chunk_state_json, created_at, expires_at,
            completed_at, locked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            submission_id,
            "manifest_ready",
            str(pack_root),
            None,
            None,
            '{"local_pack_path":"' + str(pack_root).replace('\\', '\\\\') + '","creator_id":"creator-1","pack_name":"Race Pack"}',
            created_at,
            None,
            None,
            created_at,
        ),
    )
    in_memory_db_connection.execute(
        """
        INSERT INTO asset_manifest (
            id, session_id, submission_id, file_path, file_size, sha256, mime, locked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "asset-race-1",
            session_id,
            submission_id,
            "Audio/kick.wav",
            sample_file.stat().st_size,
            "a" * 64,
            "audio/wav",
            1,
        ),
    )
    in_memory_db_connection.commit()

    storage_service._build_dropbox_client = lambda: object()  # type: ignore[method-assign]
    storage_service._upload_manifest_files_to_dropbox = lambda **_kwargs: None  # type: ignore[method-assign]
    storage_service._verify_dropbox_delivery = lambda _handoff: None  # type: ignore[method-assign]

    dropbox_job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-dropbox-race",
            job_type="integration.dropbox.delivery",
            idempotency_key="integration.dropbox.delivery:sub-dropbox-race-1:1",
            payload_json={
                "submission_id": submission_id,
                "dropbox_destination_root": f"/Splice-Deliveries/{submission_id}",
            },
            max_attempts=3,
            scheduled_for=datetime(1970, 1, 1, tzinfo=UTC),
        )
    ).job

    service.execute_due_jobs()

    dropbox_status = service.get_job(dropbox_job.id).job
    assert dropbox_status.status == JobRunStatus.SUCCEEDED

    submission_row = in_memory_db_connection.execute(
        "SELECT current_state FROM submissions WHERE id = ?",
        (submission_id,),
    ).fetchone()
    assert submission_row is not None
    assert submission_row["current_state"] == "under_review"


def test_execute_due_jobs_ignores_unregistered_cms_integration_jobs(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    storage_service = IntakeStorageService(connection=in_memory_db_connection)
    register_integration_job_handlers(
        service,
        connection=in_memory_db_connection,
        storage_service=storage_service,
    )

    assert "integration.cms.handoff" not in service._handlers

    cms_job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-cms",
            job_type="integration.cms.handoff",
            idempotency_key="integration.cms.handoff:sub-cms-1:1",
            payload_json={"submission_id": "sub-cms-1"},
            max_attempts=3,
            scheduled_for=datetime(1970, 1, 1, tzinfo=UTC),
        )
    ).job

    service.execute_due_jobs()

    after = service.get_job(cms_job.id).job
    assert after.status == JobRunStatus.QUEUED
    assert after.status_class == JobStatusClass.READY
    assert after.recommended_action == RecommendedAction.NONE


def test_terminal_failure_allows_replay_safe_recovery_without_new_idempotency_key(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-replay-safe",
            job_type="release.trigger",
            idempotency_key="release:sub-replay-safe:1",
            payload_json={"submission_id": "sub-replay-safe"},
            max_attempts=1,
        )
    ).job

    def always_fails(_job):
        raise RuntimeError("timeout")

    service.register_handler("release.trigger", always_fails)
    service.execute_due_jobs()

    dead_lettered = service.get_job(job.id)
    assert dead_lettered.job.status == JobRunStatus.DEAD_LETTERED
    assert dead_lettered.dead_letter is not None
    assert dead_lettered.dead_letter.recommended_action == RecommendedAction.REPLAY_SAFE

    replay = service.replay(
        job.id,
        ReplayJobRequest(
            request_id="req-replay-safe-1",
            actor_id="admin-ops-1",
            reason="Provider recovered",
            confirmation="REPLAY",
        ),
    )
    assert replay.job.idempotency_key == job.idempotency_key
    assert replay.job.status == JobRunStatus.QUEUED


def test_terminal_failures_emit_structured_failure_class_telemetry(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    integration_job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-telemetry-1",
            job_type="integration.airtable.sync",
            idempotency_key="integration:airtable:sub-1",
            payload_json={"submission_id": "sub-1"},
            max_attempts=1,
            correlation_id="corr-integration-1",
        )
    ).job
    service.mark_failed(integration_job.id, failure_reason="airtable-timeout")

    rows = in_memory_db_connection.execute(
        """
        SELECT failure_class, linked_entity, correlation_id, remediation_link
        FROM incident_annotations
        ORDER BY created_at ASC
        """
    ).fetchall()
    failure_classes = [row["failure_class"] for row in rows]
    assert "integration_failure" in failure_classes
    assert "retry_exhaustion" in failure_classes
    assert rows[0]["linked_entity"] == "submission:sub-1"
    assert rows[0]["correlation_id"] == "corr-integration-1"
    assert rows[0]["remediation_link"] == f"/admin/jobs/{integration_job.id}"


def test_execute_due_jobs_dead_letters_terminal_domain_errors_without_retry(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-terminal-1",
            job_type="release.trigger",
            idempotency_key="release:terminal:1",
            payload_json={"submission_id": "sub-terminal-1"},
            max_attempts=3,
        )
    ).job

    def terminal_handler(_: object) -> None:
        raise DomainError(
            code=TransitionErrorCode.TRANSITION_NOT_ALLOWED,
            message="scheduled -> released transition is not allowed",
            status_code=409,
        )

    service.register_handler("release.trigger", terminal_handler)
    service.execute_due_jobs()

    failed = service.get_job(job.id)
    assert failed.job.status == JobRunStatus.DEAD_LETTERED
    assert failed.job.attempt_count == failed.job.max_attempts
    assert failed.dead_letter is not None
    assert failed.dead_letter.failure_reason.startswith("TRANSITION_NOT_ALLOWED:")


def test_execute_due_jobs_retries_transient_domain_errors(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-transient-1",
            job_type="release.trigger",
            idempotency_key="release:transient:1",
            payload_json={"submission_id": "sub-transient-1"},
            max_attempts=3,
        )
    ).job

    def transient_handler(_: object) -> None:
        raise DomainError(
            code=JobsSchedulingErrorCode.SCHEDULE_NOT_DUE,
            message="release trigger is not due",
            status_code=409,
        )

    service.register_handler("release.trigger", transient_handler)
    service.execute_due_jobs()

    retried = service.get_job(job.id).job
    assert retried.status == JobRunStatus.RETRYING
    assert retried.attempt_count == 1
    assert retried.next_retry_at is not None
    assert retried.failure_class == FailureClass.TRANSIENT
    assert retried.recommended_action == RecommendedAction.WAIT_FOR_RETRY


def test_schedule_not_due_dead_letter_retains_transient_failure_class(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    job = service.enqueue(
        EnqueueJobRequest(
            request_id="req-schedule-not-due-terminal-1",
            job_type="release.trigger",
            idempotency_key="release:schedule-not-due:1",
            payload_json={"submission_id": "sub-schedule-not-due-1"},
            max_attempts=1,
        )
    ).job

    def not_due_handler(_: object) -> None:
        raise DomainError(
            code=JobsSchedulingErrorCode.SCHEDULE_NOT_DUE,
            message="release trigger is not due",
            status_code=409,
        )

    service.register_handler("release.trigger", not_due_handler)
    service.execute_due_jobs()

    failed = service.get_job(job.id)
    assert failed.job.status == JobRunStatus.DEAD_LETTERED
    assert failed.job.failure_class == FailureClass.TRANSIENT
    assert failed.dead_letter is not None
    assert failed.dead_letter.failure_class == FailureClass.TRANSIENT
    assert failed.dead_letter.recommended_action == RecommendedAction.REPLAY_SAFE
