from __future__ import annotations

import sqlite3
from typing import Any

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.creator.airtable_sync import (
    AIRTABLE_FIELD_NOTIFICATION_DELIVERY_STATUS,
    AIRTABLE_FIELD_WORKFLOW_STATUS,
    create_airtable_record_for_submission,
    fetch_airtable_records_for_submission,
    update_airtable_record_fields,
)
from app.features.creator.service.helpers import (
    apply_airtable_metadata_update,
    fetch_airtable_link_row,
    fetch_submission_metadata_row,
    now_iso,
    parse_json,
    sort_records_by_created_at,
    upsert_airtable_link_row,
)
from app.features.jobs.contracts import JobRunSnapshot
from app.features.submissions.contracts import ActorRole, SubmissionState, TransitionRequest
from app.features.submissions.service import SubmissionWorkflowService
from app.features.submissions.storage import IntakeStorageService
from app.features.submissions.storage_contracts import (
    IntakeStorageErrorCode,
    StorageHandoffStatus,
)

logger = get_logger(__name__)

_AIRTABLE_JOB_TYPE = "integration.airtable.sync"
_DROPBOX_JOB_TYPE = "integration.dropbox.delivery"
_WORKFLOW_STATUS_BY_EVENT_NAME = {
    "submission.approved": "Approved",
    "submission.rejected": "Rejected",
    "submission.scheduled": "Scheduled",
    "submission.released": "Released",
    "submission.under_review": "Under Review",
    "submission.draft": "Draft",
}


def register_integration_job_handlers(
    queue: Any,
    *,
    connection: sqlite3.Connection | None = None,
    storage_service: IntakeStorageService | None = None,
    workflow_service: SubmissionWorkflowService | None = None,
) -> None:
    """Register concrete Airtable and Dropbox handlers on the background queue."""
    resolved_connection = connection or get_connection()
    resolved_storage_service = storage_service or IntakeStorageService(connection=resolved_connection)
    resolved_workflow_service = workflow_service
    setattr(resolved_storage_service, "_job_queue_service", queue)

    queue.register_handler(
        _AIRTABLE_JOB_TYPE,
        lambda job: _execute_airtable_sync(job, connection=resolved_connection),
    )
    queue.register_handler(
        _DROPBOX_JOB_TYPE,
        lambda job: _execute_dropbox_delivery(
            job,
            connection=resolved_connection,
            storage_service=resolved_storage_service,
            workflow_service=resolved_workflow_service,
        ),
    )


def _execute_airtable_sync(job: JobRunSnapshot, *, connection: sqlite3.Connection) -> None:
    submission_id = str(job.payload_json.get("submission_id") or "").strip()
    if not submission_id:
        raise DomainError(
            code="INVALID_CONTRACT_PAYLOAD",
            message="integration.airtable.sync jobs require submission_id.",
            status_code=422,
            details={"job_id": job.id},
        )

    metadata_row = fetch_submission_metadata_row(connection, submission_id)
    if metadata_row is None:
        raise DomainError(
            code=IntakeStorageErrorCode.SUBMISSION_NOT_FOUND,
            message=f"Submission {submission_id} was not found.",
            status_code=404,
            details={"submission_id": submission_id},
        )

    fetch_result = fetch_airtable_records_for_submission(submission_id)
    now = now_iso()
    link_row = fetch_airtable_link_row(connection, submission_id)
    metadata_created_at = str(metadata_row["created_at"] or now)

    if fetch_result.error_code is not None:
        upsert_airtable_link_row(
            connection,
            submission_id=submission_id,
            airtable_base_id=fetch_result.base_id,
            airtable_table_name=fetch_result.table_name,
            airtable_view_name=fetch_result.view_name,
            airtable_record_id=link_row["airtable_record_id"] if link_row else None,
            airtable_record_url=link_row["airtable_record_url"] if link_row else None,
            airtable_payload_checksum=link_row["airtable_payload_checksum"] if link_row else None,
            sync_status="sync_error",
            last_synced_at=now,
            last_error_code=fetch_result.error_code,
            last_error_detail=fetch_result.error_detail,
        )
        raise DomainError(
            code=fetch_result.error_code,
            message=fetch_result.error_detail or "Airtable sync failed.",
            status_code=_airtable_status_code(fetch_result.error_code),
            details={"submission_id": submission_id},
        )

    records = sort_records_by_created_at(fetch_result.records)
    if records:
        record = records[0]
        base_id = fetch_result.base_id
        table_name = fetch_result.table_name
        view_name = fetch_result.view_name
    else:
        create_result = create_airtable_record_for_submission(
            submission_id,
            metadata_row=metadata_row,
        )
        if create_result.error_code is not None or create_result.record is None:
            upsert_airtable_link_row(
                connection,
                submission_id=submission_id,
                airtable_base_id=create_result.base_id,
                airtable_table_name=create_result.table_name,
                airtable_view_name=create_result.view_name,
                airtable_record_id=link_row["airtable_record_id"] if link_row else None,
                airtable_record_url=link_row["airtable_record_url"] if link_row else None,
                airtable_payload_checksum=(
                    link_row["airtable_payload_checksum"] if link_row else None
                ),
                sync_status="sync_error",
                last_synced_at=now,
                last_error_code=create_result.error_code,
                last_error_detail=create_result.error_detail,
            )
            raise DomainError(
                code=create_result.error_code or "AIRTABLE_UNAVAILABLE",
                message=create_result.error_detail or "Airtable sync failed.",
                status_code=_airtable_status_code(create_result.error_code),
                details={"submission_id": submission_id},
            )
        record = create_result.record
        base_id = create_result.base_id
        table_name = create_result.table_name
        view_name = create_result.view_name

    sync_status = "linked" if record.required_fields_complete else "pending"
    upsert_airtable_link_row(
        connection,
        submission_id=submission_id,
        airtable_base_id=base_id,
        airtable_table_name=table_name,
        airtable_view_name=view_name,
        airtable_record_id=record.record_id,
        airtable_record_url=record.record_url,
        airtable_payload_checksum=record.checksum,
        sync_status=sync_status,
        last_synced_at=now,
        last_error_code=None,
        last_error_detail=None,
    )
    apply_airtable_metadata_update(
        connection,
        submission_id=submission_id,
        creator_id=str(metadata_row["creator_id"]),
        metadata_created_at=metadata_created_at,
        pack_name=metadata_row["pack_name"],
        label_name=metadata_row["label_name"],
        release_month=metadata_row["release_month"],
        notes=metadata_row["notes"],
        tags=parse_json(metadata_row["tags_json"], []),
        airtable_form_completed=record.required_fields_complete,
        airtable_payload_checksum=record.checksum,
    )
    _apply_airtable_status_updates(
        job=job,
        base_id=base_id,
        table_name=table_name,
        record_id=record.record_id,
        submission_id=submission_id,
    )


def _apply_airtable_status_updates(
    *,
    job: JobRunSnapshot,
    base_id: str,
    table_name: str,
    record_id: str,
    submission_id: str,
) -> None:
    integration_event_name = str(job.payload_json.get("integration_event_name") or "").strip()
    workflow_status = _WORKFLOW_STATUS_BY_EVENT_NAME.get(integration_event_name)
    notification_delivery_status = str(
        job.payload_json.get("notification_delivery_status") or ""
    ).strip()

    fields: dict[str, str] = {}
    if workflow_status:
        fields[AIRTABLE_FIELD_WORKFLOW_STATUS] = workflow_status
    if notification_delivery_status:
        fields[AIRTABLE_FIELD_NOTIFICATION_DELIVERY_STATUS] = notification_delivery_status
    if not fields:
        return

    result = update_airtable_record_fields(
        base_id=base_id,
        table_name=table_name,
        record_id=record_id,
        fields=fields,
    )
    if result.error_code is not None:
        raise DomainError(
            code=result.error_code,
            message=result.error_detail or "Airtable status update failed.",
            status_code=_airtable_status_code(result.error_code),
            details={"submission_id": submission_id, "fields": fields},
        )


def _execute_dropbox_delivery(
    job: JobRunSnapshot,
    *,
    connection: sqlite3.Connection,
    storage_service: IntakeStorageService,
    workflow_service: SubmissionWorkflowService | None = None,
) -> None:
    submission_id = str(job.payload_json.get("submission_id") or "").strip()
    if not submission_id:
        raise DomainError(
            code="INVALID_CONTRACT_PAYLOAD",
            message="integration.dropbox.delivery jobs require submission_id.",
            status_code=422,
            details={"job_id": job.id},
        )

    intake_session_id = _latest_locked_intake_session_id(connection, submission_id=submission_id)
    if intake_session_id is None:
        raise DomainError(
            code=IntakeStorageErrorCode.STORAGE_HANDOFF_NOT_FOUND,
            message=f"No locked intake session was found for submission {submission_id}.",
            status_code=404,
            details={"submission_id": submission_id},
        )

    try:
        result = storage_service.process_storage_handoff(
            intake_session_id=intake_session_id,
            request_id=job.idempotency_key,
            request_key=job.idempotency_key,
            submission_id=submission_id,
            dropbox_destination_root=str(
                job.payload_json.get("dropbox_destination_root") or ""
            ).strip()
            or None,
        )
    except Exception as exc:
        if workflow_service is not None:
            _apply_submission_state_after_handoff(
                workflow_service=workflow_service,
                submission_id=submission_id,
                intake_session_id=intake_session_id,
                succeeded=False,
                request_id=job.idempotency_key,
                failure_reason=str(exc),
            )
        raise

    if result.handoff.status != StorageHandoffStatus.COMPLETED:
        if workflow_service is not None:
            _apply_submission_state_after_handoff(
                workflow_service=workflow_service,
                submission_id=submission_id,
                intake_session_id=intake_session_id,
                succeeded=False,
                request_id=job.idempotency_key,
                failure_reason=result.handoff.error or "Dropbox upload failed.",
            )
        raise DomainError(
            code=IntakeStorageErrorCode.STORAGE_HANDOFF_PRECONDITION_FAILED,
            message=(
                f"Dropbox delivery for submission {submission_id} failed: "
                f"{result.handoff.error or 'unknown error'}"
            ),
            status_code=503,
            details={
                "submission_id": submission_id,
                "intake_session_id": intake_session_id,
                "handoff_id": result.handoff.handoff_id,
            },
        )

    if workflow_service is not None:
        _apply_submission_state_after_handoff(
            workflow_service=workflow_service,
            submission_id=submission_id,
            intake_session_id=intake_session_id,
            succeeded=True,
            request_id=job.idempotency_key,
        )

    logger.info(
        "Dropbox delivery job completed.",
        extra={
            "job_id": job.id,
            "submission_id": submission_id,
            "intake_session_id": intake_session_id,
        },
    )


def _submission_current_state(connection: sqlite3.Connection, *, submission_id: str) -> str | None:
    row = connection.execute(
        "SELECT current_state FROM submissions WHERE id = ?",
        (submission_id,),
    ).fetchone()
    if row is None:
        return None
    return str(row["current_state"] or "").strip().lower() or None


def _apply_submission_state_after_handoff(
    *,
    workflow_service: SubmissionWorkflowService,
    submission_id: str,
    intake_session_id: str,
    succeeded: bool,
    request_id: str,
    failure_reason: str | None = None,
) -> None:
    current_state = _submission_current_state(workflow_service._connection, submission_id=submission_id)
    if succeeded:
        if current_state not in {
            SubmissionState.UPLOADING.value,
            SubmissionState.DRAFT.value,
        }:
            return
        workflow_service.transition_submission(
            submission_id,
            TransitionRequest(
                request_id=request_id,
                to_state=SubmissionState.UNDER_REVIEW,
                actor_id="system-worker",
                actor_role=ActorRole.SYSTEM,
                reason=None,
                expected_version=None,
                metadata={
                    "intake_session_id": intake_session_id,
                    "handoff_result": "completed",
                },
            ),
        )
        return

    if current_state != SubmissionState.UPLOADING.value:
        return

    workflow_service.transition_submission(
        submission_id,
        TransitionRequest(
            request_id=request_id,
            to_state=SubmissionState.DRAFT,
            actor_id="system-worker",
            actor_role=ActorRole.SYSTEM,
            reason=failure_reason or "Dropbox upload failed.",
            expected_version=None,
            metadata={
                "intake_session_id": intake_session_id,
                "handoff_result": "failed",
                **({"handoff_error": failure_reason} if failure_reason else {}),
            },
        ),
    )


def _latest_locked_intake_session_id(
    connection: sqlite3.Connection,
    *,
    submission_id: str,
) -> str | None:
    row = connection.execute(
        """
        SELECT id
        FROM upload_sessions
        WHERE submission_id = ?
          AND locked_at IS NOT NULL
        ORDER BY locked_at DESC, created_at DESC
        LIMIT 1
        """,
        (submission_id,),
    ).fetchone()
    return str(row["id"]) if row is not None else None


def _airtable_status_code(error_code: str | None) -> int:
    if error_code == "AIRTABLE_AUTH_FAILED":
        return 403
    if error_code in {"AIRTABLE_RATE_LIMITED", "AIRTABLE_UNAVAILABLE"}:
        return 503
    return 500
