const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSecureWebPreferences,
  attachNavigationGuards,
} = require("../electron/security/windowSecurity");

function createMockWindow() {
  let openHandler = null;
  const eventHandlers = {};

  return {
    webContents: {
      setWindowOpenHandler: (handler) => {
        openHandler = handler;
      },
      on: (eventName, handler) => {
        eventHandlers[eventName] = handler;
      },
    },
    getHandlers: () => ({
      openHandler,
      eventHandlers,
    }),
  };
}

test("assertSecureWebPreferences accepts secure baseline", () => {
  const checks = assertSecureWebPreferences({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });

  assert.deepEqual(checks, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
});

test("assertSecureWebPreferences rejects insecure flags", () => {
  assert.throws(
    () =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: true,
        sandbox: true,
      }),
    /nodeIntegration must be false/
  );
});

test("attachNavigationGuards denies new windows and blocks remote navigations", () => {
  const mainWindow = createMockWindow();
  const attached = attachNavigationGuards(mainWindow);

  assert.equal(attached, true);

  const handlers = mainWindow.getHandlers();
  assert.deepEqual(handlers.openHandler(), { action: "deny" });

  let preventedRemote = false;
  handlers.eventHandlers["will-navigate"](
    {
      preventDefault: () => {
        preventedRemote = true;
      },
    },
    "https://example.com/remote"
  );
  assert.equal(preventedRemote, true);

  let preventedFile = false;
  handlers.eventHandlers["will-navigate"](
    {
      preventDefault: () => {
        preventedFile = true;
      },
    },
    "file:///Users/test/index.html"
  );
  assert.equal(preventedFile, false);

  let preventedRedirect = false;
  handlers.eventHandlers["will-redirect"](
    {
      preventDefault: () => {
        preventedRedirect = true;
      },
    },
    "https://example.com/redirect"
  );
  assert.equal(preventedRedirect, true);
});
