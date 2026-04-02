"""FastAPI router for creator profile endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.db import session as db_module
from app.core.logging import get_logger
from app.features.creator import service
from app.features.creator.contracts import (
    CreatorProfilePayload,
    CreatorProfileResponse,
)

router = APIRouter(tags=["creator-workspace"])
logger = get_logger(__name__)


@router.get("/profile", response_model=CreatorProfileResponse)
def get_creator_profile(
    user_id: str = Query(default="me", min_length=1),
    actor_id: str | None = Query(default=None),
) -> CreatorProfileResponse:
    logger.info("Fetching creator profile.", extra={"user_id": user_id, "actor_id": actor_id})
    resolved_user_id = service.resolve_actor_scoped_id(user_id, actor_id, "user_id")

    with db_module.get_connection() as connection:
        row = connection.execute(
            """
            SELECT user_id, display_name, label_name, defaults_json, updated_at
            FROM creator_profiles
            WHERE user_id = ?
            """,
            (resolved_user_id,),
        ).fetchone()

    if row is None:
        return CreatorProfileResponse(
            user_id=resolved_user_id,
            display_name=None,
            label_name=None,
            defaults_json=service.normalize_creator_defaults({}),
            updated_at=None,
        )

    return CreatorProfileResponse(
        user_id=row["user_id"],
        display_name=row["display_name"],
        label_name=row["label_name"],
        defaults_json=service.normalize_creator_defaults(
            service.parse_json(row["defaults_json"], {})
        ),
        updated_at=row["updated_at"],
    )


@router.put("/profile", response_model=CreatorProfileResponse)
def upsert_creator_profile(payload: CreatorProfilePayload) -> CreatorProfileResponse:
    logger.info(
        "Upserting creator profile.",
        extra={"user_id": payload.user_id, "actor_id": payload.actor_id},
    )
    resolved_user_id = service.resolve_actor_scoped_id(payload.user_id, payload.actor_id, "user_id")
    now = service.now_iso()
    normalized_defaults = service.normalize_creator_defaults(payload.defaults_json)

    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO creator_profiles (
                user_id,
                display_name,
                label_name,
                defaults_json,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              display_name = excluded.display_name,
              label_name = excluded.label_name,
              defaults_json = excluded.defaults_json,
              updated_at = excluded.updated_at
            """,
            (
                resolved_user_id,
                payload.display_name,
                payload.label_name,
                service.to_json(normalized_defaults),
                now,
            ),
        )

        row = connection.execute(
            """
            SELECT user_id, display_name, label_name, defaults_json, updated_at
            FROM creator_profiles
            WHERE user_id = ?
            """,
            (resolved_user_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to persist creator profile")

    return CreatorProfileResponse(
        user_id=row["user_id"],
        display_name=row["display_name"],
        label_name=row["label_name"],
        defaults_json=service.normalize_creator_defaults(
            service.parse_json(row["defaults_json"], {})
        ),
        updated_at=row["updated_at"],
    )
