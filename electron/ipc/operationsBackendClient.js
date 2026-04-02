const { AUTH_ERROR_CODES } = require("./contracts");

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8017";
const KNOWN_ERROR_CODES = new Set(AUTH_ERROR_CODES);

class OperationsBackendClientError extends Error {
  constructor({ code, message, reason }) {
    super(message);
    this.name = "OperationsBackendClientError";
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
      throw new OperationsBackendClientError({
        code: KNOWN_ERROR_CODES.has(code) ? code : "INTERNAL_ERROR",
        message,
        reason: `OPERATIONS_SERVICE_ERROR:${responseStatus}`,
      });
    }
  }

  if (payload && Array.isArray(payload.detail)) {
    throw new OperationsBackendClientError({
      code: "VALIDATION_ERROR",
      message: "Operations request failed validation",
      reason: parseFastapiValidationReason(payload),
    });
  }

  throw new OperationsBackendClientError({
    code: "INTERNAL_ERROR",
    message: "Operations backend request failed",
    reason: `OPERATIONS_BACKEND_HTTP_${responseStatus}`,
  });
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapJob(payload) {
  return {
    id: payload.id,
    jobType: payload.job_type,
    idempotencyKey: payload.idempotency_key,
    status: payload.status,
    attemptCount: payload.attempt_count,
    maxAttempts: payload.max_attempts,
    payloadJson: payload.payload_json || {},
    correlationId: payload.correlation_id || null,
    createdAt: toIsoString(payload.created_at),
    startedAt: toIsoString(payload.started_at),
    endedAt: toIsoString(payload.ended_at),
    scheduledFor: toIsoString(payload.scheduled_for),
    nextRetryAt: toIsoString(payload.next_retry_at),
    lastError: payload.last_error || null,
    statusClass: payload.status_class || null,
    failureClass: payload.failure_class || null,
    recommendedAction: payload.recommended_action || "none",
  };
}

function mapSchedule(payload) {
  return {
    submissionId: payload.submission_id,
    preferredMonth: payload.preferred_month,
    plannedReleaseAt: toIsoString(payload.planned_release_at),
    timezone: payload.timezone,
    source: payload.source,
    updatedBy: payload.updated_by,
    updatedAt: toIsoString(payload.updated_at),
    releaseTriggeredAt: toIsoString(payload.release_triggered_at),
    version: payload.version,
  };
}

function mapAnnotation(payload) {
  return {
    id: payload.id,
    source: payload.source,
    severity: payload.severity,
    note: payload.note,
    linkedEntity: payload.linked_entity,
    failureClass: payload.failure_class || null,
    correlationId: payload.correlation_id || null,
    remediationStatus: payload.remediation_status || "open",
    remediationOwner: payload.remediation_owner || null,
    remediationLink: payload.remediation_link || null,
    auditEventId: payload.audit_event_id || null,
    createdAt: toIsoString(payload.created_at),
  };
}

function mapAdminConfig(payload) {
  return {
    id: payload.id,
    configType: payload.config_type,
    version: payload.version,
    payloadJson: payload.payload_json || {},
    publishedBy: payload.published_by || null,
    publishedAt: toIsoString(payload.published_at),
    isDraft: Boolean(payload.is_draft),
    createdAt: toIsoString(payload.created_at),
  };
}

function mapIntegrationHealth(payload) {
  return {
    provider: payload.provider,
    ok: Boolean(payload.ok),
    latencyMs: Number.isInteger(payload.latency_ms) ? payload.latency_ms : 0,
    statusClass: payload.status_class,
    recommendedAction: payload.recommended_action,
    statusCopy: payload.status_copy || "No status copy available.",
    credentialStatus: payload.credential_status || "unknown",
    errorCode: payload.error_code || null,
    lastCheckedAt: toIsoString(payload.last_checked_at),
    lastRotatedAt: toIsoString(payload.last_rotated_at),
    lastFailureContext: payload.last_failure_context || null,
    error: payload.error || null,
  };
}

function mapReviewFlag(payload) {
  return {
    id: payload.id,
    submissionId: payload.submission_id,
    flagType: payload.flag_type,
    severity: payload.severity,
    addedBy: payload.added_by || null,
    createdAt: toIsoString(payload.created_at),
  };
}

function mapReviewQueueItem(payload) {
  return {
    submissionId: payload.submission_id,
    packName: payload.pack_name,
    creatorId: payload.creator_id,
    submittedAt: toIsoString(payload.submitted_at),
    state: payload.state,
    ageDays: payload.age_days,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    flags: Array.isArray(payload.flags) ? payload.flags.map(mapReviewFlag) : [],
  };
}

function mapReviewDetail(payload) {
  return {
    submission: mapReviewQueueItem(payload.submission || {}),
    metadata: payload.metadata || {},
    qcFindings: Array.isArray(payload.qc_findings) ? payload.qc_findings : [],
    transitions: Array.isArray(payload.transitions) ? payload.transitions : [],
    integrationEvents: Array.isArray(payload.integration_events) ? payload.integration_events : [],
    decisions: Array.isArray(payload.decisions) ? payload.decisions : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    flags: Array.isArray(payload.flags) ? payload.flags.map(mapReviewFlag) : [],
  };
}

function mapAirtableState(payload) {
  const mappedPayload = payload.mapped_payload || payload.mappedPayload || null;
  return {
    submissionId: payload.submission_id || payload.submissionId,
    syncStatus: payload.sync_status || payload.syncStatus,
    airtableFormCompleted: Boolean(payload.airtable_form_completed ?? payload.airtableFormCompleted),
    airtablePayloadChecksum: payload.airtable_payload_checksum || payload.airtablePayloadChecksum || null,
    airtableRecordId: payload.airtable_record_id || payload.airtableRecordId || null,
    airtableRecordUrl: payload.airtable_record_url || payload.airtableRecordUrl || null,
    lastSyncedAt: toIsoString(payload.last_synced_at || payload.lastSyncedAt),
    lastErrorCode: payload.last_error_code || payload.lastErrorCode || null,
    lastErrorDetail: payload.last_error_detail || payload.lastErrorDetail || null,
    canonicalRecordId: payload.canonical_record_id || payload.canonicalRecordId || null,
    mappedPayload: mappedPayload
      ? {
          labelName: mappedPayload.label_name || mappedPayload.labelName || null,
          packName: mappedPayload.pack_name || mappedPayload.packName || null,
          releaseMonth: mappedPayload.release_month || mappedPayload.releaseMonth || null,
          notes: mappedPayload.notes || null,
          tags: Array.isArray(mappedPayload.tags) ? mappedPayload.tags : [],
        }
      : null,
  };
}

function mapIntakeSession(payload) {
  return {
    intakeSessionId: payload.intake_session_id,
    submissionId: payload.submission_id,
    creatorId: payload.creator_id,
    packName: payload.pack_name,
    declaredTopLevelFolders: Array.isArray(payload.declared_top_level_folders)
      ? payload.declared_top_level_folders
      : [],
    status: payload.status,
    manifestVersion: Number.isInteger(payload.manifest_version) ? payload.manifest_version : 0,
    metadata: payload.metadata || {},
    createdAt: toIsoString(payload.created_at),
    updatedAt: toIsoString(payload.updated_at),
  };
}

function mapManifest(payload) {
  return {
    manifestVersion: payload.manifest_version,
    locked: Boolean(payload.locked),
    files: Array.isArray(payload.files)
      ? payload.files.map((item) => ({
          relativePath: item.relative_path,
          sizeBytes: item.size_bytes,
          sha256: item.sha256,
          mimeType: item.mime_type,
          category: item.category,
          requiredAsset: Boolean(item.required_asset),
        }))
      : [],
    summary: {
      totalFileCount: payload.summary?.total_file_count || 0,
      totalBytes: payload.summary?.total_bytes || 0,
      countsByCategory: payload.summary?.counts_by_category || {},
      requiredAudioZipPresent: Boolean(payload.summary?.required_audio_zip_present),
    },
    updatedAt: toIsoString(payload.updated_at),
  };
}

function mapStorageHandoff(payload) {
  return {
    handoffId: payload.handoff_id,
    submissionId: payload.submission_id,
    intakeSessionId: payload.intake_session_id,
    status: payload.status,
    target: payload.target,
    progressPercent: Number.isInteger(payload.progress_percent) ? payload.progress_percent : 0,
    uploadedBytes: Number.isInteger(payload.uploaded_bytes) ? payload.uploaded_bytes : 0,
    totalBytes: Number.isInteger(payload.total_bytes) ? payload.total_bytes : 0,
    objectCount: Number.isInteger(payload.object_count) ? payload.object_count : 0,
    uploadedFiles: Number.isInteger(payload.uploaded_files) ? payload.uploaded_files : 0,
    totalFiles: Number.isInteger(payload.total_files) ? payload.total_files : 0,
    checksumVerified: Boolean(payload.checksum_verified),
    createdAt: toIsoString(payload.created_at),
    updatedAt: toIsoString(payload.updated_at),
    completedAt: toIsoString(payload.completed_at),
    error: payload.error || null,
  };
}

function createOperationsBackendClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SPLICE_API_URL);
  const logger = options.logger || null;
  const internalSecret = options.internalSecret || process.env.SPLICE_INTERNAL_SECRET || null;
  const internalToken = String(options.internalToken || process.env.SPLICE_INTERNAL_API_TOKEN || "").trim();

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for operations backend client");
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
        throw new OperationsBackendClientError({
          code: "INTERNAL_ERROR",
          message: "Internal API token is not configured",
          reason: "OPERATIONS_INTERNAL_TOKEN_MISSING",
        });
      }
      headers["X-Internal-Token"] = internalToken;
    }
    const startedAt = Date.now();
    if (typeof logger?.info === "function") {
      logger.info("Backend request started", {
        backend: "operations",
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
          backend: "operations",
          method,
          endpoint: pathname,
          url: requestUrl,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
      }
      throw new OperationsBackendClientError({
        code: "INTERNAL_ERROR",
        message: "Operations backend is unavailable",
        reason: `OPERATIONS_BACKEND_UNREACHABLE:${error.message}`,
      });
    }

    if (typeof logger?.info === "function") {
      logger.info("Backend request completed", {
        backend: "operations",
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

  async function requestText(pathname) {
    const requestUrl = `${baseUrl}${pathname}`;
    const startedAt = Date.now();
    if (typeof logger?.info === "function") {
      logger.info("Backend request started", {
        backend: "operations",
        method: "GET",
        endpoint: pathname,
        url: requestUrl,
      });
    }

    let response;
    try {
      const headers = {
        accept: "text/plain",
      };
      if (internalSecret) {
        headers["X-Internal-Secret"] = internalSecret;
      }

      response = await fetchImpl(requestUrl, {
        method: "GET",
        headers,
      });
    } catch (error) {
      if (typeof logger?.error === "function") {
        logger.error("Backend request failed", {
          backend: "operations",
          method: "GET",
          endpoint: pathname,
          url: requestUrl,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
      }
      throw new OperationsBackendClientError({
        code: "INTERNAL_ERROR",
        message: "Operations backend is unavailable",
        reason: `OPERATIONS_BACKEND_UNREACHABLE:${error.message}`,
      });
    }

    if (typeof logger?.info === "function") {
      logger.info("Backend request completed", {
        backend: "operations",
        method: "GET",
        endpoint: pathname,
        url: requestUrl,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    if (!response.ok) {
      throw new OperationsBackendClientError({
        code: "INTERNAL_ERROR",
        message: "Operations metrics request failed",
        reason: `OPERATIONS_BACKEND_HTTP_${response.status}`,
      });
    }

    return response.text();
  }

  return Object.freeze({
    async getCreatorProfile(payload) {
      const params = new URLSearchParams({
        user_id: payload.userId || "me",
      });
      if (payload.actorId) {
        params.set("actor_id", payload.actorId);
      }
      const responsePayload = await request(`/creator/profile?${params.toString()}`, "GET");
      return {
        userId: responsePayload.user_id,
        displayName: responsePayload.display_name || null,
        labelName: responsePayload.label_name || null,
        defaultsJson: responsePayload.defaults_json || {},
        updatedAt: toIsoString(responsePayload.updated_at),
      };
    },

    async putCreatorProfile(payload) {
      const responsePayload = await request("/creator/profile", "PUT", {
        actor_id: payload.actorId,
        user_id: payload.userId || "me",
        display_name: payload.displayName || null,
        label_name: payload.labelName || null,
        defaults_json: payload.defaultsJson || {},
      });
      return {
        userId: responsePayload.user_id,
        displayName: responsePayload.display_name || null,
        labelName: responsePayload.label_name || null,
        defaultsJson: responsePayload.defaults_json || {},
        updatedAt: toIsoString(responsePayload.updated_at),
      };
    },

    async createSubmissionDraft(payload) {
      const responsePayload = await request("/creator/submissions/draft", "POST", {
        submission_id: payload.submissionId,
        creator_id: payload.creatorId,
        pack_name: payload.packName || null,
        label_name: payload.labelName || null,
        release_month: payload.releaseMonth || null,
        notes: payload.notes || null,
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        airtable_form_completed: Boolean(payload.airtableFormCompleted),
        airtable_payload_checksum: payload.airtablePayloadChecksum || null,
        autosave_json: payload.autosaveJson || {},
      });
      return {
        submission: responsePayload.submission || {},
      };
    },

    async updateSubmissionMetadata(payload) {
      const responsePayload = await request(
        `/creator/submissions/${encodeURIComponent(payload.submissionId)}/metadata`,
        "PUT",
        {
          creator_id: payload.creatorId,
          pack_name: payload.packName || null,
          label_name: payload.labelName || null,
          release_month: payload.releaseMonth || null,
          notes: payload.notes || null,
          tags: Array.isArray(payload.tags) ? payload.tags : [],
          airtable_form_completed: Boolean(payload.airtableFormCompleted),
          airtable_payload_checksum: payload.airtablePayloadChecksum || null,
          autosave_json: payload.autosaveJson || {},
        }
      );
      return {
        submission: responsePayload.submission || {},
      };
    },

    async listSubmissions(payload) {
      const params = new URLSearchParams({
        creator_id: payload.creatorId || "me",
      });
      if (payload.actorId) {
        params.set("actor_id", payload.actorId);
      }
      const responsePayload = await request(`/creator/submissions?${params.toString()}`, "GET");
      return {
        submissions: Array.isArray(responsePayload)
          ? responsePayload.map((item) => ({
              submissionId: item.submission_id,
              creatorId: item.creator_id,
              currentState: item.current_state,
              version: item.version,
              packName: item.pack_name || null,
              labelName: item.label_name || null,
              releaseMonth: item.release_month || null,
              notes: item.notes || null,
              tags: Array.isArray(item.tags) ? item.tags : [],
              airtableFormCompleted: Boolean(item.airtable_form_completed),
              airtablePayloadChecksum: item.airtable_payload_checksum || null,
              airtableSyncStatus: item.airtable_sync_status || null,
              airtableRecordId: item.airtable_record_id || null,
              airtableRecordUrl: item.airtable_record_url || null,
              airtableLastSyncedAt: toIsoString(item.airtable_last_synced_at),
              airtableLastErrorCode: item.airtable_last_error_code || null,
              airtableLastErrorDetail: item.airtable_last_error_detail || null,
              createdAt: toIsoString(item.created_at),
              updatedAt: toIsoString(item.updated_at),
              draftLastSavedAt: toIsoString(item.draft_last_saved_at),
              uploadIntakeSessionId: item.upload_intake_session_id || null,
              uploadHandoffId:
                item.upload_handoff_id ||
                (item.upload_intake_session_id && Number.isInteger(item.upload_manifest_version)
                  ? `handoff:${item.upload_intake_session_id}:${item.upload_manifest_version}`
                  : null),
              uploadManifestVersion: Number.isInteger(item.upload_manifest_version)
                ? item.upload_manifest_version
                : null,
              uploadStatus: item.upload_status || null,
              uploadProgressPercent: Number.isInteger(item.upload_progress_percent)
                ? item.upload_progress_percent
                : 0,
              uploadUploadedBytes: Number.isInteger(item.upload_uploaded_bytes)
                ? item.upload_uploaded_bytes
                : 0,
              uploadTotalBytes: Number.isInteger(item.upload_total_bytes)
                ? item.upload_total_bytes
                : 0,
              uploadUploadedFiles: Number.isInteger(item.upload_uploaded_files)
                ? item.upload_uploaded_files
                : 0,
              uploadTotalFiles: Number.isInteger(item.upload_total_files)
                ? item.upload_total_files
                : 0,
              uploadError: item.upload_error || null,
              uploadUpdatedAt: toIsoString(item.upload_updated_at),
            }))
          : [],
      };
    },

    async syncSubmissionAirtable(payload) {
      const responsePayload = await request(
        `/creator/submissions/${encodeURIComponent(payload.submissionId)}/airtable/sync`,
        "POST",
        {
          creator_id: payload.creatorId,
          force_relink: Boolean(payload.forceRelink),
        }
      );
      return mapAirtableState(responsePayload);
    },

    async resetSubmissionAirtable(payload) {
      const responsePayload = await request(
        `/creator/submissions/${encodeURIComponent(payload.submissionId)}/airtable/reset`,
        "POST",
        {
          creator_id: payload.creatorId,
        }
      );
      return mapAirtableState(responsePayload);
    },

    async getSubmissionTimeline(payload) {
      const params = new URLSearchParams({
        creator_id: payload.creatorId || "me",
      });
      if (payload.actorId) {
        params.set("actor_id", payload.actorId);
      }
      const responsePayload = await request(
        `/creator/submissions/${encodeURIComponent(payload.submissionId)}/timeline?${params.toString()}`,
        "GET"
      );
      return {
        timeline: Array.isArray(responsePayload)
          ? responsePayload.map((item) => ({
              transitionId: item.transition_id,
              fromState: item.from_state,
              toState: item.to_state,
              actorId: item.actor_id,
              actorRole: item.actor_role,
              reason: item.reason,
              reviewDecision: item.review_decision || null,
              reviewReasonCode: item.review_reason_code || null,
              reviewNotes: item.review_notes || null,
              requestId: item.request_id,
              createdAt: toIsoString(item.created_at),
            }))
          : [],
      };
    },

    async startIntakeSession(payload) {
      const responsePayload = await request("/intake/sessions", "POST", {
        request_id: payload.requestId,
        submission_id: payload.submissionId,
        creator_id: payload.creatorId,
        pack_name: payload.packName,
        declared_top_level_folders: payload.declaredTopLevelFolders || [],
        metadata: payload.metadata || {},
      });

      return {
        created: Boolean(responsePayload.created),
        idempotent: Boolean(responsePayload.idempotent),
        session: mapIntakeSession(responsePayload.session || {}),
        event: responsePayload.event || null,
      };
    },

    async upsertIntakeManifest(payload) {
      const responsePayload = await request(
        `/intake/sessions/${encodeURIComponent(payload.intakeSessionId)}/manifest`,
        "PUT",
        {
          request_id: payload.requestId,
          expected_manifest_version: payload.expectedManifestVersion ?? null,
          lock_manifest: Boolean(payload.lockManifest),
          files: (payload.files || []).map((item) => ({
            relative_path: item.relativePath,
            size_bytes: item.sizeBytes,
            sha256: item.sha256,
            mime_type: item.mimeType,
            category: item.category || "other",
            required_asset: Boolean(item.requiredAsset),
          })),
        }
      );

      return {
        idempotent: Boolean(responsePayload.idempotent),
        session: mapIntakeSession(responsePayload.session || {}),
        manifest: mapManifest(responsePayload.manifest || {}),
        event: responsePayload.event || null,
      };
    },

    async createIntakeHandoff(payload) {
      const responsePayload = await request(
        `/intake/sessions/${encodeURIComponent(payload.intakeSessionId)}/handoff`,
        "POST",
        {
          request_id: payload.requestId,
          intake_session_id: payload.intakeSessionId,
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          target: "temporary-object-storage",
        }
      );

      return {
        idempotent: Boolean(responsePayload.idempotent),
        handoff: mapStorageHandoff(responsePayload.handoff || {}),
        event: responsePayload.event || null,
      };
    },

    async getIntakeHandoffStatus(payload) {
      const responsePayload = await request(
        `/storage/handoffs/${encodeURIComponent(payload.handoffId)}`,
        "GET"
      );
      return {
        handoff: mapStorageHandoff(responsePayload.handoff || {}),
      };
    },

    async controlIntakeHandoff(payload) {
      const responsePayload = await request(
        `/storage/handoffs/${encodeURIComponent(payload.handoffId)}/control`,
        "POST",
        {
          action: payload.action,
          request_id: payload.requestId,
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
        }
      );
      return {
        handoff: mapStorageHandoff(responsePayload.handoff || {}),
      };
    },

    async lockSubmissionFiles(payload) {
      const responsePayload = await request(
        `/submissions/${encodeURIComponent(payload.submissionId)}/lock-files`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          intake_session_id: payload.intakeSessionId || null,
        }
      );

      return {
        submissionId: responsePayload.submission_id,
        intakeSessionId: responsePayload.intake_session_id,
        lockedCount: responsePayload.locked_count,
        lockedAt: toIsoString(responsePayload.locked_at),
      };
    },

    async transitionSubmission(payload) {
      const responsePayload = await request(
        `/submissions/${encodeURIComponent(payload.submissionId)}/transition`,
        "POST",
        {
          request_id: payload.requestId,
          to_state: payload.toState,
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          reason: payload.reason || null,
          expected_version: payload.expectedVersion ?? null,
          metadata: payload.metadata || {},
        }
      );

      return {
        submission: responsePayload.submission || {},
        transition: responsePayload.transition || null,
        domainEvent: responsePayload.domain_event || null,
        idempotent: Boolean(responsePayload.idempotent),
        orchestration: responsePayload.orchestration || null,
      };
    },

    async enqueueJob(payload) {
      const responsePayload = await request("/internal/jobs/enqueue", "POST", {
        request_id: payload.requestId,
        job_type: payload.jobType,
        idempotency_key: payload.idempotencyKey,
        payload_json: payload.payloadJson || {},
        max_attempts: payload.maxAttempts ?? 3,
        scheduled_for: payload.scheduledFor || null,
        correlation_id: payload.correlationId || null,
      });

      return {
        idempotent: Boolean(responsePayload.idempotent),
        job: mapJob(responsePayload.job || {}),
      };
    },

    async getJob(payload) {
      const responsePayload = await request(`/admin/jobs/${encodeURIComponent(payload.id)}`, "GET");
      return {
        job: mapJob(responsePayload.job || {}),
        deadLetter: responsePayload.dead_letter
          ? {
              id: responsePayload.dead_letter.id,
              jobRunId: responsePayload.dead_letter.job_run_id,
              payloadJson: responsePayload.dead_letter.payload_json || {},
              failureReason: responsePayload.dead_letter.failure_reason,
              createdAt: toIsoString(responsePayload.dead_letter.created_at),
              replayedAt: toIsoString(responsePayload.dead_letter.replayed_at),
              statusClass: responsePayload.dead_letter.status_class || null,
              failureClass: responsePayload.dead_letter.failure_class || null,
              recommendedAction: responsePayload.dead_letter.recommended_action || "none",
            }
          : null,
      };
    },

    async replayJob(payload) {
      const responsePayload = await request(
        `/admin/jobs/${encodeURIComponent(payload.id)}/replay`,
        "POST",
        {
          request_id: payload.requestId,
          actor_id: payload.actorId,
          reason: payload.reason,
          confirmation: payload.confirmation,
        }
      );

      return {
        idempotent: Boolean(responsePayload.idempotent),
        job: mapJob(responsePayload.job || {}),
        deadLetter: {
          id: responsePayload.dead_letter.id,
          jobRunId: responsePayload.dead_letter.job_run_id,
          payloadJson: responsePayload.dead_letter.payload_json || {},
          failureReason: responsePayload.dead_letter.failure_reason,
          createdAt: toIsoString(responsePayload.dead_letter.created_at),
          replayedAt: toIsoString(responsePayload.dead_letter.replayed_at),
          statusClass: responsePayload.dead_letter.status_class || null,
          failureClass: responsePayload.dead_letter.failure_class || null,
          recommendedAction: responsePayload.dead_letter.recommended_action || "none",
        },
      };
    },

    async resolveSchedule(payload) {
      const responsePayload = await request(
        `/submissions/${encodeURIComponent(payload.submissionId)}/schedule/resolve`,
        "POST",
        {
          request_id: payload.requestId,
          scheduling_event: {
            event_name: payload.schedulingEvent.eventName,
            schema_version: payload.schedulingEvent.schemaVersion,
            submission_id: payload.schedulingEvent.submissionId,
            transition_id: payload.schedulingEvent.transitionId,
            occurred_at: payload.schedulingEvent.occurredAt,
            approved_by: payload.schedulingEvent.approvedBy,
            preferred_release_month: payload.schedulingEvent.preferredReleaseMonth,
            idempotency_key: payload.schedulingEvent.idempotencyKey,
          },
          timezone: payload.timezone || "UTC",
        }
      );

      return {
        idempotent: Boolean(responsePayload.idempotent),
        schedule: mapSchedule(responsePayload.schedule || {}),
        releaseJob: mapJob(responsePayload.release_job || {}),
      };
    },

    async overrideSchedule(payload) {
      const responsePayload = await request(
        `/submissions/${encodeURIComponent(payload.submissionId)}/schedule`,
        "PUT",
        {
          request_id: payload.requestId,
          new_release_at: payload.newReleaseAt,
          reason: payload.reason,
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          timezone: payload.timezone || "UTC",
        }
      );

      return {
        idempotent: Boolean(responsePayload.idempotent),
        schedule: mapSchedule(responsePayload.schedule || {}),
        override: {
          id: responsePayload.override.id,
          submissionId: responsePayload.override.submission_id,
          oldReleaseAt: toIsoString(responsePayload.override.old_release_at),
          newReleaseAt: toIsoString(responsePayload.override.new_release_at),
          reason: responsePayload.override.reason,
          actorId: responsePayload.override.actor_id,
          createdAt: toIsoString(responsePayload.override.created_at),
        },
        releaseJob: mapJob(responsePayload.release_job || {}),
      };
    },

    async triggerRelease(payload) {
      const responsePayload = await request(
        `/submissions/${encodeURIComponent(payload.submissionId)}/release/trigger`,
        "POST",
        {
          request_id: payload.requestId,
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          force: Boolean(payload.force),
          job_run_id: payload.jobRunId || null,
        }
      );

      return {
        idempotent: Boolean(responsePayload.idempotent),
        schedule: mapSchedule(responsePayload.schedule || {}),
        submission: responsePayload.submission || {},
      };
    },

    async listReviewQueue(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      if (payload.state) {
        params.set("state", payload.state);
      }
      if (payload.tag) {
        params.set("tag", payload.tag);
      }
      if (payload.flag) {
        params.set("flag", payload.flag);
      }

      const responsePayload = await request(`/reviews/queue?${params.toString()}`, "GET");
      return {
        items: Array.isArray(responsePayload.items)
          ? responsePayload.items.map(mapReviewQueueItem)
          : [],
      };
    },

    async getReviewSubmission(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      const responsePayload = await request(
        `/reviews/submissions/${encodeURIComponent(payload.submissionId)}?${params.toString()}`,
        "GET"
      );
      return mapReviewDetail(responsePayload);
    },

    async approveReview(payload) {
      const responsePayload = await request(
        `/reviews/submissions/${encodeURIComponent(payload.submissionId)}/approve`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          request_id: payload.requestId || null,
          expected_version: payload.expectedVersion ?? null,
          notes: payload.notes || null,
        }
      );
      return {
        decision: responsePayload.decision || {},
        transition: responsePayload.transition || {},
      };
    },

    async rejectReview(payload) {
      const responsePayload = await request(
        `/reviews/submissions/${encodeURIComponent(payload.submissionId)}/reject`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          request_id: payload.requestId || null,
          expected_version: payload.expectedVersion ?? null,
          reason_code: payload.reasonCode,
          notes: payload.notes,
        }
      );
      return {
        decision: responsePayload.decision || {},
        transition: responsePayload.transition || {},
      };
    },

    async addReviewTag(payload) {
      const responsePayload = await request(
        `/reviews/submissions/${encodeURIComponent(payload.submissionId)}/tags`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          tag: payload.tag,
        }
      );
      return {
        tag: responsePayload.tag || {},
      };
    },

    async addReviewFlag(payload) {
      const responsePayload = await request(
        `/reviews/submissions/${encodeURIComponent(payload.submissionId)}/flags`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          flag_type: payload.flagType,
          severity: payload.severity,
        }
      );
      return {
        flag: responsePayload.flag ? mapReviewFlag(responsePayload.flag) : {},
      };
    },

    async reopenReview(payload) {
      const responsePayload = await request(
        `/reviews/submissions/${encodeURIComponent(payload.submissionId)}/reopen`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          request_id: payload.requestId || null,
          expected_version: payload.expectedVersion ?? null,
          notes: payload.notes || null,
        }
      );
      return {
        decision: responsePayload.decision || {},
        transition: responsePayload.transition || {},
      };
    },

    async getMetrics() {
      const snapshot = await requestText("/metrics");
      return {
        snapshot,
        capturedAt: new Date().toISOString(),
      };
    },

    async annotateIncident(payload) {
      const responsePayload = await request("/admin/incidents/annotations", "POST", {
        source: payload.source,
        severity: payload.severity,
        note: payload.note,
        linked_entity: payload.linkedEntity,
        failure_class: payload.failureClass || null,
        correlation_id: payload.correlationId || null,
        remediation_status: payload.remediationStatus || "open",
        remediation_owner: payload.remediationOwner || null,
        remediation_link: payload.remediationLink || null,
        audit_event_id: payload.auditEventId || null,
        request_id: payload.requestId || null,
        idempotency_key: payload.idempotencyKey || null,
      });

      return {
        idempotent: Boolean(responsePayload.idempotent),
        annotation: mapAnnotation(responsePayload.annotation || {}),
      };
    },

    async listAdminConfigs(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      if (payload.includeDrafts) {
        params.set("include_drafts", "true");
      }
      const responsePayload = await request(`/admin/configs?${params.toString()}`, "GET");
      return {
        configs: Array.isArray(responsePayload.configs)
          ? responsePayload.configs.map(mapAdminConfig)
          : [],
      };
    },

    async createAdminConfigDraft(payload) {
      const responsePayload = await request("/admin/configs/draft", "POST", {
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        config_type: payload.configType,
        payload_json: payload.payloadJson || {},
      });
      return {
        config: mapAdminConfig(responsePayload.config || {}),
      };
    },

    async publishAdminConfig(payload) {
      const responsePayload = await request(
        `/admin/configs/${encodeURIComponent(payload.id)}/publish`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          reason: payload.reason,
          confirmation: payload.confirmation,
        }
      );
      return {
        config: mapAdminConfig(responsePayload.config || {}),
      };
    },

    async rollbackAdminConfig(payload) {
      const responsePayload = await request(
        `/admin/configs/${encodeURIComponent(payload.id)}/rollback`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          reason: payload.reason,
          confirmation: payload.confirmation,
        }
      );
      return {
        config: mapAdminConfig(responsePayload.config || {}),
      };
    },

    async listAdminIntegrationHealth(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      const responsePayload = await request(
        `/admin/integrations/health?${params.toString()}`,
        "GET"
      );
      return {
        integrations: Array.isArray(responsePayload.integrations)
          ? responsePayload.integrations.map(mapIntegrationHealth)
          : [],
      };
    },

    async testAdminIntegration(payload) {
      const responsePayload = await request(
        `/admin/integrations/${encodeURIComponent(payload.provider)}/test`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          key_ref: payload.keyRef || null,
        }
      );
      return mapIntegrationHealth(responsePayload);
    },

    async rotateAdminIntegration(payload) {
      const responsePayload = await request(
        `/admin/integrations/${encodeURIComponent(payload.provider)}/rotate`,
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          reason: payload.reason,
          confirmation: payload.confirmation,
          key_ref: payload.keyRef || null,
        }
      );

      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        rotatedAt: toIsoString(responsePayload.rotated_at),
        keyRef: responsePayload.key_ref,
      };
    },

    async configureAirtableIntegration(payload) {
      const responsePayload = await request(
        "/admin/integrations/airtable/configure",
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          api_key: payload.apiKey,
          submissions_table: payload.submissionsTable || null,
          completion_view: payload.completionView || null,
        }
      );
      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        configuredAt: toIsoString(responsePayload.configured_at),
      };
    },

    async configureSmtpIntegration(payload) {
      const responsePayload = await request(
        "/admin/integrations/smtp/configure",
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          host: payload.host,
          port: payload.port,
          username: payload.username || null,
          password: payload.password || null,
          from_email: payload.fromEmail || null,
        }
      );
      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        configuredAt: toIsoString(responsePayload.configured_at),
      };
    },

    async updateDropboxTokens(payload) {
      const responsePayload = await request(
        "/admin/integrations/dropbox/tokens",
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          refresh_token: payload.refreshToken,
          access_token: payload.accessToken || null,
        }
      );
      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        configuredAt: toIsoString(responsePayload.configured_at),
      };
    },

    async configureDropboxAppCredentials(payload) {
      const responsePayload = await request(
        "/admin/integrations/dropbox/app-config",
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          app_key: payload.appKey,
          app_secret: payload.appSecret,
        }
      );
      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        configuredAt: toIsoString(responsePayload.configured_at),
      };
    },

    async getDropboxReadiness(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      const responsePayload = await request(
        `/admin/integrations/dropbox/readiness?${params.toString()}`,
        "GET"
      );
      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        message: responsePayload.message,
        hasAppCredentials: Boolean(responsePayload.has_app_credentials),
        authorizeUrl: responsePayload.authorize_url || null,
      };
    },

    async startDropboxOauth(payload) {
      const responsePayload = await request("/admin/integrations/dropbox/oauth/start", "POST", {
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
        app_key: payload.appKey || null,
      });
      return {
        provider: responsePayload.provider,
        authorizeUrl: responsePayload.authorize_url,
      };
    },

    async completeDropboxOauth(payload) {
      const responsePayload = await request(
        "/admin/integrations/dropbox/oauth/complete",
        "POST",
        {
          actor_id: payload.actorId,
          actor_role: payload.actorRole,
          auth_code: payload.authCode,
          app_key: payload.appKey || null,
          app_secret: payload.appSecret || null,
          redirect_uri: payload.redirectUri || null,
        }
      );
      return {
        provider: responsePayload.provider,
        status: responsePayload.status,
        accountId: responsePayload.account_id || null,
        configuredAt: toIsoString(responsePayload.configured_at),
      };
    },

    async listAdminOpsHistory(payload) {
      const params = new URLSearchParams({
        actor_id: payload.actorId,
        actor_role: payload.actorRole,
      });
      if (Number.isInteger(payload.limit)) {
        params.set("limit", String(payload.limit));
      }
      const responsePayload = await request(`/admin/ops/history?${params.toString()}`, "GET");
      return {
        entries: Array.isArray(responsePayload.entries)
          ? responsePayload.entries.map((entry) => ({
              id: entry.id,
              action: entry.action,
              actorId: entry.actor_id || null,
              reason: entry.reason || null,
              entity: entry.entity,
              timestamp: toIsoString(entry.timestamp),
            }))
          : [],
      };
    },
  });
}

module.exports = {
  OperationsBackendClientError,
  createOperationsBackendClient,
};
