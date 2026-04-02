const { contextBridge, ipcRenderer } = require('electron');

/**
 * PRODUCTION-QUALITY PRELOAD SCRIPT
 * Focus: Security Isolation & Privacy-Aware API Bridge
 */

contextBridge.exposeInMainWorld('spliceAPI', {
  /**
   * Application Identity & Env
   */
  getEnv: () => process.env.NODE_ENV,
  
  /**
   * Privacy / Presenter Mode
   */
  togglePresenterMode: (enabled) => ipcRenderer.send('toggle-presenter-mode', enabled || false),
  onPrivacyChanged: (callback) => {
    const subscription = (event, state) => callback(state);
    ipcRenderer.on('privacy-changed', subscription);
    return () => ipcRenderer.removeListener('privacy-changed', subscription);
  },

  /**
   * Secure Backend Bridge
   * Handles internal authentication automatically in the main process.
   */
  callBackend: async (apiPath, payload, method = 'GET') => {
    // Validate path before sending to prevent unauthorized endpoint access
    if (!apiPath.startsWith('/api/')) throw new Error('Unauthorized API path.');
    return await ipcRenderer.invoke('api-call', { path: apiPath, payload, method });
  },

  /**
   * Local Desktop Capabilities
   */
  selectFile: () => ipcRenderer.invoke('dialog:select-file'),
  saveReport: (name, data) => ipcRenderer.invoke('dialog:save-report', { name, data }),
});
