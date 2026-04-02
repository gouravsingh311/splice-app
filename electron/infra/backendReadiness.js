const http = require("node:http");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTimeoutError(attempts, timeoutMs, endpoint, lastError) {
  const error = new Error(
    `Backend readiness check timed out after ${timeoutMs}ms (${attempts} attempts) for ${endpoint}`
  );
  if (lastError) {
    error.cause = lastError;
  }
  return error;
}

async function waitForBackendReady(options = {}) {
  const check = options.check;
  if (typeof check !== "function") {
    throw new Error("waitForBackendReady requires a check function");
  }

  const endpoint = options.endpoint || "backend endpoint";
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 15000;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 250;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const sleep = typeof options.sleep === "function" ? options.sleep : delay;

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let lastError = null;

  while (now() <= deadline) {
    attempts += 1;
    try {
      const isReady = await check();
      if (isReady === true) {
        return {
          ready: true,
          attempts,
          durationMs: Math.max(0, now() - startedAt),
        };
      }
    } catch (error) {
      lastError = error;
    }

    if (now() + intervalMs > deadline) {
      break;
    }

    await sleep(intervalMs);
  }

  throw buildTimeoutError(attempts, timeoutMs, endpoint, lastError);
}

function createHttpHealthCheck(options = {}) {
  const url = options.url;
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("createHttpHealthCheck requires a valid URL");
  }

  const requestTimeoutMs = Number.isInteger(options.requestTimeoutMs)
    ? options.requestTimeoutMs
    : 1000;

  return async function runHealthCheck() {
    return new Promise((resolve, reject) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 300);
      });

      request.setTimeout(requestTimeoutMs, () => {
        request.destroy(new Error(`Health check request timed out after ${requestTimeoutMs}ms`));
      });

      request.on("error", (error) => {
        reject(error);
      });
    });
  };
}

module.exports = {
  createHttpHealthCheck,
  waitForBackendReady,
};
