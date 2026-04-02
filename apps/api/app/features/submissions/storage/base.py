"""SQLite-backed PRD-03/12 intake, manifest, and Dropbox handoff service."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from app.core.errors import DomainError
from app.features.submissions.storage_contracts import (
    IntakeSessionSnapshot,
    IntakeSessionStatus,
    IntakeStorageErrorCode,
)

DROPBOX_CHUNK_SIZE = 8 * 1024 * 1024
REQUIRED_PACK_FOLDER_ALIASES = frozenset(
    {
        "audio",
        "artwork",
        "coverart",
        "demo",
        "demos",
        "description",
        "descriptioninfo",
        "descriptionandinfo",
    }
)


class StorageBaseMixin:
    """Extracted mixin for IntakeStorageService."""

    def _find_session_by_request_key(self, request_key: str) -> IntakeSessionSnapshot | None:
        row = self._connection.execute(
            """
            SELECT *
            FROM upload_sessions
            WHERE json_extract(chunk_state_json, '$.request_key') = ?
            LIMIT 1
            """,
            (request_key,),
        ).fetchone()
        return self._session_from_row(row) if row is not None else None

    def _find_session_by_submission_id(self, submission_id: str) -> IntakeSessionSnapshot | None:
        row = self._connection.execute(
            """
            SELECT *
            FROM upload_sessions
            WHERE submission_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (submission_id,),
        ).fetchone()
        return self._session_from_row(row) if row is not None else None

    def _find_session_by_id(self, intake_session_id: str) -> IntakeSessionSnapshot | None:
        row = self._connection.execute(
            "SELECT * FROM upload_sessions WHERE id = ?",
            (intake_session_id,),
        ).fetchone()
        return self._session_from_row(row) if row is not None else None

    def _session_from_row(self, row: sqlite3.Row) -> IntakeSessionSnapshot:
        metadata = self._parse_json(row["chunk_state_json"], default={})
        created_at = self._parse_datetime(row["created_at"])
        updated_at_value = (
            metadata.get("upload_updated_at")
            or row["completed_at"]
            or row["locked_at"]
            or row["created_at"]
        )
        updated_at = self._parse_datetime(str(updated_at_value))

        return IntakeSessionSnapshot(
            intake_session_id=row["id"],
            submission_id=row["submission_id"],
            creator_id=str(metadata.get("creator_id", "desktop-local")),
            pack_name=str(metadata.get("pack_name", "Pack")),
            declared_top_level_folders=list(metadata.get("declared_top_level_folders", [])),
            status=self._status_from_str(row["status"]),
            manifest_version=int(metadata.get("manifest_version", 0)),
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )

    def _find_completed_at(self, intake_session_id: str) -> str | None:
        row = self._connection.execute(
            "SELECT completed_at FROM upload_sessions WHERE id = ?",
            (intake_session_id,),
        ).fetchone()
        if row is None:
            return None
        return self._normalize_optional_str(row["completed_at"])

    def _update_handoff_metadata(
        self,
        *,
        intake_session_id: str,
        updates: dict[str, Any],
        status: str | None = None,
        completed_at: str | None = None,
        locked_at: str | None = None,
    ) -> None:
        row = self._connection.execute(
            "SELECT chunk_state_json FROM upload_sessions WHERE id = ?",
            (intake_session_id,),
        ).fetchone()
        if row is None:
            return
        metadata = self._parse_json(row["chunk_state_json"], default={})
        if not isinstance(metadata, dict):
            metadata = {}
        metadata.update(updates)
        metadata["upload_updated_at"] = updates.get("upload_updated_at") or metadata.get(
            "upload_updated_at"
        )
        with self._connection:
            self._connection.execute(
                """
                UPDATE upload_sessions
                SET
                    status = COALESCE(?, status),
                    chunk_state_json = ?,
                    completed_at = COALESCE(?, completed_at),
                    locked_at = COALESCE(?, locked_at)
                WHERE id = ?
                """,
                (
                    status,
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    completed_at,
                    locked_at,
                    intake_session_id,
                ),
            )

    def _extract_intake_session_id(self, handoff_id: str) -> str:
        parts = handoff_id.split(":")
        if len(parts) < 4 or parts[0] != "handoff" or parts[1] != "intake":
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                message=f"Storage handoff {handoff_id} was not found.",
                status_code=404,
                details={"handoff_id": handoff_id},
            )
        return f"{parts[1]}:{parts[2]}"

    def _status_from_str(self, value: str) -> IntakeSessionStatus:
        for status in IntakeSessionStatus:
            if status.value == value:
                return status
        return IntakeSessionStatus.INITIATED

    def _parse_json(self, raw_value: str | None, *, default: Any) -> Any:
        if not raw_value:
            return default
        try:
            return json.loads(raw_value)
        except json.JSONDecodeError:
            return default

    def _parse_datetime(self, raw_value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(raw_value)
        except ValueError:
            parsed = datetime.now(tz=UTC)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed

    def _parse_nullable_datetime(self, raw_value: str | None) -> datetime | None:
        if not raw_value:
            return None
        return self._parse_datetime(raw_value)

    def _normalize_optional_str(self, value: Any) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned if cleaned else None
