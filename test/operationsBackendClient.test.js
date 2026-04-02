const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OperationsBackendClientError,
  createOperationsBackendClient,
} = require("../electron/ipc/operationsBackendClient");

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function headersToObject(headers) {
  return Object.fromEntries(new Headers(headers));
}

test("operations backend client sends actor headers for privileged mutations", async () => {
  const requests = [];
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (_url, init) => {
      requests.push({
        headers: headersToObject(init.headers),
        body: JSON.parse(init.body),
      });
      return createJsonResponse(200, {
        submission: {},
        transition: {},
        idempotent: false,
      });
    },
  });

  await client.transitionSubmission({
    submissionId: "sub-1",
    requestId: "req-1",
    toState: "approved",
    actorId: "reviewer-1",
    actorRole: "reviewer",
    expectedVersion: 1,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["x-actor-id"], "reviewer-1");
  assert.equal(requests[0].headers["x-actor-role"], "reviewer");
  assert.equal(requests[0].body.actor_id, "reviewer-1");
  assert.equal(requests[0].body.actor_role, "reviewer");
});

test("operations backend client sends internal token for internal job enqueue requests", async () => {
  const requests = [];
  process.env.SPLICE_INTERNAL_API_TOKEN = "test-internal-token";
  try {
    const client = createOperationsBackendClient({
      baseUrl: "http://127.0.0.1:8017",
      fetchImpl: async (_url, init) => {
        requests.push({
          headers: headersToObject(init.headers),
          body: JSON.parse(init.body),
        });
        return createJsonResponse(200, {
          idempotent: false,
          job: {
            id: "job-1",
            job_type: "notification.dispatch",
            idempotency_key: "job:1",
            status: "queued",
            attempt_count: 0,
            max_attempts: 1,
            payload_json: {},
            created_at: "2026-03-10T00:00:00.000Z",
            status_class: "ready",
            recommended_action: "none",
          },
        });
      },
    });

    await client.enqueueJob({
      requestId: "job-1",
      jobType: "notification.dispatch",
      idempotencyKey: "job:1",
      payloadJson: {},
      maxAttempts: 1,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers["x-internal-token"], "test-internal-token");
    assert.equal(requests[0].body.job_type, "notification.dispatch");
  } finally {
    delete process.env.SPLICE_INTERNAL_API_TOKEN;
  }
});

test("operations backend client maps review queue response to camelCase", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        items: [
          {
            submission_id: "sub-1",
            pack_name: "Pack sub-1",
            creator_id: "creator-1",
            submitted_at: "2026-02-28T00:00:00.000Z",
            state: "under_review",
            age_days: 1,
            tags: ["metadata"],
            flags: [
              {
                id: "rf-1",
                submission_id: "sub-1",
                flag_type: "policy",
                severity: "high",
                added_by: "reviewer-1",
                created_at: "2026-02-28T00:00:00.000Z",
              },
            ],
          },
        ],
      }),
  });

  const result = await client.listReviewQueue({
    actorId: "reviewer-1",
    actorRole: "reviewer",
    state: "under_review",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].submissionId, "sub-1");
  assert.equal(result.items[0].flags[0].flagType, "policy");
});

test("operations backend client forwards review service domain errors", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(400, {
        error: {
          code: "REVIEW_REASON_REQUIRED",
          message: "reason_code and notes are required for rejection.",
        },
      }),
  });

  await assert.rejects(
    client.rejectReview({
      submissionId: "sub-1",
      actorId: "reviewer-1",
      actorRole: "reviewer",
      reasonCode: "QUALITY_ISSUES",
      notes: "",
    }),
    (error) =>
      error instanceof OperationsBackendClientError &&
      error.code === "REVIEW_REASON_REQUIRED" &&
      error.reason === "OPERATIONS_SERVICE_ERROR:400"
  );
});

test("operations backend client surfaces backend domain message for unknown error codes", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(422, {
        error: {
          code: "MISSING_PREFERRED_RELEASE_MONTH",
          message: "Approved transitions must include preferred_release_month.",
        },
      }),
  });

  await assert.rejects(
    client.approveReview({
      submissionId: "sub-1",
      actorId: "reviewer-1",
      actorRole: "reviewer",
      requestId: "approve-unknown-code",
      notes: "Approve attempt",
    }),
    (error) =>
      error instanceof OperationsBackendClientError &&
      error.code === "INTERNAL_ERROR" &&
      error.message === "Approved transitions must include preferred_release_month." &&
      error.reason === "OPERATIONS_SERVICE_ERROR:422"
  );
});

test("operations backend client maps creator submissions Airtable link fields", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, [
        {
          submission_id: "sub-1",
          creator_id: "creator-1",
          current_state: "draft",
          version: 2,
          pack_name: "Pack sub-1",
          label_name: "Label 1",
          release_month: "2026-03",
          notes: "Ready",
          tags: ["wave2"],
          airtable_form_completed: true,
          airtable_payload_checksum: "checksum-1",
          airtable_sync_status: "linked",
          airtable_record_id: "rec123",
          airtable_record_url: "https://airtable.example/rec123",
          airtable_last_synced_at: "2026-03-06T10:00:00Z",
          airtable_last_error_code: null,
          airtable_last_error_detail: null,
          created_at: "2026-03-05T10:00:00Z",
          updated_at: "2026-03-06T10:00:00Z",
          draft_last_saved_at: "2026-03-06T10:00:00Z",
        },
      ]),
  });

  const result = await client.listSubmissions({ creatorId: "creator-1" });

  assert.equal(result.submissions.length, 1);
  assert.equal(result.submissions[0].submissionId, "sub-1");
  assert.equal(result.submissions[0].airtableSyncStatus, "linked");
  assert.equal(result.submissions[0].airtableRecordId, "rec123");
  assert.equal(result.submissions[0].airtableRecordUrl, "https://airtable.example/rec123");
  assert.equal(result.submissions[0].airtableLastSyncedAt, "2026-03-06T10:00:00.000Z");
});

test("operations backend client maps creator submission upload progress fields", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, [
        {
          submission_id: "sub-1",
          creator_id: "creator-1",
          current_state: "uploading",
          version: 2,
          pack_name: "Pack sub-1",
          label_name: "Label 1",
          release_month: "2026-03",
          notes: "Ready",
          tags: ["wave2"],
          airtable_form_completed: true,
          airtable_payload_checksum: "checksum-1",
          airtable_sync_status: "linked",
          airtable_record_id: "rec123",
          airtable_record_url: "https://airtable.example/rec123",
          airtable_last_synced_at: "2026-03-06T10:00:00Z",
          airtable_last_error_code: null,
          airtable_last_error_detail: null,
          created_at: "2026-03-05T10:00:00Z",
          updated_at: "2026-03-06T10:00:00Z",
          draft_last_saved_at: "2026-03-06T10:00:00Z",
          upload_intake_session_id: "intake:sub-1",
          upload_handoff_id: "handoff:intake:sub-1:1",
          upload_manifest_version: 1,
          upload_status: "in_progress",
          upload_progress_percent: 42,
          upload_uploaded_bytes: 4200,
          upload_total_bytes: 10000,
          upload_uploaded_files: 6,
          upload_total_files: 10,
          upload_error: null,
          upload_updated_at: "2026-03-06T10:01:00Z",
        },
      ]),
  });

  const result = await client.listSubmissions({ creatorId: "creator-1" });

  assert.equal(result.submissions[0].uploadHandoffId, "handoff:intake:sub-1:1");
  assert.equal(result.submissions[0].uploadStatus, "in_progress");
  assert.equal(result.submissions[0].uploadProgressPercent, 42);
  assert.equal(result.submissions[0].uploadUploadedFiles, 6);
  assert.equal(result.submissions[0].uploadTotalFiles, 10);
});

test("operations backend client maps creator timeline review decision context", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, [
        {
          transition_id: "tr-1",
          from_state: "under_review",
          to_state: "rejected",
          actor_id: "reviewer-1",
          actor_role: "reviewer",
          reason: "QUALITY_ISSUES",
          review_decision: "REJECTED",
          review_reason_code: "QUALITY_ISSUES",
          review_notes: "Fix artwork naming before resubmitting.",
          request_id: "req-reject-1",
          created_at: "2026-03-30T16:12:00Z",
        },
      ]),
  });

  const result = await client.getSubmissionTimeline({
    submissionId: "sub-1",
    creatorId: "creator-1",
  });

  assert.equal(result.timeline.length, 1);
  assert.equal(result.timeline[0].transitionId, "tr-1");
  assert.equal(result.timeline[0].reviewDecision, "REJECTED");
  assert.equal(result.timeline[0].reviewReasonCode, "QUALITY_ISSUES");
  assert.equal(result.timeline[0].reviewNotes, "Fix artwork naming before resubmitting.");
});

test("operations backend client maps handoff status responses", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        handoff: {
          handoff_id: "handoff:intake:sub-1:1",
          submission_id: "sub-1",
          intake_session_id: "intake:sub-1",
          status: "in_progress",
          target: "temporary-object-storage",
          progress_percent: 55,
          uploaded_bytes: 5500,
          total_bytes: 10000,
          object_count: 10,
          uploaded_files: 6,
          total_files: 10,
          checksum_verified: true,
          created_at: "2026-03-10T00:00:00Z",
          updated_at: "2026-03-10T00:05:00Z",
          completed_at: null,
          error: null,
        },
      }),
  });

  const result = await client.getIntakeHandoffStatus({ handoffId: "handoff:intake:sub-1:1" });

  assert.equal(result.handoff.handoffId, "handoff:intake:sub-1:1");
  assert.equal(result.handoff.progressPercent, 55);
  assert.equal(result.handoff.uploadedFiles, 6);
  assert.equal(result.handoff.totalFiles, 10);
});

test("operations backend client sends actor context for handoff control requests", async () => {
  const requests = [];
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (_url, init) => {
      requests.push({
        headers: headersToObject(init.headers),
        body: JSON.parse(init.body),
      });
      return createJsonResponse(200, {
        handoff: {
          handoff_id: "handoff:intake:sub-1:1",
          submission_id: "sub-1",
          intake_session_id: "intake:sub-1",
          status: "paused",
          target: "temporary-object-storage",
          progress_percent: 38,
          uploaded_bytes: 3800,
          total_bytes: 10000,
          object_count: 10,
          uploaded_files: 4,
          total_files: 10,
          checksum_verified: false,
          created_at: "2026-03-10T00:00:00Z",
          updated_at: "2026-03-10T00:05:00Z",
          completed_at: null,
          error: null,
        },
      });
    },
  });

  await client.controlIntakeHandoff({
    handoffId: "handoff:intake:sub-1:1",
    action: "pause",
    requestId: "req-control-1",
    actorId: "creator-1",
    actorRole: "creator",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["x-actor-id"], "creator-1");
  assert.equal(requests[0].headers["x-actor-role"], "creator");
  assert.equal(requests[0].body.actor_id, "creator-1");
  assert.equal(requests[0].body.actor_role, "creator");
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, "handoff_id"), false);
});

test("operations backend client maps Airtable sync response payload", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        submission_id: "sub-2",
        sync_status: "duplicate",
        airtable_form_completed: true,
        airtable_payload_checksum: "checksum-2",
        airtable_record_id: null,
        airtable_record_url: null,
        last_synced_at: "2026-03-06T10:05:00Z",
        last_error_code: "AIRTABLE_DUPLICATE_MATCH",
        last_error_detail: "Found 2 matching records",
        canonical_record_id: null,
        mapped_payload: {
          label_name: "Label 2",
          pack_name: "Pack sub-2",
          release_month: "2026-04",
          notes: "Needs cleanup",
          tags: ["duplicate"],
        },
      }),
  });

  const result = await client.syncSubmissionAirtable({
    submissionId: "sub-2",
    creatorId: "creator-2",
    forceRelink: false,
  });

  assert.equal(result.submissionId, "sub-2");
  assert.equal(result.syncStatus, "duplicate");
  assert.equal(result.airtableFormCompleted, true);
  assert.equal(result.lastErrorCode, "AIRTABLE_DUPLICATE_MATCH");
  assert.equal(result.lastErrorDetail, "Found 2 matching records");
  assert.deepEqual(result.mappedPayload, {
    labelName: "Label 2",
    packName: "Pack sub-2",
    releaseMonth: "2026-04",
    notes: "Needs cleanup",
    tags: ["duplicate"],
  });
});

test("operations backend client maps integration health payload to deterministic guidance", async () => {
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        integrations: [
          {
            provider: "dropbox",
            ok: false,
            latency_ms: 0,
            status_class: "unconfigured",
            recommended_action: "rotate_credentials",
            status_copy: "Credentials are missing. Rotate credentials, then run a connection test.",
            credential_status: "missing",
            last_checked_at: "2026-03-10T12:00:00Z",
            last_rotated_at: null,
            last_failure_context: "No active credential reference was found for this provider.",
            error: "Credentials not configured.",
          },
        ],
      }),
  });

  const result = await client.listAdminIntegrationHealth({
    actorId: "admin-1",
    actorRole: "admin",
  });

  assert.equal(result.integrations.length, 1);
  assert.equal(result.integrations[0].statusClass, "unconfigured");
  assert.equal(result.integrations[0].recommendedAction, "rotate_credentials");
  assert.equal(result.integrations[0].errorCode, null);
  assert.equal(result.integrations[0].statusCopy.length > 0, true);
});

test("operations backend client maps Dropbox readiness and OAuth setup payloads", async () => {
  const requests = [];
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (url, init) => {
      requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (url.includes("/dropbox/readiness")) {
        return createJsonResponse(200, {
          provider: "dropbox",
          status: "NOT_CONFIGURED",
          message: "Dropbox is not configured.",
          authorize_url: "https://www.dropbox.com/oauth2/authorize?client_id=abc",
        });
      }
      if (url.includes("/dropbox/oauth/start")) {
        return createJsonResponse(200, {
          provider: "dropbox",
          authorize_url: "https://www.dropbox.com/oauth2/authorize?client_id=abc",
        });
      }
      return createJsonResponse(200, {
        provider: "dropbox",
        status: "configured",
        account_id: "dbid:123",
        configured_at: "2026-03-24T10:00:00Z",
      });
    },
  });

  const readiness = await client.getDropboxReadiness({
    actorId: "admin-1",
    actorRole: "admin",
  });
  assert.equal(readiness.status, "NOT_CONFIGURED");
  assert.equal(readiness.authorizeUrl.includes("dropbox.com/oauth2/authorize"), true);

  const start = await client.startDropboxOauth({
    actorId: "admin-1",
    actorRole: "admin",
    appKey: "app-key",
  });
  assert.equal(start.provider, "dropbox");
  assert.equal(start.authorizeUrl.includes("dropbox.com/oauth2/authorize"), true);

  const complete = await client.completeDropboxOauth({
    actorId: "admin-1",
    actorRole: "admin",
    authCode: "auth-code",
    appKey: "app-key",
    appSecret: "app-secret",
  });
  assert.equal(complete.provider, "dropbox");
  assert.equal(complete.accountId, "dbid:123");
  assert.equal(complete.configuredAt, "2026-03-24T10:00:00.000Z");

  assert.equal(requests.length, 3);
  assert.equal(requests[1].body.app_key, "app-key");
  assert.equal(requests[2].body.auth_code, "auth-code");
});

test("operations backend client forwards publish confirmation and reason", async () => {
  const requests = [];
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return createJsonResponse(200, {
        config: {
          id: "cfg-1",
          config_type: "qc_policy",
          version: 2,
          payload_json: {},
          published_by: "admin-1",
          published_at: "2026-03-10T12:00:00Z",
          is_draft: false,
          created_at: "2026-03-10T11:00:00Z",
        },
      });
    },
  });

  await client.publishAdminConfig({
    id: "cfg-1",
    actorId: "admin-1",
    actorRole: "admin",
    reason: "Promote validated draft",
    confirmation: "PUBLISH",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].reason, "Promote validated draft");
  assert.equal(requests[0].confirmation, "PUBLISH");
});

test("operations backend client forwards rollback confirmation and maps unavailable responses", async () => {
  const requests = [];
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return createJsonResponse(409, {
        error: {
          code: "ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
          message: "Rollback is not available for this config.",
        },
      });
    },
  });

  await assert.rejects(
    client.rollbackAdminConfig({
      id: "cfg-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Undo unsafe publish",
      confirmation: "ROLLBACK",
    }),
    (error) =>
      error instanceof OperationsBackendClientError &&
      error.code === "ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE" &&
      error.reason === "OPERATIONS_SERVICE_ERROR:409"
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].reason, "Undo unsafe publish");
  assert.equal(requests[0].confirmation, "ROLLBACK");
});

test("operations backend client maps incident annotation failure context fields", async () => {
  const requests = [];
  const client = createOperationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return createJsonResponse(200, {
        idempotent: false,
        annotation: {
          id: "incident:1",
          source: "desktop-operations-ui",
          severity: "critical",
          note: "retry exhausted",
          linked_entity: "submission:sub-1",
          failure_class: "retry_exhaustion",
          correlation_id: "job:1",
          remediation_status: "open",
          remediation_owner: "ops-1",
          remediation_link: "/admin/jobs/job:1",
          audit_event_id: "audit:1",
          created_at: "2026-03-10T10:00:00.000Z",
        },
      });
    },
  });

  const result = await client.annotateIncident({
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

  assert.equal(requests.length, 1);
  assert.equal(requests[0].failure_class, "retry_exhaustion");
  assert.equal(result.annotation.failureClass, "retry_exhaustion");
  assert.equal(result.annotation.correlationId, "job:1");
  assert.equal(result.annotation.remediationOwner, "ops-1");
});
