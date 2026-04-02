# Electron Development Best Practices

## Scope
- This repository is an Electron desktop app using Tailwind CSS and Flowbite in the renderer.
- Keep a strict boundary between `main` (privileged), `preload` (bridge), and `renderer` (untrusted UI).

## Architecture Rules
- `electron/main.js` owns lifecycle, windows, and native APIs.
- `electron/preload.js` exposes a minimal, typed API surface via `contextBridge`.
- Renderer code must never call Node or Electron APIs directly.
- Keep IPC channels explicit, namespaced, and documented close to handlers.

## Security Defaults
- Always keep `contextIsolation: true` and `nodeIntegration: false`.
- Prefer `sandbox: true` unless a feature requires otherwise.
- Validate and sanitize all IPC input in `main`.
- Never expose raw `ipcRenderer` to `window`.
- Avoid loading remote content; if required, lock down CSP and navigation rules.
- **Privacy Shield (PRD-01)**: Enable `setContentProtection(true)` for the main window when the user toggles it on Windows/macOS. Always audit-log state changes.
- **Taskbar Visibility**: When Privacy Shield is enabled, use `setSkipTaskbar(true)` to prevent OS-level previews.
- **System Tray Recovery**: If `skipTaskbar` is enabled, the application MUST provide a System Tray icon for users to restore and focus the window.

## Styling and UI
- Use Tailwind utility classes as the default styling path.
- Use Flowbite components for common interactive patterns before building custom UI.
- Keep shared design tokens in Tailwind config instead of one-off color values.
- Ensure responsive behavior for laptop and desktop viewports.

## Testing Expectations
- Unit-test pure logic with `node:test` (or approved test framework) under `test/`.
- Add IPC contract tests for serialization/validation logic when channels are added.
- Add smoke tests for critical window boot paths and preload contract.
- Every bug fix should include a test that fails before the fix and passes after it.
- Minimum CI quality gate: tests pass and app boots without runtime errors.

## Clean Code Standards
- Keep modules focused and small; split files when responsibilities diverge.
- Prefer explicit names over short names; avoid ambiguous abbreviations.
- Handle errors intentionally and include actionable messages.
- Remove dead code and stale TODOs before merging.
- Keep comments concise and only for non-obvious decisions.

## Commit Management
- Work in short-lived branches from `main`.
- Make atomic commits with one clear purpose each.
- Use imperative commit subjects, e.g. `feat: add preload API for app versions`.
- Reference issues/tasks in commit bodies when applicable.
- Avoid mixing refactors with feature changes unless required.
- Rebase or merge frequently to reduce long-running drift.

## Pull Request Checklist
- `npm test` passes locally.
- `npm run build:css` produces expected output.
- Manual sanity check: `npm start` launches and UI interactions work.
- Security-sensitive changes include rationale in PR description.
- Update docs when commands, architecture, or conventions change.

## Task Orchestration (PRD-Driven)

### Mandatory Planning Inputs
- Before implementation, read:
  - `docs/module-dependency-map.md`
  - `docs/phase-1-prd-fastapi-electron.md`
  - The specific module PRD(s) in `docs/modules/` touched by the task.
- Every task must declare:
  - Primary module(s): `PRD-XX`
  - Upstream dependency modules referenced from `docs/module-dependency-map.md`
  - Whether task is single-module or cross-module

### Module Boundary Rules
- Keep changes inside declared module boundaries.
- Cross-module changes are allowed only when interface contracts require them.
- If crossing boundaries, include a `Cross-Module Impact` note in handoff with:
  - impacted `PRD-XX`
  - interface/event/schema changed
  - compatibility/risk notes
- Treat these as cross-cutting modules by default:
  - `PRD-01 Screen Shield Protection` (Status: `COMPLETED`, Date: `2026-04-02`)
- `PRD-11 Audit & Compliance Log`
  - `PRD-15 Observability & Error Monitoring`
- For desktop work, always enforce `PRD-16 Desktop IPC & Preload Security Contract`:
  - namespaced IPC
  - schema validation at preload and main boundaries
  - no renderer direct Node/Electron API use

### Worktree and Branch Policy (Required)
- Use one git worktree per task.
- Worktree base directory: `../splice-app-wt/`
- Worktree naming: `<task-id>-<short-slug>`
- Branches must be created inside that task worktree from `main`.
- Branch naming (required prefix): `codex/<type>/<task-id>-<short-slug>`
- Allowed branch `<type>` values: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`.
- Do not reuse a task worktree for unrelated tasks.

### Dependency-Aware Execution Order
- Use `docs/module-dependency-map.md` as source of truth.
- Respect documented cycles by implementing contract-first for cyclical groups:
  - `PRD-04 <-> PRD-05`
  - `PRD-03 <-> PRD-12`
  - `PRD-07 <-> PRD-09 <-> PRD-13 <-> PRD-17`
- For cycle groups, freeze DTO/API/IPC/event contracts before feature code.

### Contract Change Rules
- If any API/IPC/event schema changes, update in same task:
  - producer/handler
  - consumer/caller
  - validation schema
  - tests
  - docs for that contract
- Required event contract for approval scheduling flow must remain explicit and versioned:
  - `submission.approved.scheduling.v1`

### Production Depth Gate (Required)
- Contract-only, scaffold-only, or in-memory-only implementations are `IN_PROGRESS`, not `DONE`.
- Module acceptance must reflect production-path behavior for the declared scope, including persistence and provider/integration adapters where the PRD scope requires them.
- Temporary stubs/mocks are allowed only when explicitly documented as a baseline with follow-up tasks; they must not be used to claim full module completion.
- "Done" requires end-to-end validation across real module boundaries (happy path plus at least one rejection/failure path), not only unit-level contract tests.

### Testing and Verification Gate (Per Task)
- Minimum required before handoff:
  - `npm test`
  - `npm run build:css`
  - `npm start` smoke check
- Add or update tests for:
  - changed logic
  - changed IPC/API/event contracts
  - bugfix regression paths
- For security-sensitive or IPC changes, include negative-path tests.

### Python Environment and Test Rules
- If a task touches Python code, use a per-worktree virtual environment at `.venv`.
- Create the environment if missing: `python3 -m venv .venv`.
- Activate before Python commands: `source .venv/bin/activate`.
- Install dependencies only from repository-managed dependency files (for example `requirements*.txt` or `pyproject.toml`).
- Never rely on global Python packages.
- If Python code is changed, run relevant Python tests/lint for the touched scope before handoff.
- If any required check cannot run, report exactly what was blocked, what was attempted, and why.

### Handoff Format (Required)
- Every task handoff must include:
  - `Scope`: module(s) and PRD IDs
  - `Dependencies Considered`: upstream/downstream modules checked
  - `Files Changed`: concise list
  - `Contracts Changed`: IPC/API/event/schema (or `None`)
  - `Tests Run`: commands and pass/fail
  - `Risks / Follow-ups`: only actionable items

### Completion Tracker Maintenance (Required)
- At the end of every task, update `docs/project-completion-tracker.md` before final handoff.
- Required updates:
  - Set `Last Updated` to the current date.
  - Update the relevant row(s) in `Module Implementation Status (PRDs)` if status changed.
  - Update the corresponding row in `Active Task Tracker` (status, owner, notes).
  - Record test/check outcomes in task notes/checklist.
