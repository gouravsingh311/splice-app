const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { app } = require("electron");
const { createHttpHealthCheck, waitForBackendReady } = require("./backendReadiness");

let backendChild = null;
let backendSpawnError = null;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve a free localhost port")));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function getDevPythonExecutable(repoRoot) {
  if (process.platform === "win32") {
    const winVenvPath = path.join(repoRoot, ".venv", "Scripts", "python.exe");
    if (fs.existsSync(winVenvPath)) {
      return winVenvPath;
    }
  } else {
    const unixVenvPath = path.join(repoRoot, ".venv", "bin", "python");
    if (fs.existsSync(unixVenvPath)) {
      return unixVenvPath;
    }
  }

  if (process.env.SPLICE_PYTHON_EXECUTABLE && String(process.env.SPLICE_PYTHON_EXECUTABLE).trim()) {
    return String(process.env.SPLICE_PYTHON_EXECUTABLE).trim();
  }

  return process.platform === "win32" ? "py" : "python3";
}

function getPackagedExecutablePath() {
  const defaultPath = path.join(process.resourcesPath, "splice_api");
  if (process.platform === "win32") {
    return `${defaultPath}.exe`;
  }
  return defaultPath;
}

function resolvePackagedDbPath() {
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "splice.db");
}

async function startPythonBackend() {
  const skipBackend = String(process.env.SPLICE_SKIP_PYTHON_BACKEND || "").trim().toLowerCase() === "true";
  if (skipBackend) {
    if (!process.env.SPLICE_API_BASE_URL || !String(process.env.SPLICE_API_BASE_URL).trim()) {
      process.env.SPLICE_API_BASE_URL = "http://127.0.0.1:8017";
    }
    return {
      url: process.env.SPLICE_API_BASE_URL,
      childProcess: null,
      skipped: true,
    };
  }

  if (backendChild && !backendChild.killed) {
    return {
      url: process.env.SPLICE_API_BASE_URL,
      childProcess: backendChild,
    };
  }

  const port = await findFreePort();
  const internalSecret = require('node:crypto').randomBytes(32).toString('hex');
  const url = `http://127.0.0.1:${port}`;
  const healthPath = process.env.SPLICE_BACKEND_HEALTH_PATH || "/version";
  const healthUrl = `${url}${healthPath}`;
  const startupTimeoutMs = Number.parseInt(process.env.SPLICE_BACKEND_STARTUP_TIMEOUT_MS || "20000", 10);
  const pollIntervalMs = Number.parseInt(process.env.SPLICE_BACKEND_POLL_INTERVAL_MS || "250", 10);
  const requestTimeoutMs = Number.parseInt(process.env.SPLICE_BACKEND_REQUEST_TIMEOUT_MS || "1000", 10);
  process.env.SPLICE_API_BASE_URL = url;
  process.env.SPLICE_INTERNAL_SECRET = internalSecret;
  const stderrBuffer = [];
  backendSpawnError = null;

  if (app.isPackaged) {
    if (!process.env.SPLICE_DB_PATH || !String(process.env.SPLICE_DB_PATH).trim()) {
      process.env.SPLICE_DB_PATH = resolvePackagedDbPath();
    }
    const executablePath = getPackagedExecutablePath();
    backendChild = spawn(executablePath, [], {
      stdio: "pipe",
      env: {
        ...process.env,
        SPLICE_API_PORT: String(port),
        SPLICE_HEALTH_PORT: String(port),
        SPLICE_INTERNAL_SECRET: internalSecret,
      },
    });
  } else {
    const repoRoot = path.join(__dirname, "..", "..");
    const pythonPath = getDevPythonExecutable(repoRoot);
    backendChild = spawn(
      pythonPath,
      [
        "-m",
        "uvicorn",
        "app.main:app",
        "--app-dir",
        "apps/api",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: repoRoot,
        stdio: "pipe",
        env: {
          ...process.env,
          SPLICE_INTERNAL_SECRET: internalSecret,
        },
      },
    );
  }

  if (backendChild.stderr && typeof backendChild.stderr.on === "function") {
    backendChild.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderrBuffer.push(text);
      if (stderrBuffer.length > 20) {
        stderrBuffer.shift();
      }
    });
  }

  backendChild.on("error", (error) => {
    backendSpawnError = error;
    stderrBuffer.push(`[spawn-error] ${error.message}`);
    if (stderrBuffer.length > 20) {
      stderrBuffer.shift();
    }
  });

  backendChild.on("exit", () => {
    backendChild = null;
    backendSpawnError = null;
  });

  try {
    const check = createHttpHealthCheck({
      url: healthUrl,
      requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : 1000,
    });
    const readiness = await waitForBackendReady({
      check: async () => {
        if (backendSpawnError) {
          throw backendSpawnError;
        }
        if (!backendChild || backendChild.killed || backendChild.exitCode !== null) {
          throw new Error("Backend process exited before becoming ready");
        }
        return check();
      },
      endpoint: healthUrl,
      timeoutMs: Number.isFinite(startupTimeoutMs) ? startupTimeoutMs : 20000,
      intervalMs: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 250,
    });

    return {
      url,
      childProcess: backendChild,
      startupAttempts: readiness.attempts,
      startupDurationMs: readiness.durationMs,
    };
  } catch (error) {
    const stderrTail = stderrBuffer.join("").trim();
    stopPythonBackend();
    const details = stderrTail ? ` stderr: ${stderrTail}` : "";
    throw new Error(
      `Backend failed readiness checks at ${healthUrl}. ${error.message}${details}`
    );
  }

}

function stopPythonBackend() {
  if (!backendChild || backendChild.killed) {
    return;
  }

  backendChild.kill();
  backendChild = null;
  backendSpawnError = null;
}

module.exports = {
  startPythonBackend,
  stopPythonBackend,
};
