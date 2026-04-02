from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread

import pytest

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.observability import ObservabilityService
from app.features.jobs.service import BackgroundJobQueueService, register_integration_job_handlers
from app.features.submissions.contracts import ActorRole
from app.features.submissions.storage import IntakeStorageService
from app.features.submissions.storage_contracts import (
    CreateStorageHandoffRequest,
    IntakeSessionStatus,
    IntakeStorageErrorCode,
    ManifestFileEntry,
    StartIntakeSessionRequest,
    StorageHandoffControlAction,
    StorageHandoffControlRequest,
    StorageHandoffStatus,
    UnlockSubmissionFilesRequest,
    UpsertIntakeManifestRequest,
)


def create_service() -> IntakeStorageService:
    connection = get_connection(":memory:")
    schema_path = Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    connection.executescript(schema_path.read_text(encoding="utf-8"))
    return IntakeStorageService(connection=connection)


def create_session(service: IntakeStorageService, submission_id: str) -> str:
    result = service.start_intake_session(
        StartIntakeSessionRequest(
            request_id="req-start-1",
            submission_id=submission_id,
            creator_id="creator-1",
            pack_name="Pack A",
            declared_top_level_folders=["Audio", "Artwork"],
        )
    )
    return result.session.intake_session_id


def create_manifest_request(*, request_id: str, lock_manifest: bool) -> UpsertIntakeManifestRequest:
    return UpsertIntakeManifestRequest(
        request_id=request_id,
        files=[
            ManifestFileEntry(
                relative_path="Audio/Label - Pack.zip",
                size_bytes=2048,
                sha256="a" * 64,
                mime_type="application/zip",
                category="audio_zip",
                required_asset=True,
            )
        ],
        lock_manifest=lock_manifest,
    )


def seed_submission_state(
    service: IntakeStorageService, submission_id: str, *, current_state: str
) -> None:
    now = datetime.now(tz=UTC).isoformat()
    service._connection.execute(
        """
        INSERT INTO submissions (id, creator_id, current_state, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (submission_id, "creator-1", current_state, 0, now, now),
    )
    service._connection.commit()


def test_start_intake_session_is_idempotent_by_request_key() -> None:
    service = create_service()
    first = service.start_intake_session(
        StartIntakeSessionRequest(
            request_id="req-1",
            submission_id="sub-1",
            creator_id="creator-1",
            pack_name="Pack 1",
            declared_top_level_folders=["Audio"],
        )
    )
    second = service.start_intake_session(
        StartIntakeSessionRequest(
            request_id="req-1",
            submission_id="sub-1",
            creator_id="creator-1",
            pack_name="Pack 1",
            declared_top_level_folders=["Audio"],
        )
    )

    assert first.created is True
    assert first.idempotent is False
    assert second.idempotent is True
    assert second.session.intake_session_id == first.session.intake_session_id


def test_start_intake_session_resets_canceled_upload_for_new_attempt() -> None:
    service = create_service()
    session_id = create_session(service, "sub-start-reset-canceled")
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-reset-canceled", lock_manifest=True),
    )
    service._set_handoff_control_status(
        intake_session_id=session_id,
        status=StorageHandoffStatus.CANCELED,
        error="Canceled by creator-1",
    )

    restarted = service.start_intake_session(
        StartIntakeSessionRequest(
            request_id="req-start-reset-canceled",
            submission_id="sub-start-reset-canceled",
            creator_id="creator-1",
            pack_name="Pack A",
            declared_top_level_folders=["Audio", "Artwork"],
        )
    )

    assert restarted.created is False
    assert restarted.idempotent is False
    assert restarted.session.intake_session_id == session_id
    assert restarted.session.status is IntakeSessionStatus.INITIATED
    assert restarted.session.metadata.get("handoff_status") is None
    assert restarted.session.metadata.get("upload_status") is None
    assert restarted.session.metadata.get("last_handoff_request_key") is None

    lock_rows = service._connection.execute(
        "SELECT COUNT(*) AS count FROM asset_manifest WHERE session_id = ? AND locked = 1",
        (session_id,),
    ).fetchone()
    assert lock_rows is not None
    assert lock_rows["count"] == 0


def test_manifest_upsert_rejects_version_conflict() -> None:
    service = create_service()
    session_id = create_session(service, "sub-2")
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=False),
    )

    with pytest.raises(DomainError) as exc_info:
        service.upsert_manifest(
            session_id,
            UpsertIntakeManifestRequest(
                request_id="req-man-2",
                expected_manifest_version=0,
                files=create_manifest_request(request_id="unused", lock_manifest=False).files,
                lock_manifest=False,
            ),
        )
    assert exc_info.value.code == IntakeStorageErrorCode.INTAKE_MANIFEST_VERSION_CONFLICT


def test_manifest_upsert_rejects_when_manifest_locked() -> None:
    service = create_service()
    session_id = create_session(service, "sub-3")
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=True),
    )

    with pytest.raises(DomainError) as exc_info:
        service.upsert_manifest(
            session_id,
            create_manifest_request(request_id="req-man-2", lock_manifest=False),
        )
    assert exc_info.value.code == IntakeStorageErrorCode.INTAKE_MANIFEST_LOCKED


def test_manifest_upsert_excludes_system_metadata_files() -> None:
    service = create_service()
    session_id = create_session(service, "sub-system-files-1")

    result = service.upsert_manifest(
        session_id,
        UpsertIntakeManifestRequest(
            request_id="req-man-system-1",
            files=[
                ManifestFileEntry(
                    relative_path=".DS_Store",
                    size_bytes=10,
                    sha256="b" * 64,
                    mime_type="application/octet-stream",
                    category="other",
                ),
                ManifestFileEntry(
                    relative_path="Audio/Label - Pack.zip",
                    size_bytes=2048,
                    sha256="a" * 64,
                    mime_type="application/zip",
                    category="audio_zip",
                    required_asset=True,
                ),
            ],
            lock_manifest=True,
        ),
    )

    assert result.manifest.summary.total_file_count == 1
    assert result.manifest.files[0].relative_path == "Audio/Label - Pack.zip"


def test_manifest_upsert_rejects_when_only_excluded_system_files() -> None:
    service = create_service()
    session_id = create_session(service, "sub-system-files-2")

    with pytest.raises(DomainError) as exc_info:
        service.upsert_manifest(
            session_id,
            UpsertIntakeManifestRequest(
                request_id="req-man-system-2",
                files=[
                    ManifestFileEntry(
                        relative_path=".DS_Store",
                        size_bytes=10,
                        sha256="b" * 64,
                        mime_type="application/octet-stream",
                        category="other",
                    )
                ],
                lock_manifest=True,
            ),
        )

    assert exc_info.value.code == IntakeStorageErrorCode.INVALID_CONTRACT_PAYLOAD


def test_storage_handoff_requires_locked_manifest() -> None:
    service = create_service()
    session_id = create_session(service, "sub-4")
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=False),
    )

    with pytest.raises(DomainError) as exc_info:
        service.create_storage_handoff(
            CreateStorageHandoffRequest(
                request_id="req-handoff-1",
                intake_session_id=session_id,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
            )
        )
    assert exc_info.value.code == IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED


def test_storage_handoff_rejects_forbidden_role() -> None:
    service = create_service()
    session_id = create_session(service, "sub-5")
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=True),
    )

    with pytest.raises(DomainError) as exc_info:
        service.create_storage_handoff(
            CreateStorageHandoffRequest(
                request_id="req-handoff-1",
                intake_session_id=session_id,
                actor_id="reviewer-1",
                actor_role=ActorRole.REVIEWER,
            )
        )
    assert exc_info.value.code == IntakeStorageErrorCode.STORAGE_HANDOFF_FORBIDDEN


def test_storage_handoff_create_and_status_lookup() -> None:
    service = create_service()
    submission_id = "sub-storage-handoff-lookup"
    session_id = create_session(service, submission_id)
    queue = BackgroundJobQueueService(
        observability=ObservabilityService(
            service="splice-api",
            environment="test",
            connection=service._connection,
        ),
        connection=service._connection,
        start_executor=False,
    )
    register_integration_job_handlers(
        queue,
        connection=service._connection,
        storage_service=service,
    )
    service._build_dropbox_client = lambda: object()  # type: ignore[method-assign]
    service._upload_manifest_files_to_dropbox = lambda **_kwargs: None  # type: ignore[method-assign]
    service._verify_dropbox_delivery = lambda _handoff: None  # type: ignore[method-assign]
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=True),
    )

    created = service.create_storage_handoff(
        CreateStorageHandoffRequest(
            request_id="req-handoff-1",
            intake_session_id=session_id,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
        )
    )

    assert created.event.event_name == "storage.handoff.status.v1"
    assert created.handoff.handoff_id == f"handoff:{session_id}:1"
    assert created.handoff.object_count == 1
    assert created.handoff.status.value == "queued"
    assert created.handoff.progress_percent == 0
    service.process_storage_handoff(
        intake_session_id=session_id,
        request_id="req-handoff-worker",
        request_key=f"{session_id}:req-handoff-worker",
        submission_id=submission_id,
        dropbox_destination_root="/deliveries/sub-storage-handoff-lookup",
    )

    status = service.get_storage_handoff_status(created.handoff.handoff_id)
    assert status.handoff.handoff_id == created.handoff.handoff_id
    assert status.handoff.object_count == 1
    assert status.handoff.status.value == "completed"
    assert status.handoff.progress_percent == 100
    assert status.handoff.uploaded_bytes == status.handoff.total_bytes


def test_storage_handoff_persists_progress_during_background_upload() -> None:
    with TemporaryDirectory() as tmpdir:
        pack_root = Path(tmpdir) / "pack"
        audio_dir = pack_root / "Audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        archive_path = audio_dir / "Label - Pack.zip"
        archive_path.write_bytes(b"x" * 1024)

        service = create_service()
        queue = BackgroundJobQueueService(
            observability=ObservabilityService(
                service="splice-api",
                environment="test",
                connection=service._connection,
            ),
            connection=service._connection,
            start_executor=False,
        )
        register_integration_job_handlers(
            queue,
            connection=service._connection,
            storage_service=service,
        )
        service._build_dropbox_client = lambda: object()  # type: ignore[method-assign]
        service._verify_dropbox_delivery = lambda _handoff: None  # type: ignore[method-assign]

        session = service.start_intake_session(
            StartIntakeSessionRequest(
                request_id="req-start-progress",
                submission_id="sub-storage-progress",
                creator_id="creator-1",
                pack_name="Pack Progress",
                declared_top_level_folders=["Audio"],
                metadata={"local_pack_path": str(pack_root)},
            )
        )
        session_id = session.session.intake_session_id
        service.upsert_manifest(
            session_id,
            UpsertIntakeManifestRequest(
                request_id="req-man-progress",
                files=[
                    ManifestFileEntry(
                        relative_path="Audio/Label - Pack.zip",
                        size_bytes=1024,
                        sha256="b" * 64,
                        mime_type="application/zip",
                        category="audio_zip",
                        required_asset=True,
                    )
                ],
                lock_manifest=True,
            ),
        )

        def fake_upload_file_in_chunks(
            _client,
            _source_path,
            _destination_path,
            *,
            intake_session_id,
            uploaded_bytes,
            total_bytes,
            on_progress=None,
        ):
            if callable(on_progress):
                on_progress(uploaded_bytes + 512, total_bytes)
                row = service._connection.execute(
                    "SELECT chunk_state_json FROM upload_sessions WHERE id = ?",
                    (session_id,),
                ).fetchone()
                assert row is not None
                snapshot = json.loads(row["chunk_state_json"])
                assert snapshot["upload_uploaded_bytes"] == 512
                assert 0 < snapshot["upload_progress_percent"] < 100
                on_progress(total_bytes, total_bytes)
            return total_bytes

        service._upload_file_in_chunks = fake_upload_file_in_chunks  # type: ignore[method-assign]

        created = service.create_storage_handoff(
            CreateStorageHandoffRequest(
                request_id="req-handoff-progress",
                intake_session_id=session_id,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
            )
        )
        assert created.handoff.status.value == "queued"

        service.process_storage_handoff(
            intake_session_id=session_id,
            request_id="req-handoff-progress-worker",
            request_key=f"{session_id}:req-handoff-progress-worker",
            submission_id="sub-storage-progress",
            dropbox_destination_root="/deliveries/sub-storage-progress",
        )
        status = service.get_storage_handoff_status(created.handoff.handoff_id)
        assert status.handoff.status.value == "completed"
        assert status.handoff.progress_percent == 100
        assert status.handoff.uploaded_bytes == status.handoff.total_bytes == 1024


def test_storage_handoff_reuses_existing_queued_job_for_repeated_request() -> None:
    service = create_service()
    session_id = create_session(service, "sub-handoff-idempotent-1")
    queue = BackgroundJobQueueService(
        observability=ObservabilityService(
            service="splice-api",
            environment="test",
            connection=service._connection,
        ),
        connection=service._connection,
        start_executor=False,
    )
    register_integration_job_handlers(
        queue,
        connection=service._connection,
        storage_service=service,
    )
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-idempotent", lock_manifest=True),
    )

    first = service.create_storage_handoff(
        CreateStorageHandoffRequest(
            request_id="req-handoff-first",
            intake_session_id=session_id,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
        )
    )
    second = service.create_storage_handoff(
        CreateStorageHandoffRequest(
            request_id="req-handoff-second",
            intake_session_id=session_id,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
        )
    )

    queued_jobs = service._connection.execute(
        "SELECT COUNT(*) AS count FROM job_runs WHERE job_type = ?",
        ("integration.dropbox.delivery",),
    ).fetchone()
    assert queued_jobs is not None
    assert second.idempotent is True
    assert second.handoff.handoff_id == first.handoff.handoff_id
    assert second.handoff.status.value == "queued"
    assert queued_jobs["count"] == 1


def test_storage_handoff_control_pause_resume_and_cancel_flow() -> None:
    service = create_service()
    queue = BackgroundJobQueueService(
        observability=ObservabilityService(
            service="splice-api",
            environment="test",
            connection=service._connection,
        ),
        connection=service._connection,
        start_executor=False,
    )
    register_integration_job_handlers(
        queue,
        connection=service._connection,
        storage_service=service,
    )
    service._job_queue_service = queue
    service._build_dropbox_client = lambda: object()  # type: ignore[method-assign]
    service._verify_dropbox_delivery = lambda _handoff: None  # type: ignore[method-assign]

    with TemporaryDirectory() as tmpdir:
        pack_root = Path(tmpdir) / "pack"
        audio_dir = pack_root / "Audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        archive_path = audio_dir / "Label - Pack.zip"
        archive_path.write_bytes(b"x" * 1024)

        session = service.start_intake_session(
            StartIntakeSessionRequest(
                request_id="req-start-control",
                submission_id="sub-storage-control",
                creator_id="creator-1",
                pack_name="Pack Control",
                declared_top_level_folders=["Audio"],
                metadata={"local_pack_path": str(pack_root)},
            )
        )
        session_id = session.session.intake_session_id
        service.upsert_manifest(
            session_id,
            UpsertIntakeManifestRequest(
                request_id="req-man-control",
                files=[
                    ManifestFileEntry(
                        relative_path="Audio/Label - Pack.zip",
                        size_bytes=1024,
                        sha256="c" * 64,
                        mime_type="application/zip",
                        category="audio_zip",
                        required_asset=True,
                    )
                ],
                lock_manifest=True,
            ),
        )

        started = Event()
        paused = Event()
        finished = Event()
        result_holder: dict[str, object] = {}

        def fake_upload_file_in_chunks(
            _client,
            _source_path,
            _destination_path,
            *,
            intake_session_id,
            uploaded_bytes,
            total_bytes,
            on_progress=None,
        ):
            started.set()
            while service._get_handoff_control_status(intake_session_id) != StorageHandoffStatus.PAUSED:
                time.sleep(0.01)
            paused.set()
            service._await_handoff_resume_or_cancel(intake_session_id)
            if callable(on_progress):
                on_progress(total_bytes, total_bytes)
            return total_bytes

        service._upload_file_in_chunks = fake_upload_file_in_chunks  # type: ignore[method-assign]

        def run_upload() -> None:
            try:
                result_holder["result"] = service.process_storage_handoff(
                    intake_session_id=session_id,
                    request_id="req-handoff-control",
                    request_key=f"{session_id}:req-handoff-control",
                    submission_id="sub-storage-control",
                    dropbox_destination_root="/deliveries/sub-storage-control",
                )
            except Exception as exc:  # pragma: no cover - captured for assertions
                result_holder["error"] = exc
            finally:
                finished.set()

        thread = Thread(target=run_upload, daemon=True)
        thread.start()

        assert started.wait(timeout=5)

        pause_result = service.control_storage_handoff(
            handoff_id=f"handoff:{session_id}:1",
            request=StorageHandoffControlRequest(
                request_id="req-control-pause",
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                action=StorageHandoffControlAction.PAUSE,
            ),
        )
        assert pause_result.handoff.status is StorageHandoffStatus.PAUSED

        assert paused.wait(timeout=5)
        paused_status = service.get_storage_handoff_status(f"handoff:{session_id}:1")
        assert paused_status.handoff.status is StorageHandoffStatus.PAUSED
        assert paused_status.handoff.progress_percent in {0, 100}

        resume_result = service.control_storage_handoff(
            handoff_id=f"handoff:{session_id}:1",
            request=StorageHandoffControlRequest(
                request_id="req-control-resume",
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                action=StorageHandoffControlAction.RESUME,
            ),
        )
        assert resume_result.handoff.status is StorageHandoffStatus.QUEUED
        assert resume_result.job_reenqueued is True

        assert finished.wait(timeout=5)
        thread.join(timeout=5)
        assert thread.is_alive() is False
        assert "error" not in result_holder
        assert "result" in result_holder

        completed = service.get_storage_handoff_status(f"handoff:{session_id}:1")
        assert completed.handoff.status is StorageHandoffStatus.COMPLETED
        assert completed.handoff.progress_percent == 100
        assert completed.handoff.uploaded_bytes == completed.handoff.total_bytes == 1024


def test_storage_handoff_control_cancel_marks_handoff_canceled() -> None:
    service = create_service()
    service._build_dropbox_client = lambda: object()  # type: ignore[method-assign]
    service._verify_dropbox_delivery = lambda _handoff: None  # type: ignore[method-assign]

    with TemporaryDirectory() as tmpdir:
        pack_root = Path(tmpdir) / "pack"
        audio_dir = pack_root / "Audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        archive_path = audio_dir / "Label - Pack.zip"
        archive_path.write_bytes(b"x" * 1024)

        session = service.start_intake_session(
            StartIntakeSessionRequest(
                request_id="req-start-cancel",
                submission_id="sub-storage-cancel",
                creator_id="creator-1",
                pack_name="Pack Cancel",
                declared_top_level_folders=["Audio"],
                metadata={"local_pack_path": str(pack_root)},
            )
        )
        session_id = session.session.intake_session_id
        service.upsert_manifest(
            session_id,
            UpsertIntakeManifestRequest(
                request_id="req-man-cancel",
                files=[
                    ManifestFileEntry(
                        relative_path="Audio/Label - Pack.zip",
                        size_bytes=1024,
                        sha256="d" * 64,
                        mime_type="application/zip",
                        category="audio_zip",
                        required_asset=True,
                    )
                ],
                lock_manifest=True,
            ),
        )

        started = Event()

        def fake_upload_file_in_chunks(
            _client,
            _source_path,
            _destination_path,
            *,
            intake_session_id,
            uploaded_bytes,
            total_bytes,
            on_progress=None,
        ):
            started.set()
            while True:
                control_status = service._get_handoff_control_status(intake_session_id)
                if control_status in {StorageHandoffStatus.PAUSED, StorageHandoffStatus.CANCELED}:
                    break
                time.sleep(0.01)
            service._await_handoff_resume_or_cancel(intake_session_id)
            return total_bytes

        service._upload_file_in_chunks = fake_upload_file_in_chunks  # type: ignore[method-assign]

        result_holder: dict[str, object] = {}

        def run_upload() -> None:
            try:
                result_holder["result"] = service.process_storage_handoff(
                    intake_session_id=session_id,
                    request_id="req-handoff-cancel",
                    request_key=f"{session_id}:req-handoff-cancel",
                    submission_id="sub-storage-cancel",
                    dropbox_destination_root="/deliveries/sub-storage-cancel",
                )
            except Exception as exc:
                result_holder["error"] = exc

        thread = Thread(target=run_upload, daemon=True)
        thread.start()
        assert started.wait(timeout=5)
        for _ in range(200):
            if service._build_handoff_snapshot(session_id) is not None:
                break
            time.sleep(0.01)

        service.control_storage_handoff(
            handoff_id=f"handoff:{session_id}:1",
            request=StorageHandoffControlRequest(
                request_id="req-control-pause",
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                action=StorageHandoffControlAction.PAUSE,
            ),
        )
        canceled = service.control_storage_handoff(
            handoff_id=f"handoff:{session_id}:1",
            request=StorageHandoffControlRequest(
                request_id="req-control-cancel",
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                action=StorageHandoffControlAction.CANCEL,
            ),
        )
        assert canceled.handoff.status is StorageHandoffStatus.CANCELED

        thread.join(timeout=5)
        assert thread.is_alive() is False
        assert "result" not in result_holder
        assert "error" in result_holder
        assert isinstance(result_holder["error"], DomainError)
        assert getattr(result_holder["error"], "code", None) == IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED

        status = service.get_storage_handoff_status(f"handoff:{session_id}:1")
        assert status.handoff.status is StorageHandoffStatus.CANCELED

        restarted = service.start_intake_session(
            StartIntakeSessionRequest(
                request_id="req-start-cancel-retry",
                submission_id="sub-storage-cancel",
                creator_id="creator-1",
                pack_name="Pack Cancel",
                declared_top_level_folders=["Audio"],
                metadata={"local_pack_path": str(pack_root)},
            )
        )
        assert restarted.idempotent is False
        assert restarted.session.status is IntakeSessionStatus.INITIATED

        service.upsert_manifest(
            session_id,
            UpsertIntakeManifestRequest(
                request_id="req-man-cancel-retry",
                files=[
                    ManifestFileEntry(
                        relative_path="Audio/Label - Pack.zip",
                        size_bytes=1024,
                        sha256="d" * 64,
                        mime_type="application/zip",
                        category="audio_zip",
                        required_asset=True,
                    )
                ],
                lock_manifest=True,
            ),
        )
        service._upload_file_in_chunks = (  # type: ignore[method-assign]
            lambda _client, _source_path, _destination_path, *, intake_session_id, uploaded_bytes, total_bytes, on_progress=None: total_bytes
        )
        retried = service.create_storage_handoff(
            CreateStorageHandoffRequest(
                request_id="req-handoff-cancel-retry",
                intake_session_id=session_id,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
            )
        )
        assert retried.idempotent is False
        assert retried.handoff.status in {
            StorageHandoffStatus.QUEUED,
            StorageHandoffStatus.COMPLETED,
        }
        assert retried.handoff.handoff_id != f"handoff:{session_id}:1"


def test_storage_handoff_control_resume_allows_failed_status() -> None:
    service = create_service()
    session_id = create_session(service, "sub-storage-resume-failed")
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-resume-failed", lock_manifest=True),
    )
    service._set_handoff_control_status(
        intake_session_id=session_id,
        status=StorageHandoffStatus.FAILED,
        error="Simulated transfer failure",
    )

    resumed = service.control_storage_handoff(
        handoff_id=f"handoff:{session_id}:1",
        request=StorageHandoffControlRequest(
            request_id="req-control-resume-failed",
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            action=StorageHandoffControlAction.RESUME,
        ),
    )

    assert resumed.handoff.status is StorageHandoffStatus.QUEUED
    assert resumed.job_reenqueued is False


def test_unlock_submission_assets_rejects_forbidden_role() -> None:
    service = create_service()
    submission_id = "sub-7"
    seed_submission_state(service, submission_id, current_state="rejected")
    session_id = create_session(service, submission_id)
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=True),
    )

    with pytest.raises(DomainError) as exc_info:
        service.unlock_submission_assets(
            submission_id,
            UnlockSubmissionFilesRequest(
                request_id="req-unlock-1",
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
            ),
        )
    assert exc_info.value.code == IntakeStorageErrorCode.SUBMISSION_UNLOCK_FORBIDDEN


def test_unlock_submission_assets_requires_rejected_state() -> None:
    service = create_service()
    submission_id = "sub-8"
    seed_submission_state(service, submission_id, current_state="under_review")
    session_id = create_session(service, submission_id)
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=True),
    )

    with pytest.raises(DomainError) as exc_info:
        service.unlock_submission_assets(
            submission_id,
            UnlockSubmissionFilesRequest(
                request_id="req-unlock-1",
                actor_id="reviewer-1",
                actor_role=ActorRole.REVIEWER,
            ),
        )
    assert exc_info.value.code == IntakeStorageErrorCode.SUBMISSION_UNLOCK_INVALID_STATE


def test_unlock_submission_assets_unlocks_manifest_and_session_state() -> None:
    service = create_service()
    submission_id = "sub-9"
    seed_submission_state(service, submission_id, current_state="rejected")
    session_id = create_session(service, submission_id)
    service.upsert_manifest(
        session_id,
        create_manifest_request(request_id="req-man-1", lock_manifest=True),
    )

    unlocked = service.unlock_submission_assets(
        submission_id,
        UnlockSubmissionFilesRequest(
            request_id="req-unlock-1",
            actor_id="reviewer-1",
            actor_role=ActorRole.REVIEWER,
            notes="Unlocking for amendments.",
        ),
    )
    inventory = service.get_inventory(session_id)

    assert unlocked["submission_id"] == submission_id
    assert unlocked["unlocked_count"] == 1
    assert inventory.manifest is not None
    assert inventory.manifest.locked is False
    assert inventory.session.status.value == "initiated"
