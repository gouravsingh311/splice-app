You are a senior desktop application security and privacy engineer.

I have an Electron + FastAPI based desktop application that currently runs only locally.

Your task is to help me redesign and improve this app for LEGITIMATE privacy, professional packaging, and user-controlled screen-sharing safety — NOT stealth, evasion, or bypassing detection from screen-sharing, recording, monitoring, proctoring, or security software.

Strict rules:
- Do NOT suggest anything that hides the app from screen sharing tools, meeting software, OS capture APIs, remote desktop tools, proctoring tools, or monitoring software.
- Do NOT suggest process renaming, overlay tricks, capture exclusion hacks, hidden windows, GPU tricks, DRM abuse, anti-detection methods, or OS-level stealth behavior.
- Do NOT provide code or architecture for evading detection.
- Only provide safe, legitimate, user-transparent solutions.

What I want instead:
1. A secure and professional architecture for an Electron + FastAPI local desktop app.
2. A proper way to bundle/package FastAPI inside Electron for local desktop distribution.
3. A “Privacy Mode” / “Presenter Mode” feature that protects sensitive information during screen sharing in a transparent, user-controlled way. This includes masking the **OpenAI API Key** and other PII.
4. Best practices for local-only data handling, security, startup, background process management, and production packaging.

## Part 1 — Recommended architecture
Design a production-ready architecture for:
- Electron frontend
- FastAPI backend
- local IPC / localhost communication
- secure process startup and shutdown
- environment/config handling
- logging
- secrets handling (especially the **OpenAI API Key**)
- local data storage

Include:
- folder structure
- how Electron should launch FastAPI
- how to detect when backend is ready
- how to shut it down cleanly
- how to avoid opening visible terminals/console windows in production

## Part 2 — Packaging strategy
Explain the best way to package and distribute this as a desktop app.

Cover:
- Electron packaging tools
- packaging Python/FastAPI backend
- whether to use PyInstaller or Nuitka
- how to bundle the Python executable into the Electron app
- how to handle platform differences (Windows / macOS / Linux)
- startup scripts and production build flow

## Part 3 — Privacy / Presenter Mode
Design a safe “Presenter Mode” feature for the app.

Requirements:
- user can toggle it on/off manually
- it must NOT attempt to evade detection
- it should simply reduce exposure of sensitive content on screen

Include feature ideas like:
- blur/redact sensitive fields (e.g., API Keys, email addresses)
- hide tokens / secrets / logs
- replace names/emails/IDs with placeholders
- disable popups and notifications
- hide transcripts, notes, or confidential content
- optional hotkey to toggle presenter mode
- safe UI/UX patterns

Provide:
- React/Electron frontend implementation suggestions
- backend considerations if needed
- state management approach
- sample component design

## Part 4 — Security hardening
List practical security best practices for this type of local desktop app:
- CORS / localhost API safety
- auth between Electron and FastAPI (e.g., shared secret)
- token handling (OpenAI key storage security)
- file permissions
- encrypted local storage
- secure updates
- code signing
- crash logging
- avoiding unsafe Electron settings

## Part 5 — Code generation
Generate production-quality starter code for:
- Electron main process that launches FastAPI
- preload script
- secure BrowserWindow config
- FastAPI app entrypoint
- health check endpoint
- backend readiness polling
- graceful shutdown
- Presenter Mode frontend toggle example

Requirements for code:
- use clean, maintainable structure
- DRY principles
- clear comments
- production-minded defaults
- avoid unnecessary complexity

## Part 6 — Final output format
Return the answer in this order:
1. High-level architecture
2. Recommended folder structure
3. Packaging/build strategy
4. Presenter Mode design
5. Security checklist
6. Starter code
7. Recommended next implementation steps

Assume:
- app is local-first
- Electron frontend
- FastAPI backend
- likely React frontend inside Electron
- desktop distribution is the goal
- privacy and professionalism are important
- stealth/evasion is NOT allowed
- **OpenAI API Key** is used locally and must be handled securely