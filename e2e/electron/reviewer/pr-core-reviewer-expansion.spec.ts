import Database from "better-sqlite3";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createDraftAndTransition,
  getSeededAccount,
  installRendererApiShim,
  launchDesktop,
  loginViaUi,
  navigateViaNavHit,
} from "../support";

const REVIEW_DB_PATH = path.join(process.cwd(), "data", "test_pw_global.db");
const REVIEW_API_BASE_URL = process.env.PW_API_BASE_URL ?? "http://127.0.0.1:8017";

function openReviewDb(): Database.Database {
  return new Database(REVIEW_DB_PATH);
}

function isoDaysAgo(days: number, hours = 0, minutes = 0): string {
  return new Date(Date.now() - (((days * 24) + hours) * 60 + minutes) * 60_000).toISOString();
}

async function addReviewTag(
  request: Parameters<typeof createDraftAndTransition>[0],
  apiUrl: string,
  submissionId: string,
  actorId: string,
  actorRole: "reviewer" | "admin",
  tag: string,
): Promise<void> {
  const response = await request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(submissionId)}/tags`, {
    data: {
      actor_id: actorId,
      actor_role: actorRole,
      tag,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function addReviewFlag(
  request: Parameters<typeof createDraftAndTransition>[0],
  apiUrl: string,
  submissionId: string,
  actorId: string,
  actorRole: "reviewer" | "admin",
  flagType: string,
  severity: string,
): Promise<void> {
  const response = await request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(submissionId)}/flags`, {
    data: {
      actor_id: actorId,
      actor_role: actorRole,
      flag_type: flagType,
      severity,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function setSubmissionTimestamps(submissionId: string, timestamp: string): Promise<void> {
  const db = openReviewDb();
  try {
    db.prepare("UPDATE submissions SET created_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, submissionId);
    db.prepare("UPDATE submission_metadata SET created_at = ?, updated_at = ? WHERE submission_id = ?").run(timestamp, timestamp, submissionId);
    db.prepare("UPDATE submission_state_metadata SET created_at = ?, updated_at = ? WHERE submission_id = ?").run(timestamp, timestamp, submissionId);
  } finally {
    db.close();
  }
}

async function loginReviewerConsole() {
  const reviewerAccount = getSeededAccount("reviewer");
  process.env.SPLICE_API_BASE_URL = REVIEW_API_BASE_URL;
  const launched = await launchDesktop({ actorId: reviewerAccount.email, actorRoles: "reviewer" });
  await installRendererApiShim(launched.page, undefined, launched.apiUrl);
  await loginViaUi(launched.page, {
    email: reviewerAccount.email,
    password: reviewerAccount.password,
    expectedRole: "reviewer",
  });
  return { ...launched, reviewerAccount };
}

// Reserved for reviewer queue/decision gap scenarios owned by Worker C.
test.describe.configure({ timeout: 120_000 });

test.describe("Reviewer PR-core expansion scenarios", () => {
  test("[RV-002][RV-003][RV-004] deterministic queue order and filters", async ({ request }) => {
    const { app, page, apiUrl, reviewerAccount } = await loginReviewerConsole();
    const uniqueTag = `rv-expansion-${Date.now()}`;

    try {
      const baseCreator = "creator-review-expansion";
      const seeded = [
        {
          submissionId: "sub-rv-order-high",
          creatorId: `${baseCreator}-a`,
          state: "under_review" as const,
          createdAt: isoDaysAgo(10),
          flagType: "risk-high" as const,
          flagSeverity: "high" as const,
        },
        {
          submissionId: "sub-rv-order-policy",
          creatorId: `${baseCreator}-b`,
          state: "under_review" as const,
          createdAt: isoDaysAgo(10, 1),
          flagType: "policy" as const,
          flagSeverity: "high" as const,
        },
        {
          submissionId: "sub-rv-order-old",
          creatorId: `${baseCreator}-c`,
          state: "under_review" as const,
          createdAt: isoDaysAgo(5, 2),
        },
        {
          submissionId: "sub-rv-order-new",
          creatorId: `${baseCreator}-d`,
          state: "under_review" as const,
          createdAt: isoDaysAgo(5),
        },
        {
          submissionId: "sub-rv-order-recent",
          creatorId: `${baseCreator}-e`,
          state: "under_review" as const,
          createdAt: isoDaysAgo(1),
        },
        {
          submissionId: "sub-rv-order-approved",
          creatorId: `${baseCreator}-f`,
          state: "approved" as const,
          createdAt: isoDaysAgo(1, 1),
        },
      ];

      for (const item of seeded) {
        await createDraftAndTransition(request, {
          submissionId: item.submissionId,
          creatorId: item.creatorId,
          toState: "under_review",
          actorId: item.creatorId,
          actorRole: "creator",
          expectedVersion: 0,
          baseUrl: apiUrl,
        });
        await setSubmissionTimestamps(item.submissionId, item.createdAt);
        await addReviewTag(request, apiUrl, item.submissionId, reviewerAccount.email, "reviewer", uniqueTag);
        if (item.flagType) {
          await addReviewFlag(
            request,
            apiUrl,
            item.submissionId,
            reviewerAccount.email,
            "reviewer",
            item.flagType,
            item.flagSeverity ?? "high",
          );
        }
        if (item.state === "approved") {
          const approvedResponse = await request.post(
            `${apiUrl}/reviews/submissions/${encodeURIComponent(item.submissionId)}/approve`,
            {
              data: {
                actor_id: reviewerAccount.email,
                actor_role: "reviewer",
                request_id: `approve-${item.submissionId}`,
                notes: "Approved for queue ordering coverage.",
              },
            },
          );
          expect(approvedResponse.ok()).toBeTruthy();
          await setSubmissionTimestamps(item.submissionId, item.createdAt);
        }
      }

      await navigateViaNavHit(page, "reviewer-queue");
      await expect(page.locator("#view-reviewer-queue")).toBeVisible();
      await expect(page.locator("#review-queue-feedback")).toContainText("deterministic triage order");

      const rowIds = page.locator("#review-queue-tbody tr[data-review-sub-id]");
      await expect(rowIds.first()).toBeVisible();
      const idsForTag = (await rowIds.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-review-sub-id")),
      )).filter((value): value is string => Boolean(value && value.startsWith("sub-rv-order-")));
      expect(idsForTag).toEqual([
        "sub-rv-order-high",
        "sub-rv-order-policy",
        "sub-rv-order-old",
        "sub-rv-order-new",
        "sub-rv-order-recent",
        "sub-rv-order-approved",
      ]);

      await page.getByLabel("Tag").fill(uniqueTag);
      await expect(page.locator("#review-queue-tbody tr[data-review-sub-id]")).toHaveCount(6);

      await page.getByLabel("State").selectOption("under_review");
      await expect(page.locator("#review-queue-tbody tr[data-review-sub-id]")).toHaveCount(5);
      const underReviewIds = (await page.locator("#review-queue-tbody tr[data-review-sub-id]").evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-review-sub-id")),
      )).filter((value): value is string => Boolean(value));
      expect(underReviewIds).toEqual([
        "sub-rv-order-high",
        "sub-rv-order-policy",
        "sub-rv-order-old",
        "sub-rv-order-new",
        "sub-rv-order-recent",
      ]);

      await page.getByLabel("Age").selectOption("8+");
      await expect(page.locator("#review-queue-tbody tr[data-review-sub-id]")).toHaveCount(2);
      const oldIds = (await page.locator("#review-queue-tbody tr[data-review-sub-id]").evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-review-sub-id")),
      )).filter((value): value is string => Boolean(value));
      expect(oldIds).toEqual([
        "sub-rv-order-high",
        "sub-rv-order-policy",
      ]);

      await page.getByLabel("Risk").selectOption("high");
      await expect(page.locator("#review-queue-tbody tr[data-review-sub-id]")).toHaveCount(2);
      const highRiskIds = (await page.locator("#review-queue-tbody tr[data-review-sub-id]").evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-review-sub-id")),
      )).filter((value): value is string => Boolean(value));
      expect(highRiskIds).toEqual([
        "sub-rv-order-high",
        "sub-rv-order-policy",
      ]);

      await page.getByLabel("Age").selectOption("");
      await page.getByLabel("Risk").selectOption("");
      await page.getByLabel("State").selectOption("approved");
      await expect(page.locator("#review-queue-tbody tr[data-review-sub-id]")).toHaveCount(1);
      const approvedIds = (await page.locator("#review-queue-tbody tr[data-review-sub-id]").evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-review-sub-id")),
      )).filter((value): value is string => Boolean(value));
      expect(approvedIds).toEqual([
        "sub-rv-order-approved",
      ]);
    } finally {
      await app.close();
    }
  });

  test("[RV-006] queue to detail artifact/QC summary load", async ({ request }) => {
    const { app, page, apiUrl, reviewerAccount } = await loginReviewerConsole();
    const uniqueTag = `rv-detail-${Date.now()}`;
    const submissionId = "sub-rv-detail-load";

    try {
      await createDraftAndTransition(request, {
        submissionId,
        creatorId: "creator-review-detail",
        toState: "under_review",
        actorId: "creator-review-detail",
        actorRole: "creator",
        expectedVersion: 0,
        baseUrl: apiUrl,
      });
      await setSubmissionTimestamps(submissionId, isoDaysAgo(4));
      await addReviewTag(request, apiUrl, submissionId, reviewerAccount.email, "reviewer", uniqueTag);
      await addReviewTag(request, apiUrl, submissionId, reviewerAccount.email, "reviewer", "artifact-ready");
      await addReviewFlag(request, apiUrl, submissionId, reviewerAccount.email, "reviewer", "risk-high", "high");

      const db = openReviewDb();
      try {
        const reportId = `qcrpt:${submissionId}:1`;
        const reportTime = isoDaysAgo(4, 1);
        db.prepare(
          `
          INSERT INTO qc_reports (
            report_id,
            submission_id,
            request_id,
            status,
            summary_json,
            rule_set_version,
            policy_version,
            applied_policy_id,
            generated_at,
            created_at,
            idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          reportId,
          submissionId,
          `qc-request-${submissionId}`,
          "completed",
          JSON.stringify({ blocking_failures: 1, warnings: 1, evaluated_rule_count: 12 }),
          "v1",
          1,
          "policy-v1",
          reportTime,
          reportTime,
          `qc-idem-${submissionId}`,
        );
        db.prepare(
          `
          INSERT INTO qc_findings (
            finding_id,
            report_id,
            rule_id,
            severity,
            blocking,
            status,
            message,
            remediation,
            context_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          `finding-${submissionId}`,
          reportId,
          "DEMO_NORMALIZATION_INVALID",
          "warning",
          0,
          "failed",
          "Demo peak should be normalized to -1.0dB.",
          "Normalize demo peak to -1.0dB.",
          JSON.stringify({ file: "Demo/example.mp3" }),
        );
      } finally {
        db.close();
      }

      await navigateViaNavHit(page, "reviewer-queue");
      await page.getByLabel("Tag").fill(uniqueTag);
      await expect(page.locator("#review-queue-tbody tr[data-review-sub-id]")).toHaveCount(1);

      await page.locator('[data-open-review-detail="sub-rv-detail-load"]').click();
      await expect(page.locator("#view-reviewer-decision")).toBeVisible();
      await expect(page.locator("#review-detail-feedback")).toContainText("Loaded review detail.");
      await expect(page.locator("#review-detail-pack-name")).toContainText("Pack sub-rv-detail-load");
      await expect(page.locator("#review-detail-sub-id")).toHaveText("sub-rv-detail-load");
      await expect(page.locator("#review-detail-state")).toContainText("under review");
      await expect(page.locator("#review-detail-qc")).toContainText("Demo peak should be normalized to -1.0dB.");
      await expect(page.locator("#review-detail-tags-list")).toContainText("artifact-ready");
      await expect(page.locator("#review-detail-flags-list")).toContainText("risk-high");
    } finally {
      await app.close();
    }
  });

  test("[RV-014][RV-015] reject success + in-flight button guards", async ({ request }) => {
    const { app, page, apiUrl, reviewerAccount } = await loginReviewerConsole();
    const submissionId = "sub-rv-reject-success";

    try {
      await createDraftAndTransition(request, {
        submissionId,
        creatorId: "creator-review-reject",
        toState: "under_review",
        actorId: "creator-review-reject",
        actorRole: "creator",
        expectedVersion: 0,
        baseUrl: apiUrl,
      });
      await setSubmissionTimestamps(submissionId, isoDaysAgo(3));
      await addReviewTag(request, apiUrl, submissionId, reviewerAccount.email, "reviewer", `rv-reject-${Date.now()}`);

      await navigateViaNavHit(page, "reviewer-queue");
      await page.locator(`[data-open-review-detail="${submissionId}"]`).click();
      await expect(page.locator("#view-reviewer-decision")).toBeVisible();
      await expect(page.getByRole("button", { name: "Reject submission" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve submission" })).toBeVisible();

      await page.getByRole("button", { name: "Reject submission" }).click();
      await expect(page.locator("#review-reject-modal")).toBeVisible();
      await page.getByLabel("Rejection reason code").selectOption("POLICY_VIOLATION");
      await page.getByLabel("Reviewer notes").fill("Policy violation requires corrective action.");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator("#review-confirm-modal")).toBeVisible();
      await page.getByRole("button", { name: "Confirm review decision" }).click();

      await expect(page.locator("#review-detail-state")).toContainText("rejected");
      await expect(page.getByRole("button", { name: "Approve submission" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Reject submission" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Re-open submission for amendment" })).toBeVisible();

      const db = openReviewDb();
      try {
        const decisionRow = db
          .prepare(
            "SELECT decision, reason_code, notes FROM review_decisions WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(submissionId);
        expect(decisionRow?.decision).toBe("REJECTED");
        expect(decisionRow?.reason_code).toBe("POLICY_VIOLATION");
        expect(decisionRow?.notes).toContain("Policy violation requires corrective action.");
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test("[RV-016][RV-017][RV-018] reopen visibility/action/guardrails", async ({ request }) => {
    const { app, page, apiUrl, reviewerAccount } = await loginReviewerConsole();
    const rejectedSubmissionId = "sub-rv-reopen-rejected";
    const approvedSubmissionId = "sub-rv-reopen-approved";

    try {
      await createDraftAndTransition(request, {
        submissionId: rejectedSubmissionId,
        creatorId: "creator-review-reopen-a",
        toState: "under_review",
        actorId: "creator-review-reopen-a",
        actorRole: "creator",
        expectedVersion: 0,
        baseUrl: apiUrl,
      });
      await setSubmissionTimestamps(rejectedSubmissionId, isoDaysAgo(6));
      await addReviewTag(request, apiUrl, rejectedSubmissionId, reviewerAccount.email, "reviewer", `rv-reopen-${Date.now()}`);
      await request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(rejectedSubmissionId)}/reject`, {
        data: {
          actor_id: reviewerAccount.email,
          actor_role: "reviewer",
          request_id: `reject-${rejectedSubmissionId}`,
          reason_code: "QUALITY_ISSUES",
          notes: "Needs amendment before approval.",
        },
      });

      await createDraftAndTransition(request, {
        submissionId: approvedSubmissionId,
        creatorId: "creator-review-reopen-b",
        toState: "under_review",
        actorId: "creator-review-reopen-b",
        actorRole: "creator",
        expectedVersion: 0,
        baseUrl: apiUrl,
      });
      await setSubmissionTimestamps(approvedSubmissionId, isoDaysAgo(2));
      await addReviewTag(request, apiUrl, approvedSubmissionId, reviewerAccount.email, "reviewer", `rv-reopen-${Date.now()}`);
      const approvedResponse = await request.post(
        `${apiUrl}/reviews/submissions/${encodeURIComponent(approvedSubmissionId)}/approve`,
        {
          data: {
            actor_id: reviewerAccount.email,
            actor_role: "reviewer",
            request_id: `approve-${approvedSubmissionId}`,
            notes: "Approved for reopen guard coverage.",
          },
        },
      );
      expect(approvedResponse.ok()).toBeTruthy();
      await setSubmissionTimestamps(approvedSubmissionId, isoDaysAgo(2));

      await navigateViaNavHit(page, "reviewer-queue");
      await page.locator(`[data-open-review-detail="${rejectedSubmissionId}"]`).click();
      await expect(page.locator("#view-reviewer-decision")).toBeVisible();
      await expect(page.getByRole("button", { name: "Re-open submission for amendment" })).toBeVisible();

      await page.getByRole("button", { name: "Re-open submission for amendment" }).click();
      await expect(page.locator("#review-confirm-modal")).toBeVisible();
      await page.getByRole("button", { name: "Confirm review decision" }).click();

      await expect(page.locator("#review-detail-feedback")).toContainText("Loaded review detail.");
      await expect(page.locator("#review-detail-state")).toContainText("draft");
      await expect(page.getByRole("button", { name: "Re-open submission for amendment" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Approve submission" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reject submission" })).toBeVisible();

      await page.locator(`[data-open-review-detail="${approvedSubmissionId}"]`).click();
      await expect(page.locator("#view-reviewer-decision")).toBeVisible();
      await expect(page.getByRole("button", { name: "Re-open submission for amendment" })).toBeHidden();

      const forbidden = await request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(approvedSubmissionId)}/reopen`, {
        data: {
          actor_id: reviewerAccount.email,
          actor_role: "reviewer",
          request_id: `reopen-denied-${approvedSubmissionId}`,
          notes: "Trying to reopen an approved submission.",
        },
      });
      expect(forbidden.status()).toBe(409);
      expect((await forbidden.json()).error.code).toBe("REVIEW_INVALID_STATE");
    } finally {
      await app.close();
    }
  });

  test("[RV-019][RV-020] terminal-state denial + idempotent decision race", async ({ request }) => {
    const { app, page, apiUrl, reviewerAccount } = await loginReviewerConsole();
    const terminalSubmissionId = "sub-rv-terminal-approval";
    const raceSubmissionId = "sub-rv-race-approval";

    try {
      await createDraftAndTransition(request, {
        submissionId: terminalSubmissionId,
        creatorId: "creator-review-terminal",
        toState: "under_review",
        actorId: "creator-review-terminal",
        actorRole: "creator",
        expectedVersion: 0,
        baseUrl: apiUrl,
      });
      await setSubmissionTimestamps(terminalSubmissionId, isoDaysAgo(2));
      await addReviewTag(request, apiUrl, terminalSubmissionId, reviewerAccount.email, "reviewer", `rv-terminal-${Date.now()}`);
      const terminalApprovedResponse = await request.post(
        `${apiUrl}/reviews/submissions/${encodeURIComponent(terminalSubmissionId)}/approve`,
        {
          data: {
            actor_id: reviewerAccount.email,
            actor_role: "reviewer",
            request_id: `approve-${terminalSubmissionId}`,
            notes: "Approved for terminal-state coverage.",
          },
        },
      );
      expect(terminalApprovedResponse.ok()).toBeTruthy();
      await setSubmissionTimestamps(terminalSubmissionId, isoDaysAgo(2));

      await navigateViaNavHit(page, "reviewer-queue");
      await page.locator(`[data-open-review-detail="${terminalSubmissionId}"]`).click();
      await expect(page.locator("#view-reviewer-decision")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve submission" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Reject submission" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Re-open submission for amendment" })).toBeHidden();

      const terminalApprove = await request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(terminalSubmissionId)}/approve`, {
        data: {
          actor_id: reviewerAccount.email,
          actor_role: "reviewer",
          request_id: `terminal-approve-${terminalSubmissionId}`,
          notes: "Should be denied because the submission is already approved.",
        },
      });
      expect(terminalApprove.status()).toBe(409);
      expect((await terminalApprove.json()).error.code).toBe("REVIEW_INVALID_STATE");

      const terminalReject = await request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(terminalSubmissionId)}/reject`, {
        data: {
          actor_id: reviewerAccount.email,
          actor_role: "reviewer",
          request_id: `terminal-reject-${terminalSubmissionId}`,
          reason_code: "QUALITY_ISSUES",
          notes: "Should be denied because the submission is already approved.",
        },
      });
      expect(terminalReject.status()).toBe(409);
      expect((await terminalReject.json()).error.code).toBe("REVIEW_INVALID_STATE");

      await createDraftAndTransition(request, {
        submissionId: raceSubmissionId,
        creatorId: "creator-review-race",
        toState: "under_review",
        actorId: "creator-review-race",
        actorRole: "creator",
        expectedVersion: 0,
        baseUrl: apiUrl,
      });
      await setSubmissionTimestamps(raceSubmissionId, isoDaysAgo(1));
      await addReviewTag(request, apiUrl, raceSubmissionId, reviewerAccount.email, "reviewer", `rv-race-${Date.now()}`);

      const requestId = `approve-race-${Date.now()}`;
      const [firstAttempt, secondAttempt] = await Promise.all([
        request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(raceSubmissionId)}/approve`, {
          data: {
            actor_id: reviewerAccount.email,
            actor_role: "reviewer",
            request_id: requestId,
            notes: "Race winner.",
          },
        }),
        request.post(`${apiUrl}/reviews/submissions/${encodeURIComponent(raceSubmissionId)}/approve`, {
          data: {
            actor_id: reviewerAccount.email,
            actor_role: "reviewer",
            request_id: requestId,
            notes: "Race loser.",
          },
        }),
      ]);

      const statuses = [firstAttempt.status(), secondAttempt.status()];
      expect(statuses.sort((left, right) => left - right)).toEqual([200, 409]);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);

      const db = openReviewDb();
      try {
        const decisions = db
          .prepare("SELECT decision, reviewer_id FROM review_decisions WHERE submission_id = ? ORDER BY created_at ASC")
          .all(raceSubmissionId);
        expect(decisions).toHaveLength(1);
        expect(decisions[0]?.decision).toBe("APPROVED");
        expect(decisions[0]?.reviewer_id).toBe(reviewerAccount.email);
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test("[RV-022] reviewer denied admin-only actions", async () => {
    const { app, page } = await loginReviewerConsole();

    try {
      await expect(page.locator('[data-testid="nav-admin-ops"]')).toBeHidden();

      await navigateViaNavHit(page, "admin-ops");
      await expect(page.locator("#view-admin-ops")).toBeVisible();
      await expect(page.locator("#admin-qc-feedback")).toContainText("Admin access required.");
      await expect(page.locator("#admin-config-feedback")).toContainText("Admin access required.");
      await expect(page.locator("#admin-integration-feedback")).toContainText("Admin access required.");
      await expect(page.locator("#admin-compliance-feedback")).toContainText("Admin access required.");

      await page.locator("#admin-policy-id-input").fill("reviewer-denied-policy");
      await page.locator("#admin-policy-ruleset-input").fill("2026.03.reviewer-denied");
      await page.locator("#admin-policy-reason-input").fill("Reviewer is not authorized to modify policy.");
      await page.locator("#admin-qc-save-policy").click();

      await expect(page.locator("#admin-qc-feedback")).toContainText("Admin access required.");
      await expect(page.locator("#admin-policy-version-badge")).toContainText("Policy v—");
    } finally {
      await app.close();
    }
  });
});
