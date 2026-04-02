"""PRD-07/09 workflow service binding transition producer and orchestrator consumer."""

from __future__ import annotations

import sqlite3

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.submissions.contracts import (
    ActorRole,
    CreateDraftRequest,
    CreateDraftResult,
    IntegrationDispatchRequest,
    IntegrationEvent,
    OrchestrationResult,
    SubmissionState,
    TransitionErrorCode,
    TransitionExecutionResult,
    TransitionRecord,
    TransitionRequest,
)
from app.features.submissions.orchestrator import IntegrationOrchestratorService
from app.features.submissions.state_machine import SubmissionStateMachineService

logger = get_logger(__name__)


class SubmissionWorkflowService:
    """Coordinates the state machine transition and integration orchestration flow."""

    def __init__(
        self,
        *,
        state_machine: SubmissionStateMachineService | None = None,
        orchestrator: IntegrationOrchestratorService | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        resolved_connection = connection
        if resolved_connection is None and state_machine is not None:
            resolved_connection = getattr(state_machine, "_connection", None)
        if resolved_connection is None:
            resolved_connection = get_connection()

        self._connection = resolved_connection
        self.state_machine = state_machine or SubmissionStateMachineService(
            connection=resolved_connection
        )
        self.orchestrator = orchestrator or IntegrationOrchestratorService(
            connection=resolved_connection
        )

    def reset(self) -> None:
        self.state_machine.reset()
        self.orchestrator.reset()

    def create_draft_submission(self, request: CreateDraftRequest) -> CreateDraftResult:
        logger.info(
            "Creating draft submission in workflow.",
            extra={"submission_id": request.submission_id},
        )
        return self.state_machine.create_draft(request)

    def transition_submission(
        self, submission_id: str, request: TransitionRequest
    ) -> TransitionExecutionResult:
        logger.info(
            "Executing workflow transition.",
            extra={"submission_id": submission_id, "to_state": request.to_state.value},
        )
        self._assert_creator_submit_gate(submission_id, request)
        transition_result = self.state_machine.transition(submission_id, request)
        if transition_result.domain_event is None:
            orchestration = OrchestrationResult(
                transition_event_id=None,
                submission_id=submission_id,
                idempotent=transition_result.idempotent,
                integration_events=[],
            )
        else:
            orchestration = self.orchestrator.consume_transition_event(
                transition_result.domain_event
            )

        return TransitionExecutionResult(
            submission=transition_result.submission,
            transition=transition_result.transition,
            domain_event=transition_result.domain_event,
            idempotent=transition_result.idempotent,
            orchestration=orchestration,
        )

    def dispatch_integration(self, request: IntegrationDispatchRequest) -> OrchestrationResult:
        logger.info(
            "Dispatching workflow integration event.",
            extra={"submission_id": request.transition_event.submission_id},
        )
        return self.orchestrator.consume_transition_event(request.transition_event)

    def list_transitions(self, submission_id: str) -> list[TransitionRecord]:
        return self.state_machine.list_transitions(submission_id)

    def list_integration_events(self, submission_id: str) -> list[IntegrationEvent]:
        return self.orchestrator.list_integration_events(submission_id)

    def _assert_creator_submit_gate(self, submission_id: str, request: TransitionRequest) -> None:
        if request.actor_role != ActorRole.CREATOR:
            return
        if request.to_state not in {SubmissionState.UNDER_REVIEW, SubmissionState.UPLOADING}:
            return

        metadata_row = self._connection.execute(
            """
            SELECT airtable_form_completed
            FROM submission_metadata
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        if metadata_row is None:
            return

        airtable_form_completed = bool(metadata_row["airtable_form_completed"])
        link_row = self._connection.execute(
            """
            SELECT sync_status
            FROM airtable_submission_links
            WHERE submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        sync_status = link_row["sync_status"] if link_row is not None else None

        if airtable_form_completed and sync_status == "linked":
            return

        raise DomainError(
            code=TransitionErrorCode.TRANSITION_NOT_ALLOWED,
            message=(
                "Submit for review requires Airtable form completion and a linked Airtable record."
            ),
            status_code=409,
            details={
                "submission_id": submission_id,
                "required_gates": {
                    "airtable_form_completed": True,
                    "airtable_sync_status": "linked",
                },
                "actual_gates": {
                    "airtable_form_completed": airtable_form_completed,
                    "airtable_sync_status": sync_status,
                },
            },
        )
