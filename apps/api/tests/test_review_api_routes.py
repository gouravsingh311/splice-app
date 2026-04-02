from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def create_client() -> TestClient:
    app = create_app()
    app.state.job_queue_service.close()
    return TestClient(app)


def auth_headers(*, actor_id: str, actor_role: str) -> dict[str, str]:
    return {
        "X-Actor-Id": actor_id,
        "X-Actor-Role": actor_role,
    }


def create_under_review_submission(
    client: TestClient,
    submission_id: str,
    *,
    creator_id: str = "creator-1",
) -> None:
    draft = client.post(
        "/submissions/draft",
        json={
            "submission_id": submission_id,
            "creator_id": creator_id,
            "preferred_release_month": "2026-05",
            "metadata": {"pack_name": f"Pack {submission_id}"},
        },
    )
    assert draft.status_code == 200

    moved = client.post(
        f"/submissions/{submission_id}/transition",
        json={
            "request_id": f"{submission_id}:under-review",
            "to_state": "under_review",
            "actor_id": creator_id,
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id=creator_id, actor_role="creator"),
    )
    assert moved.status_code == 200


def create_uploading_submission(
    client: TestClient,
    submission_id: str,
    *,
    creator_id: str = "creator-1",
) -> None:
    draft = client.post(
        "/submissions/draft",
        json={
            "submission_id": submission_id,
            "creator_id": creator_id,
            "preferred_release_month": "2026-05",
            "metadata": {"pack_name": f"Pack {submission_id}"},
        },
    )
    assert draft.status_code == 200

    moved = client.post(
        f"/submissions/{submission_id}/transition",
        json={
            "request_id": f"{submission_id}:uploading",
            "to_state": "uploading",
            "actor_id": creator_id,
            "actor_role": "creator",
            "expected_version": 0,
        },
        headers=auth_headers(actor_id=creator_id, actor_role="creator"),
    )
    assert moved.status_code == 200


def test_review_queue_enforces_reviewer_admin_access() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-1")
    create_uploading_submission(client, "sub-uploading-1")

    denied = client.get(
        "/reviews/queue",
        params={"actor_id": "creator-1", "actor_role": "creator"},
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "REVIEW_FORBIDDEN"

    allowed = client.get(
        "/reviews/queue",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert allowed.status_code == 200
    payload = allowed.json()
    assert len(payload["items"]) >= 1
    assert payload["items"][0]["state"] == "under_review"
    assert all(item["state"] != "uploading" for item in payload["items"])

    creator_detail = client.get(
        "/reviews/submissions/sub-review-1",
        params={"actor_id": "creator-1", "actor_role": "creator"},
    )
    assert creator_detail.status_code == 403
    assert creator_detail.json()["error"]["code"] == "REVIEW_FORBIDDEN"

    creator_approve = client.post(
        "/reviews/submissions/sub-review-1/approve",
        json={
            "actor_id": "creator-1",
            "actor_role": "creator",
            "request_id": "creator-approve-1",
        },
    )
    assert creator_approve.status_code == 403
    assert creator_approve.json()["error"]["code"] == "REVIEW_FORBIDDEN"


def test_review_submission_detail_reads_qc_findings_from_sqlite_rows() -> None:
    client = create_client()
    submission_id = "sub-review-detail-1"
    create_under_review_submission(client, submission_id)

    connection = client.app.state.review_console_service._connection
    report_id = f"qcrpt:{submission_id}:1"
    with connection:
        connection.execute(
            """
            INSERT INTO qc_reports (
                report_id,
                submission_id,
                request_id,
                status,
                summary_json,
                rule_set_version,
                policy_version,
                applied_policy_id,
                generated_at,
                created_at,
                idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                submission_id,
                "qc-request-1",
                "completed",
                '{"blocking_failures":0,"warnings":1,"evaluated_rule_count":12}',
                "v1",
                1,
                "policy-v1",
                "2026-03-30T16:00:00+00:00",
                "2026-03-30T16:00:00+00:00",
                "qc-idem-1",
            ),
        )
        connection.execute(
            """
            INSERT INTO qc_findings (
                finding_id,
                report_id,
                rule_id,
                severity,
                blocking,
                status,
                message,
                remediation,
                context_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "finding-1",
                report_id,
                "DEMO_NORMALIZATION_INVALID",
                "warning",
                0,
                "failed",
                "Demo peak should be normalized to -1.0dB.",
                "Normalize demo peak to -1.0dB.",
                '{"file":"Demo/example.mp3"}',
            ),
        )

    detail = client.get(
        f"/reviews/submissions/{submission_id}",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert detail.status_code == 200
    payload = detail.json()
    assert len(payload["qc_findings"]) == 1
    assert payload["qc_findings"][0]["rule_id"] == "DEMO_NORMALIZATION_INVALID"
    assert payload["qc_findings"][0]["message"] == "Demo peak should be normalized to -1.0dB."


def test_reject_requires_reason_code_and_notes() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-2")

    missing_reason = client.post(
        "/reviews/submissions/sub-review-2/reject",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reject-1",
        },
    )
    assert missing_reason.status_code == 400
    assert missing_reason.json()["error"]["code"] == "REVIEW_REASON_REQUIRED"

    success = client.post(
        "/reviews/submissions/sub-review-2/reject",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reject-2",
            "reason_code": "QUALITY_ISSUES",
            "notes": "Clipping detected in kick stem.",
        },
    )
    assert success.status_code == 200
    body = success.json()
    assert body["decision"]["decision"] == "REJECTED"
    assert body["decision"]["reason_code"] == "QUALITY_ISSUES"


def test_reopen_requires_rejected_state() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-3")

    invalid_state = client.post(
        "/reviews/submissions/sub-review-3/reopen",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reopen-1",
            "notes": "Needs amendment.",
        },
    )
    assert invalid_state.status_code == 409
    assert invalid_state.json()["error"]["code"] == "REVIEW_INVALID_STATE"

    rejected = client.post(
        "/reviews/submissions/sub-review-3/reject",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reject-1",
            "reason_code": "METADATA_MISSING",
            "notes": "Missing BPM metadata in manifest.",
        },
    )
    assert rejected.status_code == 200

    reopened = client.post(
        "/reviews/submissions/sub-review-3/reopen",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reopen-2",
            "notes": "Re-opened for metadata fixes.",
        },
    )
    assert reopened.status_code == 200
    assert reopened.json()["decision"]["decision"] == "REOPENED"
    assert reopened.json()["transition"]["submission"]["current_state"] == "draft"


def test_approve_creates_creator_notification_record() -> None:
    client = create_client()
    submission_id = "sub-review-notif-1"
    create_under_review_submission(client, submission_id)

    approved = client.post(
        f"/reviews/submissions/{submission_id}/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-notif-1",
            "notes": "Approved in review queue.",
        },
    )
    assert approved.status_code == 200

    connection = client.app.state.notification_service._connection
    row = connection.execute(
        """
        SELECT type, status, submission_id
        FROM notifications
        WHERE submission_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (submission_id,),
    ).fetchone()
    assert row is not None
    assert row["type"] == "approved"
    assert row["status"] == "sent"
    assert row["submission_id"] == submission_id


def test_approve_emits_email_notification_when_creator_enabled_it() -> None:
    client = create_client()
    submission_id = "sub-review-email-1"
    create_under_review_submission(client, submission_id)

    profile = client.put(
        "/creator/profile",
        json={
            "actor_id": "creator-1",
            "user_id": "creator-1",
            "defaults_json": {"notifications": {"approval_email_enabled": True}},
        },
    )
    assert profile.status_code == 200

    approved = client.post(
        f"/reviews/submissions/{submission_id}/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-email-1",
        },
    )
    assert approved.status_code == 200

    connection = client.app.state.notification_service._connection
    rows = connection.execute(
        """
        SELECT channel, status
        FROM notifications
        WHERE submission_id = ?
        ORDER BY created_at ASC
        """,
        (submission_id,),
    ).fetchall()

    channels = [row["channel"] for row in rows]
    assert "in_app" in channels
    assert "email" in channels
    email_rows = [row for row in rows if row["channel"] == "email"]
    assert len(email_rows) == 1
    assert email_rows[0]["status"] in {"pending", "sent", "failed"}


def test_approve_backfills_missing_transition_metadata_from_creator_submission_metadata() -> None:
    client = create_client()
    submission_id = "sub-review-backfill-1"
    create_under_review_submission(client, submission_id)

    connection = client.app.state.review_console_service._connection
    with connection:
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                "creator-1",
                "Backfill Pack",
                "Backfill Label",
                "2026-05",
                None,
                "[]",
                0,
                None,
                "2026-03-30T00:00:00+00:00",
                "2026-03-30T00:00:00+00:00",
            ),
        )
        connection.execute(
            """
            INSERT INTO submission_state_metadata (
                submission_id,
                metadata_json,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(submission_id) DO UPDATE SET
              metadata_json = excluded.metadata_json,
              updated_at = excluded.updated_at
            """,
            (
                submission_id,
                '{"intake_session_id":"intake:test","handoff_result":"completed"}',
                "2026-03-30T00:00:00+00:00",
                "2026-03-30T00:00:00+00:00",
            ),
        )

    approved = client.post(
        f"/reviews/submissions/{submission_id}/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-backfill-1",
            "notes": "Approved after metadata backfill.",
        },
    )
    assert approved.status_code == 200
    payload = approved.json()
    assert payload["transition"]["domain_event"]["preferred_release_month"] == "2026-05"


def test_review_tags_and_flags_are_persisted() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-4")

    tag = client.post(
        "/reviews/submissions/sub-review-4/tags",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "tag": "metadata",
        },
    )
    assert tag.status_code == 200
    assert tag.json()["tag"]["tag"] == "metadata"

    flag = client.post(
        "/reviews/submissions/sub-review-4/flags",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "flag_type": "policy",
            "severity": "high",
        },
    )
    assert flag.status_code == 200
    assert flag.json()["flag"]["flag_type"] == "policy"

    detail = client.get(
        "/reviews/submissions/sub-review-4",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["tags"][0]["tag"] == "metadata"
    assert payload["flags"][0]["flag_type"] == "policy"


def test_review_queue_detail_and_actions_deny_self_review_scope() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-self", creator_id="reviewer-1")
    create_under_review_submission(client, "sub-review-visible", creator_id="creator-1")

    queue = client.get(
        "/reviews/queue",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert queue.status_code == 200
    ids = [item["submission_id"] for item in queue.json()["items"]]
    assert "sub-review-visible" in ids
    assert "sub-review-self" not in ids

    detail = client.get(
        "/reviews/submissions/sub-review-self",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert detail.status_code == 403
    assert detail.json()["error"]["code"] == "REVIEW_FORBIDDEN"
    assert detail.json()["error"]["details"]["submission_id"] == "sub-review-self"

    approve = client.post(
        "/reviews/submissions/sub-review-self/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-self-review",
        },
    )
    assert approve.status_code == 403
    assert approve.json()["error"]["code"] == "REVIEW_FORBIDDEN"
    assert approve.json()["error"]["details"]["creator_id"] == "reviewer-1"


def test_review_queue_prioritizes_high_risk_then_oldest_with_stable_tie_break() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-order-a")
    create_under_review_submission(client, "sub-review-order-b")

    low_flag = client.post(
        "/reviews/submissions/sub-review-order-a/flags",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "flag_type": "metadata",
            "severity": "low",
        },
    )
    assert low_flag.status_code == 200

    high_flag = client.post(
        "/reviews/submissions/sub-review-order-b/flags",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "flag_type": "policy",
            "severity": "high",
        },
    )
    assert high_flag.status_code == 200

    queue = client.get(
        "/reviews/queue",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    assert queue.status_code == 200
    ids = [
        item["submission_id"]
        for item in queue.json()["items"]
        if item["submission_id"] in {"sub-review-order-a", "sub-review-order-b"}
    ]
    assert ids == ["sub-review-order-b", "sub-review-order-a"]


def test_review_queue_triage_ordering_and_filters_are_deterministic() -> None:
    client = create_client()

    ordered_submission_ids = [
        "sub-review-triage-1",
        "sub-review-triage-2",
        "sub-review-triage-3",
    ]
    for submission_id in ordered_submission_ids:
        create_under_review_submission(client, submission_id)

    # Tag/flag selected items to validate deterministic filtered subsets.
    tagged_and_flagged = [ordered_submission_ids[0], ordered_submission_ids[2]]
    for submission_id in tagged_and_flagged:
        tag_response = client.post(
            f"/reviews/submissions/{submission_id}/tags",
            json={
                "actor_id": "reviewer-1",
                "actor_role": "reviewer",
                "tag": "triage-a",
            },
        )
        assert tag_response.status_code == 200

        flag_response = client.post(
            f"/reviews/submissions/{submission_id}/flags",
            json={
                "actor_id": "reviewer-1",
                "actor_role": "reviewer",
                "flag_type": "risk-high",
                "severity": "high",
            },
        )
        assert flag_response.status_code == 200

    first_queue = client.get(
        "/reviews/queue",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )
    second_queue = client.get(
        "/reviews/queue",
        params={"actor_id": "reviewer-1", "actor_role": "reviewer"},
    )

    assert first_queue.status_code == 200
    assert second_queue.status_code == 200

    first_ids = [
        item["submission_id"]
        for item in first_queue.json()["items"]
        if item["submission_id"] in set(ordered_submission_ids)
    ]
    second_ids = [
        item["submission_id"]
        for item in second_queue.json()["items"]
        if item["submission_id"] in set(ordered_submission_ids)
    ]
    expected_priority_order = [
        ordered_submission_ids[0],
        ordered_submission_ids[2],
        ordered_submission_ids[1],
    ]
    assert first_ids == expected_priority_order
    assert second_ids == expected_priority_order

    tag_filtered = client.get(
        "/reviews/queue",
        params={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "state": "under_review",
            "tag": "triage-a",
        },
    )
    assert tag_filtered.status_code == 200
    assert [item["submission_id"] for item in tag_filtered.json()["items"]] == tagged_and_flagged

    flag_filtered = client.get(
        "/reviews/queue",
        params={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "state": "under_review",
            "flag": "risk-high",
        },
    )
    assert flag_filtered.status_code == 200
    assert [item["submission_id"] for item in flag_filtered.json()["items"]] == tagged_and_flagged


def test_review_decisions_require_under_review_state() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-5")

    rejected = client.post(
        "/reviews/submissions/sub-review-5/reject",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reject-1",
            "reason_code": "QUALITY_ISSUES",
            "notes": "Needs fixes.",
        },
    )
    assert rejected.status_code == 200

    invalid_approve = client.post(
        "/reviews/submissions/sub-review-5/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-after-reject",
            "notes": "Trying to bypass reopen",
        },
    )
    assert invalid_approve.status_code == 409
    invalid_payload = invalid_approve.json()
    assert invalid_payload["error"]["code"] == "REVIEW_INVALID_STATE"
    assert invalid_payload["error"]["details"]["expected_state"] == "under_review"
    assert invalid_payload["error"]["details"]["current_state"] == "rejected"


def test_review_recovery_path_reopen_then_resubmit_then_approve() -> None:
    client = create_client()
    create_under_review_submission(client, "sub-review-6")

    rejected = client.post(
        "/reviews/submissions/sub-review-6/reject",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reject-1",
            "reason_code": "METADATA_MISSING",
            "notes": "Fix metadata before approval.",
        },
    )
    assert rejected.status_code == 200

    blocked_approve = client.post(
        "/reviews/submissions/sub-review-6/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-while-rejected",
        },
    )
    assert blocked_approve.status_code == 409
    assert blocked_approve.json()["error"]["code"] == "REVIEW_INVALID_STATE"

    reopened = client.post(
        "/reviews/submissions/sub-review-6/reopen",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "reopen-1",
            "notes": "Re-opened for corrections.",
        },
    )
    assert reopened.status_code == 200
    assert reopened.json()["transition"]["submission"]["current_state"] == "draft"

    resubmitted = client.post(
        "/submissions/sub-review-6/transition",
        json={
            "request_id": "resubmit-under-review",
            "to_state": "under_review",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "expected_version": 3,
        },
        headers=auth_headers(actor_id="creator-1", actor_role="creator"),
    )
    assert resubmitted.status_code == 200

    approved = client.post(
        "/reviews/submissions/sub-review-6/approve",
        json={
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "request_id": "approve-after-resubmit",
            "notes": "Approved after resubmission.",
        },
    )
    assert approved.status_code == 200
    assert approved.json()["decision"]["decision"] == "APPROVED"
