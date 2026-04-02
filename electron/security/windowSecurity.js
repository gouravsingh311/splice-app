const REQUIRED_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

function assertSecureWebPreferences(webPreferences) {
  if (!webPreferences || webPreferences.contextIsolation !== true) {
    throw new Error("contextIsolation must be true");
  }

  if (webPreferences.nodeIntegration !== false) {
    throw new Error("nodeIntegration must be false");
  }

  if (webPreferences.sandbox !== true) {
    throw new Error("sandbox must be true");
  }

  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function attachNavigationGuards(mainWindow) {
  if (!mainWindow || !mainWindow.webContents) {
    throw new Error("Main window webContents is required for navigation guards");
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const blockRemoteNavigation = (event, url) => {
    if (!String(url).startsWith("file://")) {
      event.preventDefault();
    }
  };

  mainWindow.webContents.on("will-navigate", blockRemoteNavigation);
  mainWindow.webContents.on("will-redirect", blockRemoteNavigation);

  return true;
}

module.exports = {
  REQUIRED_WEB_PREFERENCES,
  assertSecureWebPreferences,
  attachNavigationGuards,
};
