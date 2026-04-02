"""Airtable sync orchestration for creator submissions."""

from __future__ import annotations

from fastapi import HTTPException

from app.core.logging import get_logger
from app.features.creator import airtable_sync as _airtable_sync
from app.features.creator.contracts import AirtableLinkStateResponse

from .helpers import (
    apply_airtable_metadata_update,
    build_airtable_link_state_response,
    fetch_airtable_link_row,
    fetch_submission_metadata_row,
    normalize_sync_status,
    now_iso,
    parse_json,
    sort_records_by_created_at,
    upsert_airtable_link_row,
)

logger = get_logger(__name__)

# Re-export so tests can patch via `app.features.creator.service.X`
fetch_airtable_records_for_submission = _airtable_sync.fetch_airtable_records_for_submission
create_airtable_record_for_submission = _airtable_sync.create_airtable_record_for_submission

_TABLE_DEFAULT = _airtable_sync.AIRTABLE_TABLE_DEFAULT
_VIEW_DEFAULT = _airtable_sync.AIRTABLE_VIEW_DEFAULT


def sync_airtable_link_state(
    connection,
    *,
    submission_id: str,
    creator_id: str,
    force_relink: bool,
) -> AirtableLinkStateResponse:
    del force_relink
    metadata_row = fetch_submission_metadata_row(connection, submission_id)
    link_row = fetch_airtable_link_row(connection, submission_id)

    if metadata_row is None and link_row is not None:
        upsert_airtable_link_row(
            connection,
            submission_id=submission_id,
            airtable_base_id=link_row["airtable_base_id"] or "",
            airtable_table_name=link_row["airtable_table_name"] or _TABLE_DEFAULT,
            airtable_view_name=link_row["airtable_view_name"] or _VIEW_DEFAULT,
            airtable_record_id=link_row["airtable_record_id"],
            airtable_record_url=link_row["airtable_record_url"],
            airtable_payload_checksum=link_row["airtable_payload_checksum"],
            sync_status="sync_error",
            last_synced_at=link_row["last_synced_at"],
            last_error_code="LOCAL_SUBMISSION_METADATA_MISSING",
            last_error_detail=(
                "Link row exists but submission_metadata row is missing for this submission."
            ),
        )
        link_row = fetch_airtable_link_row(connection, submission_id)
        return build_airtable_link_state_response(
            submission_id=submission_id,
            metadata_row=metadata_row,
            link_row=link_row,
        )

    if metadata_row is None:
        raise HTTPException(status_code=409, detail="LOCAL_SUBMISSION_METADATA_MISSING")

    fetch_result = fetch_airtable_records_for_submission(submission_id)
    now = now_iso()
    metadata_created_at = metadata_row["created_at"] or now

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
        apply_airtable_metadata_update(
            connection,
            submission_id=submission_id,
            creator_id=creator_id,
            metadata_created_at=metadata_created_at,
            pack_name=metadata_row["pack_name"],
            label_name=metadata_row["label_name"],
            release_month=metadata_row["release_month"],
            notes=metadata_row["notes"],
            tags=parse_json(metadata_row["tags_json"], []),
            airtable_form_completed=False,
            airtable_payload_checksum=metadata_row["airtable_payload_checksum"],
        )
        refreshed_metadata = fetch_submission_metadata_row(connection, submission_id)
        refreshed_link = fetch_airtable_link_row(connection, submission_id)
        return build_airtable_link_state_response(
            submission_id=submission_id,
            metadata_row=refreshed_metadata,
            link_row=refreshed_link,
        )

    records = sort_records_by_created_at(fetch_result.records)

    if len(records) == 0:
        previously_linked = (
            link_row is not None
            and normalize_sync_status(link_row["sync_status"]) == "linked"
            and link_row["airtable_record_id"]
        )
        if previously_linked:
            upsert_airtable_link_row(
                connection,
                submission_id=submission_id,
                airtable_base_id=fetch_result.base_id,
                airtable_table_name=fetch_result.table_name,
                airtable_view_name=fetch_result.view_name,
                airtable_record_id=link_row["airtable_record_id"],
                airtable_record_url=link_row["airtable_record_url"],
                airtable_payload_checksum=link_row["airtable_payload_checksum"],
                sync_status="desynced",
                last_synced_at=now,
                last_error_code="AIRTABLE_LINKED_RECORD_MISSING",
                last_error_detail="Previously linked Airtable record is no longer reachable.",
            )
            apply_airtable_metadata_update(
                connection,
                submission_id=submission_id,
                creator_id=creator_id,
                metadata_created_at=metadata_created_at,
                pack_name=metadata_row["pack_name"],
                label_name=metadata_row["label_name"],
                release_month=metadata_row["release_month"],
                notes=metadata_row["notes"],
                tags=parse_json(metadata_row["tags_json"], []),
                airtable_form_completed=False,
                airtable_payload_checksum=metadata_row["airtable_payload_checksum"],
            )
            refreshed_metadata = fetch_submission_metadata_row(connection, submission_id)
            refreshed_link = fetch_airtable_link_row(connection, submission_id)
            return build_airtable_link_state_response(
                submission_id=submission_id,
                metadata_row=refreshed_metadata,
                link_row=refreshed_link,
            )

        logger.info(
            "No Airtable record found for submission; attempting create.",
            extra={"submission_id": submission_id},
        )
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
                last_error_code=create_result.error_code or "AIRTABLE_UNAVAILABLE",
                last_error_detail=create_result.error_detail or "Failed to create Airtable record.",
            )
            apply_airtable_metadata_update(
                connection,
                submission_id=submission_id,
                creator_id=creator_id,
                metadata_created_at=metadata_created_at,
                pack_name=metadata_row["pack_name"],
                label_name=metadata_row["label_name"],
                release_month=metadata_row["release_month"],
                notes=metadata_row["notes"],
                tags=parse_json(metadata_row["tags_json"], []),
                airtable_form_completed=False,
                airtable_payload_checksum=metadata_row["airtable_payload_checksum"],
            )
            refreshed_metadata = fetch_submission_metadata_row(connection, submission_id)
            refreshed_link = fetch_airtable_link_row(connection, submission_id)
            return build_airtable_link_state_response(
                submission_id=submission_id,
                metadata_row=refreshed_metadata,
                link_row=refreshed_link,
            )

        created_record = create_result.record
        new_status = "linked" if created_record.required_fields_complete else "pending"
        new_error_code = (
            None if created_record.required_fields_complete
            else "AIRTABLE_REQUIRED_FIELDS_INCOMPLETE"
        )
        new_error_detail = (
            None if created_record.required_fields_complete
            else "Label Name, Pack Name, and Release Month are required in Airtable."
        )
        upsert_airtable_link_row(
            connection,
            submission_id=submission_id,
            airtable_base_id=create_result.base_id,
            airtable_table_name=create_result.table_name,
            airtable_view_name=create_result.view_name,
            airtable_record_id=created_record.record_id,
            airtable_record_url=created_record.record_url,
            airtable_payload_checksum=created_record.checksum,
            sync_status=new_status,
            last_synced_at=now,
            last_error_code=new_error_code,
            last_error_detail=new_error_detail,
        )
        apply_airtable_metadata_update(
            connection,
            submission_id=submission_id,
            creator_id=creator_id,
            metadata_created_at=metadata_created_at,
            pack_name=created_record.pack_name or metadata_row["pack_name"],
            label_name=created_record.label_name or metadata_row["label_name"],
            release_month=created_record.release_month or metadata_row["release_month"],
            notes=(
                created_record.notes if created_record.notes is not None
                else metadata_row["notes"]
            ),
            tags=(
                created_record.tags if created_record.tags
                else parse_json(metadata_row["tags_json"], [])
            ),
            airtable_form_completed=created_record.required_fields_complete,
            airtable_payload_checksum=created_record.checksum,
        )
        refreshed_metadata = fetch_submission_metadata_row(connection, submission_id)
        refreshed_link = fetch_airtable_link_row(connection, submission_id)
        return build_airtable_link_state_response(
            submission_id=submission_id,
            metadata_row=refreshed_metadata,
            link_row=refreshed_link,
            mapped_record=created_record,
        )

    if len(records) > 1:
        canonical = records[0]
        upsert_airtable_link_row(
            connection,
            submission_id=submission_id,
            airtable_base_id=fetch_result.base_id,
            airtable_table_name=fetch_result.table_name,
            airtable_view_name=fetch_result.view_name,
            airtable_record_id=canonical.record_id,
            airtable_record_url=canonical.record_url,
            airtable_payload_checksum=canonical.checksum,
            sync_status="duplicate_detected",
            last_synced_at=now,
            last_error_code="AIRTABLE_DUPLICATE_SUBMISSION_ID",
            last_error_detail=(
                f"Found {len(records)} records for this submission id. "
                f"Canonical candidate is {canonical.record_id}."
            ),
        )
        apply_airtable_metadata_update(
            connection,
            submission_id=submission_id,
            creator_id=creator_id,
            metadata_created_at=metadata_created_at,
            pack_name=metadata_row["pack_name"],
            label_name=metadata_row["label_name"],
            release_month=metadata_row["release_month"],
            notes=metadata_row["notes"],
            tags=parse_json(metadata_row["tags_json"], []),
            airtable_form_completed=False,
            airtable_payload_checksum=metadata_row["airtable_payload_checksum"],
        )
        refreshed_metadata = fetch_submission_metadata_row(connection, submission_id)
        refreshed_link = fetch_airtable_link_row(connection, submission_id)
        return build_airtable_link_state_response(
            submission_id=submission_id,
            metadata_row=refreshed_metadata,
            link_row=refreshed_link,
            canonical_record_id=canonical.record_id,
            mapped_record=canonical,
        )

    record = records[0]
    next_status = "linked" if record.required_fields_complete else "pending"
    next_error_code = (
        None if record.required_fields_complete else "AIRTABLE_REQUIRED_FIELDS_INCOMPLETE"
    )
    next_error_detail = None if record.required_fields_complete else (
        "Label Name, Pack Name, and Release Month are required in Airtable."
    )
    upsert_airtable_link_row(
        connection,
        submission_id=submission_id,
        airtable_base_id=fetch_result.base_id,
        airtable_table_name=fetch_result.table_name,
        airtable_view_name=fetch_result.view_name,
        airtable_record_id=record.record_id,
        airtable_record_url=record.record_url,
        airtable_payload_checksum=record.checksum,
        sync_status=next_status,
        last_synced_at=now,
        last_error_code=next_error_code,
        last_error_detail=next_error_detail,
    )
    apply_airtable_metadata_update(
        connection,
        submission_id=submission_id,
        creator_id=creator_id,
        metadata_created_at=metadata_created_at,
        pack_name=record.pack_name or metadata_row["pack_name"],
        label_name=record.label_name or metadata_row["label_name"],
        release_month=record.release_month or metadata_row["release_month"],
        notes=record.notes if record.notes is not None else metadata_row["notes"],
        tags=record.tags if record.tags else parse_json(metadata_row["tags_json"], []),
        airtable_form_completed=record.required_fields_complete,
        airtable_payload_checksum=record.checksum,
    )
    refreshed_metadata = fetch_submission_metadata_row(connection, submission_id)
    refreshed_link = fetch_airtable_link_row(connection, submission_id)
    return build_airtable_link_state_response(
        submission_id=submission_id,
        metadata_row=refreshed_metadata,
        link_row=refreshed_link,
        mapped_record=record,
    )
