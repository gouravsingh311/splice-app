from __future__ import annotations

import atexit
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.core.errors import DomainError
from app.core.observability import ObservabilityService
from app.features.jobs.contracts import (
    DeadLetterJobSnapshot,
    EnqueueJobRequest,
    EnqueueJobResult,
    JobDetailResult,
    JobRunSnapshot,
    JobRunStatus,
    JobsSchedulingErrorCode,
    JobStatusClass,
    RecommendedAction,
)

from .base import JobHandler, logger
from .maintenance import JobQueueMaintenanceMixin
from .worker import BackgroundExecutor


class BackgroundJobQueueService(JobQueueMaintenanceMixin):
    """SQLite-backed queue with idempotent enqueue, retry, dead-letter, replay, and polling."""

    def __init__(
        self,
        *,
        observability: ObservabilityService,
        connection: sqlite3.Connection | None = None,
        start_executor: bool = True,
    ) -> None:
        super().__init__(
            observability=observability,
            connection=connection,
            start_executor=start_executor,
        )
        self._executor = BackgroundExecutor(queue=self)
        if start_executor:
            self._executor.start()
        atexit.register(self.close)

    def register_handler(self, job_type: str, handler: JobHandler) -> None:
        logger.info("Registering background job handler.", extra={"job_type": job_type})
        self._handlers[job_type] = handler

    def enqueue(self, payload: EnqueueJobRequest) -> EnqueueJobResult:
        logger.info(
            "Enqueueing background job.",
            extra={"job_type": payload.job_type, "idempotency_key": payload.idempotency_key},
        )
        with self._write_lock:
            existing = self._fetch_job_by_idempotency(payload.idempotency_key)
            if existing is not None:
                return EnqueueJobResult(idempotent=True, job=existing)

            now = datetime.now(tz=UTC)
            job = JobRunSnapshot(
                id=f"job:{uuid4().hex}",
                job_type=payload.job_type,
                idempotency_key=payload.idempotency_key,
                status=JobRunStatus.QUEUED,
                attempt_count=0,
                max_attempts=payload.max_attempts,
                payload_json=payload.payload_json,
                correlation_id=payload.correlation_id,
                created_at=now,
                scheduled_for=payload.scheduled_for,
                status_class=JobStatusClass.READY,
                recommended_action=RecommendedAction.NONE,
            )
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO job_runs (
                      id, job_type, idempotency_key, status, attempt_count, max_attempts,
                      payload_json, correlation_id, created_at, scheduled_for,
                      started_at, ended_at, next_retry_at, last_error
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    self._job_params(job),
                )

        self._record_queue_metrics(job=job, action="enqueued")
        return EnqueueJobResult(idempotent=False, job=job)

    def close(self) -> None:
        executor = self._executor
        if executor is None:
            return
        executor.stop()
        self._executor = None

    def get_job(self, job_id: str) -> JobDetailResult:
        logger.info("Fetching background job detail.", extra={"job_id": job_id})
        job = self._fetch_job(job_id)
        if job is None:
            raise DomainError(
                code=JobsSchedulingErrorCode.JOB_NOT_FOUND,
                message=f"Job {job_id} was not found.",
                status_code=404,
                details={"job_id": job_id},
            )
        dead_letter = self._fetch_dead_letter(job_id)
        return JobDetailResult(job=job, dead_letter=dead_letter)

    def mark_running(self, job_id: str) -> JobRunSnapshot:
        logger.info("Marking job running.", extra={"job_id": job_id})
        with self._write_lock:
            job = self._fetch_job(job_id)
            if job is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.JOB_NOT_FOUND,
                    message=f"Job {job_id} was not found.",
                    status_code=404,
                    details={"job_id": job_id},
                )
            running_job = job.model_copy(
                update={
                    "status": JobRunStatus.RUNNING,
                    "started_at": datetime.now(tz=UTC),
                    "ended_at": None,
                    "next_retry_at": None,
                    "status_class": JobStatusClass.RUNNING,
                    "recommended_action": RecommendedAction.NONE,
                }
            )
            with self._connection:
                self._connection.execute(
                    """
                    UPDATE job_runs
                    SET status = ?, started_at = ?, ended_at = ?, next_retry_at = ?, last_error = ?
                    WHERE id = ?
                    """,
                    (
                        running_job.status.value,
                        self._dt(running_job.started_at),
                        self._dt(running_job.ended_at),
                        self._dt(running_job.next_retry_at),
                        running_job.last_error,
                        job_id,
                    ),
                )
            return running_job

    def mark_succeeded(self, job_id: str) -> JobRunSnapshot:
        logger.info("Marking job succeeded.", extra={"job_id": job_id})
        with self._write_lock:
            job = self._fetch_job(job_id)
            if job is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.JOB_NOT_FOUND,
                    message=f"Job {job_id} was not found.",
                    status_code=404,
                    details={"job_id": job_id},
                )
            succeeded_job = job.model_copy(
                update={
                    "status": JobRunStatus.SUCCEEDED,
                    "ended_at": datetime.now(tz=UTC),
                    "next_retry_at": None,
                    "last_error": None,
                    "status_class": JobStatusClass.COMPLETED,
                    "failure_class": None,
                    "recommended_action": RecommendedAction.NONE,
                }
            )
            with self._connection:
                self._connection.execute(
                    """
                    UPDATE job_runs
                    SET status = ?, ended_at = ?, next_retry_at = ?, last_error = ?
                    WHERE id = ?
                    """,
                    (
                        succeeded_job.status.value,
                        self._dt(succeeded_job.ended_at),
                        None,
                        None,
                        job_id,
                    ),
                )

        self._record_queue_metrics(job=succeeded_job, action="succeeded")
        return succeeded_job

    def mark_failed(
        self,
        job_id: str,
        *,
        failure_reason: str,
        terminal: bool = False,
    ) -> JobRunSnapshot:
        logger.warning(
            "Marking job failed.",
            extra={"job_id": job_id, "failure_reason": failure_reason, "terminal": terminal},
        )
        with self._write_lock:
            job = self._fetch_job(job_id)
            if job is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.JOB_NOT_FOUND,
                    message=f"Job {job_id} was not found.",
                    status_code=404,
                    details={"job_id": job_id},
                )

            if job.status == JobRunStatus.DEAD_LETTERED:
                return job

            now = datetime.now(tz=UTC)
            next_attempt = job.max_attempts if terminal else job.attempt_count + 1
            if next_attempt >= job.max_attempts:
                failure_class = self._classify_failure(
                    job_type=job.job_type,
                    failure_reason=failure_reason,
                )
                recommended_action = self._recommended_action(
                    status=JobRunStatus.DEAD_LETTERED,
                    failure_class=failure_class,
                )
                dead_letter = DeadLetterJobSnapshot(
                    id=f"dlj:{uuid4().hex}",
                    job_run_id=job.id,
                    payload_json={
                        **job.payload_json,
                        "job_type": job.job_type,
                        "failure_context": {
                            "status_class": JobStatusClass.TERMINAL_FAILURE.value,
                            "failure_class": failure_class.value,
                            "recommended_action": recommended_action.value,
                            "last_error": failure_reason,
                        },
                    },
                    failure_reason=failure_reason,
                    created_at=now,
                    status_class=JobStatusClass.TERMINAL_FAILURE,
                    failure_class=failure_class,
                    recommended_action=recommended_action,
                )
                failed_job = job.model_copy(
                    update={
                        "status": JobRunStatus.DEAD_LETTERED,
                        "attempt_count": next_attempt,
                        "scheduled_for": job.scheduled_for,
                        "ended_at": now,
                        "next_retry_at": None,
                        "last_error": failure_reason,
                        "status_class": JobStatusClass.TERMINAL_FAILURE,
                        "failure_class": failure_class,
                        "recommended_action": recommended_action,
                    }
                )
                with self._connection:
                    self._connection.execute(
                        """
                        INSERT INTO dead_letter_jobs (
                          id, job_run_id, payload_json, failure_reason, created_at, replayed_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            dead_letter.id,
                            dead_letter.job_run_id,
                            json.dumps(dead_letter.payload_json),
                            dead_letter.failure_reason,
                            self._dt(dead_letter.created_at),
                            None,
                        ),
                    )
            else:
                failure_class = self._classify_failure(
                    job_type=job.job_type,
                    failure_reason=failure_reason,
                )
                recommended_action = self._recommended_action(
                    status=JobRunStatus.RETRYING,
                    failure_class=failure_class,
                )
                failed_job = job.model_copy(
                    update={
                        "status": JobRunStatus.RETRYING,
                        "attempt_count": next_attempt,
                        "next_retry_at": now
                        + timedelta(seconds=self._retry_backoff_seconds(next_attempt)),
                        "scheduled_for": now
                        + timedelta(seconds=self._retry_backoff_seconds(next_attempt)),
                        "last_error": failure_reason,
                        "status_class": JobStatusClass.PENDING_RETRY,
                        "failure_class": failure_class,
                        "recommended_action": recommended_action,
                    }
                )

            with self._connection:
                self._connection.execute(
                    """
                    UPDATE job_runs
                    SET status = ?, attempt_count = ?, scheduled_for = ?,
                        ended_at = ?, next_retry_at = ?, last_error = ?
                    WHERE id = ?
                    """,
                    (
                        failed_job.status.value,
                        failed_job.attempt_count,
                        self._dt(failed_job.scheduled_for),
                        self._dt(failed_job.ended_at),
                        self._dt(failed_job.next_retry_at),
                        failed_job.last_error,
                        job_id,
                    ),
                )

        self._record_queue_metrics(job=failed_job, action="failed")
        self._record_failure_telemetry(job=failed_job, failure_reason=failure_reason)
        return failed_job

    def execute_due_jobs(self) -> None:
        now = datetime.now(tz=UTC)
        due_jobs = self._fetch_due_jobs(now=now)
        for due_job in due_jobs:
            handler = self._handlers.get(due_job.job_type)
            if handler is None:
                continue
            try:
                self.mark_running(due_job.id)
                handler(due_job)
                latest = self._fetch_job(due_job.id)
                if latest is not None and latest.status == JobRunStatus.RUNNING:
                    self.mark_succeeded(due_job.id)
            except Exception as exc:  # pragma: no cover
                latest = self._fetch_job(due_job.id)
                if latest is not None and latest.status == JobRunStatus.RUNNING:
                    decision = self._classify_execution_failure(exc)
                    self.mark_failed(
                        due_job.id,
                        failure_reason=decision["failure_reason"],
                        terminal=decision["terminal"],
                    )

    def _fetch_due_jobs(self, *, now: datetime) -> list[JobRunSnapshot]:
        cursor = self._connection.execute(
            """
            SELECT *
            FROM job_runs
            WHERE status IN (?, ?)
              AND (scheduled_for IS NULL OR scheduled_for <= ?)
            ORDER BY created_at ASC
            """,
            (JobRunStatus.QUEUED.value, JobRunStatus.RETRYING.value, self._dt(now)),
        )
        return [self._row_to_job(row) for row in cursor.fetchall()]

    def _retry_backoff_seconds(self, attempt_count: int) -> int:
        return min(300, 15 * (2 ** (attempt_count - 1)))
