const { buildWindowTitle } = require("../../src/renderer/core/utils/window-title.js");

function buildMainWindowOptions({ appName, preloadPath, iconPath }) {
  return {
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: buildWindowTitle(appName),
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}

function attachWindowSecurityHandlers({ mainWindow, logger }) {
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (logger && typeof logger.warn === "function") {
      logger.warn("Blocked renderer window.open request", { url: details.url });
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    event.preventDefault();

    if (logger && typeof logger.warn === "function") {
      logger.warn("Blocked renderer navigation request", { url: targetUrl });
    }
  });
}

function createMainWindow({ BrowserWindow, options, loadFilePath, logger }) {
  const mainWindow = new BrowserWindow(options);
  attachWindowSecurityHandlers({ mainWindow, logger });
  mainWindow.loadFile(loadFilePath);

  return mainWindow;
}

module.exports = {
  attachWindowSecurityHandlers,
  buildMainWindowOptions,
  createMainWindow,
};
