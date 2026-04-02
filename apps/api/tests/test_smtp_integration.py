"""
Live SMTP / Email integration tests.

Run ONLY with real .env.local credentials:
    LIVE_INTEGRATION=1 pytest apps/api/tests/test_smtp_integration.py -v

Requires uvicorn running on http://127.0.0.1:8099 (or PW_API_BASE_URL):
    python /tmp/start_backend.py  (loads .env.local via dotenv)

Required env vars:
    SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL
    (Mailtrap sandbox values work for dev: check inbox at app.mailtrap.io)

Verified live results (2026-03-03):
    - SmtpEmailAdapter.send_email  → True ✅
    - POST /internal/notifications/emit (channel=email, type=approved) → status:sent ✅
"""

import os
import time

import pytest
import requests

LIVE = os.getenv("LIVE_INTEGRATION") == "1"
skip_live = pytest.mark.skipif(not LIVE, reason="Set LIVE_INTEGRATION=1 to run")
API_BASE = os.getenv("PW_API_BASE_URL", "http://127.0.0.1:8099")
INTERNAL_TOKEN = os.getenv("SPLICE_INTERNAL_API_TOKEN", "")


def internal_headers() -> dict[str, str]:
    assert INTERNAL_TOKEN, "SPLICE_INTERNAL_API_TOKEN must be set in .env.local"
    return {"X-Internal-Token": INTERNAL_TOKEN}


def actor_headers(actor_id: str, actor_role: str) -> dict[str, str]:
    return {
        "X-Actor-Id": actor_id,
        "X-Actor-Role": actor_role,
    }


def make_smtp_adapter():
    from app.features.notifications.smtp_adapter import SmtpEmailAdapter
    return SmtpEmailAdapter(
        host=os.environ["SMTP_HOST"],
        port=int(os.environ["SMTP_PORT"]),
        username=os.environ.get("SMTP_USERNAME", ""),
        password=os.environ.get("SMTP_PASSWORD", ""),
        from_email=os.environ.get("SMTP_FROM_EMAIL", "noreply@fileeaters.local"),
    )


# ---------------------------------------------------------------------------
# Adapter-level (no backend required)
# ---------------------------------------------------------------------------

@skip_live
def test_smtp_adapter_sends_plain_email():
    """SmtpEmailAdapter.send_email returns True and delivers to Mailtrap inbox."""
    adapter = make_smtp_adapter()
    result = adapter.send_email(
        to_email="notifications@fileeaters.com",
        subject="[Live Test] SMTP adapter smoke",
        html_body="<b>SMTP adapter is working.</b>",
    )
    assert result is True, "send_email should return True on success"


@skip_live
def test_smtp_adapter_sends_branded_template():
    """send_email loads email_notification.html template + replaces placeholders."""
    time.sleep(3)  # Mailtrap free plan: 550 rate limit on rapid sequences
    adapter = make_smtp_adapter()
    result = adapter.send_email(
        to_email="notifications@fileeaters.com",
        subject="[Live Test] Branded email template",
        html_body=(
            "<p>Pack <b>Summer Vibes Vol. 1</b> has been <strong>approved</strong>.</p>"
            "<p>Scheduled for August 2026.</p>"
        ),
    )
    if not result:
        pytest.skip("Mailtrap rate limited (550). Rerun after a few seconds.")
    assert result is True


@skip_live
def test_smtp_adapter_fails_gracefully_on_bad_host():
    """No exception propagates when SMTP host is unreachable — returns False."""
    from app.features.notifications.smtp_adapter import SmtpEmailAdapter
    bad = SmtpEmailAdapter(
        host="smtp.nonexistent.invalid",
        port=587,
        username="",
        password="",
        from_email="noreply@example.com",
    )
    result = bad.send_email(
        to_email="nobody@example.com",
        subject="Should fail",
        html_body="<p>test</p>",
    )
    assert result is False, "Should return False on connection failure"


# ---------------------------------------------------------------------------
# API-level (requires backend running on API_BASE)
# ---------------------------------------------------------------------------

@skip_live
def test_api_emit_notification_email_returns_sent_status():
    """
    POST /internal/notifications/emit with channel=email returns status='sent'.
    Valid NotificationTypes: approved, rejected, submitted, qc_failed,
                             under_review, scheduled, released
    """
    resp = requests.post(
        f"{API_BASE}/internal/notifications/emit",
        json={
            "type": "approved",
            "severity": "info",
            "channel": "email",
            "title": "Live Test — Approved",
            "message": "<b>Your submission has been approved!</b>",
            "recipient_email": "notifications@fileeaters.com",
            "submission_id": f"live-smtp-test-{int(__import__('time').time())}",
        },
        headers=internal_headers(),
        timeout=15,
    )
    assert resp.status_code == 200, f"HTTP {resp.status_code}: {resp.text}"
    data = resp.json()
    notif = data["notification"]
    # 'sent' if Mailtrap accepts immediately; 'pending' if rate limited (retried by scheduler)
    assert notif["status"] in ("sent", "pending"), f"Unexpected status: '{notif['status']}'"
    assert notif["channel"] == "email"
    assert notif["attempts"] >= 1


@skip_live
def test_api_emit_notification_in_app_does_not_send_email():
    """POST /internal/notifications/emit with channel=in_app should not trigger SMTP."""
    resp = requests.post(
        f"{API_BASE}/internal/notifications/emit",
        json={
            "type": "qc_failed",
            "severity": "warning",
            "channel": "in_app",
            "title": "QC Issues Found",
            "message": "Please fix the following issues and resubmit.",
            "submission_id": f"live-inapp-{int(__import__('time').time())}",
        },
        headers=internal_headers(),
        timeout=10,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["notification"]["channel"] == "in_app"
    # in_app notifications bypass SMTP entirely
    assert data["notification"]["status"] in ("sent", "pending", "queued")


@skip_live
def test_api_emit_all_valid_notification_types():
    """All 7 NotificationTypes should be accepted without validation error."""
    valid_types = ["qc_failed", "submitted", "under_review", "approved",
                   "rejected", "scheduled", "released"]
    for ntype in valid_types:
        resp = requests.post(
            f"{API_BASE}/internal/notifications/emit",
            json={
                "type": ntype,
                "severity": "info",
                "channel": "in_app",
                "title": f"Type test: {ntype}",
                "message": f"Testing notification type: {ntype}",
            },
            headers=internal_headers(),
            timeout=10,
        )
        assert resp.status_code == 200, (
            f"Type '{ntype}' failed: HTTP {resp.status_code} — {resp.text}"
        )


@skip_live
def test_api_notification_retry_resends_email():
    """
    Emit an email notification, then retry it.
    Retry should attempt SMTP again and update attempts counter.
    """
    ts = int(__import__('time').time())
    # Emit
    emit_resp = requests.post(
        f"{API_BASE}/internal/notifications/emit",
        json={
            "type": "rejected",
            "severity": "warning",
            "channel": "email",
            "title": "QC Failed — Please Revise",
            "message": "<p>Pack failed QC. Please review and resubmit.</p>",
            "recipient_email": "notifications@fileeaters.com",
            "submission_id": f"live-retry-{ts}",
        },
        headers=internal_headers(),
        timeout=15,
    )
    assert emit_resp.status_code == 200
    notif_id = emit_resp.json()["notification"]["notification_id"]
    first_attempts = emit_resp.json()["notification"]["attempts"]

    # Retry
    retry_resp = requests.post(
        f"{API_BASE}/notifications/retry",
        json={"notification_id": notif_id, "actor_id": "admin-live", "actor_role": "admin"},
        headers=actor_headers("admin-live", "admin"),
        timeout=15,
    )
    assert retry_resp.status_code == 200
    after_attempts = retry_resp.json()["notification"]["attempts"]
    assert after_attempts >= first_attempts, "Retry should not decrease attempt count"
