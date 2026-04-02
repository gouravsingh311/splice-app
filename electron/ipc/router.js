const {
  AUTH_ERROR_CODES,
  IPC_CHANNELS,
  IPC_CONTRACT_REGISTRY,
  buildIpcErrorResponse,
  buildIpcSuccessResponse,
  formatZodIssues,
  getContract,
} = require("./contracts");
const { createSecurityAuditLog } = require("./auditLog");
const { AuthBackendClientError, createAuthBackendClient } = require("./authBackendClient");
const {
  NotificationsBackendClientError,
  createNotificationsBackendClient,
} = require("./notificationsBackendClient");
const {
  OperationsBackendClientError,
  createOperationsBackendClient,
} = require("./operationsBackendClient");
const { createDropboxOauthDesktopBroker } = require("./dropboxOauthDesktopBroker");
const { QcBackendClientError, createQcBackendClient } = require("./qcBackendClient");
const { buildAuthSessionData, buildPermissions, resolveAuthContext } = require("./authStub");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { dialog, BrowserWindow, shell } = require("electron");

function hasAllowedRole(actorRoles, allowedRoles) {
  return actorRoles.some((role) => allowedRoles.includes(role));
}

function hasRequiredPermissions(actorPermissions, requiredPermissions) {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }

  if (actorPermissions.includes("*")) {
    return true;
  }

  return requiredPermissions.every((permission) => actorPermissions.includes(permission));
}

function resolveFileUrlPath(value) {
  const raw = String(value || "");
  if (!raw.startsWith("file://")) {
    return "";
  }
  try {
    return path.resolve(fileURLToPath(raw));
  } catch (_error) {
    return "";
  }
}

function isTrustedSender(metadata, options = {}) {
  const senderUrl = String(metadata?.senderUrl || "");
  const topFrameUrl = String(metadata?.topFrameUrl || "");
  const expectedRendererPath = String(options.expectedRendererPath || "").trim();
  const isTrustedWebContentsId = options.isTrustedWebContentsId;
  if (!senderUrl.startsWith("file://")) {
    return false;
  }
  if (topFrameUrl && topFrameUrl !== senderUrl) {
    return false;
  }

  const sender = metadata?.event?.sender;
  const senderWebContentsId = Number(metadata?.senderWebContentsId || 0);
  if (!sender || !Number.isInteger(senderWebContentsId) || senderWebContentsId <= 0) {
    return false;
  }
  if (Number(sender.id) !== senderWebContentsId) {
    return false;
  }

  if (
    BrowserWindow &&
    typeof BrowserWindow.fromWebContents === "function" &&
    typeof sender === "object"
  ) {
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return false;
    }
    if (ownerWindow.webContents.id !== senderWebContentsId) {
      return false;
    }
  }

  if (typeof isTrustedWebContentsId === "function" && !isTrustedWebContentsId(senderWebContentsId)) {
    return false;
  }

  if (expectedRendererPath) {
    const senderPath = resolveFileUrlPath(senderUrl);
    const topFramePath = resolveFileUrlPath(topFrameUrl || senderUrl);
    if (!senderPath || !topFramePath) {
      return false;
    }
    const expectedPath = path.resolve(expectedRendererPath);
    if (senderPath !== expectedPath || topFramePath !== expectedPath) {
      return false;
    }
  }

  return true;
}

function resolvePrimaryActorRole(roles) {
  const normalized = Array.isArray(roles)
    ? roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (normalized.includes("admin")) {
    return "admin";
  }
  if (normalized.includes("reviewer")) {
    return "reviewer";
  }
  if (normalized.includes("creator")) {
    return "creator";
  }
  if (normalized.includes("system")) {
    return "system";
  }
  return "creator";
}

function applyActorContextToPayload(payload, actorContext) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const actorRole = resolvePrimaryActorRole(actorContext?.roles || []);
  const actorId = String(actorContext?.actorId || "").trim();
  const nextPayload = { ...payload };
  const hasActorId = Object.prototype.hasOwnProperty.call(nextPayload, "actorId");
  const hasActorRole = Object.prototype.hasOwnProperty.call(nextPayload, "actorRole");
  const hasSnakeActorId = Object.prototype.hasOwnProperty.call(nextPayload, "actor_id");
  const hasSnakeActorRole = Object.prototype.hasOwnProperty.call(nextPayload, "actor_role");

  if (hasActorId || hasSnakeActorId) {
    nextPayload.actorId = actorId;
    nextPayload.actor_id = actorId;
  }
  if (hasActorRole || hasSnakeActorRole) {
    nextPayload.actorRole = actorRole;
    nextPayload.actor_role = actorRole;
  }
  return nextPayload;
}

function resolveHandledError(error) {
  const knownErrorCodes = new Set(AUTH_ERROR_CODES);
  if (
    (error instanceof AuthBackendClientError ||
      error instanceof QcBackendClientError ||
      error instanceof NotificationsBackendClientError) &&
    knownErrorCodes.has(error.code)
  ) {
    return error;
  }

  if (error instanceof OperationsBackendClientError && knownErrorCodes.has(error.code)) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    knownErrorCodes.has(error.code) &&
    typeof error.reason === "string" &&
    typeof error.message === "string"
  ) {
    return error;
  }

  return null;
}

function normalizeRuleId(ruleId) {
  return String(ruleId || "").trim().toUpperCase();
}

function inferFindingCategory(ruleId) {
  const normalized = normalizeRuleId(ruleId);
  const compact = normalized.replace(/[._-]/g, "");
  if (compact.includes("AUDIOZIP")) {
    return "audio-zip";
  }
  if (compact.includes("SAMPLE")) {
    return "samples";
  }
  if (compact.includes("DEMO")) {
    return "demo";
  }
  if (compact.includes("DESCRIPTION")) {
    return "description";
  }
  if (compact.includes("ART") || compact.includes("ARTWORK")) {
    return "artwork";
  }
  if (compact.includes("PRESET")) {
    return "presets";
  }
  if (compact.includes("MIDI")) {
    return "midi";
  }
  if (compact.includes("FOLDER") || normalized.startsWith("PACK.FOLDER")) {
    return "folder";
  }
  if (normalized.startsWith("PACK.NAMING")) {
    return "samples";
  }
  return "folder";
}

function resolveFindingFileRef(finding) {
  const context = finding && typeof finding.context === "object" ? finding.context : null;
  if (!context) {
    return null;
  }

  const candidates = [
    context.fileRef,
    context.file_ref,
    context.path,
    context.file,
    context.relative_path,
    context.audio_zip_filename,
    context.filename,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function mapFindingForQcReport(finding) {
  const severity =
    finding?.blocking || String(finding?.severity || "").toLowerCase() === "blocking"
      ? "blocking"
      : "warning";
  const rawDiffTag = String(finding?.diffTag || "").toLowerCase();
  const diffTag =
    rawDiffTag === "new" || rawDiffTag === "resolved" || rawDiffTag === "unchanged"
      ? rawDiffTag
      : "unchanged";
  return {
    findingId: finding?.findingId || `${finding?.ruleId || "unknown"}:${finding?.message || "issue"}`,
    ruleId: finding?.ruleId || "UNKNOWN_RULE",
    severity,
    category: inferFindingCategory(finding?.ruleId),
    fileRef: resolveFindingFileRef(finding),
    message: finding?.message || "QC check failed.",
    remediation: finding?.remediation || "Review this item and fix the issue.",
    diffTag,
  };
}

function countFilesRecursively(rootPath) {
  let count = 0;
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile()) {
        count += 1;
      }
    }
  }

  return count;
}

function listTopLevelFolders(rootPath) {
  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function collectFileEntries(rootPath) {
  const entries = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const children = fs.readdirSync(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!child.isFile()) {
        continue;
      }
      const relative = path.relative(rootPath, absolute).replace(/\\\\/g, "/");
      const stat = fs.statSync(absolute);
      entries.push({
        relativePath: relative,
        sizeBytes: Math.max(1, Number(stat.size || 1)),
        mimeType: "application/octet-stream",
      });
    }
  }

  return entries;
}

function resolveE2eFolderSelection() {
  if (process.env.PLAYWRIGHT_E2E !== "1") {
    return null;
  }

  const configuredPath = String(process.env.E2E_PACK_PATH || "").trim();
  if (!configuredPath) {
    return null;
  }

  const selectedPath = path.resolve(configuredPath);
  if (!fs.existsSync(selectedPath)) {
    throw new Error(`E2E_PACK_PATH does not exist: ${selectedPath}`);
  }

  return {
    path: selectedPath,
    fileCount: countFilesRecursively(selectedPath),
    topLevelFolders: listTopLevelFolders(selectedPath),
    files: collectFileEntries(selectedPath),
  };
}

function createIpcRouter(options = {}) {
  const internalSecret = options.internalSecret || process.env.SPLICE_INTERNAL_SECRET || null;
  const auditLog =
    options.auditLog ||
    createSecurityAuditLog({
      remoteClient: options.auditApiClient || null,
    });
  const authBackendClient = options.authBackendClient || createAuthBackendClient({ internalSecret });
  const qcBackendClient = options.qcBackendClient || createQcBackendClient({ internalSecret });
  const notificationsBackendClient =
    options.notificationsBackendClient || createNotificationsBackendClient({ internalSecret });
  const operationsBackendClient =
    options.operationsBackendClient || createOperationsBackendClient({ internalSecret });
  const logger = options.logger || console;
  const dropboxOauthDesktopBroker =
    options.dropboxOauthDesktopBroker
    || createDropboxOauthDesktopBroker({
      operationsBackendClient,
      openExternal: options.openExternal || ((url) => shell.openExternal(url)),
      logger,
    });
  const resolveAuthContextFn = options.resolveAuthContext || resolveAuthContext;
  const resolveActorPermissionsFn = options.resolveActorPermissions || buildPermissions;
  const nowIso = options.nowIso || (() => new Date().toISOString());
  const qcReportExporter =
    options.qcReportExporter || (async () => ({ canceled: true, path: null }));
  const verifySecurityConfig =
    options.verifySecurityConfig ||
    (() => ({
      checks: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        navigationGuard: true,
      },
    }));
  const isTrustedWebContentsId = options.isTrustedWebContentsId;
  const expectedRendererPath = options.expectedRendererPath || null;
  let activeActorContext = resolveAuthContextFn();

  function normalizeActorContext(candidate) {
    const source = candidate && typeof candidate === "object" ? candidate : {};
    const actorId =
      typeof source.actorId === "string" && source.actorId.trim().length > 0
        ? source.actorId.trim()
        : "local-dev-actor";
    const roles = Array.isArray(source.roles)
      ? source.roles
          .map((role) => String(role || "").trim().toLowerCase())
          .filter(Boolean)
      : ["creator"];
    return {
      actorId,
      roles: roles.length > 0 ? Array.from(new Set(roles)) : ["creator"],
      sessionIssuedAt:
        typeof source.sessionIssuedAt === "string" && source.sessionIssuedAt.length > 0
          ? source.sessionIssuedAt
          : new Date().toISOString(),
    };
  }

  function updateActiveActorContextFromAuthResult(result) {
    const user = result && result.user && typeof result.user === "object" ? result.user : null;
    if (!user) {
      return;
    }
    const nextContext = normalizeActorContext({
      actorId: user.id,
      roles: Array.isArray(user.roles) ? user.roles : [],
      sessionIssuedAt: new Date().toISOString(),
    });
    activeActorContext = nextContext;
  }

  function getActiveActorContext() {
    return normalizeActorContext(activeActorContext);
  }

  let isPrivacyShieldEnabled = true;
  const handlers = {
    [IPC_CHANNELS.AUTH_GET_SESSION]: ({ request, actorContext }) =>
      buildAuthSessionData(actorContext, request.includePermissions),
    [IPC_CHANNELS.AUTH_LOGIN]: ({ request }) => {
      return authBackendClient.login(request).then((result) => {
        updateActiveActorContextFromAuthResult(result);
        return result;
      });
    },
    [IPC_CHANNELS.AUTH_REGISTER]: ({ request }) => {
      return authBackendClient.register(request).then((result) => {
        updateActiveActorContextFromAuthResult(result);
        return result;
      });
    },
    [IPC_CHANNELS.AUTH_OTP_SEND]: ({ request }) => authBackendClient.sendOtp(request),
    [IPC_CHANNELS.AUTH_OTP_VERIFY]: ({ request }) => authBackendClient.verifyOtp(request),
    [IPC_CHANNELS.AUTH_FORGOT_PASSWORD]: ({ request }) => authBackendClient.forgotPassword(request),
    [IPC_CHANNELS.AUTH_RESET_PASSWORD]: ({ request }) => authBackendClient.resetPassword(request),
    [IPC_CHANNELS.QC_EVALUATE_PACK]: async ({ request }) => {
      return qcBackendClient.evaluate(request);
    },
    [IPC_CHANNELS.QC_LIST_RULES]: ({ request }) => qcBackendClient.listRules(request),
    [IPC_CHANNELS.QC_RESULTS_GET]: async ({ request }) => {
      const results = await qcBackendClient.getResults(request);
      const mapRun = (run) => ({
        runId: run?.runId || null,
        submissionId: run?.submissionId || null,
        findings: Array.isArray(run?.findings) ? run.findings.map(mapFindingForQcReport) : [],
        status: run?.status || "not_run",
        startedAt: run?.startedAt || null,
        completedAt: run?.completedAt || null,
        generatedAt: run?.generatedAt || null,
        ruleSetVersion: run?.ruleSetVersion || null,
        policyVersion: run?.policyVersion || null,
      });
      const latest = mapRun(results);
      return {
        ...latest,
        history: Array.isArray(results?.history) ? results.history.map(mapRun) : [],
      };
    },
    [IPC_CHANNELS.QC_REPORT_EXPORT]: async ({ request }) => qcReportExporter(request),
    [IPC_CHANNELS.NOTIFICATIONS_LIST]: ({ request }) => notificationsBackendClient.list(request),
    [IPC_CHANNELS.NOTIFICATIONS_MARK_READ]: ({ request }) =>
      notificationsBackendClient.markRead(request),
    [IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ]: ({ request }) =>
      notificationsBackendClient.markAllRead(request),
    [IPC_CHANNELS.NOTIFICATIONS_RETRY]: ({ request }) => notificationsBackendClient.retry(request),
    [IPC_CHANNELS.REVIEW_QUEUE_LIST]: ({ request }) =>
      operationsBackendClient.listReviewQueue(request),
    [IPC_CHANNELS.REVIEW_SUBMISSION_GET]: ({ request }) =>
      operationsBackendClient.getReviewSubmission(request),
    [IPC_CHANNELS.REVIEW_APPROVE]: ({ request }) =>
      operationsBackendClient.approveReview(request),
    [IPC_CHANNELS.REVIEW_REJECT]: ({ request }) =>
      operationsBackendClient.rejectReview(request),
    [IPC_CHANNELS.REVIEW_TAG_ADD]: ({ request }) =>
      operationsBackendClient.addReviewTag(request),
    [IPC_CHANNELS.REVIEW_FLAG_ADD]: ({ request }) =>
      operationsBackendClient.addReviewFlag(request),
    [IPC_CHANNELS.REVIEW_REOPEN]: ({ request }) =>
      operationsBackendClient.reopenReview(request),
    [IPC_CHANNELS.ADMIN_CONFIGS_LIST]: ({ request }) =>
      operationsBackendClient.listAdminConfigs(request),
    [IPC_CHANNELS.ADMIN_CONFIGS_DRAFT]: ({ request }) =>
      operationsBackendClient.createAdminConfigDraft(request),
    [IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH]: ({ request }) =>
      operationsBackendClient.publishAdminConfig(request),
    [IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK]: ({ request }) =>
      operationsBackendClient.rollbackAdminConfig(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST]: ({ request }) =>
      operationsBackendClient.listAdminIntegrationHealth(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST]: ({ request }) =>
      operationsBackendClient.testAdminIntegration(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE]: ({ request }) =>
      operationsBackendClient.rotateAdminIntegration(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE]: ({ request }) =>
      operationsBackendClient.configureAirtableIntegration(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_SMTP_CONFIGURE]: ({ request }) =>
      operationsBackendClient.configureSmtpIntegration(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE]: ({ request }) =>
      operationsBackendClient.updateDropboxTokens(request),
    [IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE]: ({ request }) =>
      operationsBackendClient.configureDropboxAppCredentials(request),
    [IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET]: ({ request }) =>
      operationsBackendClient.getDropboxReadiness(request),
    [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START]: ({ request }) =>
      operationsBackendClient.startDropboxOauth(request),
    [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE]: ({ request }) =>
      operationsBackendClient.completeDropboxOauth(request),
    [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START]: ({ request }) =>
      dropboxOauthDesktopBroker.startSession(request),
    [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS]: ({ request }) =>
      dropboxOauthDesktopBroker.getStatus(request),
    [IPC_CHANNELS.ADMIN_OPS_HISTORY_LIST]: ({ request }) =>
      operationsBackendClient.listAdminOpsHistory(request),
    [IPC_CHANNELS.ADMIN_QC_POLICY_GET]: ({ request }) =>
      qcBackendClient.getActivePolicy(request),
    [IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE]: ({ request }) =>
      qcBackendClient.updateActivePolicy(request),
    [IPC_CHANNELS.JOBS_ENQUEUE]: ({ request }) => operationsBackendClient.enqueueJob(request),
    [IPC_CHANNELS.JOBS_GET]: ({ request }) => operationsBackendClient.getJob(request),
    [IPC_CHANNELS.JOBS_REPLAY]: ({ request }) => operationsBackendClient.replayJob(request),
    [IPC_CHANNELS.SCHEDULING_RESOLVE]: ({ request }) =>
      operationsBackendClient.resolveSchedule(request),
    [IPC_CHANNELS.SCHEDULING_OVERRIDE]: ({ request }) =>
      operationsBackendClient.overrideSchedule(request),
    [IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE]: ({ request }) =>
      operationsBackendClient.triggerRelease(request),
    [IPC_CHANNELS.OBSERVABILITY_METRICS_GET]: () => operationsBackendClient.getMetrics(),
    [IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE]: ({ request }) =>
      operationsBackendClient.annotateIncident(request),
    [IPC_CHANNELS.CREATOR_PROFILE_GET]: ({ request }) =>
      operationsBackendClient.getCreatorProfile(request),
    [IPC_CHANNELS.CREATOR_PROFILE_PUT]: ({ request }) =>
      operationsBackendClient.putCreatorProfile(request),
    [IPC_CHANNELS.SUBMISSION_DRAFT]: ({ request }) =>
      operationsBackendClient.createSubmissionDraft(request),
    [IPC_CHANNELS.SUBMISSION_METADATA]: ({ request }) =>
      operationsBackendClient.updateSubmissionMetadata(request),
    [IPC_CHANNELS.SUBMISSION_LIST]: ({ request }) =>
      operationsBackendClient.listSubmissions(request),
    [IPC_CHANNELS.SUBMISSION_TIMELINE]: ({ request }) =>
      operationsBackendClient.getSubmissionTimeline(request),
    [IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC]: ({ request }) =>
      operationsBackendClient.syncSubmissionAirtable(request),
    [IPC_CHANNELS.SUBMISSION_AIRTABLE_RESET]: ({ request }) =>
      operationsBackendClient.resetSubmissionAirtable(request),
    [IPC_CHANNELS.INTAKE_FOLDER_SELECT]: async ({ event }) => {
      const e2eSelection = resolveE2eFolderSelection();
      if (e2eSelection) {
        return e2eSelection;
      }

      const browserWindow = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
      const result = await dialog.showOpenDialog(browserWindow || undefined, {
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return {
          path: "",
          fileCount: 0,
          topLevelFolders: [],
        };
      }
      const selectedPath = result.filePaths[0];
      return {
        path: selectedPath,
        fileCount: countFilesRecursively(selectedPath),
        topLevelFolders: listTopLevelFolders(selectedPath),
        files: collectFileEntries(selectedPath),
      };
    },
    [IPC_CHANNELS.INTAKE_SESSION_START]: ({ request }) =>
      operationsBackendClient.startIntakeSession(request),
    [IPC_CHANNELS.INTAKE_MANIFEST_PUT]: ({ request }) =>
      operationsBackendClient.upsertIntakeManifest(request),
    [IPC_CHANNELS.INTAKE_HANDOFF_CREATE]: ({ request }) =>
      operationsBackendClient.createIntakeHandoff(request),
    [IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET]: ({ request }) =>
      operationsBackendClient.getIntakeHandoffStatus(request),
    [IPC_CHANNELS.INTAKE_HANDOFF_CONTROL]: ({ request }) =>
      operationsBackendClient.controlIntakeHandoff(request),
    [IPC_CHANNELS.INTAKE_LOCK]: ({ request }) =>
      operationsBackendClient.lockSubmissionFiles(request),
    [IPC_CHANNELS.SUBMISSION_TRANSITION]: ({ request }) =>
      operationsBackendClient.transitionSubmission(request),
    [IPC_CHANNELS.DESKTOP_VERIFY_SECURITY]: () => verifySecurityConfig(),
    [IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS]: async ({ request }) => ({
      events:
        typeof auditLog.listForChannel === "function"
          ? await auditLog.listForChannel({ limit: request.limit })
          : auditLog.list({ limit: request.limit }),
    }),
    [IPC_CHANNELS.AUDIT_EVENTS_LIST]: async ({ request }) =>
      options.auditApiClient.listAuditEvents({
        actorId: request.actorId,
        actorRole: request.actorRole,
        action: request.action,
        entityType: request.entityType,
        entityId: request.entityId,
        from: request.from,
        to: request.to,
        limit: request.limit,
        offset: request.offset,
      }),
    [IPC_CHANNELS.AUDIT_EVENTS_EXPORT]: async ({ request }) =>
      options.auditApiClient.exportAuditEvents({
        actorId: request.actorId,
        actorRole: request.actorRole,
        format: request.format,
        includeHashChain: request.includeHashChain,
        action: request.action,
        entityType: request.entityType,
        entityId: request.entityId,
        from: request.from,
        to: request.to,
        limit: request.limit,
      }),
    [IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_TOGGLE]: async ({ request, event }) => {
      const { enabled } = request;
      const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
      if (win && !win.isDestroyed()) {
        if (process.platform === "win32" || process.platform === "darwin") {
          win.setContentProtection(enabled);
          win.setSkipTaskbar(enabled);
          isPrivacyShieldEnabled = enabled;

          options.auditApiClient.append({
            category: "security",
            action: "privacy_shield_toggle",
            outcome: "success",
            details: { enabled: isPrivacyShieldEnabled },
          });

          return { success: true, enabled: isPrivacyShieldEnabled };
        }
      }
      return { success: false, enabled: isPrivacyShieldEnabled };
    },
    [IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_STATUS]: async () => {
      return { enabled: isPrivacyShieldEnabled };
    },
  };

  async function invoke(channel, payload, metadata = {}) {
    const actorContext = getActiveActorContext();
    const senderUrl = metadata.senderUrl;
    const contract = getContract(channel);

    if (!contract) {
      const unknownReason = "CHANNEL_NOT_REGISTERED";
      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "denied",
        reason: unknownReason,
      });
      return buildIpcErrorResponse(
        channel,
        "UNKNOWN_CHANNEL",
        unknownReason,
        "IPC channel is not registered"
      );
    }

    if (
      !isTrustedSender(metadata, {
        expectedRendererPath,
        isTrustedWebContentsId,
      })
    ) {
      const reason = `SENDER_ORIGIN_FORBIDDEN: ${senderUrl || "unknown"}`;
      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "denied",
        reason,
      });
      return buildIpcErrorResponse(
        channel,
        "AUTH_FORBIDDEN",
        reason,
        "IPC sender origin is not trusted"
      );
    }

    const parsedRequest = contract.requestSchema.safeParse(payload ?? {});
    if (!parsedRequest.success) {
      const reason = `REQUEST_SCHEMA_INVALID: ${formatZodIssues(parsedRequest.error.issues)}`;
      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "denied",
        reason,
      });
      return buildIpcErrorResponse(
        channel,
        "VALIDATION_ERROR",
        reason,
        "IPC request failed schema validation"
      );
    }

    const canonicalRequest = applyActorContextToPayload(parsedRequest.data, actorContext);

    if (!hasAllowedRole(actorContext.roles, contract.allowedRoles)) {
      const reason = `ROLE_FORBIDDEN: ${actorContext.roles.join(",") || "none"}`;
      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "denied",
        reason,
      });
      return buildIpcErrorResponse(
        channel,
        "AUTH_FORBIDDEN",
        reason,
        "Actor is not authorized for this IPC channel"
      );
    }

    const actorPermissions = resolveActorPermissionsFn(actorContext.roles);
    if (!hasRequiredPermissions(actorPermissions, contract.requiredPermissions)) {
      const reason = `PERMISSION_FORBIDDEN: required=${contract.requiredPermissions.join(",")} actor=${actorPermissions.join(",") || "none"}`;
      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "denied",
        reason,
      });
      return buildIpcErrorResponse(
        channel,
        "AUTH_FORBIDDEN",
        reason,
        "Actor permissions do not satisfy this IPC channel"
      );
    }

    try {
      const handler = handlers[channel];
      const responseData = await handler({
        request: canonicalRequest,
        actorContext,
        event: metadata.event,
      });
      const successResponse = buildIpcSuccessResponse(responseData);
      const parsedResponse = contract.responseSchema.safeParse(successResponse);

      if (!parsedResponse.success) {
        const reason = `RESPONSE_SCHEMA_INVALID: ${formatZodIssues(parsedResponse.error.issues)}`;
        auditLog.append({
          channel,
          actorId: actorContext.actorId,
          outcome: "denied",
          reason,
        });
        return buildIpcErrorResponse(
          channel,
          "INTERNAL_ERROR",
          reason,
          "IPC response violated schema contract"
        );
      }

      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "allowed",
        reason: "AUTHORIZED",
      });
      return parsedResponse.data;
    } catch (error) {
      const handledError = resolveHandledError(error);
      const reason = handledError
        ? handledError.reason
        : `HANDLER_EXCEPTION: ${error.message}`;
      const code = handledError ? handledError.code : "INTERNAL_ERROR";
      const message = handledError ? handledError.message : "IPC handler failed";
      auditLog.append({
        channel,
        actorId: actorContext.actorId,
        outcome: "denied",
        reason,
      });
      logger.error("IPC handler failed", {
        channel,
        reason,
      });
      return buildIpcErrorResponse(channel, code, reason, message);
    }
  }

  function registerHandlers(ipcMain) {
    for (const channel of Object.keys(IPC_CONTRACT_REGISTRY)) {
      ipcMain.handle(channel, (event, payload) =>
        invoke(channel, payload, {
          senderUrl: event?.senderFrame?.url,
          topFrameUrl: event?.senderFrame?.top?.url,
          senderWebContentsId: event?.sender?.id,
          event,
        })
      );
    }
  }

  return {
    auditLog,
    invoke,
    registerHandlers,
  };
}

module.exports = {
  createIpcRouter,
};
