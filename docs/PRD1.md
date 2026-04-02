# Product Requirements Document: Screen Shield (Anti-Capture Protection)

## 1. Overview
As part of Splice Desktop's Privacy-First initiative, the **Screen Shield** feature will prevent the application window from being captured, recorded, or broadcasted by screen-sharing applications (e.g., Zoom, Microsoft Teams, Slack), screenshot utilities, and screen recording software. 

When a user attempts to share their screen, the Splice Desktop window will appear as a completely black box, a transparent void, or be entirely excluded from the capture feed, depending on the host operating system's handling of protected content.

## 2. Objectives & Success Metrics
* **Primary Objective:** Ensure that sensitive data rendered within the Electron application cannot be accidentally or maliciously captured via software-based screen reading/recording tools.
* **Secondary Objective:** Provide a seamless toggle mechanism (tying into the existing Presenter Mode) or enforce it globally via configuration.
* **Success Metrics:** * 100% success rate in blacking out the window on standard capture tools (OBS, Snipping Tool, Zoom, Teams) across Windows and macOS.
    * Zero noticeable performance degradation in the React UI or FastAPI backend.

## 3. Scope and Non-Goals
### In Scope
* Implementation of OS-level window content protection via Electron APIs.
* Configuration options to enable/disable protection dynamically via the React frontend.
* Integration with existing audit logging to track when protection is toggled.

### Non-Goals (Important Limitations)
* **Hardware Capture Prevention:** We cannot prevent external hardware (e.g., a user taking a photo of their monitor with a smartphone, or external HDMI capture cards) from viewing the screen.
* **Security System Evasion:** This feature will *not* hide the `electron.exe` or `python.exe` processes from Task Manager, Activity Monitor, or enterprise security software (EDR/AV). 

## 4. Technical Approach

The feature will leverage Electron's native `setContentProtection` API, which hooks into the underlying OS's secure display rendering pipelines (e.g., `SetWindowDisplayAffinity` on Windows, and `CGWindowListCreateImage` restrictions on macOS).

### 4.1. Electron Main Process (Implementation)
A new IPC handler will be introduced in the `electron/` directory to manage the window state.

| OS | Underlying OS API Leveraged | Expected Behavior during Screen Share |
| :--- | :--- | :--- |
| **Windows** | `WDA_MONITOR` (Display Affinity) | The application window appears completely black. |
| **macOS** | Secure Window APIs | The window becomes invisible/transparent to the capture software. |
| **Linux** | *Varies (X11 vs Wayland)* | Sporadic support; often unsupported by the OS. Requires fallback UI warnings. |

### 4.2. IPC Bridge (Preload)
The `preload.js` will expose a secure, rate-limited function to toggle this state:

```javascript
// Example conceptual bridge
contextBridge.exposeInMainWorld('spliceSecurity', {
  setScreenShield: (enable) => ipcRenderer.invoke('set-screen-shield', enable)
});
```

### 4.3. React Frontend Integration
* Integrate the toggle into the existing "Presenter Mode" UI using Tailwind/Flowbite components.
* Display a persistent, low-profile indicator (e.g., a shield icon in the status bar) when Screen Shield is active, ensuring the user knows their screen is protected.

## 5. Security & Audit Considerations

1. **State Verification:** The FastAPI backend does not need to know about the UI's capture state, keeping the separation of concerns intact. However, the Electron Main process should log the toggling of this feature to the local SQLite audit trail.
2. **Crash Recovery:** If the application crashes unexpectedly, OS-level protections on the window are automatically dropped when the window is destroyed. No persistent OS registry changes are made.
3. **Sandbox Compliance:** Calling `setContentProtection` happens entirely within the Electron Main process, maintaining the strict isolation and sandbox rules established for the Renderer process.