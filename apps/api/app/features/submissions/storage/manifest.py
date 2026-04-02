"""SQLite-backed PRD-03/12 intake, manifest, and Dropbox handoff service."""

from __future__ import annotations

import hashlib
import json
import mimetypes
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from app.core.errors import DomainError
from app.features.submissions.storage_contracts import (
    INTAKE_MANIFEST_INDEXED_EVENT,
    IntakeInventoryResult,
    IntakeLifecycleEvent,
    IntakeSessionStatus,
    IntakeStorageErrorCode,
    ManifestFileEntry,
    ManifestSnapshot,
    ManifestSummary,
    UpsertIntakeManifestRequest,
    UpsertIntakeManifestResult,
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
EXCLUDED_MANIFEST_FILENAMES = frozenset(
    {
        ".ds_store",
        "thumbs.db",
        "desktop.ini",
    }
)
EXCLUDED_MANIFEST_PREFIXES = (".__",)


class ManifestMixin:
    """Extracted mixin for IntakeStorageService."""

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

        files = [
            self._materialize_manifest_entry(pack_root, entry)
            for entry in request.files
            if not self._should_exclude_manifest_path(entry.relative_path)
        ]
        if not files:
            raise DomainError(
                code=IntakeStorageErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Manifest contains only excluded system files.",
                status_code=422,
                details={"intake_session_id": intake_session_id},
            )
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

    def _should_exclude_manifest_path(self, relative_path: str) -> bool:
        for segment in relative_path.split("/"):
            normalized = segment.strip().lower()
            if not normalized:
                continue
            if normalized in EXCLUDED_MANIFEST_FILENAMES:
                return True
            if any(normalized.startswith(prefix) for prefix in EXCLUDED_MANIFEST_PREFIXES):
                return True
        return False
