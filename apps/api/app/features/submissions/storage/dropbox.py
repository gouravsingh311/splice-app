"""SQLite-backed PRD-03/12 intake, manifest, and Dropbox handoff service."""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.errors import DomainError
from app.features.jobs.contracts import EnqueueJobRequest
from app.features.submissions.contracts import ActorRole
from app.features.submissions.storage_contracts import (
    STORAGE_HANDOFF_STATUS_EVENT,
    CreateStorageHandoffRequest,
    CreateStorageHandoffResult,
    IntakeSessionStatus,
    IntakeStorageErrorCode,
    StorageHandoffControlAction,
    StorageHandoffControlRequest,
    StorageHandoffControlResult,
    StorageHandoffEvent,
    StorageHandoffSnapshot,
    StorageHandoffStatus,
    StorageHandoffStatusResult,
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


class _HandoffCanceledSignal(Exception):
    """Internal signal used to stop an upload after a cancel control action."""


class DropboxTransferMixin:
    """Extracted mixin for IntakeStorageService."""

    _HANDOFF_CONTROL_SLEEP_SECONDS = 0.5

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

        active_handoff_status = self._normalize_optional_str(metadata.get("handoff_status"))
        has_existing_handoff = bool(active_handoff_status or metadata.get("handoff_job_id"))
        existing = self._build_handoff_snapshot(request.intake_session_id) if has_existing_handoff else None
        if existing is not None and existing.status in {
            StorageHandoffStatus.QUEUED,
            StorageHandoffStatus.IN_PROGRESS,
            StorageHandoffStatus.PAUSED,
            StorageHandoffStatus.COMPLETED,
            StorageHandoffStatus.CANCELED,
        }:
            metadata["last_handoff_request_key"] = request_key
            metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
            self._update_handoff_metadata(
                intake_session_id=request.intake_session_id,
                updates=metadata,
                status=IntakeSessionStatus.MANIFEST_READY.value,
            )
            event = self._build_handoff_event(existing, request.request_id)
            return CreateStorageHandoffResult(idempotent=True, handoff=existing, event=event)

        handoff_id = f"handoff:{request.intake_session_id}:{manifest.manifest_version}"
        dropbox_delivery_folder = self._get_dropbox_delivery_folder()
        dropbox_dest_path = (
            f"{dropbox_delivery_folder.rstrip('/')}/{session.submission_id}".replace("//", "/")
        )

        total_bytes = int(manifest.summary.total_bytes)
        now = datetime.now(tz=UTC)
        metadata.update(
            {
                "last_handoff_request_key": request_key,
                "handoff_status": StorageHandoffStatus.QUEUED.value,
                "handoff_job_id": metadata.get("handoff_job_id"),
                "upload_status": StorageHandoffStatus.QUEUED.value,
                "upload_progress_percent": 0,
                "upload_uploaded_bytes": 0,
                "upload_total_bytes": total_bytes,
                "upload_completed_object_count": 0,
                "upload_error": None,
                "upload_updated_at": now.isoformat(),
            }
        )

        with self._connection:
            self._connection.execute(
                """
                UPDATE upload_sessions
                SET status = ?, dropbox_dest_path = ?, chunk_state_json = ?, completed_at = NULL
                WHERE id = ?
                """,
                (
                    IntakeSessionStatus.MANIFEST_READY.value,
                    dropbox_dest_path,
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    request.intake_session_id,
                ),
            )

        if getattr(self, "_job_queue_service", None) is not None:
            enqueue_result = self._job_queue_service.enqueue(
                EnqueueJobRequest(
                    request_id=request.request_id,
                    job_type="integration.dropbox.delivery",
                    idempotency_key=request_key,
                    payload_json={
                        "submission_id": session.submission_id,
                        "intake_session_id": request.intake_session_id,
                        "dropbox_destination_root": dropbox_dest_path,
                        "handoff_request_id": request.request_id,
                        "handoff_request_key": request_key,
                    },
                    max_attempts=3,
                    correlation_id=None,
                )
            )
            metadata["handoff_job_id"] = enqueue_result.job.id
            metadata["upload_job_status"] = enqueue_result.job.status.value
            self._update_handoff_metadata(
                intake_session_id=request.intake_session_id,
                updates=metadata,
                status=IntakeSessionStatus.MANIFEST_READY.value,
            )
            handoff = self._build_handoff_snapshot(request.intake_session_id)
            if handoff is None:
                raise DomainError(
                    code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                    message=f"Storage handoff {handoff_id} was not found.",
                    status_code=404,
                    details={"handoff_id": handoff_id},
                )
            event = self._build_handoff_event(handoff, request.request_id)
            return CreateStorageHandoffResult(idempotent=False, handoff=handoff, event=event)

        return self.process_storage_handoff(
            intake_session_id=request.intake_session_id,
            request_id=request.request_id,
            request_key=request_key,
            dropbox_destination_root=dropbox_dest_path,
            submission_id=session.submission_id,
        )

    def control_storage_handoff(
        self,
        *,
        handoff_id: str,
        request: StorageHandoffControlRequest,
    ) -> StorageHandoffControlResult:
        if request.actor_role not in {
            ActorRole.CREATOR,
            ActorRole.ADMIN,
            ActorRole.SYSTEM,
        }:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_FORBIDDEN,
                message=f"Role {request.actor_role.value} cannot control storage handoffs.",
                status_code=403,
                details={"actor_role": request.actor_role.value},
            )

        intake_session_id = self._extract_intake_session_id(handoff_id)
        current = self._build_handoff_snapshot(intake_session_id)
        if current is None:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                message=f"Storage handoff {handoff_id} was not found.",
                status_code=404,
                details={"handoff_id": handoff_id},
            )

        if request.action == StorageHandoffControlAction.PAUSE:
            if current.status == StorageHandoffStatus.PAUSED:
                event = self._build_handoff_event(current, request.request_id)
                return StorageHandoffControlResult(handoff=current, job_reenqueued=False, event=event)
            if current.status not in {
                StorageHandoffStatus.QUEUED,
                StorageHandoffStatus.IN_PROGRESS,
            }:
                raise DomainError(
                    code=IntakeStorageErrorCode.STORAGE_HANDOFF_INVALID_CONTROL,
                    message=(
                        f"Storage handoff {handoff_id} cannot be paused from {current.status.value}."
                    ),
                    status_code=409,
                    details={"handoff_id": handoff_id, "status": current.status.value},
                )
            self._set_handoff_control_status(
                intake_session_id=intake_session_id,
                status=StorageHandoffStatus.PAUSED,
                error=None,
            )
            current = self._build_handoff_snapshot(intake_session_id) or current
            event = self._build_handoff_event(current, request.request_id)
            return StorageHandoffControlResult(handoff=current, job_reenqueued=False, event=event)

        if request.action == StorageHandoffControlAction.RESUME:
            if current.status == StorageHandoffStatus.QUEUED:
                event = self._build_handoff_event(current, request.request_id)
                return StorageHandoffControlResult(handoff=current, job_reenqueued=False, event=event)
            if current.status not in {
                StorageHandoffStatus.PAUSED,
                StorageHandoffStatus.FAILED,
            }:
                raise DomainError(
                    code=IntakeStorageErrorCode.STORAGE_HANDOFF_INVALID_CONTROL,
                    message=(
                        f"Storage handoff {handoff_id} cannot be resumed from {current.status.value}."
                    ),
                    status_code=409,
                    details={"handoff_id": handoff_id, "status": current.status.value},
                )

            session = self._find_session_by_id(intake_session_id)
            metadata = dict(session.metadata if session is not None else {})
            request_key = self._normalize_optional_str(metadata.get("last_handoff_request_key"))

            self._set_handoff_control_status(
                intake_session_id=intake_session_id,
                status=StorageHandoffStatus.QUEUED,
                error=None,
            )

            job_reenqueued = False
            if getattr(self, "_job_queue_service", None) is not None:
                refreshed_session = self._find_session_by_id(intake_session_id)
                refreshed_metadata = dict(refreshed_session.metadata if refreshed_session else {})
                enqueue_result = self._job_queue_service.enqueue(
                    EnqueueJobRequest(
                        request_id=request.request_id,
                        job_type="integration.dropbox.delivery",
                        idempotency_key=request_key or handoff_id,
                        payload_json={
                            "submission_id": current.submission_id,
                            "intake_session_id": intake_session_id,
                            "dropbox_destination_root": self._resolve_dropbox_destination_root(
                                intake_session_id
                            ),
                            "handoff_request_id": request.request_id,
                            "handoff_request_key": request_key or handoff_id,
                        },
                        max_attempts=3,
                        correlation_id=None,
                    )
                )
                refreshed_metadata["handoff_status"] = StorageHandoffStatus.QUEUED.value
                refreshed_metadata["upload_status"] = StorageHandoffStatus.QUEUED.value
                refreshed_metadata["handoff_job_id"] = enqueue_result.job.id
                refreshed_metadata["upload_job_status"] = enqueue_result.job.status.value
                refreshed_metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
                self._update_handoff_metadata(
                    intake_session_id=intake_session_id,
                    updates=refreshed_metadata,
                    status=IntakeSessionStatus.MANIFEST_READY.value,
                )
                job_reenqueued = True

            current = self._build_handoff_snapshot(intake_session_id) or current
            event = self._build_handoff_event(current, request.request_id)
            return StorageHandoffControlResult(
                handoff=current,
                job_reenqueued=job_reenqueued,
                event=event,
            )

        if request.action == StorageHandoffControlAction.CANCEL:
            if current.status == StorageHandoffStatus.CANCELED:
                event = self._build_handoff_event(current, request.request_id)
                return StorageHandoffControlResult(handoff=current, job_reenqueued=False, event=event)
            if current.status not in {
                StorageHandoffStatus.QUEUED,
                StorageHandoffStatus.IN_PROGRESS,
                StorageHandoffStatus.PAUSED,
            }:
                raise DomainError(
                    code=IntakeStorageErrorCode.STORAGE_HANDOFF_INVALID_CONTROL,
                    message=(
                        f"Storage handoff {handoff_id} cannot be canceled from {current.status.value}."
                    ),
                    status_code=409,
                    details={"handoff_id": handoff_id, "status": current.status.value},
                )
            self._set_handoff_control_status(
                intake_session_id=intake_session_id,
                status=StorageHandoffStatus.CANCELED,
                error=f"Canceled by {request.actor_id}",
            )
            current = self._build_handoff_snapshot(intake_session_id) or current
            event = self._build_handoff_event(current, request.request_id)
            return StorageHandoffControlResult(handoff=current, job_reenqueued=False, event=event)

        raise DomainError(
            code=IntakeStorageErrorCode.STORAGE_HANDOFF_INVALID_CONTROL,
            message=f"Unsupported handoff control action {request.action.value}.",
            status_code=422,
            details={"handoff_id": handoff_id, "action": request.action.value},
        )

    def process_storage_handoff(
        self,
        *,
        intake_session_id: str,
        request_id: str,
        request_key: str | None = None,
        dropbox_destination_root: str | None = None,
        submission_id: str | None = None,
    ) -> CreateStorageHandoffResult:
        session = self._find_session_by_id(intake_session_id)
        if session is None:
            raise DomainError(
                code=IntakeStorageErrorCode.INTAKE_SESSION_NOT_FOUND,
                message=f"Intake session {intake_session_id} was not found.",
                status_code=404,
                details={"intake_session_id": intake_session_id},
            )

        manifest = self._build_manifest_snapshot(intake_session_id)
        if manifest is None or not manifest.files:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Storage handoff requires a non-empty manifest.",
                status_code=409,
                details={"intake_session_id": intake_session_id},
            )

        dropbox_destination_root = dropbox_destination_root or self._resolve_dropbox_destination_root(
            intake_session_id
        )
        if dropbox_destination_root is None:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Storage handoff requires a dropbox destination root.",
                status_code=409,
                details={"intake_session_id": intake_session_id},
            )

        metadata = dict(session.metadata)
        metadata.setdefault("last_handoff_request_key", request_key or "")
        metadata["handoff_status"] = StorageHandoffStatus.IN_PROGRESS.value
        metadata["upload_status"] = StorageHandoffStatus.IN_PROGRESS.value
        metadata["upload_progress_percent"] = int(metadata.get("upload_progress_percent") or 0)
        metadata["upload_uploaded_bytes"] = int(metadata.get("upload_uploaded_bytes") or 0)
        metadata["upload_total_bytes"] = int(
            metadata.get("upload_total_bytes") or manifest.summary.total_bytes
        )
        metadata["upload_completed_object_count"] = int(
            metadata.get("upload_completed_object_count") or 0
        )
        metadata["upload_error"] = None
        metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
        with self._connection:
            self._connection.execute(
                "UPDATE upload_sessions SET dropbox_dest_path = ? WHERE id = ?",
                (dropbox_destination_root, intake_session_id),
            )
        self._update_handoff_metadata(
            intake_session_id=intake_session_id,
            updates=metadata,
            status=IntakeSessionStatus.MANIFEST_READY.value,
        )

        try:
            self._upload_manifest_files_to_dropbox(
                intake_session_id=intake_session_id,
                submission_id=submission_id or session.submission_id,
                dropbox_destination_root=dropbox_destination_root,
                on_progress=lambda uploaded_bytes, total_bytes, completed_object_count=0: self._persist_handoff_progress(
                    intake_session_id=intake_session_id,
                    status=StorageHandoffStatus.IN_PROGRESS,
                    uploaded_bytes=uploaded_bytes,
                    total_bytes=total_bytes,
                    completed_object_count=completed_object_count,
                ),
            )
            metadata["handoff_status"] = StorageHandoffStatus.COMPLETED.value
            metadata["upload_status"] = StorageHandoffStatus.COMPLETED.value
            metadata["upload_progress_percent"] = 100
            metadata["upload_uploaded_bytes"] = manifest.summary.total_bytes
            metadata["upload_total_bytes"] = manifest.summary.total_bytes
            metadata["upload_completed_object_count"] = manifest.summary.total_file_count
            metadata["upload_error"] = None
            metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
            self._update_handoff_metadata(
                intake_session_id=intake_session_id,
                updates=metadata,
                status=IntakeSessionStatus.TRANSFER_COMPLETED.value,
                completed_at=datetime.now(tz=UTC).isoformat(),
                locked_at=datetime.now(tz=UTC).isoformat(),
            )
        except _HandoffCanceledSignal:
            metadata["handoff_status"] = StorageHandoffStatus.CANCELED.value
            metadata["upload_status"] = StorageHandoffStatus.CANCELED.value
            metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
            metadata["upload_error"] = metadata.get("upload_error") or "Upload canceled."
            self._update_handoff_metadata(
                intake_session_id=intake_session_id,
                updates=metadata,
                status=IntakeSessionStatus.MANIFEST_READY.value,
            )
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Dropbox upload canceled for storage handoff.",
                status_code=409,
                details={"intake_session_id": intake_session_id, "submission_id": submission_id or session.submission_id},
            )
        except DomainError as exc:
            metadata["handoff_status"] = StorageHandoffStatus.FAILED.value
            metadata["upload_status"] = StorageHandoffStatus.FAILED.value
            metadata["upload_error"] = str(exc)
            metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
            self._update_handoff_metadata(
                intake_session_id=intake_session_id,
                updates=metadata,
                status=IntakeSessionStatus.MANIFEST_READY.value,
                locked_at=datetime.now(tz=UTC).isoformat(),
            )
            raise
        except Exception as exc:  # pragma: no cover - defensive fallback
            metadata["handoff_status"] = StorageHandoffStatus.FAILED.value
            metadata["upload_status"] = StorageHandoffStatus.FAILED.value
            metadata["upload_error"] = str(exc)
            metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
            self._update_handoff_metadata(
                intake_session_id=intake_session_id,
                updates=metadata,
                status=IntakeSessionStatus.MANIFEST_READY.value,
                locked_at=datetime.now(tz=UTC).isoformat(),
            )
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Dropbox upload failed for storage handoff.",
                status_code=409,
                details={"intake_session_id": intake_session_id, "reason": str(exc)},
            ) from exc

        handoff = self._build_handoff_snapshot(intake_session_id)
        if handoff is None:
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
                message=f"Storage handoff {intake_session_id} was not found.",
                status_code=404,
                details={"intake_session_id": intake_session_id},
            )
        event = self._build_handoff_event(handoff, request_id)
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
        progress_snapshot = self._progress_snapshot_from_metadata(
            session.metadata,
            manifest.summary.total_bytes,
            manifest.summary.total_file_count,
        )
        created_at = session.created_at
        updated_at = self._parse_nullable_datetime(
            self._normalize_optional_str(session.metadata.get("upload_updated_at"))
        ) or session.updated_at
        completed_at = self._parse_nullable_datetime(self._find_completed_at(intake_session_id))

        return StorageHandoffSnapshot(
            handoff_id=handoff_id,
            submission_id=session.submission_id,
            intake_session_id=intake_session_id,
            status=status,
            target="temporary-object-storage",
            progress_percent=progress_snapshot["progress_percent"],
            uploaded_bytes=progress_snapshot["uploaded_bytes"],
            total_bytes=progress_snapshot["total_bytes"],
            object_count=manifest.summary.total_file_count,
            uploaded_files=progress_snapshot["uploaded_files"],
            total_files=progress_snapshot["total_files"],
            completed_object_count=progress_snapshot["completed_object_count"],
            checksum_verified=True,
            created_at=created_at,
            updated_at=updated_at,
            completed_at=completed_at,
            error=progress_snapshot["error"],
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

    def _upload_manifest_files_to_dropbox(
        self,
        *,
        intake_session_id: str,
        submission_id: str,
        dropbox_destination_root: str,
        on_progress: Any | None = None,
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

        uploaded_bytes = 0
        total_bytes = manifest.summary.total_bytes
        completed_object_count = 0
        for entry in manifest.files:
            self._await_handoff_resume_or_cancel(intake_session_id)
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
            uploaded_bytes = self._upload_file_in_chunks(
                dropbox_client,
                source_path,
                dropbox_path,
                intake_session_id=intake_session_id,
                uploaded_bytes=uploaded_bytes,
                total_bytes=total_bytes,
                on_progress=on_progress,
            )
            completed_object_count += 1
            if callable(on_progress):
                on_progress(uploaded_bytes, total_bytes, completed_object_count)

    def _await_handoff_resume_or_cancel(self, intake_session_id: str) -> None:
        while True:
            status = self._get_handoff_control_status(intake_session_id)
            if status != StorageHandoffStatus.PAUSED:
                if status == StorageHandoffStatus.CANCELED:
                    raise _HandoffCanceledSignal()
                return
            time.sleep(self._HANDOFF_CONTROL_SLEEP_SECONDS)

    def _get_handoff_control_status(self, intake_session_id: str) -> StorageHandoffStatus | None:
        session = self._find_session_by_id(intake_session_id)
        if session is None:
            return None
        raw_status = self._normalize_optional_str(session.metadata.get("handoff_status"))
        if not raw_status:
            return None
        for status in StorageHandoffStatus:
            if status.value == raw_status:
                return status
        return None

    def _set_handoff_control_status(
        self,
        *,
        intake_session_id: str,
        status: StorageHandoffStatus,
        error: str | None,
    ) -> None:
        session = self._find_session_by_id(intake_session_id)
        if session is None:
            return
        metadata = dict(session.metadata)
        metadata["handoff_status"] = status.value
        metadata["upload_status"] = status.value
        metadata["upload_error"] = error
        metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
        if status == StorageHandoffStatus.CANCELED:
            metadata["upload_progress_percent"] = int(metadata.get("upload_progress_percent") or 0)
        self._update_handoff_metadata(
            intake_session_id=intake_session_id,
            updates=metadata,
            status=IntakeSessionStatus.MANIFEST_READY.value,
        )

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
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
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

    def _upload_file_in_chunks(
        self,
        client: Any,
        source_path: Path,
        destination_path: str,
        *,
        intake_session_id: str,
        uploaded_bytes: int,
        total_bytes: int,
        on_progress: Any | None = None,
    ) -> int:
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
                uploaded_bytes += file_size
                if callable(on_progress):
                    on_progress(uploaded_bytes, total_bytes)
                self._await_handoff_resume_or_cancel(intake_session_id)
                return uploaded_bytes

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
                    uploaded_bytes += len(chunk)
                else:
                    client.files_upload_session_append_v2(chunk, cursor)
                    cursor.offset = stream.tell()
                    uploaded_bytes += len(chunk)
                if callable(on_progress):
                    on_progress(uploaded_bytes, total_bytes)
                self._await_handoff_resume_or_cancel(intake_session_id)
        return uploaded_bytes

    def _persist_handoff_progress(
        self,
        *,
        intake_session_id: str,
        status: StorageHandoffStatus,
        uploaded_bytes: int,
        total_bytes: int,
        completed_object_count: int | None = None,
        error: str | None = None,
    ) -> None:
        progress_percent = 0
        if total_bytes > 0:
            progress_percent = min(100, max(0, round((uploaded_bytes / total_bytes) * 100)))
        metadata = self._progress_metadata_from_session(
            intake_session_id,
            status=status,
            progress_percent=progress_percent,
            uploaded_bytes=uploaded_bytes,
            total_bytes=total_bytes,
            completed_object_count=completed_object_count,
            error=error,
        )
        self._update_handoff_metadata(
            intake_session_id=intake_session_id,
            updates=metadata,
            status=IntakeSessionStatus.MANIFEST_READY.value,
        )

    def _progress_metadata_from_session(
        self,
        intake_session_id: str,
        *,
        status: StorageHandoffStatus,
        progress_percent: int,
        uploaded_bytes: int,
        total_bytes: int,
        completed_object_count: int | None,
        error: str | None,
    ) -> dict[str, Any]:
        session = self._find_session_by_id(intake_session_id)
        metadata = dict(session.metadata if session is not None else {})
        metadata["handoff_status"] = status.value
        metadata["upload_status"] = status.value
        metadata["upload_progress_percent"] = progress_percent
        metadata["upload_uploaded_bytes"] = uploaded_bytes
        metadata["upload_total_bytes"] = total_bytes
        if completed_object_count is not None:
            metadata["upload_completed_object_count"] = completed_object_count
        metadata["upload_error"] = error
        metadata["upload_updated_at"] = datetime.now(tz=UTC).isoformat()
        return metadata

    def _progress_snapshot_from_metadata(
        self, metadata: dict[str, Any], fallback_total_bytes: int, fallback_total_files: int
    ) -> dict[str, Any]:
        upload_status = self._normalize_optional_str(metadata.get("upload_status"))
        progress_percent = self._coerce_int(metadata.get("upload_progress_percent"))
        uploaded_bytes = self._coerce_int(metadata.get("upload_uploaded_bytes"))
        total_bytes = self._coerce_int(metadata.get("upload_total_bytes"))
        completed_object_count = self._coerce_int(metadata.get("upload_completed_object_count"))
        error = self._normalize_optional_str(metadata.get("upload_error"))

        if total_bytes is None:
            total_bytes = fallback_total_bytes
        if progress_percent is None:
            if upload_status == StorageHandoffStatus.COMPLETED.value:
                progress_percent = 100
            else:
                progress_percent = 0
        if uploaded_bytes is None:
            uploaded_bytes = total_bytes if upload_status == StorageHandoffStatus.COMPLETED.value else 0
        if completed_object_count is None:
            completed_object_count = 0
        uploaded_files = completed_object_count
        total_files = fallback_total_files

        return {
            "progress_percent": progress_percent,
            "uploaded_bytes": uploaded_bytes,
            "total_bytes": total_bytes,
            "completed_object_count": completed_object_count,
            "uploaded_files": uploaded_files,
            "total_files": total_files,
            "error": error,
        }

    def _coerce_int(self, value: Any) -> int | None:
        try:
            coerced = int(value)
        except (TypeError, ValueError):
            return None
        return coerced if coerced >= 0 else None

    def _resolve_dropbox_destination_root(self, intake_session_id: str) -> str | None:
        row = self._connection.execute(
            "SELECT dropbox_dest_path FROM upload_sessions WHERE id = ?",
            (intake_session_id,),
        ).fetchone()
        if row is None:
            return None
        return self._normalize_optional_str(row["dropbox_dest_path"])

    def _build_dropbox_client(self) -> Any:
        try:
            import dropbox
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise DomainError(
                code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
                message="Dropbox SDK is not installed. Add python dependency 'dropbox'.",
                status_code=500,
                details={},
            ) from exc

        credentials = self._resolve_dropbox_credentials()
        app_key = credentials.get("app_key")
        app_secret = credentials.get("app_secret")
        refresh_token = credentials.get("refresh_token")
        access_token = credentials.get("access_token")

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
            code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
            message=(
                "Dropbox is not configured. Open Admin Ops > Integrations > Dropbox Setup."
            ),
            status_code=409,
            details={},
        )

    def _resolve_dropbox_credentials(self) -> dict[str, str | None]:
        stored = self._parse_integration_credentials_json("dropbox")
        env_local = self._read_env_local()

        def pick(env_name: str, stored_key: str) -> str | None:
            stored_value = stored.get(stored_key)
            if stored_value:
                return stored_value
            env_value = os.environ.get(env_name) or env_local.get(env_name)
            if not env_value:
                return None
            cleaned = str(env_value).strip()
            return cleaned or None

        return {
            "app_key": pick("DROPBOX_APP_KEY", "app_key"),
            "app_secret": pick("DROPBOX_APP_SECRET", "app_secret"),
            "refresh_token": pick("DROPBOX_REFRESH_TOKEN", "refresh_token"),
            "access_token": pick("DROPBOX_ACCESS_TOKEN", "access_token"),
        }

    def _parse_integration_credentials_json(self, provider: str) -> dict[str, str]:
        row = self._connection.execute(
            """
            SELECT credentials_json
            FROM integration_credentials
            WHERE provider = ?
            LIMIT 1
            """,
            (provider,),
        ).fetchone()
        raw = self._normalize_optional_str(row["credentials_json"] if row else None)
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
        env_local_path = self._find_env_local_path()
        if env_local_path is None:
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

    def _find_env_local_path(self) -> Path | None:
        for parent in Path(__file__).resolve().parents:
            candidate = parent / ".env.local"
            if candidate.exists():
                return candidate
        return None

    def _normalize_env_value(self, raw: str) -> str:
        value = raw.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        return value.strip()

    def _get_dropbox_delivery_folder(self) -> str:
        value = os.environ.get("DROPBOX_DELIVERY_FOLDER", "/Splice-Deliveries")
        cleaned = str(value).strip() or "/Splice-Deliveries"
        return cleaned if cleaned.startswith("/") else f"/{cleaned}"

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
