# [PRD-AI-04] SPLICE AI: Floating UI & User Experience

## 1. 🎯 Objective
Create a polished, discreet, and always-on-top UI for real-time interview support.

## 2. 🧱 Architecture
- **Browser Window (Electron)**: A specialized, semi-transparent window.
- **Global Hotkeys**: Control UI visibility and session state instantly.

## 3. 🧪 Core Features (Phase 4)
- **Floating Answer Window**:
    - "Always-on-top" property.
    - Transparent background.
    - Draggable, resizable overlay.
- **UI Interaction**:
    - Smooth scrolling for new text.
    - Copy-to-clipboard for code.
    - Status badges (Active, Idle, Thinking).
- **Customization**:
    - Dark/Light mode toggle.
    - Font size adjustment.

## 4. 📈 Success Metrics
- 0% interference with other applications (Zoom/Teams).
- < 50ms UI response to transcription/answer updates.

## 5. 🛡️ Security
- Screen-shield integration to prevent capturing the assistant in recordings.
- Zero trace after closing.
