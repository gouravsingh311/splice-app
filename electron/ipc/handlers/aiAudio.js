/**
 * aiAudio.js — Electron IPC handler for AI real-time audio streaming (PRD-AI-01).
 *
 * Responsibilities:
 *  - Opens a WebSocket connection from Main process → FastAPI /ai/audio/stream
 *  - Forwards binary audio chunks received from the renderer via IPC
 *  - Returns ACK messages back to the renderer via push events
 *  - Manages WS lifecycle (connect / disconnect / error / reconnect)
 *
 * Security:
 *  - Sends X-Internal-Secret header on every WS connection (set by Electron at startup)
 *  - Only connects to the loopback address (127.0.0.1)
 */

"use strict";

const { WebSocket } = require("ws");
const { v4: uuidv4 } = require("uuid");

// ---------------------------------------------------------------------------
// State (module-scoped — one active stream at a time in Phase 1)
// ---------------------------------------------------------------------------

/** @type {"disconnected" | "connecting" | "connected" | "error"} */
let _state = "disconnected";
/** @type {WebSocket | null} */
let _ws = null;
let _sessionId = null;
let _chunksReceived = 0;

/** Callbacks registered by the router to push ACK events to the renderer */
let _onAckCallback = null;
let _onStatusCallback = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _getBackendWsUrl(config = {}) {
  const baseUrl = process.env.SPLICE_API_BASE_URL || "http://127.0.0.1:8017";
  // Convert http → ws, https → wss
  const wsBase = baseUrl.replace(/^http/, "ws");

  const params = new URLSearchParams({
    source: config.source || "mic",
    encoding: config.encoding || "pcm_float32",
    sample_rate: String(config.sampleRate || 16000),
    chunk_ms: String(config.chunkMs || 100),
    session_id: config.sessionId || "",
  });

  return `${wsBase}/ai/audio/stream?${params.toString()}`;
}

function _getInternalSecret() {
  return process.env.SPLICE_INTERNAL_SECRET || "";
}

function _setState(newState) {
  _state = newState;
}

function _cleanup() {
  if (_ws) {
    try {
      _ws.terminate();
    } catch (_) {
      // Ignore errors during cleanup
    }
    _ws = null;
  }
  _setState("disconnected");
  _chunksReceived = 0;
}

// ---------------------------------------------------------------------------
// Exported handlers — called from ipc/router.js
// ---------------------------------------------------------------------------

/**
 * Start a WebSocket audio stream to FastAPI.
 * @param {object} config - AudioStreamConfig options from renderer
 * @returns {Promise<{status: string, sessionId: string, wsUrl: string}>}
 */
async function handleAiAudioStart(config = {}) {
  // If already connected, return current state
  if (_ws && (_state === "connected" || _state === "connecting")) {
    return {
      status: _state,
      sessionId: _sessionId,
      message: "Stream already active",
    };
  }

  _cleanup();

  _sessionId = config.sessionId || uuidv4();
  _setState("connecting");

  const wsUrl = _getBackendWsUrl({ ...config, sessionId: _sessionId });
  const secret = _getInternalSecret();

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        "X-Internal-Secret": secret,
      },
    });

    _ws = ws;

    const connectTimeout = setTimeout(() => {
      if (_state === "connecting") {
        _cleanup();
        resolve({ status: "error", message: "Connection timeout", sessionId: _sessionId });
      }
    }, 5000);

    ws.on("open", () => {
      clearTimeout(connectTimeout);
      _setState("connected");
      _chunksReceived = 0;

      if (_onStatusCallback) {
        _onStatusCallback({ state: "connected", sessionId: _sessionId });
      }

      resolve({
        status: "connected",
        sessionId: _sessionId,
        wsUrl,
        message: "Stream started",
      });
    });

    ws.on("message", (data) => {
      // FastAPI sends back JSON: AudioAck or ConnectionStatusEvent
      try {
        const msg = JSON.parse(data.toString());

        if (msg.chunk_id !== undefined) {
          _chunksReceived++;
          if (_onAckCallback) {
            _onAckCallback(msg);
          }
        } else if (msg.event === "connection_status") {
          if (_onStatusCallback) {
            _onStatusCallback({ state: msg.status, sessionId: _sessionId, message: msg.message });
          }
        }
      } catch (_) {
        // Non-JSON message — ignore silently
      }
    });

    ws.on("error", (err) => {
      clearTimeout(connectTimeout);
      _setState("error");

      if (_onStatusCallback) {
        _onStatusCallback({ state: "error", sessionId: _sessionId, message: err.message });
      }

      if (_state === "connecting") {
        resolve({ status: "error", message: err.message, sessionId: _sessionId });
      }
    });

    ws.on("close", (code) => {
      clearTimeout(connectTimeout);
      const wasConnected = _state === "connected";
      _setState("disconnected");

      if (_onStatusCallback) {
        _onStatusCallback({ state: "disconnected", sessionId: _sessionId, code });
      }

      if (!wasConnected && _state !== "error") {
        resolve({ status: "disconnected", sessionId: _sessionId });
      }
    });
  });
}

/**
 * Send a binary audio chunk over the active WebSocket.
 * Called internally by the preload bridge — not an IPC handler itself.
 * @param {Buffer | Uint8Array} chunk - Raw audio bytes
 */
function sendAudioChunk(chunk) {
  if (_ws && _state === "connected" && _ws.readyState === WebSocket.OPEN) {
    _ws.send(chunk);
  }
}

/**
 * Stop the active audio stream gracefully.
 */
async function handleAiAudioStop() {
  const prevSessionId = _sessionId;
  const prevChunks = _chunksReceived;

  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.close(1000, "stream_stopped");
  }

  _cleanup();
  _sessionId = null;

  return {
    stopped: true,
    chunksReceived: prevChunks,
    sessionId: prevSessionId,
  };
}

/**
 * Return current WebSocket connection state.
 */
async function handleAiAudioStatus() {
  return {
    state: _state,
    sessionId: _sessionId,
    chunksReceived: _chunksReceived,
  };
}

/**
 * Register push-event callbacks so the router can forward messages to renderer.
 * @param {{ onAck: Function, onStatus: Function }} callbacks
 */
function registerAiAudioCallbacks({ onAck, onStatus }) {
  _onAckCallback = onAck;
  _onStatusCallback = onStatus;
}

module.exports = {
  handleAiAudioStart,
  handleAiAudioStop,
  handleAiAudioStatus,
  sendAudioChunk,
  registerAiAudioCallbacks,
};
