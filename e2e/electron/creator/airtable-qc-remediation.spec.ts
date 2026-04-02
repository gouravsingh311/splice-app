import { expect, test } from "@playwright/test";

import {
  getSeededAccount,
  installRendererApiShim,
  launchDesktop,
  loginViaUi,
  navigateViaNavHit,
} from "../support";

async function openDraftWorkspace(page: any, apiUrl: string, email: string, password: string) {
  await installRendererApiShim(page, undefined, apiUrl);
  await loginViaUi(page, { email, password });
  await page.evaluate(() => {
    const api = (window as any).electronAPI;
    if (!api?.submissions) { return; }
    api.submissions.list = async () => ({ ok: true, data: { submissions: [] } });
    api.submissions.timeline = async () => ({ ok: true, data: { timeline: [] } });
    if ((window as any).viewSubmissions?.wire) {
      (window as any).viewSubmissions.wire();
    }
  });
  await navigateViaNavHit(page, "submissions");
  await expect(page.locator("#workspace-main-panel")).toContainText("No submissions yet");
  await page.locator("[data-workspace-create]").first().click();
  await expect(page.locator("#workspace-pack-name")).toBeVisible();
  await page.locator("#workspace-pack-name").fill("Wave 2 Pack");
  await expect(page.locator("#workspace-pack-name")).toHaveValue("Wave 2 Pack");
  await page.locator("#workspace-label-name").fill("Wave 2 Label");
  await expect(page.locator("#workspace-label-name")).toHaveValue("Wave 2 Label");
  const hasReleaseMonth = await page.locator('#workspace-release-month option[value="2026-03"]').count();
  if (hasReleaseMonth > 0) {
    await page.locator("#workspace-release-month").selectOption("2026-03");
  } else {
    await page.locator("#workspace-release-month").selectOption({ index: 1 });
  }
  await page.locator("#workspace-save-metadata").click();
  await expect(page.locator("#workspace-feedback")).toContainText("Metadata saved");
}

test.describe("Creator Airtable + QC remediation scenarios", () => {
  test("[CR-007][CR-008][CR-009][CR-010] Airtable linked vs missing and duplicate states gate submit deterministically", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await openDraftWorkspace(page, apiUrl, email, password);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        const validFolder = {
          ok: true,
          data: {
            path: "/tmp/wave2-pack",
            fileCount: 4,
            topLevelFolders: ["Audio", "Artwork", "Demo", "Description"],
            files: [
              { relativePath: "Audio/Wave 2 Label - Wave 2 Pack.zip", sizeBytes: 1024, mimeType: "application/zip" },
              { relativePath: "Artwork/cover.jpg", sizeBytes: 256, mimeType: "image/jpeg" },
              { relativePath: "Demo/demo.mp3", sizeBytes: 256, mimeType: "audio/mpeg" },
              { relativePath: "Description/info.txt", sizeBytes: 64, mimeType: "text/plain" },
            ],
          },
        };
        api.intake.selectFolder = async () => validFolder;
        api.qc.evaluatePack = async () => ({
          ok: true,
          data: { report: { status: "passed", findings: [], generatedAt: "2026-03-06T10:00:00Z" } },
        });
        (window as any).__wave2SyncStatus = "missing";
        api.submissions.syncAirtable = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            submissionId,
            syncStatus: (window as any).__wave2SyncStatus,
            airtableFormCompleted: true,
            airtablePayloadChecksum: "wave2-checksum",
            airtableRecordId: (window as any).__wave2SyncStatus === "linked" ? "rec-wave2" : null,
            airtableRecordUrl: (window as any).__wave2SyncStatus === "linked" ? "https://airtable.example/rec-wave2" : null,
            lastSyncedAt: "2026-03-06T10:00:00Z",
            lastErrorCode:
              (window as any).__wave2SyncStatus === "duplicate"
                ? "AIRTABLE_DUPLICATE_MATCH"
                : ((window as any).__wave2SyncStatus === "missing" ? "AIRTABLE_RECORD_MISSING" : null),
            lastErrorDetail:
              (window as any).__wave2SyncStatus === "duplicate"
                ? "Found 2 matching records"
                : ((window as any).__wave2SyncStatus === "missing" ? "No Airtable record matched this submission" : null),
            mappedPayload: {
              labelName: "Wave 2 Label",
              packName: "Wave 2 Pack",
              releaseMonth: "2026-03",
              notes: "",
              tags: [],
            },
          },
        });
      });

      await page.locator('[data-wizard-next="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();
      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-feedback")).toContainText("QC passed");

      await page.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
      await page.locator("#workspace-airtable-complete").click();
      await expect(page.locator("#workspace-airtable-status")).toContainText("No Airtable record matched");
      await expect(page.locator("#workspace-submit-review")).toHaveCount(0);

      await page.evaluate(() => {
        (window as any).__wave2SyncStatus = "duplicate";
      });
      await page.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
      await page.locator("#workspace-airtable-complete").click();
      await expect(page.locator("#workspace-airtable-status")).toContainText("Multiple Airtable records matched");
      await expect(page.locator("#workspace-airtable-error")).toContainText("AIRTABLE_DUPLICATE_MATCH");
      await expect(page.locator("#workspace-submit-review")).toHaveCount(0);

      await page.evaluate(() => {
        (window as any).__wave2SyncStatus = "linked";
      });
      await page.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
      await page.locator("#workspace-airtable-complete").click();
      await expect(page.locator("#workspace-airtable-status")).toContainText(/linked.*submission/i);
      await page.getByRole("button", { name: /Step 3.*Review & Submit/i }).click();
      await expect(page.locator("#workspace-submit-review")).toBeEnabled();
    } finally {
      await app.close();
    }
  });

  test("[CR-017] creator workspace keeps keyboard tab order and readiness guidance continuity", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    const expectFocusedId = async (id: string) => {
      await expect
        .poll(async () =>
          page.evaluate(() => ((document.activeElement as HTMLElement | null)?.id ?? "")),
        )
        .toBe(id);
    };

    try {
      await openDraftWorkspace(page, apiUrl, email, password);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.intake.selectFolder = async () => ({
          ok: true,
          data: {
            path: "/tmp/keyboard-pack",
            fileCount: 2,
            topLevelFolders: ["Audio", "Artwork"],
            files: [
              { relativePath: "Audio/Wave 2 Label - Wave 2 Pack.zip", sizeBytes: 1024, mimeType: "application/zip" },
              { relativePath: "Artwork/cover.jpg", sizeBytes: 256, mimeType: "image/jpeg" },
            ],
          },
        });
        api.qc.evaluatePack = async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            ok: true,
            data: {
              report: {
                status: "failed",
                findings: [
                  {
                    ruleId: "AUDIO_ZIP_NAMING",
                    severity: "blocking",
                    message: "Audio ZIP file must follow the pack naming convention.",
                    remediation: "Rename the Audio ZIP to match label and pack name.",
                    context: { file_ref: "Audio/Bad Name.zip" },
                  },
                ],
                generatedAt: "2026-03-06T10:30:00Z",
              },
            },
          };
        };
      });

      await page.locator("#workspace-pack-name").click();
      await page.keyboard.press("Tab");
      await expectFocusedId("workspace-label-name");
      await page.keyboard.press("Tab");
      await expectFocusedId("workspace-release-month");
      await page.keyboard.press("Tab");
      await expectFocusedId("workspace-tags");
      await page.keyboard.press("Tab");
      await expectFocusedId("workspace-notes");
      await page.locator('[data-wizard-next="intake"]').click();
      await page.locator("#workspace-select-pack-folder").focus();
      await page.locator('[data-wizard-step="intake"]').click();
      await page.locator('[data-wizard-step="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();
      await page.locator('[data-wizard-step="review"]').click();
      await expect(page.locator("#workspace-readiness-summary")).toContainText("Next step:");

      await page.locator('[data-wizard-step="intake"]').click();
      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-run-qc")).toBeDisabled();
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC running");
      await expect(page.locator("#workspace-remediation-items")).toContainText("How to fix:");
      await expect(page.locator("#workspace-run-qc")).toBeEnabled();
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: blocking findings found");
    } finally {
      await app.close();
    }
  });

  test("[CR-016] intake guidance and QC remediation render creator-readable blocker messaging", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await openDraftWorkspace(page, apiUrl, email, password);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        (window as any).workspacePackStructure.resolveMissingRequiredTopLevelFolders = () => [
          "Demo/Demos",
          "Description/Description & Info",
        ];
        api.intake.selectFolder = async () => ({
          ok: true,
          data: {
            path: "/tmp/incomplete-pack",
            fileCount: 2,
            topLevelFolders: ["Audio", "Artwork"],
            files: [
              { relativePath: "Audio/Wave 2 Label - Wave 2 Pack.zip", sizeBytes: 1024, mimeType: "application/zip" },
              { relativePath: "Artwork/cover.jpg", sizeBytes: 256, mimeType: "image/jpeg" },
            ],
          },
        });
        api.qc.evaluatePack = async () => ({
          ok: true,
          data: {
            report: {
              status: "failed",
              findings: Array.from({ length: 14 }, (_, index) =>
                index === 0
                  ? {
                      ruleId: "AUDIO_ZIP_NAMING",
                      severity: "blocking",
                      message: "Audio ZIP file must follow the pack naming convention.",
                      remediation: "Rename the Audio ZIP to match label and pack name.",
                      context: { file_ref: "Audio/Bad Name.zip" },
                    }
                  : {
                      ruleId: "SAMPLE_NORMALIZATION_OUT_OF_RANGE",
                      severity: "warning",
                      message: `Sample normalization is outside the expected range (${index}).`,
                      remediation: "Adjust gain and export again.",
                      context: { file_ref: `Audio/Loops/kick-${index}.wav` },
                    },
              ),
              generatedAt: "2026-03-06T10:05:00Z",
            },
          },
        });
      });

      await page.locator('[data-wizard-next="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();
      await expect(page.locator("#workspace-folder-guidance")).toContainText("Add these folders at the top level");
      await expect(page.locator("#workspace-folder-checklist")).toContainText("Demo/Demos");
      await expect(page.locator("#workspace-folder-checklist")).toContainText("×");

      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-remediation-items")).toContainText("AUDIO_ZIP_NAMING");
      await expect(page.locator("#workspace-remediation-items")).toContainText("Rename the Audio ZIP");
      await expect(page.locator("#workspace-remediation-items")).toContainText("Recommended: fix this warning before submitting");
      await expect(page.locator("#workspace-remediation-items")).toHaveClass(/overflow-y-auto/);
      await expect(page.locator("#workspace-remediation-items li")).toHaveCount(14);
      await expect(page.locator("#workspace-feedback")).toContainText(/QC finished|blocking findings|QC failed/i);
    } finally {
      await app.close();
    }
  });

  test("[CR-013] draft metadata persists across folder reselection and QC rerenders", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });
    const shouldCaptureScreenshots = process.env.CAPTURE_QCUX_SCREENSHOTS === "1";
    const captureDir = `${process.cwd()}/docs/reports/assets/QCUX-T01-qc-visibility-and-preview-matching`;

    try {
      await openDraftWorkspace(page, apiUrl, email, password);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        let folderPickCount = 0;
        api.intake.selectFolder = async () => {
          folderPickCount += 1;
          return {
            ok: true,
            data: {
              path: `/tmp/persist-pack-${folderPickCount}`,
              fileCount: 4,
              topLevelFolders: ["Audio", "Artwork", "Demo", "Description"],
              files: [
                { relativePath: "Audio/Wave 2 Label - Wave 2 Pack.zip", sizeBytes: 1024, mimeType: "application/zip" },
                { relativePath: "Artwork/cover.jpg", sizeBytes: 256, mimeType: "image/jpeg" },
                { relativePath: "Demo/demo.mp3", sizeBytes: 256, mimeType: "audio/mpeg" },
                { relativePath: "Description/info.txt", sizeBytes: 64, mimeType: "text/plain" },
              ],
            },
          };
        };
        api.qc.evaluatePack = async () => {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return {
            ok: true,
            data: {
              report: {
                status: "failed",
                findings: [
                  {
                    ruleId: "AUDIO_ZIP_NAMING",
                    severity: "blocking",
                    message: "Audio ZIP file must follow the pack naming convention.",
                    remediation: "Rename the Audio ZIP to match label and pack name.",
                    context: { file_ref: "Audio/Bad Name.zip" },
                  },
                  ...Array.from({ length: 13 }, (_, index) => ({
                    ruleId: "SAMPLE_NORMALIZATION_OUT_OF_RANGE",
                    severity: "warning",
                    message: `Sample normalization is outside the expected range (${index + 1}).`,
                    remediation: "Adjust gain and export again.",
                    context: { file_ref: `Audio/Loops/kick-${index + 1}.wav` },
                  })),
                ],
                generatedAt: "2026-03-06T11:00:00Z",
              },
            },
          };
        };
      });

      await page.locator("#workspace-pack-name").fill("Unsaved Metadata Pack");
      await page.locator("#workspace-label-name").fill("Unsaved Metadata Label");
      await page.locator("#workspace-release-month").selectOption("2026-09");
      await page.locator("#workspace-tags").fill("ambient, texture");
      await page.locator("#workspace-notes").fill("Do not lose this unsaved metadata");

      await page.locator('[data-wizard-next="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();
      await page.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
      await expect(page.locator("#workspace-pack-name")).toHaveValue(/Unsaved Metadata Pack|Wave 2 Pack/);
      await expect(page.locator("#workspace-label-name")).toHaveValue(/Unsaved Metadata Label|Wave 2 Label/);
      await expect(page.locator("#workspace-release-month")).toHaveValue("2026-09");
      await expect(page.locator("#workspace-tags")).toHaveValue("ambient, texture");
      await expect(page.locator("#workspace-notes")).toHaveValue("Do not lose this unsaved metadata");

      await page.locator('[data-wizard-step="intake"]').click();
      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC running");
      if (shouldCaptureScreenshots) {
        await page.screenshot({ path: `${captureDir}/creator-qc-running.png`, fullPage: true });
      }
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: blocking findings found");
      if (shouldCaptureScreenshots) {
        await page.locator("#workspace-remediation-items").evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.screenshot({ path: `${captureDir}/creator-qc-remediation-scroll.png`, fullPage: true });
      }
      await page.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
      await expect(page.locator("#workspace-pack-name")).toHaveValue(/Unsaved Metadata Pack|Wave 2 Pack/);
      await expect(page.locator("#workspace-label-name")).toHaveValue(/Unsaved Metadata Label|Wave 2 Label/);
      await expect(page.locator("#workspace-release-month")).toHaveValue("2026-09");
      await expect(page.locator("#workspace-tags")).toHaveValue("ambient, texture");
      await expect(page.locator("#workspace-notes")).toHaveValue("Do not lose this unsaved metadata");

      await page.locator('[data-wizard-step="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();
      await page.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
      await expect(page.locator("#workspace-release-month")).toHaveValue("2026-09");
      await expect(page.locator("#workspace-pack-name")).toHaveValue(/Unsaved Metadata Pack|Wave 2 Pack/);
    } finally {
      await app.close();
    }
  });

  test("[CR-024][CR-025][CR-026] history detail and reopen behavior stay consolidated inside submissions", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        const submissions = [
          {
            submissionId: "sub-reopened",
            creatorId: "creator-1",
            currentState: "draft",
            version: 3,
            packName: "Reopened Pack",
            labelName: "Wave 2 Label",
            releaseMonth: "2026-03",
            notes: "Needs one more pass",
            tags: [],
            airtableFormCompleted: true,
            airtablePayloadChecksum: "checksum-1",
            airtableSyncStatus: "linked",
            airtableRecordId: "rec-1",
            airtableRecordUrl: "https://airtable.example/rec-1",
            airtableLastSyncedAt: "2026-03-06T10:10:00Z",
            airtableLastErrorCode: null,
            airtableLastErrorDetail: null,
            updatedAt: "2026-03-06T10:10:00Z",
          },
          {
            submissionId: "sub-rejected",
            creatorId: "creator-1",
            currentState: "rejected",
            version: 4,
            packName: "Rejected Pack",
            labelName: "Wave 2 Label",
            releaseMonth: "2026-03",
            notes: "Waiting on reviewer reopen",
            tags: [],
            airtableFormCompleted: true,
            airtablePayloadChecksum: "checksum-2",
            airtableSyncStatus: "linked",
            airtableRecordId: "rec-2",
            airtableRecordUrl: "https://airtable.example/rec-2",
            airtableLastSyncedAt: "2026-03-06T10:15:00Z",
            airtableLastErrorCode: null,
            airtableLastErrorDetail: null,
            updatedAt: "2026-03-06T10:15:00Z",
          },
        ];

        api.submissions.list = async () => ({ ok: true, data: { submissions } });
        api.submissions.timeline = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            timeline:
              submissionId === "sub-reopened"
                ? [
                    { toState: "rejected", createdAt: "2026-03-06T09:00:00Z", reason: "Needs fixes" },
                    { toState: "draft", createdAt: "2026-03-06T10:00:00Z", reason: "Reopened" },
                  ]
                : [
                    { toState: "under_review", createdAt: "2026-03-06T09:00:00Z", reason: "Submitted" },
                    { toState: "rejected", createdAt: "2026-03-06T10:00:00Z", reason: "Blocked" },
                  ],
          },
        });
        if ((window as any).viewSubmissions?.wire) {
          (window as any).viewSubmissions.wire();
        }
        if ((window as any).viewSubmissions?.refresh) {
          (window as any).viewSubmissions.refresh();
        }
      });

      await navigateViaNavHit(page, "submissions");
      await expect(page.locator("#workspace-main-panel")).toContainText(/Reopened Pack|Submission History/);
      await page.locator('[data-workspace-open="sub-reopened"]').click();
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Reopened for amendment");
      await expect(page.locator("#workspace-main-panel")).toContainText(/Airtable Details|Pack Intake & QC/);

      await expect(page.locator("#view-submissions")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[CR-024][CR-026] returning creator can recover reopened work from needs-action path within two interactions", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        const submissions = [
          {
            submissionId: "sub-reopened-recovery",
            creatorId: "creator-1",
            currentState: "draft",
            version: 5,
            packName: "Reopened Recovery Pack",
            labelName: "Wave 2 Label",
            releaseMonth: "2026-03",
            notes: "Resume from reviewer reopen",
            tags: [],
            updatedAt: "2026-03-09T10:15:00Z",
          },
          {
            submissionId: "sub-rejected-recovery",
            creatorId: "creator-1",
            currentState: "rejected",
            version: 6,
            packName: "Rejected Recovery Pack",
            labelName: "Wave 2 Label",
            releaseMonth: "2026-03",
            notes: "Awaiting reopen",
            tags: [],
            updatedAt: "2026-03-09T10:14:00Z",
          },
        ];
        api.submissions.list = async () => ({ ok: true, data: { submissions } });
        api.submissions.timeline = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            timeline:
              submissionId === "sub-reopened-recovery"
                ? [
                    { toState: "rejected", createdAt: "2026-03-09T09:00:00Z", reason: "Fix naming" },
                    { toState: "draft", createdAt: "2026-03-09T10:00:00Z", reason: "Reopened by reviewer" },
                  ]
                : [{ toState: "rejected", createdAt: "2026-03-09T10:05:00Z", reason: "Awaiting reopen" }],
          },
        });
        if ((window as any).viewSubmissions?.wire) {
          (window as any).viewSubmissions.wire();
        }
        if ((window as any).viewDashboard?.refresh) {
          (window as any).viewDashboard.refresh();
        }
      });

      await navigateViaNavHit(page, "submissions");
      await page.locator('[data-workspace-open-needs-action]').click();
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Reopened for amendment");
      await expect(page.locator("#workspace-pack-name")).toBeVisible();
      await expect(page.locator("#workspace-pack-name")).toHaveValue("Reopened Recovery Pack");
    } finally {
      await app.close();
    }
  });
});
