# Security & Privacy Hardening Baseline

As a professional desktop application with a local-first philosophy, we prioritize user-controlled privacy and robust security.

## Electron Shell Security
- **Context Isolation**: Always `true`.
- **Node Integration**: Always `false`.
- **Sandbox Mode**: Always `true`.
- **Preload API**: Minimal, typed bridge via `contextBridge`. Raw `ipcRenderer` is never exposed.
- **CSP**: Restricted `script-src` to `self`. No `unsafe-inline` or `unsafe-eval`.
- **Navigation Guards**: Block all unexpected origin navigation and window-opening requests.

## Backend (FastAPI) Security
- **Localhost Binding**: Strictly bind to `127.0.0.1`. No external interface listeners.
- **Shared Secret Auth**: Electron generates a unique `SPLICE_INTERNAL_SECRET` at boot and passes it to FastAPI. All internal API calls require this in the header.
- **CORS**: Dynamically restricted to the Electron process's unique origin.
- **Data Protection**: Local SQLite database encrypted in production using platform-specific keys (DPAPI/Keytar).

## OpenAI & Secret Handling
- **Secure Storage**: OpenAI API keys are either ephemeral (session-based) or stored in the OS-level secure keyring (Credential Manager/Keychain).
- **Environment Handling**: Secrets are never logged to console or stored in unencrypted config files in production.
- **Presenter Mode Mapping**: All sensitive tokens and API keys are automatically masked in the UI when **Presenter Mode** is enabled.

## Privacy Commitment (No Evasion)
This application does **NOT** include any stealth, evasion, or bypass mechanisms. We do not:
- Rename processes to hide from proctoring software.
- Use overlay tricks to bypass screen capture.
- Attempt to evade OS-level monitoring APIs.

Instead, we provide **User-Controlled Redaction** (Presenter Mode) that is transparent and legitimate.

## Reporting Vulnerabilities
Report issues to our security team. We follow a 90-day disclosure policy for all identified findings.
