# `apps/electron` Scaffold

This directory is reserved for the Electron app workspace as PRD modules are incrementally migrated from the root shell.

Current state:
- The runnable Electron app remains at repository root (`electron/`, `src/`, `test/`) for Wave 0 stability.
- New module features should target this workspace boundary as migration proceeds.
- PRD-01 desktop auth UI currently lives in root renderer (`src/index.html`, `src/renderer.js`) and is wired through preload IPC contracts.

Planned migration targets:
- Move renderer and preload source into `apps/electron/src`.
- Keep secure defaults (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Keep preload-only API bridge with namespaced contracts.

## Local Validation Commands (Current Root Workspace)

The active Electron runtime/test commands still execute from repository root.

- `npm test`
- `npm run build:css`
- `npm start`
- `npm run test:e2e`

Playwright E2E helpers:

- `npm run test:e2e:install` to install browser binaries.
- `npm run test:e2e` to run API + Electron E2E coverage.

## PRD-01 Auth UI Validation (Current Root Runtime)

1. Start backend:
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
   - `python -m pip install -e "apps/api[dev]"`
   - `python -m uvicorn app.main:app --host 127.0.0.1 --port 8017 --app-dir apps/api`
2. Start desktop app (separate terminal):
   - `npm start`
3. In the app, verify:
   - login tab renders validation and lockout/error messages on failed auth attempts.
   - register tab supports OTP send -> OTP verify -> create account flow.
   - forgot/reset tab supports OTP send -> OTP verify -> reset password flow.
4. Run automated checks:
   - `npm test`
   - `npm run build:css`
