"""PRD-03/12 FastAPI routes for intake session and storage handoff contracts."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.logging import get_logger
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType
from app.features.audit.service import AuditEventStore
from app.features.submissions.storage import IntakeStorageService
from app.features.submissions.storage_contracts import (
    CreateStorageHandoffRequest,
    CreateStorageHandoffResult,
    IntakeInventoryResult,
    LockSubmissionFilesRequest,
    LockSubmissionFilesResult,
    StartIntakeSessionRequest,
    StartIntakeSessionResult,
    StorageHandoffControlRequest,
    StorageHandoffControlResult,
    StorageHandoffStatusResult,
    UnlockSubmissionFilesRequest,
    UnlockSubmissionFilesResult,
    UpsertIntakeManifestRequest,
    UpsertIntakeManifestResult,
)

router = APIRouter(tags=["intake-storage"])
logger = get_logger(__name__)


def get_intake_storage_service(request: Request) -> IntakeStorageService:
    return request.app.state.intake_storage_service


def get_audit_service(request: Request) -> AuditEventStore:
    return request.app.state.audit_service


@router.post("/intake/sessions", response_model=StartIntakeSessionResult)
async def start_intake_session(
    payload: StartIntakeSessionRequest, request: Request
) -> StartIntakeSessionResult:
    logger.info("Starting intake session.", extra={"submission_id": payload.submission_id})
    service = get_intake_storage_service(request)
    return service.start_intake_session(payload)


@router.put("/intake/sessions/{id}/manifest", response_model=UpsertIntakeManifestResult)
async def upsert_intake_manifest(
    id: str, payload: UpsertIntakeManifestRequest, request: Request
) -> UpsertIntakeManifestResult:
    logger.info("Upserting intake manifest.", extra={"intake_session_id": id})
    service = get_intake_storage_service(request)
    return service.upsert_manifest(id, payload)


@router.get("/intake/sessions/{id}/inventory", response_model=IntakeInventoryResult)
async def get_intake_inventory(id: str, request: Request) -> IntakeInventoryResult:
    service = get_intake_storage_service(request)
    return service.get_inventory(id)


@router.post("/storage/handoffs", response_model=CreateStorageHandoffResult)
async def create_storage_handoff(
    payload: CreateStorageHandoffRequest, request: Request
) -> CreateStorageHandoffResult:
    logger.info(
        "Creating storage handoff.",
        extra={
            "intake_session_id": payload.intake_session_id,
            "actor_id": payload.actor_id,
        },
    )
    service = get_intake_storage_service(request)
    return service.create_storage_handoff(payload)


@router.post("/intake/sessions/{id}/handoff", response_model=CreateStorageHandoffResult)
async def create_intake_session_handoff(
    id: str, payload: CreateStorageHandoffRequest, request: Request
) -> CreateStorageHandoffResult:
    service = get_intake_storage_service(request)
    normalized = payload.model_copy(update={"intake_session_id": id})
    return service.create_storage_handoff(normalized)


@router.get("/storage/handoffs/{id}", response_model=StorageHandoffStatusResult)
async def get_storage_handoff_status(id: str, request: Request) -> StorageHandoffStatusResult:
    service = get_intake_storage_service(request)
    return service.get_storage_handoff_status(id)


@router.post("/storage/handoffs/{id}/control", response_model=StorageHandoffControlResult)
async def control_storage_handoff(
    id: str, payload: StorageHandoffControlRequest, request: Request
) -> StorageHandoffControlResult:
    logger.info(
        "Controlling storage handoff.",
        extra={
            "handoff_id": id,
            "actor_id": payload.actor_id,
            "action": payload.action.value,
        },
    )
    service = get_intake_storage_service(request)
    return service.control_storage_handoff(handoff_id=id, request=payload)


@router.post("/submissions/{id}/lock-files", response_model=LockSubmissionFilesResult)
async def lock_submission_files(
    id: str, payload: LockSubmissionFilesRequest, request: Request
) -> LockSubmissionFilesResult:
    logger.info(
        "Locking submission files.",
        extra={"submission_id": id, "actor_id": payload.actor_id},
    )
    service = get_intake_storage_service(request)
    locked = service.lock_submission_assets(id)
    return LockSubmissionFilesResult(
        submission_id=locked["submission_id"],
        intake_session_id=locked["intake_session_id"],
        locked_count=locked["locked_count"],
        locked_at=locked["locked_at"],
    )


@router.post("/submissions/{id}/unlock-files", response_model=UnlockSubmissionFilesResult)
async def unlock_submission_files(
    id: str, payload: UnlockSubmissionFilesRequest, request: Request
) -> UnlockSubmissionFilesResult:
    logger.info(
        "Unlocking submission files.",
        extra={"submission_id": id, "actor_id": payload.actor_id},
    )
    service = get_intake_storage_service(request)
    unlocked = service.unlock_submission_assets(id, payload)

    get_audit_service(request).append_event(
        AuditAppendRequest(
            actor_id=payload.actor_id,
            action=AuditAction.submission_reopen_requested,
            entity_type=AuditEntityType.submission,
            entity_id=id,
            metadata={
                "intake_session_id": unlocked["intake_session_id"],
                "unlocked_count": unlocked["unlocked_count"],
                "notes": payload.notes,
            },
            request_id=payload.request_id,
            idempotency_key=f"submission.unlock-files:{id}:{payload.request_id}",
        )
    )

    return UnlockSubmissionFilesResult(
        submission_id=unlocked["submission_id"],
        intake_session_id=unlocked["intake_session_id"],
        unlocked_count=unlocked["unlocked_count"],
        unlocked_at=unlocked["unlocked_at"],
    )
