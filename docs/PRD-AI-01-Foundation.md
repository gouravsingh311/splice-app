# [PRD-AI-01] SPLICE AI: Foundation & Real-Time Audio Pipeline

## 1. 🎯 Objective
Establish the core communication channel between the Electron application and the FastAPI backend for real-time audio streaming.

## 2. 🧱 Architecture
- **Electron (Main)**: Capture system/microphone audio using `desktopCapturer` or `navigator.mediaDevices`.
- **Preload Bridge**: Expose start/stop controls to the Renderer.
- **WebSocket (FastAPI)**: Persistent binary stream handler in Python.

## 3. 🧪 Core Features (Phase 1)
- **Audio Capture**:
    - Support for Microphone Input.
    - Initial support for System Audio (Desktop Capture).
    - Frequency: 100-200ms chunks.
- **Bi-Directional WebSocket**:
    - Send: Binary audio data.
    - Receive: Acknowledgment and connection status updates.
- **Security**:
    - Handshake validation using `X-Internal-Secret`.

## 4. 📈 Success Metrics
- Latency between audio capture and backend receipt < 100ms.
- 0% packet loss on local WebSocket connection.

## 5. 🛡️ Security
- No audio data stored on local disk during this phase.
- Memory buffering only.
