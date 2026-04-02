const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readRuntimeConfig, resolveRuntimeEnv } = require("../electron/config/runtimeConfig");

test("readRuntimeConfig returns defaults for local environment", () => {
  const config = readRuntimeConfig({}, { name: "splice-app", version: "1.2.3" });

  assert.equal(config.environment, "local");
  assert.equal(config.appName, "splice-app");
  assert.equal(config.appVersion, "1.2.3");
  assert.equal(config.healthPort, 4815);
  assert.equal(config.enableHealthServer, true);
  assert.equal(config.logLevel, "info");
  assert.equal(config.apiBaseUrl, "http://127.0.0.1:8000");
});

test("readRuntimeConfig enforces allowed SPLICE_ENV values", () => {
  assert.throws(
    () => readRuntimeConfig({ SPLICE_ENV: "invalid-env" }, {}),
    /Invalid SPLICE_ENV/,
  );
});

test("readRuntimeConfig validates boolean and port values", () => {
  assert.throws(
    () => readRuntimeConfig({ SPLICE_ENABLE_HEALTH_SERVER: "not-a-bool" }, {}),
    /Invalid boolean value/,
  );

  assert.throws(
    () => readRuntimeConfig({ SPLICE_HEALTH_PORT: "99999" }, {}),
    /Invalid port/,
  );
});

test("readRuntimeConfig validates API base URL", () => {
  assert.equal(
    readRuntimeConfig({ SPLICE_API_BASE_URL: "https://api.example.test/" }, {}).apiBaseUrl,
    "https://api.example.test",
  );

  assert.throws(
    () => readRuntimeConfig({ SPLICE_API_BASE_URL: "/relative-url" }, {}),
    /Invalid SPLICE_API_BASE_URL/,
  );
});

test("resolveRuntimeEnv loads .env.local values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "splice-runtime-env-"));
  fs.writeFileSync(
    path.join(tempDir, ".env.local"),
    "SPLICE_API_BASE_URL=http://127.0.0.1:8017\nSPLICE_ENV=dev\n",
    "utf8",
  );

  const env = resolveRuntimeEnv({
    cwd: tempDir,
    processEnv: {},
  });

  assert.equal(env.SPLICE_API_BASE_URL, "http://127.0.0.1:8017");
  assert.equal(env.SPLICE_ENV, "dev");
});

test("resolveRuntimeEnv prefers process env over .env.local", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "splice-runtime-env-"));
  fs.writeFileSync(path.join(tempDir, ".env.local"), "SPLICE_ENV=local\n", "utf8");

  const env = resolveRuntimeEnv({
    cwd: tempDir,
    processEnv: {
      SPLICE_ENV: "prod",
    },
  });

  assert.equal(env.SPLICE_ENV, "prod");
});
