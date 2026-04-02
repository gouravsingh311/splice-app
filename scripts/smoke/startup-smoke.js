const assert = require("node:assert/strict");
const http = require("node:http");
const { readRuntimeConfig } = require("../../electron/config/runtimeConfig");
const { buildMainWindowOptions } = require("../../electron/window/createMainWindow");
const { startHealthServer } = require("../../electron/infra/healthServer");

function makeRequest({ port, path }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "GET",
        path,
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            body,
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

async function main() {
  const runtimeConfig = readRuntimeConfig(
    {
      SPLICE_ENV: "local",
      SPLICE_HEALTH_PORT: "0",
      SPLICE_ENABLE_HEALTH_SERVER: "true",
    },
    {
      name: "splice-app",
      version: "1.0.0",
    },
  );

  const mainWindowOptions = buildMainWindowOptions({
    appName: runtimeConfig.appName,
    preloadPath: "/tmp/preload.js",
  });

  assert.equal(mainWindowOptions.webPreferences.contextIsolation, true);
  assert.equal(mainWindowOptions.webPreferences.nodeIntegration, false);
  assert.equal(mainWindowOptions.webPreferences.sandbox, true);

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const healthServerHandle = await startHealthServer({
    config: runtimeConfig,
    logger,
    getReadyState: () => true,
  });

  if (!healthServerHandle) {
    throw new Error("Health server did not start");
  }

  try {
    const liveResponse = await makeRequest({
      port: healthServerHandle.getPort(),
      path: "/health/live",
    });

    assert.equal(liveResponse.statusCode, 200);
  } finally {
    await healthServerHandle.stop();
  }

  process.stdout.write("Startup smoke checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
