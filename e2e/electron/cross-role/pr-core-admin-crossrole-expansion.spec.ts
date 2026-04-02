import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildActorHeaders } from "../../test-utils/authContext";
import {
  getSeededAccount,
  installRendererApiShim,
  launchDesktop,
  loginViaUi,
  logoutCurrentUser,
  navigateViaNavHit,
} from "../support";

test.describe.configure({ timeout: 180_000 });

const execFileAsync = promisify(execFile);
const VALID_PACK_FIXTURE_ROOT = path.resolve("e2e/fixtures/valid_pack");
const STRICT_QC_TARGET_DB = "-1.0";
const STRICT_QC_TOLERANCE_DB = "0.2";

type Role = "admin" | "creator" | "reviewer";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mimeTypeForFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain";
    case ".csv":
      return "text/csv";
    case ".zip":
      return "application/zip";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

async function collectFolderSelection(rootPath: string): Promise<{
  path: string;
  fileCount: number;
  topLevelFolders: string[];
  files: Array<{ relativePath: string; sizeBytes: number; mimeType: string }>;
}> {
  const topLevelFolders = new Set<string>();
  const files: Array<{ relativePath: string; sizeBytes: number; mimeType: string }> = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (depth === 0) {
          topLevelFolders.add(entry.name);
        }
        await walk(absolutePath, depth + 1);
        continue;
      }
      const stats = await fs.stat(absolutePath);
      files.push({
        relativePath,
        sizeBytes: stats.size,
        mimeType: mimeTypeForFileName(entry.name),
      });
      if (depth === 0) {
        const folderName = relativePath.split("/")[0];
        if (folderName) {
          topLevelFolders.add(folderName);
        }
      }
    }
  }

  await walk(rootPath, 0);

  return {
    path: rootPath,
    fileCount: files.length,
    topLevelFolders: Array.from(topLevelFolders).sort(),
    files,
  };
}

async function createStrictPackFixture(prefix: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  await fs.cp(VALID_PACK_FIXTURE_ROOT, tempRoot, { recursive: true });

  const sourceDemo = path.join(tempRoot, "Demo", "demo.mp3");
  const tunedDemo = path.join(tempRoot, "Demo", "demo.strict.mp3");
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    sourceDemo,
    "-filter:a",
    "volume=-0.7dB",
    tunedDemo,
  ]);
  await fs.rm(sourceDemo, { force: true });
  await fs.rename(tunedDemo, sourceDemo);
  return tempRoot;
}

async function syncRuntimeActorContext(page: Page, role: Role, actorId: string): Promise<void> {
  await page.evaluate(
    ({ nextActorId, nextActorRole }) => {
      const runtimeGlobal = globalThis as any;
      runtimeGlobal.__pwE2EActorContext = {
        ...(runtimeGlobal.__pwE2EActorContext ?? {}),
        actorId: nextActorId,
        actorRole: nextActorRole,
      };

      if (runtimeGlobal.reviewConsoleStore?.setActor) {
        try {
          runtimeGlobal.reviewConsoleStore.setActor({ id: nextActorId, roles: [nextActorRole] });
        } catch {
          // Ignore state sync issues in teardown transitions.
        }
      }

      if (runtimeGlobal.adminPage?.setActor) {
        try {
          runtimeGlobal.adminPage.setActor({ id: nextActorId, roles: [nextActorRole] });
        } catch {
          // Ignore state sync issues in teardown transitions.
        }
      }
    },
    { nextActorId: actorId, nextActorRole: role },
  );
}

async function loginAsRole(page: Page, role: Role): Promise<void> {
  const { email, password } = getSeededAccount(role);
  await loginViaUi(page, { email, password, expectedRole: role });
  await syncRuntimeActorContext(page, role, email);
}

async function switchRoleInSameSession(page: Page, role: Role): Promise<void> {
  await logoutCurrentUser(page);
  await loginAsRole(page, role);
}

async function patchPackSelection(page: Page, selection: Awaited<ReturnType<typeof collectFolderSelection>>): Promise<void> {
  await page.evaluate((folderSelection) => {
    const patch = (api: any): void => {
      if (!api?.intake) {
        return;
      }
      api.intake.selectFolder = async () => ({ ok: true, data: folderSelection });
    };

    patch((window as any).splice);
    patch((window as any).electronAPI);
  }, selection);
}

async function patchLinkedAirtableSync(
  page: Page,
  options: {
    submissionId: string;
    packName: string;
    labelName: string;
    releaseMonth: string;
    notes: string;
    tags: string[];
  },
): Promise<void> {
  await page.evaluate((payload) => {
    const patch = (api: any): void => {
      if (!api?.submissions) {
        return;
      }
      api.submissions.syncAirtable = async ({ submissionId }: any) => ({
        ok: true,
        data: {
          submissionId,
          syncStatus: "linked",
          airtableFormCompleted: true,
          airtablePayloadChecksum: `${payload.submissionId}-checksum`,
          airtableRecordId: `rec-${payload.submissionId}`,
          airtableRecordUrl: `https://airtable.example/${payload.submissionId}`,
          lastSyncedAt: "2026-03-31T10:00:00Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          canonicalRecordId: `canonical-${payload.submissionId}`,
          mappedPayload: {
            labelName: payload.labelName,
            packName: payload.packName,
            releaseMonth: payload.releaseMonth,
            notes: payload.notes,
            tags: payload.tags,
          },
        },
      });
    };

    patch((window as any).splice);
    patch((window as any).electronAPI);
  }, options);
}

async function seedCreatorDraft(
  request: APIRequestContext,
  baseUrl: string,
  options: {
    submissionId: string;
    creatorId: string;
    packName: string;
    labelName: string;
    releaseMonth: string;
    notes: string;
    tags: string[];
  },
): Promise<void> {
  const headers = buildActorHeaders({ actorId: options.creatorId, actorRoles: "creator" });

  const draftResponse = await request.post(`${baseUrl}/submissions/draft`, {
    headers,
    data: {
      submission_id: options.submissionId,
      creator_id: options.creatorId,
      preferred_release_month: options.releaseMonth,
      metadata: {
        pack_name: options.packName,
        label_name: options.labelName,
        notes: options.notes,
        tags: options.tags,
      },
    },
  });
  expect(draftResponse.ok()).toBeTruthy();

  const creatorDraftResponse = await request.post(`${baseUrl}/creator/submissions/draft`, {
    headers,
    data: {
      submission_id: options.submissionId,
      creator_id: options.creatorId,
      pack_name: options.packName,
      label_name: options.labelName,
      release_month: options.releaseMonth,
      notes: options.notes,
      tags: options.tags,
      airtable_form_completed: true,
      airtable_payload_checksum: `${options.submissionId}-checksum`,
      autosave_json: {
        packName: options.packName,
        labelName: options.labelName,
        releaseMonth: options.releaseMonth,
        notes: options.notes,
        tags: options.tags,
      },
    },
  });
  expect(creatorDraftResponse.ok()).toBeTruthy();
}

async function seedUnderReviewSubmission(
  request: APIRequestContext,
  baseUrl: string,
  options: {
    submissionId: string;
    creatorId: string;
    packName: string;
    labelName: string;
    releaseMonth: string;
    notes: string;
    tags: string[];
  },
): Promise<void> {
  await seedCreatorDraft(request, baseUrl, options);

  const creatorHeaders = buildActorHeaders({ actorId: options.creatorId, actorRoles: "creator" });
  const transitionResponse = await request.post(`${baseUrl}/submissions/${encodeURIComponent(options.submissionId)}/transition`, {
    headers: creatorHeaders,
    data: {
      request_id: `${options.submissionId}-under-review`,
      to_state: "under_review",
      actor_id: options.creatorId,
      actor_role: "creator",
      reason: "Submitted for review",
      expected_version: 0,
      metadata: {},
    },
  });
  expect(transitionResponse.ok()).toBeTruthy();
}

async function openCreatorSubmission(page: Page, submissionId: string): Promise<void> {
  await navigateViaNavHit(page, "submissions");
  await expect(page.locator("#view-submissions")).toBeVisible();
  const openButton = page.locator(`[data-workspace-open="${submissionId}"]`);
  await expect(openButton).toBeVisible({ timeout: 20_000 });
  await openButton.click();
  await expect(page.locator("#workspace-lifecycle-banner")).toBeVisible();
}

async function openReviewerSubmission(page: Page, submissionId: string): Promise<void> {
  await navigateViaNavHit(page, "reviewer-queue");
  await expect(page.locator("#view-reviewer-queue")).toBeVisible();
  await page.locator("#review-queue-refresh").click();
  const openButton = page.locator(`[data-open-review-detail="${submissionId}"]`);
  await expect(openButton).toBeVisible({ timeout: 20_000 });
  await openButton.click();
  await expect(page.locator("#review-detail-sub-id")).toHaveText(submissionId);
  await expect(page.locator("#review-detail-state")).toBeVisible();
}

async function rejectReviewerSubmission(
  page: Page,
  submissionId: string,
  reasonCode: string,
  notes: string,
): Promise<void> {
  await openReviewerSubmission(page, submissionId);
  await page.locator("#review-action-reject").click();
  await expect(page.locator("#review-reject-modal")).toBeVisible();
  await page.locator("#review-reject-reason").selectOption(reasonCode);
  await page.locator("#review-reject-notes").fill(notes);
  await page.locator("#review-reject-submit").click();
  await expect(page.locator("#review-confirm-modal")).toBeVisible();
  await page.locator("#review-confirm-submit").click();
  await expect(page.locator("#review-confirm-modal")).toBeHidden();
}

async function reopenReviewerSubmission(page: Page, submissionId: string): Promise<void> {
  await openReviewerSubmission(page, submissionId);
  await page.locator("#review-action-reopen").click();
  await expect(page.locator("#review-confirm-modal")).toBeVisible();
  await page.locator("#review-confirm-submit").click();
  await expect(page.locator("#review-confirm-modal")).toBeHidden();
}

async function approveReviewerSubmission(page: Page, submissionId: string): Promise<void> {
  await openReviewerSubmission(page, submissionId);
  await page.locator("#review-action-approve").click();
  await expect(page.locator("#review-confirm-modal")).toBeVisible();
  await page.locator("#review-confirm-submit").click();
  await expect(page.locator("#review-confirm-modal")).toBeHidden();
}

async function completeAirtableAndQc(page: Page): Promise<void> {
  await page.locator("#workspace-airtable-complete").click();
  await expect(page.locator("#workspace-airtable-status")).toContainText(/linked/i);
  await page.locator("#workspace-run-qc").click();
}

async function saveAdminPolicy(page: Page): Promise<void> {
  await navigateViaNavHit(page, "admin-ops");
  await expect(page.locator("#view-admin-ops")).toBeVisible();
  await page.locator("#admin-policy-id-input").fill("default-wave2-policy");
  await page.locator("#admin-policy-ruleset-input").fill("2026.03.tighten-normalization");
  await page.locator("#admin-policy-reason-input").fill("Tighten normalization tolerance for cross-role coverage");
  await page.locator("#admin-policy-normalization-target-input").fill(STRICT_QC_TARGET_DB);
  await page.locator("#admin-policy-normalization-tolerance-input").fill(STRICT_QC_TOLERANCE_DB);
  await page.locator("#admin-policy-normalization-strict-input").check();
  await page.locator("#admin-qc-save-policy").click();
  await expect(page.locator("#admin-qc-feedback")).toContainText("Policy saved to version");
  await expect(page.locator("#admin-policy-version-badge")).toHaveText(/Policy v\d+/);
}

async function openAdminComplianceAudit(page: Page): Promise<void> {
  await page.locator('[data-admin-tab="compliance"]').click();
  await page.locator("#admin-compliance-action").fill("qc.policy.updated.v1");
  await page.locator("#admin-compliance-refresh").click();
  await expect(page.locator("#admin-compliance-feedback")).toContainText(/Loaded \d+ audit events/);
  await expect(page.locator("#admin-compliance-events-body")).toContainText("qc.policy.updated.v1");
}

test.describe("Admin and cross-role PR-core expansion scenarios", () => {
  test("[AD-001][AD-002] admin access and non-admin denial", async () => {
    const admin = getSeededAccount("admin");
    const { app, page, apiUrl } = await launchDesktop({ actorId: admin.email, actorRoles: "admin" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginAsRole(page, "admin");
      await navigateViaNavHit(page, "admin-ops");
      await expect(page.locator("#view-admin-ops")).toBeVisible();
      await expect(page.locator("#admin-policy-version-badge")).toBeVisible();

      await switchRoleInSameSession(page, "creator");
      await expect(page.locator("#sidebar-primary-nav [data-nav=\"admin-ops\"]")).toHaveCount(0);
      await expect(page.locator("#view-admin-ops")).toBeHidden();
      await expect(page.locator("#sidebar-role-badge")).toHaveText("CREATOR");
    } finally {
      await app.close();
    }
  });

  test("[AD-004][AD-007][AD-008][AD-009] policy draft/publish/audit/activation behavior", async () => {
    const admin = getSeededAccount("admin");
    const { app, page, apiUrl } = await launchDesktop({ actorId: admin.email, actorRoles: "admin" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginAsRole(page, "admin");
      await saveAdminPolicy(page);
      await openAdminComplianceAudit(page);
    } finally {
      await app.close();
    }
  });

  test("[XR-001] publish stricter policy then creator sees new QC gate", async ({ request }) => {
    const creator = getSeededAccount("creator");
    const submissionId = uniqueId("xr-001-sub");
    const strictPackDir = await createStrictPackFixture("pr59-xr-001");
    const selection = await collectFolderSelection(strictPackDir);
    const { app, page, apiUrl } = await launchDesktop({ actorId: creator.email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await seedCreatorDraft(request, apiUrl, {
        submissionId,
        creatorId: creator.email,
        packName: "Wave 2 Strict Pack",
        labelName: "Wave 2 Label",
        releaseMonth: "2026-04",
        notes: "Strict policy expansion baseline",
        tags: ["wave2", "strict"],
      });
      await patchPackSelection(page, selection);
      await patchLinkedAirtableSync(page, {
        submissionId,
        packName: "Wave 2 Strict Pack",
        labelName: "Wave 2 Label",
        releaseMonth: "2026-04",
        notes: "Strict policy expansion baseline",
        tags: ["wave2", "strict"],
      });

      await loginAsRole(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await completeAirtableAndQc(page);
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: passed with no blocking findings.");
      await expect(page.locator("#workspace-readiness-summary")).toContainText("All checks passed. Next step: click Submit for Review.");

      await switchRoleInSameSession(page, "admin");
      await saveAdminPolicy(page);

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await page.locator("#workspace-select-pack-folder").click();
      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: blocking findings found. Resolve them and rerun QC.");
      await expect(page.locator("#workspace-remediation-items")).toContainText("DEMO_NORMALIZATION_INVALID");
      await expect(page.locator("#workspace-readiness-summary")).toContainText("Submit is blocked by");
    } finally {
      await fs.rm(strictPackDir, { recursive: true, force: true });
      await app.close();
    }
  });

  test("[XR-005][XR-006] reject then reopen chain with same-session role switches", async ({ request }) => {
    const creator = getSeededAccount("creator");
    const submissionId = uniqueId("xr-005-sub");
    const { app, page, apiUrl } = await launchDesktop({ actorId: creator.email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await seedUnderReviewSubmission(request, apiUrl, {
        submissionId,
        creatorId: creator.email,
        packName: "Wave 2 Lifecycle Pack",
        labelName: "Wave 2 Label",
        releaseMonth: "2026-04",
        notes: "Rejection and reopen chain",
        tags: ["review", "chain"],
      });

      await loginAsRole(page, "creator");
      await switchRoleInSameSession(page, "reviewer");
      await rejectReviewerSubmission(page, submissionId, "POLICY_VIOLATION", "The pack needs an approved description and folder check.");
      await expect(page.locator("#review-detail-state")).toContainText("rejected");

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Rejected: waiting for reviewer/admin reopen");
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText(
        "wait for state to return to draft; then continue this submission, update files/metadata, run QC if needed, and submit again.",
      );
      await expect(page.locator("#view-submissions")).toContainText("Latest Rejection Detail");

      await switchRoleInSameSession(page, "reviewer");
      await reopenReviewerSubmission(page, submissionId);

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Reopened for amendment");
      await expect(page.locator("#workspace-reopen-edit")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[XR-009] reviewer rejection reason routes creator to deterministic next action", async ({ request }) => {
    const creator = getSeededAccount("creator");
    const submissionId = uniqueId("xr-009-sub");
    const { app, page, apiUrl } = await launchDesktop({ actorId: creator.email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await seedUnderReviewSubmission(request, apiUrl, {
        submissionId,
        creatorId: creator.email,
        packName: "Wave 2 Next Action Pack",
        labelName: "Wave 2 Label",
        releaseMonth: "2026-04",
        notes: "Route creator to the next concrete step",
        tags: ["next-step"],
      });

      await loginAsRole(page, "creator");
      await switchRoleInSameSession(page, "reviewer");
      await rejectReviewerSubmission(page, submissionId, "METADATA_MISSING", "Add the missing metadata before resubmitting.");

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Rejected: waiting for reviewer/admin reopen");
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText(
        "wait for state to return to draft; then continue this submission, update files/metadata, run QC if needed, and submit again.",
      );
      await expect(page.locator("#view-submissions")).toContainText("Reason: Metadata Missing");
      await expect(page.locator("#view-submissions")).toContainText("Add the missing metadata before resubmitting.");
    } finally {
      await app.close();
    }
  });

  test("[XR-015][XR-021] long-chain role-switch consistency and rejection recovery happy path", async ({ request }) => {
    const creator = getSeededAccount("creator");
    const submissionId = uniqueId("xr-015-sub");
    const strictPackDir = await createStrictPackFixture("pr59-xr-015");
    const selection = await collectFolderSelection(strictPackDir);
    const { app, page, apiUrl } = await launchDesktop({ actorId: creator.email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await seedUnderReviewSubmission(request, apiUrl, {
        submissionId,
        creatorId: creator.email,
        packName: "Wave 2 Recovery Pack",
        labelName: "Wave 2 Label",
        releaseMonth: "2026-04",
        notes: "Recovery happy path after rejection",
        tags: ["recovery", "happy-path"],
      });
      await patchPackSelection(page, selection);
      await patchLinkedAirtableSync(page, {
        submissionId,
        packName: "Wave 2 Recovery Pack",
        labelName: "Wave 2 Label",
        releaseMonth: "2026-04",
        notes: "Recovery happy path after rejection",
        tags: ["recovery", "happy-path"],
      });

      await loginAsRole(page, "creator");
      await switchRoleInSameSession(page, "reviewer");
      await rejectReviewerSubmission(page, submissionId, "QUALITY_ISSUES", "The demo mix needs to be normalized before approval.");

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Rejected: waiting for reviewer/admin reopen");

      await switchRoleInSameSession(page, "reviewer");
      await reopenReviewerSubmission(page, submissionId);

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Reopened for amendment");
      await page.locator("#workspace-reopen-edit").click();
      await page.locator("#workspace-select-pack-folder").click();
      await completeAirtableAndQc(page);
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: passed with no blocking findings.");
      await expect(page.locator("#workspace-readiness-summary")).toContainText("All checks passed. Next step: click Submit for Review.");
      await page.locator("#workspace-submit-review").click();
      await expect(page.locator("#workspace-feedback")).toContainText(/ready for review handoff|Dropbox|unavailable|handoff/i);

      await switchRoleInSameSession(page, "reviewer");
      await approveReviewerSubmission(page, submissionId);

      await switchRoleInSameSession(page, "creator");
      await openCreatorSubmission(page, submissionId);
      await expect(page.locator("#view-submissions")).toContainText(/approved/i);
      await expect(page.locator(".fe-status-chip.approved")).toBeVisible();
    } finally {
      await fs.rm(strictPackDir, { recursive: true, force: true });
      await app.close();
    }
  });
});
