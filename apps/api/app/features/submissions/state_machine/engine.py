"""Core logic for the submission state machine engine."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from app.core.db.session import get_connection, init_db
from app.core.errors import DomainError
from app.features.submissions.contracts import (
    SUBMISSION_STATE_TRANSITIONED_EVENT,
    ActorRole,
    CreateDraftRequest,
    CreateDraftResult,
    SubmissionSnapshot,
    SubmissionState,
    TransitionDomainEvent,
    TransitionErrorCode,
    TransitionRecord,
    TransitionRequest,
    TransitionResult,
)

from .persistence import StateMachinePersistenceMixIn
from .rules import TRANSITION_RULES


class SubmissionStateMachineService(StateMachinePersistenceMixIn):
    """PRD-07 transition engine with deterministic guards and idempotency."""

    def __init__(self, connection: sqlite3.Connection | None = None) -> None:
        if connection is None:
            init_db()
            connection = get_connection()
        self._connection = connection

    def reset(self) -> None:
        self._connection.execute("DELETE FROM submission_transitions")
        self._connection.execute("DELETE FROM submission_state_metadata")
        self._connection.execute("DELETE FROM submissions")
        self._connection.commit()

    def create_draft(self, request: CreateDraftRequest) -> CreateDraftResult:
        existing_row = self._connection.execute(
            """
            SELECT id, creator_id, current_state, version, created_at, updated_at
            FROM submissions
            WHERE id = ?
            """,
            (request.submission_id,),
        ).fetchone()

        if existing_row is not None:
            existing = self._submission_from_row(existing_row)
            return CreateDraftResult(created=False, idempotent=True, submission=existing)

        now = datetime.now(tz=UTC)
        metadata = {
            **request.metadata,
            "preferred_release_month": request.preferred_release_month,
        }
        with self._connection:
            self._connection.execute(
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
                    request.submission_id,
                    request.creator_id,
                    SubmissionState.DRAFT.value,
                    0,
                    now.isoformat(),
                    now.isoformat(),
                ),
            )
            self._upsert_submission_metadata(request.submission_id, metadata, now)

        submission = SubmissionSnapshot(
            submission_id=request.submission_id,
            creator_id=request.creator_id,
            current_state=SubmissionState.DRAFT,
            version=0,
            metadata=metadata,
            created_at=now,
            updated_at=now,
        )
        return CreateDraftResult(created=True, idempotent=False, submission=submission)

    def transition(self, submission_id: str, request: TransitionRequest) -> TransitionResult:
        request_key = f"{submission_id}:{request.request_id}"
        existing_transition_row = self._connection.execute(
            """
            SELECT
                id,
                submission_id,
                from_state,
                to_state,
                actor_id,
                actor_role,
                reason,
                request_id,
                created_at
            FROM submission_transitions
            WHERE idempotency_key = ?
            """,
            (request_key,),
        ).fetchone()
        if existing_transition_row is not None:
            existing_transition = self._transition_from_row(existing_transition_row)
            mismatch_fields: dict[str, dict[str, str | None]] = {}
            if existing_transition.to_state != request.to_state:
                mismatch_fields["to_state"] = {
                    "existing": existing_transition.to_state.value,
                    "requested": request.to_state.value,
                }
            if existing_transition.actor_id != request.actor_id:
                mismatch_fields["actor_id"] = {
                    "existing": existing_transition.actor_id,
                    "requested": request.actor_id,
                }
            if existing_transition.actor_role != request.actor_role:
                mismatch_fields["actor_role"] = {
                    "existing": existing_transition.actor_role.value,
                    "requested": request.actor_role.value,
                }
            if existing_transition.reason != request.reason:
                mismatch_fields["reason"] = {
                    "existing": existing_transition.reason,
                    "requested": request.reason,
                }
            if mismatch_fields:
                raise DomainError(
                    code=TransitionErrorCode.VERSION_CONFLICT,
                    message=(
                        "Request replay payload does not match the original transition "
                        "for this request_id."
                    ),
                    status_code=409,
                    details={
                        "submission_id": submission_id,
                        "request_id": request.request_id,
                        "mismatches": mismatch_fields,
                    },
                )
            return self._idempotent_result_from_row(submission_id, existing_transition_row)

        submission_row = self._connection.execute(
            """
            SELECT id, creator_id, current_state, version, created_at, updated_at
            FROM submissions
            WHERE id = ?
            """,
            (submission_id,),
        ).fetchone()
        if submission_row is None:
            raise DomainError(
                code=TransitionErrorCode.SUBMISSION_NOT_FOUND,
                message=f"Submission {submission_id} was not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )

        submission = self._submission_from_row(submission_row)
        if request.expected_version is not None and request.expected_version != submission.version:
            raise DomainError(
                code=TransitionErrorCode.VERSION_CONFLICT,
                message="Submission version does not match expected_version.",
                status_code=409,
                details={
                    "expected_version": request.expected_version,
                    "actual_version": submission.version,
                },
            )

        if request.to_state == submission.current_state:
            raise DomainError(
                code=TransitionErrorCode.TRANSITION_NOT_ALLOWED,
                message=(
                    f"Transition {submission.current_state.value} -> {request.to_state.value} "
                    "is not allowed."
                ),
                status_code=409,
                details={
                    "from_state": submission.current_state.value,
                    "to_state": request.to_state.value,
                    "reason": "self_transition_not_allowed",
                },
            )

        if (
            request.actor_role == ActorRole.CREATOR
            and request.actor_id != submission.creator_id
        ):
            raise DomainError(
                code=TransitionErrorCode.TRANSITION_FORBIDDEN,
                message=(
                    "Creator transitions are only allowed for the submission owner."
                ),
                status_code=403,
                details={
                    "actor_id": request.actor_id,
                    "creator_id": submission.creator_id,
                    "from_state": submission.current_state.value,
                    "to_state": request.to_state.value,
                },
            )

        rule = TRANSITION_RULES.get(submission.current_state, {}).get(request.to_state)
        if rule is None:
            raise DomainError(
                code=TransitionErrorCode.TRANSITION_NOT_ALLOWED,
                message=(
                    f"Transition {submission.current_state.value} -> {request.to_state.value} "
                    "is not allowed."
                ),
                status_code=409,
                details={
                    "from_state": submission.current_state.value,
                    "to_state": request.to_state.value,
                },
            )

        if request.actor_role not in rule.allowed_roles:
            raise DomainError(
                code=TransitionErrorCode.TRANSITION_FORBIDDEN,
                message=(
                    f"Role {request.actor_role.value} cannot execute "
                    f"{submission.current_state.value} -> {request.to_state.value}."
                ),
                status_code=403,
                details={
                    "actor_role": request.actor_role.value,
                    "from_state": submission.current_state.value,
                    "to_state": request.to_state.value,
                },
            )

        if rule.reason_required and request.reason is None:
            raise DomainError(
                code=TransitionErrorCode.MISSING_REQUIRED_REASON,
                message="A non-empty reason is required for this transition.",
                status_code=422,
                details={
                    "from_state": submission.current_state.value,
                    "to_state": request.to_state.value,
                },
            )

        now = datetime.now(tz=UTC)
        previous_state = submission.current_state
        next_version = submission.version + 1
        metadata = {
            **submission.metadata,
            **request.metadata,
        }
        updated_submission = submission.model_copy(
            update={
                "current_state": request.to_state,
                "version": next_version,
                "metadata": metadata,
                "updated_at": now,
            }
        )

        transition = TransitionRecord(
            transition_id=f"{submission_id}:{next_version}",
            request_id=request.request_id,
            submission_id=submission_id,
            from_state=previous_state,
            to_state=request.to_state,
            actor_id=request.actor_id,
            actor_role=request.actor_role,
            reason=request.reason,
            occurred_at=now,
            transition_version=next_version,
        )
        domain_event = TransitionDomainEvent(
            event_name=SUBMISSION_STATE_TRANSITIONED_EVENT,
            event_id=f"evt:{transition.transition_id}",
            submission_id=submission_id,
            from_state=previous_state,
            to_state=request.to_state,
            actor_id=request.actor_id,
            actor_role=request.actor_role,
            transition_version=next_version,
            occurred_at=now,
            idempotency_key=(
                "submission.transition:" f"{submission_id}:{next_version}:{request.to_state.value}"
            ),
            reason=request.reason,
            preferred_release_month=metadata.get("preferred_release_month"),
        )

        with self._connection:
            insert_result = self._connection.execute(
                """
                INSERT OR IGNORE INTO submission_transitions (
                    id, submission_id, from_state, to_state, actor_id, actor_role,
                    reason, request_id, idempotency_key, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    transition.transition_id,
                    submission_id,
                    previous_state.value,
                    request.to_state.value,
                    request.actor_id,
                    request.actor_role.value,
                    request.reason,
                    request.request_id,
                    request_key,
                    now.isoformat(),
                ),
            )
            if insert_result.rowcount == 0:
                existing_row = self._connection.execute(
                    """
                    SELECT id, submission_id, from_state, to_state, actor_id, actor_role, reason,
                           request_id, created_at
                    FROM submission_transitions
                    WHERE idempotency_key = ?
                    """,
                    (request_key,),
                ).fetchone()
                if existing_row is None:
                    raise DomainError(
                        code=TransitionErrorCode.VERSION_CONFLICT,
                        message="Transition request replay failed due to race condition.",
                        status_code=409,
                        details={"submission_id": submission_id},
                    )
                return self._idempotent_result_from_row(submission_id, existing_row)

            updated_rows = self._connection.execute(
                """
                UPDATE submissions
                SET current_state = ?, version = ?, updated_at = ?
                WHERE id = ? AND version = ?
                """,
                (
                    request.to_state.value,
                    next_version,
                    now.isoformat(),
                    submission_id,
                    submission.version,
                ),
            ).rowcount
            if updated_rows != 1:
                raise DomainError(
                    code=TransitionErrorCode.VERSION_CONFLICT,
                    message="Submission version does not match expected_version.",
                    status_code=409,
                    details={
                        "expected_version": request.expected_version,
                        "actual_version": submission.version,
                    },
                )
            self._upsert_submission_metadata(submission_id, metadata, now)

        return TransitionResult(
            submission=updated_submission,
            transition=transition,
            domain_event=domain_event,
            idempotent=False,
        )

    def list_transitions(self, submission_id: str) -> list[TransitionRecord]:
        exists = self._connection.execute(
            "SELECT 1 FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
        if exists is None:
            raise DomainError(
                code=TransitionErrorCode.SUBMISSION_NOT_FOUND,
                message=f"Submission {submission_id} was not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )

        rows = self._connection.execute(
            """
            SELECT
                id,
                submission_id,
                from_state,
                to_state,
                actor_id,
                actor_role,
                reason,
                request_id,
                created_at
            FROM submission_transitions
            WHERE submission_id = ?
            ORDER BY created_at ASC
            """,
            (submission_id,),
        ).fetchall()
        return [self._transition_from_row(row) for row in rows]

    def _idempotent_result_from_row(
        self,
        submission_id: str,
        transition_row: sqlite3.Row,
    ) -> TransitionResult:
        submission_row = self._connection.execute(
            """
            SELECT id, creator_id, current_state, version, created_at, updated_at
            FROM submissions
            WHERE id = ?
            """,
            (submission_id,),
        ).fetchone()
        if submission_row is None:
            raise DomainError(
                code=TransitionErrorCode.SUBMISSION_NOT_FOUND,
                message=f"Submission {submission_id} was not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )

        transition = self._transition_from_row(transition_row)
        metadata = self._read_submission_metadata(submission_id)
        submission = SubmissionSnapshot(
            submission_id=submission_id,
            creator_id=submission_row["creator_id"],
            current_state=transition.to_state,
            version=transition.transition_version,
            metadata=metadata,
            created_at=datetime.fromisoformat(submission_row["created_at"]),
            updated_at=transition.occurred_at,
        )
        domain_event = TransitionDomainEvent(
            event_name=SUBMISSION_STATE_TRANSITIONED_EVENT,
            event_id=f"evt:{transition.transition_id}",
            submission_id=submission_id,
            from_state=transition.from_state,
            to_state=transition.to_state,
            actor_id=transition.actor_id,
            actor_role=transition.actor_role,
            transition_version=transition.transition_version,
            occurred_at=transition.occurred_at,
            idempotency_key=(
                "submission.transition:"
                f"{submission_id}:{transition.transition_version}:{transition.to_state.value}"
            ),
            reason=transition.reason,
            preferred_release_month=metadata.get("preferred_release_month"),
        )
        return TransitionResult(
            submission=submission,
            transition=transition,
            domain_event=domain_event,
            idempotent=True,
        )
