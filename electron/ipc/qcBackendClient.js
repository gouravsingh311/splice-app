const { AUTH_ERROR_CODES } = require("./contracts");

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8017";
const KNOWN_QC_ERROR_CODES = new Set(AUTH_ERROR_CODES);

class QcBackendClientError extends Error {
  constructor({ code, message, reason }) {
    super(message);
    this.name = "QcBackendClientError";
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

function mapRuleBinding(binding) {
  const params =
    binding && typeof binding.params === "object" && !Array.isArray(binding.params)
      ? binding.params
      : {};
  return {
    ruleId: binding.rule_id,
    enabled: Boolean(binding.enabled),
    blockingOverride:
      typeof binding.blocking_override === "boolean" ? binding.blocking_override : null,
    params,
  };
}

function mapPolicy(policyPayload) {
  return {
    policyId: policyPayload.policy_id,
    policyVersion: policyPayload.policy_version,
    ruleSetVersion: policyPayload.rule_set_version,
    rules: Array.isArray(policyPayload.rules) ? policyPayload.rules.map(mapRuleBinding) : [],
    updatedBy: policyPayload.updated_by,
    updatedAt: toIsoString(policyPayload.updated_at),
    reason: policyPayload.reason,
  };
}

function mapRuleDefinition(rulePayload) {
  return {
    ruleId: rulePayload.rule_id,
    title: rulePayload.title,
    description: rulePayload.description,
    severity: rulePayload.severity,
    blocking: Boolean(rulePayload.blocking),
    category: rulePayload.category,
    remediation: rulePayload.remediation,
    enabled: Boolean(rulePayload.enabled),
  };
}

function mapEvaluationFinding(findingPayload) {
  const context = findingPayload.context || {};
  return {
    findingId: findingPayload.finding_id,
    ruleId: findingPayload.rule_id,
    severity: findingPayload.severity,
    blocking: Boolean(findingPayload.blocking),
    status: findingPayload.status,
    message: findingPayload.message,
    remediation: findingPayload.remediation,
    context,
  };
}

function inferFindingCategory(ruleId) {
  const value = String(ruleId || "").toUpperCase();
  if (value.includes("AUDIO_ZIP") || value.startsWith("PACK.AUDIO.ZIP")) {
    return "audio-zip";
  }
  if (
    value.includes("SAMPLE") ||
    value.startsWith("PACK.SAMPLE") ||
    value.startsWith("PACK.NAMING")
  ) {
    return "samples";
  }
  if (value.includes("DEMO")) {
    return "demo";
  }
  if (value.includes("DESCRIPTION")) {
    return "description";
  }
  if (value.includes("ARTWORK") || value.includes("ART")) {
    return "artwork";
  }
  if (value.includes("PRESET")) {
    return "presets";
  }
  if (value.includes("MIDI")) {
    return "midi";
  }
  return "folder";
}

function mapReportFinding(findingPayload) {
  const context = findingPayload.context || {};
  const fileRef =
    (typeof findingPayload.file_ref === "string" && findingPayload.file_ref) ||
    (typeof findingPayload.fileRef === "string" && findingPayload.fileRef) ||
    (typeof context.file_ref === "string" && context.file_ref) ||
    (typeof context.fileRef === "string" && context.fileRef) ||
    (typeof context.path === "string" && context.path) ||
    (typeof context.file === "string" && context.file) ||
    (typeof context.relative_path === "string" && context.relative_path) ||
    (typeof context.audio_zip_filename === "string" && context.audio_zip_filename) ||
    (typeof context.filename === "string" && context.filename) ||
    null;

  return {
    findingId: findingPayload.finding_id,
    ruleId: findingPayload.rule_id,
    severity: findingPayload.severity,
    category: inferFindingCategory(findingPayload.rule_id),
    fileRef,
    message: findingPayload.message,
    remediation: findingPayload.remediation,
    diffTag: "unchanged",
  };
}

function mapEvaluationResult(payload) {
  return {
    report: {
      reportId: payload.report.report_id,
      submissionId: payload.report.submission_id,
      status: payload.report.status,
      summary: {
        blockingFailures: payload.report.summary.blocking_failures,
        warnings: payload.report.summary.warnings,
        evaluatedRuleCount: payload.report.summary.evaluated_rule_count,
      },
      findings: Array.isArray(payload.report.findings)
        ? payload.report.findings.map(mapEvaluationFinding)
        : [],
      generatedAt: toIsoString(payload.report.generated_at),
      ruleSetVersion: payload.report.rule_set_version,
      policyVersion: payload.report.policy_version,
    },
    idempotent: Boolean(payload.idempotent),
    appliedPolicyId: payload.applied_policy_id,
  };
}

function mapPersistedRun(runPayload) {
  return {
    runId: runPayload.run_id,
    submissionId: runPayload.submission_id,
    status: runPayload.status,
    startedAt: toIsoString(runPayload.started_at),
    completedAt: toIsoString(runPayload.completed_at),
    generatedAt: toIsoString(runPayload.generated_at),
    ruleSetVersion: runPayload.rule_set_version,
    policyVersion: runPayload.policy_version,
    findings: Array.isArray(runPayload.findings)
      ? runPayload.findings.map(mapReportFinding)
      : [],
  };
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

    if (message.length > 0) {
      const surfacedCode = KNOWN_QC_ERROR_CODES.has(code) ? code : "INTERNAL_ERROR";
      throw new QcBackendClientError({
        code: surfacedCode,
        message,
        reason: `QC_SERVICE_ERROR:${responseStatus}:${code || "UNKNOWN_CODE"}`,
      });
    }
  }

  if (payload && Array.isArray(payload.detail)) {
    throw new QcBackendClientError({
      code: "VALIDATION_ERROR",
      message: "QC request failed validation",
      reason: parseFastapiValidationReason(payload),
    });
  }

  throw new QcBackendClientError({
    code: "INTERNAL_ERROR",
    message: "QC backend request failed",
    reason: `QC_BACKEND_HTTP_${responseStatus}`,
  });
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createQcBackendClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SPLICE_API_URL);
  const internalSecret = options.internalSecret || process.env.SPLICE_INTERNAL_SECRET || null;
  const logger = options.logger || null;

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for QC backend client");
  }

  async function request(pathname, method, payload) {
    const requestUrl = `${baseUrl}${pathname}`;
    const startedAt = Date.now();
    if (typeof logger?.info === "function") {
      logger.info("Backend request started", {
        backend: "qc",
        method,
        endpoint: pathname,
        url: requestUrl,
      });
    }

    let response;
    try {
      const headers = {
        "content-type": "application/json",
        accept: "application/json",
      };
      if (internalSecret) {
        headers["X-Internal-Secret"] = internalSecret;
      }

      response = await fetchImpl(requestUrl, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch (error) {
      if (typeof logger?.error === "function") {
        logger.error("Backend request failed", {
          backend: "qc",
          method,
          endpoint: pathname,
          url: requestUrl,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
      }
      throw new QcBackendClientError({
        code: "INTERNAL_ERROR",
        message: "QC backend is unavailable",
        reason: `QC_BACKEND_UNREACHABLE:${error.message}`,
      });
    }

    if (typeof logger?.info === "function") {
      logger.info("Backend request completed", {
        backend: "qc",
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
    async evaluate(payload) {
      const responsePayload = await request("/qc/evaluate", "POST", {
        request_id: payload.requestId,
        submission_id: payload.submissionId,
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        pack: {
          pack_name: payload.pack.packName,
          local_pack_path: payload.pack.localPackPath || null,
          declared_top_level_folders: payload.pack.declaredTopLevelFolders,
          audio_zip: payload.pack.audioZip
            ? {
                filename: payload.pack.audioZip.filename,
                size_bytes: payload.pack.audioZip.sizeBytes,
              }
            : null,
          sample_count: payload.pack.sampleCount,
          contains_unsupported_name_tokens: payload.pack.containsUnsupportedNameTokens,
        },
        rule_set_version: payload.ruleSetVersion || null,
      });
      return mapEvaluationResult(responsePayload);
    },
    async listRules(payload = {}) {
      const params = new URLSearchParams();
      if (typeof payload.includeDisabled === "boolean") {
        params.set("include_disabled", payload.includeDisabled ? "true" : "false");
      }
      if (typeof payload.policyId === "string" && payload.policyId.trim().length > 0) {
        params.set("policy_id", payload.policyId.trim());
      }

      const query = params.toString();
      const responsePayload = await request(`/qc/rules${query ? `?${query}` : ""}`, "GET");

      return {
        rules: Array.isArray(responsePayload.rules)
          ? responsePayload.rules.map(mapRuleDefinition)
          : [],
        policy: mapPolicy(responsePayload.policy || {}),
      };
    },
    async getResults(payload) {
      const responsePayload = await request(
        `/qc/results/${encodeURIComponent(payload.submissionId)}`,
        "GET"
      );
      const latest = mapPersistedRun(responsePayload.latest || {});
      const history = Array.isArray(responsePayload.history)
        ? responsePayload.history.map(mapPersistedRun)
        : [];
      return {
        runId: latest.runId,
        submissionId: latest.submissionId,
        status: latest.status,
        startedAt: latest.startedAt,
        completedAt: latest.completedAt,
        generatedAt: latest.generatedAt,
        ruleSetVersion: latest.ruleSetVersion,
        policyVersion: latest.policyVersion,
        findings: latest.findings,
        history,
      };
    },
    async getActivePolicy(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      const responsePayload = await request(`/admin/qc/policy?${params.toString()}`, "GET");
      return {
        policy: mapPolicy(responsePayload.policy || {}),
      };
    },
    async updateActivePolicy(payload) {
      const responsePayload = await request("/admin/qc/policy", "POST", {
        request_id: payload.requestId,
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        reason: payload.reason,
        expected_policy_version: payload.expectedPolicyVersion ?? null,
        policy: {
          policy_id: payload.policy.policyId,
          rule_set_version: payload.policy.ruleSetVersion || null,
          rules: payload.policy.rules.map((rule) => ({
            rule_id: rule.ruleId,
            enabled: rule.enabled,
            blocking_override: rule.blockingOverride ?? null,
            params:
              rule && typeof rule.params === "object" && !Array.isArray(rule.params)
                ? rule.params
                : {},
          })),
        },
      });

      return {
        policy: mapPolicy(responsePayload.policy || {}),
        auditHook: {
          action: responsePayload.audit_hook.action,
          entityType: responsePayload.audit_hook.entity_type,
          entityId: responsePayload.audit_hook.entity_id,
          actorId: responsePayload.audit_hook.actor_id,
          idempotencyKey: responsePayload.audit_hook.idempotency_key,
          metadata: responsePayload.audit_hook.metadata || {},
        },
        observabilityHook: {
          metricName: responsePayload.observability_hook.metric_name,
          tags: responsePayload.observability_hook.tags || {},
          value: responsePayload.observability_hook.value,
          emittedAt: toIsoString(responsePayload.observability_hook.emitted_at),
        },
      };
    },
  });
}

module.exports = {
  QcBackendClientError,
  createQcBackendClient,
};
