"""WebSocket handler for real-time binary audio streaming.

Design rules (PRD-AI-01):
- Validates X-Internal-Secret on handshake → reject with 403 if invalid.
- Accepts binary audio frames in 100-200ms chunks (raw PCM Float32 default).
- Returns JSON ACK per chunk to the client.
- NEVER writes audio data to disk — memory-only buffers.
- Gracefully handles disconnect and malformed frames.
"""

from __future__ import annotations

import json
from os import environ
from time import monotonic

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.logging import get_logger
from app.features.ai.schemas import (
    AudioAck,
    AudioEncoding,
    AudioSource,
    AudioStreamConfig,
    ConnectionStatus,
    ConnectionStatusEvent,
)

logger = get_logger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_EXPECTED_SECRET_ENV = "SPLICE_INTERNAL_SECRET"


def _get_internal_secret() -> str | None:
    """Read the expected internal secret from environment (set by Electron at startup)."""
    raw = environ.get(_EXPECTED_SECRET_ENV, "").strip()
    return raw if raw else None


def _validate_handshake(websocket: WebSocket) -> tuple[bool, str]:
    """Check the X-Internal-Secret header against the expected value.

    Returns (is_valid, reason).
    """
    expected = _get_internal_secret()
    if not expected:
        # No secret configured — allow all (dev environments without secret)
        logger.warning(
            "No SPLICE_INTERNAL_SECRET set; WebSocket auth disabled.",
        )
        return True, "no_secret_configured"

    provided = websocket.headers.get("X-Internal-Secret", "").strip()
    if not provided:
        return False, "missing_header"

    if provided != expected:
        return False, "invalid_secret"

    return True, "ok"


async def _send_status(
    websocket: WebSocket,
    status: ConnectionStatus,
    session_id: str = "",
    message: str = "",
) -> None:
    """Push a connection status event to the client as JSON."""
    event = ConnectionStatusEvent(status=status, session_id=session_id, message=message)
    await websocket.send_text(event.model_dump_json())


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@router.websocket("/audio/stream")
async def audio_stream(
    websocket: WebSocket,
    source: AudioSource = Query(default=AudioSource.MICROPHONE),
    encoding: AudioEncoding = Query(default=AudioEncoding.PCM_FLOAT32),
    sample_rate: int = Query(default=16000, ge=8000, le=48000),
    chunk_ms: int = Query(default=100, ge=50, le=500),
    session_id: str = Query(default=""),
) -> None:
    """Accept and process a real-time binary audio stream from Electron.

    Protocol:
        1. Electron connects with X-Internal-Secret header + query params for config.
        2. Server validates the secret; closes with 403 if invalid.
        3. Server sends ``connection_status: connected`` event.
        4. Electron sends binary frames (raw PCM Float32 or WebM/Opus).
        5. Server sends ``AudioAck`` JSON for each frame.
        6. Either side may close normally at any time.
    """
    # --- Handshake validation BEFORE accepting ---
    is_valid, reason = _validate_handshake(websocket)
    if not is_valid:
        logger.warning(
            "WebSocket connection rejected — invalid internal secret.",
            extra={"reason": reason, "client": websocket.client},
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    config = AudioStreamConfig(
        source=source,
        sample_rate=sample_rate,
        chunk_ms=chunk_ms,
        encoding=encoding,
        session_id=session_id,
    )

    logger.info(
        "Audio stream WebSocket connected.",
        extra={
            "session_id": session_id,
            "source": source,
            "encoding": encoding,
            "sample_rate": sample_rate,
            "chunk_ms": chunk_ms,
        },
    )

    # Notify client that we are ready to receive
    await _send_status(websocket, ConnectionStatus.CONNECTED, session_id, "ready")

    chunk_counter = 0
    total_bytes = 0
    started_at = monotonic()

    try:
        while True:
            # Receive binary frame — audio chunk from Electron/MediaRecorder
            raw: bytes = await websocket.receive_bytes()

            chunk_counter += 1
            total_bytes += len(raw)

            # Memory-only processing — PRD §5: no disk writes
            # Future: pass `raw` to STT / AI pipeline here
            ack = AudioAck(chunk_id=chunk_counter, size_bytes=len(raw))
            await websocket.send_text(ack.model_dump_json())

            if chunk_counter == 1:
                # Upgrade status to "active" after first chunk received
                await _send_status(
                    websocket,
                    ConnectionStatus.ACTIVE,
                    session_id,
                    "streaming",
                )

            logger.debug(
                "Audio chunk received.",
                extra={
                    "chunk_id": chunk_counter,
                    "size_bytes": len(raw),
                    "session_id": session_id,
                },
            )

    except WebSocketDisconnect as exc:
        duration_ms = round((monotonic() - started_at) * 1000, 1)
        logger.info(
            "Audio stream WebSocket disconnected.",
            extra={
                "session_id": session_id,
                "code": exc.code,
                "chunks_received": chunk_counter,
                "total_bytes": total_bytes,
                "duration_ms": duration_ms,
            },
        )

    except Exception:
        logger.exception(
            "Unexpected error in audio stream WebSocket.",
            extra={"session_id": session_id, "chunk_id": chunk_counter},
        )
        try:
            await _send_status(
                websocket,
                ConnectionStatus.ERROR,
                session_id,
                "internal_error",
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass  # Already disconnected
