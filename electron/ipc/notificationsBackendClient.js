const { AUTH_ERROR_CODES } = require("./contracts");

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const KNOWN_ERROR_CODES = new Set(AUTH_ERROR_CODES);

class NotificationsBackendClientError extends Error {
  constructor({ code, message, reason }) {
    super(message);
    this.name = "NotificationsBackendClientError";
    this.code = code;
    this.reason = reason;
  }
}

function normalizeBaseUrl(rawBaseUrl) {
  const value = String(rawBaseUrl || DEFAULT_API_BASE_URL).trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function mapNotification(item) {
  return {
    notificationId: item.notification_id,
    type: item.type,
    severity: item.severity,
    status: item.status,
    channel: item.channel,
    title: item.title,
    message: item.message,
    submissionId: item.submission_id,
    read: Boolean(item.read),
    readAt: item.read_at ? toIsoString(item.read_at) : null,
    attempts: item.attempts,
    maxAttempts: item.max_attempts,
    createdAt: toIsoString(item.created_at),
    updatedAt: toIsoString(item.updated_at),
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

    if (KNOWN_ERROR_CODES.has(code) && message.length > 0) {
      throw new NotificationsBackendClientError({
        code,
        message,
        reason: `NOTIFICATIONS_SERVICE_ERROR:${responseStatus}`,
      });
    }
  }

  if (payload && Array.isArray(payload.detail)) {
    throw new NotificationsBackendClientError({
      code: "VALIDATION_ERROR",
      message: "Notifications request failed validation",
      reason: parseFastapiValidationReason(payload),
    });
  }

  throw new NotificationsBackendClientError({
    code: "INTERNAL_ERROR",
    message: "Notifications backend request failed",
    reason: `NOTIFICATIONS_BACKEND_HTTP_${responseStatus}`,
  });
}

function createNotificationsBackendClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SPLICE_API_URL);
  const logger = options.logger || null;
  const internalSecret = options.internalSecret || process.env.SPLICE_INTERNAL_SECRET || null;
  const internalToken = String(options.internalToken || process.env.SPLICE_INTERNAL_API_TOKEN || "").trim();

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for notifications backend client");
  }

  async function request(pathname, method, payload) {
    const requestUrl = `${baseUrl}${pathname}`;
    const actorId = payload?.actor_id || payload?.actorId || null;
    const actorRole = payload?.actor_role || payload?.actorRole || null;
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (actorId && actorRole) {
      headers["X-Actor-Id"] = String(actorId);
      headers["X-Actor-Role"] = String(actorRole);
    }
    if (internalSecret) {
      headers["X-Internal-Secret"] = internalSecret;
    }
    if (pathname.startsWith("/internal/")) {
      if (!internalToken) {
        throw new NotificationsBackendClientError({
          code: "INTERNAL_ERROR",
          message: "Internal API token is not configured",
          reason: "NOTIFICATIONS_INTERNAL_TOKEN_MISSING",
        });
      }
      headers["X-Internal-Token"] = internalToken;
    }
    const startedAt = Date.now();
    if (typeof logger?.info === "function") {
      logger.info("Backend request started", {
        backend: "notifications",
        method,
        endpoint: pathname,
        url: requestUrl,
      });
    }

    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method,
        headers,
        body: method === "GET" || !payload ? undefined : JSON.stringify(payload),
      });
    } catch (error) {
      if (typeof logger?.error === "function") {
        logger.error("Backend request failed", {
          backend: "notifications",
          method,
          endpoint: pathname,
          url: requestUrl,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
      }
      throw new NotificationsBackendClientError({
        code: "INTERNAL_ERROR",
        message: "Notifications backend is unavailable",
        reason: `NOTIFICATIONS_BACKEND_UNREACHABLE:${error.message}`,
      });
    }

    if (typeof logger?.info === "function") {
      logger.info("Backend request completed", {
        backend: "notifications",
        method,
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
    async list(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        include_read: payload.includeRead ? "true" : "false",
      });
      const responsePayload = await request(`/notifications?${params.toString()}`, "GET", {
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      return {
        notifications: Array.isArray(responsePayload.notifications)
          ? responsePayload.notifications.map(mapNotification)
          : [],
      };
    },
    async markRead(payload) {
      const responsePayload = await request("/notifications/mark-read", "POST", {
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        notification_ids: payload.notificationIds,
      });
      return {
        updatedCount: responsePayload.updated_count,
      };
    },
    async markAllRead(payload) {
      const responsePayload = await request("/notifications/mark-all-read", "POST", {
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      return {
        updatedCount: responsePayload.updated_count,
      };
    },
    async retry(payload) {
      const responsePayload = await request("/notifications/retry", "POST", {
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        notification_id: payload.notificationId,
      });
      return {
        notification: mapNotification(responsePayload.notification),
      };
    },
  });
}

module.exports = {
  NotificationsBackendClientError,
  createNotificationsBackendClient,
};
