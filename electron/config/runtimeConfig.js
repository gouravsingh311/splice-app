const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_ENVIRONMENTS = new Set(["local", "dev", "staging", "prod"]);
const ALLOWED_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function parseBoolean(value, fallbackValue) {
  if (value === undefined || value === null || value === "") {
    return fallbackValue;
  }

  const normalizedValue = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parsePort(value, fallbackPort) {
  if (value === undefined || value === null || value === "") {
    return fallbackPort;
  }

  const parsedPort = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsedPort;
}

function parseEnvironment(rawEnvironment) {
  const environment = String(rawEnvironment || "local").trim().toLowerCase();

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `Invalid SPLICE_ENV "${rawEnvironment}". Expected one of: ${Array.from(ALLOWED_ENVIRONMENTS).join(", ")}`,
    );
  }

  return environment;
}

function parseLogLevel(rawLogLevel) {
  const logLevel = String(rawLogLevel || "info").trim().toLowerCase();

  if (!ALLOWED_LOG_LEVELS.has(logLevel)) {
    throw new Error(
      `Invalid SPLICE_LOG_LEVEL "${rawLogLevel}". Expected one of: ${Array.from(ALLOWED_LOG_LEVELS).join(", ")}`,
    );
  }

  return logLevel;
}

function parseApiBaseUrl(rawApiBaseUrl) {
  const baseUrl = String(rawApiBaseUrl || "http://127.0.0.1:8000").trim();

  let parsedUrl = null;
  try {
    parsedUrl = new URL(baseUrl);
  } catch (error) {
    throw new Error(
      `Invalid SPLICE_API_BASE_URL "${rawApiBaseUrl}". Expected an absolute http/https URL.`,
    );
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(
      `Invalid SPLICE_API_BASE_URL "${rawApiBaseUrl}". Expected http or https protocol.`,
    );
  }

  return parsedUrl.toString().replace(/\/$/, "");
}

function parseDotEnvContent(rawContent) {
  const resolved = {};
  const lines = String(rawContent || "").split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const assignment = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    let value = assignment.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) {
      resolved[key] = value;
    }
  }

  return resolved;
}

function readDotEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return parseDotEnvContent(content);
  } catch {
    return {};
  }
}

function resolveRuntimeEnv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const processEnv = options.processEnv || process.env;
  const envBase = readDotEnvFile(path.join(cwd, ".env"));
  const envLocal = readDotEnvFile(path.join(cwd, ".env.local"));

  return {
    ...envBase,
    ...envLocal,
    ...processEnv,
  };
}

function readRuntimeConfig(env = process.env, packageMetadata = {}) {
  const appName = String(env.SPLICE_APP_NAME || packageMetadata.name || "splice-app").trim();
  const appVersion = String(env.SPLICE_APP_VERSION || packageMetadata.version || "0.0.0").trim();

  const runtimeConfig = {
    appName,
    appVersion,
    environment: parseEnvironment(env.SPLICE_ENV),
    healthPort: parsePort(env.SPLICE_HEALTH_PORT, 4815),
    enableHealthServer: parseBoolean(env.SPLICE_ENABLE_HEALTH_SERVER, true),
    logLevel: parseLogLevel(env.SPLICE_LOG_LEVEL),
    apiBaseUrl: parseApiBaseUrl(env.SPLICE_API_BASE_URL),
    enableScreenShield: parseBoolean(env.SPLICE_SCREEN_SHIELD_ENABLED, true),
  };

  return Object.freeze(runtimeConfig);
}

module.exports = {
  ALLOWED_ENVIRONMENTS,
  resolveRuntimeEnv,
  readRuntimeConfig,
};
