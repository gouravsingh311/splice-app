const test = require("node:test");
const assert = require("node:assert/strict");
const { registerPermissionGuards } = require("../electron/infra/permissionGuards");

test("registerPermissionGuards denies all renderer permission requests", () => {
  let permissionHandler = null;
  const logs = [];

  const session = {
    defaultSession: {
      setPermissionRequestHandler: (handler) => {
        permissionHandler = handler;
      },
    },
  };

  registerPermissionGuards({
    session,
    logger: {
      warn: (message, metadata) => {
        logs.push({ message, metadata });
      },
    },
  });

  assert.equal(typeof permissionHandler, "function");

  let callbackValue = true;
  permissionHandler({}, "media", (allowed) => {
    callbackValue = allowed;
  });

  assert.equal(callbackValue, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].metadata.permission, "media");
});
