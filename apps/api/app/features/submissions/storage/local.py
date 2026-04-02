"""SQLite-backed PRD-03/12 intake, manifest, and Dropbox handoff service."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.errors import DomainError
from app.features.submissions.contracts import ActorRole, SubmissionState
from app.features.submissions.storage_contracts import (
    INTAKE_SESSION_STARTED_EVENT,
    IntakeLifecycleEvent,
    IntakeSessionSnapshot,
    IntakeSessionStatus,
    IntakeStorageErrorCode,
    StartIntakeSessionRequest,
    StartIntakeSessionResult,
    UnlockSubmissionFilesRequest,
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


class LocalWorkspaceMixin:
    """Extracted mixin for IntakeStorageService."""

    def start_intake_session(self, request: StartIntakeSessionRequest) -> StartIntakeSessionResult:
        request_key = f"{request.submission_id}:{request.request_id}"
        existing_by_request = self._find_session_by_request_key(request_key)
        if existing_by_request is not None:
            return StartIntakeSessionResult(
                created=False,
                idempotent=True,
                session=existing_by_request,
                event=None,
            )

        existing_session = self._find_session_by_submission_id(request.submission_id)
        if existing_session is not None:
            if self._should_reset_session_for_new_attempt(existing_session):
                reset_session = self._reset_session_for_new_attempt(
                    existing_session=existing_session,
                    request=request,
                    request_key=request_key,
                )
                return StartIntakeSessionResult(
                    created=False,
                    idempotent=False,
                    session=reset_session,
                    event=None,
                )
            return StartIntakeSessionResult(
                created=False,
                idempotent=True,
                session=existing_session,
                event=None,
            )

        now = datetime.now(tz=UTC)
        session_id = f"intake:{request.submission_id}"

        metadata = dict(request.metadata)
        metadata["request_key"] = request_key
        metadata["creator_id"] = request.creator_id
        metadata["pack_name"] = request.pack_name
        metadata["declared_top_level_folders"] = request.declared_top_level_folders

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO upload_sessions (
                    id,
                    submission_id,
                    status,
                    local_pack_path,
                    dropbox_dest_path,
                    sha256_manifest_json,
                    chunk_state_json,
                    created_at,
                    expires_at,
                    completed_at,
                    locked_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    request.submission_id,
                    IntakeSessionStatus.INITIATED.value,
                    self._normalize_optional_str(metadata.get("local_pack_path")),
                    None,
                    json.dumps({}, separators=(",", ":"), sort_keys=True),
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    now.isoformat(),
                    None,
                    None,
                    None,
                ),
            )

        session = IntakeSessionSnapshot(
            intake_session_id=session_id,
            submission_id=request.submission_id,
            creator_id=request.creator_id,
            pack_name=request.pack_name,
            declared_top_level_folders=request.declared_top_level_folders,
            status=IntakeSessionStatus.INITIATED,
            manifest_version=0,
            metadata=metadata,
            created_at=now,
            updated_at=now,
        )

        event = IntakeLifecycleEvent(
            event_name=INTAKE_SESSION_STARTED_EVENT,
            event_id=f"evt:{session_id}:started",
            intake_session_id=session_id,
            submission_id=request.submission_id,
            occurred_at=now,
            idempotency_key=f"intake.session.start:{request.submission_id}:{request.request_id}",
        )

        return StartIntakeSessionResult(
            created=True,
            idempotent=False,
            session=session,
            event=event,
        )

    def _should_reset_session_for_new_attempt(self, session: IntakeSessionSnapshot) -> bool:
        metadata = dict(session.metadata if isinstance(session.metadata, dict) else {})
        handoff_status = self._normalize_optional_str(
            metadata.get("handoff_status") or metadata.get("upload_status")
        )
        return handoff_status in {
            "canceled",
            "failed",
        }

    def _reset_session_for_new_attempt(
        self,
        *,
        existing_session: IntakeSessionSnapshot,
        request: StartIntakeSessionRequest,
        request_key: str,
    ) -> IntakeSessionSnapshot:
        now = datetime.now(tz=UTC)
        metadata = dict(existing_session.metadata if isinstance(existing_session.metadata, dict) else {})
        metadata.update(
            {
                "request_key": request_key,
                "creator_id": request.creator_id,
                "pack_name": request.pack_name,
                "declared_top_level_folders": request.declared_top_level_folders,
            }
        )
        if "local_pack_path" in request.metadata:
            metadata["local_pack_path"] = request.metadata.get("local_pack_path")
        metadata.pop("handoff_status", None)
        metadata.pop("upload_status", None)
        metadata.pop("last_handoff_request_key", None)
        metadata.pop("handoff_job_id", None)
        metadata.pop("upload_job_status", None)
        metadata.pop("upload_progress_percent", None)
        metadata.pop("upload_uploaded_bytes", None)
        metadata.pop("upload_total_bytes", None)
        metadata.pop("upload_completed_object_count", None)
        metadata.pop("upload_error", None)
        metadata.pop("upload_updated_at", None)

        with self._connection:
            self._connection.execute(
                "UPDATE asset_manifest SET locked = 0 WHERE session_id = ?",
                (existing_session.intake_session_id,),
            )
            self._connection.execute(
                """
                UPDATE upload_sessions
                SET
                    status = ?,
                    local_pack_path = ?,
                    chunk_state_json = ?,
                    completed_at = NULL,
                    locked_at = NULL
                WHERE id = ?
                """,
                (
                    IntakeSessionStatus.INITIATED.value,
                    self._normalize_optional_str(request.metadata.get("local_pack_path")),
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    existing_session.intake_session_id,
                ),
            )

        refreshed = self._find_session_by_id(existing_session.intake_session_id)
        if refreshed is not None:
            return refreshed
        return existing_session.model_copy(
            update={
                "creator_id": request.creator_id,
                "pack_name": request.pack_name,
                "declared_top_level_folders": request.declared_top_level_folders,
                "status": IntakeSessionStatus.INITIATED,
                "metadata": metadata,
                "updated_at": now,
            }
        )

    def lock_submission_assets(self, submission_id: str) -> dict[str, Any]:
        now = datetime.now(tz=UTC)
        with self._connection:
            session_row = self._connection.execute(
                """
                SELECT id
                FROM upload_sessions
                WHERE submission_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (submission_id,),
            ).fetchone()

            if session_row is None:
                raise DomainError(
                    code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                    message=f"No intake session found for submission {submission_id}.",
                    status_code=404,
                    details={"submission_id": submission_id},
                )

            intake_session_id = str(session_row["id"])

            updated_count = self._connection.execute(
                "UPDATE asset_manifest SET locked = 1 WHERE session_id = ?",
                (intake_session_id,),
            ).rowcount

            self._connection.execute(
                "UPDATE upload_sessions SET locked_at = COALESCE(locked_at, ?) WHERE id = ?",
                (now.isoformat(), intake_session_id),
            )

        return {
            "submission_id": submission_id,
            "intake_session_id": intake_session_id,
            "locked_count": max(0, int(updated_count)),
            "locked_at": now,
        }

    def unlock_submission_assets(
        self,
        submission_id: str,
        request: UnlockSubmissionFilesRequest,
    ) -> dict[str, Any]:
        if request.actor_role not in {ActorRole.REVIEWER, ActorRole.ADMIN}:
            raise DomainError(
                code=IntakeStorageErrorCode.SUBMISSION_UNLOCK_FORBIDDEN,
                message=(
                    "Only reviewer/admin actors can unlock files for creator amendment."
                ),
                status_code=403,
                details={"actor_role": request.actor_role.value},
            )

        submission_row = self._connection.execute(
            "SELECT current_state FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
        if submission_row is None:
            raise DomainError(
                code=IntakeStorageErrorCode.SUBMISSION_NOT_FOUND,
                message=f"Submission {submission_id} was not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )

        current_state = str(submission_row["current_state"] or "").strip()
        if current_state != SubmissionState.REJECTED.value:
            raise DomainError(
                code=IntakeStorageErrorCode.SUBMISSION_UNLOCK_INVALID_STATE,
                message="Unlock is only allowed for rejected submissions.",
                status_code=409,
                details={"submission_id": submission_id, "current_state": current_state},
            )

        session = self._find_session_by_submission_id(submission_id)
        if session is None:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                message=f"No intake session found for submission {submission_id}.",
                status_code=404,
                details={"submission_id": submission_id},
            )

        intake_session_id = session.intake_session_id
        metadata = dict(session.metadata)
        metadata["last_unlock_request_key"] = f"{submission_id}:{request.request_id}"
        metadata.pop("handoff_status", None)
        metadata.pop("last_handoff_request_key", None)

        now = datetime.now(tz=UTC)
        with self._connection:
            updated_count = self._connection.execute(
                "UPDATE asset_manifest SET locked = 0 WHERE session_id = ?",
                (intake_session_id,),
            ).rowcount
            self._connection.execute(
                """
                UPDATE upload_sessions
                SET
                    status = ?,
                    chunk_state_json = ?,
                    completed_at = NULL,
                    locked_at = NULL
                WHERE id = ?
                """,
                (
                    IntakeSessionStatus.INITIATED.value,
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    intake_session_id,
                ),
            )

        return {
            "submission_id": submission_id,
            "intake_session_id": intake_session_id,
            "unlocked_count": max(0, int(updated_count)),
            "unlocked_at": now,
        }

    def _resolve_local_pack_root(self, metadata: dict[str, Any]) -> Path | None:
        pack_path = self._normalize_optional_str(metadata.get("local_pack_path"))
        if not pack_path:
            return None
        path = Path(pack_path).expanduser()
        if path.exists() and path.is_dir():
            return path
        return None

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _is_child_path(self, path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    def _is_required_asset(self, relative_path: str) -> bool:
        folder = relative_path.split("/", 1)[0]
        normalized = "".join(ch for ch in folder.strip().lower() if ch.isalnum())
        return normalized in REQUIRED_PACK_FOLDER_ALIASES

    def _infer_category(self, relative_path: str) -> str:
        lower = relative_path.lower()
        if lower.endswith(".zip"):
            return "audio_zip"
        if lower.endswith((".wav", ".mp3", ".aif", ".aiff")):
            return "audio"
        if lower.endswith((".jpg", ".jpeg", ".png")):
            return "artwork"
        if lower.endswith((".mid", ".midi")):
            return "midi"
        return "other"
