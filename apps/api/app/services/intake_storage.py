"""SQLite-backed PRD-03/12 intake, manifest, and Dropbox handoff service."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import sqlite3
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.contracts.intake_storage import (
    INTAKE_MANIFEST_INDEXED_EVENT,
    INTAKE_SESSION_STARTED_EVENT,
    STORAGE_HANDOFF_STATUS_EVENT,
    CreateStorageHandoffRequest,
    CreateStorageHandoffResult,
    IntakeInventoryResult,
    IntakeLifecycleEvent,
    IntakeSessionSnapshot,
    IntakeSessionStatus,
    IntakeStorageErrorCode,
    ManifestFileEntry,
    ManifestSnapshot,
    ManifestSummary,
    StartIntakeSessionRequest,
    StartIntakeSessionResult,
    StorageHandoffEvent,
    StorageHandoffSnapshot,
    StorageHandoffStatus,
    StorageHandoffStatusResult,
    UnlockSubmissionFilesRequest,
    UpsertIntakeManifestRequest,
    UpsertIntakeManifestResult,
)
from app.contracts.submission_lifecycle import ActorRole, SubmissionState
from app.db import get_connection
from app.domain.errors import DomainError

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


class IntakeStorageService:
    """SQLite-backed intake/manifest/handoff service with local Dropbox delivery."""

    def __init__(self, *, connection: sqlite3.Connection | None = None) -> None:
        self._connection = connection or get_connection()

    def reset(self) -> None:
        self._connection.execute("DELETE FROM asset_manifest")
        self._connection.execute("DELETE FROM upload_sessions")

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

    def upsert_manifest(
        self, intake_session_id: str, request: UpsertIntakeManifestRequest
    ) -> UpsertIntakeManifestResult:
        request_key = f"{intake_session_id}:{request.request_id}"
        session = self._find_session_by_id(intake_session_id)
        if session is None:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                message=f"Intake session {intake_session_id} was not found.",
                status_code=404,
                details={"intake_session_id": intake_session_id},
            )

        metadata = dict(session.metadata)
        if metadata.get("last_manifest_request_key") == request_key:
            snapshot = self._build_manifest_snapshot(intake_session_id)
            if snapshot is None:
                raise DomainError(
                    code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                    message="Manifest idempotency record exists without a manifest snapshot.",
                    status_code=500,
                    details={"intake_session_id": intake_session_id},
                )
            event = IntakeLifecycleEvent(
                event_name=INTAKE_MANIFEST_INDEXED_EVENT,
                event_id=f"evt:{intake_session_id}:manifest:{snapshot.manifest_version}",
                intake_session_id=intake_session_id,
                submission_id=session.submission_id,
                manifest_version=snapshot.manifest_version,
                file_count=snapshot.summary.total_file_count,
                occurred_at=snapshot.updated_at,
                idempotency_key=f"intake.manifest.upsert:{intake_session_id}:{request.request_id}",
            )
            return UpsertIntakeManifestResult(
                idempotent=True,
                session=session,
                manifest=snapshot,
                event=event,
            )

        existing_manifest = self._build_manifest_snapshot(intake_session_id)
        if existing_manifest is not None and existing_manifest.locked:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_MANIFEST_LOCKED,
                message="Manifest is locked and cannot be modified.",
                status_code=409,
                details={"intake_session_id": intake_session_id},
            )

        actual_version = existing_manifest.manifest_version if existing_manifest is not None else 0
        if (
            request.expected_manifest_version is not None
            and request.expected_manifest_version != actual_version
        ):
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_MANIFEST_VERSION_CONFLICT,
                message="Manifest version does not match expected_manifest_version.",
                status_code=409,
                details={
                    "intake_session_id": intake_session_id,
                    "expected_manifest_version": request.expected_manifest_version,
                    "actual_manifest_version": actual_version,
                },
            )

        now = datetime.now(tz=UTC)
        next_version = actual_version + 1
        pack_root = self._resolve_local_pack_root(metadata)

        files = [self._materialize_manifest_entry(pack_root, entry) for entry in request.files]
        summary = self._build_manifest_summary(files)

        with self._connection:
            self._connection.execute(
                "DELETE FROM asset_manifest WHERE session_id = ?",
                (intake_session_id,),
            )
            for entry in files:
                row_id = (
                    f"{intake_session_id}:{next_version}:"
                    f"{hashlib.sha256(entry.relative_path.encode('utf-8')).hexdigest()[:16]}"
                )
                self._connection.execute(
                    """
                    INSERT OR REPLACE INTO asset_manifest (
                        id,
                        session_id,
                        submission_id,
                        file_path,
                        file_size,
                        sha256,
                        mime,
                        locked
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row_id,
                        intake_session_id,
                        session.submission_id,
                        entry.relative_path,
                        int(entry.size_bytes),
                        entry.sha256,
                        entry.mime_type,
                        1 if request.lock_manifest else 0,
                    ),
                )

            metadata["last_manifest_request_key"] = request_key
            metadata["manifest_version"] = next_version

            session_status = (
                IntakeSessionStatus.MANIFEST_READY
                if request.lock_manifest
                else IntakeSessionStatus.INITIATED
            )

            self._connection.execute(
                """
                UPDATE upload_sessions
                SET
                    status = ?,
                    sha256_manifest_json = ?,
                    chunk_state_json = ?,
                    locked_at = ?,
                    completed_at = ?
                WHERE id = ?
                """,
                (
                    session_status.value,
                    json.dumps(
                        self._manifest_to_json_map(files),
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    now.isoformat() if request.lock_manifest else None,
                    None,
                    intake_session_id,
                ),
            )

        updated_session = session.model_copy(
            update={
                "manifest_version": next_version,
                "status": session_status,
                "metadata": metadata,
                "updated_at": now,
            }
        )

        manifest = ManifestSnapshot(
            manifest_version=next_version,
            locked=request.lock_manifest,
            files=files,
            summary=summary,
            updated_at=now,
        )

        event = IntakeLifecycleEvent(
            event_name=INTAKE_MANIFEST_INDEXED_EVENT,
            event_id=f"evt:{intake_session_id}:manifest:{next_version}",
            intake_session_id=intake_session_id,
            submission_id=session.submission_id,
            manifest_version=next_version,
            file_count=summary.total_file_count,
            occurred_at=now,
            idempotency_key=f"intake.manifest.upsert:{intake_session_id}:{request.request_id}",
        )

        return UpsertIntakeManifestResult(
            idempotent=False,
            session=updated_session,
            manifest=manifest,
            event=event,
        )

    def get_inventory(self, intake_session_id: str) -> IntakeInventoryResult:
        session = self._find_session_by_id(intake_session_id)
        if session is None:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                message=f"Intake session {intake_session_id} was not found.",
                status_code=404,
                details={"intake_session_id": intake_session_id},
            )

        return IntakeInventoryResult(
            session=session,
            manifest=self._build_manifest_snapshot(intake_session_id),
        )

    def create_storage_handoff(
        self, request: CreateStorageHandoffRequest
    ) -> CreateStorageHandoffResult:
        request_key = f"{request.intake_session_id}:{request.request_id}"

        if request.actor_role not in {
            ActorRole.CREATOR,
            ActorRole.ADMIN,
            ActorRole.SYSTEM,
        }:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_FORBIDDEN,
                message=f"Role {request.actor_role.value} cannot create storage handoffs.",
                status_code=403,
                details={"actor_role": request.actor_role.value},
            )

        session = self._find_session_by_id(request.intake_session_id)
        if session is None:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                message=f"Intake session {request.intake_session_id} was not found.",
                status_code=404,
                details={"intake_session_id": request.intake_session_id},
            )

        manifest = self._build_manifest_snapshot(request.intake_session_id)
        if manifest is None or not manifest.locked:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Storage handoff requires an existing locked manifest.",
                status_code=409,
                details={
                    "intake_session_id": request.intake_session_id,
                    "manifest_locked": manifest.locked if manifest is not None else False,
                },
            )

        metadata = dict(session.metadata)
        if metadata.get("last_handoff_request_key") == request_key:
            existing = self._build_handoff_snapshot(request.intake_session_id)
            if existing is None:
                raise DomainError(
                    code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                    message="Storage handoff idempotency record exists without handoff row.",
                    status_code=500,
                    details={"intake_session_id": request.intake_session_id},
                )
            event = self._build_handoff_event(existing, request.request_id)
            return CreateStorageHandoffResult(idempotent=True, handoff=existing, event=event)

        handoff_id = f"handoff:{request.intake_session_id}:{manifest.manifest_version}"
        dropbox_delivery_folder = self._get_dropbox_delivery_folder()
        dropbox_dest_path = (
            f"{dropbox_delivery_folder.rstrip('/')}/{session.submission_id}".replace("//", "/")
        )

        metadata["handoff_status"] = StorageHandoffStatus.IN_PROGRESS.value
        with self._connection:
            self._connection.execute(
                """
                UPDATE upload_sessions
                SET status = ?, dropbox_dest_path = ?, chunk_state_json = ?
                WHERE id = ?
                """,
                (
                    IntakeSessionStatus.MANIFEST_READY.value,
                    dropbox_dest_path,
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    request.intake_session_id,
                ),
            )

        upload_error: str | None = None
        try:
            self._upload_manifest_files_to_dropbox(
                intake_session_id=request.intake_session_id,
                submission_id=session.submission_id,
                dropbox_destination_root=dropbox_dest_path,
            )
            handoff_status = StorageHandoffStatus.COMPLETED
        except DomainError:
            raise
        except Exception as exc:  # pragma: no cover - defensive fallback
            upload_error = str(exc)
            handoff_status = StorageHandoffStatus.FAILED

        finished_at = datetime.now(tz=UTC)
        metadata["last_handoff_request_key"] = request_key
        metadata["handoff_status"] = handoff_status.value

        with self._connection:
            self._connection.execute(
                """
                UPDATE upload_sessions
                SET
                    status = ?,
                    chunk_state_json = ?,
                    completed_at = ?,
                    locked_at = COALESCE(locked_at, ?)
                WHERE id = ?
                """,
                (
                    IntakeSessionStatus.TRANSFER_COMPLETED.value
                    if handoff_status == StorageHandoffStatus.COMPLETED
                    else IntakeSessionStatus.MANIFEST_READY.value,
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    (
                        finished_at.isoformat()
                        if handoff_status == StorageHandoffStatus.COMPLETED
                        else None
                    ),
                    finished_at.isoformat(),
                    request.intake_session_id,
                ),
            )

        handoff = self._build_handoff_snapshot(request.intake_session_id)
        if handoff is None:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                message=f"Storage handoff {handoff_id} was not found.",
                status_code=404,
                details={"handoff_id": handoff_id},
            )

        handoff = handoff.model_copy(
            update={
                "status": handoff_status,
                "updated_at": finished_at,
                "completed_at": (
                    finished_at if handoff_status == StorageHandoffStatus.COMPLETED else None
                ),
                "error": upload_error,
            }
        )

        event = self._build_handoff_event(handoff, request.request_id)
        return CreateStorageHandoffResult(idempotent=False, handoff=handoff, event=event)

    def get_storage_handoff_status(self, handoff_id: str) -> StorageHandoffStatusResult:
        intake_session_id = self._extract_intake_session_id(handoff_id)
        handoff = self._build_handoff_snapshot(intake_session_id)
        if handoff is None:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                message=f"Storage handoff {handoff_id} was not found.",
                status_code=404,
                details={"handoff_id": handoff_id},
            )

        if handoff.status == StorageHandoffStatus.COMPLETED:
            self._verify_dropbox_delivery(handoff)

        return StorageHandoffStatusResult(handoff=handoff)

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
        updated_at = self._parse_datetime(
            row["completed_at"] or row["locked_at"] or row["created_at"]
        )

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

    def _build_manifest_snapshot(self, intake_session_id: str) -> ManifestSnapshot | None:
        rows = self._connection.execute(
            """
            SELECT file_path, file_size, sha256, mime, locked
            FROM asset_manifest
            WHERE session_id = ?
            ORDER BY file_path ASC
            """,
            (intake_session_id,),
        ).fetchall()

        if not rows:
            return None

        session = self._find_session_by_id(intake_session_id)
        if session is None:
            return None

        files: list[ManifestFileEntry] = []
        locked = False
        for row in rows:
            files.append(
                ManifestFileEntry(
                    relative_path=row["file_path"],
                    size_bytes=max(1, int(row["file_size"] or 1)),
                    sha256=row["sha256"],
                    mime_type=row["mime"] or "application/octet-stream",
                    category=self._infer_category(row["file_path"]),
                    required_asset=self._is_required_asset(row["file_path"]),
                )
            )
            locked = locked or bool(row["locked"])

        summary = self._build_manifest_summary(files)
        return ManifestSnapshot(
            manifest_version=max(0, int(session.metadata.get("manifest_version", 0))),
            locked=locked,
            files=files,
            summary=summary,
            updated_at=session.updated_at,
        )

    def _build_handoff_snapshot(self, intake_session_id: str) -> StorageHandoffSnapshot | None:
        session = self._find_session_by_id(intake_session_id)
        if session is None:
            return None

        manifest = self._build_manifest_snapshot(intake_session_id)
        if manifest is None:
            return None

        handoff_id = f"handoff:{intake_session_id}:{manifest.manifest_version}"
        handoff_status = self._normalize_optional_str(session.metadata.get("handoff_status"))
        status = self._handoff_status_from_session(session.status, handoff_status)
        created_at = session.created_at
        updated_at = session.updated_at
        completed_at = self._parse_nullable_datetime(self._find_completed_at(intake_session_id))

        return StorageHandoffSnapshot(
            handoff_id=handoff_id,
            submission_id=session.submission_id,
            intake_session_id=intake_session_id,
            status=status,
            target="temporary-object-storage",
            object_count=manifest.summary.total_file_count,
            total_bytes=manifest.summary.total_bytes,
            checksum_verified=True,
            created_at=created_at,
            updated_at=updated_at,
            completed_at=completed_at,
            error=None,
        )

    def _find_completed_at(self, intake_session_id: str) -> str | None:
        row = self._connection.execute(
            "SELECT completed_at FROM upload_sessions WHERE id = ?",
            (intake_session_id,),
        ).fetchone()
        if row is None:
            return None
        return self._normalize_optional_str(row["completed_at"])

    def _build_manifest_summary(self, files: Iterable[ManifestFileEntry]) -> ManifestSummary:
        counts_by_category: dict[str, int] = {}
        total_bytes = 0
        required_audio_zip_present = False

        file_list = list(files)
        for file_entry in file_list:
            category = file_entry.category.strip() or "other"
            counts_by_category[category] = counts_by_category.get(category, 0) + 1
            total_bytes += file_entry.size_bytes
            path_lower = file_entry.relative_path.lower()
            if path_lower.endswith(".zip") and "audio" in path_lower:
                required_audio_zip_present = True

        return ManifestSummary(
            total_file_count=len(file_list),
            total_bytes=total_bytes,
            counts_by_category=counts_by_category,
            required_audio_zip_present=required_audio_zip_present,
        )

    def _build_handoff_event(
        self, handoff: StorageHandoffSnapshot, request_id: str
    ) -> StorageHandoffEvent:
        return StorageHandoffEvent(
            event_name=STORAGE_HANDOFF_STATUS_EVENT,
            event_id=f"evt:{handoff.handoff_id}:{handoff.status.value}",
            handoff_id=handoff.handoff_id,
            submission_id=handoff.submission_id,
            intake_session_id=handoff.intake_session_id,
            status=handoff.status,
            target=handoff.target,
            object_count=handoff.object_count,
            occurred_at=handoff.updated_at,
            idempotency_key=f"storage.handoff:{handoff.handoff_id}:{request_id}",
        )

    def _resolve_local_pack_root(self, metadata: dict[str, Any]) -> Path | None:
        pack_path = self._normalize_optional_str(metadata.get("local_pack_path"))
        if not pack_path:
            return None
        path = Path(pack_path).expanduser()
        if path.exists() and path.is_dir():
            return path
        return None

    def _materialize_manifest_entry(
        self, pack_root: Path | None, source_entry: ManifestFileEntry
    ) -> ManifestFileEntry:
        relative_path = source_entry.relative_path
        size_bytes = int(source_entry.size_bytes)
        sha256_hex = source_entry.sha256
        mime_type = source_entry.mime_type

        if pack_root is not None:
            candidate = (pack_root / relative_path).resolve()
            if (
                candidate.exists()
                and candidate.is_file()
                and self._is_child_path(candidate, pack_root)
            ):
                size_bytes = max(1, candidate.stat().st_size)
                sha256_hex = self._sha256_file(candidate)
                mime_type = mimetypes.guess_type(candidate.name)[0] or source_entry.mime_type

        return ManifestFileEntry(
            relative_path=relative_path,
            size_bytes=size_bytes,
            sha256=sha256_hex,
            mime_type=mime_type,
            category=source_entry.category,
            required_asset=source_entry.required_asset,
        )

    def _manifest_to_json_map(self, files: Iterable[ManifestFileEntry]) -> dict[str, str]:
        return {entry.relative_path: entry.sha256 for entry in files}

    def _upload_manifest_files_to_dropbox(
        self,
        *,
        intake_session_id: str,
        submission_id: str,
        dropbox_destination_root: str,
    ) -> None:
        dropbox_client = self._build_dropbox_client()

        session = self._find_session_by_id(intake_session_id)
        if session is None:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                message=f"Intake session {intake_session_id} was not found.",
                status_code=404,
                details={"intake_session_id": intake_session_id},
            )

        pack_root = self._resolve_local_pack_root(session.metadata)
        if pack_root is None:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Storage handoff requires a valid local_pack_path in session metadata.",
                status_code=409,
                details={"intake_session_id": intake_session_id, "submission_id": submission_id},
            )

        manifest = self._build_manifest_snapshot(intake_session_id)
        if manifest is None or not manifest.files:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Storage handoff requires a non-empty manifest.",
                status_code=409,
                details={"intake_session_id": intake_session_id},
            )

        for entry in manifest.files:
            source_path = (pack_root / entry.relative_path).resolve()
            if not source_path.exists() or not source_path.is_file():
                raise DomainError(
                    code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                    message=f"Manifest file {entry.relative_path} does not exist in local pack.",
                    status_code=409,
                    details={
                        "intake_session_id": intake_session_id,
                        "file_path": entry.relative_path,
                    },
                )

            dropbox_path = (
                f"{dropbox_destination_root.rstrip('/')}/{entry.relative_path}".replace("//", "/")
            )
            try:
                self._upload_file_in_chunks(dropbox_client, source_path, dropbox_path)
            except DomainError:
                raise
            except Exception as exc:  # pragma: no cover - defensive mapping
                raise DomainError(
                    code=self._classify_dropbox_error_code(exc),
                    message="Dropbox upload failed for storage handoff.",
                    status_code=409,
                    details={
                        "intake_session_id": intake_session_id,
                        "file_path": entry.relative_path,
                        "reason": str(exc),
                    },
                ) from exc

    def _verify_dropbox_delivery(self, handoff: StorageHandoffSnapshot) -> None:
        client = self._build_dropbox_client()

        try:
            upload_session_row = self._connection.execute(
                "SELECT dropbox_dest_path FROM upload_sessions WHERE id = ?",
                (handoff.intake_session_id,),
            ).fetchone()
            if upload_session_row is None or not upload_session_row["dropbox_dest_path"]:
                return

            client.files_get_metadata(upload_session_row["dropbox_dest_path"])
        except Exception as exc:
            raise DomainError(
                code=self._classify_dropbox_error_code(exc),
                message="Dropbox confirmation failed for storage handoff.",
                status_code=409,
                details={
                    "handoff_id": handoff.handoff_id,
                    "dropbox_path": (
                        upload_session_row["dropbox_dest_path"] if upload_session_row else None
                    ),
                    "reason": str(exc),
                },
            ) from exc

    def _upload_file_in_chunks(self, client: Any, source_path: Path, destination_path: str) -> None:
        import dropbox

        file_size = source_path.stat().st_size
        with source_path.open("rb") as stream:
            if file_size <= DROPBOX_CHUNK_SIZE:
                client.files_upload(
                    stream.read(),
                    destination_path,
                    mode=dropbox.files.WriteMode.overwrite,
                    mute=True,
                )
                return

            start_result = client.files_upload_session_start(stream.read(DROPBOX_CHUNK_SIZE))
            cursor = dropbox.files.UploadSessionCursor(
                session_id=start_result.session_id,
                offset=stream.tell(),
            )
            commit = dropbox.files.CommitInfo(
                path=destination_path,
                mode=dropbox.files.WriteMode.overwrite,
            )

            while stream.tell() < file_size:
                remaining = file_size - stream.tell()
                chunk = stream.read(min(DROPBOX_CHUNK_SIZE, remaining))
                if remaining <= DROPBOX_CHUNK_SIZE:
                    client.files_upload_session_finish(chunk, cursor, commit)
                else:
                    client.files_upload_session_append_v2(chunk, cursor)
                    cursor.offset = stream.tell()

    def _classify_dropbox_error_code(self, exc: Exception) -> str:
        reason = str(exc).lower()
        auth_markers = (
            "autherror",
            "invalid_access_token",
            "expired_access_token",
            "expiredcredentials",
            "refresh token",
            "invalid_grant",
        )
        if any(marker in reason for marker in auth_markers):
            return "DROPBOX_AUTH_INVALID"
        return IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED

    def _load_integration_credentials_row(self, provider: str):
        return self._connection.execute(
            """
            SELECT credentials_json
            FROM integration_credentials
            WHERE provider = ?
            """,
            (provider,),
        ).fetchone()

    def _parse_integration_credentials_json(self, provider: str) -> dict[str, str]:
        row = self._load_integration_credentials_row(provider)
        if row is None:
            return {}
        raw = str(row["credentials_json"] or "").strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if not isinstance(parsed, dict):
            return {}
        output: dict[str, str] = {}
        for key, value in parsed.items():
            if value is None:
                continue
            normalized = str(value).strip()
            if normalized:
                output[str(key)] = normalized
        return output

    def _read_env_local(self) -> dict[str, str]:
        env_values: dict[str, str] = {}
        env_local_path = Path(__file__).resolve().parents[3] / ".env.local"
        if not env_local_path.exists():
            return env_values
        for line in env_local_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            cleaned_key = key.strip()
            cleaned_value = self._normalize_env_value(value)
            if cleaned_key and cleaned_value:
                env_values[cleaned_key] = cleaned_value
        return env_values

    def _normalize_env_value(self, raw: str) -> str:
        value = raw.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        return value.strip()

    def _resolve_dropbox_credentials(self) -> dict[str, str | None]:
        stored = self._parse_integration_credentials_json("dropbox")
        env_local = self._read_env_local()

        def pick(name: str, stored_key: str) -> str | None:
            stored_value = stored.get(stored_key)
            if stored_value:
                return stored_value
            env_value = os.environ.get(name) or env_local.get(name)
            if env_value:
                cleaned = str(env_value).strip()
                return cleaned or None
            return None

        return {
            "app_key": pick("DROPBOX_APP_KEY", "app_key"),
            "app_secret": pick("DROPBOX_APP_SECRET", "app_secret"),
            "refresh_token": pick("DROPBOX_REFRESH_TOKEN", "refresh_token"),
            "access_token": pick("DROPBOX_ACCESS_TOKEN", "access_token"),
        }

    def _build_dropbox_client(self) -> Any:
        try:
            import dropbox
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise DomainError(
                code="DROPBOX_NOT_CONFIGURED",
                message="Dropbox SDK is not installed. Add python dependency 'dropbox'.",
                status_code=409,
                details={},
            ) from exc
        credentials = self._resolve_dropbox_credentials()
        app_key = credentials["app_key"]
        app_secret = credentials["app_secret"]
        refresh_token = credentials["refresh_token"]
        access_token = credentials["access_token"]

        if app_key and app_secret and refresh_token:
            return dropbox.Dropbox(
                oauth2_access_token=access_token or None,
                oauth2_refresh_token=refresh_token,
                app_key=app_key,
                app_secret=app_secret,
                timeout=120,
            )

        if access_token:
            return dropbox.Dropbox(oauth2_access_token=access_token, timeout=120)

        raise DomainError(
            code="DROPBOX_NOT_CONFIGURED",
            message=(
                "Dropbox is not configured. Set app key/secret + refresh token in Integrations."
            ),
            status_code=409,
            details={},
        )

    def _get_dropbox_delivery_folder(self) -> str:
        value = os.environ.get("DROPBOX_DELIVERY_FOLDER", "/Splice-Deliveries")
        cleaned = str(value).strip() or "/Splice-Deliveries"
        return cleaned if cleaned.startswith("/") else f"/{cleaned}"

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

    def _status_from_str(self, value: str) -> IntakeSessionStatus:
        for status in IntakeSessionStatus:
            if status.value == value:
                return status
        return IntakeSessionStatus.INITIATED

    def _handoff_status_from_session(
        self, session_status: IntakeSessionStatus, explicit_status: str | None
    ) -> StorageHandoffStatus:
        if explicit_status:
            for status in StorageHandoffStatus:
                if status.value == explicit_status:
                    return status
        if session_status == IntakeSessionStatus.TRANSFER_COMPLETED:
            return StorageHandoffStatus.COMPLETED
        if session_status == IntakeSessionStatus.MANIFEST_READY:
            return StorageHandoffStatus.QUEUED
        return StorageHandoffStatus.IN_PROGRESS

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
