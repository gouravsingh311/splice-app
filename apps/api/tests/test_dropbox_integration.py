"""
Live Dropbox / Intake handoff integration tests.

Run ONLY with real .env.local credentials:
    LIVE_INTEGRATION=1 pytest apps/api/tests/test_dropbox_integration.py -v

Requires the backend running on http://127.0.0.1:8099 (or PW_API_BASE_URL):
    python /tmp/start_backend.py  (loads .env.local via dotenv)

Required env vars:
    DROPBOX_APP_KEY         — Dropbox app key
    DROPBOX_APP_SECRET      — Dropbox app secret
    DROPBOX_DELIVERY_FOLDER — Dropbox target folder (e.g. "/Splice-QC/incoming")

Verified live results (2026-03-03):
    - Intake session creation: ✅
    - Manifest with SHA-256 validation: ✅
    - Dropbox SDK connected and attempted upload: ✅
    - Status 'failed' with AuthError if token expired (expected — renew token)
    - Checksum_verified: true ✅

Token setup requirement:
    Refresh token must be configured through the app Dropbox setup flow
    (admin integrations UI/API). This test does not copy tokens from other env files.
"""

import hashlib
import os
import tempfile
import time
from pathlib import Path

import pytest
import requests

LIVE = os.getenv("LIVE_INTEGRATION") == "1"
skip_live = pytest.mark.skipif(not LIVE, reason="Set LIVE_INTEGRATION=1 to run")
API_BASE = os.getenv("PW_API_BASE_URL", "http://127.0.0.1:8099")


def require_dropbox_configured_via_app() -> None:
    """Skip live Dropbox tests unless app-managed Dropbox readiness is healthy."""
    try:
        response = requests.get(
            f"{API_BASE}/admin/integrations/dropbox/readiness",
            params={"actor_id": "admin-live", "actor_role": "admin"},
            timeout=10,
        )
    except requests.RequestException as exc:
        pytest.skip(f"Backend unavailable for Dropbox readiness check: {exc}")

    if response.status_code != 200:
        pytest.skip(
            "Dropbox readiness endpoint unavailable; configure Dropbox via app process first."
        )
    payload = response.json()
    if payload.get("status") != "READY":
        pytest.skip(
            "Dropbox is not configured via app process. "
            "Complete app Dropbox setup (OAuth) before running live Dropbox tests."
        )


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def make_test_pack(tmp: Path) -> Path:
    """Create a real-file minimal pack for upload testing."""
    pack = tmp / "Live_Test_Pack"
    (pack / "Loops").mkdir(parents=True)
    (pack / "OneShots").mkdir(parents=True)
    (pack / "Loops" / "kick_loop.wav").write_bytes(b"RIFF" + b"\x00" * 36 + b"data" + b"\xFF" * 100)
    (pack / "OneShots" / "hi_hat.wav").write_bytes(b"RIFF" + b"\x00" * 36 + b"data" + b"\xFF" * 50)
    return pack


def full_intake_handoff(tmp: Path, ts: str) -> dict:
    """Run full intake flow and return the handoff response dict."""
    pack_dir = make_test_pack(tmp)
    wav_paths = list(pack_dir.rglob("*.wav"))

    # 1. Start session
    session_resp = requests.post(
        f"{API_BASE}/intake/sessions",
        json={
            "request_id": f"live-intake-{ts}",
            "submission_id": f"live-sub-{ts}",
            "creator_id": "creator-live",
            "pack_name": "Live Dropbox Test Pack",
            "declared_top_level_folders": ["Loops", "OneShots"],
            "metadata": {"local_pack_path": str(pack_dir)},
        },
        timeout=10,
    )
    assert session_resp.status_code == 200, f"Session failed: {session_resp.text}"
    session_id = session_resp.json()["session"]["intake_session_id"]

    # 2. Manifest (locked)
    files = [
        {
            "relative_path": str(f.relative_to(pack_dir)),
            "size_bytes": max(1, f.stat().st_size),
            "sha256": sha256_file(f),
            "mime_type": "audio/wav",
            "category": "audio",
            "required_asset": True,
        }
        for f in wav_paths
    ]
    manifest_resp = requests.put(
        f"{API_BASE}/intake/sessions/{session_id}/manifest",
        json={"request_id": f"live-man-{ts}", "files": files, "lock_manifest": True},
        timeout=10,
    )
    assert manifest_resp.status_code == 200, f"Manifest failed: {manifest_resp.text}"

    # 3. Handoff to Dropbox
    handoff_resp = requests.post(
        f"{API_BASE}/intake/sessions/{session_id}/handoff",
        json={
            "request_id": f"live-hoff-{ts}",
            "intake_session_id": session_id,
            "actor_id": "creator-live",
            "actor_role": "creator",
        },
        timeout=90,
    )
    assert handoff_resp.status_code == 200, f"Handoff request failed: {handoff_resp.text}"
    return handoff_resp.json()


# ---------------------------------------------------------------------------
# API-level tests (require backend running)
# ---------------------------------------------------------------------------

@skip_live
def test_intake_session_create():
    """Intake session creation returns intake_session_id."""
    ts = str(int(time.time()))
    resp = requests.post(
        f"{API_BASE}/intake/sessions",
        json={
            "request_id": f"live-session-{ts}",
            "submission_id": f"live-s-{ts}",
            "creator_id": "creator-live",
            "pack_name": "Session Test",
            "declared_top_level_folders": ["Loops"],
            "metadata": {},
        },
        timeout=10,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["session"]["status"] == "initiated"
    assert "intake_session_id" in resp.json()["session"]


@skip_live
def test_intake_manifest_validates_sha256_format():
    """Manifest endpoint rejects invalid sha256 (wrong length)."""
    ts = str(int(time.time()))
    # Create session first
    s_resp = requests.post(f"{API_BASE}/intake/sessions", json={
        "request_id": f"mval-{ts}", "submission_id": f"mval-s-{ts}",
        "creator_id": "c", "pack_name": "Test", "declared_top_level_folders": [],
        "metadata": {},
    }, timeout=10)
    assert s_resp.status_code == 200
    sid = s_resp.json()["session"]["intake_session_id"]

    resp = requests.put(f"{API_BASE}/intake/sessions/{sid}/manifest", json={
        "request_id": f"mval-man-{ts}",
        "files": [
            {
                "relative_path": "a.wav",
                "size_bytes": 100,
                "sha256": "badhash",
                "mime_type": "audio/wav",
            }
        ],
    }, timeout=10)
    assert resp.status_code == 422
    errors = resp.json()["error"]["details"]["errors"]
    sha_err = next((e for e in errors if "sha256" in str(e.get("loc", ""))), None)
    assert sha_err is not None, "Expected sha256 validation error"


@skip_live
def test_dropbox_full_handoff_flow():
    """
    Full end-to-end Dropbox handoff flow via HTTP API.

    Expected outcomes:
    - status == 'completed'  → upload succeeded ✅
    - status == 'failed' + AuthError → access token expired (renew and rerun)
    - checksum_verified == True → file integrity checked ✅
    """
    require_dropbox_configured_via_app()
    ts = str(int(time.time()))
    with tempfile.TemporaryDirectory() as tmp:
        result = full_intake_handoff(Path(tmp), ts)

    handoff = result["handoff"]
    assert handoff["checksum_verified"] is True, "Checksum verification must pass"
    assert handoff["object_count"] == 2
    assert handoff["total_bytes"] > 0

    if handoff["status"] == "completed":
        assert handoff["completed_at"] is not None
        print(f"✅ Dropbox upload successful: {handoff['object_count']} files")
    elif handoff["status"] == "failed":
        error = handoff.get("error", "")
        if "AuthError" in error and "expired" in error:
            pytest.skip(
                "Dropbox access token expired. "
                "Renew DROPBOX_ACCESS_TOKEN in .env.local and rerun."
            )
        elif "not installed" in error.lower():
            pytest.skip("dropbox SDK not installed. Run: pip install dropbox")
        else:
            pytest.fail(f"Dropbox handoff failed unexpectedly: {error}")


@skip_live
def test_dropbox_handoff_is_idempotent():
    """Running handoff twice with same request_id should not create duplicate uploads."""
    require_dropbox_configured_via_app()
    ts = str(int(time.time()))
    with tempfile.TemporaryDirectory() as tmp:
        pack_dir = make_test_pack(Path(tmp))
        wav_paths = list(pack_dir.rglob("*.wav"))
        files = [{"relative_path": str(f.relative_to(pack_dir)), "size_bytes": f.stat().st_size,
                  "sha256": sha256_file(f), "mime_type": "audio/wav"} for f in wav_paths]

        s = requests.post(f"{API_BASE}/intake/sessions", json={
            "request_id": f"idem-{ts}", "submission_id": f"idem-s-{ts}",
            "creator_id": "creator-live", "pack_name": "Idempotent Test",
            "declared_top_level_folders": ["Loops", "OneShots"],
            "metadata": {"local_pack_path": str(pack_dir)},
        }, timeout=10)
        assert s.status_code == 200
        sid = s.json()["session"]["intake_session_id"]

        requests.put(f"{API_BASE}/intake/sessions/{sid}/manifest", json={
            "request_id": f"idem-man-{ts}", "files": files, "lock_manifest": True,
        }, timeout=10)

        handoff_payload = {
            "request_id": f"idem-hoff-{ts}", "intake_session_id": sid,
            "actor_id": "creator-live", "actor_role": "creator",
        }
        r1 = requests.post(
            f"{API_BASE}/intake/sessions/{sid}/handoff",
            json=handoff_payload,
            timeout=90,
        )
        r2 = requests.post(
            f"{API_BASE}/intake/sessions/{sid}/handoff",
            json=handoff_payload,
            timeout=90,
        )

    assert r1.status_code == 200
    assert r2.status_code == 200
    # Second call should be idempotent (same handoff_id returned)
    h1 = r1.json()["handoff"]
    h2 = r2.json()["handoff"]
    assert h1["handoff_id"] == h2["handoff_id"], "Idempotent request must return same handoff"
