"""DB interactions and row mappings for the submission state machine."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from app.features.submissions.contracts import (
    ActorRole,
    SubmissionSnapshot,
    SubmissionState,
    TransitionRecord,
)


class StateMachinePersistenceMixIn:
    """Methods for persisting and loading state machine data."""

    _connection: sqlite3.Connection

    def _submission_from_row(self, row: sqlite3.Row) -> SubmissionSnapshot:
        submission_id = row["id"]
        return SubmissionSnapshot(
            submission_id=submission_id,
            creator_id=row["creator_id"],
            current_state=SubmissionState(row["current_state"]),
            version=row["version"],
            metadata=self._read_submission_metadata(submission_id),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def _transition_from_row(self, row: sqlite3.Row) -> TransitionRecord:
        to_state = SubmissionState(row["to_state"])
        from_state_value = row["from_state"]
        from_state = (
            SubmissionState(from_state_value) if from_state_value is not None else to_state
        )
        transition_id = row["id"]
        transition_version = int(transition_id.rsplit(":", 1)[-1])
        return TransitionRecord(
            transition_id=transition_id,
            request_id=row["request_id"],
            submission_id=row["submission_id"],
            from_state=from_state,
            to_state=to_state,
            actor_id=row["actor_id"],
            actor_role=ActorRole(row["actor_role"]),
            reason=row["reason"],
            occurred_at=datetime.fromisoformat(row["created_at"]),
            transition_version=transition_version,
        )

    def _upsert_submission_metadata(
        self,
        submission_id: str,
        metadata: dict[str, Any],
        now: datetime,
    ) -> None:
        self._connection.execute(
            """
            INSERT INTO submission_state_metadata (
                submission_id,
                metadata_json,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
              metadata_json = excluded.metadata_json,
              updated_at = excluded.updated_at
            """,
            (
                submission_id,
                json.dumps(metadata),
                now.isoformat(),
                now.isoformat(),
            ),
        )

    def _read_submission_metadata(self, submission_id: str) -> dict[str, Any]:
        row = self._connection.execute(
            "SELECT metadata_json FROM submission_state_metadata WHERE submission_id = ?",
            (submission_id,),
        ).fetchone()
        if row is None:
            return {}
        payload = json.loads(row["metadata_json"])
        return payload if isinstance(payload, dict) else {}

    def get_submission_metadata(self, submission_id: str) -> dict[str, Any]:
        return self._read_submission_metadata(submission_id)
