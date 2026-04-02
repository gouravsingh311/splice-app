const { AUTH_ERROR_CODES } = require("./contracts");

const DEFAULT_AUTH_BASE_URL = "http://127.0.0.1:8017";

const KNOWN_AUTH_ERROR_CODES = new Set(AUTH_ERROR_CODES);

class AuthBackendClientError extends Error {
  constructor({ code, message, reason }) {
    super(message);
    this.name = "AuthBackendClientError";
    this.code = code;
    this.reason = reason;
  }
}

function normalizeBaseUrl(rawBaseUrl) {
  const value = String(rawBaseUrl || DEFAULT_AUTH_BASE_URL).trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toSnakeCasePayload(payload) {
  return payload;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function mapUser(userPayload) {
  return {
    id: userPayload.id,
    email: userPayload.email,
    roles: userPayload.roles,
    permissions: userPayload.permissions,
    status: userPayload.status,
    createdAt: toIsoString(userPayload.created_at),
    updatedAt: toIsoString(userPayload.updated_at),
  };
}

function mapTokenBundle(payload) {
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: toIsoString(payload.access_token_expires_at),
    refreshToken: payload.refresh_token,
    refreshTokenExpiresAt: toIsoString(payload.refresh_token_expires_at),
    user: mapUser(payload.user),
  };
}

function mapOtpSend(payload) {
  return {
    challengeId: payload.challenge_id ?? null,
    expiresAt: payload.expires_at ? toIsoString(payload.expires_at) : null,
    cooldownSeconds: payload.cooldown_seconds,
  };
}

function mapOtpVerify(payload) {
  return {
    otpVerificationToken: payload.otp_verification_token,
    expiresAt: toIsoString(payload.expires_at),
  };
}

function mapRevocation(payload) {
  return {
    revokedSessionCount: payload.revoked_session_count,
  };
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseFastapiValidationReason(payload) {
  if (!payload || !Array.isArray(payload.detail) || payload.detail.length === 0) {
    return "FASTAPI_VALIDATION_ERROR";
  }

  return payload.detail
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "INVALID_DETAIL";
      }

      const location = Array.isArray(item.loc) ? item.loc.join(".") : "body";
      return `${location}:${item.msg || "invalid"}`;
    })
    .join("|");
}

function throwMappedError(responseStatus, payload) {
  if (payload && payload.error && typeof payload.error === "object") {
    const code = String(payload.error.code || "").trim();
    const message = String(payload.error.message || "").trim();

    if (KNOWN_AUTH_ERROR_CODES.has(code) && message.length > 0) {
      throw new AuthBackendClientError({
        code,
        message,
        reason: `AUTH_SERVICE_ERROR:${responseStatus}`,
      });
    }
  }

  if (payload && Array.isArray(payload.detail)) {
    throw new AuthBackendClientError({
      code: "VALIDATION_ERROR",
      message: "Auth request failed validation",
      reason: parseFastapiValidationReason(payload),
    });
  }

  throw new AuthBackendClientError({
    code: "INTERNAL_ERROR",
    message: "Auth backend request failed",
    reason: `AUTH_BACKEND_HTTP_${responseStatus}`,
  });
}

function createAuthBackendClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SPLICE_API_URL);
  const internalSecret = options.internalSecret || process.env.SPLICE_INTERNAL_SECRET || null;
  const logger = options.logger || null;

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for auth backend client");
  }

  async function post(pathname, payload) {
    const requestUrl = `${baseUrl}${pathname}`;
    const startedAt = Date.now();
    if (typeof logger?.info === "function") {
      logger.info("Backend request started", {
        backend: "auth",
        method: "POST",
        endpoint: pathname,
        url: requestUrl,
      });
    }

    let response;
    try {
      const headers = {
        "content-type": "application/json",
      };
      if (internalSecret) {
        headers["X-Internal-Secret"] = internalSecret;
      }

      response = await fetchImpl(requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(toSnakeCasePayload(payload)),
      });
    } catch (error) {
      if (typeof logger?.error === "function") {
        logger.error("Backend request failed", {
          backend: "auth",
          method: "POST",
          endpoint: pathname,
          url: requestUrl,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
      }
      throw new AuthBackendClientError({
        code: "INTERNAL_ERROR",
        message: "Auth backend is unavailable",
        reason: `AUTH_BACKEND_UNREACHABLE:${error.message}`,
      });
    }

    if (typeof logger?.info === "function") {
      logger.info("Backend request completed", {
        backend: "auth",
        method: "POST",
        endpoint: pathname,
        url: requestUrl,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    const parsedPayload = await readJsonSafely(response);
    if (!response.ok) {
      throwMappedError(response.status, parsedPayload);
    }

    return parsedPayload;
  }

  return Object.freeze({
    async login(payload) {
      const responsePayload = await post("/auth/login", {
        email: payload.email,
        password: payload.password,
        device_id: payload.deviceId || null,
      });
      return mapTokenBundle(responsePayload);
    },
    async register(payload) {
      const responsePayload = await post("/auth/register", {
        email: payload.email,
        password: payload.password,
        otp_verification_token: payload.otpVerificationToken,
        roles: payload.roles,
        device_id: payload.deviceId || null,
      });
      return mapTokenBundle(responsePayload);
    },
    async sendOtp(payload) {
      const responsePayload = await post("/auth/otp/send", {
        target: payload.target,
        purpose: payload.purpose,
      });
      return mapOtpSend(responsePayload);
    },
    async verifyOtp(payload) {
      const responsePayload = await post("/auth/otp/verify", {
        challenge_id: payload.challengeId,
        purpose: payload.purpose,
        otp_code: payload.otpCode,
      });
      return mapOtpVerify(responsePayload);
    },
    async forgotPassword(payload) {
      const responsePayload = await post("/auth/forgot-password", {
        email: payload.email,
      });
      return mapOtpSend(responsePayload);
    },
    async resetPassword(payload) {
      const responsePayload = await post("/auth/reset-password", {
        email: payload.email,
        otp_verification_token: payload.otpVerificationToken,
        new_password: payload.newPassword,
      });
      return mapRevocation(responsePayload);
    },
  });
}

module.exports = {
  AuthBackendClientError,
  createAuthBackendClient,
};
