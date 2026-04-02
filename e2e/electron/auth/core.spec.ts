import { expect, test } from "@playwright/test";
import { getSeededAccount, launchDesktop, loginViaUi } from "../support";

test.describe("AUTH scenarios", () => {
  test("[AUTH-001] app boots to login screen", async () => {
    const { app, page } = await launchDesktop();
    await expect(page.locator("#view-auth")).toBeVisible();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#shell-topbar")).toBeHidden();
    await expect(page.locator("#sidebar-primary-nav")).toBeHidden();
    await app.close();
  });

  test("[AUTH-001] fill credentials and submit loads workspace", async () => {
    const { email, password } = getSeededAccount("creator");
    // Auth stub is active — no real account needed; login IPC returns stub token.
    const { app, page } = await launchDesktop();
    await loginViaUi(page, { email, password });
    await expect(page.locator("#shell-topbar")).toBeVisible();
    await expect(page.locator("#sidebar-primary-nav")).toBeVisible();
    await expect(page.locator("#sidebar-role-badge")).toHaveText("CREATOR");
    await expect(page.getByRole("heading", { level: 2, name: "Dashboard" })).toBeVisible();

    await page.locator("#profile-menu-trigger").click();
    await expect(page.locator("#profile-menu-panel")).toBeVisible();
    await page.locator("#sidebar-signout-btn").click();
    await expect(page.locator("#shell-topbar")).toBeHidden();
    await expect(page.locator("#sidebar-primary-nav")).toBeHidden();
    await app.close();
  });

  test("[AUTH-017] logout returns to login screen", async () => {
    const { email, password } = getSeededAccount("creator");
    // Auth stub active — skip account creation.

    const { app, page } = await launchDesktop();
    await loginViaUi(page, { email, password });

    await page.locator("#profile-menu-trigger").click();
    await expect(page.locator("#profile-menu-panel")).toBeVisible();
    await page.locator("#sidebar-signout-btn").click();
    await expect(page.locator("#view-auth")).toBeVisible();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#shell-topbar")).toBeHidden();
    await app.close();
  });
});
