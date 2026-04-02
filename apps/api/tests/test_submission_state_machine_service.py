from __future__ import annotations

import sqlite3

import pytest

from app.core.errors import DomainError
from app.features.submissions.contracts import (
    ActorRole,
    CreateDraftRequest,
    SubmissionState,
    TransitionErrorCode,
    TransitionRequest,
)
from app.features.submissions.state_machine import SubmissionStateMachineService


def create_service(connection: sqlite3.Connection) -> SubmissionStateMachineService:
    return SubmissionStateMachineService(connection=connection)


def create_submission(service: SubmissionStateMachineService, submission_id: str) -> None:
    service.create_draft(
        CreateDraftRequest(
            submission_id=submission_id,
            creator_id="creator-1",
            preferred_release_month="2026-05",
        )
    )


def test_state_machine_allows_draft_to_under_review_to_approved(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-flow-1")

    under_review = service.transition(
        "sub-flow-1",
        TransitionRequest(
            request_id="req-1",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )
    assert under_review.submission.current_state == SubmissionState.UNDER_REVIEW
    assert under_review.submission.version == 1

    approved = service.transition(
        "sub-flow-1",
        TransitionRequest(
            request_id="req-2",
            to_state=SubmissionState.APPROVED,
            actor_id="reviewer-1",
            actor_role=ActorRole.REVIEWER,
            expected_version=1,
        ),
    )
    assert approved.submission.current_state == SubmissionState.APPROVED
    assert approved.domain_event is not None
    assert approved.domain_event.to_state == SubmissionState.APPROVED


def test_state_machine_allows_uploading_lifecycle_transitions(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-upload-flow")

    uploading = service.transition(
        "sub-upload-flow",
        TransitionRequest(
            request_id="req-upload-1",
            to_state=SubmissionState.UPLOADING,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )
    assert uploading.submission.current_state == SubmissionState.UPLOADING
    assert uploading.submission.version == 1

    under_review = service.transition(
        "sub-upload-flow",
        TransitionRequest(
            request_id="req-upload-2",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="system-worker",
            actor_role=ActorRole.SYSTEM,
            expected_version=1,
        ),
    )
    assert under_review.submission.current_state == SubmissionState.UNDER_REVIEW
    assert under_review.submission.version == 2


def test_state_machine_allows_admin_to_start_uploading_from_draft(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-admin-uploading")

    uploading = service.transition(
        "sub-admin-uploading",
        TransitionRequest(
            request_id="req-admin-upload-1",
            to_state=SubmissionState.UPLOADING,
            actor_id="admin-1",
            actor_role=ActorRole.ADMIN,
            expected_version=0,
        ),
    )
    assert uploading.submission.current_state == SubmissionState.UPLOADING
    assert uploading.submission.version == 1


def test_state_machine_requires_reason_for_uploading_to_draft(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-upload-failure")

    service.transition(
        "sub-upload-failure",
        TransitionRequest(
            request_id="req-upload-start",
            to_state=SubmissionState.UPLOADING,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-upload-failure",
            TransitionRequest(
                request_id="req-upload-fail",
                to_state=SubmissionState.DRAFT,
                actor_id="system-worker",
                actor_role=ActorRole.SYSTEM,
                expected_version=1,
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.MISSING_REQUIRED_REASON


def test_state_machine_allows_uploading_to_draft_with_reason(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-upload-recovery")

    service.transition(
        "sub-upload-recovery",
        TransitionRequest(
            request_id="req-upload-start",
            to_state=SubmissionState.UPLOADING,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )

    recovered = service.transition(
        "sub-upload-recovery",
        TransitionRequest(
            request_id="req-upload-recover",
            to_state=SubmissionState.DRAFT,
            actor_id="admin-1",
            actor_role=ActorRole.ADMIN,
            expected_version=1,
            reason="Upload failed and submission was rolled back.",
        ),
    )

    assert recovered.submission.current_state == SubmissionState.DRAFT
    assert recovered.submission.version == 2


def test_state_machine_blocks_disallowed_transitions(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-disallowed")

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-disallowed",
            TransitionRequest(
                request_id="req-1",
                to_state=SubmissionState.RELEASED,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
            ),
        )
    assert exc_info.value.code == TransitionErrorCode.TRANSITION_NOT_ALLOWED


def test_state_machine_requires_reason_for_rejection_and_reopen(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-reject")
    service.transition(
        "sub-reject",
        TransitionRequest(
            request_id="req-under-review",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-reject",
            TransitionRequest(
                request_id="req-reject",
                to_state=SubmissionState.REJECTED,
                actor_id="reviewer-1",
                actor_role=ActorRole.REVIEWER,
                expected_version=1,
            ),
        )
    assert exc_info.value.code == TransitionErrorCode.MISSING_REQUIRED_REASON


def test_state_machine_reopen_is_reviewer_admin_only(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-reopen")
    service.transition(
        "sub-reopen",
        TransitionRequest(
            request_id="req-1",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )
    service.transition(
        "sub-reopen",
        TransitionRequest(
            request_id="req-2",
            to_state=SubmissionState.REJECTED,
            actor_id="reviewer-1",
            actor_role=ActorRole.REVIEWER,
            expected_version=1,
            reason="Needs fix",
        ),
    )

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-reopen",
            TransitionRequest(
                request_id="req-3",
                to_state=SubmissionState.DRAFT,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                expected_version=2,
                reason="Please reopen",
            ),
        )
    assert exc_info.value.code == TransitionErrorCode.TRANSITION_FORBIDDEN


def test_state_machine_rejects_stale_version(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-version")

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-version",
            TransitionRequest(
                request_id="req-1",
                to_state=SubmissionState.UNDER_REVIEW,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                expected_version=99,
            ),
        )
    assert exc_info.value.code == TransitionErrorCode.VERSION_CONFLICT


def test_state_machine_request_id_idempotency(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-idempotent")

    first = service.transition(
        "sub-idempotent",
        TransitionRequest(
            request_id="req-1",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )
    second = service.transition(
        "sub-idempotent",
        TransitionRequest(
            request_id="req-1",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )

    assert first.idempotent is False
    assert second.idempotent is True
    assert second.submission.version == 1
    assert len(service.list_transitions("sub-idempotent")) == 1


def test_state_machine_rejects_request_id_replay_payload_mismatch(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-replay-mismatch")

    service.transition(
        "sub-replay-mismatch",
        TransitionRequest(
            request_id="req-1",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-replay-mismatch",
            TransitionRequest(
                request_id="req-1",
                to_state=SubmissionState.APPROVED,
                actor_id="reviewer-1",
                actor_role=ActorRole.REVIEWER,
                expected_version=1,
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.VERSION_CONFLICT
    assert "mismatches" in exc_info.value.details


def test_state_machine_rejects_same_state_transition_with_new_request(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-self-transition")

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-self-transition",
            TransitionRequest(
                request_id="req-self",
                to_state=SubmissionState.DRAFT,
                actor_id="creator-1",
                actor_role=ActorRole.CREATOR,
                expected_version=0,
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.TRANSITION_NOT_ALLOWED
    assert exc_info.value.details["reason"] == "self_transition_not_allowed"


def test_state_machine_blocks_creator_transition_for_non_owner(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-owner-guard")

    with pytest.raises(DomainError) as exc_info:
        service.transition(
            "sub-owner-guard",
            TransitionRequest(
                request_id="req-owner",
                to_state=SubmissionState.UNDER_REVIEW,
                actor_id="creator-2",
                actor_role=ActorRole.CREATOR,
                expected_version=0,
            ),
        )

    assert exc_info.value.code == TransitionErrorCode.TRANSITION_FORBIDDEN
    assert exc_info.value.details["creator_id"] == "creator-1"


def test_state_machine_invalid_transition_failure_does_not_block_recovery_path(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    create_submission(service, "sub-recovery")
    service.transition(
        "sub-recovery",
        TransitionRequest(
            request_id="req-under-review",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
        ),
    )

    with pytest.raises(DomainError) as invalid_transition:
        service.transition(
            "sub-recovery",
            TransitionRequest(
                request_id="req-invalid-release",
                to_state=SubmissionState.RELEASED,
                actor_id="reviewer-1",
                actor_role=ActorRole.REVIEWER,
                expected_version=1,
            ),
        )
    assert invalid_transition.value.code == TransitionErrorCode.TRANSITION_NOT_ALLOWED

    rejected = service.transition(
        "sub-recovery",
        TransitionRequest(
            request_id="req-reject",
            to_state=SubmissionState.REJECTED,
            actor_id="reviewer-1",
            actor_role=ActorRole.REVIEWER,
            expected_version=1,
            reason="Fix metadata",
        ),
    )
    assert rejected.submission.current_state == SubmissionState.REJECTED
    assert rejected.submission.version == 2

    reopened = service.transition(
        "sub-recovery",
        TransitionRequest(
            request_id="req-reopen",
            to_state=SubmissionState.DRAFT,
            actor_id="admin-1",
            actor_role=ActorRole.ADMIN,
            expected_version=2,
            reason="Reopened for remediation",
        ),
    )
    assert reopened.submission.current_state == SubmissionState.DRAFT
    assert reopened.submission.version == 3


def test_state_machine_metadata_persists_across_service_restart(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    service = create_service(in_memory_db_connection)
    service.create_draft(
        CreateDraftRequest(
            submission_id="sub-metadata",
            creator_id="creator-1",
            preferred_release_month="2026-05",
            metadata={"pack_name": "Restart Pack"},
        )
    )
    service.transition(
        "sub-metadata",
        TransitionRequest(
            request_id="req-meta-1",
            to_state=SubmissionState.UNDER_REVIEW,
            actor_id="creator-1",
            actor_role=ActorRole.CREATOR,
            expected_version=0,
            metadata={"packName": "Restart Pack Updated"},
        ),
    )

    restarted = create_service(in_memory_db_connection)
    transitions = restarted.list_transitions("sub-metadata")

    assert len(transitions) == 1
    metadata = restarted.get_submission_metadata("sub-metadata")
    assert metadata["pack_name"] == "Restart Pack"
    assert metadata["packName"] == "Restart Pack Updated"
