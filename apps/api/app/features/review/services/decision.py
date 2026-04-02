from __future__ import annotations

from uuid import uuid4

from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType
from app.features.creator import service as creator_service
from app.features.creator.airtable_sync import (
    AIRTABLE_FIELD_NOTIFICATION_DELIVERY_STATUS,
    AIRTABLE_FIELD_WORKFLOW_STATUS,
    AIRTABLE_NOTIFICATION_STATUS_DISABLED,
    AIRTABLE_NOTIFICATION_STATUS_FAILED,
    AIRTABLE_NOTIFICATION_STATUS_PENDING,
    AIRTABLE_NOTIFICATION_STATUS_SENT,
    update_airtable_record_fields,
)
from app.features.notifications.contracts import EmitNotificationRequest, NotificationStatus
from app.features.review.contracts import (
    AddReviewFlagRequest,
    AddReviewFlagResponse,
    AddReviewTagRequest,
    AddReviewTagResponse,
    ApproveSubmissionRequest,
    RejectReasonCode,
    RejectSubmissionRequest,
    ReopenSubmissionRequest,
    ReviewDecisionItem,
    ReviewDecisionResponse,
    ReviewDecisionType,
    ReviewErrorCode,
    ReviewFlagItem,
    ReviewTagItem,
)
from app.features.submissions.contracts import (
    ActorRole,
    SubmissionState,
    TransitionRequest,
)

from .base import ReviewBaseMixin

logger = get_logger(__name__)


class ReviewDecisionMixin(ReviewBaseMixin):
    """Approve/Reject/Reopen and Tagging/Flagging logic for ReviewConsoleService."""

    def approve_submission(self, submission_id: str, payload: ApproveSubmissionRequest) -> ReviewDecisionResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        row = self._submission_row(submission_id)
        if row is None:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        self._assert_submission_scope(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=payload.actor_role,
            creator_id=row["creator_id"],
        )
        self._assert_state(submission_id, {SubmissionState.UNDER_REVIEW}, "under_review")
        self.ensure_submission_transition_metadata(submission_id)

        transition = self._run_transition(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=ActorRole.REVIEWER,
            target_state=SubmissionState.APPROVED,
        )
        decision_id = self._insert_decision(
            submission_id=submission_id,
            reviewer_id=payload.actor_id,
            decision=ReviewDecisionType.APPROVED,
            notes=payload.notes,
        )

        decision_item = ReviewDecisionItem(
            id=decision_id,
            submission_id=submission_id,
            reviewer_id=payload.actor_id,
            decision=ReviewDecisionType.APPROVED,
            notes=payload.notes,
            created_at=self._now(),
        )

        self._append_decision_audit(
            action=AuditAction.submission_approved_scheduling,
            submission_id=submission_id,
            actor_id=payload.actor_id,
            decision_id=decision_id,
            notes=payload.notes,
        )
        email_outcome = AIRTABLE_NOTIFICATION_STATUS_DISABLED
        self._emit_approval_in_app_notification(submission_id=submission_id)
        if self._creator_approval_email_enabled(row["creator_id"]):
            email_response = self._emit_approval_email_notification(submission_id=submission_id)
            email_status = email_response.notification.status if email_response is not None else None
            email_outcome = self._notification_status_to_airtable_delivery_status(email_status)
        self._try_update_airtable_approval_status(
            submission_id=submission_id,
            notification_delivery_status=email_outcome,
        )

        return ReviewDecisionResponse(
            decision=decision_item,
            transition=transition,
        )

    def _emit_approval_in_app_notification(self, *, submission_id: str) -> None:
        if self.notification_service is None:
            return
        self.notification_service.emit_notification(
            EmitNotificationRequest(
                type="approved",
                severity="info",
                channel="in_app",
                title="Submission approved",
                message="Your submission was approved by review.",
                submission_id=submission_id,
            )
        )

    def _emit_approval_email_notification(self, *, submission_id: str):
        if self.notification_service is None:
            return None
        row = self._connection.execute(
            """
            SELECT s.creator_id AS creator_id, u.email AS recipient_email
            FROM submissions s
            LEFT JOIN auth_users u ON u.user_id = s.creator_id
            WHERE s.id = ?
            """,
            (submission_id,),
        ).fetchone()
        recipient_email = row["recipient_email"] if row is not None else None
        return self.notification_service.emit_notification(
            EmitNotificationRequest(
                type="approved",
                severity="info",
                channel="email",
                title="Submission approved",
                message="Your submission was approved by review.",
                submission_id=submission_id,
                recipient_email=recipient_email,
            )
        )

    def _creator_approval_email_enabled(self, creator_id: str) -> bool:
        row = self._connection.execute(
            """
            SELECT defaults_json
            FROM creator_profiles
            WHERE user_id = ?
            """,
            (creator_id,),
        ).fetchone()
        if row is None:
            return False
        defaults = creator_service.parse_json(row["defaults_json"], {})
        return creator_service.creator_approval_email_enabled(defaults)

    def _notification_status_to_airtable_delivery_status(self, status: NotificationStatus | None) -> str:
        if status is None:
            return AIRTABLE_NOTIFICATION_STATUS_FAILED
        if status == NotificationStatus.SENT:
            return AIRTABLE_NOTIFICATION_STATUS_SENT
        if status == NotificationStatus.PENDING:
            return AIRTABLE_NOTIFICATION_STATUS_PENDING
        return AIRTABLE_NOTIFICATION_STATUS_FAILED

    def _try_update_airtable_approval_status(
        self,
        *,
        submission_id: str,
        notification_delivery_status: str,
    ) -> None:
        link_row = self._connection.execute(
            """
            SELECT airtable_base_id, airtable_table_name, airtable_record_id
            FROM airtable_submission_links
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        if link_row is None or not link_row["airtable_record_id"]:
            return
        result = update_airtable_record_fields(
            base_id=str(link_row["airtable_base_id"] or ""),
            table_name=str(link_row["airtable_table_name"] or ""),
            record_id=str(link_row["airtable_record_id"] or ""),
            fields={
                AIRTABLE_FIELD_WORKFLOW_STATUS: "Approved",
                AIRTABLE_FIELD_NOTIFICATION_DELIVERY_STATUS: notification_delivery_status,
            },
        )
        if result.error_code is not None:
            logger.warning(
                "Failed to update Airtable status after approval.",
                extra={
                    "submission_id": submission_id,
                    "error_code": result.error_code,
                    "error_detail": result.error_detail,
                },
            )

    def reject_submission(self, submission_id: str, payload: RejectSubmissionRequest) -> ReviewDecisionResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        row = self._submission_row(submission_id)
        if row is None:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        self._assert_submission_scope(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=payload.actor_role,
            creator_id=row["creator_id"],
        )
        self._assert_state(submission_id, {SubmissionState.UNDER_REVIEW}, "under_review")

        if not payload.reason_code:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_REASON_REQUIRED,
                message="Rejecting a submission requires a reason code.",
                status_code=400,
            )

        transition = self._run_transition(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=ActorRole.REVIEWER,
            target_state=SubmissionState.REJECTED,
            reason=payload.reason_code.value if payload.reason_code else payload.notes,
        )

        decision_id = self._insert_decision(
            submission_id=submission_id,
            reviewer_id=payload.actor_id,
            decision=ReviewDecisionType.REJECTED,
            reason_code=payload.reason_code,
            notes=payload.notes,
        )

        decision_item = ReviewDecisionItem(
            id=decision_id,
            submission_id=submission_id,
            reviewer_id=payload.actor_id,
            decision=ReviewDecisionType.REJECTED,
            reason_code=payload.reason_code,
            notes=payload.notes,
            created_at=self._now(),
        )

        self._append_decision_audit(
            action=AuditAction.submission_transition_changed,
            submission_id=submission_id,
            actor_id=payload.actor_id,
            decision_id=decision_id,
            notes=payload.notes,
        )

        return ReviewDecisionResponse(
            decision=decision_item,
            transition=transition,
        )

    def reopen_submission(self, submission_id: str, payload: ReopenSubmissionRequest) -> ReviewDecisionResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        row = self._submission_row(submission_id)
        if row is None:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        self._assert_submission_scope(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=payload.actor_role,
            creator_id=row["creator_id"],
        )
        self._assert_state(submission_id, {SubmissionState.REJECTED, SubmissionState.QC_FAILED}, "rejected")

        transition = self._run_transition(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=ActorRole.REVIEWER,
            target_state=SubmissionState.DRAFT,
            reason=payload.notes or "Reopened for correction",
        )

        decision_id = self._insert_decision(
            submission_id=submission_id,
            reviewer_id=payload.actor_id,
            decision=ReviewDecisionType.REOPENED,
            notes=payload.notes,
        )

        decision_item = ReviewDecisionItem(
            id=decision_id,
            submission_id=submission_id,
            reviewer_id=payload.actor_id,
            decision=ReviewDecisionType.REOPENED,
            notes=payload.notes,
            created_at=self._now(),
        )

        self._append_decision_audit(
            action=AuditAction.submission_reopen_requested,
            submission_id=submission_id,
            actor_id=payload.actor_id,
            decision_id=decision_id,
            notes=payload.notes,
        )

        return ReviewDecisionResponse(
            decision=decision_item,
            transition=transition,
        )

    def add_tag(self, submission_id: str, payload: AddReviewTagRequest) -> AddReviewTagResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        row = self._submission_row(submission_id)
        if row is None:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        self._assert_submission_scope(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=payload.actor_role,
            creator_id=row["creator_id"],
        )
        now = self._now()
        with self._connection:
            self._connection.execute(
                "INSERT OR IGNORE INTO review_tags (submission_id, tag, added_by, created_at) VALUES (?, ?, ?, ?)",
                (submission_id, payload.tag, payload.actor_id, now.isoformat()),
            )
        return AddReviewTagResponse(
            tag=ReviewTagItem(
                id=f"tag:{submission_id}:{payload.tag}",
                submission_id=submission_id,
                tag=payload.tag,
                added_by=payload.actor_id,
                created_at=now,
            )
        )

    def add_flag(self, submission_id: str, payload: AddReviewFlagRequest) -> AddReviewFlagResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        row = self._submission_row(submission_id)
        if row is None:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        self._assert_submission_scope(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=payload.actor_role,
            creator_id=row["creator_id"],
        )
        now = self._now()
        with self._connection:
            self._connection.execute(
                "INSERT OR IGNORE INTO review_flags (submission_id, flag_type, severity, added_by, created_at) VALUES (?, ?, ?, ?, ?)",
                (submission_id, payload.flag_type, payload.severity, payload.actor_id, now.isoformat()),
            )
        return AddReviewFlagResponse(
            flag=ReviewFlagItem(
                id=f"flag:{submission_id}:{payload.flag_type}",
                submission_id=submission_id,
                flag_type=payload.flag_type,
                severity=payload.severity,
                added_by=payload.actor_id,
                created_at=now,
            )
        )

    def _run_transition(self, *, submission_id: str, actor_id: str, actor_role: ActorRole, target_state: SubmissionState, reason: str | None = None):
        return self.workflow.transition_submission(
            submission_id=submission_id,
            request=TransitionRequest(
                request_id=f"rev-{str(uuid4().hex)[:8]}",
                to_state=target_state,
                actor_id=actor_id,
                actor_role=actor_role,
                reason=reason,
            ),

        )


    def _assert_state(self, submission_id: str, allowed: set[SubmissionState], expected_label: str) -> None:
        row = self._submission_row(submission_id)
        if not row:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
            )
        current = SubmissionState(row["current_state"])
        if current not in allowed:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission is in {current.value}, expected {expected_label}",
                status_code=409,
                details={"current_state": current.value, "expected_state": expected_label},
            )

    def _insert_decision(self, *, submission_id: str, reviewer_id: str, decision: ReviewDecisionType, reason_code: RejectReasonCode | None = None, notes: str | None = None) -> str:
        decision_id = f"dec:{uuid4().hex}"
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO review_decisions (id, submission_id, reviewer_id, decision, reason_code, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    decision_id,
                    submission_id,
                    reviewer_id,
                    decision.value,
                    reason_code.value if reason_code else None,
                    notes,
                    self._now().isoformat(),
                ),
            )
        return decision_id


    def _append_decision_audit(self, *, action: AuditAction, submission_id: str, actor_id: str, decision_id: str, notes: str | None) -> None:
        self.audit.append_event(
            AuditAppendRequest(
                request_id=f"audit-{str(uuid4().hex)[:8]}",
                action=action,
                entity_type=AuditEntityType.submission,
                entity_id=submission_id,
                actor_id=actor_id,
                metadata={"decision_id": decision_id, "notes": notes},
            )
        )
