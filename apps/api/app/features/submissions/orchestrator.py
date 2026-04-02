"""SQLite-backed integration orchestrator for PRD-09 cycle boundary contracts."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from app.core.db.session import get_connection, init_db
from app.core.errors import DomainError
from app.features.jobs.contracts import (
    FailureClass,
    JobRunStatus,
    JobStatusClass,
    RecommendedAction,
)
from app.features.submissions.contracts import (
    SUBMISSION_APPROVED_SCHEDULING_EVENT,
    IntegrationEvent,
    OrchestrationResult,
    SchedulingTriggerEvent,
    SubmissionState,
    TransitionDomainEvent,
    TransitionErrorCode,
)


class IntegrationOrchestratorService:
    """Consumes transition events and emits deterministic integration intents."""

    _JOB_TYPE_BY_TARGET = {
        "airtable": "integration.airtable.sync",
        "dropbox": "integration.dropbox.delivery",
    }
    _MAX_ATTEMPTS_BY_TARGET = {
        "airtable": 3,
        "dropbox": 3,
    }

    def __init__(self, connection: sqlite3.Connection | None = None) -> None:
        if connection is None:
            init_db()
            connection = get_connection()
        self._connection = connection

    def reset(self) -> None:
        self._connection.execute("DELETE FROM integration_event_log")
        self._connection.execute("DELETE FROM integration_outcomes")
        self._connection.execute(
            """
            DELETE FROM dead_letter_jobs
            WHERE job_run_id IN (
                SELECT id FROM job_runs WHERE job_type LIKE 'integration.%'
            )
            """
        )
        self._connection.execute(
            "DELETE FROM job_runs WHERE job_type LIKE 'integration.%'"
        )
        self._connection.commit()

    def consume_transition_event(self, event: TransitionDomainEvent) -> OrchestrationResult:
        existing = self._connection.execute(
            """
            SELECT submission_id, transition_event_id, integration_events_json
            FROM integration_outcomes
            WHERE idempotency_key = ?
            """,
            (event.idempotency_key,),
        ).fetchone()
        if existing is not None:
            integration_events = [
                IntegrationEvent(**payload)
                for payload in json.loads(existing["integration_events_json"] or "[]")
            ]
            with self._connection:
                self._ensure_provider_jobs(
                    integration_events,
                    source_transition_event=event,
                )
            return OrchestrationResult(
                transition_event_id=existing["transition_event_id"],
                submission_id=existing["submission_id"],
                idempotent=True,
                integration_events=self._enrich_integration_events(integration_events),
            )

        integration_events = self._build_integration_events(event)
        now = datetime.now(tz=UTC)
        serialized_events = [item.model_dump(mode="json") for item in integration_events]

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO integration_outcomes (
                    idempotency_key,
                    submission_id,
                    transition_event_id,
                    integration_events_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    event.idempotency_key,
                    event.submission_id,
                    event.event_id,
                    json.dumps(serialized_events),
                    now.isoformat(),
                ),
            )
            self._persist_integration_events(
                integration_events,
                source_transition_event=event,
            )

        return OrchestrationResult(
            transition_event_id=event.event_id,
            submission_id=event.submission_id,
            idempotent=False,
            integration_events=self._enrich_integration_events(integration_events),
        )

    def list_integration_events(self, submission_id: str) -> list[IntegrationEvent]:
        rows = self._connection.execute(
            """
            SELECT target, event_name, payload_json, emitted_at
            FROM integration_event_log
            WHERE submission_id = ?
            ORDER BY emitted_at ASC
            """,
            (submission_id,),
        ).fetchall()
        events = [
            IntegrationEvent(
                target=row["target"],
                event_name=row["event_name"],
                emitted_at=datetime.fromisoformat(row["emitted_at"]),
                payload=json.loads(row["payload_json"] or "{}"),
            )
            for row in rows
        ]
        return self._enrich_integration_events(events)

    def _persist_integration_events(
        self,
        integration_events: list[IntegrationEvent],
        *,
        source_transition_event: TransitionDomainEvent,
    ) -> None:
        for integration_event in integration_events:
            self._connection.execute(
                """
                INSERT INTO integration_event_log (
                    id,
                    submission_id,
                    target,
                    event_name,
                    payload_json,
                    emitted_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    source_transition_event.submission_id,
                    integration_event.target,
                    integration_event.event_name,
                    json.dumps(integration_event.model_dump(mode="json")["payload"]),
                    integration_event.emitted_at.isoformat(),
                ),
            )
            self._ensure_provider_job(
                integration_event,
                source_transition_event=source_transition_event,
            )

    def _ensure_provider_jobs(
        self,
        integration_events: list[IntegrationEvent],
        *,
        source_transition_event: TransitionDomainEvent,
    ) -> None:
        for integration_event in integration_events:
            self._ensure_provider_job(
                integration_event,
                source_transition_event=source_transition_event,
            )

    def _ensure_provider_job(
        self,
        integration_event: IntegrationEvent,
        *,
        source_transition_event: TransitionDomainEvent,
    ) -> None:
        job_type = self._JOB_TYPE_BY_TARGET.get(integration_event.target)
        if job_type is None:
            return

        source_event_id = str(
            integration_event.payload.get("source_event_id")
            or source_transition_event.event_id
        )
        source_event_name = str(
            integration_event.payload.get("source_event_name")
            or source_transition_event.event_name
        )

        job_idempotency_key = self._job_idempotency_key(
            target=integration_event.target,
            source_event_id=source_event_id,
            integration_event=integration_event,
        )
        existing = self._connection.execute(
            """
            SELECT id
            FROM job_runs
            WHERE idempotency_key = ?
            """,
            (job_idempotency_key,),
        ).fetchone()
        if existing is not None:
            return

        job_id = f"job:{uuid4().hex}"
        now = datetime.now(tz=UTC)
        payload = self._provider_job_payload(
            integration_event=integration_event,
            source_event_id=source_event_id,
            source_event_name=source_event_name,
            job_idempotency_key=job_idempotency_key,
            job_type=job_type,
        )
        self._connection.execute(
            """
            INSERT INTO job_runs (
              id, job_type, idempotency_key, status, attempt_count, max_attempts,
              payload_json, correlation_id, created_at, scheduled_for,
              started_at, ended_at, next_retry_at, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                job_type,
                job_idempotency_key,
                JobRunStatus.QUEUED.value,
                0,
                self._MAX_ATTEMPTS_BY_TARGET[integration_event.target],
                json.dumps(payload),
                source_transition_event.event_id,
                now.isoformat(),
                integration_event.emitted_at.isoformat(),
                None,
                None,
                None,
                None,
            ),
        )

    def _provider_job_payload(
        self,
        *,
        integration_event: IntegrationEvent,
        source_event_id: str,
        source_event_name: str,
        job_idempotency_key: str,
        job_type: str,
    ) -> dict[str, object]:
        return {
            "submission_id": str(integration_event.payload.get("submission_id", "")),
            "transition_event_id": source_event_id,
            "transition_version": integration_event.payload.get("source_transition_version"),
            "source_event_name": source_event_name,
            "integration_event_name": integration_event.event_name,
            "target": integration_event.target,
            "job_type": job_type,
            "job_idempotency_key": job_idempotency_key,
            "payload": integration_event.payload,
        }

    def _job_idempotency_key(
        self,
        *,
        target: str,
        source_event_id: str,
        integration_event: IntegrationEvent,
    ) -> str:
        return (
            f"{self._JOB_TYPE_BY_TARGET[target]}:"
            f"{source_event_id}:"
            f"{integration_event.event_name}"
        )

    def _enrich_integration_event(self, integration_event: IntegrationEvent) -> IntegrationEvent:
        enriched = self._enrich_integration_events([integration_event])
        return enriched[0] if enriched else integration_event

    def _enrich_integration_events(
        self,
        integration_events: list[IntegrationEvent],
    ) -> list[IntegrationEvent]:
        snapshots = self._job_status_snapshots_for_events(integration_events)
        enriched_events: list[IntegrationEvent] = []
        for integration_event in integration_events:
            key = self._integration_event_job_idempotency_key(integration_event)
            job_status = snapshots.get(key) if key is not None else None
            if job_status is None:
                enriched_events.append(integration_event)
                continue
            payload = dict(integration_event.payload)
            payload.update(job_status)
            enriched_events.append(integration_event.model_copy(update={"payload": payload}))
        return enriched_events

    def _integration_event_job_idempotency_key(self, integration_event: IntegrationEvent) -> str | None:
        job_type = self._JOB_TYPE_BY_TARGET.get(integration_event.target)
        if job_type is None:
            return None
        source_event_id = integration_event.payload.get("source_event_id")
        if not isinstance(source_event_id, str) or not source_event_id:
            return None
        return f"{job_type}:{source_event_id}:{integration_event.event_name}"

    def _job_status_snapshots_for_events(
        self,
        integration_events: list[IntegrationEvent],
    ) -> dict[str, dict[str, object]]:
        idempotency_keys: list[str] = []
        for integration_event in integration_events:
            key = self._integration_event_job_idempotency_key(integration_event)
            if key is not None and key not in idempotency_keys:
                idempotency_keys.append(key)

        if not idempotency_keys:
            return {}

        placeholders = ",".join("?" for _ in idempotency_keys)
        job_rows = self._connection.execute(
            f"""
            SELECT id, job_type, idempotency_key, status, attempt_count, max_attempts,
                   next_retry_at, last_error
            FROM job_runs
            WHERE idempotency_key IN ({placeholders})
            """,
            tuple(idempotency_keys),
        ).fetchall()
        if not job_rows:
            return {}

        dead_letter_rows = self._dead_letter_rows_by_job_id(
            [row["id"] for row in job_rows]
        )
        snapshots: dict[str, dict[str, object]] = {}
        for job_row in job_rows:
            snapshots[job_row["idempotency_key"]] = self._job_status_snapshot_from_rows(
                job_row,
                dead_letter_rows.get(job_row["id"]),
            )
        return snapshots

    def _dead_letter_rows_by_job_id(
        self,
        job_ids: list[str],
    ) -> dict[str, sqlite3.Row]:
        if not job_ids:
            return {}

        placeholders = ",".join("?" for _ in job_ids)
        rows = self._connection.execute(
            f"""
            SELECT id, job_run_id, failure_reason, created_at, replayed_at
            FROM dead_letter_jobs
            WHERE job_run_id IN ({placeholders})
            ORDER BY created_at DESC, id DESC
            """,
            tuple(job_ids),
        ).fetchall()
        dead_letters: dict[str, sqlite3.Row] = {}
        for row in rows:
            job_id = row["job_run_id"]
            if job_id not in dead_letters:
                dead_letters[job_id] = row
        return dead_letters

    def _job_status_snapshot_from_rows(
        self,
        job_row: sqlite3.Row,
        dead_letter_row: sqlite3.Row | None,
    ) -> dict[str, object]:
        status = JobRunStatus(job_row["status"])
        failure_class = self._failure_class_for(
            status=status,
            job_type=job_row["job_type"],
            failure_reason=job_row["last_error"],
        )
        recommended_action = self._recommended_action(
            status=status,
            failure_class=failure_class,
        )
        snapshot: dict[str, object] = {
            "job_id": job_row["id"],
            "job_type": job_row["job_type"],
            "job_status": status.value,
            "job_status_class": self._status_class_for(status).value,
            "job_attempt_count": job_row["attempt_count"],
            "job_max_attempts": job_row["max_attempts"],
            "job_next_retry_at": job_row["next_retry_at"],
            "job_last_error": job_row["last_error"],
            "job_failure_class": failure_class.value if failure_class is not None else None,
            "job_recommended_action": recommended_action.value,
        }
        if dead_letter_row is not None:
            snapshot.update(
                {
                    "job_dead_letter_id": dead_letter_row["id"],
                    "job_dead_letter_failure_reason": dead_letter_row["failure_reason"],
                    "job_dead_letter_replayed_at": dead_letter_row["replayed_at"],
                }
            )
        return snapshot

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
    def _failure_class_for(
        *,
        status: JobRunStatus,
        job_type: str,
        failure_reason: str | None,
    ) -> FailureClass | None:
        if status not in {
            JobRunStatus.RETRYING,
            JobRunStatus.FAILED,
            JobRunStatus.DEAD_LETTERED,
        }:
            return None
        if failure_reason is None:
            return FailureClass.TERMINAL

        reason_lower = failure_reason.lower()
        if job_type == "release.trigger" and "schedule_not_due" in reason_lower:
            return FailureClass.TRANSIENT

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
        )
        if any(marker in reason_lower for marker in terminal_markers):
            return FailureClass.TERMINAL
        if any(marker in reason_lower for marker in transient_markers):
            return FailureClass.TRANSIENT
        return FailureClass.TRANSIENT

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

    def _build_integration_events(self, event: TransitionDomainEvent) -> list[IntegrationEvent]:
        if event.to_state == SubmissionState.APPROVED:
            return self._build_approved_events(event)
        if event.to_state == SubmissionState.REJECTED:
            return [
                IntegrationEvent(
                    target="airtable",
                    event_name="submission.rejected",
                    emitted_at=datetime.now(tz=UTC),
                    payload={
                        "submission_id": event.submission_id,
                        "rejected_at": event.occurred_at.isoformat(),
                        "reason": event.reason,
                        "actor_id": event.actor_id,
                        "source_event_id": event.event_id,
                        "source_event_name": event.event_name,
                        "source_transition_version": event.transition_version,
                        "status_class": "success",
                        "recommended_action": "none",
                    },
                )
            ]
        if event.to_state == SubmissionState.SCHEDULED:
            return [
                IntegrationEvent(
                    target="airtable",
                    event_name="submission.scheduled",
                    emitted_at=datetime.now(tz=UTC),
                    payload={
                        "submission_id": event.submission_id,
                        "scheduled_at": event.occurred_at.isoformat(),
                        "source_event_id": event.event_id,
                        "source_event_name": event.event_name,
                        "source_transition_version": event.transition_version,
                        "status_class": "success",
                        "recommended_action": "none",
                    },
                )
            ]
        return []

    def _build_approved_events(self, event: TransitionDomainEvent) -> list[IntegrationEvent]:
        if event.preferred_release_month is None:
            raise DomainError(
                code=TransitionErrorCode.MISSING_PREFERRED_RELEASE_MONTH,
                message="Approved transitions must include preferred_release_month.",
                status_code=422,
                details={"submission_id": event.submission_id},
            )

        scheduling_event = SchedulingTriggerEvent(
            event_name=SUBMISSION_APPROVED_SCHEDULING_EVENT,
            schema_version=1,
            submission_id=event.submission_id,
            preferred_release_month=event.preferred_release_month,
            idempotency_key=(
                f"{SUBMISSION_APPROVED_SCHEDULING_EVENT}:"
                f"{event.submission_id}:{event.transition_version}"
            ),
            approved_at=event.occurred_at,
            triggered_by=event.actor_id,
            correlation_id=event.event_id,
        )

        return [
            IntegrationEvent(
                target="airtable",
                event_name="submission.approved",
                emitted_at=datetime.now(tz=UTC),
                payload={
                    "submission_id": event.submission_id,
                    "approved_at": event.occurred_at.isoformat(),
                    "actor_id": event.actor_id,
                    "source_event_id": event.event_id,
                    "source_event_name": event.event_name,
                    "source_transition_version": event.transition_version,
                    "status_class": "success",
                    "recommended_action": "none",
                },
            ),
            IntegrationEvent(
                target="release-scheduler",
                event_name=SUBMISSION_APPROVED_SCHEDULING_EVENT,
                emitted_at=datetime.now(tz=UTC),
                payload=scheduling_event.model_dump(mode="json"),
            ),
            IntegrationEvent(
                target="dropbox",
                event_name="submission.delivery.enqueue.v1",
                emitted_at=datetime.now(tz=UTC),
                payload={
                    "submission_id": event.submission_id,
                    "source_event_id": event.event_id,
                    "source_event_name": event.event_name,
                    "source_transition_version": event.transition_version,
                    "status_class": "queued",
                    "recommended_action": "none",
                },
            ),
        ]
