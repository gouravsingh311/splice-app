const { z } = require("zod");

const CHANNEL_NAME_PATTERN = /^splice\.[a-z0-9.-]+\.v\d+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const IPC_CHANNELS = Object.freeze({
  AUTH_GET_SESSION: "splice.auth.session.get.v1",
  AUTH_LOGIN: "splice.auth.login.v1",
  AUTH_REGISTER: "splice.auth.register.v1",
  AUTH_OTP_SEND: "splice.auth.otp.send.v1",
  AUTH_OTP_VERIFY: "splice.auth.otp.verify.v1",
  AUTH_FORGOT_PASSWORD: "splice.auth.forgot-password.v1",
  AUTH_RESET_PASSWORD: "splice.auth.reset-password.v1",
  DESKTOP_VERIFY_SECURITY: "splice.desktop.security.verify-config.v1",
  AUDIT_LIST_SECURITY_EVENTS: "splice.audit.security-events.list.v1",
  AUDIT_EVENTS_LIST: "splice.audit.events.list.v1",
  AUDIT_EVENTS_EXPORT: "splice.audit.events.export.v1",
  QC_EVALUATE_PACK: "splice.qc.evaluate-pack.v1",
  QC_LIST_RULES: "splice.qc.rules.list.v1",
  QC_RESULTS_GET: "splice.qc.results.get.v1",
  QC_REPORT_EXPORT: "splice.qc.report.export.v1",
  NOTIFICATIONS_LIST: "splice.notifications.list.v1",
  NOTIFICATIONS_MARK_READ: "splice.notifications.mark-read.v1",
  NOTIFICATIONS_MARK_ALL_READ: "splice.notifications.mark-all-read.v1",
  NOTIFICATIONS_RETRY: "splice.notifications.retry.v1",
  REVIEW_QUEUE_LIST: "splice.review.queue.list.v1",
  REVIEW_SUBMISSION_GET: "splice.review.submission.get.v1",
  REVIEW_APPROVE: "splice.review.approve.v1",
  REVIEW_REJECT: "splice.review.reject.v1",
  REVIEW_TAG_ADD: "splice.review.tags.add.v1",
  REVIEW_FLAG_ADD: "splice.review.flags.add.v1",
  REVIEW_REOPEN: "splice.review.reopen.v1",
  ADMIN_CONFIGS_LIST: "splice.admin.configs.list.v1",
  ADMIN_CONFIGS_DRAFT: "splice.admin.configs.draft.v1",
  ADMIN_CONFIGS_PUBLISH: "splice.admin.configs.publish.v1",
  ADMIN_CONFIGS_ROLLBACK: "splice.admin.configs.rollback.v1",
  ADMIN_INTEGRATIONS_HEALTH_LIST: "splice.admin.integrations.health.list.v1",
  ADMIN_INTEGRATIONS_TEST: "splice.admin.integrations.test.v1",
  ADMIN_INTEGRATIONS_ROTATE: "splice.admin.integrations.rotate.v1",
  ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE: "splice.admin.integrations.airtable.configure.v1",
  ADMIN_INTEGRATIONS_SMTP_CONFIGURE: "splice.admin.integrations.smtp.configure.v1",
  ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE: "splice.admin.integrations.dropbox.tokens.update.v1",
  ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE: "splice.admin.integrations.dropbox.app-config.configure.v1",
  ADMIN_DROPBOX_READINESS_GET: "splice.admin.dropbox.readiness.get.v1",
  ADMIN_DROPBOX_OAUTH_START: "splice.admin.dropbox.oauth.start.v1",
  ADMIN_DROPBOX_OAUTH_COMPLETE: "splice.admin.dropbox.oauth.complete.v1",
  ADMIN_DROPBOX_OAUTH_DESKTOP_START: "splice.admin.dropbox.oauth.desktop.start.v1",
  ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS: "splice.admin.dropbox.oauth.desktop.status.v1",
  ADMIN_OPS_HISTORY_LIST: "splice.admin.ops.history.list.v1",
  ADMIN_QC_POLICY_GET: "splice.admin.qc.policy.get.v1",
  ADMIN_QC_POLICY_UPDATE: "splice.admin.qc.policy.update.v1",
  ADMIN_QC_POLICY_GET_ACTIVE: "splice.admin.qc.policy.get-active.v1",
  ADMIN_QC_POLICY_UPDATE_ACTIVE: "splice.admin.qc.policy.update-active.v1",
  JOBS_ENQUEUE: "splice.jobs.enqueue.v1",
  JOBS_GET: "splice.jobs.get.v1",
  JOBS_REPLAY: "splice.jobs.replay.v1",
  SCHEDULING_RESOLVE: "splice.scheduling.resolve.v1",
  SCHEDULING_OVERRIDE: "splice.scheduling.override.v1",
  SCHEDULING_TRIGGER_RELEASE: "splice.scheduling.trigger-release.v1",
  OBSERVABILITY_METRICS_GET: "splice.observability.metrics.get.v1",
  OBSERVABILITY_INCIDENTS_ANNOTATE: "splice.observability.incidents.annotate.v1",
  CREATOR_PROFILE_GET: "splice.creator.profile.get.v1",
  CREATOR_PROFILE_PUT: "splice.creator.profile.put.v1",
  SUBMISSION_DRAFT: "splice.submission.draft.v1",
  SUBMISSION_METADATA: "splice.submission.metadata.v1",
  SUBMISSION_LIST: "splice.submission.list.v1",
  SUBMISSION_TIMELINE: "splice.submission.timeline.v1",
  SUBMISSION_AIRTABLE_SYNC: "splice.submission.airtable.sync.v1",
  SUBMISSION_AIRTABLE_RESET: "splice.submission.airtable.reset.v1",
  INTAKE_FOLDER_SELECT: "splice.intake.folder.select.v1",
  INTAKE_SESSION_START: "splice.intake.session.start.v1",
  INTAKE_MANIFEST_PUT: "splice.intake.manifest.put.v1",
  INTAKE_HANDOFF_CREATE: "splice.intake.handoff.create.v1",
  INTAKE_HANDOFF_STATUS_GET: "splice.intake.handoff.status.get.v1",
  INTAKE_HANDOFF_CONTROL: "splice.intake.handoff.control.v1",
  INTAKE_LOCK: "splice.intake.lock.v1",
  SUBMISSION_TRANSITION: "splice.submission.transition.v1",
  DESKTOP_PRIVACY_SHIELD_TOGGLE: "splice.desktop.privacy.shield.toggle.v1",
  DESKTOP_PRIVACY_SHIELD_STATUS: "splice.desktop.privacy.shield.status.v1",
  // --- AI: Audio Streaming (PRD-AI-01) ---
  AI_AUDIO_START: "splice.ai.audio.start.v1",
  AI_AUDIO_STOP: "splice.ai.audio.stop.v1",
  AI_AUDIO_STATUS: "splice.ai.audio.status.v1",
  AI_AUDIO_ACK: "splice.ai.audio.ack.v1",       // push channel (main → renderer)
});

const AUTH_ERROR_CODES = Object.freeze([
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
  "ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
  "TRANSITION_NOT_ALLOWED",
  "TRANSITION_FORBIDDEN",
  "MISSING_REQUIRED_REASON",
  "JOB_NOT_FOUND",
  "JOB_REPLAY_NOT_ALLOWED",
  "SCHEDULE_SUBMISSION_MISMATCH",
  "SCHEDULE_NOT_FOUND",
  "SCHEDULE_NOT_DUE",
  "SCHEDULE_OVERRIDE_FORBIDDEN",
  "INVALID_EVENT_NAME",
  "INTAKE_SESSION_NOT_FOUND",
  "INTAKE_MANIFEST_LOCKED",
  "INTAKE_MANIFEST_VERSION_CONFLICT",
  "STORAGE_HANDOFF_NOT_FOUND",
  "STORAGE_HANDOFF_PRECONDITION_FAILED",
  "STORAGE_HANDOFF_FORBIDDEN",
  "DROPBOX_NOT_CONFIGURED",
  "DROPBOX_AUTH_INVALID",
  "UNKNOWN_CHANNEL",
  "INTERNAL_ERROR",
]);

const ActorRoleSchema = z.enum(["creator", "reviewer", "admin"]);
const OtpPurposeSchema = z.enum(["register", "forgot-password"]);
const IpcErrorCodeSchema = z.enum(AUTH_ERROR_CODES);
const IsoTimestampSchema = z.string().regex(ISO_TIMESTAMP_PATTERN, "Expected ISO timestamp");
const NullableIsoTimestampSchema = z.union([IsoTimestampSchema, z.null()]);

const IpcErrorSchema = z
  .object({
    code: IpcErrorCodeSchema,
    message: z.string().min(1),
    reason: z.string().min(1),
    channel: z.string().min(1),
  })
  .strict();

const IpcErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: IpcErrorSchema,
  })
  .strict();

function createIpcSuccessResponseSchema(dataSchema) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
    })
    .strict();
}

const AuthGetSessionRequestSchema = z
  .object({
    includePermissions: z.boolean().optional().default(false),
  })
  .strict();

const AuthSessionDataSchema = z
  .object({
    actor: z
      .object({
        id: z.string().min(1),
        roles: z.array(ActorRoleSchema).min(1),
      })
      .strict(),
    permissions: z.array(z.string()),
    sessionIssuedAt: IsoTimestampSchema,
  })
  .strict();

const AuthUserSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(3),
    roles: z.array(ActorRoleSchema).min(1),
    permissions: z.array(z.string()),
    status: z.string().min(1),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

const AuthTokenBundleSchema = z
  .object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: IsoTimestampSchema,
    refreshToken: z.string().min(1),
    refreshTokenExpiresAt: IsoTimestampSchema,
    user: AuthUserSchema,
  })
  .strict();

const AuthLoginRequestSchema = z
  .object({
    email: z.string().min(3),
    password: z.string().min(1),
    deviceId: z.string().min(1).optional(),
  })
  .strict();

const AuthRegisterRequestSchema = z
  .object({
    email: z.string().min(3),
    password: z.string().min(12),
    otpVerificationToken: z.string().min(1),
    roles: z.array(ActorRoleSchema).min(1).optional(),
    deviceId: z.string().min(1).optional(),
  })
  .strict();

const AuthOtpSendRequestSchema = z
  .object({
    target: z.string().min(3),
    purpose: OtpPurposeSchema,
  })
  .strict();

const AuthOtpSendDataSchema = z
  .object({
    challengeId: z.string().min(1).nullable(),
    expiresAt: NullableIsoTimestampSchema,
    cooldownSeconds: z.number().int().min(0),
  })
  .strict();

const AuthOtpVerifyRequestSchema = z
  .object({
    challengeId: z.string().min(1),
    purpose: OtpPurposeSchema,
    otpCode: z.string().min(4).max(8),
  })
  .strict();

const AuthOtpVerifyDataSchema = z
  .object({
    otpVerificationToken: z.string().min(1),
    expiresAt: IsoTimestampSchema,
  })
  .strict();

const AuthForgotPasswordRequestSchema = z
  .object({
    email: z.string().min(3),
  })
  .strict();

const AuthResetPasswordRequestSchema = z
  .object({
    email: z.string().min(3),
    otpVerificationToken: z.string().min(1),
    newPassword: z.string().min(12),
  })
  .strict();

const AuthRevocationDataSchema = z
  .object({
    revokedSessionCount: z.number().int().min(0),
  })
  .strict();

const VerifySecurityConfigRequestSchema = z.object({}).strict();

const VerifySecurityConfigDataSchema = z
  .object({
    checks: z
      .object({
        contextIsolation: z.literal(true),
        nodeIntegration: z.literal(false),
        sandbox: z.literal(true),
        navigationGuard: z.literal(true),
      })
      .strict(),
  })
  .strict();

const AuditListSecurityEventsRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

const AuditSecurityEventSchema = z
  .object({
    id: z.string().min(1),
    channel: z.string().min(1),
    actorId: z.string().min(1),
    outcome: z.enum(["allowed", "denied"]),
    reason: z.string().min(1),
    timestamp: IsoTimestampSchema,
  })
  .strict();

const AuditListSecurityEventsDataSchema = z
  .object({
    events: z.array(AuditSecurityEventSchema),
  })
  .strict();

const AuditEventsListRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    action: z.union([z.string().min(1), z.null()]).optional().default(null),
    entityType: z.union([z.string().min(1), z.null()]).optional().default(null),
    entityId: z.union([z.string().min(1), z.null()]).optional().default(null),
    from: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
    to: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
    limit: z.number().int().min(1).max(500).optional().default(50),
    offset: z.number().int().min(0).optional().default(0),
  })
  .strict();

const AuditEventRecordSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.number().int().min(1),
    actorId: z.union([z.string(), z.null()]),
    action: z.string().min(1),
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    beforeJson: z.union([z.record(z.string(), z.unknown()), z.null()]),
    afterJson: z.union([z.record(z.string(), z.unknown()), z.null()]),
    metadata: z.union([z.record(z.string(), z.unknown()), z.null()]),
    occurredAt: NullableIsoTimestampSchema,
    requestId: z.union([z.string(), z.null()]),
    idempotencyKey: z.union([z.string(), z.null()]),
    createdAt: IsoTimestampSchema,
    prevHash: z.union([z.string(), z.null()]),
    eventHash: z.string().min(1),
  })
  .strict();

const AuditEventsListDataSchema = z
  .object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    events: z.array(AuditEventRecordSchema),
  })
  .strict();

const AuditEventsExportRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    format: z.enum(["json", "csv"]).optional().default("json"),
    includeHashChain: z.boolean().optional().default(true),
    action: z.union([z.string().min(1), z.null()]).optional().default(null),
    entityType: z.union([z.string().min(1), z.null()]).optional().default(null),
    entityId: z.union([z.string().min(1), z.null()]).optional().default(null),
    from: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
    to: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
    limit: z.number().int().min(1).max(5000).optional().default(500),
  })
  .strict();

const AuditEventsExportDataSchema = z
  .object({
    format: z.enum(["json", "csv"]),
    contentType: z.string().min(1),
    fileName: z.string().min(1),
    exportedAt: IsoTimestampSchema,
    signedAt: IsoTimestampSchema,
    signatureAlgorithm: z.string().min(1),
    signature: z.string().min(1),
    content: z.string(),
  })
  .strict();

const QcSeveritySchema = z.enum(["blocking", "warning"]);
const QcFindingStatusSchema = z.enum(["failed", "warning"]);
const QcReportStatusSchema = z.enum(["passed", "failed"]);

const QcAudioZipSchema = z
  .object({
    filename: z.string().min(1),
    sizeBytes: z.number().int().min(0),
  })
  .strict();

const QcPackInputSchema = z
  .object({
    packName: z.string().min(1),
    localPackPath: z.union([z.string().min(1), z.null()]).optional().default(null),
    declaredTopLevelFolders: z.array(z.string().min(1)),
    audioZip: z.union([QcAudioZipSchema, z.null()]).optional().default(null),
    sampleCount: z.number().int().min(0),
    containsUnsupportedNameTokens: z.boolean(),
  })
  .strict();

const QcEvaluatePackRequestSchema = z
  .object({
    requestId: z.string().min(1),
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
    pack: QcPackInputSchema,
    ruleSetVersion: z.string().min(1).optional(),
  })
  .strict();

const QcPolicyRuleBindingSchema = z
  .object({
    ruleId: z.string().min(1),
    enabled: z.boolean(),
    blockingOverride: z.union([z.boolean(), z.null()]).optional().default(null),
    params: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

const QcRuleDefinitionSchema = z
  .object({
    ruleId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: QcSeveritySchema,
    blocking: z.boolean(),
    category: z.string().min(1),
    remediation: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

const QcPolicySnapshotSchema = z
  .object({
    policyId: z.string().min(1),
    policyVersion: z.number().int().min(1),
    ruleSetVersion: z.string().min(1),
    rules: z.array(QcPolicyRuleBindingSchema),
    updatedBy: z.string().min(1),
    updatedAt: IsoTimestampSchema,
    reason: z.string().min(1),
  })
  .strict();

const QcFindingSchema = z
  .object({
    findingId: z.string().min(1),
    ruleId: z.string().min(1),
    severity: QcSeveritySchema,
    blocking: z.boolean(),
    status: QcFindingStatusSchema,
    message: z.string().min(1),
    remediation: z.string().min(1),
    context: z.record(z.string(), z.unknown()),
  })
  .strict();

const QcReportSummarySchema = z
  .object({
    blockingFailures: z.number().int().min(0),
    warnings: z.number().int().min(0),
    evaluatedRuleCount: z.number().int().min(0),
  })
  .strict();

const QcReportSchema = z
  .object({
    reportId: z.string().min(1),
    submissionId: z.string().min(1),
    status: QcReportStatusSchema,
    summary: QcReportSummarySchema,
    findings: z.array(QcFindingSchema),
    generatedAt: IsoTimestampSchema,
    ruleSetVersion: z.string().min(1),
    policyVersion: z.number().int().min(1),
  })
  .strict();

const QcEvaluationDataSchema = z
  .object({
    report: QcReportSchema,
    idempotent: z.boolean(),
    appliedPolicyId: z.string().min(1),
  })
  .strict();

const QcListRulesRequestSchema = z
  .object({
    includeDisabled: z.boolean().optional().default(false),
    policyId: z.string().min(1).optional(),
  })
  .strict();

const QcListRulesDataSchema = z
  .object({
    rules: z.array(QcRuleDefinitionSchema),
    policy: QcPolicySnapshotSchema,
  })
  .strict();

const QcResultsGetRequestSchema = z
  .object({
    submissionId: z.string().min(1),
  })
  .strict();

const QcFindingDiffTagSchema = z.enum(["new", "resolved", "unchanged"]);

const QcReportFindingSchema = z
  .object({
    findingId: z.string().min(1),
    ruleId: z.string().min(1),
    severity: QcSeveritySchema,
    category: z.string().min(1),
    fileRef: z.union([z.string().min(1), z.null()]),
    message: z.string().min(1),
    remediation: z.string().min(1),
    diffTag: QcFindingDiffTagSchema,
  })
  .strict();

const QcResultsRunSchema = z
  .object({
    runId: z.union([z.string().min(1), z.null()]),
    submissionId: z.union([z.string().min(1), z.null()]),
    findings: z.array(QcReportFindingSchema),
    status: z.enum(["passed", "failed", "not_run"]),
    startedAt: z.union([IsoTimestampSchema, z.null()]),
    completedAt: z.union([IsoTimestampSchema, z.null()]),
    generatedAt: z.union([IsoTimestampSchema, z.null()]),
    ruleSetVersion: z.union([z.string().min(1), z.null()]),
    policyVersion: z.union([z.number().int().min(1), z.null()]),
  })
  .strict();

const QcResultsGetDataSchema = z
  .object({
    runId: z.union([z.string().min(1), z.null()]),
    submissionId: z.union([z.string().min(1), z.null()]),
    findings: z.array(QcReportFindingSchema),
    status: z.enum(["passed", "failed", "not_run"]),
    startedAt: z.union([IsoTimestampSchema, z.null()]),
    completedAt: z.union([IsoTimestampSchema, z.null()]),
    generatedAt: z.union([IsoTimestampSchema, z.null()]),
    ruleSetVersion: z.union([z.string().min(1), z.null()]),
    policyVersion: z.union([z.number().int().min(1), z.null()]),
    history: z.array(QcResultsRunSchema).optional().default([]),
  })
  .strict();

const QcReportExportRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    runId: z.string().min(1),
    generatedAt: IsoTimestampSchema,
    ruleSetVersion: z.string().min(1),
    policyVersion: z.number().int().min(1),
    status: z.enum(["passed", "failed"]),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    findings: z.array(QcReportFindingSchema),
  })
  .strict();

const QcReportExportDataSchema = z
  .object({
    canceled: z.boolean(),
    path: z.union([z.string().min(1), z.null()]),
  })
  .strict();

const NotificationTypeSchema = z.enum([
  "qc_failed",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "scheduled",
  "released",
]);
const NotificationSeveritySchema = z.enum(["info", "warning", "error"]);
const NotificationStatusSchema = z.enum(["pending", "sent", "failed"]);
const NotificationChannelSchema = z.enum(["in_app", "email"]);

const NotificationItemSchema = z
  .object({
    notificationId: z.string().min(1),
    type: NotificationTypeSchema,
    severity: NotificationSeveritySchema,
    status: NotificationStatusSchema,
    channel: NotificationChannelSchema,
    title: z.string().min(1),
    message: z.string().min(1),
    submissionId: z.union([z.string().min(1), z.null()]).optional().default(null),
    read: z.boolean(),
    readAt: NullableIsoTimestampSchema,
    attempts: z.number().int().min(0),
    maxAttempts: z.number().int().min(1),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

const NotificationsListRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
    includeRead: z.boolean().optional().default(true),
  })
  .strict();

const NotificationsListDataSchema = z
  .object({
    notifications: z.array(NotificationItemSchema),
  })
  .strict();

const NotificationsMarkReadRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
    notificationIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

const NotificationsMarkAllReadRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
  })
  .strict();

const NotificationsUpdatedCountDataSchema = z
  .object({
    updatedCount: z.number().int().min(0),
  })
  .strict();

const NotificationsRetryRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
    notificationId: z.string().min(1),
  })
  .strict();

const NotificationsRetryDataSchema = z
  .object({
    notification: NotificationItemSchema,
  })
  .strict();

const ReviewSubmissionStateSchema = z.enum([
  "draft",
  "qc_failed",
  "under_review",
  "approved",
  "rejected",
  "scheduled",
  "released",
]);
const RejectReasonCodeSchema = z.enum([
  "QUALITY_ISSUES",
  "METADATA_MISSING",
  "POLICY_VIOLATION",
  "OTHER",
]);

const ReviewFlagSchema = z
  .object({
    id: z.string().min(1),
    submissionId: z.string().min(1),
    flagType: z.string().min(1),
    severity: z.string().min(1),
    addedBy: z.union([z.string().min(1), z.null()]),
    createdAt: IsoTimestampSchema,
  })
  .strict();

const ReviewQueueItemSchema = z
  .object({
    submissionId: z.string().min(1),
    packName: z.string().min(1),
    creatorId: z.string().min(1),
    submittedAt: IsoTimestampSchema,
    state: ReviewSubmissionStateSchema,
    ageDays: z.number().int().min(0),
    tags: z.array(z.string().min(1)),
    flags: z.array(ReviewFlagSchema),
  })
  .strict();

const ReviewQueueListRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    state: z.union([z.string().min(1), z.null()]).optional().default(null),
    tag: z.union([z.string().min(1), z.null()]).optional().default(null),
    flag: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const ReviewQueueListDataSchema = z
  .object({
    items: z.array(ReviewQueueItemSchema),
  })
  .strict();

const ReviewSubmissionGetRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
  })
  .strict();

const ReviewSubmissionGetDataSchema = z
  .object({
    submission: ReviewQueueItemSchema,
    metadata: z.record(z.string(), z.unknown()),
    qcFindings: z.array(z.record(z.string(), z.unknown())),
    transitions: z.array(z.record(z.string(), z.unknown())),
    integrationEvents: z.array(z.record(z.string(), z.unknown())),
    decisions: z.array(z.record(z.string(), z.unknown())),
    tags: z.array(z.record(z.string(), z.unknown())),
    flags: z.array(ReviewFlagSchema),
  })
  .strict();

const ReviewApproveRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    requestId: z.union([z.string().min(1), z.null()]).optional().default(null),
    expectedVersion: z.number().int().min(0).optional(),
    notes: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const ReviewRejectRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    requestId: z.union([z.string().min(1), z.null()]).optional().default(null),
    expectedVersion: z.number().int().min(0).optional(),
    reasonCode: RejectReasonCodeSchema,
    notes: z.string().min(1),
  })
  .strict();

const ReviewDecisionDataSchema = z
  .object({
    decision: z.record(z.string(), z.unknown()),
    transition: z.record(z.string(), z.unknown()),
  })
  .strict();

const ReviewTagAddRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    tag: z.string().min(1),
  })
  .strict();

const ReviewTagAddDataSchema = z
  .object({
    tag: z.record(z.string(), z.unknown()),
  })
  .strict();

const ReviewFlagAddRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    flagType: z.string().min(1),
    severity: z.string().min(1),
  })
  .strict();

const ReviewFlagAddDataSchema = z
  .object({
    flag: z.record(z.string(), z.unknown()),
  })
  .strict();

const ReviewReopenRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    requestId: z.union([z.string().min(1), z.null()]).optional().default(null),
    expectedVersion: z.number().int().min(0).optional(),
    notes: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminActorRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
  })
  .strict();

const AdminConfigRecordSchema = z
  .object({
    id: z.string().min(1),
    configType: z.string().min(1),
    version: z.number().int().min(1),
    payloadJson: z.record(z.string(), z.unknown()),
    publishedBy: z.union([z.string().min(1), z.null()]),
    publishedAt: z.union([IsoTimestampSchema, z.null()]),
    isDraft: z.boolean(),
    createdAt: IsoTimestampSchema,
  })
  .strict();

const AdminConfigsListRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    includeDrafts: z.boolean().optional().default(false),
  })
  .strict();

const AdminConfigsListDataSchema = z
  .object({
    configs: z.array(AdminConfigRecordSchema),
  })
  .strict();

const AdminConfigDraftRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    configType: z.string().min(1),
    payloadJson: z.record(z.string(), z.unknown()),
  })
  .strict();

const AdminConfigMutationDataSchema = z
  .object({
    config: AdminConfigRecordSchema,
  })
  .strict();

const AdminConfigPublishRequestSchema = z
  .object({
    id: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    reason: z.string().min(1),
    confirmation: z.string().min(1),
  })
  .strict();

const AdminConfigRollbackRequestSchema = z
  .object({
    id: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    reason: z.string().min(1),
    confirmation: z.string().min(1),
  })
  .strict();

const AdminConfigRollbackDataSchema = AdminConfigMutationDataSchema;

const IntegrationStatusClassSchema = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
  "unconfigured",
  "unavailable",
]);
const IntegrationRecommendedActionSchema = z.enum([
  "none",
  "run_connection_test",
  "rotate_credentials",
  "verify_provider_configuration",
]);

const AdminIntegrationHealthListRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
  })
  .strict();

const AdminIntegrationTestRequestSchema = z
  .object({
    provider: z.enum(["dropbox", "airtable", "smtp"]),
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    keyRef: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminIntegrationTestDataSchema = z
  .object({
    provider: z.string().min(1),
    ok: z.boolean(),
    latencyMs: z.number().int().min(0),
    statusClass: IntegrationStatusClassSchema,
    recommendedAction: IntegrationRecommendedActionSchema,
    statusCopy: z.string().min(1),
    credentialStatus: z.string().min(1),
    errorCode: z.union([z.string().min(1), z.null()]).optional().default(null),
    lastCheckedAt: IsoTimestampSchema,
    lastRotatedAt: z.union([IsoTimestampSchema, z.null()]),
    lastFailureContext: z.union([z.string().min(1), z.null()]),
    error: z.union([z.string().min(1), z.null()]),
  })
  .strict();

const AdminIntegrationHealthListDataSchema = z
  .object({
    integrations: z.array(AdminIntegrationTestDataSchema),
  })
  .strict();

const AdminIntegrationRotateRequestSchema = z
  .object({
    provider: z.enum(["dropbox", "airtable", "smtp"]),
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    reason: z.string().min(1),
    confirmation: z.string().min(1),
    keyRef: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminIntegrationRotateDataSchema = z
  .object({
    provider: z.string().min(1),
    status: z.string().min(1),
    rotatedAt: IsoTimestampSchema,
    keyRef: z.string().min(1),
  })
  .strict();

const AdminIntegrationConfigureDataSchema = z
  .object({
    provider: z.enum(["dropbox", "airtable", "smtp"]),
    status: z.string().min(1),
    configuredAt: IsoTimestampSchema,
  })
  .strict();

const AdminAirtableConfigureRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    apiKey: z.string().min(1),
    submissionsTable: z.union([z.string().min(1), z.null()]).optional().default(null),
    completionView: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminSmtpConfigureRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.union([z.string().min(1), z.null()]).optional().default(null),
    password: z.union([z.string().min(1), z.null()]).optional().default(null),
    fromEmail: z.union([z.string().min(3), z.null()]).optional().default(null),
  })
  .strict();

const AdminDropboxTokensUpdateRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    refreshToken: z.string().min(1),
    accessToken: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminDropboxAppConfigureRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    appKey: z.string().min(1),
    appSecret: z.string().min(1),
  })
  .strict();

const DropboxReadinessStatusSchema = z.enum(["READY", "NOT_CONFIGURED", "INVALID_TOKEN"]);

const AdminDropboxReadinessRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
  })
  .strict();

const AdminDropboxReadinessDataSchema = z
  .object({
    provider: z.literal("dropbox"),
    status: DropboxReadinessStatusSchema,
    message: z.string().min(1),
    hasAppCredentials: z.boolean().optional().default(false),
    authorizeUrl: z.union([z.string().url(), z.null()]).optional().default(null),
  })
  .strict();

const AdminDropboxOauthStartRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    appKey: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminDropboxOauthStartDataSchema = z
  .object({
    provider: z.literal("dropbox"),
    authorizeUrl: z.string().url(),
  })
  .strict();

const AdminDropboxOauthCompleteRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    authCode: z.string().min(1),
    appKey: z.union([z.string().min(1), z.null()]).optional().default(null),
    appSecret: z.union([z.string().min(1), z.null()]).optional().default(null),
    redirectUri: z.union([z.string().url(), z.null()]).optional().default(null),
  })
  .strict();

const AdminDropboxOauthCompleteDataSchema = z
  .object({
    provider: z.literal("dropbox"),
    status: z.string().min(1),
    accountId: z.union([z.string().min(1), z.null()]).optional().default(null),
    configuredAt: IsoTimestampSchema,
  })
  .strict();

const AdminDropboxOauthDesktopStartRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    appKey: z.union([z.string().min(1), z.null()]).optional().default(null),
    appSecret: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const AdminDropboxOauthDesktopStartDataSchema = z
  .object({
    sessionId: z.string().min(1),
    status: z.literal("pending"),
    authorizeUrl: z.string().url(),
    startedAt: IsoTimestampSchema,
  })
  .strict();

const DropboxOauthDesktopStatusSchema = z.enum(["pending", "completed", "failed", "expired"]);

const AdminDropboxOauthDesktopStatusRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    sessionId: z.string().min(1),
  })
  .strict();

const AdminDropboxOauthDesktopStatusDataSchema = z
  .object({
    sessionId: z.string().min(1),
    status: DropboxOauthDesktopStatusSchema,
    message: z.string().min(1),
    accountId: z.union([z.string().min(1), z.null()]).optional().default(null),
    configuredAt: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
  })
  .strict();

const AdminOpsHistoryListRequestSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

const AdminOpsHistoryListDataSchema = z
  .object({
    entries: z.array(
      z
        .object({
          id: z.string().min(1),
          action: z.string().min(1),
          actorId: z.union([z.string().min(1), z.null()]),
          reason: z.union([z.string().min(1), z.null()]),
          entity: z.string().min(1),
          timestamp: IsoTimestampSchema,
        })
        .strict()
    ),
  })
  .strict();

const AdminQcPolicyGetRequestSchema = AdminActorRequestSchema;

const AdminQcPolicyGetDataSchema = z
  .object({
    policy: QcPolicySnapshotSchema,
  })
  .strict();

const AdminQcPolicyUpdateRequestSchema = z
  .object({
    requestId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.literal("admin"),
    reason: z.string().min(1),
    expectedPolicyVersion: z.number().int().min(1).optional(),
    policy: z
      .object({
        policyId: z.string().min(1),
        ruleSetVersion: z.string().min(1).optional(),
        rules: z.array(QcPolicyRuleBindingSchema).min(1),
      })
      .strict(),
  })
  .strict();

const AdminQcPolicyUpdateDataSchema = z
  .object({
    policy: QcPolicySnapshotSchema,
    auditHook: z
      .object({
        action: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        actorId: z.string().min(1),
        idempotencyKey: z.string().min(1),
        metadata: z.record(z.string(), z.unknown()),
      })
      .strict(),
    observabilityHook: z
      .object({
        metricName: z.string().min(1),
        tags: z.record(z.string(), z.string()),
        value: z.number(),
        emittedAt: IsoTimestampSchema,
      })
      .strict(),
  })
  .strict();

const JobStatusSchema = z.enum([
  "queued",
  "running",
  "retrying",
  "succeeded",
  "failed",
  "dead_lettered",
]);
const JobStatusClassSchema = z.enum([
  "ready",
  "running",
  "pending_retry",
  "completed",
  "terminal_failure",
]);
const FailureClassSchema = z.enum(["transient", "terminal"]);
const RecommendedActionSchema = z.enum([
  "none",
  "wait_for_retry",
  "replay_safe",
  "inspect_and_fix",
]);
const ScheduleSourceSchema = z.enum(["approval_event", "manual_override"]);
const IncidentSeveritySchema = z.enum(["info", "warning", "critical"]);
const IncidentFailureClassSchema = z.enum([
  "integration_failure",
  "retry_exhaustion",
  "scheduling_terminal_failure",
]);
const IncidentRemediationStatusSchema = z.enum(["open", "acknowledged", "resolved"]);

const JobSnapshotSchema = z
  .object({
    id: z.string().min(1),
    jobType: z.string().min(1),
    idempotencyKey: z.string().min(1),
    status: JobStatusSchema,
    attemptCount: z.number().int().min(0),
    maxAttempts: z.number().int().min(1),
    payloadJson: z.record(z.string(), z.unknown()),
    correlationId: z.union([z.string().min(1), z.null()]),
    createdAt: IsoTimestampSchema,
    startedAt: z.union([IsoTimestampSchema, z.null()]),
    endedAt: z.union([IsoTimestampSchema, z.null()]),
    scheduledFor: z.union([IsoTimestampSchema, z.null()]),
    nextRetryAt: z.union([IsoTimestampSchema, z.null()]),
    lastError: z.union([z.string(), z.null()]),
    statusClass: z.union([JobStatusClassSchema, z.null()]).optional().default(null),
    failureClass: z.union([FailureClassSchema, z.null()]).optional().default(null),
    recommendedAction: RecommendedActionSchema.optional().default("none"),
  })
  .strict();

const DeadLetterSnapshotSchema = z
  .object({
    id: z.string().min(1),
    jobRunId: z.string().min(1),
    payloadJson: z.record(z.string(), z.unknown()),
    failureReason: z.string().min(1),
    createdAt: IsoTimestampSchema,
    replayedAt: z.union([IsoTimestampSchema, z.null()]),
    statusClass: z.union([JobStatusClassSchema, z.null()]).optional().default(null),
    failureClass: z.union([FailureClassSchema, z.null()]).optional().default(null),
    recommendedAction: RecommendedActionSchema.optional().default("none"),
  })
  .strict();

const SchedulingEventSchema = z
  .object({
    eventName: z.literal("submission.approved.scheduling.v1"),
    schemaVersion: z.number().int().min(1),
    submissionId: z.string().min(1),
    transitionId: z.string().min(1),
    occurredAt: IsoTimestampSchema,
    approvedBy: z.string().min(1),
    preferredReleaseMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const ScheduleSnapshotSchema = z
  .object({
    submissionId: z.string().min(1),
    preferredMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    plannedReleaseAt: IsoTimestampSchema,
    timezone: z.string().min(1),
    source: ScheduleSourceSchema,
    updatedBy: z.string().min(1),
    updatedAt: IsoTimestampSchema,
    releaseTriggeredAt: z.union([IsoTimestampSchema, z.null()]),
    version: z.number().int().min(1),
  })
  .strict();

const JobsEnqueueRequestSchema = z
  .object({
    requestId: z.string().min(1),
    jobType: z.string().min(1),
    idempotencyKey: z.string().min(1),
    payloadJson: z.record(z.string(), z.unknown()),
    maxAttempts: z.number().int().min(1).max(10).optional().default(3),
    scheduledFor: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
    correlationId: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const JobsEnqueueDataSchema = z
  .object({
    idempotent: z.boolean(),
    job: JobSnapshotSchema,
  })
  .strict();

const JobsGetRequestSchema = z.object({ id: z.string().min(1) }).strict();
const JobsGetDataSchema = z
  .object({
    job: JobSnapshotSchema,
    deadLetter: z.union([DeadLetterSnapshotSchema, z.null()]),
  })
  .strict();

const JobsReplayRequestSchema = z
  .object({
    id: z.string().min(1),
    requestId: z.string().min(1),
    actorId: z.string().min(1),
    reason: z.string().min(1),
    confirmation: z.string().min(1),
  })
  .strict();

const JobsReplayDataSchema = z
  .object({
    idempotent: z.boolean(),
    job: JobSnapshotSchema,
    deadLetter: DeadLetterSnapshotSchema,
  })
  .strict();

const SchedulingResolveRequestSchema = z
  .object({
    requestId: z.string().min(1),
    submissionId: z.string().min(1),
    schedulingEvent: SchedulingEventSchema,
    timezone: z.string().min(1).optional().default("UTC"),
  })
  .strict();

const SchedulingResolveDataSchema = z
  .object({
    idempotent: z.boolean(),
    schedule: ScheduleSnapshotSchema,
    releaseJob: JobSnapshotSchema,
  })
  .strict();

const SchedulingOverrideRequestSchema = z
  .object({
    requestId: z.string().min(1),
    submissionId: z.string().min(1),
    newReleaseAt: IsoTimestampSchema,
    reason: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["reviewer", "admin"]),
    timezone: z.string().min(1).optional().default("UTC"),
  })
  .strict();

const SchedulingOverrideDataSchema = z
  .object({
    idempotent: z.boolean(),
    schedule: ScheduleSnapshotSchema,
    override: z
      .object({
        id: z.string().min(1),
        submissionId: z.string().min(1),
        oldReleaseAt: IsoTimestampSchema,
        newReleaseAt: IsoTimestampSchema,
        reason: z.string().min(1),
        actorId: z.string().min(1),
        createdAt: IsoTimestampSchema,
      })
      .strict(),
    releaseJob: JobSnapshotSchema,
  })
  .strict();

const SchedulingTriggerReleaseRequestSchema = z
  .object({
    requestId: z.string().min(1),
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: z.enum(["system", "admin"]),
    force: z.boolean().optional().default(false),
    jobRunId: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const SchedulingTriggerReleaseDataSchema = z
  .object({
    idempotent: z.boolean(),
    schedule: ScheduleSnapshotSchema,
    submission: z.record(z.string(), z.unknown()),
  })
  .strict();

const ObservabilityMetricsGetRequestSchema = z.object({}).strict();
const ObservabilityMetricsGetDataSchema = z
  .object({
    snapshot: z.string(),
    capturedAt: IsoTimestampSchema,
  })
  .strict();

const ObservabilityIncidentsAnnotateRequestSchema = z
  .object({
    source: z.string().min(1),
    severity: IncidentSeveritySchema,
    note: z.string().min(1),
    linkedEntity: z.string().min(1),
    failureClass: z.union([IncidentFailureClassSchema, z.null()]).optional().default(null),
    correlationId: z.union([z.string().min(1), z.null()]).optional().default(null),
    remediationStatus: IncidentRemediationStatusSchema.optional().default("open"),
    remediationOwner: z.union([z.string().min(1), z.null()]).optional().default(null),
    remediationLink: z.union([z.string().min(1), z.null()]).optional().default(null),
    auditEventId: z.union([z.string().min(1), z.null()]).optional().default(null),
    requestId: z.union([z.string().min(1), z.null()]).optional().default(null),
    idempotencyKey: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const ObservabilityIncidentsAnnotateDataSchema = z
  .object({
    idempotent: z.boolean(),
    annotation: z
      .object({
        id: z.string().min(1),
        source: z.string().min(1),
        severity: IncidentSeveritySchema,
        note: z.string().min(1),
        linkedEntity: z.string().min(1),
        failureClass: z.union([IncidentFailureClassSchema, z.null()]),
        correlationId: z.union([z.string().min(1), z.null()]),
        remediationStatus: IncidentRemediationStatusSchema,
        remediationOwner: z.union([z.string().min(1), z.null()]),
        remediationLink: z.union([z.string().min(1), z.null()]),
        auditEventId: z.union([z.string().min(1), z.null()]),
        createdAt: IsoTimestampSchema,
      })
      .strict(),
  })
  .strict();

const CreatorProfileRequestSchema = z
  .object({
    actorId: z.string().min(1),
    userId: z.string().min(1).optional().default("me"),
  })
  .strict();

const CreatorProfilePutRequestSchema = z
  .object({
    actorId: z.string().min(1),
    userId: z.string().min(1).optional().default("me"),
    displayName: z.union([z.string().min(1), z.null()]).optional().default(null),
    labelName: z.union([z.string().min(1), z.null()]).optional().default(null),
    defaultsJson: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

const CreatorProfileDataSchema = z
  .object({
    userId: z.string().min(1),
    displayName: z.union([z.string(), z.null()]),
    labelName: z.union([z.string(), z.null()]),
    defaultsJson: z.record(z.string(), z.unknown()),
    updatedAt: z.union([IsoTimestampSchema, z.null()]),
  })
  .strict();

const SubmissionMutationRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    creatorId: z.string().min(1),
    packName: z.union([z.string(), z.null()]).optional().default(null),
    labelName: z.union([z.string(), z.null()]).optional().default(null),
    releaseMonth: z.union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.null()])
      .optional()
      .default(null),
    notes: z.union([z.string(), z.null()]).optional().default(null),
    tags: z.array(z.string()).optional().default([]),
    airtableFormCompleted: z.boolean().optional().default(false),
    airtablePayloadChecksum: z.union([z.string(), z.null()]).optional().default(null),
    autosaveJson: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

const SubmissionListRequestSchema = z
  .object({
    creatorId: z.string().min(1),
    actorId: z.string().min(1).optional(),
  })
  .strict();

const SubmissionTimelineRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    creatorId: z.string().min(1),
    actorId: z.string().min(1).optional(),
  })
  .strict();

const SubmissionAirtableMutationRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    creatorId: z.string().min(1),
    forceRelink: z.boolean().optional().default(false),
  })
  .strict();

const SubmissionSummarySchema = z
  .object({
    submissionId: z.string().min(1),
    creatorId: z.string().min(1),
    currentState: z.string().min(1),
    version: z.number().int().min(0),
    packName: z.union([z.string(), z.null()]),
    labelName: z.union([z.string(), z.null()]),
    releaseMonth: z.union([z.string(), z.null()]),
    notes: z.union([z.string(), z.null()]),
    tags: z.array(z.string()),
    airtableFormCompleted: z.boolean(),
    airtablePayloadChecksum: z.union([z.string(), z.null()]),
    airtableSyncStatus: z.union([z.string(), z.null()]).optional().default(null),
    airtableRecordId: z.union([z.string(), z.null()]).optional().default(null),
    airtableRecordUrl: z.union([z.string(), z.null()]).optional().default(null),
    airtableLastSyncedAt: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
    airtableLastErrorCode: z.union([z.string(), z.null()]).optional().default(null),
    airtableLastErrorDetail: z.union([z.string(), z.null()]).optional().default(null),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    draftLastSavedAt: z.union([IsoTimestampSchema, z.null()]),
    uploadIntakeSessionId: z.union([z.string().min(1), z.null()]).optional().default(null),
    uploadHandoffId: z.union([z.string().min(1), z.null()]).optional().default(null),
    uploadManifestVersion: z.union([z.number().int().min(0), z.null()]).optional().default(null),
    uploadStatus: z.union([z.string().min(1), z.null()]).optional().default(null),
    uploadProgressPercent: z.number().int().min(0).max(100).optional().default(0),
    uploadUploadedBytes: z.number().int().min(0).optional().default(0),
    uploadTotalBytes: z.number().int().min(0).optional().default(0),
    uploadUploadedFiles: z.number().int().min(0).optional().default(0),
    uploadTotalFiles: z.number().int().min(0).optional().default(0),
    uploadError: z.union([z.string().min(1), z.null()]).optional().default(null),
    uploadUpdatedAt: z.union([IsoTimestampSchema, z.null()]).optional().default(null),
  })
  .strict();

const SubmissionAirtableMappedPayloadSchema = z
  .object({
    labelName: z.union([z.string(), z.null()]),
    packName: z.union([z.string(), z.null()]),
    releaseMonth: z.union([z.string(), z.null()]),
    notes: z.union([z.string(), z.null()]),
    tags: z.array(z.string()),
  })
  .strict();

const SubmissionAirtableStateDataSchema = z
  .object({
    submissionId: z.string().min(1),
    syncStatus: z.string().min(1),
    airtableFormCompleted: z.boolean(),
    airtablePayloadChecksum: z.union([z.string(), z.null()]),
    airtableRecordId: z.union([z.string(), z.null()]),
    airtableRecordUrl: z.union([z.string(), z.null()]),
    lastSyncedAt: z.union([IsoTimestampSchema, z.null()]),
    lastErrorCode: z.union([z.string(), z.null()]),
    lastErrorDetail: z.union([z.string(), z.null()]),
    canonicalRecordId: z.union([z.string(), z.null()]).optional().default(null),
    mappedPayload: z
      .union([SubmissionAirtableMappedPayloadSchema, z.null()])
      .optional()
      .default(null),
  })
  .strict();

const SubmissionDraftDataSchema = z
  .object({
    submission: z.record(z.string(), z.unknown()),
  })
  .strict();

const SubmissionListDataSchema = z
  .object({
    submissions: z.array(SubmissionSummarySchema),
  })
  .strict();

const SubmissionTimelineDataSchema = z
  .object({
    timeline: z.array(
      z
        .object({
          transitionId: z.string().min(1),
          fromState: z.union([z.string(), z.null()]),
          toState: z.string().min(1),
          actorId: z.union([z.string(), z.null()]),
          actorRole: z.union([z.string(), z.null()]),
          reason: z.union([z.string(), z.null()]),
          requestId: z.union([z.string(), z.null()]),
          createdAt: IsoTimestampSchema,
        })
        .strict()
    ),
  })
  .strict();

const IntakeFolderSelectRequestSchema = z.object({}).strict();
const IntakeFolderSelectDataSchema = z
  .object({
    path: z.string().min(1),
    fileCount: z.number().int().min(0),
    topLevelFolders: z.array(z.string().min(1)),
    files: z.array(
      z
        .object({
          relativePath: z.string().min(1),
          sizeBytes: z.number().int().min(1),
          mimeType: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();

const IntakeSessionStartRequestSchema = z
  .object({
    requestId: z.string().min(1),
    submissionId: z.string().min(1),
    creatorId: z.string().min(1),
    packName: z.string().min(1),
    declaredTopLevelFolders: z.array(z.string().min(1)).optional().default([]),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

const IntakeManifestPutRequestSchema = z
  .object({
    intakeSessionId: z.string().min(1),
    requestId: z.string().min(1),
    expectedManifestVersion: z.number().int().min(0).optional(),
    lockManifest: z.boolean().optional().default(false),
    files: z
      .array(
        z
          .object({
            relativePath: z.string().min(1),
            sizeBytes: z.number().int().min(1),
            sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
            mimeType: z.string().min(1),
            category: z.string().min(1).optional().default("other"),
            requiredAsset: z.boolean().optional().default(false),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const IntakeHandoffCreateRequestSchema = z
  .object({
    intakeSessionId: z.string().min(1),
    requestId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
  })
  .strict();

const StorageHandoffStatusRequestSchema = z
  .object({
    handoffId: z.string().min(1),
  })
  .strict();

const StorageHandoffControlRequestSchema = z
  .object({
    handoffId: z.string().min(1),
    action: z.enum(["pause", "resume", "cancel"]),
    requestId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
  })
  .strict();

const IntakeLockRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
    intakeSessionId: z.union([z.string().min(1), z.null()]).optional().default(null),
  })
  .strict();

const IntakeSessionDataSchema = z
  .object({
    intakeSessionId: z.string().min(1),
    submissionId: z.string().min(1),
    creatorId: z.string().min(1),
    packName: z.string().min(1),
    declaredTopLevelFolders: z.array(z.string()),
    status: z.string().min(1),
    manifestVersion: z.number().int().min(0),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

const IntakeManifestDataSchema = z
  .object({
    manifestVersion: z.number().int().min(0),
    locked: z.boolean(),
    files: z.array(
      z
        .object({
          relativePath: z.string().min(1),
          sizeBytes: z.number().int().min(1),
          sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
          mimeType: z.string().min(1),
          category: z.string().min(1),
          requiredAsset: z.boolean(),
        })
        .strict()
    ),
    summary: z
      .object({
        totalFileCount: z.number().int().min(0),
        totalBytes: z.number().int().min(0),
        countsByCategory: z.record(z.string(), z.number().int().min(0)),
        requiredAudioZipPresent: z.boolean(),
      })
      .strict(),
    updatedAt: IsoTimestampSchema,
  })
  .strict();

const IntakeSessionStartDataSchema = z
  .object({
    created: z.boolean(),
    idempotent: z.boolean(),
    session: IntakeSessionDataSchema,
    event: z.union([z.record(z.string(), z.unknown()), z.null()]),
  })
  .strict();

const IntakeManifestPutDataSchema = z
  .object({
    idempotent: z.boolean(),
    session: IntakeSessionDataSchema,
    manifest: IntakeManifestDataSchema,
    event: z.record(z.string(), z.unknown()),
  })
  .strict();

const IntakeHandoffCreateDataSchema = z
  .object({
    idempotent: z.boolean(),
    handoff: z
      .object({
        handoffId: z.string().min(1),
        submissionId: z.string().min(1),
        intakeSessionId: z.string().min(1),
        status: z.enum(["queued", "in_progress", "paused", "completed", "failed", "canceled"]),
        target: z.string().min(1),
        progressPercent: z.number().int().min(0).max(100),
        uploadedBytes: z.number().int().min(0),
        totalBytes: z.number().int().min(0),
        objectCount: z.number().int().min(0),
        uploadedFiles: z.number().int().min(0),
        totalFiles: z.number().int().min(0),
        checksumVerified: z.boolean(),
        createdAt: IsoTimestampSchema,
        updatedAt: IsoTimestampSchema,
        completedAt: z.union([IsoTimestampSchema, z.null()]),
        error: z.union([z.string().min(1), z.null()]),
      })
      .strict(),
    event: z.record(z.string(), z.unknown()),
  })
  .strict();

const StorageHandoffStatusDataSchema = z
  .object({
    handoff: z
      .object({
        handoffId: z.string().min(1),
        submissionId: z.string().min(1),
        intakeSessionId: z.string().min(1),
        status: z.enum(["queued", "in_progress", "paused", "completed", "failed", "canceled"]),
        target: z.string().min(1),
        progressPercent: z.number().int().min(0).max(100),
        uploadedBytes: z.number().int().min(0),
        totalBytes: z.number().int().min(0),
        objectCount: z.number().int().min(0),
        uploadedFiles: z.number().int().min(0),
        totalFiles: z.number().int().min(0),
        checksumVerified: z.boolean(),
        createdAt: IsoTimestampSchema,
        updatedAt: IsoTimestampSchema,
        completedAt: z.union([IsoTimestampSchema, z.null()]),
        error: z.union([z.string().min(1), z.null()]),
      })
      .strict(),
  })
  .strict();

const StorageHandoffControlDataSchema = z
  .object({
    handoff: z
      .object({
        handoffId: z.string().min(1),
        submissionId: z.string().min(1),
        intakeSessionId: z.string().min(1),
        status: z.enum(["queued", "in_progress", "paused", "completed", "failed", "canceled"]),
        target: z.string().min(1),
        progressPercent: z.number().int().min(0).max(100),
        uploadedBytes: z.number().int().min(0),
        totalBytes: z.number().int().min(0),
        objectCount: z.number().int().min(0),
        uploadedFiles: z.number().int().min(0),
        totalFiles: z.number().int().min(0),
        checksumVerified: z.boolean(),
        createdAt: IsoTimestampSchema,
        updatedAt: IsoTimestampSchema,
        completedAt: z.union([IsoTimestampSchema, z.null()]),
        error: z.union([z.string().min(1), z.null()]),
      })
      .strict(),
  })
  .strict();

const IntakeLockDataSchema = z
  .object({
    submissionId: z.string().min(1),
    intakeSessionId: z.string().min(1),
    lockedCount: z.number().int().min(0),
    lockedAt: IsoTimestampSchema,
  })
  .strict();

const SubmissionTransitionRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    requestId: z.string().min(1),
    toState: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: ActorRoleSchema,
    reason: z.union([z.string().min(1), z.null()]).optional().default(null),
    expectedVersion: z.number().int().min(0).optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

const SubmissionTransitionDataSchema = z
  .object({
    submission: z.record(z.string(), z.unknown()),
    transition: z.union([z.record(z.string(), z.unknown()), z.null()]),
    domainEvent: z.union([z.record(z.string(), z.unknown()), z.null()]),
    idempotent: z.boolean(),
    orchestration: z.union([z.record(z.string(), z.unknown()), z.null()]),
  })
  .strict();

function buildContract({ ownerModule, allowedRoles, requiredPermissions, requestSchema, dataSchema }) {
  return Object.freeze({
    schemaVersion: "v1",
    ownerModule,
    allowedRoles,
    requiredPermissions,
    requestSchema,
    responseSchema: z.union([createIpcSuccessResponseSchema(dataSchema), IpcErrorResponseSchema]),
  });
}

const IPC_CONTRACT_REGISTRY = Object.freeze({
  [IPC_CHANNELS.AUTH_GET_SESSION]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthGetSessionRequestSchema,
    dataSchema: AuthSessionDataSchema,
  }),
  [IPC_CHANNELS.AUTH_LOGIN]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthLoginRequestSchema,
    dataSchema: AuthTokenBundleSchema,
  }),
  [IPC_CHANNELS.AUTH_REGISTER]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthRegisterRequestSchema,
    dataSchema: AuthTokenBundleSchema,
  }),
  [IPC_CHANNELS.AUTH_OTP_SEND]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthOtpSendRequestSchema,
    dataSchema: AuthOtpSendDataSchema,
  }),
  [IPC_CHANNELS.AUTH_OTP_VERIFY]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthOtpVerifyRequestSchema,
    dataSchema: AuthOtpVerifyDataSchema,
  }),
  [IPC_CHANNELS.AUTH_FORGOT_PASSWORD]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthForgotPasswordRequestSchema,
    dataSchema: AuthOtpSendDataSchema,
  }),
  [IPC_CHANNELS.AUTH_RESET_PASSWORD]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AuthResetPasswordRequestSchema,
    dataSchema: AuthRevocationDataSchema,
  }),
  [IPC_CHANNELS.DESKTOP_VERIFY_SECURITY]: buildContract({
    ownerModule: "PRD-16",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: VerifySecurityConfigRequestSchema,
    dataSchema: VerifySecurityConfigDataSchema,
  }),
  [IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS]: buildContract({
    ownerModule: "PRD-11",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze(["audit:read"]),
    requestSchema: AuditListSecurityEventsRequestSchema,
    dataSchema: AuditListSecurityEventsDataSchema,
  }),
  [IPC_CHANNELS.AUDIT_EVENTS_LIST]: buildContract({
    ownerModule: "PRD-11",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze(["audit:read"]),
    requestSchema: AuditEventsListRequestSchema,
    dataSchema: AuditEventsListDataSchema,
  }),
  [IPC_CHANNELS.AUDIT_EVENTS_EXPORT]: buildContract({
    ownerModule: "PRD-11",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze(["audit:read"]),
    requestSchema: AuditEventsExportRequestSchema,
    dataSchema: AuditEventsExportDataSchema,
  }),
  [IPC_CHANNELS.QC_EVALUATE_PACK]: buildContract({
    ownerModule: "PRD-04",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: QcEvaluatePackRequestSchema,
    dataSchema: QcEvaluationDataSchema,
  }),
  [IPC_CHANNELS.QC_LIST_RULES]: buildContract({
    ownerModule: "PRD-05",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: QcListRulesRequestSchema,
    dataSchema: QcListRulesDataSchema,
  }),
  [IPC_CHANNELS.QC_RESULTS_GET]: buildContract({
    ownerModule: "PRD-06",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: QcResultsGetRequestSchema,
    dataSchema: QcResultsGetDataSchema,
  }),
  [IPC_CHANNELS.QC_REPORT_EXPORT]: buildContract({
    ownerModule: "PRD-06",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: QcReportExportRequestSchema,
    dataSchema: QcReportExportDataSchema,
  }),
  [IPC_CHANNELS.NOTIFICATIONS_LIST]: buildContract({
    ownerModule: "PRD-10",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: NotificationsListRequestSchema,
    dataSchema: NotificationsListDataSchema,
  }),
  [IPC_CHANNELS.NOTIFICATIONS_MARK_READ]: buildContract({
    ownerModule: "PRD-10",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: NotificationsMarkReadRequestSchema,
    dataSchema: NotificationsUpdatedCountDataSchema,
  }),
  [IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ]: buildContract({
    ownerModule: "PRD-10",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: NotificationsMarkAllReadRequestSchema,
    dataSchema: NotificationsUpdatedCountDataSchema,
  }),
  [IPC_CHANNELS.NOTIFICATIONS_RETRY]: buildContract({
    ownerModule: "PRD-10",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: NotificationsRetryRequestSchema,
    dataSchema: NotificationsRetryDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_QUEUE_LIST]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewQueueListRequestSchema,
    dataSchema: ReviewQueueListDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_SUBMISSION_GET]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewSubmissionGetRequestSchema,
    dataSchema: ReviewSubmissionGetDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_APPROVE]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewApproveRequestSchema,
    dataSchema: ReviewDecisionDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_REJECT]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewRejectRequestSchema,
    dataSchema: ReviewDecisionDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_TAG_ADD]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewTagAddRequestSchema,
    dataSchema: ReviewTagAddDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_FLAG_ADD]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewFlagAddRequestSchema,
    dataSchema: ReviewFlagAddDataSchema,
  }),
  [IPC_CHANNELS.REVIEW_REOPEN]: buildContract({
    ownerModule: "PRD-08",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ReviewReopenRequestSchema,
    dataSchema: ReviewDecisionDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_CONFIGS_LIST]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminConfigsListRequestSchema,
    dataSchema: AdminConfigsListDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_CONFIGS_DRAFT]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminConfigDraftRequestSchema,
    dataSchema: AdminConfigMutationDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminConfigPublishRequestSchema,
    dataSchema: AdminConfigMutationDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminConfigRollbackRequestSchema,
    dataSchema: AdminConfigRollbackDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminIntegrationHealthListRequestSchema,
    dataSchema: AdminIntegrationHealthListDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminIntegrationTestRequestSchema,
    dataSchema: AdminIntegrationTestDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminIntegrationRotateRequestSchema,
    dataSchema: AdminIntegrationRotateDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminAirtableConfigureRequestSchema,
    dataSchema: AdminIntegrationConfigureDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_SMTP_CONFIGURE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminSmtpConfigureRequestSchema,
    dataSchema: AdminIntegrationConfigureDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxTokensUpdateRequestSchema,
    dataSchema: AdminIntegrationConfigureDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxAppConfigureRequestSchema,
    dataSchema: AdminIntegrationConfigureDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxReadinessRequestSchema,
    dataSchema: AdminDropboxReadinessDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxOauthStartRequestSchema,
    dataSchema: AdminDropboxOauthStartDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxOauthCompleteRequestSchema,
    dataSchema: AdminDropboxOauthCompleteDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxOauthDesktopStartRequestSchema,
    dataSchema: AdminDropboxOauthDesktopStartDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminDropboxOauthDesktopStatusRequestSchema,
    dataSchema: AdminDropboxOauthDesktopStatusDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_OPS_HISTORY_LIST]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminOpsHistoryListRequestSchema,
    dataSchema: AdminOpsHistoryListDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_QC_POLICY_GET]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: AdminQcPolicyGetRequestSchema,
    dataSchema: AdminQcPolicyGetDataSchema,
  }),
  [IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE]: buildContract({
    ownerModule: "PRD-14",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze(["qc:policy:write"]),
    requestSchema: AdminQcPolicyUpdateRequestSchema,
    dataSchema: AdminQcPolicyUpdateDataSchema,
  }),
  [IPC_CHANNELS.JOBS_ENQUEUE]: buildContract({
    ownerModule: "PRD-13",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: JobsEnqueueRequestSchema,
    dataSchema: JobsEnqueueDataSchema,
  }),
  [IPC_CHANNELS.JOBS_GET]: buildContract({
    ownerModule: "PRD-13",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: JobsGetRequestSchema,
    dataSchema: JobsGetDataSchema,
  }),
  [IPC_CHANNELS.JOBS_REPLAY]: buildContract({
    ownerModule: "PRD-13",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: JobsReplayRequestSchema,
    dataSchema: JobsReplayDataSchema,
  }),
  [IPC_CHANNELS.SCHEDULING_RESOLVE]: buildContract({
    ownerModule: "PRD-17",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SchedulingResolveRequestSchema,
    dataSchema: SchedulingResolveDataSchema,
  }),
  [IPC_CHANNELS.SCHEDULING_OVERRIDE]: buildContract({
    ownerModule: "PRD-17",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SchedulingOverrideRequestSchema,
    dataSchema: SchedulingOverrideDataSchema,
  }),
  [IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE]: buildContract({
    ownerModule: "PRD-17",
    allowedRoles: Object.freeze(["admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SchedulingTriggerReleaseRequestSchema,
    dataSchema: SchedulingTriggerReleaseDataSchema,
  }),
  [IPC_CHANNELS.OBSERVABILITY_METRICS_GET]: buildContract({
    ownerModule: "PRD-15",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ObservabilityMetricsGetRequestSchema,
    dataSchema: ObservabilityMetricsGetDataSchema,
  }),
  [IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE]: buildContract({
    ownerModule: "PRD-15",
    allowedRoles: Object.freeze(["reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: ObservabilityIncidentsAnnotateRequestSchema,
    dataSchema: ObservabilityIncidentsAnnotateDataSchema,
  }),
  [IPC_CHANNELS.CREATOR_PROFILE_GET]: buildContract({
    ownerModule: "PRD-02",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: CreatorProfileRequestSchema,
    dataSchema: CreatorProfileDataSchema,
  }),
  [IPC_CHANNELS.CREATOR_PROFILE_PUT]: buildContract({
    ownerModule: "PRD-02",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: CreatorProfilePutRequestSchema,
    dataSchema: CreatorProfileDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_DRAFT]: buildContract({
    ownerModule: "PRD-02",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionMutationRequestSchema,
    dataSchema: SubmissionDraftDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_METADATA]: buildContract({
    ownerModule: "PRD-02",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionMutationRequestSchema,
    dataSchema: SubmissionDraftDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_LIST]: buildContract({
    ownerModule: "PRD-02",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionListRequestSchema,
    dataSchema: SubmissionListDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_TIMELINE]: buildContract({
    ownerModule: "PRD-02",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionTimelineRequestSchema,
    dataSchema: SubmissionTimelineDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC]: buildContract({
    ownerModule: "PRD-16",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionAirtableMutationRequestSchema,
    dataSchema: SubmissionAirtableStateDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_AIRTABLE_RESET]: buildContract({
    ownerModule: "PRD-16",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionAirtableMutationRequestSchema.omit({ forceRelink: true }),
    dataSchema: SubmissionAirtableStateDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_FOLDER_SELECT]: buildContract({
    ownerModule: "PRD-03",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: IntakeFolderSelectRequestSchema,
    dataSchema: IntakeFolderSelectDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_SESSION_START]: buildContract({
    ownerModule: "PRD-03",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: IntakeSessionStartRequestSchema,
    dataSchema: IntakeSessionStartDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_MANIFEST_PUT]: buildContract({
    ownerModule: "PRD-03",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: IntakeManifestPutRequestSchema,
    dataSchema: IntakeManifestPutDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_HANDOFF_CREATE]: buildContract({
    ownerModule: "PRD-12",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: IntakeHandoffCreateRequestSchema,
    dataSchema: IntakeHandoffCreateDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET]: buildContract({
    ownerModule: "PRD-12",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: StorageHandoffStatusRequestSchema,
    dataSchema: StorageHandoffStatusDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_HANDOFF_CONTROL]: buildContract({
    ownerModule: "PRD-12",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: StorageHandoffControlRequestSchema,
    dataSchema: StorageHandoffControlDataSchema,
  }),
  [IPC_CHANNELS.INTAKE_LOCK]: buildContract({
    ownerModule: "PRD-03",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: IntakeLockRequestSchema,
    dataSchema: IntakeLockDataSchema,
  }),
  [IPC_CHANNELS.SUBMISSION_TRANSITION]: buildContract({
    ownerModule: "PRD-07",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: SubmissionTransitionRequestSchema,
    dataSchema: SubmissionTransitionDataSchema,
  }),
  [IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_TOGGLE]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: z.object({ enabled: z.boolean() }),
    dataSchema: z.object({ success: z.boolean(), enabled: z.boolean() }),
  }),
  [IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_STATUS]: buildContract({
    ownerModule: "PRD-01",
    allowedRoles: Object.freeze(["creator", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: z.object({}),
    dataSchema: z.object({ enabled: z.boolean() }),
  }),

  // --- AI: Audio Streaming (PRD-AI-01) ---
  [IPC_CHANNELS.AI_AUDIO_START]: buildContract({
    ownerModule: "PRD-AI-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: z
      .object({
        source: z.enum(["mic", "system", "both"]).optional().default("mic"),
        sampleRate: z.number().int().min(8000).max(48000).optional().default(16000),
        chunkMs: z.number().int().min(50).max(500).optional().default(100),
        encoding: z.enum(["pcm_float32", "webm_opus"]).optional().default("pcm_float32"),
        sessionId: z.string().optional().default(""),
      })
      .strict(),
    dataSchema: z.object({
      status: z.enum(["connecting", "connected", "error"]),
      wsUrl: z.string().optional(),
      sessionId: z.string().optional(),
      message: z.string().optional(),
    }),
  }),
  [IPC_CHANNELS.AI_AUDIO_STOP]: buildContract({
    ownerModule: "PRD-AI-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: z.object({ sessionId: z.string().optional() }).strict(),
    dataSchema: z.object({
      stopped: z.boolean(),
      chunksReceived: z.number().int().optional(),
    }),
  }),
  [IPC_CHANNELS.AI_AUDIO_STATUS]: buildContract({
    ownerModule: "PRD-AI-01",
    allowedRoles: Object.freeze(["creator", "reviewer", "admin"]),
    requiredPermissions: Object.freeze([]),
    requestSchema: z.object({}).strict(),
    dataSchema: z.object({
      state: z.enum(["disconnected", "connecting", "connected", "error"]),
      sessionId: z.string().nullable(),
      chunksReceived: z.number().int(),
    }),
  }),
});

function formatZodIssues(issues) {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function assertValidChannelName(channel) {
  if (!CHANNEL_NAME_PATTERN.test(channel)) {
    throw new Error(`Invalid IPC channel name: ${channel}`);
  }
}

function getContract(channel) {
  return IPC_CONTRACT_REGISTRY[channel] || null;
}

function buildIpcErrorResponse(channel, code, reason, message) {
  return {
    ok: false,
    error: {
      code,
      message,
      reason,
      channel,
    },
  };
}

function buildIpcSuccessResponse(data) {
  return {
    ok: true,
    data,
  };
}

Object.keys(IPC_CONTRACT_REGISTRY).forEach(assertValidChannelName);

module.exports = {
  AUTH_ERROR_CODES,
  ActorRoleSchema,
  IPC_CHANNELS,
  IPC_CONTRACT_REGISTRY,
  IpcErrorResponseSchema,
  assertValidChannelName,
  buildIpcErrorResponse,
  buildIpcSuccessResponse,
  formatZodIssues,
  getContract,
};
