const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startHealthServer } = require("../electron/infra/healthServer");

function makeRequest({ port, path }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
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

test("health server exposes live, ready, version, and metrics endpoints", async (t) => {
  let readyState = false;

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const healthHandle = await startHealthServer({
    config: {
      appName: "splice-app",
      appVersion: "1.0.0",
      environment: "local",
      healthPort: 0,
      enableHealthServer: true,
    },
    logger,
    getReadyState: () => readyState,
  });

  assert.ok(healthHandle, "Expected health server handle");

  t.after(async () => {
    await healthHandle.stop();
  });

  const port = healthHandle.getPort();
  assert.ok(port > 0, "Expected an active health port");

  const liveResponse = await makeRequest({ port, path: "/health/live" });
  assert.equal(liveResponse.statusCode, 200);

  const readyBeforeResponse = await makeRequest({ port, path: "/health/ready" });
  assert.equal(readyBeforeResponse.statusCode, 503);

  readyState = true;

  const readyAfterResponse = await makeRequest({ port, path: "/health/ready" });
  assert.equal(readyAfterResponse.statusCode, 200);

  const versionResponse = await makeRequest({ port, path: "/version" });
  assert.equal(versionResponse.statusCode, 200);
  assert.match(versionResponse.body, /"version":"1.0.0"/);

  const metricsResponse = await makeRequest({ port, path: "/metrics" });
  assert.equal(metricsResponse.statusCode, 200);
  assert.match(metricsResponse.body, /splice_desktop_http_requests_total/);
});
