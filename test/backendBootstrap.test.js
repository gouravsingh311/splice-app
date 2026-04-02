const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const {
  bootstrapE2EBackend,
  isLoopbackBackendUrl,
  normalizeUrlString,
  resolveBackendBaseUrl,
} = require("../scripts/backend-bootstrap");

test("resolveBackendBaseUrl prefers PW_API_BASE_URL and falls back to the default", () => {
  assert.equal(resolveBackendBaseUrl({ PW_API_BASE_URL: "http://127.0.0.1:8999" }), "http://127.0.0.1:8999");
  assert.equal(resolveBackendBaseUrl({ PW_API_BASE_URL: "   " }), "http://127.0.0.1:8017");
});

test("normalizeUrlString rejects URLs with paths or unsupported protocols", () => {
  assert.equal(normalizeUrlString("http://127.0.0.1:8017"), "http://127.0.0.1:8017");
  assert.throws(() => normalizeUrlString("file:///tmp/backend"), /Expected an absolute http\/https URL/);
  assert.throws(() => normalizeUrlString("http://127.0.0.1:8017/api"), /base origin without a path/);
});

test("isLoopbackBackendUrl only accepts localhost origins", () => {
  assert.equal(isLoopbackBackendUrl("http://127.0.0.1:8017"), true);
  assert.equal(isLoopbackBackendUrl("http://localhost:8017"), true);
  assert.equal(isLoopbackBackendUrl("http://example.com:8017"), false);
});

test("bootstrapE2EBackend reuses a healthy backend without bootstrapping prerequisites", async () => {
  const calls = {
    probe: 0,
    prerequisites: 0,
    spawn: 0,
  };

  const result = await bootstrapE2EBackend({
    repoRoot: path.resolve(__dirname, ".."),
    env: { PW_API_BASE_URL: "http://127.0.0.1:8017" },
    healthProbeTimeoutMs: 250,
    startupTimeoutMs: 500,
    pollIntervalMs: 25,
    probeHealth: async () => {
      calls.probe += 1;
      return {
        healthy: true,
        statusCode: 200,
        healthUrl: "http://127.0.0.1:8017/health/live",
      };
    },
    ensureBackendRuntimePrerequisites: async () => {
      calls.prerequisites += 1;
      return {
        repoRoot: "/repo",
        venvPythonPath: "/repo/.venv/bin/python",
        pythonVersion: "3.12.1",
        installed: false,
        reusedBootstrap: true,
      };
    },
    createBackendProcess: async () => {
      calls.spawn += 1;
      return {
        childProcess: {
          pid: 1234,
          stderr: null,
          on: () => {},
          killed: false,
          exitCode: null,
        },
      };
    },
    waitForBackendReady: async () => {
      throw new Error("should not be called");
    },
  });

  assert.equal(result.reusedExistingBackend, true);
  assert.equal(result.spawnedBackend, false);
  assert.equal(result.backendPid, null);
  assert.equal(calls.probe, 1);
  assert.equal(calls.prerequisites, 0);
  assert.equal(calls.spawn, 0);
});

test("bootstrapE2EBackend boots a localhost backend when health probe fails", async () => {
  const calls = {
    probe: 0,
    prerequisites: 0,
    spawn: 0,
    wait: 0,
  };
  let killCalls = 0;

  const childProcess = {
    pid: 4321,
    stderr: {
      on: () => {},
    },
    on: (event, handler) => {
      if (event === "exit") {
        childProcess.exitHandler = handler;
      }
      if (event === "error") {
        childProcess.errorHandler = handler;
      }
    },
    killed: false,
    exitCode: null,
    kill: () => {
      killCalls += 1;
      childProcess.killed = true;
    },
  };

  const result = await bootstrapE2EBackend({
    repoRoot: path.resolve(__dirname, ".."),
    env: {},
    healthProbeTimeoutMs: 250,
    startupTimeoutMs: 500,
    pollIntervalMs: 25,
    probeHealth: async () => {
      calls.probe += 1;
      if (calls.probe === 1) {
        return {
          healthy: false,
          statusCode: 503,
          healthUrl: "http://127.0.0.1:8017/health/live",
        };
      }
      return {
        healthy: true,
        statusCode: 200,
        healthUrl: "http://127.0.0.1:8017/health/live",
      };
    },
    ensureBackendRuntimePrerequisites: async () => {
      calls.prerequisites += 1;
      return {
        repoRoot: "/repo",
        venvPythonPath: "/repo/.venv/bin/python",
        pythonVersion: "3.12.2",
        installed: true,
        reusedBootstrap: false,
      };
    },
    createBackendProcess: async () => {
      calls.spawn += 1;
      return {
        childProcess,
      };
    },
    waitForBackendReady: async ({ check }) => {
      calls.wait += 1;
      await check();
      return {
        attempts: 1,
        durationMs: 1,
      };
    },
  });

  assert.equal(result.reusedExistingBackend, false);
  assert.equal(result.spawnedBackend, true);
  assert.equal(result.backendPid, 4321);
  assert.equal(calls.probe, 2);
  assert.equal(calls.prerequisites, 1);
  assert.equal(calls.spawn, 1);
  assert.equal(calls.wait, 1);
  assert.equal(killCalls, 0);
});
