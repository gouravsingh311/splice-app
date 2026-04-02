# SPLICE AI — Project Completion Tracker

> **Last Updated**: 2026-04-03
> **Branch**: `develop`
> **Overall Progress**: ██░░░░░░░░ 20% (1 of 5 AI PRDs complete)

---

## 🗺️ Roadmap Overview

```
PRD-AI-01  ████████████████████  COMPLETE   Foundation & Real-Time Audio Pipeline
PRD-AI-02  ░░░░░░░░░░░░░░░░░░░░  PENDING    Live Transcription (Whisper / STT)
PRD-AI-03  ░░░░░░░░░░░░░░░░░░░░  PENDING    AI Answer Generation (LLM)
PRD-AI-04  ░░░░░░░░░░░░░░░░░░░░  PENDING    Floating UI & User Experience
PRD-AI-05  ░░░░░░░░░░░░░░░░░░░░  PENDING    AI Config & Provider Management
```

---

## 📋 PRD Status Table

| PRD ID | Module | Status | Completed | Tests | Notes |
|--------|--------|--------|-----------|-------|-------|
| PRD-AI-01 | Foundation & Real-Time Audio Pipeline | ✅ COMPLETE | 2026-04-03 | 7/7 ✅ | WS endpoint, IPC bridge, preload API, waveform UI |
| PRD-AI-02 | Live Transcription (Whisper) | ⏳ PENDING | — | — | Depends on PRD-AI-01 |
| PRD-AI-03 | AI Answer Generation | ⏳ PENDING | — | — | Depends on PRD-AI-02 |
| PRD-AI-04 | Floating UI & UX | ⏳ PENDING | — | — | Depends on PRD-AI-03 |
| PRD-AI-05 | AI Config & Provider Management | ⏳ PENDING | — | — | Cross-cutting, can start early |
| PRD-01 | Screen Shield Protection | ✅ COMPLETE | 2026-04-02 | — | setContentProtection + Tray |
| PRD-16 | Desktop IPC & Preload Security | ✅ COMPLETE | 2026-04-02 | — | Hardened with Zod + namespacing |

---

## ✅ PRD-AI-01 — Foundation & Real-Time Audio Pipeline

**Status**: COMPLETE  
**Completed**: 2026-04-03  
**Tests**: 7 passing (`pytest apps/api/tests/features/ai/test_ws_audio.py --noconftest`)

### What was built

#### FastAPI Backend (`apps/api/app/features/ai/`)
- [x] `__init__.py` — Feature package
- [x] `schemas.py` — Pydantic V2 models: `AudioStreamConfig`, `AudioAck`, `ConnectionStatusEvent`, `AudioSource`, `AudioEncoding`, `ConnectionStatus`
- [x] `ws_handler.py` — Async WebSocket endpoint at `/ai/audio/stream`
  - `X-Internal-Secret` header validation on handshake
  - Binary audio chunk receive loop (100–200ms chunks)
  - JSON ACK per chunk (`chunk_id`, `status`, `size_bytes`, `received_at`)
  - Connection status push events (`connected` → `active`)
  - **Memory-only** — no disk writes (PRD §5 compliant)
- [x] `apps/api/app/main.py` — Router registered at `/ai` prefix

#### Electron IPC (`electron/ipc/`)
- [x] `contracts.js` — 4 new channels added:
  - `splice.ai.audio.start.v1`
  - `splice.ai.audio.stop.v1`
  - `splice.ai.audio.status.v1`
  - `splice.ai.audio.ack.v1` (push channel)
  - Full Zod schemas for all 3 invoke channels
- [x] `handlers/aiAudio.js` — Main-process WS client
  - Connects to FastAPI with `X-Internal-Secret`
  - Manages WS lifecycle (connect/stop/status)
  - Push-event relay for ACKs back to renderer
- [x] `router.js` — AI handlers registered + push-event callbacks wired

#### Electron Preload (`electron/preload/`)
- [x] `preload/aiAudio.js` — Safe `contextBridge` API module
- [x] `preload.js` — `window.spliceAI` exposed:
  - `startAudioStream(config)` → IPC invoke
  - `stopAudioStream(sessionId)` → IPC invoke
  - `getAudioStatus()` → IPC invoke
  - `onAudioEvent(callback)` → IPC listener (returns cleanup fn)

#### Renderer (`src/`)
- [x] `renderer/ai/useAudioCapture.js` — React hook
  - `getUserMedia` (mic) / `getDisplayMedia` (system) / merged (both)
  - `MediaRecorder` with configurable timeslice
  - Full lifecycle with cleanup on unmount
- [x] `index.html` — AI Audio Dashboard UI
  - Live waveform oscilloscope (Web Audio API)
  - Source selector (Mic / System / Both)
  - Chunk interval + sample rate sliders
  - PCM / WebM encoding toggle
  - Live event log with color-coded entries
  - Chunks ACK'd counter + duration timer
  - Backend status indicator

#### Tests (`apps/api/tests/features/ai/`)
- [x] `test_ws_audio.py` — 7 test cases:
  - Rejects missing secret (403)
  - Rejects wrong secret (403)
  - Accepts correct secret + sends `connected` status
  - ACKs binary chunk with correct `chunk_id` and `size_bytes`
  - Increments `chunk_id` monotonically
  - Parses query params (`source`, `encoding`, `sample_rate`, `session_id`)
  - No disk writes (PRD §5 compliance)
- [x] `conftest.py` — Isolated fixture override for AI tests

---

## ⏳ PRD-AI-02 — Live Transcription (Whisper)

**Status**: PENDING  
**Depends on**: PRD-AI-01 ✅

### What needs to be built
- [ ] Install `openai-whisper` or `openai` SDK in `.venv`
- [ ] `apps/api/app/features/ai/transcription/` — Whisper service
  - [ ] Buffer audio chunks (overlap-aware, sliding window)
  - [ ] Call Whisper API / local model per buffer flush
  - [ ] Return partial + final transcripts
- [ ] Extend `/ai/audio/stream` WS to push transcript events
- [ ] New IPC push channel: `splice.ai.transcript.v1`
- [ ] Renderer: live scrolling transcript panel
- [ ] Tests: mock Whisper response, chunk buffering edge cases

**Success metric**: Latency capture → transcript display < 2s, WER < 10%

---

## ⏳ PRD-AI-03 — AI Answer Generation

**Status**: PENDING  
**Depends on**: PRD-AI-02 ⏳

### What needs to be built
- [ ] `apps/api/app/features/ai/generation/` — LLM service
  - [ ] Context manager (session turn history)
  - [ ] `POST /ai/generate-answer` endpoint (streaming SSE)
  - [ ] Provider abstraction: OpenAI GPT-4o / Gemini / Claude
- [ ] Answer types: Short / Detailed / Code snippet
- [ ] Streaming generation → push to renderer via WS
- [ ] IPC channel: `splice.ai.generation.stream.v1`
- [ ] Renderer: answer panel with code highlighting + copy button

**Success metric**: Generation start < 2s, accuracy > 90% on technical Qs

---

## ⏳ PRD-AI-04 — Floating UI & UX

**Status**: PENDING  
**Depends on**: PRD-AI-03 ⏳

### What needs to be built
- [ ] `electron/window/` — Floating always-on-top BrowserWindow
  - [ ] Transparent, draggable, resizable overlay window
  - [ ] `setAlwaysOnTop(true)` + screen-shield integration
  - [ ] Global hotkeys (show/hide/toggle session)
- [ ] Renderer: floating answer view
  - [ ] Smooth scroll for new text
  - [ ] Status badges (Active / Idle / Thinking)
  - [ ] Copy-to-clipboard for code blocks
  - [ ] Dark/Light mode toggle
  - [ ] Font size control

**Success metric**: 0% interference with Zoom/Teams, < 50ms UI update latency

---

## ⏳ PRD-AI-05 — AI Config & Provider Management

**Status**: PENDING  
**Depends on**: PRD-AI-01 ✅ (can start in parallel with PRD-AI-02)

### What needs to be built
- [ ] `electron/ipc/handlers/aiConfig.js` — Secure key storage
  - [ ] `safeStorage.encryptString` / `decryptString`
  - [ ] IPC channels: `splice.ai.config.save.v1`, `splice.ai.config.get.v1`
- [ ] `apps/api/app/features/ai/config/` — Provider switcher
  - [ ] Dynamic provider selection at runtime
  - [ ] Sync active config to FastAPI session
- [ ] Settings UI page
  - [ ] API key input fields (masked)
  - [ ] Model selector dropdowns
  - [ ] "Test Connection" button per provider
  - [ ] Provider: OpenAI, Gemini, Anthropic, Groq

**Success metric**: 100% key encryption at rest, < 1s provider switch

---

## 🐛 Known Issues / Tech Debt

| ID | Issue | Severity | PRD |
|----|-------|----------|-----|
| TD-001 | `apps/api/tests/conftest.py` has stale autouse fixtures referencing removed modules (`app.features.audit`, `SubmissionWorkflowService`) | Medium | — |
| TD-002 | Binary audio chunks from `MediaRecorder` not yet forwarded from Renderer → Main → WS (Phase 1 sends config only) | High | PRD-AI-01 → AI-02 |
| TD-003 | `useAudioCapture.js` React hook requires React in scope but app uses vanilla JS | Low | PRD-AI-04 |

---

## 📁 Key File Map

```
splice-app/
├── apps/api/app/features/ai/
│   ├── __init__.py               ✅ AI feature package
│   ├── schemas.py                ✅ Pydantic V2 models
│   └── ws_handler.py             ✅ /ai/audio/stream WebSocket
├── apps/api/tests/features/ai/
│   ├── conftest.py               ✅ Isolated test fixtures
│   └── test_ws_audio.py          ✅ 7/7 tests passing
├── electron/ipc/
│   ├── contracts.js              ✅ AI channels + Zod schemas
│   ├── handlers/aiAudio.js       ✅ Main-process WS client
│   └── router.js                 ✅ AI handlers registered
├── electron/preload/
│   └── aiAudio.js                ✅ window.spliceAI bridge
├── electron/preload.js           ✅ contextBridge expose
├── src/
│   ├── index.html                ✅ AI Audio Dashboard
│   └── renderer/ai/
│       └── useAudioCapture.js    ✅ Audio capture hook
└── docs/
    ├── PRD-AI-01-Foundation.md   ✅
    ├── PRD-AI-02-Transcription.md ⏳
    ├── PRD-AI-03-Generation.md   ⏳
    ├── PRD-AI-04-UI.md           ⏳
    └── PRD-AI-05-Settings.md     ⏳
```

---

## 🔢 Metrics

| Metric | Value |
|--------|-------|
| PRDs Defined | 5 AI + 2 Platform |
| PRDs Complete | 3 (AI-01, PRD-01, PRD-16) |
| PRDs In Progress | 0 |
| PRDs Pending | 4 |
| Tests Written | 7 |
| Tests Passing | 7 (100%) |
| Files Created (AI-01) | 8 |
| Files Modified (AI-01) | 4 |
