const DEFAULT_AUDIT_LIMIT = 20;
const MAX_AUDIT_LIMIT = 100;
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const AUDIT_ALLOWED_ACTION = "desktop.ipc.allowed.v1";
const AUDIT_DENIED_ACTION = "desktop.ipc.denied.v1";

function clampAuditLimit(value) {
  const parsedLimit = Number.isInteger(value) ? value : DEFAULT_AUDIT_LIMIT;
  return Math.max(1, Math.min(parsedLimit, MAX_AUDIT_LIMIT));
}

function normalizeBaseUrl(rawBaseUrl) {
  const fallback = new URL(DEFAULT_API_BASE_URL);

  if (!rawBaseUrl) {
    return fallback;
  }

  try {
    return new URL(String(rawBaseUrl));
  } catch (error) {
    return fallback;
  }
}

function mapOutcomeToAction(outcome) {
  return outcome === "allowed" ? AUDIT_ALLOWED_ACTION : AUDIT_DENIED_ACTION;
}

function mapAuditActionToOutcome(action) {
  if (action === AUDIT_ALLOWED_ACTION) {
    return "allowed";
  }

  return "denied";
}

function normalizeAuditTimestamp(rawTimestamp) {
  const parsedDate = new Date(String(rawTimestamp || ""));
  if (Number.isNaN(parsedDate.getTime())) {
    return String(rawTimestamp || "");
  }

  return parsedDate.toISOString();
}

function normalizeOptionalQueryValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

async function parseJsonResponse(response, contextLabel) {
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = body?.detail ? ` detail=${JSON.stringify(body.detail)}` : "";
    throw new Error(`${contextLabel} failed with ${response.status}.${detail}`);
  }

  if (!body || typeof body !== "object") {
    throw new Error(`${contextLabel} returned invalid response payload.`);
  }

  return body;
}

function createAuditApiClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || console;
  const internalToken = String(options.internalToken || process.env.SPLICE_INTERNAL_API_TOKEN || "").trim();
  const internalSecret = String(options.internalSecret || process.env.SPLICE_INTERNAL_SECRET || "").trim();
  const auditActorId = String(options.auditActorId || process.env.SPLICE_AUDIT_ACTOR_ID || "system");
  const auditActorRole = String(
    options.auditActorRole || process.env.SPLICE_AUDIT_ACTOR_ROLE || "admin"
  );

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for audit API client.");
  }
  if (!internalToken) {
    throw new Error("Missing required internal API token for audit client.");
  }

  async function appendSecurityEvent(event) {
    const endpoint = new URL("/internal/audit/append", baseUrl);
    const startedAt = Date.now();
    const payload = {
      schema_version: 1,
      actor_id: event.actorId || null,
      action: mapOutcomeToAction(event.outcome),
      entity_type: "desktop",
      entity_id: event.channel,
      metadata: {
        channel: event.channel,
        reason: event.reason,
      },
      request_id: null,
      idempotency_key: `${event.id}:${event.timestamp}`,
    };

    if (typeof logger.info === "function") {
      logger.info("Backend request started", {
        backend: "audit",
        method: "POST",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
      });
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Internal-Token": internalToken,
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (typeof logger.info === "function") {
      logger.info("Backend request completed", {
        backend: "audit",
        method: "POST",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    await parseJsonResponse(response, "Audit append request");
  }

  async function listSecurityEvents(optionsArg = {}) {
    const limit = clampAuditLimit(optionsArg.limit);
    const endpoint = new URL("/audit/events", baseUrl);
    const startedAt = Date.now();
    endpoint.searchParams.set("entity_type", "desktop");
    endpoint.searchParams.set("limit", String(limit));
    endpoint.searchParams.set("offset", "0");
    endpoint.searchParams.set("actor_id", auditActorId);
    endpoint.searchParams.set("actor_role", auditActorRole);

    if (typeof logger.info === "function") {
      logger.info("Backend request started", {
        backend: "audit",
        method: "GET",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
      });
    }

    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-Actor-Id": auditActorId,
        "X-Actor-Role": auditActorRole,
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
    });

    if (typeof logger.info === "function") {
      logger.info("Backend request completed", {
        backend: "audit",
        method: "GET",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    const payload = await parseJsonResponse(response, "Audit list request");
    const events = Array.isArray(payload.events) ? payload.events : [];

    return events.map((event) => {
      return {
        id: String(event.id || ""),
        channel: event.entity_id || event.metadata?.channel || "unknown-channel",
        actorId: event.actor_id || "unknown-actor",
        outcome: mapAuditActionToOutcome(event.action),
        reason: event.metadata?.reason || "UNSPECIFIED",
        timestamp: normalizeAuditTimestamp(event.created_at),
      };
    });
  }

  async function listAuditEvents(optionsArg = {}) {
    const limit = clampAuditLimit(
      Number.isInteger(optionsArg.limit) ? optionsArg.limit : DEFAULT_AUDIT_LIMIT
    );
    const offset = Math.max(0, Number.parseInt(String(optionsArg.offset || "0"), 10) || 0);
    const actorId = normalizeOptionalQueryValue(optionsArg.actorId || auditActorId) || auditActorId;
    const actorRole =
      normalizeOptionalQueryValue(optionsArg.actorRole || auditActorRole) || auditActorRole;
    const endpoint = new URL("/audit/events", baseUrl);
    const startedAt = Date.now();

    endpoint.searchParams.set("actor_id", actorId);
    endpoint.searchParams.set("actor_role", actorRole);
    endpoint.searchParams.set("limit", String(limit));
    endpoint.searchParams.set("offset", String(offset));

    const optionalFields = [
      ["action", optionsArg.action],
      ["entity_type", optionsArg.entityType],
      ["entity_id", optionsArg.entityId],
      ["from", optionsArg.from],
      ["to", optionsArg.to],
    ];
    for (const [key, rawValue] of optionalFields) {
      const value = normalizeOptionalQueryValue(rawValue);
      if (value) {
        endpoint.searchParams.set(key, value);
      }
    }

    if (typeof logger.info === "function") {
      logger.info("Backend request started", {
        backend: "audit",
        method: "GET",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
      });
    }

    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-Actor-Id": actorId,
        "X-Actor-Role": actorRole,
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
    });

    if (typeof logger.info === "function") {
      logger.info("Backend request completed", {
        backend: "audit",
        method: "GET",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    return parseJsonResponse(response, "Audit events list request");
  }

  async function exportAuditEvents(optionsArg = {}) {
    const actorId = normalizeOptionalQueryValue(optionsArg.actorId || auditActorId) || auditActorId;
    const actorRole =
      normalizeOptionalQueryValue(optionsArg.actorRole || auditActorRole) || auditActorRole;
    const endpoint = new URL("/audit/export", baseUrl);
    const startedAt = Date.now();

    endpoint.searchParams.set("actor_id", actorId);
    endpoint.searchParams.set("actor_role", actorRole);
    endpoint.searchParams.set("format", normalizeOptionalQueryValue(optionsArg.format) || "json");
    endpoint.searchParams.set(
      "include_hash_chain",
      optionsArg.includeHashChain === false ? "false" : "true"
    );
    endpoint.searchParams.set("limit", String(clampAuditLimit(optionsArg.limit)));

    const optionalFields = [
      ["action", optionsArg.action],
      ["entity_type", optionsArg.entityType],
      ["entity_id", optionsArg.entityId],
      ["from", optionsArg.from],
      ["to", optionsArg.to],
    ];
    for (const [key, rawValue] of optionalFields) {
      const value = normalizeOptionalQueryValue(rawValue);
      if (value) {
        endpoint.searchParams.set(key, value);
      }
    }

    if (typeof logger.info === "function") {
      logger.info("Backend request started", {
        backend: "audit",
        method: "GET",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
      });
    }

    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-Actor-Id": actorId,
        "X-Actor-Role": actorRole,
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
    });

    if (typeof logger.info === "function") {
      logger.info("Backend request completed", {
        backend: "audit",
        method: "GET",
        endpoint: endpoint.pathname,
        url: endpoint.toString(),
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    return parseJsonResponse(response, "Audit export request");
  }

  function reportRemoteFailure(operation, error) {
    if (typeof logger.warn === "function") {
      logger.warn("Audit backend request failed", {
        operation,
        baseUrl: baseUrl.toString(),
        error: error.message,
      });
    }
  }

  return {
    appendSecurityEvent,
    listSecurityEvents,
    listAuditEvents,
    exportAuditEvents,
    reportRemoteFailure,
  };
}

function createSecurityAuditLog(options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const remoteClient = options.remoteClient || null;
  const events = [];
  let nextId = 1;

  async function appendRemote(event) {
    if (!remoteClient || typeof remoteClient.appendSecurityEvent !== "function") {
      return;
    }

    try {
      await remoteClient.appendSecurityEvent(event);
    } catch (error) {
      if (typeof remoteClient.reportRemoteFailure === "function") {
        remoteClient.reportRemoteFailure("append", error);
      }
    }
  }

  function append(input) {
    const event = {
      id: `ipc-sec-${String(nextId).padStart(6, "0")}`,
      channel: input.channel,
      actorId: input.actorId || "unknown-actor",
      outcome: input.outcome,
      reason: input.reason,
      timestamp: now(),
    };

    nextId += 1;
    events.push(event);
    void appendRemote(event);
    return event;
  }

  function list(optionsArg = {}) {
    const safeLimit = clampAuditLimit(optionsArg.limit);
    return events.slice(-safeLimit).reverse();
  }

  async function listForChannel(optionsArg = {}) {
    if (!remoteClient || typeof remoteClient.listSecurityEvents !== "function") {
      return list(optionsArg);
    }

    try {
      const remoteEvents = await remoteClient.listSecurityEvents(optionsArg);
      if (Array.isArray(remoteEvents) && remoteEvents.length > 0) {
        return remoteEvents;
      }
    } catch (error) {
      if (typeof remoteClient.reportRemoteFailure === "function") {
        remoteClient.reportRemoteFailure("list", error);
      }
    }

    return list(optionsArg);
  }

  return {
    append,
    list,
    listForChannel,
  };
}

module.exports = {
  createAuditApiClient,
  createSecurityAuditLog,
};
