const test = require("node:test");
const assert = require("node:assert/strict");
const { createPreloadApi } = require("../electron/preloadApi");
const { IPC_CHANNELS } = require("../electron/ipc/contracts");

test("preload API validates request payloads before invoking IPC", async () => {
  const calls = [];

  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      return {
        ok: true,
        data: {
          actor: {
            id: "actor-1",
            roles: ["creator"],
          },
          permissions: [],
          sessionIssuedAt: "2026-02-25T00:00:00.000Z",
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await assert.rejects(api.auth.getSession({ includePermissions: "invalid" }), /Preload request validation failed/);
  await assert.rejects(
    api.auth.register({
      email: "creator@example.com",
      password: "short",
      otpVerificationToken: "otp-token",
    }),
    /Preload request validation failed/
  );

  assert.equal(calls.length, 0);
});

test("preload API validates response payloads from main", async () => {
  const api = createPreloadApi({
    invoke: async () => ({
      ok: true,
      data: {
        checks: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          navigationGuard: true,
        },
      },
    }),
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await assert.rejects(api.desktop.verifySecurityConfig(), /Preload response validation failed/);
});

test("preload API exposes a frozen minimal surface", () => {
  const api = createPreloadApi({
    invoke: async (channel) => {
      if (channel === IPC_CHANNELS.AUTH_GET_SESSION) {
        return {
          ok: true,
          data: {
            actor: {
              id: "actor-2",
              roles: ["creator"],
            },
            permissions: [],
            sessionIssuedAt: "2026-02-25T00:00:00.000Z",
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "AUTH_FORBIDDEN",
          message: "forbidden",
          reason: "ROLE_FORBIDDEN",
          channel,
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.auth), true);
  assert.equal(Object.prototype.hasOwnProperty.call(api, "invoke"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(api.system.versions, "node"), false);
});

test("preload API invokes auth OTP and reset channels through contract invoker", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
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

      return {
        ok: true,
        data: {
          revokedSessionCount: 2,
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await api.auth.sendOtp({ target: "creator@example.com", purpose: "register" });
  await api.auth.forgotPassword({ email: "creator@example.com" });
  await api.auth.verifyOtp({
    challengeId: "otp_123",
    purpose: "forgot-password",
    otpCode: "123456",
  });
  await api.auth.resetPassword({
    email: "creator@example.com",
    otpVerificationToken: "otp-token",
    newPassword: "StrongPassword!123",
  });

  assert.deepEqual(
    calls.map((call) => call.channel),
    [
      IPC_CHANNELS.AUTH_OTP_SEND,
      IPC_CHANNELS.AUTH_FORGOT_PASSWORD,
      IPC_CHANNELS.AUTH_OTP_VERIFY,
      IPC_CHANNELS.AUTH_RESET_PASSWORD,
    ]
  );
});

test("preload API invokes handoff status polling through the intake namespace", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      return {
        ok: true,
        data: {
          handoff: {
            handoffId: "handoff:intake:sub-1:1",
            submissionId: "sub-1",
            intakeSessionId: "intake:sub-1",
            status: "in_progress",
            target: "temporary-object-storage",
            progressPercent: 55,
            uploadedBytes: 5500,
            totalBytes: 10000,
            objectCount: 10,
            uploadedFiles: 6,
            totalFiles: 10,
            checksumVerified: true,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:05:00.000Z",
            completedAt: null,
            error: null,
          },
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  const response = await api.intake.getHandoffStatus({ handoffId: "handoff:intake:sub-1:1" });

  assert.equal(calls[0].channel, IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET);
  assert.deepEqual(calls[0].payload, { handoffId: "handoff:intake:sub-1:1" });
  assert.equal(response.data.handoff.progressPercent, 55);
});

test("preload API invokes QC and admin policy channels through contract invoker", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });

      if (channel === IPC_CHANNELS.QC_EVALUATE_PACK) {
        return {
          ok: true,
          data: {
            report: {
              reportId: "qcrpt:sub-1:qc-1",
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
            rules: [
              {
                ruleId: "pack.folder.audio.required",
                title: "Audio folder required",
                description: "Pack must include an Audio top-level folder.",
                severity: "blocking",
                blocking: true,
                category: "structure",
                remediation: "Add Audio folder.",
                enabled: true,
              },
            ],
            policy: {
              policyId: "default-wave2-policy",
              policyVersion: 1,
              ruleSetVersion: "2026.02.wave2-baseline",
              rules: [
                {
                  ruleId: "pack.folder.audio.required",
                  enabled: true,
                  blockingOverride: null,
                },
              ],
              updatedBy: "system",
              updatedAt: "2026-02-26T00:00:00.000Z",
              reason: "initial policy bootstrap",
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

      if (channel === IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK) {
        return {
          ok: true,
          data: {
            config: {
              id: payload.id,
              configType: "qc_policy",
              version: 3,
              payloadJson: {},
              publishedBy: "admin-1",
              publishedAt: "2026-02-26T00:10:00.000Z",
              isDraft: false,
              createdAt: "2026-02-26T00:00:00.000Z",
            },
          },
        };
      }

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
            tags: {
              policy_id: "default-wave2-policy",
            },
            value: 1,
            emittedAt: "2026-02-26T00:05:00.000Z",
          },
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await api.qc.evaluatePack({
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
  await api.qc.listRules({ includeDisabled: true });
  await api.admin.qcPolicy.getActive();
  await api.admin.qcPolicy.updateActive({
    requestId: "req-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Update baseline policy",
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
  await api.admin.configs.rollback({
    id: "cfg-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Undo unsafe publish",
    confirmation: "ROLLBACK",
  });

  assert.deepEqual(
    calls.map((call) => call.channel),
    [
      IPC_CHANNELS.QC_EVALUATE_PACK,
      IPC_CHANNELS.QC_LIST_RULES,
      IPC_CHANNELS.ADMIN_QC_POLICY_GET_ACTIVE,
      IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE_ACTIVE,
      IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK,
    ]
  );
});

test("preload API exposes Dropbox setup integration channels", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET) {
        return {
          ok: true,
          data: {
            provider: "dropbox",
            status: "NOT_CONFIGURED",
            message: "Dropbox is not configured.",
            authorizeUrl: "https://www.dropbox.com/oauth2/authorize?client_id=abc",
          },
        };
      }
      if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START) {
        return {
          ok: true,
          data: {
            provider: "dropbox",
            authorizeUrl: "https://www.dropbox.com/oauth2/authorize?client_id=abc",
          },
        };
      }
      if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START) {
        return {
          ok: true,
          data: {
            sessionId: "session-1",
            status: "pending",
            authorizeUrl: "https://www.dropbox.com/oauth2/authorize?client_id=abc",
            startedAt: "2026-03-24T10:00:00.000Z",
          },
        };
      }
      if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS) {
        return {
          ok: true,
          data: {
            sessionId: "session-1",
            status: "pending",
            message: "Waiting",
            accountId: null,
            configuredAt: null,
          },
        };
      }
      return {
        ok: true,
        data: {
          provider: "dropbox",
          status: "configured",
          accountId: "dbid:123",
          configuredAt: "2026-03-24T10:00:00.000Z",
        },
      };
    },
    versions: { electron: "1.0.0", chrome: "120.0.0" },
  });

  await api.admin.integrations.getDropboxReadiness({ actorId: "admin-1", actorRole: "admin" });
  await api.admin.integrations.startDropboxOauth({
    actorId: "admin-1",
    actorRole: "admin",
    appKey: "app-key",
  });
  await api.admin.integrations.completeDropboxOauth({
    actorId: "admin-1",
    actorRole: "admin",
    authCode: "code-1",
    appKey: "app-key",
    appSecret: "app-secret",
  });
  await api.admin.integrations.startDropboxOauthDesktop({
    actorId: "admin-1",
    actorRole: "admin",
  });
  await api.admin.integrations.getDropboxOauthDesktopStatus({
    actorId: "admin-1",
    actorRole: "admin",
    sessionId: "session-1",
  });

  assert.deepEqual(
    calls.map((item) => item.channel),
    [
      IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET,
      IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START,
      IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE,
      IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START,
      IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS,
    ]
  );
});

test("preload API enforces explicit confirmation for high-risk admin and replay actions", async () => {
  const api = createPreloadApi({
    invoke: async () => ({
      ok: true,
      data: {
        config: {
          id: "cfg-1",
          configType: "qc_policy",
          version: 2,
          payloadJson: {},
          publishedBy: "admin-1",
          publishedAt: "2026-03-10T12:00:00.000Z",
          isDraft: false,
          createdAt: "2026-03-10T11:00:00.000Z",
        },
      },
    }),
    versions: { electron: "1.0.0", chrome: "120.0.0" },
  });

  await assert.rejects(
    api.admin.configs.publish({
      id: "cfg-1",
      actorId: "admin-1",
      actorRole: "admin",
    }),
    /Preload request validation failed/
  );

  await assert.rejects(
    api.jobs.replay({
      id: "job-1",
      requestId: "replay-1",
      actorId: "admin-1",
      reason: "Recover",
    }),
    /Preload request validation failed/
  );

  await assert.rejects(
    api.admin.configs.rollback({
      id: "cfg-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Undo unsafe publish",
    }),
    /Preload request validation failed/
  );
});

test("preload API invokes notifications channels through contract invoker", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
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
                message: "Resolve findings.",
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

      return {
        ok: true,
        data: {
          updatedCount: 1,
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await api.notifications.list({ actorId: "creator-1", actorRole: "creator", includeRead: true });
  await api.notifications.markRead({
    actorId: "creator-1",
    actorRole: "creator",
    notificationIds: ["ntf-1"],
  });
  await api.notifications.markAllRead({ actorId: "creator-1", actorRole: "creator" });
  await api.notifications.retry({
    actorId: "reviewer-1",
    actorRole: "reviewer",
    notificationId: "ntf-3",
  });

  assert.deepEqual(
    calls.map((call) => call.channel),
    [
      IPC_CHANNELS.NOTIFICATIONS_LIST,
      IPC_CHANNELS.NOTIFICATIONS_MARK_READ,
      IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ,
      IPC_CHANNELS.NOTIFICATIONS_RETRY,
    ]
  );
});

test("preload API invokes compliance audit channels through contract invoker", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === IPC_CHANNELS.AUDIT_EVENTS_LIST) {
        return {
          ok: true,
          data: {
            total: 0,
            limit: 25,
            offset: 0,
            events: [],
          },
        };
      }
      return {
        ok: true,
        data: {
          format: "json",
          contentType: "application/json",
          fileName: "audit-events.json",
          exportedAt: "2026-03-23T00:00:00.000Z",
          signedAt: "2026-03-23T00:00:01.000Z",
          signatureAlgorithm: "ed25519",
          signature: "c2ln",
          content: "[]",
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await api.audit.listEvents({
    actorId: "admin-1",
    actorRole: "admin",
    action: null,
    entityType: null,
    entityId: null,
    from: null,
    to: null,
    limit: 25,
    offset: 0,
  });
  await api.audit.exportEvents({
    actorId: "admin-1",
    actorRole: "admin",
    format: "json",
    includeHashChain: true,
    action: null,
    entityType: null,
    entityId: null,
    from: null,
    to: null,
    limit: 25,
  });

  assert.deepEqual(
    calls.map((call) => call.channel),
    [IPC_CHANNELS.AUDIT_EVENTS_LIST, IPC_CHANNELS.AUDIT_EVENTS_EXPORT]
  );
});

test("preload API invokes wave3 operations channels through contract invoker", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === IPC_CHANNELS.OBSERVABILITY_METRICS_GET) {
        return {
          ok: true,
          data: {
            snapshot: "queue_depth 2",
            capturedAt: "2026-02-27T00:00:00.000Z",
          },
        };
      }

      return {
        ok: true,
        data: {
          idempotent: false,
          job: {
            id: "job-1",
            jobType: "release.trigger",
            idempotencyKey: "release.trigger:sub-1",
            status: "queued",
            attemptCount: 0,
            maxAttempts: 3,
            payloadJson: {},
            correlationId: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            startedAt: null,
            endedAt: null,
            scheduledFor: null,
            nextRetryAt: null,
            lastError: null,
          },
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await api.jobs.enqueue({
    requestId: "enqueue-1",
    jobType: "release.trigger",
    idempotencyKey: "release.trigger:sub-1",
    payloadJson: { submissionId: "sub-1" },
  });
  await api.observability.getMetrics();

  assert.deepEqual(
    calls.map((call) => call.channel),
    [IPC_CHANNELS.JOBS_ENQUEUE, IPC_CHANNELS.OBSERVABILITY_METRICS_GET]
  );
});

test("preload API invokes review channels through contract invoker", async () => {
  const calls = [];
  const api = createPreloadApi({
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === IPC_CHANNELS.REVIEW_QUEUE_LIST) {
        return {
          ok: true,
          data: {
            items: [
              {
                submissionId: "sub-1",
                packName: "Pack sub-1",
                creatorId: "creator-1",
                submittedAt: "2026-02-27T00:00:00.000Z",
                state: "under_review",
                ageDays: 1,
                tags: [],
                flags: [],
              },
            ],
          },
        };
      }

      if (channel === IPC_CHANNELS.REVIEW_SUBMISSION_GET) {
        return {
          ok: true,
          data: {
            submission: {
              submissionId: "sub-1",
              packName: "Pack sub-1",
              creatorId: "creator-1",
              submittedAt: "2026-02-27T00:00:00.000Z",
              state: "under_review",
              ageDays: 1,
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
          },
        };
      }

      if (channel === IPC_CHANNELS.REVIEW_TAG_ADD) {
        return { ok: true, data: { tag: { id: "rt-1", tag: "metadata" } } };
      }
      if (channel === IPC_CHANNELS.REVIEW_FLAG_ADD) {
        return { ok: true, data: { flag: { id: "rf-1", flagType: "policy", severity: "high" } } };
      }

      return {
        ok: true,
        data: {
          decision: { id: "rd-1", decision: "REJECTED" },
          transition: { submission: { current_state: "rejected" } },
        },
      };
    },
    versions: {
      electron: "1.0.0",
      chrome: "120.0.0",
    },
  });

  await api.review.listQueue({
    actorId: "reviewer-1",
    actorRole: "reviewer",
    state: "under_review",
    tag: null,
    flag: null,
  });
  await api.review.getSubmission({
    submissionId: "sub-1",
    actorId: "reviewer-1",
    actorRole: "reviewer",
  });
  await api.review.approve({
    submissionId: "sub-1",
    actorId: "reviewer-1",
    actorRole: "reviewer",
    requestId: "approve-1",
    expectedVersion: 1,
    notes: "Looks good",
  });
  await api.review.reject({
    submissionId: "sub-1",
    actorId: "reviewer-1",
    actorRole: "reviewer",
    requestId: "reject-1",
    expectedVersion: 1,
    reasonCode: "QUALITY_ISSUES",
    notes: "Needs fixes",
  });
  await api.review.addTag({
    submissionId: "sub-1",
    actorId: "reviewer-1",
    actorRole: "reviewer",
    tag: "metadata",
  });
  await api.review.addFlag({
    submissionId: "sub-1",
    actorId: "reviewer-1",
    actorRole: "reviewer",
    flagType: "policy",
    severity: "high",
  });
  await api.review.reopen({
    submissionId: "sub-1",
    actorId: "reviewer-1",
    actorRole: "reviewer",
    requestId: "reopen-1",
    expectedVersion: 2,
    notes: "Reopen",
  });

  assert.deepEqual(
    calls.map((call) => call.channel),
    [
      IPC_CHANNELS.REVIEW_QUEUE_LIST,
      IPC_CHANNELS.REVIEW_SUBMISSION_GET,
      IPC_CHANNELS.REVIEW_APPROVE,
      IPC_CHANNELS.REVIEW_REJECT,
      IPC_CHANNELS.REVIEW_TAG_ADD,
      IPC_CHANNELS.REVIEW_FLAG_ADD,
      IPC_CHANNELS.REVIEW_REOPEN,
    ]
  );
});
