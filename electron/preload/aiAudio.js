/**
 * aiAudio.js — Preload bridge for SPLICE AI Audio Streaming (PRD-AI-01).
 *
 * Exposes window.spliceAI to the renderer via contextBridge.
 * All audio chunk sending is done in the renderer using MediaRecorder,
 * then forwarded through IPC to the Main process WebSocket.
 *
 * Security:
 *  - No Node.js APIs exposed directly (contextIsolation = true)
 *  - All channel names are hardcoded — no dynamic channel access
 */

"use strict";

const { ipcRenderer } = require("electron");

const AI_CHANNELS = Object.freeze({
  START:  "splice.ai.audio.start.v1",
  STOP:   "splice.ai.audio.stop.v1",
  STATUS: "splice.ai.audio.status.v1",
  ACK:    "splice.ai.audio.ack.v1",
});

/**
 * Start an audio stream session.
 * @param {object} config
 * @param {string} [config.source="mic"] - "mic" | "system" | "both"
 * @param {number} [config.sampleRate=16000]
 * @param {number} [config.chunkMs=100]
 * @param {string} [config.encoding="pcm_float32"]
 * @param {string} [config.sessionId]
 * @returns {Promise<{status: string, sessionId: string}>}
 */
async function startAudioStream(config = {}) {
  return ipcRenderer.invoke(AI_CHANNELS.START, config);
}

/**
 * Stop the active audio stream.
 * @returns {Promise<{stopped: boolean, chunksReceived: number}>}
 */
async function stopAudioStream(sessionId) {
  return ipcRenderer.invoke(AI_CHANNELS.STOP, { sessionId: sessionId || undefined });
}

/**
 * Get the current WebSocket connection status.
 * @returns {Promise<{state: string, sessionId: string|null, chunksReceived: number}>}
 */
async function getAudioStatus() {
  return ipcRenderer.invoke(AI_CHANNELS.STATUS, {});
}

/**
 * Register a callback for ACK + status push events from Main.
 * The callback receives the raw event payload.
 * @param {(event: Electron.IpcRendererEvent, msg: object) => void} callback
 * @returns {() => void} Cleanup function to remove the listener
 */
function onAudioEvent(callback) {
  ipcRenderer.on(AI_CHANNELS.ACK, callback);
  return () => ipcRenderer.removeListener(AI_CHANNELS.ACK, callback);
}

const spliceAIBridge = {
  startAudioStream,
  stopAudioStream,
  getAudioStatus,
  onAudioEvent,
};

module.exports = { spliceAIBridge };
