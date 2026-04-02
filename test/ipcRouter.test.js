const test = require("node:test");
const assert = require("node:assert/strict");
const { createIpcRouter } = require("../electron/ipc/router");
const { createSecurityAuditLog } = require("../electron/ipc/auditLog");
const { IPC_CHANNELS } = require("../electron/ipc/contracts");
const { OperationsBackendClientError } = require("../electron/ipc/operationsBackendClient");

function createFixedTimeAuditLog() {
  return createSecurityAuditLog({
    now: () => "2026-02-25T00:00:00.000Z",
  });
}

function trustedSenderMetadata(senderUrl = "file:///app/index.html", webContentsId = 1) {
  return {
    senderUrl,
    topFrameUrl: senderUrl,
    senderWebContentsId: webContentsId,
    event: {
      sender: {
        id: webContentsId,
      },
    },
  };
}

test("router rejects unauthorized audit access and logs denial", async () => {
  let actorContext = {
    actorId: "creator-1",
    roles: ["creator"],
    sessionIssuedAt: "2026-02-25T00:00:00.000Z",
  };

  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => actorContext,
    verifySecurityConfig: () => ({
      checks: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        navigationGuard: true,
      },
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS,
    { limit: 5 },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.match(response.error.reason, /ROLE_FORBIDDEN/);

  const auditEvents = router.auditLog.list({ limit: 10 });
  assert.equal(auditEvents[0].channel, IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS);
  assert.equal(auditEvents[0].outcome, "denied");
});

test("router rejects malformed request payloads deterministically", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-2",
      roles: ["creator"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUTH_GET_SESSION,
    {
      includePermissions: "true",
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "VALIDATION_ERROR");
  assert.match(response.error.reason, /REQUEST_SCHEMA_INVALID/);
});

test("router rejects malformed high-risk admin payloads with deterministic validation error", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-10",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-10T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH,
    {
      id: "cfg-1",
      actorId: "admin-10",
      actorRole: "admin",
      reason: "Promote draft",
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "VALIDATION_ERROR");
  assert.match(response.error.reason, /REQUEST_SCHEMA_INVALID/);
});

test("router rejects config rollback for non-admin actor context", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-10",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-03-10T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK,
    {
      id: "cfg-1",
      actorId: "admin-10",
      actorRole: "admin",
      reason: "Undo unsafe publish",
      confirmation: "ROLLBACK",
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.match(response.error.reason, /ROLE_FORBIDDEN/);
});

test("router maps rollback backend failures to deterministic contract errors", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-11",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-10T00:00:00.000Z",
    }),
    operationsBackendClient: {
      rollbackAdminConfig() {
        throw new OperationsBackendClientError({
          code: "ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
          message: "Rollback is not available for this config",
          reason: "OPERATIONS_SERVICE_ERROR:409",
        });
      },
    },
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK,
    {
      id: "cfg-1",
      actorId: "admin-11",
      actorRole: "admin",
      reason: "Undo unsafe publish",
      confirmation: "ROLLBACK",
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE");
  assert.equal(response.error.reason, "OPERATIONS_SERVICE_ERROR:409");
});

test("router returns deterministic unknown channel errors", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-3",
      roles: ["creator"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke("fileeaters.unknown.channel.v1", {}, {
    ...trustedSenderMetadata(),
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "UNKNOWN_CHANNEL");
});

test("router serves PRD-01 and PRD-16 stub channels when authorized", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-1",
      roles: ["admin"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    verifySecurityConfig: () => ({
      checks: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        navigationGuard: true,
      },
    }),
    logger: { error: () => {} },
  });

  const authResponse = await router.invoke(IPC_CHANNELS.AUTH_GET_SESSION, {
    includePermissions: true,
  }, trustedSenderMetadata());
  assert.equal(authResponse.ok, true);
  assert.equal(authResponse.data.actor.id, "admin-1");
  assert.deepEqual(authResponse.data.permissions, ["*"]);

  const securityResponse = await router.invoke(
    IPC_CHANNELS.DESKTOP_VERIFY_SECURITY,
    {},
    trustedSenderMetadata()
  );
  assert.equal(securityResponse.ok, true);
  assert.equal(securityResponse.data.checks.navigationGuard, true);
});

test("router rejects untrusted sender origin and logs denial", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-1",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUTH_GET_SESSION,
    { includePermissions: false },
    { senderUrl: "https://malicious.example" }
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.match(response.error.reason, /SENDER_ORIGIN_FORBIDDEN/);
});

test("router rejects sender identity mismatch even on trusted file origin", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-1",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUTH_GET_SESSION,
    { includePermissions: false },
    {
      ...trustedSenderMetadata(),
      event: {
        sender: {
          id: 1,
        },
      },
      senderWebContentsId: 2,
    }
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.match(response.error.reason, /SENDER_ORIGIN_FORBIDDEN/);
});

test("router enforces required permissions for allowed roles", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-2",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    resolveActorPermissions: () => [],
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS,
    { limit: 5 },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.match(response.error.reason, /PERMISSION_FORBIDDEN/);
});

test("router returns deterministic internal error on response schema mismatch", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-2",
      roles: ["admin"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    verifySecurityConfig: () => ({
      checks: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        navigationGuard: true,
      },
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.DESKTOP_VERIFY_SECURITY,
    {},
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "INTERNAL_ERROR");
  assert.match(response.error.reason, /RESPONSE_SCHEMA_INVALID/);
});

test("router authorization follows logged-in actor context for admin channels", async () => {
  const qcBackendClient = {
    getActivePolicyCalls: 0,
    getActivePolicy() {
      this.getActivePolicyCalls += 1;
      return {
        policy: {
          policyId: "default-wave2-policy",
          policyVersion: 1,
          ruleSetVersion: "2026.03.phase1-production",
          rules: [
            {
              ruleId: "DEMO_NORMALIZATION_INVALID",
              enabled: true,
              blockingOverride: null,
              params: {},
            },
          ],
          updatedBy: "system",
          updatedAt: "2026-03-13T00:00:00.000Z",
          reason: "initial policy bootstrap",
        },
      };
    },
  };

  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-seed",
      roles: ["creator"],
      sessionIssuedAt: "2026-03-13T00:00:00.000Z",
    }),
    authBackendClient: {
      async login() {
        return {
          accessToken: "token",
          accessTokenExpiresAt: "2026-03-13T01:00:00.000Z",
          refreshToken: "refresh",
          refreshTokenExpiresAt: "2026-04-13T00:00:00.000Z",
          user: {
            id: "admin-logged-in",
            email: "admin@example.com",
            roles: ["admin"],
            permissions: ["*"],
            status: "active",
            createdAt: "2026-03-13T00:00:00.000Z",
            updatedAt: "2026-03-13T00:00:00.000Z",
          },
        };
      },
    },
    qcBackendClient,
    logger: { error: () => {} },
  });

  const preLoginResponse = await router.invoke(
    IPC_CHANNELS.ADMIN_QC_POLICY_GET,
    { actorId: "admin-logged-in", actorRole: "admin" },
    trustedSenderMetadata()
  );
  assert.equal(preLoginResponse.ok, false);
  assert.equal(preLoginResponse.error.code, "AUTH_FORBIDDEN");

  const loginResponse = await router.invoke(
    IPC_CHANNELS.AUTH_LOGIN,
    { email: "admin@example.com", password: "StrongPassword!123" },
    trustedSenderMetadata()
  );
  assert.equal(loginResponse.ok, true);

  const postLoginResponse = await router.invoke(
    IPC_CHANNELS.ADMIN_QC_POLICY_GET,
    { actorId: "admin-logged-in", actorRole: "admin" },
    trustedSenderMetadata()
  );
  assert.equal(postLoginResponse.ok, true);
  assert.equal(qcBackendClient.getActivePolicyCalls, 1);
});

test("router registers only namespaced channels from registry", () => {
  const registeredChannels = [];
  const fakeIpcMain = {
    handle: (channel, handler) => {
      registeredChannels.push({ channel, handler });
    },
  };

  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-3",
      roles: ["admin"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  router.registerHandlers(fakeIpcMain);

  assert.equal(registeredChannels.length, Object.keys(require("../electron/ipc/contracts").IPC_CONTRACT_REGISTRY).length);
  for (const entry of registeredChannels) {
    assert.match(entry.channel, /^fileeaters\.[a-z0-9.-]+\.v1$/);
    assert.equal(typeof entry.handler, "function");
  }
});

test("router uses audit listForChannel bridge when provided", async () => {
  const router = createIpcRouter({
    auditLog: {
      append: () => {},
      list: () => [],
      listForChannel: async () => [
        {
          id: "event-1",
          channel: IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS,
          actorId: "admin-1",
          outcome: "allowed",
          reason: "AUTHORIZED",
          timestamp: "2026-02-25T00:00:00.000Z",
        },
      ],
    },
    resolveAuthContext: () => ({
      actorId: "admin-1",
      roles: ["admin"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS,
    { limit: 1 },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, true);
  assert.equal(response.data.events.length, 1);
  assert.equal(response.data.events[0].id, "event-1");
});

test("router forwards backend auth lockout errors for login channel", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-locked",
      roles: ["creator"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    authBackendClient: {
      async login() {
        return Promise.reject({
          code: "AUTH_LOCKED",
          reason: "AUTH_SERVICE_ERROR:423",
          message: "Account temporarily locked",
        });
      },
    },
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUTH_LOGIN,
    { email: "creator@example.com", password: "StrongPassword!123" },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_LOCKED");
  assert.equal(response.error.reason, "AUTH_SERVICE_ERROR:423");
});

test("router serves auth register channel through backend client", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-registered",
      roles: ["creator"],
      sessionIssuedAt: "2026-02-25T00:00:00.000Z",
    }),
    authBackendClient: {
      async register() {
        return {
          accessToken: "token",
          accessTokenExpiresAt: "2026-02-25T00:15:00.000Z",
          refreshToken: "refresh",
          refreshTokenExpiresAt: "2026-03-26T00:00:00.000Z",
          user: {
            id: "user_1",
            email: "creator@example.com",
            roles: ["creator"],
            permissions: ["submission:create"],
            status: "active",
            createdAt: "2026-02-25T00:00:00.000Z",
            updatedAt: "2026-02-25T00:00:00.000Z",
          },
        };
      },
    },
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.AUTH_REGISTER,
    {
      email: "creator@example.com",
      password: "StrongPassword!123",
      otpVerificationToken: "otp-token",
      roles: ["creator"],
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, true);
  assert.equal(response.data.user.email, "creator@example.com");
});

test("router serves QC evaluate and list rules channels through backend client", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-1",
      roles: ["creator"],
      sessionIssuedAt: "2026-02-26T00:00:00.000Z",
    }),
    qcBackendClient: {
      async evaluate() {
        return {
          report: {
            reportId: "qcrpt:sub-1:req-1",
            submissionId: "sub-1",
            status: "passed",
            summary: {
              blockingFailures: 0,
              warnings: 1,
              evaluatedRuleCount: 5,
            },
            findings: [],
            generatedAt: "2026-02-26T00:00:00.000Z",
            ruleSetVersion: "2026.02.wave2-baseline",
            policyVersion: 1,
          },
          idempotent: false,
          appliedPolicyId: "default-wave2-policy",
        };
      },
      async listRules() {
        return {
          rules: [],
          policy: {
            policyId: "default-wave2-policy",
            policyVersion: 1,
            ruleSetVersion: "2026.02.wave2-baseline",
            rules: [],
            updatedBy: "system",
            updatedAt: "2026-02-26T00:00:00.000Z",
            reason: "initial policy bootstrap",
          },
        };
      },
      async getResults() {
        return {
          runId: null,
          findings: [],
          status: "not_run",
          startedAt: null,
          completedAt: null,
          history: [],
        };
      },
      async getActivePolicy() {
        return {
          policy: {
            policyId: "default-wave2-policy",
            policyVersion: 1,
            ruleSetVersion: "2026.02.wave2-baseline",
            rules: [],
            updatedBy: "system",
            updatedAt: "2026-02-26T00:00:00.000Z",
            reason: "initial policy bootstrap",
          },
        };
      },
      async updateActivePolicy() {
        return {
          policy: {
            policyId: "default-wave2-policy",
            policyVersion: 2,
            ruleSetVersion: "2026.02.wave2-baseline",
            rules: [],
            updatedBy: "admin-1",
            updatedAt: "2026-02-26T00:00:00.000Z",
            reason: "update",
          },
          auditHook: {
            action: "qc.policy.updated.v1",
            entityType: "system",
            entityId: "default-wave2-policy",
            actorId: "admin-1",
            idempotencyKey: "qc.policy.updated.v1:default-wave2-policy:2:req-1",
            metadata: {},
          },
          observabilityHook: {
            metricName: "qc_policy_update_total",
            tags: {},
            value: 1,
            emittedAt: "2026-02-26T00:00:00.000Z",
          },
        };
      },
    },
    logger: { error: () => {} },
  });

  const evaluateResponse = await router.invoke(
    IPC_CHANNELS.QC_EVALUATE_PACK,
    {
      requestId: "qc-1",
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
    },
    trustedSenderMetadata()
  );
  assert.equal(evaluateResponse.ok, true);
  assert.equal(evaluateResponse.data.report.status, "passed");

  const listRulesResponse = await router.invoke(
    IPC_CHANNELS.QC_LIST_RULES,
    { includeDisabled: true },
    trustedSenderMetadata()
  );
  assert.equal(listRulesResponse.ok, true);
  assert.equal(listRulesResponse.data.policy.policyId, "default-wave2-policy");

  const resultsResponse = await router.invoke(
    IPC_CHANNELS.QC_RESULTS_GET,
    { submissionId: "sub-1" },
    trustedSenderMetadata()
  );
  assert.equal(resultsResponse.ok, true);
  assert.equal(resultsResponse.data.status, "not_run");
});

test("router enforces admin role for QC policy update channel", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-1",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-02-26T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE_ACTIVE,
    {
      requestId: "req-1",
      actorId: "reviewer-1",
      actorRole: "admin",
      reason: "attempt",
      policy: {
        policyId: "default-wave2-policy",
        rules: [
          {
            ruleId: "pack.folder.audio.required",
            enabled: true,
            blockingOverride: null,
          },
        ],
      },
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.match(response.error.reason, /ROLE_FORBIDDEN/);
});

test("router normalizes QC result findings with default diffTag", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-1",
      roles: ["creator"],
      sessionIssuedAt: "2026-03-13T00:00:00.000Z",
    }),
    qcBackendClient: {
      async getResults() {
        return {
          runId: "run-1",
          status: "failed",
          startedAt: "2026-03-13T00:00:00.000Z",
          completedAt: "2026-03-13T00:00:10.000Z",
          findings: [
            {
              findingId: "f-1",
              ruleId: "pack.folder.audio.required",
              severity: "warning",
              category: "folder",
              fileRef: null,
              message: "Missing Audio folder",
              remediation: "Add Audio folder",
            },
          ],
          history: [],
        };
      },
    },
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.QC_RESULTS_GET,
    { submissionId: "sub-1" },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, true);
  assert.equal(response.data.findings[0].diffTag, "unchanged");
});

test("router allows admin session for creator draft channels", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "user_test_admin",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-13T00:00:00.000Z",
    }),
    operationsBackendClient: {
      async createSubmissionDraft() {
        return {
          submission: {
            submissionId: "creator-draft-1",
            currentState: "draft",
          },
        };
      },
      async updateSubmissionMetadata() {
        return {
          submission: {
            submissionId: "creator-draft-1",
            currentState: "draft",
          },
        };
      },
    },
    logger: { error: () => {} },
  });

  const createResponse = await router.invoke(
    IPC_CHANNELS.SUBMISSION_DRAFT,
    {
      submissionId: "creator-draft-1",
      creatorId: "user_test_admin",
      packName: "My Pack",
      labelName: "My Label",
      releaseMonth: "2026-03",
      notes: null,
      tags: [],
      airtableFormCompleted: false,
      airtablePayloadChecksum: null,
      autosaveJson: {},
    },
    trustedSenderMetadata()
  );
  assert.equal(createResponse.ok, true);

  const metadataResponse = await router.invoke(
    IPC_CHANNELS.SUBMISSION_METADATA,
    {
      submissionId: "creator-draft-1",
      creatorId: "user_test_admin",
      packName: "My Pack Updated",
      labelName: "My Label",
      releaseMonth: "2026-03",
      notes: "Metadata save",
      tags: ["test"],
      airtableFormCompleted: false,
      airtablePayloadChecksum: null,
      autosaveJson: {},
    },
    trustedSenderMetadata()
  );
  assert.equal(metadataResponse.ok, true);
});

test("router serves notifications channels and enforces retry role guard", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-1",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-02-27T00:00:00.000Z",
    }),
    notificationsBackendClient: {
      async list() {
        return {
          notifications: [
            {
              notificationId: "ntf-1",
              type: "qc_failed",
              severity: "warning",
              status: "sent",
              channel: "in_app",
              title: "QC requires fixes",
              message: "Fix blocking findings.",
              submissionId: "sub-1",
              read: false,
              readAt: null,
              attempts: 1,
              maxAttempts: 3,
              createdAt: "2026-02-27T00:00:00.000Z",
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          ],
        };
      },
      async markRead() {
        return { updatedCount: 1 };
      },
      async markAllRead() {
        return { updatedCount: 2 };
      },
      async retry() {
        return {
          notification: {
            notificationId: "ntf-3",
            type: "rejected",
            severity: "error",
            status: "sent",
            channel: "email",
            title: "Dispatch failed",
            message: "Retry completed.",
            submissionId: "sub-3",
            read: false,
            readAt: null,
            attempts: 4,
            maxAttempts: 5,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:01:00.000Z",
          },
        };
      },
    },
    logger: { error: () => {} },
  });

  const listResponse = await router.invoke(
    IPC_CHANNELS.NOTIFICATIONS_LIST,
    { actorId: "reviewer-1", actorRole: "reviewer", includeRead: true },
    trustedSenderMetadata()
  );
  assert.equal(listResponse.ok, true);
  assert.equal(listResponse.data.notifications.length, 1);

  const retryResponse = await router.invoke(
    IPC_CHANNELS.NOTIFICATIONS_RETRY,
    { actorId: "reviewer-1", actorRole: "reviewer", notificationId: "ntf-3" },
    trustedSenderMetadata()
  );
  assert.equal(retryResponse.ok, true);
  assert.equal(retryResponse.data.notification.status, "sent");

  const creatorScopedRouter = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "creator-1",
      roles: ["creator"],
      sessionIssuedAt: "2026-02-27T00:00:00.000Z",
    }),
    notificationsBackendClient: {
      async retry() {
        return {
          notification: {
            notificationId: "ntf-3",
            type: "rejected",
            severity: "error",
            status: "sent",
            channel: "email",
            title: "Dispatch retry",
            message: "Retry completed.",
            submissionId: "sub-3",
            read: false,
            readAt: null,
            attempts: 4,
            maxAttempts: 5,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:01:00.000Z",
          },
        };
      },
    },
    logger: { error: () => {} },
  });

  const deniedRetry = await creatorScopedRouter.invoke(
    IPC_CHANNELS.NOTIFICATIONS_RETRY,
    { actorId: "creator-1", actorRole: "creator", notificationId: "ntf-3" },
    trustedSenderMetadata()
  );
  assert.equal(deniedRetry.ok, false);
  assert.equal(deniedRetry.error.code, "AUTH_FORBIDDEN");
});

test("router serves review channels through operations backend client", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-1",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-02-28T00:00:00.000Z",
    }),
    operationsBackendClient: {
      async listReviewQueue() {
        return {
          items: [
            {
              submissionId: "sub-1",
              packName: "Pack sub-1",
              creatorId: "creator-1",
              submittedAt: "2026-02-28T00:00:00.000Z",
              state: "under_review",
              ageDays: 0,
              tags: [],
              flags: [],
            },
          ],
        };
      },
      async getReviewSubmission() {
        return {
          submission: {
            submissionId: "sub-1",
            packName: "Pack sub-1",
            creatorId: "creator-1",
            submittedAt: "2026-02-28T00:00:00.000Z",
            state: "under_review",
            ageDays: 0,
            tags: [],
            flags: [],
          },
          metadata: { version: 1 },
          qcFindings: [],
          transitions: [],
          integrationEvents: [],
          decisions: [],
          tags: [],
          flags: [],
        };
      },
      async approveReview() {
        return {
          decision: { id: "rd-1", decision: "APPROVED" },
          transition: { submission: { current_state: "approved" } },
        };
      },
      async rejectReview() {
        return {
          decision: { id: "rd-2", decision: "REJECTED" },
          transition: { submission: { current_state: "rejected" } },
        };
      },
      async addReviewTag() {
        return { tag: { id: "rt-1", tag: "metadata" } };
      },
      async addReviewFlag() {
        return { flag: { id: "rf-1", flagType: "policy", severity: "high" } };
      },
      async reopenReview() {
        return {
          decision: { id: "rd-3", decision: "REOPENED" },
          transition: { submission: { current_state: "draft" } },
        };
      },
    },
    logger: { error: () => {} },
  });

  const queue = await router.invoke(
    IPC_CHANNELS.REVIEW_QUEUE_LIST,
    { actorId: "reviewer-1", actorRole: "reviewer" },
    trustedSenderMetadata()
  );
  assert.equal(queue.ok, true);
  assert.equal(queue.data.items.length, 1);

  const detail = await router.invoke(
    IPC_CHANNELS.REVIEW_SUBMISSION_GET,
    { submissionId: "sub-1", actorId: "reviewer-1", actorRole: "reviewer" },
    trustedSenderMetadata()
  );
  assert.equal(detail.ok, true);
  assert.equal(detail.data.submission.submissionId, "sub-1");

  const reject = await router.invoke(
    IPC_CHANNELS.REVIEW_REJECT,
    {
      submissionId: "sub-1",
      actorId: "reviewer-1",
      actorRole: "reviewer",
      reasonCode: "QUALITY_ISSUES",
      notes: "Fix clipping",
    },
    trustedSenderMetadata()
  );
  assert.equal(reject.ok, true);
  assert.equal(reject.data.decision.decision, "REJECTED");
});

test("router rejects malformed jobs enqueue payloads deterministically", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-ops-1",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-03-11T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.JOBS_ENQUEUE,
    {
      jobType: "release.trigger",
      idempotencyKey: "release.trigger:sub-1",
      payloadJson: { submissionId: "sub-1" },
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "VALIDATION_ERROR");
  assert.match(response.error.reason, /REQUEST_SCHEMA_INVALID/);
});

test("router enforces admin role for jobs replay and release trigger channels", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "reviewer-ops-2",
      roles: ["reviewer"],
      sessionIssuedAt: "2026-03-11T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const replayResponse = await router.invoke(
    IPC_CHANNELS.JOBS_REPLAY,
    {
      id: "job-1",
      requestId: "replay-1",
      actorId: "reviewer-ops-2",
      reason: "attempt replay",
      confirmation: "REPLAY job-1",
    },
    trustedSenderMetadata()
  );
  assert.equal(replayResponse.ok, false);
  assert.equal(replayResponse.error.code, "AUTH_FORBIDDEN");
  assert.match(replayResponse.error.reason, /ROLE_FORBIDDEN/);

  const triggerResponse = await router.invoke(
    IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE,
    {
      requestId: "trigger-1",
      submissionId: "sub-1",
      actorId: "reviewer-ops-2",
      actorRole: "admin",
      force: false,
      jobRunId: null,
    },
    trustedSenderMetadata()
  );
  assert.equal(triggerResponse.ok, false);
  assert.equal(triggerResponse.error.code, "AUTH_FORBIDDEN");
  assert.match(triggerResponse.error.reason, /ROLE_FORBIDDEN/);
});

test("router rejects malformed scheduling resolve and observability annotate payloads", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-ops-3",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-11T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const schedulingResponse = await router.invoke(
    IPC_CHANNELS.SCHEDULING_RESOLVE,
    {
      requestId: "resolve-1",
      submissionId: "sub-1",
      schedulingEvent: {
        eventName: "submission.approved.scheduling.v2",
        schemaVersion: 1,
        submissionId: "sub-1",
        transitionId: "tr-1",
        occurredAt: "2026-03-11T00:00:00.000Z",
        approvedBy: "reviewer-1",
        preferredReleaseMonth: "2026-04",
        idempotencyKey: "submission.approved.scheduling.v1:sub-1:1",
      },
      timezone: "UTC",
    },
    trustedSenderMetadata()
  );
  assert.equal(schedulingResponse.ok, false);
  assert.equal(schedulingResponse.error.code, "VALIDATION_ERROR");
  assert.match(schedulingResponse.error.reason, /REQUEST_SCHEMA_INVALID/);

  const annotateResponse = await router.invoke(
    IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE,
    {
      source: "desktop-operations-ui",
      severity: "critical",
      note: "",
      linkedEntity: "submission:sub-1",
    },
    trustedSenderMetadata()
  );
  assert.equal(annotateResponse.ok, false);
  assert.equal(annotateResponse.error.code, "VALIDATION_ERROR");
  assert.match(annotateResponse.error.reason, /REQUEST_SCHEMA_INVALID/);
});

test("router preserves deterministic backend domain envelopes for scheduling errors", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-ops-4",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-11T00:00:00.000Z",
    }),
    operationsBackendClient: {
      async triggerRelease() {
        return Promise.reject({
          code: "SCHEDULE_NOT_FOUND",
          reason: "OPERATIONS_SERVICE_ERROR:404",
          message: "No schedule exists for submission sub-1.",
        });
      },
    },
    logger: { error: () => {} },
  });

  const response = await router.invoke(
    IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE,
    {
      requestId: "trigger-404",
      submissionId: "sub-1",
      actorId: "admin-ops-4",
      actorRole: "admin",
      force: false,
      jobRunId: null,
    },
    trustedSenderMetadata()
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "SCHEDULE_NOT_FOUND");
  assert.equal(response.error.reason, "OPERATIONS_SERVICE_ERROR:404");
  assert.equal(response.error.channel, IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE);
});

test("router enforces trusted webContents and expected renderer path", async () => {
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    expectedRendererPath: "/app/index.html",
    isTrustedWebContentsId: (webContentsId) => webContentsId === 1,
    resolveAuthContext: () => ({
      actorId: "admin-trust-1",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-23T00:00:00.000Z",
    }),
    logger: { error: () => {} },
  });

  const trustedResponse = await router.invoke(
    IPC_CHANNELS.AUTH_GET_SESSION,
    { includePermissions: false },
    trustedSenderMetadata("file:///app/index.html", 1)
  );
  assert.equal(trustedResponse.ok, true);

  const wrongPathResponse = await router.invoke(
    IPC_CHANNELS.AUTH_GET_SESSION,
    { includePermissions: false },
    trustedSenderMetadata("file:///app/other.html", 1)
  );
  assert.equal(wrongPathResponse.ok, false);
  assert.equal(wrongPathResponse.error.code, "AUTH_FORBIDDEN");

  const untrustedWebContentsResponse = await router.invoke(
    IPC_CHANNELS.AUTH_GET_SESSION,
    { includePermissions: false },
    trustedSenderMetadata("file:///app/index.html", 2)
  );
  assert.equal(untrustedWebContentsResponse.ok, false);
  assert.equal(untrustedWebContentsResponse.error.code, "AUTH_FORBIDDEN");
});

test("router routes audit compliance list and export channels", async () => {
  const received = [];
  const router = createIpcRouter({
    auditLog: createFixedTimeAuditLog(),
    resolveAuthContext: () => ({
      actorId: "admin-compliance-1",
      roles: ["admin"],
      sessionIssuedAt: "2026-03-23T00:00:00.000Z",
    }),
    resolveActorPermissions: () => ["audit:read"],
    auditApiClient: {
      async listAuditEvents(payload) {
        received.push({ type: "list", payload });
        return {
          total: 0,
          limit: 25,
          offset: 0,
          events: [],
        };
      },
      async exportAuditEvents(payload) {
        received.push({ type: "export", payload });
        return {
          format: "json",
          contentType: "application/json",
          fileName: "audit-events.json",
          exportedAt: "2026-03-23T00:00:00.000Z",
          signedAt: "2026-03-23T00:00:01.000Z",
          signatureAlgorithm: "ed25519",
          signature: "c2lnbmF0dXJl",
          content: "[]",
        };
      },
    },
    logger: { error: () => {} },
  });

  const listResponse = await router.invoke(
    IPC_CHANNELS.AUDIT_EVENTS_LIST,
    {
      actorId: "spoofed-actor",
      actorRole: "admin",
      action: null,
      entityType: null,
      entityId: null,
      from: null,
      to: null,
      limit: 25,
      offset: 0,
    },
    trustedSenderMetadata()
  );
  assert.equal(listResponse.ok, true);

  const exportResponse = await router.invoke(
    IPC_CHANNELS.AUDIT_EVENTS_EXPORT,
    {
      actorId: "spoofed-actor",
      actorRole: "admin",
      format: "json",
      includeHashChain: true,
      action: null,
      entityType: null,
      entityId: null,
      from: null,
      to: null,
      limit: 25,
    },
    trustedSenderMetadata()
  );
  assert.equal(exportResponse.ok, true);
  assert.equal(received.length, 2);
  assert.equal(received[0].payload.actorId, "admin-compliance-1");
  assert.equal(received[0].payload.actorRole, "admin");
  assert.equal(received[1].payload.actorId, "admin-compliance-1");
  assert.equal(received[1].payload.actorRole, "admin");
});
