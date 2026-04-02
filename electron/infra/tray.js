const { Tray, Menu, app } = require("electron");
const path = require("node:path");

let tray = null;

/**
 * Creates and initializes the System Tray icon.
 * @param {Object} params
 * @param {BrowserWindow} params.mainWindow - The main application window.
 * @param {string} params.iconPath - The path to the tray icon.
 * @param {Object} params.logger - Logger instance.
 */
function createTray({ mainWindow, iconPath, logger }) {
  if (tray) {
    return tray;
  }

  try {
    tray = new Tray(iconPath);
    tray.setToolTip(app.getName());

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show App",
        click: () => {
          restoreAndFocus(mainWindow, logger);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      restoreAndFocus(mainWindow, logger);
    });

    if (logger) {
      logger.info("System Tray initialized successfully");
    }

    return tray;
  } catch (error) {
    if (logger) {
      logger.error("Failed to initialize System Tray", { error: error.message });
    }
    return null;
  }
}

/**
 * Restores and focuses the window.
 * @param {BrowserWindow} window 
 * @param {Object} logger 
 */
function restoreAndFocus(window, logger) {
  if (!window || window.isDestroyed()) {
    if (logger) {
      logger.warn("Cannot restore window: Window is null or destroyed");
    }
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();

  if (logger) {
    logger.info("Window restored and focused via System Tray");
  }
}

module.exports = {
  createTray,
};
