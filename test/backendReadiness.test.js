const test = require("node:test");
const assert = require("node:assert/strict");
const { createHttpHealthCheck, waitForBackendReady } = require("../electron/infra/backendReadiness");

test("waitForBackendReady returns when check becomes ready", async () => {
  let nowValue = 0;
  let calls = 0;

  const result = await waitForBackendReady({
    endpoint: "http://127.0.0.1:8000/version",
    timeoutMs: 1000,
    intervalMs: 100,
    now: () => nowValue,
    sleep: async (ms) => {
      nowValue += ms;
    },
    check: async () => {
      calls += 1;
      return calls >= 3;
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  assert.equal(result.durationMs, 200);
});

test("waitForBackendReady times out with last error in cause", async () => {
  let nowValue = 0;
  const expectedError = new Error("connection refused");

  await assert.rejects(
    () =>
      waitForBackendReady({
        endpoint: "http://127.0.0.1:8000/version",
        timeoutMs: 250,
        intervalMs: 100,
        now: () => nowValue,
        sleep: async (ms) => {
          nowValue += ms;
        },
        check: async () => {
          throw expectedError;
        },
      }),
    (error) => {
      assert.match(error.message, /timed out/);
      assert.equal(error.cause, expectedError);
      return true;
    }
  );
});

test("createHttpHealthCheck returns true only for successful responses", async () => {
  const statuses = [503, 200];
  const seenUrls = [];
  const check = createHttpHealthCheck({
    url: "http://127.0.0.1:9999/version",
    requestTimeoutMs: 500,
  });

  const http = require("node:http");
  const originalGet = http.get;
  http.get = (url, callback) => {
    seenUrls.push(url);
    const { EventEmitter } = require("node:events");
    const request = new EventEmitter();
    request.setTimeout = (_ms, handler) => {
      request._timeoutHandler = handler;
    };
    request.destroy = () => {};

    process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = statuses.shift();
      response.resume = () => {};
      callback(response);
    });
    return request;
  };

  try {
    const first = await check();
    const second = await check();

    assert.equal(first, false);
    assert.equal(second, true);
    assert.deepEqual(seenUrls, [
      "http://127.0.0.1:9999/version",
      "http://127.0.0.1:9999/version",
    ]);
  } finally {
    http.get = originalGet;
  }
});
