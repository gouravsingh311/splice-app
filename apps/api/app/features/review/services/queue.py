from __future__ import annotations

from app.core.logging import get_logger
from app.features.review.contracts import (
    ReviewQueueItem,
    ReviewQueueRequest,
    ReviewQueueResponse,
)
from app.features.submissions.contracts import SubmissionState

from .base import ReviewBaseMixin

logger = get_logger(__name__)


class ReviewQueueMixin(ReviewBaseMixin):
    """Queue listing and ranking logic for ReviewConsoleService."""

    def list_queue(self, payload: ReviewQueueRequest) -> ReviewQueueResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        cursor = self._connection.execute(
            """
            SELECT * FROM submissions 
            WHERE current_state NOT IN (?, ?, ?)
            ORDER BY created_at ASC
            """,
            (
                SubmissionState.DRAFT.value,
                SubmissionState.UPLOADING.value,
                SubmissionState.RELEASED.value,
            ),
        )
        rows = cursor.fetchall()
        items = []
        for row in rows:
            submission_id = row["id"]
            creator_id = row["creator_id"]
            if not self._queue_item_in_scope(
                actor_id=payload.actor_id,
                actor_role=payload.actor_role,
                creator_id=creator_id,
            ):
                logger.warning(
                    "Review queue entry excluded by access scope.",
                    extra={
                        "actor_id": payload.actor_id,
                        "actor_role": payload.actor_role.value,
                        "submission_id": submission_id,
                        "creator_id": creator_id,
                    },
                )
                continue
            tags = self._tag_lookup(submission_id)
            flags = self._flag_lookup_objs(submission_id)
            age_days = self._age_days(row["created_at"])
            
            # Filtering
            if payload.state and row["current_state"] != payload.state:
                continue
            if payload.tag and payload.tag not in tags:
                continue
            if payload.flag and payload.flag not in [f.flag_type for f in flags]:
                continue

            items.append(
                ReviewQueueItem(
                    submission_id=submission_id,
                    pack_name=self._pack_name_for_submission(submission_id),
                    creator_id=creator_id,
                    submitted_at=self._from_iso(row["created_at"]),
                    state=SubmissionState(row["current_state"]),
                    age_days=age_days,
                    tags=tags,
                    flags=flags,
                )
            )

        items.sort(key=self._queue_triage_sort_key)
        return ReviewQueueResponse(items=items)

    @staticmethod
    def _queue_triage_sort_key(item: ReviewQueueItem) -> tuple[int, int]:
        state_priority = {
            SubmissionState.UNDER_REVIEW: 0,
            SubmissionState.QC_FAILED: 1,
            SubmissionState.APPROVED: 2,
            SubmissionState.REJECTED: 3,
            SubmissionState.SCHEDULED: 4,
        }
        
        # Calculate risk score
        score = 0
        flag_types = [f.flag_type for f in item.flags]
        if "risk-high" in flag_types:
            score += 100
        if "policy" in flag_types:
            score += 50
        score += item.age_days
        
        return (state_priority.get(item.state, 99), -score)
