import { expect, test } from "@playwright/test";

import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi, navigateViaNavHit } from "../support";

async function openCreatorSubmissions(page: any) {
  await navigateViaNavHit(page, "submissions");
  await expect(page.locator("#view-submissions")).toBeVisible();
}

async function openNewDraft(page: any) {
  await page.locator("[data-workspace-create]").first().click();
  await expect(page.locator("#workspace-pack-name")).toBeVisible();
}

test.describe("Creator PR-core expansion scenarios", () => {
  test.describe.configure({ timeout: 180_000 });

  test("[CR-002][CR-003] profile save + validation", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        const profileState = {
          userId: "me",
          displayName: "Casey Creator",
          labelName: "Legacy Label",
          defaultsJson: {
            preferredReleaseMonth: "2026-03",
            theme: "midnight",
          },
          updatedAt: "2026-03-11T09:00:00Z",
        };

        (window as any).__creatorProfileState = profileState;

        api.creator.profile.get = async () => ({
          ok: true,
          data: { ...profileState },
        });

        api.creator.profile.put = async (payload: any) => {
          const displayName = Object.prototype.hasOwnProperty.call(payload, "displayName")
            ? payload.displayName
            : profileState.displayName;
          const labelName = Object.prototype.hasOwnProperty.call(payload, "labelName")
            ? payload.labelName
            : profileState.labelName;

          if (typeof displayName === "string" && displayName.trim().length === 0) {
            throw new Error(
              "Preload request validation failed for fileeaters.creator.profile.put.v1: displayName must be non-empty when provided",
            );
          }
          if (typeof labelName === "string" && labelName.trim().length === 0) {
            throw new Error(
              "Preload request validation failed for fileeaters.creator.profile.put.v1: labelName must be non-empty when provided",
            );
          }

          profileState.displayName = displayName;
          profileState.labelName = labelName;
          profileState.defaultsJson = payload.defaultsJson || {};
          profileState.updatedAt = "2026-03-11T10:00:00Z";
          (window as any).__creatorProfileState = profileState;

          return {
            ok: true,
            data: { ...profileState },
          };
        };
      });

      await openCreatorSubmissions(page);
      await openNewDraft(page);
      await expect(page.locator("#workspace-label-name")).toHaveValue("Legacy Label");

      const savedProfile = await page.evaluate(async () => {
        const api = (window as any).electronAPI;
        return api.creator.profile.put({
          actorId: "creator@fileeaters.local",
          userId: "me",
          displayName: "Casey Creator",
          labelName: "Neon Works",
          defaultsJson: {
            preferredReleaseMonth: "2026-06",
            notificationOptIn: true,
          },
        });
      });

      expect(savedProfile.ok).toBeTruthy();
      expect(savedProfile.data.labelName).toBe("Neon Works");

      await page.evaluate(async () => {
        if ((window as any).viewSubmissions?.refresh) {
          await (window as any).viewSubmissions.refresh();
        }
      });

      await openNewDraft(page);
      await expect(page.locator("#workspace-label-name")).toHaveValue("Neon Works");

      const invalidProfileSave = await page.evaluate(async () => {
        const api = (window as any).electronAPI;
        try {
          await api.creator.profile.put({
            actorId: "creator@fileeaters.local",
            userId: "me",
            displayName: "",
            labelName: "Should Not Persist",
            defaultsJson: {},
          });
          return { ok: false, message: "unexpected success" };
        } catch (error) {
          return { ok: false, message: String(error instanceof Error ? error.message : error) };
        }
      });

      expect(invalidProfileSave.message).toContain("Preload request validation failed");
      await expect(page.locator("#workspace-label-name")).toHaveValue("Neon Works");
    } finally {
      await app.close();
    }
  });

  test("[CR-006] draft autosave restore after relaunch", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app: firstApp, page: firstPage, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });
    let firstAppClosed = false;

    try {
      await firstPage.addInitScript(() => {
        const nativeSetInterval = window.setInterval.bind(window);
        window.setInterval = ((handler: any, timeout?: any, ...args: any[]) => {
          const id = nativeSetInterval(handler, timeout, ...args);
          if (timeout === 30000 && typeof handler === "function") {
            (window as any).__creatorAutosaveTrigger = handler;
          }
          return id;
        }) as typeof window.setInterval;
      });

      await installRendererApiShim(firstPage, undefined, apiUrl);
      await loginViaUi(firstPage, { email, password });

      await firstPage.evaluate(() => {
        const api = (window as any).electronAPI;
        const state = {
          profile: {
            userId: "me",
            displayName: "Casey Creator",
            labelName: "Autosave Label",
            defaultsJson: {
              preferredReleaseMonth: "2026-04",
            },
            updatedAt: "2026-03-11T09:00:00Z",
          },
          submission: null as any,
          autosaveCalls: 0,
        };

        const toSubmission = (draft: any) => ({
          submissionId: draft.submissionId,
          creatorId: draft.creatorId,
          currentState: "draft",
          version: state.autosaveCalls + 1,
          packName: draft.packName ?? null,
          labelName: draft.labelName ?? null,
          releaseMonth: draft.releaseMonth ?? null,
          notes: draft.notes ?? null,
          tags: Array.isArray(draft.tags) ? draft.tags.slice() : [],
          airtableFormCompleted: Boolean(draft.airtableFormCompleted),
          airtablePayloadChecksum: draft.airtablePayloadChecksum ?? null,
          airtableSyncStatus: "linked",
          airtableRecordId: null,
          airtableRecordUrl: null,
          airtableLastSyncedAt: null,
          airtableLastErrorCode: null,
          airtableLastErrorDetail: null,
          createdAt: "2026-03-11T09:00:00Z",
          updatedAt: new Date().toISOString(),
          draftLastSavedAt: new Date().toISOString(),
          uploadIntakeSessionId: null,
          uploadHandoffId: null,
          uploadManifestVersion: null,
          uploadStatus: null,
          uploadProgressPercent: 0,
          uploadUploadedBytes: 0,
          uploadTotalBytes: 0,
          uploadUploadedFiles: 0,
          uploadTotalFiles: 0,
          uploadError: null,
          uploadUpdatedAt: null,
        });

        (window as any).__creatorAutosaveState = state;

        api.creator.profile.get = async () => ({
          ok: true,
          data: { ...state.profile },
        });

        api.submissions.createDraft = async (payload: any) => {
          state.submission = toSubmission(payload);
          return {
            ok: true,
            data: { submission: { ...state.submission } },
          };
        };

        api.submissions.updateMetadata = async (payload: any) => {
          state.autosaveCalls += 1;
          state.submission = {
            ...(state.submission || toSubmission(payload)),
            currentState: "draft",
            version: state.autosaveCalls + 1,
            packName: payload.packName ?? null,
            labelName: payload.labelName ?? null,
            releaseMonth: payload.releaseMonth ?? null,
            notes: payload.notes ?? null,
            tags: Array.isArray(payload.tags) ? payload.tags.slice() : [],
            airtableFormCompleted: Boolean(payload.airtableFormCompleted),
            airtablePayloadChecksum: payload.airtablePayloadChecksum ?? null,
            updatedAt: new Date().toISOString(),
            draftLastSavedAt: new Date().toISOString(),
          };
          (window as any).__creatorAutosaveState = state;
          return {
            ok: true,
            data: { submission: { ...state.submission } },
          };
        };

        api.submissions.list = async () => ({
          ok: true,
          data: {
            submissions: state.submission ? [{ ...state.submission }] : [],
          },
        });

        api.submissions.timeline = async () => ({
          ok: true,
          data: { timeline: [] },
        });
      });

      await openCreatorSubmissions(firstPage);
      await openNewDraft(firstPage);
      await firstPage.locator("#workspace-pack-name").fill("Autosave Revival Pack");
      await firstPage.locator("#workspace-label-name").fill("Autosave Revival Label");
      await firstPage.locator("#workspace-release-month").selectOption("2026-06");
      await firstPage.locator("#workspace-notes").fill("Autosave should survive relaunch");

      await firstPage.evaluate(async () => {
        const trigger = (window as any).__creatorAutosaveTrigger;
        if (typeof trigger !== "function") {
          throw new Error("Autosave trigger was not captured");
        }
        await trigger();
      });

      await firstPage.waitForFunction(() => ((window as any).__creatorAutosaveState?.autosaveCalls ?? 0) > 0);

      const autosavedSubmission = await firstPage.evaluate(() =>
        JSON.parse(JSON.stringify((window as any).__creatorAutosaveState?.submission ?? null)),
      );
      expect(autosavedSubmission).not.toBeNull();

      await firstApp.close();
      firstAppClosed = true;

      const { app: secondApp, page: secondPage } = await launchDesktop({ actorId: email, actorRoles: "creator" });
      try {
        await installRendererApiShim(secondPage, undefined, apiUrl);
        await loginViaUi(secondPage, { email, password });

        await secondPage.evaluate(
          (submission) => {
            const api = (window as any).electronAPI;
            const state = {
              profile: {
                userId: "me",
                displayName: "Casey Creator",
                labelName: submission.labelName || "Autosave Label",
                defaultsJson: {
                  preferredReleaseMonth: "2026-04",
                },
                updatedAt: "2026-03-11T09:00:00Z",
              },
            };

            api.creator.profile.get = async () => ({
              ok: true,
              data: { ...state.profile },
            });
            api.submissions.list = async () => ({
              ok: true,
              data: {
                submissions: [submission],
              },
            });
            api.submissions.timeline = async () => ({
              ok: true,
              data: { timeline: [] },
            });
          },
          autosavedSubmission,
        );

        await openCreatorSubmissions(secondPage);
        await expect(secondPage.locator(`[data-workspace-open="${autosavedSubmission.submissionId}"]`)).toBeVisible();
        await secondPage.locator(`[data-workspace-open="${autosavedSubmission.submissionId}"]`).click();

        await expect(secondPage.locator("#workspace-pack-name")).toHaveValue("Autosave Revival Pack");
        await expect(secondPage.locator("#workspace-label-name")).toHaveValue("Autosave Revival Label");
        await expect(secondPage.locator("#workspace-release-month")).toHaveValue("2026-06");
        await expect(secondPage.locator("#workspace-notes")).toHaveValue("Autosave should survive relaunch");
      } finally {
        await secondApp.close();
      }
    } finally {
      if (!firstAppClosed) {
        await firstApp.close();
      }
    }
  });

  test("[CR-012] required-folder blocker messaging", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        (window as any).workspacePackStructure = {
          resolveMissingRequiredTopLevelFolders: () => ["Demo/Demos", "Description/Description & Info"],
          buildStructureGateMessage: (missingFolders: string[]) =>
            `Missing required folders: ${missingFolders.join(", ")}.`,
          buildMissingRequiredFolderGuidance: (missingFolders: string[]) =>
            `Add these folders before continuing: ${missingFolders.join(", ")}.`,
          resolveTopLevelFolderChecklist: (topLevelFolders: string[]) => [
            { label: "Audio", present: topLevelFolders.includes("Audio") },
            { label: "Artwork", present: topLevelFolders.includes("Artwork") },
            { label: "Demo/Demos", present: topLevelFolders.includes("Demo") || topLevelFolders.includes("Demos") },
            { label: "Description/Description & Info", present: topLevelFolders.includes("Description") },
          ],
        };

        api.creator.profile.get = async () => ({
          ok: true,
          data: {
            userId: "me",
            displayName: "Casey Creator",
            labelName: "Blocker Label",
            defaultsJson: {},
            updatedAt: "2026-03-11T09:00:00Z",
          },
        });

        api.submissions.list = async () => ({
          ok: true,
          data: { submissions: [] },
        });

        api.submissions.timeline = async () => ({
          ok: true,
          data: { timeline: [] },
        });

        api.intake.selectFolder = async () => ({
          ok: true,
          data: {
            path: "/tmp/incomplete-pack",
            fileCount: 2,
            topLevelFolders: ["Audio", "Artwork"],
            files: [
              {
                relativePath: "Audio/Blocker Label - Blocker Pack.zip",
                sizeBytes: 1024,
                mimeType: "application/zip",
              },
              {
                relativePath: "Artwork/cover.jpg",
                sizeBytes: 256,
                mimeType: "image/jpeg",
              },
            ],
          },
        });
      });

      await openCreatorSubmissions(page);
      await openNewDraft(page);
      await page.locator("#workspace-pack-name").fill("Blocker Pack");
      await page.locator("#workspace-label-name").fill("Blocker Label");
      await page.locator("#workspace-release-month").selectOption("2026-07");

      await page.locator('[data-wizard-next="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();

      await expect(page.locator("#workspace-feedback")).toContainText("Missing required folders:");
      await expect(page.locator("#workspace-feedback")).toContainText("Add these folders before continuing:");
      await expect(page.locator("#workspace-folder-guidance")).toContainText("Demo/Demos");
      await expect(page.locator("#workspace-folder-guidance")).toContainText("Description/Description & Info");
      await expect(page.locator("#workspace-folder-checklist")).toContainText("× Demo/Demos");
      await expect(page.locator("#workspace-folder-checklist")).toContainText("× Description/Description & Info");
    } finally {
      await app.close();
    }
  });

  test("[CR-018] QC rerun updates gating deterministically", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        const state = {
          runCount: 0,
        };

        (window as any).__qcDeterministicState = state;

        api.creator.profile.get = async () => ({
          ok: true,
          data: {
            userId: "me",
            displayName: "Casey Creator",
            labelName: "QC Label",
            defaultsJson: {},
            updatedAt: "2026-03-11T09:00:00Z",
          },
        });

        api.submissions.createDraft = async (payload: any) => ({
          ok: true,
          data: {
            submission: {
              submissionId: payload.submissionId,
              creatorId: payload.creatorId,
              currentState: "draft",
              version: 1,
              packName: payload.packName,
              labelName: payload.labelName,
              releaseMonth: payload.releaseMonth,
              notes: payload.notes,
              tags: payload.tags || [],
              airtableFormCompleted: Boolean(payload.airtableFormCompleted),
              airtablePayloadChecksum: payload.airtablePayloadChecksum ?? null,
              airtableSyncStatus: "linked",
              airtableRecordId: null,
              airtableRecordUrl: null,
              airtableLastSyncedAt: null,
              airtableLastErrorCode: null,
              airtableLastErrorDetail: null,
              createdAt: "2026-03-11T10:00:00Z",
              updatedAt: "2026-03-11T10:00:00Z",
              draftLastSavedAt: "2026-03-11T10:00:00Z",
              uploadIntakeSessionId: null,
              uploadHandoffId: null,
              uploadManifestVersion: null,
              uploadStatus: null,
              uploadProgressPercent: 0,
              uploadUploadedBytes: 0,
              uploadTotalBytes: 0,
              uploadUploadedFiles: 0,
              uploadTotalFiles: 0,
              uploadError: null,
              uploadUpdatedAt: null,
            },
          },
        });

        api.submissions.updateMetadata = async (payload: any) => ({
          ok: true,
          data: {
            submission: {
              submissionId: payload.submissionId,
              creatorId: payload.creatorId,
              currentState: "draft",
              version: 2,
              packName: payload.packName,
              labelName: payload.labelName,
              releaseMonth: payload.releaseMonth,
              notes: payload.notes,
              tags: payload.tags || [],
              airtableFormCompleted: Boolean(payload.airtableFormCompleted),
              airtablePayloadChecksum: payload.airtablePayloadChecksum ?? null,
              airtableSyncStatus: "linked",
              airtableRecordId: null,
              airtableRecordUrl: null,
              airtableLastSyncedAt: null,
              airtableLastErrorCode: null,
              airtableLastErrorDetail: null,
              createdAt: "2026-03-11T10:00:00Z",
              updatedAt: "2026-03-11T10:01:00Z",
              draftLastSavedAt: "2026-03-11T10:01:00Z",
              uploadIntakeSessionId: null,
              uploadHandoffId: null,
              uploadManifestVersion: null,
              uploadStatus: null,
              uploadProgressPercent: 0,
              uploadUploadedBytes: 0,
              uploadTotalBytes: 0,
              uploadUploadedFiles: 0,
              uploadTotalFiles: 0,
              uploadError: null,
              uploadUpdatedAt: null,
            },
          },
        });

        api.submissions.syncAirtable = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            submissionId,
            syncStatus: "linked",
            airtableFormCompleted: true,
            airtablePayloadChecksum: "qc-checksum",
            airtableRecordId: "rec-qc",
            airtableRecordUrl: "https://airtable.example/rec-qc",
            lastSyncedAt: "2026-03-11T10:02:00Z",
            lastErrorCode: null,
            lastErrorDetail: null,
            mappedPayload: {
              labelName: "QC Label",
              packName: "QC Pack",
              releaseMonth: "2026-06",
              notes: "",
              tags: [],
            },
          },
        });

        api.submissions.list = async () => ({
          ok: true,
          data: { submissions: [] },
        });

        api.submissions.timeline = async () => ({
          ok: true,
          data: { timeline: [] },
        });

        api.intake.selectFolder = async () => ({
          ok: true,
          data: {
            path: "/tmp/qc-pack",
            fileCount: 4,
            topLevelFolders: ["Audio", "Artwork", "Demo", "Description"],
            files: [
              {
                relativePath: "Audio/QC Pack.zip",
                sizeBytes: 1024,
                mimeType: "application/zip",
              },
              {
                relativePath: "Artwork/cover.jpg",
                sizeBytes: 256,
                mimeType: "image/jpeg",
              },
              {
                relativePath: "Demo/demo.mp3",
                sizeBytes: 256,
                mimeType: "audio/mpeg",
              },
              {
                relativePath: "Description/info.txt",
                sizeBytes: 64,
                mimeType: "text/plain",
              },
            ],
          },
        });

        api.qc.evaluatePack = async () => {
          state.runCount += 1;
          const firstRun = state.runCount === 1;

          return {
            ok: true,
            data: {
              report: {
                status: firstRun ? "failed" : "passed",
                findings: firstRun
                  ? [
                      {
                        ruleId: "AUDIO_ZIP_NAMING",
                        severity: "blocking",
                        message: "Audio ZIP file must follow the pack naming convention.",
                        remediation: "Rename the Audio ZIP to match label and pack name.",
                        context: { file_ref: "Audio/Bad Name.zip" },
                      },
                    ]
                  : [],
                generatedAt: firstRun ? "2026-03-11T10:03:00Z" : "2026-03-11T10:04:00Z",
              },
            },
          };
        };
      });

      await openCreatorSubmissions(page);
      await openNewDraft(page);
      await page.locator("#workspace-pack-name").fill("QC Pack");
      await page.locator("#workspace-label-name").fill("QC Label");
      await page.locator("#workspace-release-month").selectOption("2026-06");

      await page.locator("#workspace-airtable-complete").click();
      await expect(page.locator("#workspace-airtable-status")).toContainText(/linked and confirmed/i);

      await page.locator('[data-wizard-next="intake"]').click();
      await page.locator("#workspace-select-pack-folder").click();

      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: blocking findings found");
      await expect(page.locator("#workspace-remediation-items")).toContainText("AUDIO_ZIP_NAMING");
      await expect(page.locator("#workspace-submit-review")).toHaveCount(0);

      await page.locator("#workspace-run-qc").click();
      await expect(page.locator("#workspace-qc-run-status")).toContainText("QC finished: passed with no blocking findings");
      await expect(page.locator("#workspace-remediation-items")).not.toContainText("AUDIO_ZIP_NAMING");

      await page.getByRole("button", { name: /Step 3.*Review & Submit/i }).click();
      await expect(page.locator("#workspace-submit-review")).toBeEnabled();
    } finally {
      await app.close();
    }
  });

  test("[CR-021][CR-022][CR-023] history visibility, timeline detail, immutable post-submit", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        const buildSubmission = (overrides: any) => ({
          submissionId: "sub-creator-history",
          creatorId: "creator@fileeaters.local",
          currentState: "draft",
          version: 1,
          packName: "Creator History Pack",
          labelName: "Creator Label",
          releaseMonth: "2026-03",
          notes: "History snapshot",
          tags: [],
          airtableFormCompleted: true,
          airtablePayloadChecksum: "history-checksum",
          airtableSyncStatus: "linked",
          airtableRecordId: null,
          airtableRecordUrl: null,
          airtableLastSyncedAt: null,
          airtableLastErrorCode: null,
          airtableLastErrorDetail: null,
          createdAt: "2026-03-11T10:00:00Z",
          updatedAt: "2026-03-11T10:00:00Z",
          draftLastSavedAt: null,
          uploadIntakeSessionId: null,
          uploadHandoffId: null,
          uploadManifestVersion: null,
          uploadStatus: null,
          uploadProgressPercent: 0,
          uploadUploadedBytes: 0,
          uploadTotalBytes: 0,
          uploadUploadedFiles: 0,
          uploadTotalFiles: 0,
          uploadError: null,
          uploadUpdatedAt: null,
          ...overrides,
        });
        const submissions = [
          buildSubmission({
            submissionId: "sub-creator-final",
            creatorId: "creator@fileeaters.local",
            currentState: "approved",
            version: 5,
            packName: "Final Submission",
            labelName: "Creator Label",
            releaseMonth: "2026-02",
            notes: "Locked after final submit",
            updatedAt: "2026-03-10T14:00:00Z",
          }),
          buildSubmission({
            submissionId: "sub-creator-draft",
            creatorId: "creator@fileeaters.local",
            currentState: "draft",
            version: 2,
            packName: "Editable Draft",
            labelName: "Creator Label",
            releaseMonth: "2026-03",
            notes: "Waiting on reviewer reopen",
            updatedAt: "2026-03-10T11:00:00Z",
          }),
          buildSubmission({
            submissionId: "sub-foreign",
            creatorId: "reviewer@fileeaters.local",
            currentState: "approved",
            version: 1,
            packName: "Foreign Pack",
            labelName: "Reviewer Label",
            releaseMonth: "2026-01",
            notes: "Should not be visible to the creator history list",
            updatedAt: "2026-03-09T10:00:00Z",
          }),
        ];

        api.creator.profile.get = async () => ({
          ok: true,
          data: {
            userId: "me",
            displayName: "Casey Creator",
            labelName: "Creator Label",
            defaultsJson: {},
            updatedAt: "2026-03-11T09:00:00Z",
          },
        });

        api.submissions.list = async () => ({
          ok: true,
          data: {
            submissions: submissions.filter(
              (submission) => submission.creatorId === "creator@fileeaters.local",
            ),
          },
        });

        api.submissions.timeline = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            timeline:
              submissionId === "sub-creator-final"
                ? [
                    {
                      transitionId: "tr-1",
                      fromState: "draft",
                      toState: "under_review",
                      actorId: "creator@fileeaters.local",
                      actorRole: "creator",
                      reason: "Submitted for review",
                      requestId: "req-1",
                      createdAt: "2026-03-10T13:30:00Z",
                    },
                    {
                      transitionId: "tr-2",
                      fromState: "under_review",
                      toState: "approved",
                      actorId: "reviewer@fileeaters.local",
                      actorRole: "reviewer",
                      reason: "Approved",
                      reviewReasonCode: "APPROVED",
                      reviewNotes: "All checks passed.",
                      requestId: "req-2",
                      createdAt: "2026-03-10T14:00:00Z",
                    },
                  ]
                : [
                    {
                      transitionId: "tr-3",
                      fromState: "draft",
                      toState: "under_review",
                      actorId: "creator@fileeaters.local",
                      actorRole: "creator",
                      reason: "Submitted",
                      requestId: "req-3",
                      createdAt: "2026-03-10T10:30:00Z",
                    },
                    {
                      transitionId: "tr-4",
                      fromState: "under_review",
                      toState: "rejected",
                      actorId: "reviewer@fileeaters.local",
                      actorRole: "reviewer",
                      reason: "Quality issue",
                      reviewReasonCode: "QUALITY_ISSUES",
                      reviewNotes: "Rename the audio zip before resubmitting.",
                      requestId: "req-4",
                      createdAt: "2026-03-10T11:00:00Z",
                    },
                    {
                      transitionId: "tr-5",
                      fromState: "rejected",
                      toState: "draft",
                      actorId: "reviewer@fileeaters.local",
                      actorRole: "reviewer",
                      reason: "Reopened",
                      requestId: "req-5",
                      createdAt: "2026-03-10T11:15:00Z",
                    },
                  ],
          },
        });
      });

      await openCreatorSubmissions(page);
      await expect(page.locator("[data-workspace-open='sub-creator-final']")).toBeVisible();
      await expect(page.locator("[data-workspace-open='sub-creator-draft']")).toBeVisible();
      await expect(page.locator("[data-workspace-open='sub-foreign']")).toHaveCount(0);

      await page.locator("[data-workspace-open='sub-creator-final']").click();
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Lifecycle status");
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText(
        "Status history and detail stay consolidated in submissions.",
      );
      await expect(page.locator("#workspace-main-panel")).toContainText("Timeline");
      await expect(page.locator("#workspace-main-panel")).toContainText("approved - Approved");
      await expect(page.locator("#workspace-main-panel")).toContainText("All checks passed.");
      await expect(page.locator("#workspace-pack-name")).toHaveCount(0);
      await expect(page.locator("#workspace-reopen-edit")).toHaveCount(0);

      await page.locator("#workspace-back-to-list").click();
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("[data-workspace-open='sub-creator-draft']")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[CR-032] creator direct-route denial for reviewer/admin surfaces", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.creator.profile.get = async () => ({
          ok: true,
          data: {
            userId: "me",
            displayName: "Casey Creator",
            labelName: "Route Label",
            defaultsJson: {},
            updatedAt: "2026-03-11T09:00:00Z",
          },
        });
        api.submissions.list = async () => ({
          ok: true,
          data: { submissions: [] },
        });
        api.submissions.timeline = async () => ({
          ok: true,
          data: { timeline: [] },
        });
      });

      await navigateViaNavHit(page, "reviewer-queue", "submissions");
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#view-reviewer-queue")).toHaveCount(0);

      await navigateViaNavHit(page, "admin-ops", "submissions");
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#view-admin-ops")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
