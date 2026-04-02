"""FastAPI router for creator submission and Airtable endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.db import session as db_module
from app.core.logging import get_logger
from app.features.creator import service
from app.features.creator.contracts import (
    AirtableLinkStateResponse,
    AirtableResetPayload,
    AirtableSyncPayload,
    DraftCreatePayload,
    MetadataUpdatePayload,
    SubmissionDetailResponse,
    SubmissionListItem,
    TimelineItem,
)

router = APIRouter(tags=["creator-workspace"])
logger = get_logger(__name__)


@router.post("/submissions/draft", response_model=SubmissionDetailResponse)
def create_submission_draft(payload: DraftCreatePayload) -> SubmissionDetailResponse:
    logger.info(
        "Creating creator submission draft.",
        extra={"submission_id": payload.submission_id, "creator_id": payload.creator_id},
    )
    now = service.now_iso()

    with db_module.get_connection() as connection:
        existing_submission = connection.execute(
            "SELECT id, creator_id FROM submissions WHERE id = ?",
            (payload.submission_id,),
        ).fetchone()

        if (
            existing_submission is not None
            and existing_submission["creator_id"] != payload.creator_id
        ):
            raise HTTPException(
                status_code=403,
                detail="Submission belongs to another creator",
            )

        if existing_submission is None:
            connection.execute(
                """
                INSERT INTO submissions (
                    id,
                    creator_id,
                    current_state,
                    version,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.submission_id,
                    payload.creator_id,
                    "draft",
                    0,
                    now,
                    now,
                ),
            )

        connection.execute(
            """
            INSERT INTO submission_metadata (
                submission_id,
                creator_id,
                pack_name,
                release_month,
                notes,
                tags_json,
                airtable_form_completed,
                airtable_payload_checksum,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
              creator_id = excluded.creator_id,
              pack_name = excluded.pack_name,
              release_month = excluded.release_month,
              notes = excluded.notes,
              tags_json = excluded.tags_json,
              airtable_form_completed = excluded.airtable_form_completed,
              airtable_payload_checksum = excluded.airtable_payload_checksum,
              updated_at = excluded.updated_at
            """,
            (
                payload.submission_id,
                payload.creator_id,
                payload.pack_name,
                payload.release_month,
                payload.notes,
                service.to_json(payload.tags),
                1 if payload.airtable_form_completed else 0,
                payload.airtable_payload_checksum,
                now,
                now,
            ),
        )

        if payload.autosave_json is not None:
            connection.execute(
                """
                INSERT INTO submission_drafts (id, creator_id, autosave_json, last_saved_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  creator_id = excluded.creator_id,
                  autosave_json = excluded.autosave_json,
                  last_saved_at = excluded.last_saved_at
                """,
                (
                    payload.submission_id,
                    payload.creator_id,
                    service.to_json(payload.autosave_json),
                    now,
                ),
            )

        row = service.query_submission_row(connection, payload.submission_id, payload.creator_id)

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create submission draft")

    return SubmissionDetailResponse(submission=service.row_to_submission(row))


@router.put("/submissions/{submission_id}/metadata", response_model=SubmissionDetailResponse)
def update_submission_metadata(
    submission_id: str,
    payload: MetadataUpdatePayload,
) -> SubmissionDetailResponse:
    logger.info(
        "Updating submission metadata.",
        extra={"submission_id": submission_id, "creator_id": payload.creator_id},
    )
    now = service.now_iso()

    with db_module.get_connection() as connection:
        submission_row = connection.execute(
            "SELECT id, creator_id FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()

        if submission_row is None:
            raise HTTPException(status_code=404, detail="Submission not found")

        if submission_row["creator_id"] != payload.creator_id:
            raise HTTPException(status_code=403, detail="Submission belongs to another creator")

        metadata_row = connection.execute(
            """
            SELECT pack_name, label_name, release_month, notes, tags_json,
                   airtable_form_completed, airtable_payload_checksum, created_at
            FROM submission_metadata
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()

        updates = payload.model_dump(exclude_unset=True)

        current_pack_name = metadata_row["pack_name"] if metadata_row else None
        current_label_name = metadata_row["label_name"] if metadata_row else None
        current_release_month = metadata_row["release_month"] if metadata_row else None
        current_notes = metadata_row["notes"] if metadata_row else None
        current_tags = service.parse_json(metadata_row["tags_json"], []) if metadata_row else []
        current_airtable_complete = (
            bool(metadata_row["airtable_form_completed"]) if metadata_row else False
        )
        current_airtable_checksum = (
            metadata_row["airtable_payload_checksum"] if metadata_row else None
        )
        created_at = metadata_row["created_at"] if metadata_row else now

        next_pack_name = updates.get("pack_name", current_pack_name)
        next_label_name = updates.get("label_name", current_label_name)
        next_release_month = updates.get("release_month", current_release_month)
        next_notes = updates.get("notes", current_notes)
        next_tags = updates.get("tags", current_tags)
        next_airtable_complete = updates.get("airtable_form_completed", current_airtable_complete)
        next_airtable_checksum = updates.get(
            "airtable_payload_checksum", current_airtable_checksum
        )

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
                payload.creator_id,
                next_pack_name,
                next_label_name,
                next_release_month,
                next_notes,
                service.to_json(next_tags),
                1 if next_airtable_complete else 0,
                next_airtable_checksum,
                created_at,
                now,
            ),
        )

        if "autosave_json" in updates and payload.autosave_json is not None:
            connection.execute(
                """
                INSERT INTO submission_drafts (id, creator_id, autosave_json, last_saved_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  creator_id = excluded.creator_id,
                  autosave_json = excluded.autosave_json,
                  last_saved_at = excluded.last_saved_at
                """,
                (
                    submission_id,
                    payload.creator_id,
                    service.to_json(payload.autosave_json),
                    now,
                ),
            )

        connection.execute(
            "UPDATE submissions SET updated_at = ? WHERE id = ?",
            (now, submission_id),
        )

        row = service.query_submission_row(connection, submission_id, payload.creator_id)

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to update submission metadata")

    return SubmissionDetailResponse(submission=service.row_to_submission(row))


@router.get("/submissions", response_model=list[SubmissionListItem])
def list_creator_submissions(
    creator_id: str = Query(default="me", min_length=1),
    actor_id: str | None = Query(default=None),
) -> list[SubmissionListItem]:
    logger.info(
        "Listing creator submissions.",
        extra={"creator_id": creator_id, "actor_id": actor_id},
    )
    resolved_creator_id = service.resolve_actor_scoped_id(creator_id, actor_id, "creator_id")

    with db_module.get_connection() as connection:
        rows = connection.execute(
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
            WHERE s.creator_id = ?
            ORDER BY COALESCE(m.updated_at, s.updated_at) DESC
            """,
            (resolved_creator_id,),
        ).fetchall()

    return [service.row_to_submission(row) for row in rows]


@router.post(
    "/submissions/{submission_id}/airtable/sync",
    response_model=AirtableLinkStateResponse,
)
def sync_submission_airtable(
    submission_id: str,
    payload: AirtableSyncPayload,
) -> AirtableLinkStateResponse:
    logger.info(
        "Syncing submission Airtable state.",
        extra={"submission_id": submission_id, "creator_id": payload.creator_id},
    )
    with db_module.get_connection() as connection:
        service.ensure_submission_owned(connection, submission_id, payload.creator_id)
        return service.sync_airtable_link_state(
            connection,
            submission_id=submission_id,
            creator_id=payload.creator_id,
            force_relink=payload.force_relink,
        )


@router.post(
    "/submissions/{submission_id}/airtable/reset",
    response_model=AirtableLinkStateResponse,
)
def reset_submission_airtable(
    submission_id: str,
    payload: AirtableResetPayload,
) -> AirtableLinkStateResponse:
    logger.info(
        "Resetting submission Airtable state.",
        extra={"submission_id": submission_id, "creator_id": payload.creator_id},
    )
    now = service.now_iso()
    with db_module.get_connection() as connection:
        service.ensure_submission_owned(connection, submission_id, payload.creator_id)
        metadata_row = service.fetch_submission_metadata_row(connection, submission_id)
        if metadata_row is None:
            raise HTTPException(status_code=409, detail="LOCAL_SUBMISSION_METADATA_MISSING")
        service.apply_airtable_metadata_update(
            connection,
            submission_id=submission_id,
            creator_id=payload.creator_id,
            metadata_created_at=metadata_row["created_at"] or now,
            pack_name=metadata_row["pack_name"],
            label_name=metadata_row["label_name"],
            release_month=metadata_row["release_month"],
            notes=metadata_row["notes"],
            tags=service.parse_json(metadata_row["tags_json"], []),
            airtable_form_completed=False,
            airtable_payload_checksum=None,
        )
        service.upsert_airtable_link_row(
            connection,
            submission_id=submission_id,
            airtable_base_id="",
            airtable_table_name=service.AIRTABLE_TABLE_DEFAULT,
            airtable_view_name=service.AIRTABLE_VIEW_DEFAULT,
            airtable_record_id=None,
            airtable_record_url=None,
            airtable_payload_checksum=None,
            sync_status="missing_remote",
            last_synced_at=now,
            last_error_code="AIRTABLE_RECORD_NOT_FOUND",
            last_error_detail="Airtable step was reset locally.",
        )
        refreshed_metadata = service.fetch_submission_metadata_row(connection, submission_id)
        refreshed_link = service.fetch_airtable_link_row(connection, submission_id)
        return service.build_airtable_link_state_response(
            submission_id=submission_id,
            metadata_row=refreshed_metadata,
            link_row=refreshed_link,
        )


@router.get("/submissions/{submission_id}/timeline", response_model=list[TimelineItem])
def get_submission_timeline(
    submission_id: str,
    creator_id: str = Query(default="me", min_length=1),
    actor_id: str | None = Query(default=None),
) -> list[TimelineItem]:
    logger.info(
        "Fetching creator submission timeline.",
        extra={"submission_id": submission_id, "creator_id": creator_id, "actor_id": actor_id},
    )
    resolved_creator_id = service.resolve_actor_scoped_id(creator_id, actor_id, "creator_id")

    with db_module.get_connection() as connection:
        owned_submission = connection.execute(
            "SELECT id FROM submissions WHERE id = ? AND creator_id = ?",
            (submission_id, resolved_creator_id),
        ).fetchone()

        if owned_submission is None:
            raise HTTPException(status_code=404, detail="Submission not found")

        rows = connection.execute(
            """
            SELECT
                id,
                from_state,
                to_state,
                actor_id,
                actor_role,
                reason,
                request_id,
                created_at
            FROM submission_transitions
            WHERE submission_id = ?
            ORDER BY created_at DESC
            """,
            (submission_id,),
        ).fetchall()
        decision_rows = connection.execute(
            """
            SELECT decision, reason_code, notes
            FROM review_decisions
            WHERE submission_id = ?
            ORDER BY created_at DESC
            """,
            (submission_id,),
        ).fetchall()

    decision_buckets: dict[str, list] = {
        "REJECTED": [],
        "APPROVED": [],
        "REOPENED": [],
    }
    for decision_row in decision_rows:
        decision_name = str(decision_row["decision"] or "").upper()
        if decision_name in decision_buckets:
            decision_buckets[decision_name].append(decision_row)

    decision_indexes = {key: 0 for key in decision_buckets}

    timeline_items: list[TimelineItem] = []
    for row in rows:
        to_state = str(row["to_state"] or "").lower()
        from_state = str(row["from_state"] or "").lower()
        decision_key = None
        if to_state == "rejected":
            decision_key = "REJECTED"
        elif to_state == "approved":
            decision_key = "APPROVED"
        elif to_state == "draft" and from_state == "rejected":
            decision_key = "REOPENED"

        matched_decision = None
        if decision_key is not None:
            decision_list = decision_buckets[decision_key]
            decision_index = decision_indexes[decision_key]
            if decision_index < len(decision_list):
                matched_decision = decision_list[decision_index]
                decision_indexes[decision_key] = decision_index + 1

        timeline_items.append(
            TimelineItem(
                transition_id=row["id"],
                from_state=row["from_state"],
                to_state=row["to_state"],
                actor_id=row["actor_id"],
                actor_role=row["actor_role"],
                reason=row["reason"],
                review_decision=(
                    str(matched_decision["decision"]).upper()
                    if matched_decision is not None and matched_decision["decision"] is not None
                    else None
                ),
                review_reason_code=(
                    str(matched_decision["reason_code"]).upper()
                    if matched_decision is not None and matched_decision["reason_code"] is not None
                    else None
                ),
                review_notes=(
                    str(matched_decision["notes"])
                    if matched_decision is not None and matched_decision["notes"] is not None
                    else None
                ),
                request_id=row["request_id"],
                created_at=row["created_at"],
            )
        )

    return timeline_items
