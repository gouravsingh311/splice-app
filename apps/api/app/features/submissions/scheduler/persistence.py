"""DB interactions and date helpers for the release scheduler."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.features.jobs.contracts import (
    JobRunSnapshot,
    JobsSchedulingErrorCode,
    ReleaseScheduleSnapshot,
    ScheduleOverrideSnapshot,
    ScheduleSource,
)
from app.features.submissions.contracts import SubmissionSnapshot, SubmissionState


class SchedulerPersistenceMixIn:
    """Methods for persisting and loading release schedule data."""

    _connection: sqlite3.Connection
    _workflow: Any  # Decoupled later
    _jobs: Any
    _parse_dt: Any
    _dt: Any

    def _upsert_schedule(self, schedule: ReleaseScheduleSnapshot) -> None:
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO release_schedules (
                  submission_id, preferred_month, planned_release_at, timezone,
                  source, updated_by, updated_at, version, release_triggered_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(submission_id) DO UPDATE SET
                  preferred_month = excluded.preferred_month,
                  planned_release_at = excluded.planned_release_at,
                  timezone = excluded.timezone,
                  source = excluded.source,
                  updated_by = excluded.updated_by,
                  updated_at = excluded.updated_at,
                  version = excluded.version,
                  release_triggered_at = excluded.release_triggered_at
                """,
                (
                    schedule.submission_id,
                    schedule.preferred_month,
                    self._dt(schedule.planned_release_at),
                    schedule.timezone,
                    schedule.source.value,
                    schedule.updated_by,
                    self._dt(schedule.updated_at),
                    schedule.version,
                    self._dt(schedule.release_triggered_at),
                ),
            )

    def _insert_override(self, override: ScheduleOverrideSnapshot) -> None:
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO schedule_overrides (
                  id, submission_id, old_release_at, new_release_at,
                  reason, actor_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    override.id,
                    override.submission_id,
                    self._dt(override.old_release_at),
                    self._dt(override.new_release_at),
                    override.reason,
                    override.actor_id,
                    self._dt(override.created_at),
                ),
            )

    def _fetch_schedule(self, submission_id: str) -> ReleaseScheduleSnapshot | None:
        cursor = self._connection.execute(
            "SELECT * FROM release_schedules WHERE submission_id = ?",
            (submission_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return ReleaseScheduleSnapshot(
            submission_id=row["submission_id"],
            preferred_month=row["preferred_month"],
            planned_release_at=self._parse_dt(row["planned_release_at"]),
            timezone=row["timezone"],
            source=ScheduleSource(row["source"]),
            updated_by=row["updated_by"],
            updated_at=self._parse_dt(row["updated_at"]),
            version=row["version"],
            release_triggered_at=self._parse_dt(row["release_triggered_at"])
            if row["release_triggered_at"]
            else None,
        )

    def _fetch_override(self, override_id: str) -> ScheduleOverrideSnapshot | None:
        row = self._connection.execute(
            """
            SELECT id, submission_id, old_release_at, new_release_at, reason, actor_id, created_at
            FROM schedule_overrides
            WHERE id = ?
            """,
            (override_id,),
        ).fetchone()
        if row is None:
            return None
        return ScheduleOverrideSnapshot(
            id=row["id"],
            submission_id=row["submission_id"],
            old_release_at=self._parse_dt(row["old_release_at"]),
            new_release_at=self._parse_dt(row["new_release_at"]),
            reason=row["reason"],
            actor_id=row["actor_id"],
            created_at=self._parse_dt(row["created_at"]),
        )

    def _fetch_transition_row(self, submission_id: str, request_id: str) -> sqlite3.Row | None:
        return self._connection.execute(
            """
            SELECT id, submission_id, from_state, to_state, actor_id, actor_role, reason,
                   request_id, created_at
            FROM submission_transitions
            WHERE submission_id = ? AND request_id = ?
            """,
            (submission_id, request_id),
        ).fetchone()

    def _fetch_job_by_idempotency_key(self, idempotency_key: str) -> JobRunSnapshot | None:
        row = self._connection.execute(
            "SELECT id FROM job_runs WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if row is None:
            return None
        return self._jobs.get_job(row["id"]).job

    def _fetch_audit_metadata(self, idempotency_key: str) -> dict[str, Any] | None:
        row = self._connection.execute(
            """
            SELECT metadata_json
            FROM audit_events
            WHERE idempotency_key = ?
            """,
            (idempotency_key,),
        ).fetchone()
        if row is None or not row["metadata_json"]:
            return None
        metadata_bundle = json.loads(row["metadata_json"])
        if not isinstance(metadata_bundle, dict):
            return None
        metadata = metadata_bundle.get("metadata")
        return metadata if isinstance(metadata, dict) else None

    def _fetch_submission(self, submission_id: str) -> SubmissionSnapshot:
        from app.core.errors import DomainError

        row = self._connection.execute(
            """
            SELECT id, creator_id, current_state, version, created_at, updated_at
            FROM submissions
            WHERE id = ?
            """,
            (submission_id,),
        ).fetchone()
        if row is None:
            raise DomainError(
                code=JobsSchedulingErrorCode.SCHEDULE_NOT_FOUND,
                message=f"Submission {submission_id} was not found for release trigger.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        return SubmissionSnapshot(
            submission_id=row["id"],
            creator_id=row["creator_id"],
            current_state=SubmissionState(row["current_state"]),
            version=int(row["version"]),
            metadata=self._workflow.state_machine.get_submission_metadata(row["id"]),
            created_at=self._parse_dt(row["created_at"]),
            updated_at=self._parse_dt(row["updated_at"]),
        )

    def _planned_release_datetime(self, *, preferred_month: str, timezone: str) -> datetime:
        year = int(preferred_month[0:4])
        month = int(preferred_month[5:7])
        tz = ZoneInfo(timezone)
        return datetime(year=year, month=month, day=1, hour=10, minute=0, tzinfo=tz)

    @staticmethod
    def _dt(value: datetime | None) -> str | None:
        return value.astimezone(UTC).isoformat() if value is not None else None

    @staticmethod
    def _parse_dt(value: str | None) -> datetime | None:
        if value is None:
            return None
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed
