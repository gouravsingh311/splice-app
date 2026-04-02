const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { waitForBackendReady: waitForBackendReadyDefault } = require("../electron/infra/backendReadiness");

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8017";
const BACKEND_MANIFEST_PATH = path.join("apps", "api", "pyproject.toml");
const BACKEND_INSTALL_TARGET = "./apps/api[dev]";
const BACKEND_BOOTSTRAP_STAMP_NAME = ".splice-api-bootstrap.json";
const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 12;

function resolveRepoRoot(repoRoot) {
  return path.resolve(repoRoot || path.join(__dirname, ".."));
}

function resolveBackendBaseUrl(env = process.env) {
  const candidate = String(env.PW_API_BASE_URL || "").trim();
  return candidate.length > 0 ? candidate : DEFAULT_BACKEND_BASE_URL;
}

function normalizeUrlString(rawUrl) {
  const parsed = new URL(String(rawUrl || "").trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `Invalid backend URL "${rawUrl}". Expected an absolute http/https URL.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(`Invalid backend URL "${rawUrl}". Credentials are not supported.`);
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    throw new Error(
      `Invalid backend URL "${rawUrl}". Expected a base origin without a path.`
    );
  }

  if (!parsed.port) {
    throw new Error(
      `Invalid backend URL "${rawUrl}". Expected a base origin with an explicit port.`
    );
  }

  return parsed.origin;
}

function parseUrlOrNull(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isLoopbackBackendUrl(rawUrl) {
  const parsed = parseUrlOrNull(rawUrl);
  return Boolean(parsed && isLoopbackHost(parsed.hostname));
}

function getVenvPythonPath(repoRoot) {
  const resolvedRepoRoot = resolveRepoRoot(repoRoot);
  if (process.platform === "win32") {
    return path.join(resolvedRepoRoot, ".venv", "Scripts", "python.exe");
  }
  return path.join(resolvedRepoRoot, ".venv", "bin", "python");
}

function getBootstrapPythonCandidates(env = process.env) {
  const explicitPython = String(env.SPLICE_PYTHON_EXECUTABLE || "").trim();
  if (explicitPython) {
    return [{ command: explicitPython, args: [], label: "SPLICE_PYTHON_EXECUTABLE" }];
  }

  if (process.platform === "win32") {
    return [
      { command: "py", args: ["-3"], label: "py -3" },
      { command: "python", args: [], label: "python" },
      { command: "python3", args: [], label: "python3" },
    ];
  }

  return [
    { command: "python3", args: [], label: "python3" },
    { command: "python", args: [], label: "python" },
    { command: "py", args: ["-3"], label: "py -3" },
  ];
}

function formatCommand(command, args) {
  return [command].concat(args || []).join(" ");
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    const error = new Error(
      `${options.description || "Command"} failed to start: ${formatCommand(command, args)}`
    );
    error.cause = result.error;
    error.stdout = String(result.stdout || "");
    error.stderr = String(result.stderr || "");
    throw error;
  }

  if (result.status !== 0) {
    const stdout = String(result.stdout || "").trim();
    const stderr = String(result.stderr || "").trim();
    const details = [stdout && `stdout: ${stdout}`, stderr && `stderr: ${stderr}`]
      .filter(Boolean)
      .join("; ");
    const error = new Error(
      `${options.description || "Command"} failed (${result.status}): ${formatCommand(
        command,
        args
      )}${details ? ` | ${details}` : ""}`
    );
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }

  return result;
}

function parsePythonVersion(versionText) {
  const match = String(versionText || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Unable to parse Python version from "${versionText}"`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function isSupportedPythonVersion(version) {
  if (version.major > MIN_PYTHON_MAJOR) {
    return true;
  }
  if (version.major < MIN_PYTHON_MAJOR) {
    return false;
  }
  return version.minor >= MIN_PYTHON_MINOR;
}

function resolveBootstrapPythonExecutable(env = process.env, repoRoot) {
  const resolvedRepoRoot = resolveRepoRoot(repoRoot);
  const candidates = getBootstrapPythonCandidates(env);
  const failures = [];

  for (const candidate of candidates) {
    try {
      const result = runCommand(candidate.command, [
        ...candidate.args,
        "-c",
        "import sys; print('.'.join(str(part) for part in sys.version_info[:3]))",
      ], {
        cwd: resolvedRepoRoot,
        env,
        description: `Python probe (${candidate.label})`,
      });
      const version = parsePythonVersion(result.stdout);
      if (!isSupportedPythonVersion(version)) {
        failures.push(
          `${candidate.label} resolved to Python ${version.major}.${version.minor}.${version.patch}, which is below the required 3.12.`
        );
        continue;
      }

      return {
        command: candidate.command,
        args: candidate.args,
        label: candidate.label,
        version,
      };
    } catch (error) {
      failures.push(`${candidate.label}: ${error.message}`);
      if (String(env.SPLICE_PYTHON_EXECUTABLE || "").trim()) {
        break;
      }
    }
  }

  const details = failures.length > 0 ? ` Tried: ${failures.join(" | ")}` : "";
  throw new Error(
    `Python 3.12+ is required to bootstrap the backend virtual environment.${details} Set SPLICE_PYTHON_EXECUTABLE to a compatible interpreter or install Python 3.12+.`
  );
}

function readBootstrapStamp(stampPath) {
  try {
    return JSON.parse(fs.readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function doesBackendInstallLookReady(venvPythonPath, repoRoot, env = process.env) {
  const result = runCommand(
    venvPythonPath,
    [
      "-c",
      [
        "import importlib.metadata as metadata",
        "import fastapi",
        "import pydantic",
        "import uvicorn",
        "metadata.version('splice-api')",
      ].join("; "),
    ],
    {
      cwd: repoRoot,
      env,
      description: "Backend dependency probe",
    }
  );

  return result.status === 0;
}

async function ensureBackendRuntimePrerequisites(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const env = options.env || process.env;
  const pyprojectPath = path.join(repoRoot, BACKEND_MANIFEST_PATH);
  const venvDirectory = path.join(repoRoot, ".venv");
  const venvPythonPath = getVenvPythonPath(repoRoot);
  const stampPath = path.join(venvDirectory, BACKEND_BOOTSTRAP_STAMP_NAME);
  const pyprojectStat = fs.statSync(pyprojectPath);
  const explicitPython = String(env.SPLICE_PYTHON_EXECUTABLE || "").trim();

  if (!fs.existsSync(venvPythonPath)) {
    const bootstrapPython = resolveBootstrapPythonExecutable(env, repoRoot);
    runCommand(
      bootstrapPython.command,
      [...bootstrapPython.args, "-m", "venv", venvDirectory],
      {
        cwd: repoRoot,
        env,
        description: "Python virtual environment creation",
      }
    );
  }

  const currentVenvPython = getVenvPythonPath(repoRoot);
  if (!fs.existsSync(currentVenvPython)) {
    throw new Error(
      `Python virtual environment bootstrap did not create a usable interpreter at ${currentVenvPython}. Remove .venv and rerun the bootstrap command.`
    );
  }

  const stamp = readBootstrapStamp(stampPath);
  const stampMatches = Boolean(
    stamp &&
      stamp.pyprojectMtimeMs === pyprojectStat.mtimeMs &&
      stamp.installTarget === BACKEND_INSTALL_TARGET
  );

  if (stampMatches) {
    try {
      if (doesBackendInstallLookReady(currentVenvPython, repoRoot, env)) {
        return {
          repoRoot,
          venvPythonPath: currentVenvPython,
          pythonVersion: stamp.pythonVersion || null,
          installed: false,
          reusedBootstrap: true,
        };
      }
    } catch {
      // Fall through to reinstall on any probe failure.
    }
  }

  const installResult = runCommand(
    currentVenvPython,
    ["-m", "pip", "install", "-e", BACKEND_INSTALL_TARGET],
    {
      cwd: repoRoot,
      env,
      description: "Backend dependency installation",
    }
  );

  const verification = runCommand(
    currentVenvPython,
    [
      "-c",
      [
        "import importlib.metadata as metadata",
        "import fastapi",
        "import pydantic",
        "import uvicorn",
        "metadata.version('splice-api')",
      ].join("; "),
    ],
    {
      cwd: repoRoot,
      env,
      description: "Backend dependency verification",
    }
  );

  const versionProbe = runCommand(
    currentVenvPython,
    [
      "-c",
      "import sys; print('.'.join(str(part) for part in sys.version_info[:3]))",
    ],
    {
      cwd: repoRoot,
      env,
      description: "Python version verification",
    }
  );

  await fsp.mkdir(path.dirname(stampPath), { recursive: true });
  await fsp.writeFile(
    stampPath,
    `${JSON.stringify(
      {
        pyprojectMtimeMs: pyprojectStat.mtimeMs,
        installTarget: BACKEND_INSTALL_TARGET,
        pythonVersion: String(versionProbe.stdout || "").trim(),
        bootstrappedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    repoRoot,
    venvPythonPath: currentVenvPython,
    pythonVersion: String(versionProbe.stdout || "").trim() || null,
    installed: true,
    reusedBootstrap: false,
    installStdout: String(installResult.stdout || ""),
    verifyStdout: String(verification.stdout || ""),
    explicitPython: explicitPython || null,
  };
}

function createBackendProcess(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const baseUrl = normalizeUrlString(options.baseUrl || resolveBackendBaseUrl(options.env));
  const parsedUrl = new URL(baseUrl);
  const pythonExecutable = options.pythonExecutable || getVenvPythonPath(repoRoot);
  const childEnv = {
    ...process.env,
    ...(options.env || {}),
    SPLICE_API_BASE_URL: baseUrl,
  };

  const child = spawn(
    pythonExecutable,
    [
      "-m",
      "uvicorn",
      "app.main:app",
      "--app-dir",
      "apps/api",
      "--host",
      parsedUrl.hostname,
      "--port",
      parsedUrl.port || "8017",
    ],
    {
      cwd: repoRoot,
      env: childEnv,
      stdio: "pipe",
      windowsHide: true,
    }
  );

  return {
    childProcess: child,
    baseUrl,
  };
}

async function probeBackendHealth(baseUrl, options = {}) {
  const normalizedBaseUrl = normalizeUrlString(baseUrl);
  const healthUrl = new URL("/health/live", normalizedBaseUrl).toString();
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Health probe timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    return {
      healthy: response.ok,
      statusCode: response.status,
      healthUrl,
    };
  } catch (error) {
    return {
      healthy: false,
      error,
      healthUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

function terminateBackendProcess(pid) {
  if (!pid) {
    return false;
  }

  try {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      if (result.status !== 0) {
        return false;
      }
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch (error) {
    if (error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function bootstrapE2EBackend(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const env = options.env || process.env;
  const baseUrl = normalizeUrlString(resolveBackendBaseUrl(env));
  const probeHealth =
    typeof options.probeHealth === "function"
      ? options.probeHealth
      : (url, probeOptions) => probeBackendHealth(url, probeOptions);
  const healthProbe = await probeHealth(baseUrl, {
    timeoutMs: options.healthProbeTimeoutMs,
  });

  if (healthProbe.healthy) {
    return {
      apiBaseUrl: baseUrl,
      reusedExistingBackend: true,
      spawnedBackend: false,
      backendPid: null,
      healthUrl: healthProbe.healthUrl,
      healthStatusCode: healthProbe.statusCode,
    };
  }

  if (!isLoopbackBackendUrl(baseUrl)) {
    const reason = healthProbe.error ? ` ${healthProbe.error.message}` : "";
    throw new Error(
      `Configured PW_API_BASE_URL "${baseUrl}" is not healthy and cannot be auto-booted because it does not point to a localhost backend.${reason}`
    );
  }

  const runPrerequisiteBootstrap =
    typeof options.ensureBackendRuntimePrerequisites === "function"
      ? options.ensureBackendRuntimePrerequisites
      : (bootstrapOptions) => ensureBackendRuntimePrerequisites(bootstrapOptions);
  const prerequisites = await runPrerequisiteBootstrap({
    repoRoot,
    env,
  });

  const spawnBackend =
    typeof options.createBackendProcess === "function"
      ? options.createBackendProcess
      : (spawnOptions) => createBackendProcess(spawnOptions);
  const backend = await spawnBackend({
    repoRoot,
    env,
    baseUrl,
    pythonExecutable: prerequisites.venvPythonPath,
  });

  const stderrBuffer = [];
  let backendSpawnError = null;
  let backendExited = false;

  if (backend.childProcess.stderr && typeof backend.childProcess.stderr.on === "function") {
    backend.childProcess.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderrBuffer.push(text);
      if (stderrBuffer.length > 25) {
        stderrBuffer.shift();
      }
    });
  }

  backend.childProcess.on("error", (error) => {
    backendSpawnError = error;
    stderrBuffer.push(`[spawn-error] ${error.message}`);
    if (stderrBuffer.length > 25) {
      stderrBuffer.shift();
    }
  });

  backend.childProcess.on("exit", () => {
    backendExited = true;
  });

  try {
    const waitForReady =
      typeof options.waitForBackendReady === "function"
        ? options.waitForBackendReady
        : (waitOptions) => waitForBackendReadyDefault(waitOptions);
    const readiness = await waitForReady({
      check: async () => {
        if (backendSpawnError) {
          throw backendSpawnError;
        }
        if (backendExited || backend.childProcess.exitCode !== null || backend.childProcess.killed) {
          throw new Error("Backend process exited before becoming ready");
        }
        const check = await probeHealth(baseUrl, {
          timeoutMs: options.healthProbeTimeoutMs,
        });
        if (!check.healthy) {
          throw check.error || new Error(`Backend health check returned ${check.statusCode || "unhealthy"}`);
        }
        return true;
      },
      endpoint: new URL("/health/live", baseUrl).toString(),
      timeoutMs: Number.isInteger(options.startupTimeoutMs) ? options.startupTimeoutMs : 20_000,
      intervalMs: Number.isInteger(options.pollIntervalMs) ? options.pollIntervalMs : 250,
    });

    return {
      apiBaseUrl: baseUrl,
      reusedExistingBackend: false,
      spawnedBackend: true,
      backendPid: backend.childProcess.pid || null,
      healthUrl: new URL("/health/live", baseUrl).toString(),
      startupAttempts: readiness.attempts,
      startupDurationMs: readiness.durationMs,
      venvPythonPath: prerequisites.venvPythonPath,
    };
  } catch (error) {
    const stderrTail = stderrBuffer.join("").trim();
    terminateBackendProcess(backend.childProcess.pid || null);
    const details = stderrTail ? ` stderr: ${stderrTail}` : "";
    throw new Error(
      `Backend failed readiness checks at ${new URL("/health/live", baseUrl).toString()}. ${error.message}${details}`
    );
  }
}

module.exports = {
  BACKEND_INSTALL_TARGET,
  BACKEND_MANIFEST_PATH,
  DEFAULT_BACKEND_BASE_URL,
  bootstrapE2EBackend,
  createBackendProcess,
  doesBackendInstallLookReady,
  ensureBackendRuntimePrerequisites,
  getBootstrapPythonCandidates,
  getVenvPythonPath,
  isLoopbackBackendUrl,
  normalizeUrlString,
  probeBackendHealth,
  readBootstrapStamp,
  resolveBackendBaseUrl,
  resolveBootstrapPythonExecutable,
  resolveRepoRoot,
  runCommand,
  terminateBackendProcess,
};

if (require.main === module) {
  (async () => {
    try {
      const result = await ensureBackendRuntimePrerequisites({
        repoRoot: resolveRepoRoot(),
      });
      process.stdout.write(
        `Python backend prerequisites ready at ${result.venvPythonPath}\n`
      );
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    }
  })();
}
