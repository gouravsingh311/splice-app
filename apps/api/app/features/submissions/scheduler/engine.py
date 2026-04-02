"""PRD-17 scheduler service core engine."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from threading import Lock

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.logging import get_logger
from app.core.observability import ObservabilityService
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType
from app.features.audit.service import AuditEventStore
from app.features.jobs.contracts import (
    JobRunStatus,
    JobsSchedulingErrorCode,
    ReleaseScheduleSnapshot,
    ReleaseTriggerRequest,
    ReleaseTriggerResult,
    ScheduleOverrideRequest,
    ScheduleOverrideResult,
    ScheduleOverrideSnapshot,
    ScheduleResolveRequest,
    ScheduleResolveResult,
    ScheduleSource,
)
from app.features.jobs.service import BackgroundJobQueueService
from app.features.submissions.contracts import (
    SubmissionState,
    TransitionErrorCode,
    TransitionRequest,
)
from app.features.submissions.service import SubmissionWorkflowService

from .jobs import SchedulerJobsMixIn
from .persistence import SchedulerPersistenceMixIn

SCHEDULE_RESOLVED_EVENT = "submission.release.schedule.resolved.v1"
SCHEDULE_OVERRIDDEN_EVENT = "submission.release.schedule.overridden.v1"
RELEASE_TRIGGERED_EVENT = "submission.release.triggered.v1"
logger = get_logger(__name__)


class ReleaseSchedulerService(SchedulerPersistenceMixIn, SchedulerJobsMixIn):
    """Coordinates schedule resolution, overrides, and release trigger execution."""

    def __init__(
        self,
        *,
        workflow: SubmissionWorkflowService,
        jobs: BackgroundJobQueueService,
        observability: ObservabilityService,
        audit: AuditEventStore,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self._workflow = workflow
        self._jobs = jobs
        self._observability = observability
        self._audit = audit
        self._connection = connection or get_connection()
        self._lock = Lock()

        self._jobs.register_handler("release.trigger", self._execute_release_job)

    def _raise_replay_payload_mismatch(
        self,
        *,
        submission_id: str,
        request_id: str,
        mismatches: dict[str, dict[str, object | None]],
    ) -> None:
        raise DomainError(
            code=TransitionErrorCode.VERSION_CONFLICT,
            message="Request replay payload does not match the original scheduler operation.",
            status_code=409,
            details={
                "submission_id": submission_id,
                "request_id": request_id,
                "mismatches": mismatches,
            },
        )

    def _validate_request_snapshot(
        self,
        *,
        submission_id: str,
        request_id: str,
        stored: dict[str, object] | None,
        expected: dict[str, object],
    ) -> None:
        if stored is None:
            return
        mismatches: dict[str, dict[str, object | None]] = {}
        for key, expected_value in expected.items():
            stored_value = stored.get(key)
            if stored_value != expected_value:
                mismatches[key] = {"existing": stored_value, "requested": expected_value}
        if mismatches:
            self._raise_replay_payload_mismatch(
                submission_id=submission_id,
                request_id=request_id,
                mismatches=mismatches,
            )

    def _resolve_request_snapshot(
        self, payload: ScheduleResolveRequest
    ) -> dict[str, object]:
        return {
            "request_id": payload.request_id,
            "timezone": payload.timezone,
            "scheduling_event": payload.scheduling_event.model_dump(mode="json"),
        }

    def _override_request_snapshot(
        self, payload: ScheduleOverrideRequest
    ) -> dict[str, object]:
        return {
            "request_id": payload.request_id,
            "new_release_at": payload.new_release_at.isoformat(),
            "reason": payload.reason,
            "actor_id": payload.actor_id,
            "actor_role": payload.actor_role.value,
            "timezone": payload.timezone,
        }

    def _trigger_request_snapshot(
        self, payload: ReleaseTriggerRequest
    ) -> dict[str, object]:
        return {
            "request_id": payload.request_id,
            "actor_id": payload.actor_id,
            "actor_role": payload.actor_role.value,
            "force": payload.force,
        }

    def _resolve_audit_idempotency_key(
        self, submission_id: str, payload: ScheduleResolveRequest
    ) -> str:
        return f"schedule.resolve:{submission_id}:{payload.scheduling_event.idempotency_key}"

    def _override_audit_idempotency_key(
        self, submission_id: str, payload: ScheduleOverrideRequest
    ) -> str:
        return f"schedule.override:{submission_id}:{payload.request_id}"

    def _trigger_audit_idempotency_key(
        self, submission_id: str, payload: ReleaseTriggerRequest
    ) -> str:
        return f"schedule.release:{submission_id}:{payload.request_id}"

    def resolve_schedule(
        self,
        submission_id: str,
        payload: ScheduleResolveRequest,
    ) -> ScheduleResolveResult:
        logger.info(
            "Resolving schedule.",
            extra={"submission_id": submission_id, "request_id": payload.request_id},
        )
        event = payload.scheduling_event
        if event.submission_id != submission_id:
            raise DomainError(
                code=JobsSchedulingErrorCode.SCHEDULE_SUBMISSION_MISMATCH,
                message="Path submission id does not match scheduling event submission id.",
                status_code=422,
                details={
                    "path_submission_id": submission_id,
                    "event_submission_id": event.submission_id,
                },
            )

        request_snapshot = self._resolve_request_snapshot(payload)
        audit_idempotency_key = self._resolve_audit_idempotency_key(submission_id, payload)

        with self._lock:
            previous_schedule = self._fetch_schedule(submission_id)
            audit_metadata = self._fetch_audit_metadata(audit_idempotency_key)
            if audit_metadata is not None:
                self._validate_request_snapshot(
                    submission_id=submission_id,
                    request_id=payload.request_id,
                    stored=audit_metadata.get("request"),
                    expected=request_snapshot,
                )
                if previous_schedule is None:
                    raise DomainError(
                        code=TransitionErrorCode.VERSION_CONFLICT,
                        message="Resolved schedule replay is missing its persisted schedule state.",
                        status_code=409,
                        details={"submission_id": submission_id, "request_id": payload.request_id},
                    )
                release_job = self._fetch_job_by_idempotency_key(
                    f"release.trigger:{submission_id}:{previous_schedule.version}"
                )
                if release_job is None:
                    release_job = self._enqueue_release_job(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        schedule=previous_schedule,
                        correlation_id=event.correlation_id,
                    )
                return ScheduleResolveResult(
                    idempotent=True,
                    schedule=previous_schedule,
                    release_job=release_job,
                )

            existing_transition = self._fetch_transition_row(
                submission_id,
                f"{payload.request_id}:schedule-resolve",
            )
            planned_release_at = self._planned_release_datetime(
                preferred_month=event.preferred_release_month,
                timezone=payload.timezone,
            )
            if existing_transition is not None:
                if existing_transition["actor_id"] != event.triggered_by:
                    self._raise_replay_payload_mismatch(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        mismatches={
                            "triggered_by": {
                                "existing": existing_transition["actor_id"],
                                "requested": event.triggered_by,
                            }
                        },
                    )
                if previous_schedule is None:
                    previous_schedule = ReleaseScheduleSnapshot(
                        submission_id=submission_id,
                        preferred_month=event.preferred_release_month,
                        planned_release_at=planned_release_at,
                        timezone=payload.timezone,
                        source=ScheduleSource.APPROVAL_EVENT,
                        updated_by=event.triggered_by,
                        updated_at=datetime.now(tz=UTC),
                        version=1,
                    )
                    self._upsert_schedule(previous_schedule)
                mismatches: dict[str, dict[str, object | None]] = {}
                if previous_schedule.preferred_month != event.preferred_release_month:
                    mismatches["preferred_release_month"] = {
                        "existing": previous_schedule.preferred_month,
                        "requested": event.preferred_release_month,
                    }
                if previous_schedule.timezone != payload.timezone:
                    mismatches["timezone"] = {
                        "existing": previous_schedule.timezone,
                        "requested": payload.timezone,
                    }
                if previous_schedule.source != ScheduleSource.APPROVAL_EVENT:
                    mismatches["source"] = {
                        "existing": previous_schedule.source.value,
                        "requested": ScheduleSource.APPROVAL_EVENT.value,
                    }
                if mismatches:
                    self._raise_replay_payload_mismatch(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        mismatches=mismatches,
                    )
                release_job = self._fetch_job_by_idempotency_key(
                    f"release.trigger:{submission_id}:{previous_schedule.version}"
                )
                if release_job is None:
                    release_job = self._enqueue_release_job(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        schedule=previous_schedule,
                        correlation_id=event.correlation_id,
                    )
                return ScheduleResolveResult(
                    idempotent=True,
                    schedule=previous_schedule,
                    release_job=release_job,
                )

            schedule_version = 1 if previous_schedule is None else previous_schedule.version + 1
            planned_release_at = self._planned_release_datetime(
                preferred_month=event.preferred_release_month,
                timezone=payload.timezone,
            )
            now = datetime.now(tz=UTC)
            schedule = ReleaseScheduleSnapshot(
                submission_id=submission_id,
                preferred_month=event.preferred_release_month,
                planned_release_at=planned_release_at,
                timezone=payload.timezone,
                source=ScheduleSource.APPROVAL_EVENT,
                updated_by=event.triggered_by,
                updated_at=now,
                version=schedule_version,
            )

            transition_result = self._workflow.transition_submission(
                submission_id,
                TransitionRequest(
                    request_id=f"{payload.request_id}:schedule-resolve",
                    to_state=SubmissionState.SCHEDULED,
                    actor_id=event.triggered_by,
                    actor_role="system",
                    reason="Schedule resolved from approved scheduling event.",
                    metadata={
                        "scheduled_for": planned_release_at.isoformat(),
                        "timezone": payload.timezone,
                        "source_event": event.event_name,
                    },
                ),
            )
            self._upsert_schedule(schedule)
            release_job = self._enqueue_release_job(
                submission_id=submission_id,
                request_id=payload.request_id,
                schedule=schedule,
                correlation_id=event.correlation_id,
            )

            result = ScheduleResolveResult(
                idempotent=False,
                schedule=schedule,
                release_job=release_job,
            )

        self._observability.increment_counter(
            "splice_api_release_schedule_resolve_total",
            labels={"source": schedule.source.value},
            help_text="Total release schedule resolve operations.",
        )
        self._audit.append_event(
            AuditAppendRequest(
                actor_id=event.triggered_by,
                action=AuditAction.submission_schedule_resolved,
                entity_type=AuditEntityType.submission,
                entity_id=submission_id,
                metadata={
                    "event_name": SCHEDULE_RESOLVED_EVENT,
                    "correlation_id": event.correlation_id,
                    "planned_release_at": schedule.planned_release_at.isoformat(),
                    "timezone": schedule.timezone,
                    "submission_state": transition_result.submission.current_state.value,
                    "request": request_snapshot,
                },
                request_id=payload.request_id,
                idempotency_key=audit_idempotency_key,
            )
        )
        return result

    def override_schedule(
        self, submission_id: str, payload: ScheduleOverrideRequest
    ) -> ScheduleOverrideResult:
        logger.info(
            "Overriding schedule.",
            extra={"submission_id": submission_id, "request_id": payload.request_id},
        )
        request_snapshot = self._override_request_snapshot(payload)
        audit_idempotency_key = self._override_audit_idempotency_key(submission_id, payload)
        override_id = f"override:{submission_id}:{payload.request_id}"
        with self._lock:
            current_schedule = self._fetch_schedule(submission_id)
            audit_metadata = self._fetch_audit_metadata(audit_idempotency_key)
            if audit_metadata is not None:
                self._validate_request_snapshot(
                    submission_id=submission_id,
                    request_id=payload.request_id,
                    stored=audit_metadata.get("request"),
                    expected=request_snapshot,
                )
                if current_schedule is None:
                    raise DomainError(
                        code=TransitionErrorCode.VERSION_CONFLICT,
                        message="Schedule override replay is missing its persisted schedule state.",
                        status_code=409,
                        details={"submission_id": submission_id, "request_id": payload.request_id},
                    )
                override_record = self._fetch_override(override_id)
                if override_record is None:
                    raise DomainError(
                        code=TransitionErrorCode.VERSION_CONFLICT,
                        message="Schedule override replay is missing its persisted override record.",
                        status_code=409,
                        details={"submission_id": submission_id, "request_id": payload.request_id},
                    )
                release_job = self._fetch_job_by_idempotency_key(
                    f"release.trigger:{submission_id}:{current_schedule.version}"
                )
                if release_job is None:
                    release_job = self._enqueue_release_job(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        schedule=current_schedule,
                        correlation_id=f"override:{submission_id}:{override_record.id}",
                    )
                return ScheduleOverrideResult(
                    idempotent=True,
                    schedule=current_schedule,
                    override=override_record,
                    release_job=release_job,
                )

            existing_override = self._fetch_override(override_id)
            if existing_override is not None:
                if current_schedule is None:
                    raise DomainError(
                        code=TransitionErrorCode.VERSION_CONFLICT,
                        message="Schedule override replay is missing its current schedule state.",
                        status_code=409,
                        details={"submission_id": submission_id, "request_id": payload.request_id},
                    )
                mismatches: dict[str, dict[str, object | None]] = {}
                if existing_override.new_release_at != payload.new_release_at:
                    mismatches["new_release_at"] = {
                        "existing": existing_override.new_release_at.isoformat(),
                        "requested": payload.new_release_at.isoformat(),
                    }
                if existing_override.reason != payload.reason:
                    mismatches["reason"] = {
                        "existing": existing_override.reason,
                        "requested": payload.reason,
                    }
                if existing_override.actor_id != payload.actor_id:
                    mismatches["actor_id"] = {
                        "existing": existing_override.actor_id,
                        "requested": payload.actor_id,
                    }
                if current_schedule.timezone != payload.timezone:
                    mismatches["timezone"] = {
                        "existing": current_schedule.timezone,
                        "requested": payload.timezone,
                    }
                if current_schedule.source != ScheduleSource.MANUAL_OVERRIDE:
                    mismatches["source"] = {
                        "existing": current_schedule.source.value,
                        "requested": ScheduleSource.MANUAL_OVERRIDE.value,
                    }
                if mismatches:
                    self._raise_replay_payload_mismatch(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        mismatches=mismatches,
                    )
                release_job = self._fetch_job_by_idempotency_key(
                    f"release.trigger:{submission_id}:{current_schedule.version}"
                )
                if release_job is None:
                    release_job = self._enqueue_release_job(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        schedule=current_schedule,
                        correlation_id=f"override:{submission_id}:{existing_override.id}",
                    )
                return ScheduleOverrideResult(
                    idempotent=True,
                    schedule=current_schedule,
                    override=existing_override,
                    release_job=release_job,
                )

            if current_schedule is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.SCHEDULE_NOT_FOUND,
                    message=f"No schedule exists for submission {submission_id}.",
                    status_code=404,
                    details={"submission_id": submission_id},
                )

            now = datetime.now(tz=UTC)
            overridden_schedule = current_schedule.model_copy(
                update={
                    "planned_release_at": payload.new_release_at,
                    "timezone": payload.timezone,
                    "source": ScheduleSource.MANUAL_OVERRIDE,
                    "updated_by": payload.actor_id,
                    "updated_at": now,
                    "version": current_schedule.version + 1,
                }
            )
            override_record = ScheduleOverrideSnapshot(
                id=override_id,
                submission_id=submission_id,
                old_release_at=current_schedule.planned_release_at,
                new_release_at=payload.new_release_at,
                reason=payload.reason,
                actor_id=payload.actor_id,
                created_at=now,
            )

            self._upsert_schedule(overridden_schedule)
            self._insert_override(override_record)
            release_job = self._enqueue_release_job(
                submission_id=submission_id,
                request_id=payload.request_id,
                schedule=overridden_schedule,
                correlation_id=f"override:{submission_id}:{override_record.id}",
            )

            result = ScheduleOverrideResult(
                idempotent=False,
                schedule=overridden_schedule,
                override=override_record,
                release_job=release_job,
            )

        self._observability.increment_counter(
            "splice_api_release_schedule_override_total",
            labels={"actor_role": payload.actor_role.value},
            help_text="Total manual release schedule overrides.",
        )
        self._audit.append_event(
            AuditAppendRequest(
                actor_id=payload.actor_id,
                action=AuditAction.submission_schedule_overridden,
                entity_type=AuditEntityType.submission,
                entity_id=submission_id,
                before_json={"planned_release_at": override_record.old_release_at.isoformat()},
                after_json={"planned_release_at": override_record.new_release_at.isoformat()},
                metadata={
                    "event_name": SCHEDULE_OVERRIDDEN_EVENT,
                    "reason": payload.reason,
                    "timezone": payload.timezone,
                    "request": request_snapshot,
                },
                request_id=payload.request_id,
                idempotency_key=audit_idempotency_key,
            )
        )
        return result

    def trigger_release(
        self,
        submission_id: str,
        payload: ReleaseTriggerRequest,
    ) -> ReleaseTriggerResult:
        logger.info(
            "Triggering release operation.",
            extra={
                "submission_id": submission_id,
                "request_id": payload.request_id,
                "force": payload.force,
            },
        )
        request_snapshot = self._trigger_request_snapshot(payload)
        audit_idempotency_key = self._trigger_audit_idempotency_key(submission_id, payload)
        with self._lock:
            current_schedule = self._fetch_schedule(submission_id)
            audit_metadata = self._fetch_audit_metadata(audit_idempotency_key)
            if audit_metadata is not None:
                self._validate_request_snapshot(
                    submission_id=submission_id,
                    request_id=payload.request_id,
                    stored=audit_metadata.get("request"),
                    expected=request_snapshot,
                )
                if current_schedule is None:
                    raise DomainError(
                        code=TransitionErrorCode.VERSION_CONFLICT,
                        message="Release replay is missing its persisted schedule state.",
                        status_code=409,
                        details={"submission_id": submission_id, "request_id": payload.request_id},
                    )
                submission = self._fetch_submission(submission_id)
                if payload.job_run_id:
                    self._jobs.mark_succeeded(payload.job_run_id)
                return ReleaseTriggerResult(
                    idempotent=True,
                    schedule=current_schedule,
                    submission=submission,
                )
            if current_schedule is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.SCHEDULE_NOT_FOUND,
                    message=f"No schedule exists for submission {submission_id}.",
                    status_code=404,
                    details={"submission_id": submission_id},
                )
            existing_transition = self._fetch_transition_row(
                submission_id,
                f"{payload.request_id}:release-trigger",
            )
            if existing_transition is not None:
                mismatches: dict[str, dict[str, object | None]] = {}
                if existing_transition["actor_id"] != payload.actor_id:
                    mismatches["actor_id"] = {
                        "existing": existing_transition["actor_id"],
                        "requested": payload.actor_id,
                    }
                if existing_transition["actor_role"] != payload.actor_role.value:
                    mismatches["actor_role"] = {
                        "existing": existing_transition["actor_role"],
                        "requested": payload.actor_role.value,
                    }
                if mismatches:
                    self._raise_replay_payload_mismatch(
                        submission_id=submission_id,
                        request_id=payload.request_id,
                        mismatches=mismatches,
                    )
                if current_schedule.release_triggered_at is None:
                    current_schedule = current_schedule.model_copy(
                        update={
                            "release_triggered_at": datetime.now(tz=UTC),
                            "updated_by": payload.actor_id,
                            "updated_at": datetime.now(tz=UTC),
                            "version": current_schedule.version + 1,
                        }
                    )
                    self._upsert_schedule(current_schedule)
                submission = self._fetch_submission(submission_id)
                if payload.job_run_id:
                    self._jobs.mark_succeeded(payload.job_run_id)
                return ReleaseTriggerResult(
                    idempotent=True,
                    schedule=current_schedule,
                    submission=submission,
                )
            if current_schedule.release_triggered_at is not None:
                submission = self._fetch_submission(submission_id)
                if payload.job_run_id:
                    self._jobs.mark_succeeded(payload.job_run_id)
                return ReleaseTriggerResult(
                    idempotent=True,
                    schedule=current_schedule,
                    submission=submission,
                )

            now = datetime.now(tz=UTC)
            if not payload.force and current_schedule.planned_release_at > now:
                raise DomainError(
                    code=JobsSchedulingErrorCode.SCHEDULE_NOT_DUE,
                    message="Release trigger is not due yet for this submission.",
                    status_code=409,
                    details={
                        "submission_id": submission_id,
                        "planned_release_at": current_schedule.planned_release_at.isoformat(),
                    },
                )

        self._mark_job_running_if_pending(payload.job_run_id)

        with self._lock:
            try:
                transition = self._workflow.transition_submission(
                    submission_id,
                    TransitionRequest(
                        request_id=f"{payload.request_id}:release-trigger",
                        to_state=SubmissionState.RELEASED,
                        actor_id=payload.actor_id,
                        actor_role=payload.actor_role,
                        reason="Release trigger executed.",
                        metadata={
                            "triggered_event": RELEASE_TRIGGERED_EVENT,
                            "forced": payload.force,
                        },
                    ),
                )
            except DomainError as exc:
                if payload.job_run_id:
                    failure_code = exc.code.value if hasattr(exc.code, "value") else str(exc.code)
                    self._jobs.mark_failed(payload.job_run_id, failure_reason=str(failure_code))
                raise

            current_schedule = self._fetch_schedule(submission_id)
            if current_schedule is None:
                raise DomainError(
                    code=JobsSchedulingErrorCode.SCHEDULE_NOT_FOUND,
                    message=f"No schedule exists for submission {submission_id}.",
                    status_code=404,
                    details={"submission_id": submission_id},
                )
            if (transition.idempotent and transition.transition is None) or (
                current_schedule.release_triggered_at is not None
            ):
                if payload.job_run_id:
                    self._jobs.mark_succeeded(payload.job_run_id)
                return ReleaseTriggerResult(
                    idempotent=True,
                    schedule=current_schedule,
                    submission=transition.submission,
                )
            updated_schedule = current_schedule.model_copy(
                update={
                    "release_triggered_at": datetime.now(tz=UTC),
                    "updated_by": payload.actor_id,
                    "updated_at": datetime.now(tz=UTC),
                    "version": current_schedule.version + 1,
                }
            )
            self._upsert_schedule(updated_schedule)
            result = ReleaseTriggerResult(
                idempotent=False,
                schedule=updated_schedule,
                submission=transition.submission,
            )

        if payload.job_run_id:
            self._jobs.mark_succeeded(payload.job_run_id)

        self._observability.increment_counter(
            "splice_api_release_trigger_total",
            labels={"force": str(payload.force).lower()},
            help_text="Total release trigger executions.",
        )
        self._audit.append_event(
            AuditAppendRequest(
                actor_id=payload.actor_id,
                action=AuditAction.submission_release_triggered,
                entity_type=AuditEntityType.submission,
                entity_id=submission_id,
                metadata={
                    "event_name": RELEASE_TRIGGERED_EVENT,
                    "force": payload.force,
                    "job_run_id": payload.job_run_id,
                    "request": request_snapshot,
                },
                request_id=payload.request_id,
                idempotency_key=audit_idempotency_key,
            )
        )
        return result

    def _mark_job_running_if_pending(self, job_run_id: str | None) -> None:
        if not job_run_id:
            return
        job = self._jobs.get_job(job_run_id).job
        if job.status in {JobRunStatus.QUEUED, JobRunStatus.RETRYING}:
            self._jobs.mark_running(job_run_id)
