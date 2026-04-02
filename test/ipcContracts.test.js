const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IPC_CHANNELS,
  IPC_CONTRACT_REGISTRY,
  buildIpcErrorResponse,
} = require("../electron/ipc/contracts");

test("all registered IPC channels are namespaced and versioned", () => {
  for (const channel of Object.keys(IPC_CONTRACT_REGISTRY)) {
    assert.match(channel, /^fileeaters\.[a-z0-9.-]+\.v1$/);
  }
});

test("auth getSession request schema rejects invalid payloads", () => {
  const contract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.AUTH_GET_SESSION];

  assert.equal(contract.requestSchema.safeParse({ includePermissions: true }).success, true);
  assert.equal(contract.requestSchema.safeParse({ includePermissions: "yes" }).success, false);
});

test("auth register and otp contracts enforce required request fields", () => {
  const registerContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.AUTH_REGISTER];
  assert.equal(
    registerContract.requestSchema.safeParse({
      email: "creator@example.com",
      password: "StrongPassword!123",
      otpVerificationToken: "token",
      roles: ["creator"],
    }).success,
    true
  );
  assert.equal(
    registerContract.requestSchema.safeParse({
      email: "creator@example.com",
      password: "short",
      otpVerificationToken: "token",
    }).success,
    false
  );

  const otpVerifyContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.AUTH_OTP_VERIFY];
  assert.equal(
    otpVerifyContract.requestSchema.safeParse({
      challengeId: "otp_123",
      purpose: "register",
      otpCode: "123456",
    }).success,
    true
  );
  assert.equal(
    otpVerifyContract.requestSchema.safeParse({
      challengeId: "",
      purpose: "register",
      otpCode: "22",
    }).success,
    false
  );
});

test("intake handoff status and submission list contracts carry upload progress fields", () => {
  const statusContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET];
  assert.equal(
    statusContract.requestSchema.safeParse({
      handoffId: "handoff:intake:sub-1:1",
    }).success,
    true
  );
  assert.equal(statusContract.requestSchema.safeParse({ handoffId: "" }).success, false);

  const listContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.SUBMISSION_LIST];
  assert.equal(
    listContract.responseSchema.safeParse({
      ok: true,
      data: {
        submissions: [
          {
            submissionId: "sub-1",
            creatorId: "creator-1",
            currentState: "uploading",
            version: 2,
            packName: "Pack",
            labelName: "Label",
            releaseMonth: "2026-03",
            notes: null,
            tags: [],
            airtableFormCompleted: true,
            airtablePayloadChecksum: "checksum",
            airtableSyncStatus: null,
            airtableRecordId: null,
            airtableRecordUrl: null,
            airtableLastSyncedAt: null,
            airtableLastErrorCode: null,
            airtableLastErrorDetail: null,
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
            draftLastSavedAt: null,
            uploadIntakeSessionId: "intake:sub-1",
            uploadHandoffId: "handoff:intake:sub-1:1",
            uploadManifestVersion: 1,
            uploadStatus: "in_progress",
            uploadProgressPercent: 42,
            uploadUploadedBytes: 4200,
            uploadTotalBytes: 10000,
            uploadUploadedFiles: 2,
            uploadTotalFiles: 10,
            uploadError: null,
            uploadUpdatedAt: "2026-03-01T00:05:00.000Z",
          },
        ],
      },
    }).success,
    true
  );
});

test("error envelope is valid for every channel response schema", () => {
  for (const channel of Object.keys(IPC_CONTRACT_REGISTRY)) {
    const contract = IPC_CONTRACT_REGISTRY[channel];
    const errorResponse = buildIpcErrorResponse(
      channel,
      "AUTH_UNAUTHORIZED",
      "AUTH_SERVICE_ERROR:401",
      "Invalid credentials"
    );

    assert.equal(contract.responseSchema.safeParse(errorResponse).success, true);
  }
});

test("audit contract includes explicit permission requirements", () => {
  const contract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS];
  assert.deepEqual(contract.requiredPermissions, ["audit:read"]);
});

test("qc contracts enforce evaluate and admin update payload schemas", () => {
  const evaluateContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.QC_EVALUATE_PACK];
  assert.equal(
    evaluateContract.requestSchema.safeParse({
      requestId: "qc-req-1",
      submissionId: "sub-1",
      actorId: "creator-1",
      actorRole: "creator",
      pack: {
        packName: "Label - Pack",
        declaredTopLevelFolders: ["Artwork", "Audio", "Description"],
        audioZip: {
          filename: "Label - Pack.zip",
          sizeBytes: 220000,
        },
        sampleCount: 320,
        containsUnsupportedNameTokens: false,
      },
    }).success,
    true
  );
  assert.equal(
    evaluateContract.requestSchema.safeParse({
      requestId: "qc-req-1",
      submissionId: "sub-1",
      actorId: "creator-1",
      actorRole: "creator",
      pack: {
        packName: "",
        declaredTopLevelFolders: [],
        sampleCount: -1,
        containsUnsupportedNameTokens: false,
      },
    }).success,
    false
  );

  const adminContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE_ACTIVE];
  assert.equal(
    adminContract.requestSchema.safeParse({
      requestId: "policy-req-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Update baseline",
      policy: {
        policyId: "default-wave2-policy",
        ruleSetVersion: "2026.02.wave2-baseline",
        rules: [
          {
            ruleId: "pack.folder.audio.required",
            enabled: true,
            blockingOverride: null,
          },
        ],
      },
    }).success,
    true
  );
  assert.equal(
    adminContract.requestSchema.safeParse({
      requestId: "policy-req-1",
      actorId: "reviewer-1",
      actorRole: "reviewer",
      reason: "not allowed",
      policy: {
        policyId: "default-wave2-policy",
        rules: [],
      },
    }).success,
    false
  );
});

test("admin qc policy update contract requires explicit permission", () => {
  const contract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE_ACTIVE];
  assert.deepEqual(contract.requiredPermissions, ["qc:policy:write"]);
});

test("admin config and integration contracts enforce admin-only payloads", () => {
  const listContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_CONFIGS_LIST];
  assert.equal(
    listContract.requestSchema.safeParse({
      actorId: "admin-1",
      actorRole: "admin",
      includeDrafts: true,
    }).success,
    true
  );
  assert.equal(
    listContract.requestSchema.safeParse({
      actorId: "reviewer-1",
      actorRole: "reviewer",
    }).success,
    false
  );

  const integrationContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST];
  assert.equal(
    integrationContract.requestSchema.safeParse({
      provider: "dropbox",
      actorId: "admin-1",
      actorRole: "admin",
    }).success,
    true
  );
  assert.equal(
    integrationContract.requestSchema.safeParse({
      provider: "unknown",
      actorId: "admin-1",
      actorRole: "admin",
    }).success,
    false
  );

  const publishContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH];
  assert.equal(
    publishContract.requestSchema.safeParse({
      id: "cfg-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Promote validated draft",
      confirmation: "PUBLISH",
    }).success,
    true
  );

  const rollbackContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK];
  assert.equal(
    rollbackContract.requestSchema.safeParse({
      id: "cfg-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Undo unsafe publish",
      confirmation: "ROLLBACK",
    }).success,
    true
  );
  assert.equal(
    rollbackContract.requestSchema.safeParse({
      id: "cfg-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Undo unsafe publish",
    }).success,
    false
  );
  assert.equal(
    rollbackContract.responseSchema.safeParse(
      buildIpcErrorResponse(
        IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK,
        "ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
        "OPERATIONS_SERVICE_ERROR:409",
        "No published snapshot exists"
      )
    ).success,
    true
  );

  const rotateContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE];
  assert.equal(
    rotateContract.requestSchema.safeParse({
      provider: "airtable",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Credential hygiene rotation",
      confirmation: "ROTATE",
    }).success,
    true
  );
});

test("notifications contracts enforce list/mark/retry payload schemas", () => {
  const listContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.NOTIFICATIONS_LIST];
  assert.equal(
    listContract.requestSchema.safeParse({
      actorId: "creator-1",
      actorRole: "creator",
      includeRead: true,
    }).success,
    true
  );
  assert.equal(
    listContract.requestSchema.safeParse({
      actorId: "",
      actorRole: "creator",
    }).success,
    false
  );

  const markReadContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.NOTIFICATIONS_MARK_READ];
  assert.equal(
    markReadContract.requestSchema.safeParse({
      actorId: "creator-1",
      actorRole: "creator",
      notificationIds: ["ntf-1"],
    }).success,
    true
  );
  assert.equal(
    markReadContract.requestSchema.safeParse({
      actorId: "creator-1",
      actorRole: "creator",
      notificationIds: [],
    }).success,
    false
  );

  const retryContract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.NOTIFICATIONS_RETRY];
  assert.equal(
    retryContract.requestSchema.safeParse({
      actorId: "admin-1",
      actorRole: "admin",
      notificationId: "ntf-3",
    }).success,
    true
  );
});

test("notifications retry contract is reviewer/admin role-scoped", () => {
  const contract = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.NOTIFICATIONS_RETRY];
  assert.deepEqual(contract.allowedRoles, ["reviewer", "admin"]);
});

test("wave3 operations contracts enforce request payload schemas", () => {
  const enqueue = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.JOBS_ENQUEUE];
  assert.equal(
    enqueue.requestSchema.safeParse({
      requestId: "enqueue-1",
      jobType: "release.trigger",
      idempotencyKey: "release.trigger:sub-1",
      payloadJson: { submissionId: "sub-1" },
    }).success,
    true
  );

  const replay = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.JOBS_REPLAY];
  assert.equal(
    replay.requestSchema.safeParse({
      id: "job-1",
      requestId: "replay-1",
      actorId: "admin-1",
      reason: "Recover dead letter",
      confirmation: "REPLAY",
    }).success,
    true
  );

  const resolve = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.SCHEDULING_RESOLVE];
  assert.equal(
    resolve.requestSchema.safeParse({
      requestId: "resolve-1",
      submissionId: "sub-1",
      schedulingEvent: {
        eventName: "submission.approved.scheduling.v1",
        schemaVersion: 1,
        submissionId: "sub-1",
        transitionId: "transition-1",
        occurredAt: "2026-02-27T00:00:00.000Z",
        approvedBy: "reviewer-1",
        preferredReleaseMonth: "2026-12",
        idempotencyKey: "submission.approved.scheduling.v1:sub-1:1",
      },
    }).success,
    true
  );

  const annotate = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE];
  assert.equal(
    annotate.requestSchema.safeParse({
      source: "desktop-operations-ui",
      severity: "warning",
      note: "latency spike observed",
      linkedEntity: "sub-1",
    }).success,
    true
  );

  assert.equal(
    enqueue.requestSchema.safeParse({
      requestId: "",
      jobType: "release.trigger",
      idempotencyKey: "release.trigger:sub-1",
      payloadJson: {},
    }).success,
    false
  );
  assert.equal(
    resolve.requestSchema.safeParse({
      requestId: "resolve-1",
      submissionId: "sub-1",
      schedulingEvent: {
        eventName: "submission.approved.scheduling.v2",
        schemaVersion: 1,
        submissionId: "sub-1",
        transitionId: "transition-1",
        occurredAt: "2026-02-27T00:00:00.000Z",
        approvedBy: "reviewer-1",
        preferredReleaseMonth: "2026-12",
        idempotencyKey: "submission.approved.scheduling.v1:sub-1:1",
      },
    }).success,
    false
  );
  assert.equal(
    annotate.requestSchema.safeParse({
      source: "desktop-operations-ui",
      severity: "critical",
      note: "",
      linkedEntity: "sub-1",
    }).success,
    false
  );
});

test("review contracts enforce reviewer/admin payloads and reject schema", () => {
  const queue = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.REVIEW_QUEUE_LIST];
  assert.deepEqual(queue.allowedRoles, ["reviewer", "admin"]);
  assert.equal(
    queue.requestSchema.safeParse({
      actorId: "reviewer-1",
      actorRole: "reviewer",
      state: "under_review",
      tag: "metadata",
      flag: "policy",
    }).success,
    true
  );

  const reject = IPC_CONTRACT_REGISTRY[IPC_CHANNELS.REVIEW_REJECT];
  assert.equal(
    reject.requestSchema.safeParse({
      submissionId: "sub-1",
      actorId: "reviewer-1",
      actorRole: "reviewer",
      requestId: "reject-1",
      reasonCode: "QUALITY_ISSUES",
      notes: "Clipping detected",
    }).success,
    true
  );
  assert.equal(
    reject.requestSchema.safeParse({
      submissionId: "sub-1",
      actorId: "reviewer-1",
      actorRole: "reviewer",
      reasonCode: "QUALITY_ISSUES",
    }).success,
    false
  );
});
