const test = require("node:test");
const assert = require("node:assert/strict");
const { QcBackendClientError, createQcBackendClient } = require("../electron/ipc/qcBackendClient");

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("qc backend client maps evaluate response to renderer-safe camelCase payload", async () => {
  const client = createQcBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        report: {
          report_id: "qcrpt:sub-1:req-1",
          submission_id: "sub-1",
          status: "passed",
          summary: {
            blocking_failures: 0,
            warnings: 1,
            evaluated_rule_count: 5,
          },
          findings: [
            {
              finding_id: "finding-1",
              rule_id: "pack.sample-count.max",
              severity: "warning",
              blocking: false,
              status: "warning",
              message: "Sample count is close to the maximum limit.",
              remediation: "Reduce sample count if possible.",
              context: {
                file_ref: "Audio/Label - Pack.zip",
              },
            },
          ],
          generated_at: "2026-02-26T00:00:00.000Z",
          rule_set_version: "2026.02.wave2-baseline",
          policy_version: 1,
        },
        idempotent: false,
        applied_policy_id: "default-wave2-policy",
      }),
  });

  const result = await client.evaluate({
    requestId: "req-1",
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

  assert.equal(result.report.reportId, "qcrpt:sub-1:req-1");
  assert.equal(result.report.summary.evaluatedRuleCount, 5);
  assert.equal(result.report.findings.length, 1);
  assert.equal(result.report.findings[0].context.file_ref, "Audio/Label - Pack.zip");
  assert.equal(Object.prototype.hasOwnProperty.call(result.report.findings[0], "fileRef"), false);
  assert.equal(result.appliedPolicyId, "default-wave2-policy");
});

test("qc backend client forwards policy service domain errors", async () => {
  const client = createQcBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(409, {
        error: {
          code: "QC_POLICY_VERSION_CONFLICT",
          message: "Active policy version does not match expected_policy_version.",
        },
      }),
  });

  await assert.rejects(
    client.updateActivePolicy({
      requestId: "req-1",
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Update policy",
      expectedPolicyVersion: 99,
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
    }),
    (error) =>
      error instanceof QcBackendClientError &&
      error.code === "QC_POLICY_VERSION_CONFLICT" &&
      error.reason === "QC_SERVICE_ERROR:409:QC_POLICY_VERSION_CONFLICT"
  );
});

test("qc backend client maps persisted results history payload", async () => {
  const client = createQcBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        latest: {
          run_id: "req-2",
          submission_id: "sub-1",
          status: "failed",
          started_at: "2026-03-03T00:00:00.000Z",
          completed_at: "2026-03-03T00:01:00.000Z",
          generated_at: "2026-03-03T00:01:00.000Z",
          rule_set_version: "2026.02.wave2-baseline",
          policy_version: 2,
          findings: [
            {
              finding_id: "finding-2",
              rule_id: "pack.audio.zip.naming",
              severity: "blocking",
              blocking: true,
              status: "failed",
              message: "Audio ZIP name is invalid.",
              remediation: "Rename audio ZIP to Label Name - Pack Name.zip.",
              context: {
                file_ref: "Audio/Wrong Name.zip",
              },
            },
          ],
        },
        history: [
          {
            run_id: "req-1",
            submission_id: "sub-1",
            status: "passed",
            started_at: "2026-03-02T00:00:00.000Z",
            completed_at: "2026-03-02T00:01:00.000Z",
            generated_at: "2026-03-02T00:01:00.000Z",
            rule_set_version: "2026.02.wave2-baseline",
            policy_version: 1,
            findings: [],
          },
          {
            run_id: "req-2",
            submission_id: "sub-1",
            status: "failed",
            started_at: "2026-03-03T00:00:00.000Z",
            completed_at: "2026-03-03T00:01:00.000Z",
            generated_at: "2026-03-03T00:01:00.000Z",
            rule_set_version: "2026.02.wave2-baseline",
            policy_version: 2,
            findings: [],
          },
        ],
      }),
  });

  const result = await client.getResults({ submissionId: "sub-1" });
  assert.equal(result.runId, "req-2");
  assert.equal(result.submissionId, "sub-1");
  assert.equal(result.status, "failed");
  assert.equal(result.generatedAt, "2026-03-03T00:01:00.000Z");
  assert.equal(result.ruleSetVersion, "2026.02.wave2-baseline");
  assert.equal(result.policyVersion, 2);
  assert.equal(result.history.length, 2);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].category, "audio-zip");
  assert.equal(result.findings[0].fileRef, "Audio/Wrong Name.zip");
  assert.equal(result.findings[0].diffTag, "unchanged");
});
