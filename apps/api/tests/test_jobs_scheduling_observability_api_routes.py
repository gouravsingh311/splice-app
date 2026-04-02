from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def create_client() -> TestClient:
    return TestClient(create_app())


def auth_headers(*, actor_id: str, actor_role: str) -> dict[str, str]:
    return {
        "X-Actor-Id": actor_id,
        "X-Actor-Role": actor_role,
    }


def internal_headers() -> dict[str, str]:
    return {
        "X-Internal-Token": "test-internal-token",
    }


def create_approved_submission(client: TestClient, submission_id: str) -> dict:
    draft = client.post(
        "/submissions/draft",
        json={
            "submission_id": submission_id,
            "creator_id": "creator-1",
            "preferred_release_month": "2026-04",
        },
    )
    assert draft.status_code == 200

    under_review = client.post(
        f"/submissions/{submission_id}/transition",
        json={
            "request_id": f"{submission_id}:under-review",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert under_review.status_code == 200

    approved = client.post(
        f"/submissions/{submission_id}/transition",
        json={
            "request_id": f"{submission_id}:approved",
            "to_state": "approved",
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "expected_version": 1,
        },
        headers=auth_headers(actor_id="reviewer-1", actor_role="reviewer"),
    )
    assert approved.status_code == 200

    return next(
        event["payload"]
        for event in approved.json()["orchestration"]["integration_events"]
        if event["event_name"] == "submission.approved.scheduling.v1"
    )


def test_jobs_endpoints_support_enqueue_get_and_replay() -> None:
    client = create_client()

    enqueue = client.post(
        "/internal/jobs/enqueue",
        json={
            "request_id": "job-req-1",
            "job_type": "notification.dispatch",
            "idempotency_key": "job:notify:1",
            "payload_json": {"submission_id": "sub-job-1"},
            "max_attempts": 1,
        },
        headers=internal_headers(),
    )
    assert enqueue.status_code == 202
    job_id = enqueue.json()["job"]["id"]

    first_failure = client.app.state.job_queue_service.mark_failed(
        job_id,
        failure_reason="smtp-down",
    )
    assert first_failure.status.value == "dead_lettered"

    details = client.get(f"/admin/jobs/{job_id}")
    assert details.status_code == 200
    assert details.json()["dead_letter"]["failure_reason"] == "smtp-down"

    replay = client.post(
        f"/admin/jobs/{job_id}/replay",
        json={
            "request_id": "job-replay-1",
            "actor_id": "admin-1",
            "reason": "Recover",
            "confirmation": "REPLAY",
        },
    )
    assert replay.status_code == 200
    assert replay.json()["job"]["status"] == "queued"


def test_internal_job_enqueue_rejects_missing_service_token() -> None:
    client = create_client()

    response = client.post(
        "/internal/jobs/enqueue",
        json={
            "request_id": "job-req-missing-token",
            "job_type": "notification.dispatch",
            "idempotency_key": "job:missing-token",
            "payload_json": {"submission_id": "sub-job-3"},
            "max_attempts": 1,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_job_replay_requires_explicit_confirmation() -> None:
    client = create_client()
    enqueue = client.post(
        "/internal/jobs/enqueue",
        json={
            "request_id": "job-req-2",
            "job_type": "notification.dispatch",
            "idempotency_key": "job:notify:2",
            "payload_json": {"submission_id": "sub-job-2"},
            "max_attempts": 1,
        },
        headers=internal_headers(),
    )
    job_id = enqueue.json()["job"]["id"]
    client.app.state.job_queue_service.mark_failed(job_id, failure_reason="smtp-down")

    replay = client.post(
        f"/admin/jobs/{job_id}/replay",
        json={
            "request_id": "job-replay-2",
            "actor_id": "admin-1",
            "reason": "Recover",
            "confirmation": "retry",
        },
    )
    assert replay.status_code == 422
    assert replay.json()["error"]["code"] == "VALIDATION_ERROR"


def test_release_scheduling_endpoints_execute_baseline_flow() -> None:
    client = create_client()
    scheduling_event = create_approved_submission(client, "sub-api-schedule-1")

    resolve = client.post(
        "/submissions/sub-api-schedule-1/schedule/resolve",
        json={
            "request_id": "resolve-api-1",
            "scheduling_event": scheduling_event,
            "timezone": "UTC",
        },
    )
    assert resolve.status_code == 200
    assert resolve.json()["schedule"]["source"] == "approval_event"

    override = client.put(
        "/submissions/sub-api-schedule-1/schedule",
        json={
            "request_id": "override-api-1",
            "new_release_at": "2026-04-11T10:00:00Z",
            "reason": "Operations shift",
            "actor_id": "admin-1",
            "actor_role": "admin",
            "timezone": "UTC",
        },
        headers=auth_headers(actor_id="admin-1", actor_role="admin"),
    )
    assert override.status_code == 200
    assert override.json()["schedule"]["source"] == "manual_override"

    trigger = client.post(
        "/submissions/sub-api-schedule-1/release/trigger",
        json={
            "request_id": "release-api-1",
            "actor_id": "system-worker",
            "actor_role": "system",
            "force": True,
            "job_run_id": override.json()["release_job"]["id"],
        },
        headers=auth_headers(actor_id="system-worker", actor_role="system"),
    )
    assert trigger.status_code == 200
    assert trigger.json()["submission"]["current_state"] == "released"


def test_schedule_override_rejects_spoofed_actor_context() -> None:
    client = create_client()
    create_approved_submission(client, "sub-api-schedule-spoof")

    response = client.put(
        "/submissions/sub-api-schedule-spoof/schedule",
        json={
            "request_id": "override-spoof-1",
            "new_release_at": "2026-04-11T10:00:00Z",
            "reason": "Operations shift",
            "actor_id": "creator-1",
            "actor_role": "admin",
            "timezone": "UTC",
        },
        headers=auth_headers(actor_id="admin-1", actor_role="admin"),
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_observability_endpoints_return_metrics_and_accept_incident_annotations() -> None:
    client = create_client()

    annotation = client.post(
        "/admin/incidents/annotations",
        json={
            "source": "scheduler",
            "severity": "warning",
            "note": "Retry queue depth elevated",
            "linked_entity": "submission:sub-api-99",
            "failure_class": "retry_exhaustion",
            "correlation_id": "job:job-99",
            "remediation_status": "acknowledged",
            "remediation_owner": "ops-1",
            "remediation_link": "/admin/jobs/job-99",
            "audit_event_id": "audit:event-99",
        },
    )
    assert annotation.status_code == 200
    assert annotation.json()["annotation"]["source"] == "scheduler"
    assert annotation.json()["annotation"]["failure_class"] == "retry_exhaustion"
    assert annotation.json()["annotation"]["correlation_id"] == "job:job-99"
    assert annotation.json()["annotation"]["remediation_status"] == "acknowledged"

    duplicate_annotation = client.post(
        "/admin/incidents/annotations",
        json={
            "source": "scheduler",
            "severity": "warning",
            "note": "Retry queue depth elevated",
            "linked_entity": "submission:sub-api-99",
            "failure_class": "retry_exhaustion",
            "correlation_id": "job:job-99",
            "remediation_status": "acknowledged",
            "remediation_owner": "ops-1",
            "remediation_link": "/admin/jobs/job-99",
            "audit_event_id": "audit:event-99",
        },
    )
    assert duplicate_annotation.status_code == 200
    assert duplicate_annotation.json()["idempotent"] is True

    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "splice_api_http_requests_total" in metrics.text
    assert "splice_api_incident_annotations_total" in metrics.text


def test_failure_class_telemetry_is_emitted_for_retry_exhaustion_and_scheduling_terminal() -> None:
    client = create_client()

    enqueue = client.post(
        "/internal/jobs/enqueue",
        json={
            "request_id": "job-obs-1",
            "job_type": "release.trigger",
            "idempotency_key": "release.trigger:obs:1",
            "payload_json": {"submission_id": "sub-obs-1"},
            "max_attempts": 1,
            "correlation_id": "corr-obs-1",
        },
        headers=internal_headers(),
    )
    assert enqueue.status_code == 202
    job_id = enqueue.json()["job"]["id"]

    dead_letter = client.app.state.job_queue_service.mark_failed(
        job_id,
        failure_reason="TRANSITION_NOT_ALLOWED: scheduled -> released transition is not allowed",
    )
    assert dead_letter.status.value == "dead_lettered"

    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "splice_api_failure_class_total{failure_class=\"retry_exhaustion\"" in metrics.text
    assert (
        "splice_api_failure_class_total{failure_class=\"scheduling_terminal_failure\""
        in metrics.text
    )
    assert "splice_api_failure_context_total" in metrics.text


def test_failure_class_telemetry_treats_schedule_not_due_dead_letters_as_retry_exhaustion_only() -> None:
    client = create_client()

    enqueue = client.post(
        "/internal/jobs/enqueue",
        json={
            "request_id": "job-obs-2",
            "job_type": "release.trigger",
            "idempotency_key": "release.trigger:obs:2",
            "payload_json": {"submission_id": "sub-obs-2"},
            "max_attempts": 1,
            "correlation_id": "corr-obs-2",
        },
        headers=internal_headers(),
    )
    assert enqueue.status_code == 202
    job_id = enqueue.json()["job"]["id"]

    dead_letter = client.app.state.job_queue_service.mark_failed(
        job_id,
        failure_reason="SCHEDULE_NOT_DUE: release trigger is not due yet",
    )
    assert dead_letter.status.value == "dead_lettered"
    assert dead_letter.failure_class.value == "transient"

    details = client.get(f"/admin/jobs/{job_id}")
    assert details.status_code == 200
    assert details.json()["job"]["failure_class"] == "transient"
    assert details.json()["job"]["recommended_action"] == "replay_safe"
    assert details.json()["dead_letter"]["failure_class"] == "transient"

    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert (
        'splice_api_failure_class_total{failure_class="retry_exhaustion",severity="critical",source="background-job-queue"}'
        in metrics.text
    )
    assert "splice_api_failure_context_total" in metrics.text
    assert "scheduling_terminal_failure" not in metrics.text


def test_schedule_resolve_rejects_submission_mismatch() -> None:
    client = create_client()
    scheduling_event = create_approved_submission(client, "sub-api-schedule-2")

    mismatch = client.post(
        "/submissions/sub-other/schedule/resolve",
        json={
            "request_id": "resolve-api-2",
            "scheduling_event": scheduling_event,
            "timezone": "UTC",
        },
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "SCHEDULE_SUBMISSION_MISMATCH"


def test_jobs_enqueue_rejects_malformed_payload_with_contract_error_envelope() -> None:
    client = create_client()

    malformed = client.post(
        "/internal/jobs/enqueue",
        json={
            "job_type": "release.trigger",
            "idempotency_key": "release.trigger:bad",
            "payload_json": {"submission_id": "sub-bad"},
            "max_attempts": 0,
        },
        headers=internal_headers(),
    )

    assert malformed.status_code == 422
    body = malformed.json()
    assert body["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"
    assert "errors" in body["error"]["details"]


def test_jobs_replay_rejects_blank_reason_with_contract_error_envelope() -> None:
    client = create_client()

    malformed = client.post(
        "/admin/jobs/job-missing/replay",
        json={
            "request_id": "replay-bad-1",
            "actor_id": "admin-1",
            "reason": "   ",
        },
    )

    assert malformed.status_code == 422
    body = malformed.json()
    assert body["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"
    assert "errors" in body["error"]["details"]


def test_schedule_override_rejects_mismatched_actor_context_with_auth_forbidden() -> None:
    client = create_client()

    malformed = client.put(
        "/submissions/sub-no-schedule/schedule",
        json={
            "request_id": "override-bad-1",
            "new_release_at": "2026-04-11T10:00:00Z",
            "reason": "Operations shift",
            "actor_id": "creator-1",
            "actor_role": "admin",
            "timezone": "UTC",
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )

    assert malformed.status_code == 403
    body = malformed.json()
    assert body["error"]["code"] == "AUTH_FORBIDDEN"


def test_schedule_override_without_existing_schedule_returns_deterministic_domain_error() -> None:
    client = create_client()

    missing = client.put(
        "/submissions/sub-no-schedule/schedule",
        json={
            "request_id": "override-not-found-1",
            "new_release_at": "2026-04-11T10:00:00Z",
            "reason": "Operations shift",
            "actor_id": "admin-1",
            "actor_role": "admin",
            "timezone": "UTC",
        },
        headers=auth_headers(actor_id="admin-1", actor_role="admin"),
    )

    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SCHEDULE_NOT_FOUND"


def test_release_trigger_rejects_invalid_actor_role_with_contract_error_envelope() -> None:
    client = create_client()

    malformed = client.post(
        "/submissions/sub-missing/release/trigger",
        json={
            "request_id": "trigger-bad-1",
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "force": False,
            "job_run_id": None,
        },
        headers=auth_headers(actor_id="reviewer-1", actor_role="reviewer"),
    )

    assert malformed.status_code == 422
    body = malformed.json()
    assert body["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"
    assert "errors" in body["error"]["details"]


def test_incident_annotation_rejects_blank_note_with_contract_error_envelope() -> None:
    client = create_client()

    malformed = client.post(
        "/admin/incidents/annotations",
        json={
            "source": "scheduler",
            "severity": "warning",
            "note": "   ",
            "linked_entity": "submission:sub-api-99",
        },
    )

    assert malformed.status_code == 422
    body = malformed.json()
    assert body["error"]["code"] == "INVALID_CONTRACT_PAYLOAD"
    assert "errors" in body["error"]["details"]
