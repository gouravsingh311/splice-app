const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const preloadPath = path.join(__dirname, "..", "electron", "preload.js");
const preloadSource = fs.readFileSync(preloadPath, "utf8");

const IPC_CHANNELS = Object.freeze({
  AUTH_GET_SESSION: "splice.auth.session.get.v1",
  AUTH_LOGIN: "splice.auth.login.v1",
  AUTH_REGISTER: "splice.auth.register.v1",
  AUTH_OTP_SEND: "splice.auth.otp.send.v1",
  AUTH_OTP_VERIFY: "splice.auth.otp.verify.v1",
  AUTH_FORGOT_PASSWORD: "splice.auth.forgot-password.v1",
  AUTH_RESET_PASSWORD: "splice.auth.reset-password.v1",
  QC_EVALUATE_PACK: "splice.qc.evaluate-pack.v1",
  QC_LIST_RULES: "splice.qc.rules.list.v1",
  QC_RESULTS_GET: "splice.qc.results.get.v1",
  QC_REPORT_EXPORT: "splice.qc.report.export.v1",
  NOTIFICATIONS_LIST: "splice.notifications.list.v1",
  NOTIFICATIONS_MARK_READ: "splice.notifications.mark-read.v1",
  NOTIFICATIONS_MARK_ALL_READ: "splice.notifications.mark-all-read.v1",
  NOTIFICATIONS_RETRY: "splice.notifications.retry.v1",
  ADMIN_QC_POLICY_GET_ACTIVE: "splice.admin.qc.policy.get.v1",
  ADMIN_QC_POLICY_UPDATE_ACTIVE: "splice.admin.qc.policy.update.v1",
  ADMIN_CONFIGS_ROLLBACK: "splice.admin.configs.rollback.v1",
  OBSERVABILITY_METRICS_GET: "splice.observability.metrics.get.v1",
  OBSERVABILITY_INCIDENTS_ANNOTATE: "splice.observability.incidents.annotate.v1",
  DESKTOP_VERIFY_SECURITY: "splice.desktop.security.verify-config.v1",
  AUDIT_LIST_SECURITY_EVENTS: "splice.audit.security-events.list.v1",
});

function defaultIpcResponse(channel, payload = {}) {
  if (channel === IPC_CHANNELS.AUTH_GET_SESSION) {
    return {
      ok: true,
      data: {
        actor: {
          id: "local-dev-actor",
          roles: ["creator"],
        },
        permissions: [],
        sessionIssuedAt: "2026-02-25T00:00:00.000Z",
      },
    };
  }

  if (channel === IPC_CHANNELS.DESKTOP_VERIFY_SECURITY) {
    return {
      ok: true,
      data: {
        checks: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          navigationGuard: true,
        },
      },
    };
  }

  if (channel === IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS) {
    return {
      ok: true,
      data: {
        events: [],
      },
    };
  }

  if (channel === IPC_CHANNELS.AUTH_LOGIN || channel === IPC_CHANNELS.AUTH_REGISTER) {
    return {
      ok: true,
      data: {
        accessToken: "access-token",
        accessTokenExpiresAt: "2026-02-25T00:15:00.000Z",
        refreshToken: "refresh-token",
        refreshTokenExpiresAt: "2026-03-27T00:00:00.000Z",
        user: {
          id: "user_1",
          email: "creator@example.com",
          roles: ["creator"],
          permissions: ["submission:create"],
          status: "active",
          createdAt: "2026-02-25T00:00:00.000Z",
          updatedAt: "2026-02-25T00:00:00.000Z",
        },
      },
    };
  }

  if (channel === IPC_CHANNELS.AUTH_OTP_SEND || channel === IPC_CHANNELS.AUTH_FORGOT_PASSWORD) {
    return {
      ok: true,
      data: {
        challengeId: "otp_123",
        expiresAt: "2026-02-25T00:10:00.000Z",
        cooldownSeconds: 45,
      },
    };
  }

  if (channel === IPC_CHANNELS.AUTH_OTP_VERIFY) {
    return {
      ok: true,
      data: {
        otpVerificationToken: "otp-token",
        expiresAt: "2026-02-25T00:15:00.000Z",
      },
    };
  }

  if (channel === IPC_CHANNELS.AUTH_RESET_PASSWORD) {
    return {
      ok: true,
      data: {
        revokedSessionCount: 2,
      },
    };
  }

  if (channel === IPC_CHANNELS.QC_EVALUATE_PACK) {
    return {
      ok: true,
      data: {
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
      },
    };
  }

  if (channel === IPC_CHANNELS.QC_LIST_RULES) {
    return {
      ok: true,
      data: {
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
      },
    };
  }

  if (channel === IPC_CHANNELS.QC_RESULTS_GET) {
    return {
      ok: true,
      data: {
        runId: "qc-1",
        submissionId: "sub-1",
        findings: [
          {
            findingId: "finding-1",
            ruleId: "AUDIO_ZIP_SIZE_TOO_LARGE",
            severity: "blocking",
            category: "audio-zip",
            fileRef: "Audio/Label - Pack.zip",
            message: "Audio ZIP exceeds 4 GB.",
            remediation: "Re-export the ZIP under 4 GB.",
            diffTag: "new",
          },
        ],
        status: "failed",
        startedAt: "2026-03-02T00:00:00.000Z",
        completedAt: "2026-03-02T00:01:00.000Z",
        generatedAt: "2026-03-02T00:01:00.000Z",
        ruleSetVersion: "2026.02.wave2-baseline",
        policyVersion: 1,
      },
    };
  }

  if (channel === IPC_CHANNELS.QC_REPORT_EXPORT) {
    return {
      ok: true,
      data: {
        canceled: false,
        path: "/tmp/qc-findings-qc-1.json",
      },
    };
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
    return {
      ok: true,
      data: {
        snapshot: "splice_api_background_job_queue_depth 1",
        capturedAt: "2026-03-10T00:00:00.000Z",
      },
    };
  }

  if (channel === IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE) {
    return {
      ok: true,
      data: {
        idempotent: false,
        annotation: {
          id: "incident:1",
          source: "desktop-operations-ui",
          severity: "critical",
          note: "retry exhausted",
          linkedEntity: "submission:sub-1",
          failureClass: "retry_exhaustion",
          correlationId: "job:1",
          remediationStatus: "open",
          remediationOwner: "ops-1",
          remediationLink: "/admin/jobs/job:1",
          auditEventId: "audit:1",
          createdAt: "2026-03-10T00:00:00.000Z",
        },
      },
    };
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_LIST) {
    return {
      ok: true,
      data: {
        notifications: [
          {
            notificationId: "ntf-1",
            type: "qc_failed",
            severity: "warning",
            status: "sent",
            channel: "in_app",
            title: "QC requires fixes",
            message: "Resolve blocking findings.",
            submissionId: "sub-1",
            read: false,
            readAt: null,
            attempts: 1,
            maxAttempts: 3,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
        ],
      },
    };
  }

  if (
    channel === IPC_CHANNELS.NOTIFICATIONS_MARK_READ ||
    channel === IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ
  ) {
    return {
      ok: true,
      data: {
        updatedCount: 1,
      },
    };
  }

  if (channel === IPC_CHANNELS.NOTIFICATIONS_RETRY) {
    return {
      ok: true,
      data: {
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
      },
    };
  }

  if (channel === IPC_CHANNELS.ADMIN_QC_POLICY_GET_ACTIVE) {
    return {
      ok: true,
      data: {
        policy: {
          policyId: "default-wave2-policy",
          policyVersion: 1,
          ruleSetVersion: "2026.02.wave2-baseline",
          rules: [],
          updatedBy: "system",
          updatedAt: "2026-02-26T00:00:00.000Z",
          reason: "initial policy bootstrap",
        },
      },
    };
  }

  if (channel === IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE_ACTIVE) {
    return {
      ok: true,
      data: {
        policy: {
          policyId: "default-wave2-policy",
          policyVersion: 2,
          ruleSetVersion: "2026.02.wave2-baseline",
          rules: [],
          updatedBy: "admin-1",
          updatedAt: "2026-02-26T00:05:00.000Z",
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
          emittedAt: "2026-02-26T00:05:00.000Z",
        },
      },
    };
  }

  if (channel === IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK) {
    return {
      ok: true,
      data: {
        config: {
          id: payload?.id ?? "cfg-1",
          configType: "qc_policy",
          version: 3,
          payloadJson: {},
          publishedBy: "admin-1",
          publishedAt: "2026-03-10T12:00:00.000Z",
          isDraft: false,
          createdAt: "2026-03-10T11:00:00.000Z",
        },
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "UNKNOWN_CHANNEL",
      message: "Unknown channel",
      reason: "CHANNEL_NOT_REGISTERED",
      channel,
    },
  };
}

function cloneIpcPayload(value) {
  return JSON.parse(JSON.stringify(value));
}

function bridgeIpcPayload(value) {
  return vm.runInNewContext("value", { value: cloneIpcPayload(value) });
}

function runPreload(options = {}) {
  const exposures = {};
  const calls = [];

  const contextBridge = {
    exposeInMainWorld: (name, value) => {
      exposures[name] = value;
    },
  };

  const ipcRenderer = {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (options.invoke) {
        return bridgeIpcPayload(await options.invoke(channel, payload));
      }
      return bridgeIpcPayload(defaultIpcResponse(channel, payload));
    },
  };

  const sandbox = {
    require: (moduleName) => {
      if (moduleName === "electron") {
        return { contextBridge, ipcRenderer };
      }
      throw new Error(`Unexpected preload dependency: ${moduleName}`);
    },
    process: {
      env: options.env || {},
      versions: {
        electron: "40.6.0",
        chrome: "144.0.7559.177",
        node: "20.10.0",
      },
    },
    console,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(preloadSource, sandbox, { filename: "preload.js" });

  return { exposures, calls };
}

test("preload exposes only expected bridges and keeps them frozen", () => {
  const { exposures } = runPreload();

  assert.deepEqual(Object.keys(exposures).sort(), ["splice", "spliceApp"]);
  assert.equal(Object.isFrozen(exposures.splice), true);
  assert.equal(Object.isFrozen(exposures.spliceApp), true);
  assert.equal(Object.isFrozen(exposures.splice.system), true);
  assert.equal(Object.isFrozen(exposures.spliceApp.runtime), true);
});

test("preload exposes admin rollback bridge through the desktop surface", async () => {
  const { exposures, calls } = runPreload();

  assert.equal(typeof exposures.splice.admin.configs.rollback, "function");

  const response = await exposures.splice.admin.configs.rollback({
    id: "cfg-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Undo unsafe publish",
    confirmation: "ROLLBACK",
  });

  assert.equal(response.ok, true);
  assert.equal(calls[calls.length - 1].channel, IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK);
  assert.deepEqual(calls[calls.length - 1].payload, {
    id: "cfg-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Undo unsafe publish",
    confirmation: "ROLLBACK",
  });
});

test("preload runtime parser enforces environment and health port allowlist", () => {
  const valid = runPreload({
    env: {
      SPLICE_ENV: "PROD",
      SPLICE_HEALTH_PORT: "4900",
    },
  }).exposures;

  assert.equal(valid.splice.system.runtime.environment, "prod");
  assert.equal(valid.splice.system.runtime.healthPort, 4900);
  assert.equal(valid.spliceApp.runtime.environment, "prod");
  assert.equal(valid.spliceApp.runtime.healthPort, 4900);

  const invalid = runPreload({
    env: {
      SPLICE_ENV: "qa",
      SPLICE_HEALTH_PORT: "70000",
    },
  }).exposures;

  assert.equal(invalid.splice.system.runtime.environment, "local");
  assert.equal(invalid.splice.system.runtime.healthPort, 4815);
});

test("preload rejects invalid request payload before ipc invoke", async () => {
  const harness = runPreload();

  await assert.rejects(
    harness.exposures.splice.auth.getSession({ includePermissions: "true" }),
    /Preload request validation failed/
  );
  await assert.rejects(
    harness.exposures.splice.auth.register({
      email: "creator@example.com",
      password: "short",
      otpVerificationToken: "otp",
    }),
    /Preload request validation failed/
  );
  await assert.rejects(
    harness.exposures.splice.qc.evaluatePack({
      requestId: "qc-1",
      submissionId: "sub-1",
      actorId: "creator-1",
      actorRole: "creator",
      pack: {
        packName: "",
        declaredTopLevelFolders: ["Audio"],
        sampleCount: -1,
        containsUnsupportedNameTokens: false,
      },
    }),
    /Preload request validation failed/
  );
  await assert.rejects(
    harness.exposures.splice.observability.annotateIncident({
      source: "desktop-operations-ui",
      severity: "critical",
      note: "retry exhausted",
      linkedEntity: "submission:sub-1",
      failureClass: "not-a-valid-class",
    }),
    /Preload request validation failed/
  );

  assert.equal(harness.calls.length, 0);
});

test("preload validates malformed ipc success responses deterministically", async () => {
  const harness = runPreload({
    invoke: async (channel) => {
      if (channel === IPC_CHANNELS.DESKTOP_VERIFY_SECURITY) {
        return {
          ok: true,
          data: {
            checks: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
              navigationGuard: true,
            },
          },
        };
      }
      return defaultIpcResponse(channel);
    },
  });

  await assert.rejects(
    harness.exposures.splice.desktop.verifySecurityConfig(),
    /Preload response validation failed/
  );
});

test("preload rejects malformed wave3 operations request payloads before ipc invoke", async () => {
  const harness = runPreload();

  await assert.rejects(
    harness.exposures.splice.jobs.enqueue({
      requestId: "",
      jobType: "release.trigger",
      idempotencyKey: "release.trigger:sub-1",
      payloadJson: { submissionId: "sub-1" },
    }),
    /Preload request validation failed/
  );
  await assert.rejects(
    harness.exposures.splice.scheduling.resolve({
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
    }),
    /Preload request validation failed/
  );
  await assert.rejects(
    harness.exposures.splice.observability.annotateIncident({
      source: "desktop-operations-ui",
      severity: "critical",
      note: "retry exhausted",
      linkedEntity: "submission:sub-1",
      remediationStatus: "pending",
    }),
    /Preload request validation failed/
  );

  assert.equal(harness.calls.length, 0);
});

test("preload accepts deterministic forbidden envelopes from operations channels", async () => {
  const harness = runPreload({
    invoke: async (channel) => {
      if (channel === "splice.jobs.replay.v1") {
        return {
          ok: false,
          error: {
            code: "AUTH_FORBIDDEN",
            message: "Actor is not authorized for this IPC channel",
            reason: "ROLE_FORBIDDEN: reviewer",
            channel,
          },
        };
      }
      return defaultIpcResponse(channel);
    },
  });

  const response = await harness.exposures.splice.jobs.replay({
    id: "job-1",
    requestId: "replay-1",
    actorId: "reviewer-1",
    reason: "retry manually",
    confirmation: "REPLAY job-1",
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "AUTH_FORBIDDEN");
  assert.equal(response.error.channel, "splice.jobs.replay.v1");
});

test("preload rejects malformed ipc error envelopes deterministically", async () => {
  const harness = runPreload({
    invoke: async (channel) => {
      if (channel === "splice.scheduling.trigger-release.v1") {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "forbidden",
            reason: "ROLE_FORBIDDEN",
            channel,
          },
        };
      }
      return defaultIpcResponse(channel);
    },
  });

  await assert.rejects(
    harness.exposures.splice.scheduling.triggerRelease({
      requestId: "trigger-1",
      submissionId: "sub-1",
      actorId: "reviewer-1",
      actorRole: "admin",
      force: false,
      jobRunId: null,
    }),
    /invalid error code/
  );
});

test("preload uses only namespaced v1 channels when invoking ipc", async () => {
  const harness = runPreload();

  await harness.exposures.splice.auth.getSession({ includePermissions: false });
  await harness.exposures.splice.auth.login({
    email: "creator@example.com",
    password: "StrongPassword!123",
  });
  await harness.exposures.splice.auth.sendOtp({
    target: "creator@example.com",
    purpose: "register",
  });
  await harness.exposures.splice.auth.verifyOtp({
    challengeId: "otp_123",
    purpose: "register",
    otpCode: "123456",
  });
  await harness.exposures.splice.auth.register({
    email: "creator@example.com",
    password: "StrongPassword!123",
    otpVerificationToken: "otp-token",
    roles: ["creator"],
  });
  await harness.exposures.splice.auth.forgotPassword({ email: "creator@example.com" });
  await harness.exposures.splice.auth.resetPassword({
    email: "creator@example.com",
    otpVerificationToken: "otp-token",
    newPassword: "StrongPassword!456",
  });
  await harness.exposures.splice.observability.getMetrics();
  await harness.exposures.splice.observability.annotateIncident({
    source: "desktop-operations-ui",
    severity: "critical",
    note: "retry exhausted",
    linkedEntity: "submission:sub-1",
    failureClass: "retry_exhaustion",
    correlationId: "job:1",
    remediationStatus: "open",
    remediationOwner: "ops-1",
    remediationLink: "/admin/jobs/job:1",
    auditEventId: "audit:1",
  });
  await harness.exposures.splice.qc.evaluatePack({
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
  });
  await harness.exposures.splice.qc.listRules({ includeDisabled: true });
  await harness.exposures.splice.qc.getResults({ submissionId: "sub-1" });
  await harness.exposures.splice.qc.exportReport({
    submissionId: "sub-1",
    runId: "qc-1",
    generatedAt: "2026-03-02T00:01:00.000Z",
    ruleSetVersion: "2026.02.wave2-baseline",
    policyVersion: 1,
    status: "failed",
    startedAt: "2026-03-02T00:00:00.000Z",
    completedAt: "2026-03-02T00:01:00.000Z",
    findings: [
      {
        findingId: "finding-1",
        ruleId: "AUDIO_ZIP_SIZE_TOO_LARGE",
        severity: "blocking",
        category: "audio-zip",
        fileRef: "Audio/Label - Pack.zip",
        message: "Audio ZIP exceeds 4 GB.",
        remediation: "Re-export the ZIP under 4 GB.",
        diffTag: "new",
      },
    ],
  });
  await harness.exposures.splice.notifications.list({
    actorId: "creator-1",
    actorRole: "creator",
    includeRead: true,
  });
  await harness.exposures.splice.notifications.markRead({
    actorId: "creator-1",
    actorRole: "creator",
    notificationIds: ["ntf-1"],
  });
  await harness.exposures.splice.notifications.markAllRead({
    actorId: "creator-1",
    actorRole: "creator",
  });
  await harness.exposures.splice.notifications.retry({
    actorId: "reviewer-1",
    actorRole: "reviewer",
    notificationId: "ntf-3",
  });
  await harness.exposures.splice.admin.qcPolicy.getActive();
  await harness.exposures.splice.admin.qcPolicy.updateActive({
    requestId: "req-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Update policy",
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
  });
  await harness.exposures.splice.admin.configs.rollback({
    id: "cfg-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Undo unsafe publish",
    confirmation: "ROLLBACK",
  });
  await harness.exposures.splice.desktop.verifySecurityConfig();
  await harness.exposures.splice.audit.listSecurityEvents({ limit: 3 });

  assert.deepEqual(
    harness.calls.map((entry) => entry.channel).sort(),
    Object.values(IPC_CHANNELS).sort()
  );

  for (const call of harness.calls) {
    assert.match(call.channel, /^splice\.[a-z0-9.-]+\.v1$/);
  }
});
