# Splice Desktop — Project Overview

A professional-grade desktop application built with a modern, security-focused architecture. Splice Desktop combines a React-based frontend with a powerful FastAPI backend, all wrapped in a hardened Electron shell.

## 🚀 Core Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Shell** | **Electron** (v40+) |
| **Frontend UI** | **React** + **Tailwind CSS v4** + **Flowbite** |
| **Backend API** | **FastAPI** (Python 3.12+) powered by **Uvicorn** |
| **Persistence** | **SQLite** (via `better-sqlite3` and `SQLAlchemy`) |
| **Search & AI** | **OpenAI**, **Milvus** (Vector DB), **Typesense** (Search) |
| **Validation** | **Zod** (Frontend) & **Pydantic v2** (Backend) |
| **Testing** | **Playwright** (E2E), **Storybook** (Component Dev), **Node Test Runner** |

---

## 🏗️ Architecture & Security Model

The application is designed with **Privacy-First** principles and a clear separation of concerns (Electron Main, Preload, and Renderer).

### 1. Hardened IPC & Sandbox
- **Context Isolation**: Enabled to prevent direct Node.js access from the renderer.
- **Secure Preload Bridge**: Uses `contextBridge` to expose only necessary APIs to the UI.
- **Window Security**: Strict `webPreferences` including `sandbox: true` and navigation guards.

### 2. Backend Communication
- **Shared Secret Auth**: Electron and FastAPI communicate over localhost using a shared secret (`X-Internal-Secret`). This ensures only the local Electron app can access the backend services.
- **Process Management**: Electron manages the lifecycle of the Python backend (starting it on boot and stopping it on exit).

### 3. Privacy-First Features
- **Presenter Mode**: A built-in feature to safely redact/mask sensitive information (API keys, PII) during screen sharing or demos.
- **Audit Logging**: Comprehensive system and user event logging for compliance and monitoring.

---

## 📂 Project Structure

- **`electron/`**: Electron "Main Process" logic, IPC routing, and security guards.
- **`apps/api/`**: FastAPI "Backend" source code.
    - `app/features/`: Domain-driven modules (Auth, QC, Submissions, Jobs, Audit).
    - `app/core/`: Shared infrastructure (DB sessions, Logging, Observability).
- **`src/`**: "Renderer Process" (Frontend).
    - `renderer.js` & `index.html`: Main entry points.
    - `styles/`: Tailwind CSS and Flowbite configurations.
- **`e2e/`**: Playwright test suites for both UI logic and API contract validation.
- **`scripts/`**: Automation scripts for bootstrapping, build pipelines, and parity checks.

---

## 👨‍💻 Developer Workflow

### Quick Start
1.  **Bootstrap**: `npm run bootstrap` (Sets up environments).
2.  **Dev Mode**: `npm start` (Starts Tailwind watcher and the Electron app).
3.  **Test**: `npm test` or `npm run test:e2e:core` (Executes the test suites).

### Core Scripts
- `npm run build:css`: Compiles Tailwind CSS.
- `npm run bootstrap:backend`: Initializes the Python backend environment.
- `npm run dist`: Packages the entire app for production using `electron-builder`.

### Observability
The app includes integrated **Sentry** (for error tracking) and a custom **Health Server** to monitor readiness and liveness of all internal components.
