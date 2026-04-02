const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attachWindowSecurityHandlers,
  buildMainWindowOptions,
} = require("../electron/window/createMainWindow");

test("buildMainWindowOptions keeps secure Electron webPreferences", () => {
  const options = buildMainWindowOptions({
    appName: "splice-app",
    preloadPath: "/tmp/preload.js",
  });

  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.allowRunningInsecureContent, false);
  assert.equal(options.webPreferences.preload, "/tmp/preload.js");
  assert.equal(options.title, "Splice App Desktop");
});

test("attachWindowSecurityHandlers denies popup and navigation attempts", () => {
  const events = {};
  const logs = [];
  const mainWindow = {
    webContents: {
      setWindowOpenHandler: (handler) => {
        events.windowOpenHandler = handler;
      },
      on: (eventName, handler) => {
        events[eventName] = handler;
      },
    },
  };

  attachWindowSecurityHandlers({
    mainWindow,
    logger: {
      warn: (message, metadata) => {
        logs.push({ message, metadata });
      },
    },
  });

  const popupResult = events.windowOpenHandler({ url: "https://example.com" });
  assert.equal(popupResult.action, "deny");

  const navigationEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };

  events["will-navigate"](navigationEvent, "https://example.com");
  assert.equal(navigationEvent.prevented, true);
  assert.ok(logs.length >= 2);
});
