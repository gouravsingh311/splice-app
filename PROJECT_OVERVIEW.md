# SPLICE — Project Overview

A professional-grade desktop application shell built with a security-focused architecture. **SPLICE** (formerly *fileestares*) provides a clean, hardened foundation combining an Electron frontend with a FastAPI backend.



## 🚀 Core Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Shell** | **Electron** |
| **Frontend UI** | **Vanilla HTML** + **Tailwind CSS v4** |
| **Backend API** | **FastAPI** (Python 3.12+) |
| **Persistence** | **SQLite** (via SQLAlchemy & better-sqlite3) |
| **Security** | **CSC**, **Context Isolation**, **Sandbox Mode** |

---

## 🏗️ Architecture & Security Model

The application follows strict **Privacy-First** principles and maintains a clear boundary between the frontend renderer and the backend services.

### 1. Hardened Electron Shell
*   **Context Isolation & Sandboxing**: Enabled by default to prevent direct Node.js access from the UI.
*   **Secure Preload Bridge**: A restricted set of APIs is exposed to the renderer via `contextBridge` in `electron/preload.js`.
*   **Content Security Policy (CSP)**: Strict headers are implemented in `src/index.html` to prevent XSS and unauthorized data exfiltration.

### 2. Backend Communication
*   **Shared Secret Auth**: All communication between Electron and the FastAPI backend is secured using an internal shared secret (`X-Internal-Secret`).
*   **Lifecycle Management**: The Electron main process automatically manages the Python backend process (starting it on boot and terminating it on exit).
*   **Health Monitoring**: A dedicated health server tracks the readiness of both the Electron app and the Python backend.

---

## 📂 Project Structure

*   **`electron/`**: Main process logic.
    *   `main.js`: Entry point, manages window and backend lifecycle.
    *   `ipc/`: IPC routing and request handling.
    *   `security/`: Window security guards and CSP enforcement.
*   **`apps/api/`**: FastAPI "Backend" (Python).
    *   `app/main.py`: API entry point with health and version endpoints.
    *   `app/core/`: Database initialization and logging utilities.
*   **`src/`**: "Renderer Process" (Frontend).
    *   `index.html`: Main UI structure.
    *   `renderer.js`: Frontend logic.
    *   `styles/`: Tailwind CSS configuration and styles.
*   **`data/`**: Local data persistence (SQLite datasets).
*   **`scripts/`**: Automation for bootstrapping and environment setup.

---

## 👨‍💻 Developer Workflow

### Quick Start
1.  **Environment Setup**: Ensure Python 3.12+ and Node.js are installed.
2.  **Bootstrap**: Use `npm run bootstrap` to set up virtual environments and dependencies.
3.  **Start App**: Run `npm start` to launch the application.

### Core Commands
*   `npm start`: Runs the Tailwind watcher and launches the Electron app.
*   `npm run build:css`: Compiles Tailwind CSS for the frontend.
*   `npm run test:e2e:core`: Runs Playwright E2E tests for core connectivity.

---

## 🛡️ Privacy & Security Features
*   **Screen Shield**: (Conditional) Anti-capture and taskbar-skip functionality can be enabled via configuration.
*   **Permission Guards**: Strict control over web permissions (camera, microphone, etc.).
*   **Audit Logging**: JSON-formatted logs for both Electron and FastAPI processes.
