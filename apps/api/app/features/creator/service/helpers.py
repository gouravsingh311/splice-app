"""Shared helpers, DB accessors, and utilities for creator service."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException

from app.core.logging import get_logger
from app.features.creator.airtable_sync import (
    AIRTABLE_SYNC_STATUSES,
    _MappedAirtableRecord,
)
from app.features.creator.contracts import (
    AirtableLinkStateResponse,
    AirtableMappedPayload,
    SubmissionListItem,
)

logger = get_logger(__name__)

CREATOR_NOTIFICATION_KEY = "notifications"
CREATOR_APPROVAL_EMAIL_ENABLED_KEY = "approval_email_enabled"


def now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def to_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def parse_json(value: str | None, default: Any) -> Any:
    if value is None:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return parsed


def normalize_creator_defaults(defaults: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize creator defaults JSON with explicit notification defaults."""
    normalized: dict[str, Any] = dict(defaults or {})
    notifications = normalized.get(CREATOR_NOTIFICATION_KEY)
    if not isinstance(notifications, dict):
        notifications = {}
    notifications = dict(notifications)
    notifications[CREATOR_APPROVAL_EMAIL_ENABLED_KEY] = bool(
        notifications.get(CREATOR_APPROVAL_EMAIL_ENABLED_KEY, False)
    )
    normalized[CREATOR_NOTIFICATION_KEY] = notifications
    return normalized


def creator_approval_email_enabled(defaults: dict[str, Any] | None) -> bool:
    normalized = normalize_creator_defaults(defaults)
    notifications = normalized.get(CREATOR_NOTIFICATION_KEY)
    if not isinstance(notifications, dict):
        return False
    return bool(notifications.get(CREATOR_APPROVAL_EMAIL_ENABLED_KEY, False))


def normalize_sync_status(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in AIRTABLE_SYNC_STATUSES:
        return None
    return normalized


def normalize_upload_status(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in {"queued", "in_progress", "completed", "failed"}:
        return None
    return normalized


def resolve_actor_scoped_id(raw_id: str, actor_id: str | None, field_name: str) -> str:
    if raw_id != "me":
        return raw_id
    if actor_id is None or actor_id.strip() == "":
        raise HTTPException(
            status_code=422,
            detail=f"{field_name}=me requires actor_id to be provided",
        )
    return actor_id.strip()


def ensure_submission_owned(connection, submission_id: str, creator_id: str):
    submission_row = connection.execute(
        "SELECT id, creator_id FROM submissions WHERE id = ?",
        (submission_id,),
    ).fetchone()
    if submission_row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission_row["creator_id"] != creator_id:
        raise HTTPException(status_code=403, detail="Submission belongs to another creator")
    return submission_row


def fetch_submission_metadata_row(connection, submission_id: str):
    return connection.execute(
        """
        SELECT
            submission_id,
            creator_id,
            pack_name,
            label_name,
            release_month,
            notes,
            tags_json,
            airtable_form_completed,
            airtable_payload_checksum,
            created_at,
            updated_at
        FROM submission_metadata
        WHERE submission_id = ?
        """,
        (submission_id,),
    ).fetchone()


def fetch_airtable_link_row(connection, submission_id: str):
    return connection.execute(
        """
        SELECT
            submission_id,
            airtable_base_id,
            airtable_table_name,
            airtable_view_name,
            airtable_record_id,
            airtable_record_url,
            airtable_payload_checksum,
            sync_status,
            last_synced_at,
            last_error_code,
            last_error_detail,
            created_at,
            updated_at
        FROM airtable_submission_links
        WHERE submission_id = ?
        """,
        (submission_id,),
    ).fetchone()


def fetch_latest_upload_session_row(connection, submission_id: str):
    return connection.execute(
        """
        SELECT
            id,
            submission_id,
            status,
            chunk_state_json,
            created_at,
            completed_at,
            locked_at
        FROM upload_sessions
        WHERE submission_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (submission_id,),
    ).fetchone()


def upsert_airtable_link_row(
    connection,
    *,
    submission_id: str,
    airtable_base_id: str,
    airtable_table_name: str,
    airtable_view_name: str,
    airtable_record_id: str | None,
    airtable_record_url: str | None,
    airtable_payload_checksum: str | None,
    sync_status: str,
    last_synced_at: str | None,
    last_error_code: str | None,
    last_error_detail: str | None,
) -> None:
    now = now_iso()
    connection.execute(
        """
        INSERT INTO airtable_submission_links (
            submission_id,
            airtable_base_id,
            airtable_table_name,
            airtable_view_name,
            airtable_record_id,
            airtable_record_url,
            airtable_payload_checksum,
            sync_status,
            last_synced_at,
            last_error_code,
            last_error_detail,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          airtable_base_id = excluded.airtable_base_id,
          airtable_table_name = excluded.airtable_table_name,
          airtable_view_name = excluded.airtable_view_name,
          airtable_record_id = excluded.airtable_record_id,
          airtable_record_url = excluded.airtable_record_url,
          airtable_payload_checksum = excluded.airtable_payload_checksum,
          sync_status = excluded.sync_status,
          last_synced_at = excluded.last_synced_at,
          last_error_code = excluded.last_error_code,
          last_error_detail = excluded.last_error_detail,
          updated_at = excluded.updated_at
        """,
        (
            submission_id,
            airtable_base_id,
            airtable_table_name,
            airtable_view_name,
            airtable_record_id,
            airtable_record_url,
            airtable_payload_checksum,
            sync_status,
            last_synced_at,
            last_error_code,
            last_error_detail,
            now,
            now,
        ),
    )


def apply_airtable_metadata_update(
    connection,
    *,
    submission_id: str,
    creator_id: str,
    metadata_created_at: str,
    pack_name: str | None,
    label_name: str | None,
    release_month: str | None,
    notes: str | None,
    tags: list[str],
    airtable_form_completed: bool,
    airtable_payload_checksum: str | None,
) -> None:
    now = now_iso()
    connection.execute(
        """
        INSERT INTO submission_metadata (
            submission_id,
            creator_id,
            pack_name,
            label_name,
            release_month,
            notes,
            tags_json,
            airtable_form_completed,
            airtable_payload_checksum,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          creator_id = excluded.creator_id,
          pack_name = excluded.pack_name,
          label_name = excluded.label_name,
          release_month = excluded.release_month,
          notes = excluded.notes,
          tags_json = excluded.tags_json,
          airtable_form_completed = excluded.airtable_form_completed,
          airtable_payload_checksum = excluded.airtable_payload_checksum,
          updated_at = excluded.updated_at
        """,
        (
            submission_id,
            creator_id,
            pack_name,
            label_name,
            release_month,
            notes,
            to_json(tags),
            1 if airtable_form_completed else 0,
            airtable_payload_checksum,
            metadata_created_at,
            now,
        ),
    )
    connection.execute("UPDATE submissions SET updated_at = ? WHERE id = ?", (now, submission_id))


def build_airtable_link_state_response(
    *,
    submission_id: str,
    metadata_row,
    link_row,
    canonical_record_id: str | None = None,
    mapped_record: _MappedAirtableRecord | None = None,
) -> AirtableLinkStateResponse:
    sync_status = normalize_sync_status(link_row["sync_status"] if link_row else None) or "pending"
    form_completed = bool(metadata_row["airtable_form_completed"]) if metadata_row else False
    payload_checksum = metadata_row["airtable_payload_checksum"] if metadata_row else None
    return AirtableLinkStateResponse(
        submission_id=submission_id,
        sync_status=sync_status,
        airtable_form_completed=form_completed,
        airtable_payload_checksum=payload_checksum,
        airtable_record_id=link_row["airtable_record_id"] if link_row else None,
        airtable_record_url=link_row["airtable_record_url"] if link_row else None,
        last_synced_at=link_row["last_synced_at"] if link_row else None,
        last_error_code=link_row["last_error_code"] if link_row else None,
        last_error_detail=link_row["last_error_detail"] if link_row else None,
        canonical_record_id=canonical_record_id,
        mapped_payload=(
            AirtableMappedPayload(
                label_name=mapped_record.label_name,
                pack_name=mapped_record.pack_name,
                release_month=mapped_record.release_month,
                notes=mapped_record.notes,
                tags=list(mapped_record.tags),
            )
            if mapped_record is not None
            else None
        ),
    )


def sort_records_by_created_at(
    records: list[_MappedAirtableRecord],
) -> list[_MappedAirtableRecord]:
    def _sort_key(item: _MappedAirtableRecord) -> tuple[int, str]:
        value = item.created_at or ""
        if not value:
            return (1, item.record_id)
        return (0, value)

    return sorted(records, key=_sort_key)


def query_submission_row(connection, submission_id: str, creator_id: str):
    return connection.execute(
        """
        SELECT
            s.id AS submission_id,
            s.creator_id AS creator_id,
            s.current_state AS current_state,
            s.version AS version,
            s.created_at AS created_at,
            s.updated_at AS updated_at,
            m.pack_name AS pack_name,
            m.label_name AS label_name,
            m.release_month AS release_month,
            m.notes AS notes,
            m.tags_json AS tags_json,
            m.airtable_form_completed AS airtable_form_completed,
            m.airtable_payload_checksum AS airtable_payload_checksum,
            l.sync_status AS airtable_sync_status,
            l.airtable_record_id AS airtable_record_id,
            l.airtable_record_url AS airtable_record_url,
            l.last_synced_at AS airtable_last_synced_at,
            l.last_error_code AS airtable_last_error_code,
            l.last_error_detail AS airtable_last_error_detail,
            d.last_saved_at AS draft_last_saved_at,
            us.id AS upload_intake_session_id,
            us.status AS upload_status,
            us.chunk_state_json AS upload_chunk_state_json,
            us.created_at AS upload_created_at,
            us.completed_at AS upload_completed_at,
            us.locked_at AS upload_locked_at
        FROM submissions s
        LEFT JOIN submission_metadata m ON m.submission_id = s.id
        LEFT JOIN airtable_submission_links l ON l.submission_id = s.id
        LEFT JOIN submission_drafts d ON d.id = s.id
        LEFT JOIN upload_sessions us
          ON us.id = (
            SELECT id
            FROM upload_sessions
            WHERE submission_id = s.id
            ORDER BY created_at DESC
            LIMIT 1
          )
        WHERE s.id = ? AND s.creator_id = ?
        """,
        (submission_id, creator_id),
    ).fetchone()


def _normalize_upload_progress_value(value: Any) -> int | None:
    if value is None:
        return None
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        return None
    if coerced < 0:
        return None
    return coerced


def _coerce_upload_snapshot(row) -> dict[str, Any]:
    chunk_state = parse_json(row["upload_chunk_state_json"], {})
    if not isinstance(chunk_state, dict):
        chunk_state = {}

    upload_status = normalize_upload_status(chunk_state.get("upload_status"))
    if upload_status is None:
        upload_status = normalize_upload_status(row["upload_status"])

    progress_percent = _normalize_upload_progress_value(
        chunk_state.get("upload_progress_percent", chunk_state.get("progress_percent"))
    )
    uploaded_bytes = _normalize_upload_progress_value(
        chunk_state.get("upload_uploaded_bytes", chunk_state.get("uploaded_bytes"))
    )
    total_bytes = _normalize_upload_progress_value(
        chunk_state.get("upload_total_bytes", chunk_state.get("total_bytes"))
    )
    upload_error = chunk_state.get("upload_error") or chunk_state.get("handoff_error")
    if upload_error is not None:
        upload_error = str(upload_error).strip() or None

    upload_updated_at = (
        chunk_state.get("upload_updated_at")
        or chunk_state.get("updated_at")
        or row["upload_completed_at"]
        or row["upload_locked_at"]
        or row["upload_created_at"]
    )
    upload_updated_at = str(upload_updated_at).strip() if upload_updated_at else None

    if progress_percent is None and upload_status == "completed":
        progress_percent = 100
    if uploaded_bytes is None and upload_status == "completed" and total_bytes is not None:
        uploaded_bytes = total_bytes
    upload_manifest_version = _normalize_upload_progress_value(
        chunk_state.get("manifest_version", chunk_state.get("upload_manifest_version"))
    )
    upload_handoff_id = chunk_state.get("handoff_id")
    if upload_handoff_id is not None:
        upload_handoff_id = str(upload_handoff_id).strip() or None
    if (
        not upload_handoff_id
        and row["upload_intake_session_id"]
        and upload_manifest_version is not None
    ):
        upload_handoff_id = f"handoff:{row['upload_intake_session_id']}:{upload_manifest_version}"
    return {
        "upload_handoff_id": upload_handoff_id,
        "upload_status": upload_status,
        "upload_progress_percent": progress_percent,
        "upload_uploaded_bytes": uploaded_bytes,
        "upload_total_bytes": total_bytes,
        "upload_error": upload_error,
        "upload_updated_at": upload_updated_at,
        "upload_manifest_version": upload_manifest_version,
    }


def row_to_submission(row) -> SubmissionListItem:
    upload_snapshot = _coerce_upload_snapshot(row)
    return SubmissionListItem(
        submission_id=row["submission_id"],
        creator_id=row["creator_id"],
        current_state=row["current_state"],
        version=row["version"],
        pack_name=row["pack_name"],
        label_name=row["label_name"],
        release_month=row["release_month"],
        notes=row["notes"],
        tags=parse_json(row["tags_json"], []),
        airtable_form_completed=bool(row["airtable_form_completed"]),
        airtable_payload_checksum=row["airtable_payload_checksum"],
        airtable_sync_status=normalize_sync_status(row["airtable_sync_status"]),
        airtable_record_id=row["airtable_record_id"],
        airtable_record_url=row["airtable_record_url"],
        airtable_last_synced_at=row["airtable_last_synced_at"],
        airtable_last_error_code=row["airtable_last_error_code"],
        airtable_last_error_detail=row["airtable_last_error_detail"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        draft_last_saved_at=row["draft_last_saved_at"],
        upload_handoff_id=upload_snapshot["upload_handoff_id"],
        upload_status=upload_snapshot["upload_status"],
        upload_progress_percent=upload_snapshot["upload_progress_percent"],
        upload_uploaded_bytes=upload_snapshot["upload_uploaded_bytes"],
        upload_total_bytes=upload_snapshot["upload_total_bytes"],
        upload_error=upload_snapshot["upload_error"],
        upload_updated_at=upload_snapshot["upload_updated_at"],
        upload_manifest_version=upload_snapshot["upload_manifest_version"],
    )
