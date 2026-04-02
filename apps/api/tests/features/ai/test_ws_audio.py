"""Tests for AI WebSocket audio stream endpoint (PRD-AI-01)."""

from __future__ import annotations

import json
import os
import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from app.main import app

_TEST_SECRET = "test-internal-secret-abc123"


@pytest.fixture(autouse=True)
def set_internal_secret(monkeypatch):
    """Set SPLICE_INTERNAL_SECRET for all tests in this module."""
    monkeypatch.setenv("SPLICE_INTERNAL_SECRET", _TEST_SECRET)


@pytest.fixture()
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Handshake validation
# ---------------------------------------------------------------------------


def test_ws_rejects_missing_secret(client: TestClient):
    """WebSocket should reject connections without the internal secret header."""
    with pytest.raises(Exception):
        with client.websocket_connect("/ai/audio/stream") as ws:
            ws.receive_text()  # Should never reach here


def test_ws_rejects_wrong_secret(client: TestClient):
    """WebSocket should reject connections with an incorrect secret."""
    with pytest.raises(Exception):
        with client.websocket_connect(
            "/ai/audio/stream",
            headers={"X-Internal-Secret": "wrong-secret"},
        ) as ws:
            ws.receive_text()


def test_ws_accepts_correct_secret(client: TestClient):
    """WebSocket should accept connections with the correct internal secret."""
    with client.websocket_connect(
        "/ai/audio/stream",
        headers={"X-Internal-Secret": _TEST_SECRET},
    ) as ws:
        # Should receive "connected" status event immediately
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["event"] == "connection_status"
        assert msg["status"] == "connected"


# ---------------------------------------------------------------------------
# Binary chunk receive + ACK
# ---------------------------------------------------------------------------


def test_ws_acks_binary_chunk(client: TestClient):
    """Backend should send an ACK for every binary audio chunk received."""
    fake_audio = b"\x00\x01\x02\x03" * 400  # 1600 bytes of fake PCM

    with client.websocket_connect(
        "/ai/audio/stream",
        headers={"X-Internal-Secret": _TEST_SECRET},
    ) as ws:
        # Consume connected event
        ws.receive_text()

        # Send one binary chunk
        ws.send_bytes(fake_audio)

        # Receive ACK
        raw = ws.receive_text()
        ack = json.loads(raw)
        assert ack["chunk_id"] == 1
        assert ack["status"] == "received"
        assert ack["size_bytes"] == len(fake_audio)

        # After first chunk → "active" status event
        raw2 = ws.receive_text()
        status_evt = json.loads(raw2)
        assert status_evt["event"] == "connection_status"
        assert status_evt["status"] == "active"


def test_ws_increments_chunk_id(client: TestClient):
    """chunk_id should monotonically increment for each chunk sent."""
    chunk = b"\xff" * 320

    with client.websocket_connect(
        "/ai/audio/stream",
        headers={"X-Internal-Secret": _TEST_SECRET},
    ) as ws:
        ws.receive_text()  # connected

        ws.send_bytes(chunk)
        ack1 = json.loads(ws.receive_text())
        ws.receive_text()  # active status

        ws.send_bytes(chunk)
        ack2 = json.loads(ws.receive_text())

        assert ack1["chunk_id"] == 1
        assert ack2["chunk_id"] == 2


# ---------------------------------------------------------------------------
# Config via query params
# ---------------------------------------------------------------------------


def test_ws_accepts_query_params(client: TestClient):
    """WebSocket should parse source/encoding/sample_rate query params."""
    url = "/ai/audio/stream?source=system&encoding=webm_opus&sample_rate=44100&chunk_ms=200&session_id=test-sess"

    with client.websocket_connect(
        url,
        headers={"X-Internal-Secret": _TEST_SECRET},
    ) as ws:
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["status"] == "connected"
        assert msg.get("session_id") == "test-sess"


# ---------------------------------------------------------------------------
# Memory safety — no disk writes (structural test)
# ---------------------------------------------------------------------------


def test_ws_no_disk_writes(client: TestClient, tmp_path, monkeypatch):
    """Receiving audio chunks should not create any new files in the working directory."""
    before = set(tmp_path.iterdir())

    with client.websocket_connect(
        "/ai/audio/stream",
        headers={"X-Internal-Secret": _TEST_SECRET},
    ) as ws:
        ws.receive_text()
        ws.send_bytes(b"\x00" * 2048)
        ws.receive_text()  # ACK
        ws.receive_text()  # active

    after = set(tmp_path.iterdir())
    assert before == after, "Audio handler wrote files to disk — PRD §5 violation"
