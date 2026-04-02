from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from threading import Lock
from typing import TYPE_CHECKING

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.logging import get_logger
from app.core.observability import ObservabilityService
from app.features.jobs.contracts import (
    FailureClass,
    JobRunSnapshot,
    JobRunStatus,
    JobsSchedulingErrorCode,
    JobStatusClass,
    RecommendedAction,
    ReplayJobResult,
)
from app.features.submissions.contracts import TransitionErrorCode

if TYPE_CHECKING:
    from .worker import BackgroundExecutor

JobHandler = Callable[[JobRunSnapshot], None]
logger = get_logger(__name__)


class JobQueueBaseMixin:
    """Core state and helper logic for BackgroundJobQueueService."""

    _TRANSIENT_ERROR_CODES: frozenset[str] = frozenset(
        {
            TransitionErrorCode.VERSION_CONFLICT.value,
            JobsSchedulingErrorCode.SCHEDULE_NOT_DUE.value,
        }
    )

    def __init__(
        self,
        *,
        observability: ObservabilityService,
        connection: sqlite3.Connection | None = None,
        start_executor: bool = True,
    ) -> None:
        self._observability = observability
        self._connection = connection or get_connection()
        self._handlers: dict[str, JobHandler] = {}
        self._write_lock = Lock()
        self._ensure_replay_request_schema()

        # This will be initialized in the engine
        self._executor: BackgroundExecutor | None = None

    def _fetch_job(self, job_id: str) -> JobRunSnapshot | None:
        cursor = self._connection.execute("SELECT * FROM job_runs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return self._row_to_job(row) if row is not None else None

    def _fetch_job_by_idempotency(self, idempotency_key: str) -> JobRunSnapshot | None:
        cursor = self._connection.execute(
            "SELECT * FROM job_runs WHERE idempotency_key = ?",
            (idempotency_key,),
        )
        row = cursor.fetchone()
        return self._row_to_job(row) if row is not None else None

    def _fetch_replay_result(self, request_key: str) -> ReplayJobResult | None:
        cursor = self._connection.execute(
            "SELECT response_json FROM job_replay_requests WHERE request_key = ?",
            (request_key,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return ReplayJobResult.model_validate_json(row["response_json"])

    def _row_to_job(self, row: sqlite3.Row) -> JobRunSnapshot:
        status = JobRunStatus(row["status"])
        failure_class = self._failure_class_for(
            status=status,
            job_type=row["job_type"],
            failure_reason=row["last_error"],
        )
        return JobRunSnapshot(
            id=row["id"],
            job_type=row["job_type"],
            idempotency_key=row["idempotency_key"],
            status=status,
            attempt_count=row["attempt_count"],
            max_attempts=row["max_attempts"],
            payload_json=json.loads(row["payload_json"] or "{}"),
            correlation_id=row["correlation_id"],
            created_at=self._parse_dt(row["created_at"]),
            started_at=self._parse_dt(row["started_at"]) if row["started_at"] else None,
            ended_at=self._parse_dt(row["ended_at"]) if row["ended_at"] else None,
            scheduled_for=self._parse_dt(row["scheduled_for"]) if row["scheduled_for"] else None,
            next_retry_at=self._parse_dt(row["next_retry_at"]) if row["next_retry_at"] else None,
            last_error=row["last_error"],
            status_class=self._status_class_for(status),
            failure_class=failure_class,
            recommended_action=self._recommended_action(
                status=status,
                failure_class=failure_class,
            ),
        )

    def _job_params(self, job: JobRunSnapshot) -> tuple[object, ...]:
        return (
            job.id,
            job.job_type,
            job.idempotency_key,
            job.status.value,
            job.attempt_count,
            job.max_attempts,
            json.dumps(job.payload_json),
            job.correlation_id,
            self._dt(job.created_at),
            self._dt(job.scheduled_for),
            self._dt(job.started_at),
            self._dt(job.ended_at),
            self._dt(job.next_retry_at),
            job.last_error,
        )

    @staticmethod
    def _replay_request_key(job_id: str, request_id: str) -> str:
        return f"{job_id}:{request_id}"

    def _ensure_replay_request_schema(self) -> None:
        with self._connection:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_replay_requests (
                  request_key TEXT PRIMARY KEY,
                  job_run_id TEXT NOT NULL,
                  request_id TEXT NOT NULL,
                  actor_id TEXT NOT NULL,
                  reason TEXT NOT NULL,
                  response_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(job_run_id, request_id)
                )
                """
            )

    @staticmethod
    def _dt(value: datetime | None) -> str | None:
        return value.astimezone(UTC).isoformat() if value is not None else None

    @staticmethod
    def _parse_dt(value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed

    @staticmethod
    def _status_class_for(status: JobRunStatus) -> JobStatusClass:
        mapping = {
            JobRunStatus.QUEUED: JobStatusClass.READY,
            JobRunStatus.RUNNING: JobStatusClass.RUNNING,
            JobRunStatus.RETRYING: JobStatusClass.PENDING_RETRY,
            JobRunStatus.SUCCEEDED: JobStatusClass.COMPLETED,
            JobRunStatus.FAILED: JobStatusClass.TERMINAL_FAILURE,
            JobRunStatus.DEAD_LETTERED: JobStatusClass.TERMINAL_FAILURE,
        }
        return mapping[status]

    @staticmethod
    def _classify_failure(*, job_type: str, failure_reason: str | None) -> FailureClass:
        if failure_reason is None:
            return FailureClass.TERMINAL
        reason_lower = failure_reason.lower()
        transient_markers = (
            "timeout",
            "temporar",
            "connection",
            "service_unavailable",
            "database is locked",
            "rate_limit",
        )
        terminal_markers = (
            "schedule_not_found",
            "schedule_submission_mismatch",
            "transition_forbidden",
            "transition_not_allowed",
            "missing_preferred_release_month",
            "missing submission_id",
            "worker-release-timeout",
        )
        if any(marker in reason_lower for marker in terminal_markers):
            return FailureClass.TERMINAL
        if job_type == "release.trigger" and "schedule_not_due" in reason_lower:
            return FailureClass.TRANSIENT
        if any(marker in reason_lower for marker in transient_markers):
            return FailureClass.TRANSIENT
        return FailureClass.TRANSIENT

    def _failure_class_for(
        self,
        *,
        status: JobRunStatus,
        job_type: str,
        failure_reason: str | None,
    ) -> FailureClass | None:
        if status not in {JobRunStatus.RETRYING, JobRunStatus.FAILED, JobRunStatus.DEAD_LETTERED}:
            return None
        return self._classify_failure(job_type=job_type, failure_reason=failure_reason)

    @staticmethod
    def _recommended_action(
        *,
        status: JobRunStatus,
        failure_class: FailureClass | None,
    ) -> RecommendedAction:
        if status == JobRunStatus.RETRYING:
            return RecommendedAction.WAIT_FOR_RETRY
        if status in {JobRunStatus.FAILED, JobRunStatus.DEAD_LETTERED}:
            if failure_class == FailureClass.TERMINAL:
                return RecommendedAction.INSPECT_AND_FIX
            return RecommendedAction.REPLAY_SAFE
        return RecommendedAction.NONE

    def _classify_execution_failure(self, exc: Exception) -> dict[str, object]:
        if isinstance(exc, DomainError):
            code_value = exc.code.value if hasattr(exc.code, "value") else str(exc.code)
            code = str(code_value)
            if code in self._TRANSIENT_ERROR_CODES:
                return {"terminal": False, "failure_reason": f"{code}: {exc.message}"}
            if exc.status_code >= 500:
                return {"terminal": False, "failure_reason": f"{code}: {exc.message}"}
            return {"terminal": True, "failure_reason": f"{code}: {exc.message}"}
        if isinstance(exc, sqlite3.Error):
            return {"terminal": False, "failure_reason": str(exc)}
        return {"terminal": False, "failure_reason": str(exc)}

    def _resolve_linked_entity(self, job: JobRunSnapshot) -> str:
        submission_id = str(job.payload_json.get("submission_id", "")).strip()
        if submission_id:
            return f"submission:{submission_id}"
        return f"job:{job.id}"
