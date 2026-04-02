"""Pydantic V2 schemas for the AI audio streaming feature."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AudioSource(str, Enum):
    """Audio capture source type."""

    MICROPHONE = "mic"
    SYSTEM = "system"
    BOTH = "both"


class AudioEncoding(str, Enum):
    """Binary encoding of the audio payload."""

    PCM_FLOAT32 = "pcm_float32"  # Raw 32-bit float PCM (default, lowest latency)
    WEBM_OPUS = "webm_opus"  # Compressed WebM/Opus from MediaRecorder


class ConnectionStatus(str, Enum):
    """WebSocket lifecycle states sent to the client."""

    CONNECTED = "connected"
    ACTIVE = "active"
    ERROR = "error"
    CLOSED = "closed"


# ---------------------------------------------------------------------------
# Client → Server (metadata carried in JSON frames)
# ---------------------------------------------------------------------------


class AudioStreamConfig(BaseModel):
    """Sent by Electron before the binary stream begins."""

    model_config = ConfigDict(frozen=True)

    source: AudioSource = AudioSource.MICROPHONE
    sample_rate: int = Field(default=16000, ge=8000, le=48000, description="Hz")
    chunk_ms: int = Field(
        default=100,
        ge=50,
        le=500,
        description="Target chunk duration in milliseconds",
    )
    encoding: AudioEncoding = AudioEncoding.PCM_FLOAT32
    session_id: str = Field(
        default="",
        description="Optional client-side session identifier for correlation",
    )


# ---------------------------------------------------------------------------
# Server → Client
# ---------------------------------------------------------------------------


class AudioAck(BaseModel):
    """Acknowledgment returned for every received binary chunk."""

    model_config = ConfigDict(frozen=True)

    chunk_id: int = Field(description="Monotonically increasing chunk sequence number")
    status: Literal["received"] = "received"
    received_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="UTC timestamp of backend receipt",
    )
    size_bytes: int = Field(description="Raw size of the binary payload received")


class ConnectionStatusEvent(BaseModel):
    """Lifecycle event pushed to the client when WS state changes."""

    model_config = ConfigDict(frozen=True)

    event: Literal["connection_status"] = "connection_status"
    status: ConnectionStatus
    session_id: str = ""
    message: str = ""
    ts: datetime = Field(default_factory=datetime.utcnow)
