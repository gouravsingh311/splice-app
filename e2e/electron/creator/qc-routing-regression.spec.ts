import { expect, test } from "@playwright/test";

import {
  getSeededAccount,
  installRendererApiShim,
  launchDesktop,
  loginViaUi,
  navigateViaNavHit,
} from "../support";

test.describe("Creator QC routing regression scenarios", () => {
  test("[CR-011] submissions view presents canonical wizard steps", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "submissions");
      await page.locator('[data-workspace-create]').first().click();

      await expect(page.locator("#view-submissions")).toContainText("Creator Workspace");
      await expect(page.locator("#view-submissions")).toContainText("Airtable Details");
      await expect(page.locator("#view-submissions")).toContainText("Pack Intake & QC");
      await expect(page.locator("#view-submissions")).toContainText("Review & Submit");
    } finally {
      await app.close();
    }
  });

  test("[CR-032] legacy standalone qc and detail routes do not become creator destinations", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await loginViaUi(page, { email, password });

      await navigateViaNavHit(page, "qc-results", "submissions");
      await expect(page.locator("#view-submissions")).toBeVisible();

      await navigateViaNavHit(page, "submission-detail", "submissions");
      await expect(page.locator("#view-submissions")).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
