"""Background job handlers for the release scheduler."""

from __future__ import annotations

from typing import Any

from app.core.errors import DomainError
from app.features.jobs.contracts import (
    EnqueueJobRequest,
    JobRunSnapshot,
    JobsSchedulingErrorCode,
    ReleaseScheduleSnapshot,
    ReleaseTriggerRequest,
)


class SchedulerJobsMixIn:
    """Mixes in job-related operations for the release scheduler."""

    _jobs: Any
    _fetch_schedule: Any
    trigger_release: Any

    def _enqueue_release_job(
        self,
        *,
        submission_id: str,
        request_id: str,
        schedule: ReleaseScheduleSnapshot,
        correlation_id: str,
    ) -> JobRunSnapshot:
        enqueue = self._jobs.enqueue(
            EnqueueJobRequest(
                request_id=request_id,
                job_type="release.trigger",
                idempotency_key=f"release.trigger:{submission_id}:{schedule.version}",
                payload_json={
                    "submission_id": submission_id,
                    "planned_release_at": schedule.planned_release_at.isoformat(),
                    "timezone": schedule.timezone,
                    "schedule_version": schedule.version,
                },
                max_attempts=3,
                scheduled_for=schedule.planned_release_at,
                correlation_id=correlation_id,
            )
        )
        return enqueue.job

    def _execute_release_job(self, job: JobRunSnapshot) -> None:
        submission_id = str(job.payload_json.get("submission_id", ""))
        if not submission_id:
            raise ValueError("release.trigger payload missing submission_id")
        current_schedule = self._fetch_schedule(submission_id)
        if current_schedule is None:
            raise DomainError(
                code=JobsSchedulingErrorCode.SCHEDULE_NOT_FOUND,
                message=f"No schedule exists for submission {submission_id}.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        scheduled_version_raw = job.payload_json.get("schedule_version")
        if scheduled_version_raw is not None:
            scheduled_version = int(scheduled_version_raw)
            if scheduled_version != current_schedule.version:
                self._jobs.mark_succeeded(job.id)
                return
        self.trigger_release(
            submission_id,
            ReleaseTriggerRequest(
                request_id=f"job:{job.id}",
                actor_id="system-worker",
                actor_role="system",
                force=False,
                job_run_id=job.id,
            ),
        )
