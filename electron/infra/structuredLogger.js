const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  return metadata;
}

function isIgnorableLoggingError(error) {
  return (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    ["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"].includes(error.code)
  );
}

function installStreamErrorGuard(stream) {
  if (!stream || typeof stream.on !== "function" || stream.__fileeatersLoggingGuardInstalled) {
    return;
  }

  stream.on("error", () => {
    // Logging is best-effort. Stream write failures must never crash the main process.
  });

  Object.defineProperty(stream, "__fileeatersLoggingGuardInstalled", {
    value: true,
    configurable: true,
  });
}

function installLoggingErrorGuards({ stdout = process.stdout, stderr = process.stderr } = {}) {
  installStreamErrorGuard(stdout);
  installStreamErrorGuard(stderr);
}

function createStructuredLogger({ serviceName, environment, minLevel = "info", sink = console }) {
  installLoggingErrorGuards();
  const minimumPriority = LOG_LEVEL_PRIORITY[minLevel] ?? LOG_LEVEL_PRIORITY.info;

  function writeToSink(method, serializedPayload) {
    const writer = typeof sink?.[method] === "function" ? sink[method].bind(sink) : null;
    if (!writer) {
      return;
    }

    try {
      writer(serializedPayload);
    } catch (error) {
      // Never let logging failures crash the main process, even if the sink's stream is detached.
      if (isIgnorableLoggingError(error)) {
        return;
      }
    }
  }

  function writeLog(level, message, metadata) {
    if (LOG_LEVEL_PRIORITY[level] < minimumPriority) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: serviceName,
      environment,
      message,
      ...sanitizeMetadata(metadata),
    };

    const serializedPayload = JSON.stringify(payload);

    if (level === "error") {
      writeToSink("error", serializedPayload);
      return;
    }

    if (level === "warn") {
      writeToSink("warn", serializedPayload);
      return;
    }

    writeToSink("log", serializedPayload);
  }

  return {
    debug: (message, metadata) => writeLog("debug", message, metadata),
    info: (message, metadata) => writeLog("info", message, metadata),
    warn: (message, metadata) => writeLog("warn", message, metadata),
    error: (message, metadata) => writeLog("error", message, metadata),
  };
}

module.exports = {
  createStructuredLogger,
  installLoggingErrorGuards,
  isIgnorableLoggingError,
};
