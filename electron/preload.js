const { contextBridge, ipcRenderer } = require("electron");
let assertAdminIntegrationRequest = () => false;
let assertAdminIntegrationSuccess = () => false;
try {
  ({
    assertAdminIntegrationRequest,
    assertAdminIntegrationSuccess,
  } = require("./preload/adminIntegrationsValidation"));
} catch (error) {
  if (typeof console !== "undefined" && console && typeof console.error === "function") {
    console.error("[preload] adminIntegrationsValidation load failed", error);
  }
}

const IPC_CHANNELS = Object.freeze({
  AUTH_GET_SESSION: "fileeaters.auth.session.get.v1",
  AUTH_LOGIN: "fileeaters.auth.login.v1",
  AUTH_REGISTER: "fileeaters.auth.register.v1",
  AUTH_OTP_SEND: "fileeaters.auth.otp.send.v1",
  AUTH_OTP_VERIFY: "fileeaters.auth.otp.verify.v1",
  AUTH_FORGOT_PASSWORD: "fileeaters.auth.forgot-password.v1",
  AUTH_RESET_PASSWORD: "fileeaters.auth.reset-password.v1",
  QC_EVALUATE_PACK: "fileeaters.qc.evaluate-pack.v1",
  QC_LIST_RULES: "fileeaters.qc.rules.list.v1",
  QC_RESULTS_GET: "fileeaters.qc.results.get.v1",
  QC_REPORT_EXPORT: "fileeaters.qc.report.export.v1",
  NOTIFICATIONS_LIST: "fileeaters.notifications.list.v1",
  NOTIFICATIONS_MARK_READ: "fileeaters.notifications.mark-read.v1",
  NOTIFICATIONS_MARK_ALL_READ: "fileeaters.notifications.mark-all-read.v1",
  NOTIFICATIONS_RETRY: "fileeaters.notifications.retry.v1",
  REVIEW_QUEUE_LIST: "fileeaters.review.queue.list.v1",
  REVIEW_SUBMISSION_GET: "fileeaters.review.submission.get.v1",
  REVIEW_APPROVE: "fileeaters.review.approve.v1",
  REVIEW_REJECT: "fileeaters.review.reject.v1",
  REVIEW_TAG_ADD: "fileeaters.review.tags.add.v1",
  REVIEW_FLAG_ADD: "fileeaters.review.flags.add.v1",
  REVIEW_REOPEN: "fileeaters.review.reopen.v1",
  ADMIN_CONFIGS_LIST: "fileeaters.admin.configs.list.v1",
  ADMIN_CONFIGS_DRAFT: "fileeaters.admin.configs.draft.v1",
  ADMIN_CONFIGS_PUBLISH: "fileeaters.admin.configs.publish.v1",
  ADMIN_CONFIGS_ROLLBACK: "fileeaters.admin.configs.rollback.v1",
  ADMIN_INTEGRATIONS_HEALTH_LIST: "fileeaters.admin.integrations.health.list.v1",
  ADMIN_INTEGRATIONS_TEST: "fileeaters.admin.integrations.test.v1",
  ADMIN_INTEGRATIONS_ROTATE: "fileeaters.admin.integrations.rotate.v1",
  ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE: "fileeaters.admin.integrations.airtable.configure.v1",
  ADMIN_INTEGRATIONS_SMTP_CONFIGURE: "fileeaters.admin.integrations.smtp.configure.v1",
  ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE: "fileeaters.admin.integrations.dropbox.tokens.update.v1",
  ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE: "fileeaters.admin.integrations.dropbox.app-config.configure.v1",
  ADMIN_DROPBOX_READINESS_GET: "fileeaters.admin.dropbox.readiness.get.v1",
  ADMIN_DROPBOX_OAUTH_START: "fileeaters.admin.dropbox.oauth.start.v1",
  ADMIN_DROPBOX_OAUTH_COMPLETE: "fileeaters.admin.dropbox.oauth.complete.v1",
  ADMIN_DROPBOX_OAUTH_DESKTOP_START: "fileeaters.admin.dropbox.oauth.desktop.start.v1",
  ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS: "fileeaters.admin.dropbox.oauth.desktop.status.v1",
  ADMIN_OPS_HISTORY_LIST: "fileeaters.admin.ops.history.list.v1",
  ADMIN_QC_POLICY_GET: "fileeaters.admin.qc.policy.get.v1",
  ADMIN_QC_POLICY_UPDATE: "fileeaters.admin.qc.policy.update.v1",
  ADMIN_QC_POLICY_GET_ACTIVE: "fileeaters.admin.qc.policy.get.v1",
  ADMIN_QC_POLICY_UPDATE_ACTIVE: "fileeaters.admin.qc.policy.update.v1",
  JOBS_ENQUEUE: "fileeaters.jobs.enqueue.v1",
  JOBS_GET: "fileeaters.jobs.get.v1",
  JOBS_REPLAY: "fileeaters.jobs.replay.v1",
  SCHEDULING_RESOLVE: "fileeaters.scheduling.resolve.v1",
  SCHEDULING_OVERRIDE: "fileeaters.scheduling.override.v1",
  SCHEDULING_TRIGGER_RELEASE: "fileeaters.scheduling.trigger-release.v1",
  OBSERVABILITY_METRICS_GET: "fileeaters.observability.metrics.get.v1",
  OBSERVABILITY_INCIDENTS_ANNOTATE: "fileeaters.observability.incidents.annotate.v1",
  CREATOR_PROFILE_GET: "fileeaters.creator.profile.get.v1",
  CREATOR_PROFILE_PUT: "fileeaters.creator.profile.put.v1",
  SUBMISSION_DRAFT: "fileeaters.submission.draft.v1",
  SUBMISSION_METADATA: "fileeaters.submission.metadata.v1",
  SUBMISSION_LIST: "fileeaters.submission.list.v1",
  SUBMISSION_TIMELINE: "fileeaters.submission.timeline.v1",
  SUBMISSION_AIRTABLE_SYNC: "fileeaters.submission.airtable.sync.v1",
  SUBMISSION_AIRTABLE_RESET: "fileeaters.submission.airtable.reset.v1",
  SUBMISSION_TRANSITION: "fileeaters.submission.transition.v1",
  INTAKE_FOLDER_SELECT: "fileeaters.intake.folder.select.v1",
  INTAKE_SESSION_START: "fileeaters.intake.session.start.v1",
  INTAKE_MANIFEST_PUT: "fileeaters.intake.manifest.put.v1",
  INTAKE_HANDOFF_CREATE: "fileeaters.intake.handoff.create.v1",
  INTAKE_HANDOFF_STATUS_GET: "fileeaters.intake.handoff.status.get.v1",
  INTAKE_HANDOFF_CONTROL: "fileeaters.intake.handoff.control.v1",
  INTAKE_LOCK: "fileeaters.intake.lock.v1",
  DESKTOP_VERIFY_SECURITY: "fileeaters.desktop.security.verify-config.v1",
  AUDIT_LIST_SECURITY_EVENTS: "fileeaters.audit.security-events.list.v1",
  DESKTOP_PRIVACY_SHIELD_TOGGLE: "fileeaters.desktop.privacy.shield.toggle.v1",
  DESKTOP_PRIVACY_SHIELD_STATUS: "fileeaters.desktop.privacy.shield.status.v1",
});

const KNOWN_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "AUTH_FORBIDDEN",
  "AUTH_UNAUTHORIZED",
  "AUTH_LOCKED",
  "AUTH_RATE_LIMITED",
  "AUTH_TOKEN_REUSE",
  "INVALID_CONTRACT_PAYLOAD",
  "QC_RULE_NOT_FOUND",
  "QC_POLICY_NOT_FOUND",
  "QC_POLICY_FORBIDDEN",
  "QC_POLICY_VERSION_CONFLICT",
  "QC_EVALUATION_NOT_ALLOWED",
  "NOTIFICATION_NOT_FOUND",
  "NOTIFICATION_SCOPE_FORBIDDEN",
  "NOTIFICATION_RETRY_FORBIDDEN",
  "REVIEW_FORBIDDEN",
  "REVIEW_INVALID_STATE",
  "REVIEW_REASON_REQUIRED",
  "SUBMISSION_NOT_FOUND",
  "VERSION_CONFLICT",
  "TRANSITION_NOT_ALLOWED",
  "TRANSITION_FORBIDDEN",
  "MISSING_REQUIRED_REASON",
  "JOB_NOT_FOUND",
  "JOB_REPLAY_NOT_ALLOWED",
  "SCHEDULE_SUBMISSION_MISMATCH",
  "SCHEDULE_NOT_FOUND",
  "SCHEDULE_NOT_DUE",
  "SCHEDULE_OVERRIDE_FORBIDDEN",
  "INTAKE_SESSION_NOT_FOUND",
  "INTAKE_MANIFEST_LOCKED",
  "INTAKE_MANIFEST_VERSION_CONFLICT",
  "STORAGE_HANDOFF_NOT_FOUND",
  "STORAGE_HANDOFF_PRECONDITION_FAILED",
  "STORAGE_HANDOFF_FORBIDDEN",
  "DROPBOX_NOT_CONFIGURED",
  "DROPBOX_AUTH_INVALID",
  "INVALID_EVENT_NAME",
  "UNKNOWN_CHANNEL",
  "INTERNAL_ERROR",
]);

const ALLOWED_ENVIRONMENTS = new Set(["local", "dev", "staging", "prod"]);
const ALLOWED_AUTH_ROLES = new Set(["creator", "reviewer", "admin"]);
const ALLOWED_OTP_PURPOSES = new Set(["register", "forgot-password"]);
const ALLOWED_NOTIFICATION_TYPES = new Set([
  "qc_failed",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "scheduled",
  "released",
]);
const ALLOWED_NOTIFICATION_SEVERITIES = new Set(["info", "warning", "error"]);
const ALLOWED_NOTIFICATION_STATUSES = new Set(["pending", "sent", "failed"]);
const ALLOWED_NOTIFICATION_CHANNELS = new Set(["in_app", "email"]);
const ALLOWED_QC_FINDING_DIFF_TAGS = new Set(["new", "resolved", "unchanged"]);
const ALLOWED_QC_RESULTS_STATUSES = new Set(["passed", "failed", "not_run"]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const IPC_DEBUG_ENABLED = process.env.SPLICE_IPC_DEBUG === "1";

function isSensitiveDebugKey(key) {
  return /(token|secret|password|authorization|refresh|access|otp|code)/i.test(String(key || ""));
}

function sanitizeDebugValue(value, depth = 0) {
  if (depth > 4) {
    return "[depth-truncated]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 240 ? value.slice(0, 240) + "…" : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 50) {
      return value.slice(0, 50).map((item) => sanitizeDebugValue(item, depth + 1)).concat(["[truncated]"]);
    }
    return value.map((item) => sanitizeDebugValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = isSensitiveDebugKey(key)
        ? "[redacted]"
        : sanitizeDebugValue(nested, depth + 1);
    }
    return output;
  }

  return String(value);
}

function debugIpcLog(stage, channel, detail) {
  if (!IPC_DEBUG_ENABLED || typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  try {
    console.info("[preload-ipc][" + stage + "] " + channel, sanitizeDebugValue(detail));
  } catch (_error) {
    // Debug logging must never affect runtime behavior.
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return value;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value);
}

function isRoleList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((role) => typeof role === "string" && ALLOWED_AUTH_ROLES.has(role))
  );
}

function assertOptionalString(value, fieldName, channel) {
  if (value === undefined) {
    return;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(
      `Preload request validation failed for ${channel}: ${fieldName} must be non-empty string`
    );
  }
}

function assertTokenBundleData(channel, data) {
  const requiredTokenFields = [
    "accessToken",
    "accessTokenExpiresAt",
    "refreshToken",
    "refreshTokenExpiresAt",
  ];

  for (const field of requiredTokenFields) {
    if (!isNonEmptyString(data[field])) {
      throw new Error(`Preload response validation failed for ${channel}: invalid ${field}`);
    }
  }

  if (!isIsoTimestamp(data.accessTokenExpiresAt) || !isIsoTimestamp(data.refreshTokenExpiresAt)) {
    throw new Error(
      `Preload response validation failed for ${channel}: token timestamps must be ISO strings`
    );
  }

  const user = data.user;
  if (!isObject(user)) {
    throw new Error(`Preload response validation failed for ${channel}: user must be object`);
  }

  if (!isNonEmptyString(user.id) || !isNonEmptyString(user.email) || !isNonEmptyString(user.status)) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid user identity/status fields`
    );
  }

  if (!isRoleList(user.roles) || !Array.isArray(user.permissions)) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid user role/permission fields`
    );
  }

  if (!isIsoTimestamp(user.createdAt) || !isIsoTimestamp(user.updatedAt)) {
    throw new Error(
      `Preload response validation failed for ${channel}: user timestamps must be ISO strings`
    );
  }
}

function assertOtpSendData(channel, data) {
  const hasValidChallenge =
    data.challengeId === null || (typeof data.challengeId === "string" && data.challengeId.length > 0);
  const hasValidExpiry =
    data.expiresAt === null || (typeof data.expiresAt === "string" && isIsoTimestamp(data.expiresAt));

  if (!hasValidChallenge || !hasValidExpiry || !Number.isInteger(data.cooldownSeconds)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid otp send payload`);
  }

  if (data.cooldownSeconds < 0) {
    throw new Error(`Preload response validation failed for ${channel}: cooldown must be >= 0`);
  }
}

function assertRuleBinding(rule, channel) {
  if (!isObject(rule) || !isNonEmptyString(rule.ruleId) || typeof rule.enabled !== "boolean") {
    throw new Error(`Preload request validation failed for ${channel}: invalid policy rule entry`);
  }

  if (
    Object.prototype.hasOwnProperty.call(rule, "blockingOverride") &&
    rule.blockingOverride !== null &&
    typeof rule.blockingOverride !== "boolean"
  ) {
    throw new Error(
      `Preload request validation failed for ${channel}: blockingOverride must be boolean|null`
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(rule, "params") &&
    (rule.params === null || typeof rule.params !== "object" || Array.isArray(rule.params))
  ) {
    throw new Error(
      `Preload request validation failed for ${channel}: params must be an object when provided`
    );
  }
}

function assertPolicySnapshot(policy, channel) {
  if (!isObject(policy) || !isNonEmptyString(policy.policyId)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid policy payload`);
  }
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 1) {
    throw new Error(`Preload response validation failed for ${channel}: invalid policyVersion`);
  }
  if (!isNonEmptyString(policy.ruleSetVersion) || !Array.isArray(policy.rules)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid policy rule set`);
  }
  if (!isNonEmptyString(policy.updatedBy) || !isIsoTimestamp(policy.updatedAt)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid policy metadata`);
  }
  if (!isNonEmptyString(policy.reason)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid policy reason`);
  }
}

function assertQcRuleDefinition(rule, channel) {
  const validSeverities = new Set(["blocking", "warning"]);
  if (
    !isObject(rule) ||
    !isNonEmptyString(rule.ruleId) ||
    !isNonEmptyString(rule.title) ||
    !isNonEmptyString(rule.description) ||
    !isNonEmptyString(rule.category) ||
    !isNonEmptyString(rule.remediation) ||
    !validSeverities.has(rule.severity) ||
    typeof rule.blocking !== "boolean" ||
    typeof rule.enabled !== "boolean"
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid QC rule definition`
    );
  }
}

function assertAdminConfigSnapshot(config, channel) {
  if (!isObject(config)) {
    throw new Error(`Preload response validation failed for ${channel}: admin config must be object`);
  }
  if (!isNonEmptyString(config.id)) {
    throw new Error(`Preload response validation failed for ${channel}: admin config id must be non-empty`);
  }
  if (!isNonEmptyString(config.configType)) {
    throw new Error(
      `Preload response validation failed for ${channel}: admin configType must be non-empty`
    );
  }
  if (!Number.isInteger(config.version) || config.version < 1) {
    throw new Error(
      `Preload response validation failed for ${channel}: admin config version must be a positive integer`
    );
  }
  if (!isObject(config.payloadJson)) {
    throw new Error(
      `Preload response validation failed for ${channel}: admin config payloadJson must be object`
    );
  }
  if (typeof config.isDraft !== "boolean") {
    throw new Error(
      `Preload response validation failed for ${channel}: admin config isDraft must be boolean`
    );
  }
  if (!isIsoTimestamp(config.createdAt)) {
    throw new Error(
      `Preload response validation failed for ${channel}: admin config createdAt must be ISO timestamp`
    );
  }

  if (
    config.publishedBy !== null &&
    config.publishedBy !== undefined &&
    !isNonEmptyString(config.publishedBy)
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid publishedBy value`
    );
  }
  if (
    config.publishedAt !== null &&
    config.publishedAt !== undefined &&
    !isIsoTimestamp(config.publishedAt)
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid publishedAt value`
    );
  }
}

function assertQcEvaluateRequest(payload, channel) {
  if (
    !isNonEmptyString(payload.requestId) ||
    !isNonEmptyString(payload.submissionId) ||
    !isNonEmptyString(payload.actorId) ||
    !ALLOWED_AUTH_ROLES.has(payload.actorRole)
  ) {
    throw new Error(
      `Preload request validation failed for ${channel}: requestId/submissionId/actorId/actorRole are required`
    );
  }

  const pack = payload.pack;
  if (
    !isObject(pack) ||
    !isNonEmptyString(pack.packName) ||
    (Object.prototype.hasOwnProperty.call(pack, "localPackPath") &&
      pack.localPackPath !== null &&
      !isNonEmptyString(pack.localPackPath)) ||
    !Array.isArray(pack.declaredTopLevelFolders) ||
    !pack.declaredTopLevelFolders.every((folder) => isNonEmptyString(folder)) ||
    !Number.isInteger(pack.sampleCount) ||
    pack.sampleCount < 0 ||
    typeof pack.containsUnsupportedNameTokens !== "boolean"
  ) {
    throw new Error(`Preload request validation failed for ${channel}: invalid pack payload`);
  }

  if (
    Object.prototype.hasOwnProperty.call(pack, "audioZip") &&
    pack.audioZip !== null &&
    (!isObject(pack.audioZip) ||
      !isNonEmptyString(pack.audioZip.filename) ||
      !Number.isInteger(pack.audioZip.sizeBytes) ||
      pack.audioZip.sizeBytes < 0)
  ) {
    throw new Error(`Preload request validation failed for ${channel}: invalid audioZip payload`);
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "ruleSetVersion") &&
    payload.ruleSetVersion !== undefined &&
    !isNonEmptyString(payload.ruleSetVersion)
  ) {
    throw new Error(
      `Preload request validation failed for ${channel}: ruleSetVersion must be non-empty string`
    );
  }
}

function assertQcEvaluationResponseData(data, channel) {
  if (
    !isObject(data) ||
    !isObject(data.report) ||
    !isNonEmptyString(data.appliedPolicyId) ||
    typeof data.idempotent !== "boolean"
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid QC evaluation envelope`
    );
  }

  const report = data.report;
  const validReportStatus = new Set(["passed", "failed"]);
  if (
    !isNonEmptyString(report.reportId) ||
    !isNonEmptyString(report.submissionId) ||
    !validReportStatus.has(report.status) ||
    !isObject(report.summary) ||
    !Array.isArray(report.findings) ||
    !isIsoTimestamp(report.generatedAt) ||
    !isNonEmptyString(report.ruleSetVersion) ||
    !Number.isInteger(report.policyVersion)
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid QC report payload`);
  }

  const summary = report.summary;
  if (
    !Number.isInteger(summary.blockingFailures) ||
    summary.blockingFailures < 0 ||
    !Number.isInteger(summary.warnings) ||
    summary.warnings < 0 ||
    !Number.isInteger(summary.evaluatedRuleCount) ||
    summary.evaluatedRuleCount < 0
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid report summary`);
  }
}

function assertQcReportFinding(item, channel, phase) {
  var validationPhase = phase === "request" ? "request" : "response";
  const validSeverity = item?.severity === "blocking" || item?.severity === "warning";
  if (
    !isObject(item) ||
    !isNonEmptyString(item.findingId) ||
    !isNonEmptyString(item.ruleId) ||
    !validSeverity ||
    !isNonEmptyString(item.category) ||
    !isNonEmptyString(item.message) ||
    !isNonEmptyString(item.remediation)
  ) {
    throw new Error(`Preload ${validationPhase} validation failed for ${channel}: invalid report finding`);
  }

  if (
    Object.prototype.hasOwnProperty.call(item, "fileRef") &&
    item.fileRef !== null &&
    item.fileRef !== undefined &&
    !isNonEmptyString(item.fileRef)
  ) {
    throw new Error(`Preload ${validationPhase} validation failed for ${channel}: invalid finding fileRef`);
  }

  if (
    Object.prototype.hasOwnProperty.call(item, "diffTag") &&
    item.diffTag !== undefined &&
    !ALLOWED_QC_FINDING_DIFF_TAGS.has(item.diffTag)
  ) {
    throw new Error(`Preload ${validationPhase} validation failed for ${channel}: invalid finding diffTag`);
  }
}

function assertNotificationItem(item, channel) {
  if (
    !isObject(item) ||
    !isNonEmptyString(item.notificationId) ||
    !ALLOWED_NOTIFICATION_TYPES.has(item.type) ||
    !ALLOWED_NOTIFICATION_SEVERITIES.has(item.severity) ||
    !ALLOWED_NOTIFICATION_STATUSES.has(item.status) ||
    !ALLOWED_NOTIFICATION_CHANNELS.has(item.channel) ||
    !isNonEmptyString(item.title) ||
    !isNonEmptyString(item.message) ||
    typeof item.read !== "boolean" ||
    !Number.isInteger(item.attempts) ||
    item.attempts < 0 ||
    !Number.isInteger(item.maxAttempts) ||
    item.maxAttempts < 1 ||
    !isIsoTimestamp(item.createdAt) ||
    !isIsoTimestamp(item.updatedAt)
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid notification item`);
  }

  if (
    Object.prototype.hasOwnProperty.call(item, "submissionId") &&
    item.submissionId !== null &&
    item.submissionId !== undefined &&
    !isNonEmptyString(item.submissionId)
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: submissionId must be string|null`
    );
  }

  if (
    item.readAt !== null &&
    item.readAt !== undefined &&
    !isIsoTimestamp(item.readAt)
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid readAt timestamp`);
  }
}

function assertIsoOrNull(value, fieldName, channel) {
  if (value !== null && !isIsoTimestamp(value)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid ${fieldName}`);
  }
}

function assertJobPayload(job, channel) {
  if (
    !isObject(job) ||
    !isNonEmptyString(job.id) ||
    !isNonEmptyString(job.jobType) ||
    !isNonEmptyString(job.idempotencyKey) ||
    !isNonEmptyString(job.status) ||
    !Number.isInteger(job.attemptCount) ||
    !Number.isInteger(job.maxAttempts) ||
    !isObject(job.payloadJson) ||
    !isIsoTimestamp(job.createdAt)
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid job payload`);
  }

  assertIsoOrNull(job.startedAt, "startedAt", channel);
  assertIsoOrNull(job.endedAt, "endedAt", channel);
  assertIsoOrNull(job.scheduledFor, "scheduledFor", channel);
  assertIsoOrNull(job.nextRetryAt, "nextRetryAt", channel);
}

function assertSubmissionRecord(record, channel) {
  if (
    !isObject(record) ||
    !isNonEmptyString(record.submissionId) ||
    !isNonEmptyString(record.creatorId) ||
    !isNonEmptyString(record.currentState) ||
    !Number.isInteger(record.version) ||
    record.version < 0 ||
    !Array.isArray(record.tags) ||
    !record.tags.every((tag) => typeof tag === "string") ||
    typeof record.airtableFormCompleted !== "boolean" ||
    !isIsoTimestamp(record.createdAt) ||
    !isIsoTimestamp(record.updatedAt)
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid submission record payload`
    );
  }

  if (record.draftLastSavedAt !== null && record.draftLastSavedAt !== undefined) {
    assertIsoOrNull(record.draftLastSavedAt, "draftLastSavedAt", channel);
  }

  if (record.airtableLastSyncedAt !== null && record.airtableLastSyncedAt !== undefined) {
    assertIsoOrNull(record.airtableLastSyncedAt, "airtableLastSyncedAt", channel);
  }
}

function assertStorageHandoffSnapshot(snapshot, channel) {
  if (
    !isObject(snapshot) ||
    !isNonEmptyString(snapshot.handoffId) ||
    !isNonEmptyString(snapshot.submissionId) ||
    !isNonEmptyString(snapshot.intakeSessionId) ||
    !["queued", "in_progress", "paused", "completed", "failed", "canceled"].includes(snapshot.status) ||
    !isNonEmptyString(snapshot.target) ||
    !Number.isInteger(snapshot.progressPercent) ||
    snapshot.progressPercent < 0 ||
    snapshot.progressPercent > 100 ||
    !Number.isInteger(snapshot.uploadedBytes) ||
    snapshot.uploadedBytes < 0 ||
    !Number.isInteger(snapshot.totalBytes) ||
    snapshot.totalBytes < 0 ||
    !Number.isInteger(snapshot.objectCount) ||
    snapshot.objectCount < 0 ||
    !Number.isInteger(snapshot.uploadedFiles) ||
    snapshot.uploadedFiles < 0 ||
    !Number.isInteger(snapshot.totalFiles) ||
    snapshot.totalFiles < 0 ||
    typeof snapshot.checksumVerified !== "boolean" ||
    !isIsoTimestamp(snapshot.createdAt) ||
    !isIsoTimestamp(snapshot.updatedAt)
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid handoff snapshot`);
  }

  if (snapshot.completedAt !== null && snapshot.completedAt !== undefined) {
    assertIsoOrNull(snapshot.completedAt, "completedAt", channel);
  }

  if (snapshot.error !== null && snapshot.error !== undefined && !isNonEmptyString(snapshot.error)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid handoff error`);
  }
}

function assertAirtableStateRecord(record, channel) {
  if (
    !isObject(record) ||
    !isNonEmptyString(record.submissionId) ||
    !isNonEmptyString(record.syncStatus) ||
    typeof record.airtableFormCompleted !== "boolean"
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid Airtable state payload`
    );
  }

  assertIsoOrNull(record.lastSyncedAt, "lastSyncedAt", channel);

  if (record.mappedPayload !== null && record.mappedPayload !== undefined) {
    if (
      !isObject(record.mappedPayload) ||
      !Array.isArray(record.mappedPayload.tags)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid mappedPayload payload`
      );
    }
  }
}

function assertTimelineRecord(record, channel) {
  if (
    !isObject(record) ||
    !isNonEmptyString(record.transitionId) ||
    !isNonEmptyString(record.toState) ||
    !isIsoTimestamp(record.createdAt)
  ) {
    throw new Error(
      `Preload response validation failed for ${channel}: invalid timeline record payload`
    );
  }
}
function parseEnvironment(rawEnvironment) {
  const normalizedValue = String(rawEnvironment || "local").trim().toLowerCase();

  if (!ALLOWED_ENVIRONMENTS.has(normalizedValue)) {
    return "local";
  }

  return normalizedValue;
}

function parseHealthPort(rawPort) {
  const parsedPort = Number.parseInt(String(rawPort || "4815"), 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    return 4815;
  }

  return parsedPort;
}

function assertRequest(channel, payload) {
  if (!isObject(payload)) {
    throw new Error(`Preload request validation failed for ${channel}: payload must be object`);
  }

  if (channel === IPC_CHANNELS.AUTH_GET_SESSION) {
    if (
      Object.prototype.hasOwnProperty.call(payload, "includePermissions") &&
      typeof payload.includePermissions !== "boolean"
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: includePermissions must be boolean`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_LOGIN) {
    if (!isNonEmptyString(payload.email) || !isNonEmptyString(payload.password)) {
      throw new Error(
        `Preload request validation failed for ${channel}: email/password must be non-empty strings`
      );
    }
    assertOptionalString(payload.deviceId, "deviceId", channel);
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_REGISTER) {
    if (
      !isNonEmptyString(payload.email) ||
      !isNonEmptyString(payload.password) ||
      !isNonEmptyString(payload.otpVerificationToken)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: email/password/otpVerificationToken are required`
      );
    }
    if (payload.password.length < 12) {
      throw new Error(
        `Preload request validation failed for ${channel}: password must be at least 12 characters`
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "roles")) {
      if (
        !Array.isArray(payload.roles) ||
        payload.roles.length === 0 ||
        payload.roles.some((role) => !ALLOWED_AUTH_ROLES.has(role))
      ) {
        throw new Error(
          `Preload request validation failed for ${channel}: roles must include creator/reviewer/admin`
        );
      }
    }
    assertOptionalString(payload.deviceId, "deviceId", channel);
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_OTP_SEND) {
    if (!isNonEmptyString(payload.target) || !ALLOWED_OTP_PURPOSES.has(payload.purpose)) {
      throw new Error(
        `Preload request validation failed for ${channel}: target/purpose are invalid`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_OTP_VERIFY) {
    if (
      !isNonEmptyString(payload.challengeId) ||
      !ALLOWED_OTP_PURPOSES.has(payload.purpose) ||
      !isNonEmptyString(payload.otpCode)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: challengeId/purpose/otpCode are invalid`
      );
    }

    if (payload.otpCode.length < 4 || payload.otpCode.length > 8) {
      throw new Error(
        `Preload request validation failed for ${channel}: otpCode length must be between 4 and 8`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_FORGOT_PASSWORD) {
    if (!isNonEmptyString(payload.email)) {
      throw new Error(`Preload request validation failed for ${channel}: email is required`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_RESET_PASSWORD) {
    if (
      !isNonEmptyString(payload.email) ||
      !isNonEmptyString(payload.otpVerificationToken) ||
      !isNonEmptyString(payload.newPassword)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: email/otpVerificationToken/newPassword are required`
      );
    }
    if (payload.newPassword.length < 12) {
      throw new Error(
        `Preload request validation failed for ${channel}: newPassword must be at least 12 characters`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.QC_EVALUATE_PACK) {
    assertQcEvaluateRequest(payload, channel);
    return;
  }

  if (channel === IPC_CHANNELS.QC_LIST_RULES) {
    if (
      Object.prototype.hasOwnProperty.call(payload, "includeDisabled") &&
      typeof payload.includeDisabled !== "boolean"
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: includeDisabled must be boolean`
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "policyId")) {
      assertOptionalString(payload.policyId, "policyId", channel);
    }
    return;
  }

  if (channel === IPC_CHANNELS.QC_RESULTS_GET) {
    if (!isNonEmptyString(payload.submissionId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: submissionId must be non-empty string`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.QC_REPORT_EXPORT) {
    if (
      !isNonEmptyString(payload.submissionId) ||
      !isNonEmptyString(payload.runId) ||
      !isIsoTimestamp(payload.generatedAt) ||
      !isNonEmptyString(payload.ruleSetVersion) ||
      !Number.isInteger(payload.policyVersion) ||
      payload.policyVersion < 1 ||
      (payload.status !== "passed" && payload.status !== "failed") ||
      !isIsoTimestamp(payload.startedAt) ||
      !isIsoTimestamp(payload.completedAt) ||
      !Array.isArray(payload.findings)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid export payload fields`
      );
    }
    for (const finding of payload.findings) {
      assertQcReportFinding(finding, channel, "request");
    }
    return;
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_LIST) {
    if (
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId/actorRole are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "includeRead") &&
      typeof payload.includeRead !== "boolean"
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: includeRead must be boolean`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_MARK_READ) {
    if (
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole) ||
      !Array.isArray(payload.notificationIds) ||
      payload.notificationIds.length === 0 ||
      payload.notificationIds.some((id) => !isNonEmptyString(id))
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId/actorRole/notificationIds are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ) {
    if (!isNonEmptyString(payload.actorId) || !ALLOWED_AUTH_ROLES.has(payload.actorRole)) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId/actorRole are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_RETRY) {
    if (
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole) ||
      !isNonEmptyString(payload.notificationId)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId/actorRole/notificationId are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.REVIEW_QUEUE_LIST) {
    if (
      !isNonEmptyString(payload.actorId) ||
      (payload.actorRole !== "reviewer" && payload.actorRole !== "admin")
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId and reviewer/admin actorRole are required`
      );
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.REVIEW_SUBMISSION_GET ||
    channel === IPC_CHANNELS.REVIEW_APPROVE ||
    channel === IPC_CHANNELS.REVIEW_REJECT ||
    channel === IPC_CHANNELS.REVIEW_TAG_ADD ||
    channel === IPC_CHANNELS.REVIEW_FLAG_ADD ||
    channel === IPC_CHANNELS.REVIEW_REOPEN
  ) {
    if (
      !isNonEmptyString(payload.submissionId) ||
      !isNonEmptyString(payload.actorId) ||
      (payload.actorRole !== "reviewer" && payload.actorRole !== "admin")
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: submissionId/actorId/reviewer-admin actorRole are required`
      );
    }

    if (channel === IPC_CHANNELS.REVIEW_REJECT) {
      if (!isNonEmptyString(payload.reasonCode) || !isNonEmptyString(payload.notes)) {
        throw new Error(
          `Preload request validation failed for ${channel}: reasonCode and notes are required`
        );
      }
    }

    if (channel === IPC_CHANNELS.REVIEW_TAG_ADD && !isNonEmptyString(payload.tag)) {
      throw new Error(`Preload request validation failed for ${channel}: tag is required`);
    }

    if (
      channel === IPC_CHANNELS.REVIEW_FLAG_ADD &&
      (!isNonEmptyString(payload.flagType) || !isNonEmptyString(payload.severity))
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: flagType and severity are required`
      );
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.ADMIN_CONFIGS_LIST ||
    channel === IPC_CHANNELS.ADMIN_QC_POLICY_GET
  ) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    if (
      channel === IPC_CHANNELS.ADMIN_CONFIGS_LIST &&
      Object.prototype.hasOwnProperty.call(payload, "includeDrafts") &&
      typeof payload.includeDrafts !== "boolean"
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: includeDrafts must be boolean`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_CONFIGS_DRAFT) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.configType) ||
      !isObject(payload.payloadJson)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId/actorRole/configType/payloadJson are required`
      );
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH ||
    channel === IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK
  ) {
    if (
      !isNonEmptyString(payload.id) ||
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.reason) ||
      !isNonEmptyString(payload.confirmation)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: id/admin actor context/reason/confirmation are required`
      );
    }
    return;
  }

  if (assertAdminIntegrationRequest(channel, payload, { IPC_CHANNELS, isNonEmptyString })) {
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST) {
    const validProvider =
      payload.provider === "dropbox" || payload.provider === "airtable" || payload.provider === "smtp";
    if (!validProvider || !isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: provider and admin actor context are required`
      );
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.sessionId)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context and sessionId are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_OPS_HISTORY_LIST) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "limit")) {
      if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 100) {
        throw new Error(
          `Preload request validation failed for ${channel}: limit must be integer 1..100`
        );
      }
    }
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE) {
    if (
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.reason)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: requestId/actorId/actorRole/reason are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "expectedPolicyVersion") &&
      (!Number.isInteger(payload.expectedPolicyVersion) || payload.expectedPolicyVersion < 1)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: expectedPolicyVersion must be integer >= 1`
      );
    }
    if (!isObject(payload.policy) || !isNonEmptyString(payload.policy.policyId)) {
      throw new Error(`Preload request validation failed for ${channel}: invalid policy payload`);
    }
    if (
      Object.prototype.hasOwnProperty.call(payload.policy, "ruleSetVersion") &&
      payload.policy.ruleSetVersion !== undefined &&
      !isNonEmptyString(payload.policy.ruleSetVersion)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: ruleSetVersion must be non-empty string`
      );
    }
    if (!Array.isArray(payload.policy.rules) || payload.policy.rules.length === 0) {
      throw new Error(
        `Preload request validation failed for ${channel}: policy.rules must be a non-empty array`
      );
    }
    for (const rule of payload.policy.rules) {
      assertRuleBinding(rule, channel);
    }
    return;
  }

  if (channel === IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_TOGGLE) {
    if (typeof payload.enabled !== "boolean") {
      throw new Error(`Preload request validation failed for ${channel}: enabled must be boolean`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_STATUS) {
    if (Object.keys(payload).length > 0) {
      throw new Error(`Preload request validation failed for ${channel}: payload must be empty`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.JOBS_ENQUEUE) {
    if (
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.jobType) ||
      !isNonEmptyString(payload.idempotencyKey) ||
      !isObject(payload.payloadJson)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: requestId/jobType/idempotencyKey/payloadJson are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.JOBS_GET) {
    if (!isNonEmptyString(payload.id)) {
      throw new Error(`Preload request validation failed for ${channel}: id is required`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.JOBS_REPLAY) {
    if (
      !isNonEmptyString(payload.id) ||
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.actorId) ||
      !isNonEmptyString(payload.reason) ||
      !isNonEmptyString(payload.confirmation)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: id/requestId/actorId/reason/confirmation are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SCHEDULING_RESOLVE) {
    if (
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.submissionId) ||
      !isObject(payload.schedulingEvent) ||
      payload.schedulingEvent.eventName !== "submission.approved.scheduling.v1"
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid scheduling resolve payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SCHEDULING_OVERRIDE) {
    if (
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.submissionId) ||
      !isIsoTimestamp(payload.newReleaseAt) ||
      !isNonEmptyString(payload.reason) ||
      !isNonEmptyString(payload.actorId)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid scheduling override payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE) {
    if (
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.submissionId) ||
      !isNonEmptyString(payload.actorId) ||
      (payload.actorRole !== "system" && payload.actorRole !== "admin")
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid scheduling trigger payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (Object.keys(payload).length > 0) {
      throw new Error(`Preload request validation failed for ${channel}: payload must be empty`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    const severityAllowed =
      payload.severity === "info" ||
      payload.severity === "warning" ||
      payload.severity === "critical";
    const failureClassAllowed =
      payload.failureClass === undefined ||
      payload.failureClass === null ||
      payload.failureClass === "integration_failure" ||
      payload.failureClass === "retry_exhaustion" ||
      payload.failureClass === "scheduling_terminal_failure";
    const remediationStatusAllowed =
      payload.remediationStatus === undefined ||
      payload.remediationStatus === "open" ||
      payload.remediationStatus === "acknowledged" ||
      payload.remediationStatus === "resolved";
    if (
      !isNonEmptyString(payload.source) ||
      !severityAllowed ||
      !isNonEmptyString(payload.note) ||
      !isNonEmptyString(payload.linkedEntity) ||
      !failureClassAllowed ||
      !remediationStatusAllowed
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid incident annotation payload`
      );
    }
    if (
      payload.correlationId !== undefined &&
      payload.correlationId !== null &&
      !isNonEmptyString(payload.correlationId)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: correlationId must be non-empty string|null`
      );
    }
    if (
      payload.remediationOwner !== undefined &&
      payload.remediationOwner !== null &&
      !isNonEmptyString(payload.remediationOwner)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: remediationOwner must be non-empty string|null`
      );
    }
    if (
      payload.remediationLink !== undefined &&
      payload.remediationLink !== null &&
      !isNonEmptyString(payload.remediationLink)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: remediationLink must be non-empty string|null`
      );
    }
    if (
      payload.auditEventId !== undefined &&
      payload.auditEventId !== null &&
      !isNonEmptyString(payload.auditEventId)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: auditEventId must be non-empty string|null`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.CREATOR_PROFILE_GET) {
    if (!isNonEmptyString(payload.actorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId is required`
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "userId")) {
      assertOptionalString(payload.userId, "userId", channel);
    }
    return;
  }

  if (channel === IPC_CHANNELS.CREATOR_PROFILE_PUT) {
    if (!isNonEmptyString(payload.actorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: actorId is required`
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "userId")) {
      assertOptionalString(payload.userId, "userId", channel);
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "displayName") &&
      payload.displayName !== null
    ) {
      assertOptionalString(payload.displayName, "displayName", channel);
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "labelName") &&
      payload.labelName !== null
    ) {
      assertOptionalString(payload.labelName, "labelName", channel);
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "defaultsJson") &&
      !isObject(payload.defaultsJson)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: defaultsJson must be object`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_DRAFT) {
    if (!isNonEmptyString(payload.submissionId) || !isNonEmptyString(payload.creatorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: submissionId/creatorId are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "releaseMonth") &&
      payload.releaseMonth !== null &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(payload.releaseMonth))
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid releaseMonth format`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "tags") &&
      (!Array.isArray(payload.tags) || payload.tags.some((tag) => !isNonEmptyString(tag)))
    ) {
      throw new Error(`Preload request validation failed for ${channel}: tags must be string[]`);
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "autosaveJson") &&
      payload.autosaveJson !== null &&
      !isObject(payload.autosaveJson)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: autosaveJson must be object|null`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_METADATA) {
    if (!isNonEmptyString(payload.submissionId) || !isNonEmptyString(payload.creatorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: submissionId/creatorId are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "releaseMonth") &&
      payload.releaseMonth !== null &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(payload.releaseMonth))
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid releaseMonth format`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "tags") &&
      payload.tags !== null &&
      (!Array.isArray(payload.tags) || payload.tags.some((tag) => !isNonEmptyString(tag)))
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: tags must be string[]|null`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "autosaveJson") &&
      payload.autosaveJson !== null &&
      !isObject(payload.autosaveJson)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: autosaveJson must be object|null`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_LIST) {
    if (!isNonEmptyString(payload.creatorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: creatorId is required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_TIMELINE) {
    if (!isNonEmptyString(payload.submissionId) || !isNonEmptyString(payload.creatorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: submissionId/creatorId are required`
      );
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC ||
    channel === IPC_CHANNELS.SUBMISSION_AIRTABLE_RESET
  ) {
    if (!isNonEmptyString(payload.submissionId) || !isNonEmptyString(payload.creatorId)) {
      throw new Error(
        `Preload request validation failed for ${channel}: submissionId/creatorId are required`
      );
    }
    if (
      channel === IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC &&
      Object.prototype.hasOwnProperty.call(payload, "forceRelink") &&
      typeof payload.forceRelink !== "boolean"
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: forceRelink must be boolean`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_TRANSITION) {
    if (
      !isNonEmptyString(payload.submissionId) ||
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.toState) ||
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid transition payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_FOLDER_SELECT) {
    if (Object.keys(payload).length > 0) {
      throw new Error(`Preload request validation failed for ${channel}: payload must be empty`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_SESSION_START) {
    if (
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.submissionId) ||
      !isNonEmptyString(payload.creatorId) ||
      !isNonEmptyString(payload.packName)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid intake session payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_MANIFEST_PUT) {
    if (
      !isNonEmptyString(payload.intakeSessionId) ||
      !isNonEmptyString(payload.requestId) ||
      !Array.isArray(payload.files) ||
      payload.files.length === 0
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid intake manifest payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_HANDOFF_CREATE) {
    if (
      !isNonEmptyString(payload.intakeSessionId) ||
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid intake handoff payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET) {
    if (!isNonEmptyString(payload.handoffId)) {
      throw new Error(`Preload request validation failed for ${channel}: handoffId is required`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_HANDOFF_CONTROL) {
    if (
      !isNonEmptyString(payload.handoffId) ||
      !isNonEmptyString(payload.requestId) ||
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole) ||
      !["pause", "resume", "cancel"].includes(String(payload.action || '').trim().toLowerCase())
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: invalid handoff control payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_LOCK) {
    if (
      !isNonEmptyString(payload.submissionId) ||
      !isNonEmptyString(payload.actorId) ||
      !ALLOWED_AUTH_ROLES.has(payload.actorRole)
    ) {
      throw new Error(`Preload request validation failed for ${channel}: invalid intake lock payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (!isNonEmptyString(response.data.snapshot) || !isIsoTimestamp(response.data.capturedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid metrics payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    const annotation = response.data.annotation;
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(annotation) ||
      !isNonEmptyString(annotation.id) ||
      !isNonEmptyString(annotation.source) ||
      !isNonEmptyString(annotation.severity) ||
      !isNonEmptyString(annotation.note) ||
      !isNonEmptyString(annotation.linkedEntity) ||
      !isIsoTimestamp(annotation.createdAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation payload`);
    }
    if (
      annotation.severity !== "info" &&
      annotation.severity !== "warning" &&
      annotation.severity !== "critical"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation severity`);
    }
    if (
      annotation.failureClass !== null &&
      annotation.failureClass !== undefined &&
      annotation.failureClass !== "integration_failure" &&
      annotation.failureClass !== "retry_exhaustion" &&
      annotation.failureClass !== "scheduling_terminal_failure"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation failureClass`);
    }
    if (
      annotation.remediationStatus !== "open" &&
      annotation.remediationStatus !== "acknowledged" &&
      annotation.remediationStatus !== "resolved"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationStatus`);
    }
    if (
      annotation.correlationId !== null &&
      annotation.correlationId !== undefined &&
      !isNonEmptyString(annotation.correlationId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation correlationId`);
    }
    if (
      annotation.remediationOwner !== null &&
      annotation.remediationOwner !== undefined &&
      !isNonEmptyString(annotation.remediationOwner)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationOwner`);
    }
    if (
      annotation.remediationLink !== null &&
      annotation.remediationLink !== undefined &&
      !isNonEmptyString(annotation.remediationLink)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationLink`);
    }
    if (
      annotation.auditEventId !== null &&
      annotation.auditEventId !== undefined &&
      !isNonEmptyString(annotation.auditEventId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation auditEventId`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (!isNonEmptyString(response.data.snapshot) || !isIsoTimestamp(response.data.capturedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid metrics payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    const annotation = response.data.annotation;
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(annotation) ||
      !isNonEmptyString(annotation.id) ||
      !isNonEmptyString(annotation.source) ||
      !isNonEmptyString(annotation.severity) ||
      !isNonEmptyString(annotation.note) ||
      !isNonEmptyString(annotation.linkedEntity) ||
      !isIsoTimestamp(annotation.createdAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation payload`);
    }
    if (
      annotation.severity !== "info" &&
      annotation.severity !== "warning" &&
      annotation.severity !== "critical"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation severity`);
    }
    if (
      annotation.failureClass !== null &&
      annotation.failureClass !== undefined &&
      annotation.failureClass !== "integration_failure" &&
      annotation.failureClass !== "retry_exhaustion" &&
      annotation.failureClass !== "scheduling_terminal_failure"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation failureClass`);
    }
    if (
      annotation.remediationStatus !== "open" &&
      annotation.remediationStatus !== "acknowledged" &&
      annotation.remediationStatus !== "resolved"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationStatus`);
    }
    if (
      annotation.correlationId !== null &&
      annotation.correlationId !== undefined &&
      !isNonEmptyString(annotation.correlationId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation correlationId`);
    }
    if (
      annotation.remediationOwner !== null &&
      annotation.remediationOwner !== undefined &&
      !isNonEmptyString(annotation.remediationOwner)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationOwner`);
    }
    if (
      annotation.remediationLink !== null &&
      annotation.remediationLink !== undefined &&
      !isNonEmptyString(annotation.remediationLink)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationLink`);
    }
    if (
      annotation.auditEventId !== null &&
      annotation.auditEventId !== undefined &&
      !isNonEmptyString(annotation.auditEventId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation auditEventId`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (!isNonEmptyString(response.data.snapshot) || !isIsoTimestamp(response.data.capturedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid metrics payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    const annotation = response.data.annotation;
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(annotation) ||
      !isNonEmptyString(annotation.id) ||
      !isNonEmptyString(annotation.source) ||
      !isNonEmptyString(annotation.severity) ||
      !isNonEmptyString(annotation.note) ||
      !isNonEmptyString(annotation.linkedEntity) ||
      !isIsoTimestamp(annotation.createdAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (!isNonEmptyString(response.data.snapshot) || !isIsoTimestamp(response.data.capturedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid metrics payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.annotation) ||
      !isNonEmptyString(response.data.annotation.id) ||
      !isIsoTimestamp(response.data.annotation.createdAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.DESKTOP_VERIFY_SECURITY) {
    if (Object.keys(payload).length > 0) {
      throw new Error(`Preload request validation failed for ${channel}: payload must be empty`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS) {
    if (Object.prototype.hasOwnProperty.call(payload, "limit")) {
      const limit = payload.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error(
          `Preload request validation failed for ${channel}: limit must be integer 1..100`
        );
      }
    }
    return;
  }

  if (channel === IPC_CHANNELS.JOBS_ENQUEUE) {
    if (typeof response.data.idempotent !== "boolean" || !isObject(response.data.job)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid jobs enqueue payload`);
    }
    assertJobPayload(response.data.job, channel);
    return;
  }

  if (channel === IPC_CHANNELS.JOBS_GET) {
    if (!isObject(response.data.job)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid jobs get payload`);
    }
    assertJobPayload(response.data.job, channel);
    return;
  }

  if (channel === IPC_CHANNELS.JOBS_REPLAY) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.job) ||
      !isObject(response.data.deadLetter)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid jobs replay payload`);
    }
    assertJobPayload(response.data.job, channel);
    return;
  }

  if (channel === IPC_CHANNELS.SCHEDULING_RESOLVE) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.schedule) ||
      !isObject(response.data.releaseJob)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid scheduling resolve payload`);
    }
    assertJobPayload(response.data.releaseJob, channel);
    return;
  }

  if (channel === IPC_CHANNELS.SCHEDULING_OVERRIDE) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.schedule) ||
      !isObject(response.data.override) ||
      !isObject(response.data.releaseJob)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid scheduling override payload`);
    }
    assertJobPayload(response.data.releaseJob, channel);
    return;
  }

  if (channel === IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.schedule) ||
      !isObject(response.data.submission)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid scheduling trigger payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (!isNonEmptyString(response.data.snapshot) || !isIsoTimestamp(response.data.capturedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid metrics payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    const annotation = response.data.annotation;
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(annotation) ||
      !isNonEmptyString(annotation.id) ||
      !isNonEmptyString(annotation.source) ||
      !isNonEmptyString(annotation.severity) ||
      !isNonEmptyString(annotation.note) ||
      !isNonEmptyString(annotation.linkedEntity) ||
      !isIsoTimestamp(annotation.createdAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation payload`);
    }
    if (
      annotation.severity !== "info" &&
      annotation.severity !== "warning" &&
      annotation.severity !== "critical"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation severity`);
    }
    if (
      annotation.failureClass !== null &&
      annotation.failureClass !== undefined &&
      annotation.failureClass !== "integration_failure" &&
      annotation.failureClass !== "retry_exhaustion" &&
      annotation.failureClass !== "scheduling_terminal_failure"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation failureClass`);
    }
    if (
      annotation.remediationStatus !== "open" &&
      annotation.remediationStatus !== "acknowledged" &&
      annotation.remediationStatus !== "resolved"
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationStatus`);
    }
    if (
      annotation.correlationId !== null &&
      annotation.correlationId !== undefined &&
      !isNonEmptyString(annotation.correlationId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation correlationId`);
    }
    if (
      annotation.remediationOwner !== null &&
      annotation.remediationOwner !== undefined &&
      !isNonEmptyString(annotation.remediationOwner)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationOwner`);
    }
    if (
      annotation.remediationLink !== null &&
      annotation.remediationLink !== undefined &&
      !isNonEmptyString(annotation.remediationLink)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation remediationLink`);
    }
    if (
      annotation.auditEventId !== null &&
      annotation.auditEventId !== undefined &&
      !isNonEmptyString(annotation.auditEventId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation auditEventId`);
    }
    return;
  }

  throw new Error(`Unknown IPC contract: ${channel}`);
}

function assertErrorEnvelope(channel, response) {
  if (!isObject(response.error)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid error envelope`);
  }

  const { code, message, reason, channel: errorChannel } = response.error;
  if (!KNOWN_ERROR_CODES.has(code)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid error code`);
  }
  if (
    !isNonEmptyString(message) ||
    !isNonEmptyString(reason) ||
    !isNonEmptyString(errorChannel)
  ) {
    throw new Error(`Preload response validation failed for ${channel}: invalid error fields`);
  }
}

function assertSuccessData(channel, response) {
  if (!isObject(response.data)) {
    throw new Error(`Preload response validation failed for ${channel}: invalid data envelope`);
  }

  if (channel === IPC_CHANNELS.AUTH_GET_SESSION) {
    const actor = response.data.actor;
    if (!isObject(actor) || !isNonEmptyString(actor.id) || !Array.isArray(actor.roles)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid actor payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_LOGIN || channel === IPC_CHANNELS.AUTH_REGISTER) {
    assertTokenBundleData(channel, response.data);
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_OTP_SEND || channel === IPC_CHANNELS.AUTH_FORGOT_PASSWORD) {
    assertOtpSendData(channel, response.data);
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_OTP_VERIFY) {
    if (
      !isNonEmptyString(response.data.otpVerificationToken) ||
      !isIsoTimestamp(response.data.expiresAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid otp verify payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUTH_RESET_PASSWORD) {
    if (
      !Number.isInteger(response.data.revokedSessionCount) ||
      response.data.revokedSessionCount < 0
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid reset response payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.QC_EVALUATE_PACK) {
    assertQcEvaluationResponseData(response.data, channel);
    return;
  }

  if (channel === IPC_CHANNELS.QC_LIST_RULES) {
    if (!Array.isArray(response.data.rules) || !isObject(response.data.policy)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid QC list payload`);
    }
    for (const rule of response.data.rules) {
      assertQcRuleDefinition(rule, channel);
    }
    assertPolicySnapshot(response.data.policy, channel);
    return;
  }

  if (channel === IPC_CHANNELS.QC_RESULTS_GET) {
    if (
      !ALLOWED_QC_RESULTS_STATUSES.has(response.data.status) ||
      !Array.isArray(response.data.findings)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid results payload`);
    }
    if (response.data.runId !== null && !isNonEmptyString(response.data.runId)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid runId`);
    }
    if (
      response.data.submissionId !== null &&
      !isNonEmptyString(response.data.submissionId)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid submissionId`);
    }
    if (response.data.startedAt !== null && !isIsoTimestamp(response.data.startedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid startedAt`);
    }
    if (response.data.completedAt !== null && !isIsoTimestamp(response.data.completedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid completedAt`);
    }
    if (response.data.generatedAt !== null && !isIsoTimestamp(response.data.generatedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid generatedAt`);
    }
    if (
      response.data.ruleSetVersion !== null &&
      !isNonEmptyString(response.data.ruleSetVersion)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid ruleSetVersion`
      );
    }
    if (
      response.data.policyVersion !== null &&
      (!Number.isInteger(response.data.policyVersion) || response.data.policyVersion < 1)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid policyVersion`
      );
    }
    for (const finding of response.data.findings) {
      assertQcReportFinding(finding, channel);
    }
    if (Object.prototype.hasOwnProperty.call(response.data, "history")) {
      if (!Array.isArray(response.data.history)) {
        throw new Error(`Preload response validation failed for ${channel}: invalid history`);
      }
      for (const run of response.data.history) {
        if (!ALLOWED_QC_RESULTS_STATUSES.has(run.status) || !Array.isArray(run.findings)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history payload`
          );
        }
        if (run.runId !== null && !isNonEmptyString(run.runId)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history runId`
          );
        }
        if (run.submissionId !== null && !isNonEmptyString(run.submissionId)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history submissionId`
          );
        }
        if (run.startedAt !== null && !isIsoTimestamp(run.startedAt)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history startedAt`
          );
        }
        if (run.completedAt !== null && !isIsoTimestamp(run.completedAt)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history completedAt`
          );
        }
        if (run.generatedAt !== null && !isIsoTimestamp(run.generatedAt)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history generatedAt`
          );
        }
        if (run.ruleSetVersion !== null && !isNonEmptyString(run.ruleSetVersion)) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history ruleSetVersion`
          );
        }
        if (
          run.policyVersion !== null &&
          (!Number.isInteger(run.policyVersion) || run.policyVersion < 1)
        ) {
          throw new Error(
            `Preload response validation failed for ${channel}: invalid run history policyVersion`
          );
        }
        for (const finding of run.findings) {
          assertQcReportFinding(finding, channel);
        }
      }
    }
    return;
  }

  if (channel === IPC_CHANNELS.QC_REPORT_EXPORT) {
    const hasValidPath =
      response.data.path === null ||
      (typeof response.data.path === "string" && response.data.path.length > 0);
    if (typeof response.data.canceled !== "boolean" || !hasValidPath) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid export response payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_LIST) {
    if (!Array.isArray(response.data.notifications)) {
      throw new Error(
        `Preload response validation failed for ${channel}: notifications must be array`
      );
    }
    for (const item of response.data.notifications) {
      assertNotificationItem(item, channel);
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.NOTIFICATIONS_MARK_READ ||
    channel === IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ
  ) {
    if (!Number.isInteger(response.data.updatedCount) || response.data.updatedCount < 0) {
      throw new Error(
        `Preload response validation failed for ${channel}: updatedCount must be integer >= 0`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_RETRY) {
    if (!isObject(response.data.notification)) {
      throw new Error(
        `Preload response validation failed for ${channel}: notification payload is required`
      );
    }
    assertNotificationItem(response.data.notification, channel);
    return;
  }

  if (channel === IPC_CHANNELS.CREATOR_PROFILE_GET || channel === IPC_CHANNELS.CREATOR_PROFILE_PUT) {
    if (!isNonEmptyString(response.data.userId) || !isObject(response.data.defaultsJson)) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid creator profile payload`
      );
    }
    if (response.data.updatedAt !== null && response.data.updatedAt !== undefined) {
      assertIsoOrNull(response.data.updatedAt, "updatedAt", channel);
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_DRAFT || channel === IPC_CHANNELS.SUBMISSION_METADATA) {
    if (!isObject(response.data.submission)) {
      throw new Error(
        `Preload response validation failed for ${channel}: submission payload is required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_LIST) {
    if (!Array.isArray(response.data.submissions)) {
      throw new Error(
        `Preload response validation failed for ${channel}: submissions must be an array`
      );
    }
    for (const record of response.data.submissions) {
      assertSubmissionRecord(record, channel);
    }
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_TIMELINE) {
    if (!Array.isArray(response.data.timeline)) {
      throw new Error(
        `Preload response validation failed for ${channel}: timeline must be an array`
      );
    }
    for (const record of response.data.timeline) {
      assertTimelineRecord(record, channel);
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC ||
    channel === IPC_CHANNELS.SUBMISSION_AIRTABLE_RESET
  ) {
    assertAirtableStateRecord(response.data, channel);
    return;
  }

  if (channel === IPC_CHANNELS.SUBMISSION_TRANSITION) {
    if (!isObject(response.data.submission) || typeof response.data.idempotent !== "boolean") {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid transition payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_FOLDER_SELECT) {
    if (
      !isNonEmptyString(response.data.path) ||
      !Number.isInteger(response.data.fileCount) ||
      !Array.isArray(response.data.topLevelFolders) ||
      !Array.isArray(response.data.files)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid folder selection payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_SESSION_START) {
    if (
      typeof response.data.created !== "boolean" ||
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.session)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid intake session payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_MANIFEST_PUT) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.session) ||
      !isObject(response.data.manifest)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid intake manifest payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_HANDOFF_CREATE) {
    if (typeof response.data.idempotent !== "boolean" || !isObject(response.data.handoff)) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid intake handoff payload`
      );
    }
    assertStorageHandoffSnapshot(response.data.handoff, channel);
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET) {
    if (!isObject(response.data.handoff)) {
      throw new Error(
        `Preload response validation failed for ${channel}: handoff payload is required`
      );
    }
    assertStorageHandoffSnapshot(response.data.handoff, channel);
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_HANDOFF_CONTROL) {
    if (!isObject(response.data.handoff)) {
      throw new Error(
        `Preload response validation failed for ${channel}: handoff payload is required`
      );
    }
    assertStorageHandoffSnapshot(response.data.handoff, channel);
    return;
  }

  if (channel === IPC_CHANNELS.INTAKE_LOCK) {
    if (
      !isNonEmptyString(response.data.submissionId) ||
      !isNonEmptyString(response.data.intakeSessionId) ||
      !Number.isInteger(response.data.lockedCount) ||
      !isIsoTimestamp(response.data.lockedAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid intake lock payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.REVIEW_QUEUE_LIST) {
    if (!Array.isArray(response.data.items)) {
      throw new Error(`Preload response validation failed for ${channel}: items must be array`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.REVIEW_SUBMISSION_GET) {
    if (
      !isObject(response.data.submission) ||
      !isObject(response.data.metadata) ||
      !Array.isArray(response.data.qcFindings) ||
      !Array.isArray(response.data.decisions) ||
      !Array.isArray(response.data.tags) ||
      !Array.isArray(response.data.flags)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid review submission payload`
      );
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.REVIEW_APPROVE ||
    channel === IPC_CHANNELS.REVIEW_REJECT ||
    channel === IPC_CHANNELS.REVIEW_REOPEN
  ) {
    if (!isObject(response.data.decision) || !isObject(response.data.transition)) {
      throw new Error(
        `Preload response validation failed for ${channel}: decision/transition are required`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.REVIEW_TAG_ADD) {
    if (!isObject(response.data.tag)) {
      throw new Error(`Preload response validation failed for ${channel}: tag payload is required`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.REVIEW_FLAG_ADD) {
    if (!isObject(response.data.flag)) {
      throw new Error(`Preload response validation failed for ${channel}: flag payload is required`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_CONFIGS_LIST) {
    if (!Array.isArray(response.data.configs)) {
      throw new Error(
        `Preload response validation failed for ${channel}: configs must be an array`
      );
    }
    for (const config of response.data.configs) {
      assertAdminConfigSnapshot(config, channel);
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.ADMIN_CONFIGS_DRAFT ||
    channel === IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH ||
    channel === IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK
  ) {
    if (!isObject(response.data.config)) {
      throw new Error(`Preload response validation failed for ${channel}: config payload is required`);
    }
    assertAdminConfigSnapshot(response.data.config, channel);
    return;
  }

  if (assertAdminIntegrationSuccess(channel, response, { IPC_CHANNELS, isNonEmptyString, isIsoTimestamp })) {
    return;
  }
  if (
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST ||
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST
  ) {
    const integrations =
      channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST
        ? response.data.integrations
        : [response.data];
    if (!Array.isArray(integrations)) {
      throw new Error(`Preload response validation failed for ${channel}: integrations must be array`);
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET) {
    const statusValid =
      response.data.status === "READY" ||
      response.data.status === "NOT_CONFIGURED" ||
      response.data.status === "INVALID_TOKEN";
    if (
      response.data.provider !== "dropbox" ||
      !statusValid ||
      !isNonEmptyString(response.data.message)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox readiness payload`
      );
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START) {
    if (
      !isNonEmptyString(response.data.sessionId) ||
      response.data.status !== "pending" ||
      !isNonEmptyString(response.data.authorizeUrl) ||
      !isIsoTimestamp(response.data.startedAt)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox desktop OAuth start payload`
      );
    }
    return;
  }
  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS) {
    const validStatus =
      response.data.status === "pending" ||
      response.data.status === "completed" ||
      response.data.status === "failed" ||
      response.data.status === "expired";
    if (!isNonEmptyString(response.data.sessionId) || !validStatus || !isNonEmptyString(response.data.message)) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox desktop OAuth status payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_OPS_HISTORY_LIST) {
    if (!Array.isArray(response.data.entries)) {
      throw new Error(`Preload response validation failed for ${channel}: entries must be array`);
    }
    for (const entry of response.data.entries) {
      const hasValidActorId =
        entry.actorId === null || entry.actorId === undefined || isNonEmptyString(entry.actorId);
      const hasValidReason =
        entry.reason === null || entry.reason === undefined || isNonEmptyString(entry.reason);
      if (
        !isNonEmptyString(entry.id) ||
        !isNonEmptyString(entry.action) ||
        !hasValidActorId ||
        !hasValidReason ||
        !isNonEmptyString(entry.entity) ||
        !isIsoTimestamp(entry.timestamp)
      ) {
        throw new Error(
          `Preload response validation failed for ${channel}: invalid history entry payload`
        );
      }
    }
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_QC_POLICY_GET) {
    if (!isObject(response.data.policy)) {
      throw new Error(`Preload response validation failed for ${channel}: missing policy payload`);
    }
    assertPolicySnapshot(response.data.policy, channel);
    return;
  }

  if (channel === IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE) {
    if (
      !isObject(response.data.policy) ||
      !isObject(response.data.auditHook) ||
      !isObject(response.data.observabilityHook)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid admin policy response payload`
      );
    }
    assertPolicySnapshot(response.data.policy, channel);
    if (
      !isNonEmptyString(response.data.auditHook.action) ||
      !isNonEmptyString(response.data.auditHook.idempotencyKey)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid auditHook payload`
      );
    }
    if (
      !isNonEmptyString(response.data.observabilityHook.metricName) ||
      !isIsoTimestamp(response.data.observabilityHook.emittedAt)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid observabilityHook payload`
      );
    }
    return;
  }

  if (channel === IPC_CHANNELS.DESKTOP_VERIFY_SECURITY) {
    const checks = response.data.checks;
    const validChecks =
      isObject(checks) &&
      checks.contextIsolation === true &&
      checks.nodeIntegration === false &&
      checks.sandbox === true &&
      checks.navigationGuard === true;
    if (!validChecks) {
      throw new Error(`Preload response validation failed for ${channel}: invalid checks payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS) {
    if (!Array.isArray(response.data.events)) {
      throw new Error(`Preload response validation failed for ${channel}: events must be array`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    if (!isNonEmptyString(response.data.snapshot) || !isIsoTimestamp(response.data.capturedAt)) {
      throw new Error(`Preload response validation failed for ${channel}: invalid metrics payload`);
    }
    return;
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    if (
      typeof response.data.idempotent !== "boolean" ||
      !isObject(response.data.annotation) ||
      !isNonEmptyString(response.data.annotation.id) ||
      !isIsoTimestamp(response.data.annotation.createdAt)
    ) {
      throw new Error(`Preload response validation failed for ${channel}: invalid annotation payload`);
    }
    return;
  }

  if (
    channel === IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_TOGGLE ||
    channel === IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_STATUS
  ) {
    if (typeof response.data.enabled !== "boolean") {
      throw new Error(`Preload response validation failed for ${channel}: enabled must be boolean`);
    }
    return;
  }

  throw new Error(`Unknown IPC contract: ${channel}`);
}

function assertResponse(channel, response) {
  if (!isObject(response) || typeof response.ok !== "boolean") {
    throw new Error(`Preload response validation failed for ${channel}: invalid response shape`);
  }

  if (response.ok) {
    assertSuccessData(channel, response);
    return;
  }

  assertErrorEnvelope(channel, response);
}

function createContractInvoker() {
  return async function invokeChannel(channel, payload) {
    const safePayload = payload ?? {};
    const startedAt = Date.now();
    debugIpcLog("request", channel, safePayload);
    assertRequest(channel, safePayload);
    try {
      const rawResponse = await ipcRenderer.invoke(channel, safePayload);
      assertResponse(channel, rawResponse);
      debugIpcLog("response", channel, {
        durationMs: Date.now() - startedAt,
        ok: rawResponse.ok,
        error: rawResponse.ok ? null : rawResponse.error,
        data: rawResponse.ok ? rawResponse.data : null,
      });
      return rawResponse;
    } catch (error) {
      debugIpcLog("error", channel, {
        durationMs: Date.now() - startedAt,
        message: error && error.message ? error.message : String(error),
      });
      throw error;
    }
  };
}

function createPreloadApi(runtime) {
  const invokeChannel = createContractInvoker();
  return deepFreeze({
    system: {
      versions: {
        electron: process.versions.electron || "unknown",
        chrome: process.versions.chrome || "unknown",
      },
      runtime,
    },
    auth: {
      getSession: (payload = {}) => invokeChannel(IPC_CHANNELS.AUTH_GET_SESSION, payload),
      currentRole: async () => {
        const response = await invokeChannel(IPC_CHANNELS.AUTH_GET_SESSION, {
          includePermissions: false,
        });
        const roles =
          response && response.ok && response.data && response.data.actor
            ? response.data.actor.roles
            : [];
        return Array.isArray(roles) && roles.length > 0 ? roles[0] : null;
      },
      login: (payload) => invokeChannel(IPC_CHANNELS.AUTH_LOGIN, payload),
      register: (payload) => invokeChannel(IPC_CHANNELS.AUTH_REGISTER, payload),
      sendOtp: (payload) => invokeChannel(IPC_CHANNELS.AUTH_OTP_SEND, payload),
      verifyOtp: (payload) => invokeChannel(IPC_CHANNELS.AUTH_OTP_VERIFY, payload),
      forgotPassword: (payload) => invokeChannel(IPC_CHANNELS.AUTH_FORGOT_PASSWORD, payload),
      resetPassword: (payload) => invokeChannel(IPC_CHANNELS.AUTH_RESET_PASSWORD, payload),
    },
    qc: {
      evaluatePack: (payload) => invokeChannel(IPC_CHANNELS.QC_EVALUATE_PACK, payload),
      listRules: (payload = {}) => invokeChannel(IPC_CHANNELS.QC_LIST_RULES, payload),
      getResults: (payload) => invokeChannel(IPC_CHANNELS.QC_RESULTS_GET, payload),
      exportReport: (payload) => invokeChannel(IPC_CHANNELS.QC_REPORT_EXPORT, payload),
    },
    notifications: {
      list: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_LIST, payload),
      markRead: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_MARK_READ, payload),
      markAllRead: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ, payload),
      retry: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_RETRY, payload),
    },
    creator: {
      profile: {
        get: (payload) => invokeChannel(IPC_CHANNELS.CREATOR_PROFILE_GET, payload),
        put: (payload) => invokeChannel(IPC_CHANNELS.CREATOR_PROFILE_PUT, payload),
      },
    },
    submissions: {
      createDraft: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_DRAFT, payload),
      updateMetadata: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_METADATA, payload),
      list: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_LIST, payload),
      timeline: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_TIMELINE, payload),
      syncAirtable: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC, payload),
      resetAirtable: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_AIRTABLE_RESET, payload),
      transition: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_TRANSITION, payload),
    },
    intake: {
      selectFolder: () => invokeChannel(IPC_CHANNELS.INTAKE_FOLDER_SELECT, {}),
      startSession: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_SESSION_START, payload),
      putManifest: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_MANIFEST_PUT, payload),
      createHandoff: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_HANDOFF_CREATE, payload),
      getHandoffStatus: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET, payload),
      controlHandoff: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_HANDOFF_CONTROL, payload),
      lockSubmissionFiles: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_LOCK, payload),
    },
    review: {
      listQueue: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_QUEUE_LIST, payload),
      getSubmission: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_SUBMISSION_GET, payload),
      approve: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_APPROVE, payload),
      reject: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_REJECT, payload),
      addTag: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_TAG_ADD, payload),
      addFlag: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_FLAG_ADD, payload),
      reopen: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_REOPEN, payload),
    },
    admin: {
      configs: {
        list: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_LIST, payload),
        createDraft: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_DRAFT, payload),
        publish: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH, payload),
        rollback: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK, payload),
      },
      integrations: {
        listHealth: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST, payload),
        test: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST, payload),
        rotate: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE, payload),
        configureAirtable: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE, payload),
        configureSmtp: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_SMTP_CONFIGURE, payload),
        updateDropboxTokens: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE, payload),
        configureDropboxApp: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE, payload),
        getDropboxReadiness: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET, payload),
        startDropboxOauth: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START, payload),
        completeDropboxOauth: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE, payload),
        startDropboxOauthDesktop: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START, payload),
        getDropboxOauthDesktopStatus: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS, payload),
      },
      ops: {
        listHistory: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_OPS_HISTORY_LIST, payload),
      },
      qcPolicy: {
        get: (payload = { actorId: "desktop-local-admin", actorRole: "admin" }) =>
          invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_GET, payload),
        update: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE, payload),
        getActive: (payload = { actorId: "desktop-local-admin", actorRole: "admin" }) =>
          invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_GET, payload),
        updateActive: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE, payload),
      },
    },
    jobs: {
      enqueue: (payload) => invokeChannel(IPC_CHANNELS.JOBS_ENQUEUE, payload),
      get: (payload) => invokeChannel(IPC_CHANNELS.JOBS_GET, payload),
      replay: (payload) => invokeChannel(IPC_CHANNELS.JOBS_REPLAY, payload),
    },
    scheduling: {
      resolve: (payload) => invokeChannel(IPC_CHANNELS.SCHEDULING_RESOLVE, payload),
      override: (payload) => invokeChannel(IPC_CHANNELS.SCHEDULING_OVERRIDE, payload),
      triggerRelease: (payload) => invokeChannel(IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE, payload),
    },
    observability: {
      getMetrics: () => invokeChannel(IPC_CHANNELS.OBSERVABILITY_METRICS_GET, {}),
      annotateIncident: (payload) =>
        invokeChannel(IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE, payload),
    },
    desktop: {
      verifySecurityConfig: () => invokeChannel(IPC_CHANNELS.DESKTOP_VERIFY_SECURITY, {}),
      setPrivacyShield: (enabled) =>
        invokeChannel(IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_TOGGLE, { enabled }),
      getPrivacyShieldStatus: () => invokeChannel(IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_STATUS, {}),
    },
    audit: {
      listSecurityEvents: (payload = {}) =>
        invokeChannel(IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS, payload),
    },
  });
}

const runtime = deepFreeze({
  environment: parseEnvironment(process.env.SPLICE_ENV),
  healthPort: parseHealthPort(process.env.SPLICE_HEALTH_PORT),
  bypassAuth: process.env.FILEEATERS_BYPASS_AUTH === "1",
  platform: process.platform,
});

contextBridge.exposeInMainWorld("fileeaters", createPreloadApi(runtime));

contextBridge.exposeInMainWorld(
  "spliceApp",
  deepFreeze({
    versions: {
      electron: process.versions.electron || "unknown",
      chrome: process.versions.chrome || "unknown",
      node: process.versions.node || "unknown",
    },
    runtime,
  })
);
