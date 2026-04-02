"""PRD-07 transition rules and allowed roles."""

from __future__ import annotations

from dataclasses import dataclass

from app.features.submissions.contracts import ActorRole, SubmissionState


@dataclass(frozen=True, slots=True)
class TransitionRule:
    allowed_roles: tuple[ActorRole, ...]
    reason_required: bool = False


TRANSITION_RULES: dict[SubmissionState, dict[SubmissionState, TransitionRule]] = {
    SubmissionState.DRAFT: {
        SubmissionState.QC_FAILED: TransitionRule(
            allowed_roles=(ActorRole.CREATOR, ActorRole.ADMIN, ActorRole.SYSTEM)
        ),
        SubmissionState.UPLOADING: TransitionRule(
            allowed_roles=(ActorRole.CREATOR, ActorRole.ADMIN, ActorRole.SYSTEM)
        ),
        SubmissionState.UNDER_REVIEW: TransitionRule(
            allowed_roles=(ActorRole.CREATOR, ActorRole.ADMIN, ActorRole.SYSTEM)
        ),
    },
    SubmissionState.QC_FAILED: {
        SubmissionState.DRAFT: TransitionRule(
            allowed_roles=(ActorRole.CREATOR, ActorRole.ADMIN, ActorRole.SYSTEM)
        ),
    },
    SubmissionState.UNDER_REVIEW: {
        SubmissionState.APPROVED: TransitionRule(
            allowed_roles=(ActorRole.REVIEWER, ActorRole.ADMIN)
        ),
        SubmissionState.REJECTED: TransitionRule(
            allowed_roles=(ActorRole.REVIEWER, ActorRole.ADMIN),
            reason_required=True,
        ),
    },
    SubmissionState.REJECTED: {
        SubmissionState.DRAFT: TransitionRule(
            allowed_roles=(ActorRole.REVIEWER, ActorRole.ADMIN),
            reason_required=True,
        ),
    },
    SubmissionState.UPLOADING: {
        SubmissionState.UNDER_REVIEW: TransitionRule(
            allowed_roles=(ActorRole.SYSTEM, ActorRole.ADMIN)
        ),
        SubmissionState.DRAFT: TransitionRule(
            allowed_roles=(ActorRole.SYSTEM, ActorRole.ADMIN),
            reason_required=True,
        ),
    },
    SubmissionState.APPROVED: {
        SubmissionState.SCHEDULED: TransitionRule(
            allowed_roles=(ActorRole.SYSTEM, ActorRole.ADMIN)
        ),
    },
    SubmissionState.SCHEDULED: {
        SubmissionState.RELEASED: TransitionRule(
            allowed_roles=(ActorRole.SYSTEM, ActorRole.ADMIN)
        ),
    },
}
