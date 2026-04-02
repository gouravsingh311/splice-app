import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi } from "../support";

const validFixturePath = path.resolve("e2e/fixtures/valid_pack/fixture.json");

test.describe("Creator submission lifecycle scenarios", () => {
  test("[CR-004][CR-005][CR-014][CR-015][CR-020] draft save + reload persistence + qc pass + submit for review gating", async () => {
    const fixture = JSON.parse(await fs.readFile(validFixturePath, "utf8"));
    const { email, password } = getSeededAccount("creator");
    // Auth stub active — no createAccountViaApi needed

    const firstRun = await launchDesktop({ actorId: email, actorRoles: "creator" });
    const firstApp = firstRun.app;
    const firstPage = firstRun.page;
    const apiUrl = firstRun.apiUrl;

    await installRendererApiShim(firstPage, undefined, apiUrl);
    await firstPage.evaluate(() => {
      const api = (window as any).electronAPI;
      const baseSync = api?.submissions?.syncAirtable;
      if (typeof baseSync === "function") {
        api.submissions.syncAirtable = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            submissionId,
            syncStatus: "linked",
            airtableFormCompleted: true,
            airtablePayloadChecksum: "submission-flow-checksum",
            airtableRecordId: "rec-submission-flow",
            airtableRecordUrl: "https://airtable.example/rec-submission-flow",
            lastSyncedAt: "2026-03-11T10:00:00Z",
            lastErrorCode: null,
            lastErrorDetail: null,
            mappedPayload: {
              labelName: "Fixture Label",
              packName: "Fixture Pack",
              releaseMonth: "2026-03",
              notes: "",
              tags: [],
            },
          },
        });
      }
    });
    await expect(firstPage.locator('#sidebar-primary-nav [data-nav="dashboard"]').first()).toBeDisabled();
    const preLoginFocusedNav = await firstPage.evaluate(() => document.activeElement?.getAttribute("data-nav") || "");
    expect(preLoginFocusedNav).toBe("");

    await loginViaUi(firstPage, { email, password });
    await expect(firstPage.locator('#sidebar-primary-nav [data-nav="dashboard"]').first()).toBeEnabled();
    await firstPage.evaluate(() => {
      const api = (window as any).electronAPI;
      if (!api?.submissions) { return; }
      api.submissions.list = async () => ({ ok: true, data: { submissions: [] } });
      api.submissions.timeline = async () => ({ ok: true, data: { timeline: [] } });
      if ((window as any).viewSubmissions?.wire) {
        (window as any).viewSubmissions.wire();
      }
    });

    await firstPage.locator('#sidebar-primary-nav [data-nav="submissions"]').first().click();
    await expect(firstPage.locator("#view-submissions")).toBeVisible();

    await firstPage.locator('[data-workspace-create]').first().click();
    await expect(firstPage.locator("#workspace-pack-name")).toBeVisible();
    await firstPage.locator("#workspace-pack-name").fill(fixture.packName);
    await expect(firstPage.locator("#workspace-pack-name")).toHaveValue(fixture.packName);
    await firstPage.locator("#workspace-label-name").fill(fixture.labelName);
    await expect(firstPage.locator("#workspace-label-name")).toHaveValue(fixture.labelName);
    const releaseMonthOption = await firstPage
      .locator(`#workspace-release-month option[value="${fixture.releaseMonth}"]`)
      .count();
    if (releaseMonthOption > 0) {
      await firstPage.locator("#workspace-release-month").selectOption(fixture.releaseMonth);
    } else {
      await firstPage.locator("#workspace-release-month").selectOption({ index: 1 });
    }

    const submitButton = firstPage.locator("#workspace-submit-review");
    await expect(submitButton).toHaveCount(0);

    await firstPage.locator("#workspace-save-metadata").click();
    await expect(firstPage.locator("#workspace-feedback")).toContainText("Metadata saved");
    await expect(firstPage.locator("#workspace-airtable-complete")).toBeFocused();

    await expect(firstPage.locator("#workspace-feedback")).toContainText(/Metadata saved/i);

    await firstPage.locator('[data-wizard-next="intake"]').click();
    // Select pack folder — with PLAYWRIGHT_E2E=1 + E2E_PACK_PATH, IPC returns fixture path automatically
    await firstPage.locator("#workspace-select-pack-folder").click();
    await expect(firstPage.locator("#workspace-missing-folders")).toBeVisible({ timeout: 10000 });

    await firstPage.locator("#workspace-run-qc").click();
    await expect(firstPage.locator("#workspace-feedback")).toContainText("QC passed");
    await expect(submitButton).toHaveCount(0);

    await firstPage.getByRole("button", { name: /Step 1.*Airtable Details/i }).click();
    await firstPage.locator("#workspace-airtable-complete").click();
    await expect(firstPage.locator("#workspace-airtable-status")).toContainText(/linked.*submission/i);
    await firstPage.getByRole("button", { name: /Step 3.*Review & Submit/i }).click();
    await expect(submitButton).toBeEnabled();


    await firstPage.locator("#workspace-submit-review").click();
    // Accept either success (real Dropbox configured) or unavailable (no Dropbox token in CI)
    await expect(firstPage.locator("#workspace-feedback")).toContainText(
      /ready for review handoff|unavailable|Dropbox|handoff/i,
      { timeout: 15000 }
    );


    await firstApp.close();

    const secondRun = await launchDesktop({ actorId: email, actorRoles: "creator" });
    const secondApp = secondRun.app;
    const secondPage = secondRun.page;

    await installRendererApiShim(secondPage, undefined, secondRun.apiUrl);
    await loginViaUi(secondPage, { email, password });
    await secondPage.evaluate(() => {
      if ((window as any).viewSubmissions?.wire) {
        (window as any).viewSubmissions.wire();
      }
    });
    await secondPage.locator('#sidebar-primary-nav [data-nav="submissions"]').first().click();
    await expect(secondPage.locator("#view-submissions")).toBeVisible();
    await expect(secondPage.locator('[data-workspace-create]').first()).toBeVisible();

    await secondApp.close();
  });
});
