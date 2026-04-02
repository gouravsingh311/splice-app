const { app, BrowserWindow, dialog, ipcMain, nativeImage, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const packageMetadata = require("../package.json");
const { readRuntimeConfig, resolveRuntimeEnv } = require("./config/runtimeConfig");
const { startHealthServer } = require("./infra/healthServer");
const { registerPermissionGuards } = require("./infra/permissionGuards");
const { createStructuredLogger } = require("./infra/structuredLogger");
const { buildMainWindowOptions, createMainWindow } = require("./window/createMainWindow");
const { createIpcRouter } = require("./ipc/router");
const { createAuditApiClient } = require("./ipc/auditLog");
const { createAuthBackendClient } = require("./ipc/authBackendClient");
const { createNotificationsBackendClient } = require("./ipc/notificationsBackendClient");
const { createOperationsBackendClient } = require("./ipc/operationsBackendClient");
const { createQcBackendClient } = require("./ipc/qcBackendClient");
const { assertSecureWebPreferences, attachNavigationGuards } = require("./security/windowSecurity");
const { startPythonBackend, stopPythonBackend } = require("./infra/pythonProcess");
const { createTray } = require("./infra/tray");

const IS_E2E = process.env.PLAYWRIGHT_E2E === "1";

const runtimeEnv = resolveRuntimeEnv({
  cwd: path.join(__dirname, ".."),
  processEnv: process.env,
});
Object.assign(process.env, runtimeEnv);
let runtimeConfig = readRuntimeConfig(runtimeEnv, packageMetadata);
const logger = createStructuredLogger({
  serviceName: runtimeConfig.appName,
  environment: runtimeConfig.environment,
  minLevel: runtimeConfig.logLevel,
});

let healthServerHandle = null;
let isAppReady = false;
const trustedRendererWebContentsIds = new Set();
let expectedRendererPath = path.resolve(path.join(__dirname, "../src/index.html"));

const runtimeSecurityState = {
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
  navigationGuard: false,
};

async function exportQcReport(payload) {
  const defaultFileName = `qc-findings-${payload.runId}.json`;
  const exportDocument = {
    submissionId: payload.submissionId,
    runId: payload.runId,
    generatedAt: payload.generatedAt,
    ruleSetVersion: payload.ruleSetVersion,
    policyVersion: payload.policyVersion,
    status: payload.status,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    findings: payload.findings,
  };
  const saveResult = await dialog.showSaveDialog({
    title: "Export QC Findings",
    defaultPath: path.join(app.getPath("documents"), defaultFileName),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true, path: null };
  }

  await fs.writeFile(
    saveResult.filePath,
    `${JSON.stringify(exportDocument, null, 2)}\n`,
    "utf8"
  );
  return { canceled: false, path: saveResult.filePath };
}

function verifyDesktopSecurityState() {
  const checks = assertSecureWebPreferences(runtimeSecurityState.webPreferences);

  if (runtimeSecurityState.navigationGuard !== true) {
    throw new Error("navigationGuard must be enabled before security verification");
  }

  return {
    checks: {
      ...checks,
      navigationGuard: true,
    },
  };
}

function openMainWindow() {
  const appIconPath = path.join(__dirname, "../src/assets/figma/smiley_face_open_mouth.png");
  const mainWindowOptions = buildMainWindowOptions({
    appName: runtimeConfig.appName,
    preloadPath: path.join(__dirname, "preload.js"),
    iconPath: appIconPath,
  });

  assertSecureWebPreferences(mainWindowOptions.webPreferences);

  const mainWindow = createMainWindow({
    BrowserWindow,
    options: mainWindowOptions,
    loadFilePath: path.join(__dirname, "../src/index.html"),
    logger,
  });

  runtimeSecurityState.webPreferences = mainWindowOptions.webPreferences;
  runtimeSecurityState.navigationGuard = attachNavigationGuards(mainWindow);
  const mainWindowWebContentsId = mainWindow.webContents.id;
  trustedRendererWebContentsIds.add(mainWindowWebContentsId);
  mainWindow.on("closed", () => {
    trustedRendererWebContentsIds.delete(mainWindowWebContentsId);
  });

  return mainWindow;
}

function closeHealthServerIfRunning() {
  if (!healthServerHandle) {
    return;
  }

  const handle = healthServerHandle;
  healthServerHandle = null;

  handle.stop().catch((error) => {
    logger.error("Failed to stop health server", { error: error.message });
  });
}

app
  .whenReady()
  .then(async () => {
    await startPythonBackend();
    // Re-read runtime config after backend startup, because startPythonBackend
    // assigns SPLICE_API_BASE_URL dynamically in development.
    runtimeConfig = readRuntimeConfig(process.env, packageMetadata);

    logger.info("Runtime configuration resolved", {
      apiBaseUrl: runtimeConfig.apiBaseUrl,
      healthPort: runtimeConfig.healthPort,
      environment: runtimeConfig.environment,
    });

    registerPermissionGuards({ session, logger });

    if (process.platform === "darwin" && app.dock && typeof app.dock.setIcon === "function") {
      const dockIconPath = path.join(__dirname, "../src/assets/figma/smiley_face_open_mouth.png");
      const dockIcon = nativeImage.createFromPath(dockIconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }

    const ipcRouter = createIpcRouter({
      internalSecret: process.env.SPLICE_INTERNAL_SECRET,
      authBackendClient: createAuthBackendClient({
        baseUrl: runtimeConfig.apiBaseUrl,
        internalSecret: process.env.SPLICE_INTERNAL_SECRET,
        logger,
      }),
      qcBackendClient: createQcBackendClient({
        baseUrl: runtimeConfig.apiBaseUrl,
        internalSecret: process.env.SPLICE_INTERNAL_SECRET,
        logger,
      }),
      notificationsBackendClient: createNotificationsBackendClient({
        baseUrl: runtimeConfig.apiBaseUrl,
        internalSecret: process.env.SPLICE_INTERNAL_SECRET,
        logger,
      }),
      operationsBackendClient: createOperationsBackendClient({
        baseUrl: runtimeConfig.apiBaseUrl,
        internalSecret: process.env.SPLICE_INTERNAL_SECRET,
        logger,
      }),
      auditApiClient: createAuditApiClient({
        baseUrl: runtimeConfig.apiBaseUrl,
        internalToken: process.env.SPLICE_INTERNAL_API_TOKEN,
        internalSecret: process.env.SPLICE_INTERNAL_SECRET,
        logger,
      }),
      verifySecurityConfig: verifyDesktopSecurityState,
      qcReportExporter: exportQcReport,
      expectedRendererPath,
      isTrustedWebContentsId: (webContentsId) => trustedRendererWebContentsIds.has(webContentsId),
      logger,
    });

    ipcRouter.registerHandlers(ipcMain);
    const mainWindow = openMainWindow();
    
    // Initialize system tray for visibility recovery
    const appIconPath = path.join(__dirname, "../src/assets/figma/smiley_face_open_mouth.png");
    createTray({ mainWindow, iconPath: appIconPath, logger });
    
    // Enable Screen Shield and skip taskbar by default on startup
    if (process.platform === "win32" || process.platform === "darwin") {
      mainWindow.setContentProtection(true);
      mainWindow.setSkipTaskbar(true);
      logger.info("Screen Shield (Anti-Capture) and taskbar-skip enabled on startup");
    }
    
    isAppReady = true;

    try {
      healthServerHandle = await startHealthServer({
        config: runtimeConfig,
        logger,
        getReadyState: () => isAppReady,
      });
    } catch (error) {
      logger.error("Failed to start health server", { error: error.message });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openMainWindow();
      }
    });
  })
  .catch((error) => {
    logger.error("Desktop boot failed", { error: error.message });
    app.exit(1);
  });

app.on("before-quit", () => {
  isAppReady = false;
  stopPythonBackend();
  closeHealthServerIfRunning();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
