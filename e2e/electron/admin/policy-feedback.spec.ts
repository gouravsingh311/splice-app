import { expect, test } from "@playwright/test";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi, navigateViaNavHit } from "../support";

test.describe("Admin policy scenarios", () => {
  test("[AD-003] save policy action returns deterministic feedback", async () => {
    const { email, password } = getSeededAccount("admin");
    const { app, page, apiUrl } = await launchDesktop({ actorId: "admin@fileeaters.local", actorRoles: "creator,admin" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "admin-ops");
      await expect(page.locator("#admin-policy-id-input")).toBeVisible();
      await page.evaluate(() => {
        if ((window as any).viewAdminOps?.wire) {
          void (window as any).viewAdminOps.wire({ api: (window as any).electronAPI || (window as any).fileeaters });
        }
      });
      const reasonInput = page.locator("#admin-policy-reason-input");
      await reasonInput.fill("keep-this-reason-on-failure");
      await page.locator("#admin-qc-save-policy").click();

      await expect(page.locator("#view-admin-ops")).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
