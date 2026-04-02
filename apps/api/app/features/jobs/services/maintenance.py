from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime

from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.jobs.contracts import (
    DeadLetterJobSnapshot,
    FailureClass,
    IncidentFailureClass,
    IncidentSeverity,
    JobRunSnapshot,
    JobRunStatus,
    JobsSchedulingErrorCode,
    JobStatusClass,
    RecommendedAction,
    ReplayJobRequest,
    ReplayJobResult,
)

from .base import JobQueueBaseMixin

logger = get_logger(__name__)


class JobQueueMaintenanceMixin(JobQueueBaseMixin):
    """Management, maintenance, and telemetry logic for BackgroundJobQueueService."""

    def replay(self, job_id: str, payload: ReplayJobRequest) -> ReplayJobResult:
        logger.info(
            "Replaying background job.",
            extra={"job_id": job_id, "request_id": payload.request_id},
        )
        replay_key = self._replay_request_key(job_id, payload.request_id)
        with self._write_lock:
            existing = self._fetch_replay_result(replay_key)
            if existing is not None:
                return existing.model_copy(deep=True, update={"idempotent": True})

            job = self._fetch_job(job_id)
            dead_letter = self._fetch_dead_letter(job_id)
            if job is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.JOB_NOT_FOUND,
                    message=f"Job {job_id} was not found.",
                    status_code=404,
                    details={"job_id": job_id},
                )
            if (
                job.status != JobRunStatus.DEAD_LETTERED
                or dead_letter is None
                or dead_letter.replayed_at is not None
            ):
                raise DomainError(
                    code=JobsSchedulingErrorCode.JOB_REPLAY_NOT_ALLOWED,
                    message="Replay is only allowed for dead-lettered jobs.",
                    status_code=409,
                    details={
                        "job_id": job_id,
                        "status": job.status.value,
                        "dead_letter_id": dead_letter.id if dead_letter is not None else None,
                    },
                )

            now = datetime.now(tz=UTC)
            replayed_dead_letter = dead_letter.model_copy(update={"replayed_at": now})
            replayed_job = job.model_copy(
                update={
                    "status": JobRunStatus.QUEUED,
                    "attempt_count": 0,
                    "scheduled_for": now,
                    "started_at": None,
                    "ended_at": None,
                    "next_retry_at": None,
                    "last_error": None,
                    "status_class": JobStatusClass.READY,
                    "failure_class": None,
                    "recommended_action": RecommendedAction.NONE,
                }
            )
            result = ReplayJobResult(
                idempotent=False,
                job=replayed_job,
                dead_letter=replayed_dead_letter,
            )
            try:
                with self._connection:
                    self._connection.execute(
                        """
                        UPDATE dead_letter_jobs
                        SET replayed_at = ?
                        WHERE id = ?
                        """,
                        (self._dt(replayed_dead_letter.replayed_at), dead_letter.id),
                    )
                    self._connection.execute(
                        """
                        UPDATE job_runs
                        SET status = ?, attempt_count = ?, scheduled_for = ?,
                            started_at = ?, ended_at = ?, next_retry_at = ?, last_error = ?
                        WHERE id = ?
                        """,
                        (
                            replayed_job.status.value,
                            replayed_job.attempt_count,
                            self._dt(replayed_job.scheduled_for),
                            None,
                            None,
                            None,
                            None,
                            job_id,
                        ),
                    )
                    self._connection.execute(
                        """
                        INSERT INTO job_replay_requests (
                          request_key, job_run_id, request_id, actor_id,
                          reason, response_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            replay_key,
                            job_id,
                            payload.request_id,
                            payload.actor_id,
                            payload.reason,
                            result.model_dump_json(),
                            self._dt(now),
                        ),
                    )
            except sqlite3.IntegrityError:
                existing = self._fetch_replay_result(replay_key)
                if existing is not None:
                    return existing.model_copy(deep=True, update={"idempotent": True})
                raise

        self._record_queue_metrics(job=replayed_job, action="replayed")
        return result

    def _fetch_dead_letter(self, job_id: str) -> DeadLetterJobSnapshot | None:
        cursor = self._connection.execute(
            """
            SELECT *
            FROM dead_letter_jobs
            WHERE job_run_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (job_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        replayed_at = row["replayed_at"]
        payload_json = json.loads(row["payload_json"] or "{}")
        failure_context = payload_json.get("failure_context", {})
        failure_class = self._classify_failure(
            job_type=str(payload_json.get("job_type", "unknown")),
            failure_reason=row["failure_reason"],
        )
        recommended_action = RecommendedAction.INSPECT_AND_FIX
        if isinstance(failure_context, dict):
            stored_failure_class = failure_context.get("failure_class")
            if stored_failure_class in {FailureClass.TRANSIENT.value, FailureClass.TERMINAL.value}:
                failure_class = FailureClass(stored_failure_class)
            stored_action = failure_context.get("recommended_action")
            if stored_action in {
                RecommendedAction.NONE.value,
                RecommendedAction.WAIT_FOR_RETRY.value,
                RecommendedAction.REPLAY_SAFE.value,
                RecommendedAction.INSPECT_AND_FIX.value,
            }:
                recommended_action = RecommendedAction(stored_action)
        return DeadLetterJobSnapshot(
            id=row["id"],
            job_run_id=row["job_run_id"],
            payload_json=payload_json,
            failure_reason=row["failure_reason"],
            created_at=self._parse_dt(row["created_at"]),
            replayed_at=self._parse_dt(replayed_at) if replayed_at else None,
            status_class=JobStatusClass.TERMINAL_FAILURE,
            failure_class=failure_class,
            recommended_action=recommended_action,
        )

    def queue_depth(self) -> int:
        cursor = self._connection.execute(
            """
            SELECT COUNT(*) AS queue_depth
            FROM job_runs
            WHERE status IN (?, ?, ?)
            """,
            (JobRunStatus.QUEUED.value, JobRunStatus.RETRYING.value, JobRunStatus.RUNNING.value),
        )
        row = cursor.fetchone()
        return int(row["queue_depth"]) if row is not None else 0

    def _record_queue_metrics(self, *, job: JobRunSnapshot, action: str) -> None:
        self._observability.increment_counter(
            "splice_api_background_jobs_total",
            labels={"job_type": job.job_type, "status": job.status.value, "action": action},
            help_text="Background jobs by type and status transitions.",
        )
        self._observability.set_gauge(
            "splice_api_background_job_queue_depth",
            value=float(self.queue_depth()),
            help_text="Current queue depth for queued/retrying/running background jobs.",
        )

    def _record_failure_telemetry(self, *, job: JobRunSnapshot, failure_reason: str) -> None:
        linked_entity = self._resolve_linked_entity(job)
        remediation_link = f"/admin/jobs/{job.id}"
        failure_class = job.failure_class or self._classify_failure(
            job_type=job.job_type,
            failure_reason=failure_reason,
        )

        if job.job_type.startswith("integration."):
            self._observability.record_failure_class(
                failure_class=IncidentFailureClass.INTEGRATION_FAILURE,
                source="background-job-queue",
                severity=(
                    IncidentSeverity.WARNING
                    if job.status == JobRunStatus.RETRYING
                    else IncidentSeverity.CRITICAL
                ),
                note=(
                    f"Integration failure for job {job.id} "
                    f"(attempt {job.attempt_count}/{job.max_attempts}): {failure_reason}"
                ),
                linked_entity=linked_entity,
                correlation_id=job.correlation_id,
                remediation_link=remediation_link,
            )

        if job.status == JobRunStatus.DEAD_LETTERED:
            self._observability.record_failure_class(
                failure_class=IncidentFailureClass.RETRY_EXHAUSTION,
                source="background-job-queue",
                note=(
                    f"Retry exhaustion for job {job.id} "
                    f"after {job.attempt_count} attempts: {failure_reason}"
                ),
                linked_entity=linked_entity,
                correlation_id=job.correlation_id,
                remediation_link=remediation_link,
            )
            if job.job_type == "release.trigger" and failure_class == FailureClass.TERMINAL:
                self._observability.record_failure_class(
                    failure_class=IncidentFailureClass.SCHEDULING_TERMINAL_FAILURE,
                    source="release-scheduler-worker",
                    note=(
                        f"Terminal scheduling failure for release job {job.id}: {failure_reason}"
                    ),
                    linked_entity=linked_entity,
                    correlation_id=job.correlation_id,
                    remediation_link=remediation_link,
                )
