const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createStructuredLogger,
  installLoggingErrorGuards,
} = require("../electron/infra/structuredLogger");

test("structured logger swallows sink write failures and keeps the main process alive", () => {
  const logger = createStructuredLogger({
    serviceName: "splice-app",
    environment: "test",
    sink: {
      log() {
        const error = new Error("broken pipe");
        error.code = "EPIPE";
        throw error;
      },
      warn() {
        throw new Error("unexpected warn write");
      },
      error() {
        throw new Error("unexpected error write");
      },
    },
  });

  assert.doesNotThrow(() => {
    logger.info("hello world");
  });
});

test("structured logger installs stdio error guards for detached streams", () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  installLoggingErrorGuards({ stdout, stderr });

  const epipeError = new Error("write EPIPE");
  epipeError.code = "EPIPE";

  assert.doesNotThrow(() => stdout.emit("error", epipeError));
  assert.doesNotThrow(() => stderr.emit("error", epipeError));
});
