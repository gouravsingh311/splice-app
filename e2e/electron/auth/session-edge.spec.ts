import { expect, test } from "@playwright/test";
import { launchDesktop, loginViaUi } from "../support";

async function createApiLoginBundle(
  request: import("@playwright/test").APIRequestContext,
  apiUrl: string,
  email: string,
  password: string,
) {
  const loginResponse = await request.post(`${apiUrl}/auth/login`, {
    data: {
      email,
      password,
      device_id: "playwright-auth-edge",
    },
  });
  expect(loginResponse.ok()).toBeTruthy();

  return loginResponse.json();
}

test.describe("AUTH session edge scenarios", () => {
  test("[AUTH-024] pre-login navigation stays protected until auth succeeds", async () => {
    const { app, page } = await launchDesktop();

    try {
      const dashboardNav = page.locator('[data-testid="nav-dashboard"]');
      await expect(page.locator("#view-auth")).toBeVisible();
      await expect(page.locator("#view-dashboard")).toBeHidden();
      await expect(dashboardNav).toBeDisabled();
    } finally {
      await app.close();
    }
  });

  test("[AUTH-018] logout-all revokes the backend session family and leaves refresh unusable", async ({ request }) => {
    const email = "creator@fileeaters.local";
    const password = "CreatorPass123!";
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      const bundle = await createApiLoginBundle(request, apiUrl, email, password);

      const logoutAllResponse = await request.post(`${apiUrl}/auth/logout-all`, {
        data: {
          access_token: bundle.access_token,
        },
      });
      expect(logoutAllResponse.ok()).toBeTruthy();
      await expect(logoutAllResponse.json()).resolves.toMatchObject({
        revoked_session_count: expect.any(Number),
      });

      const refreshAfterLogout = await request.post(`${apiUrl}/auth/refresh`, {
        data: {
          refresh_token: bundle.refresh_token,
        },
      });
      expect(refreshAfterLogout.status()).toBe(401);
      await expect(refreshAfterLogout.json()).resolves.toMatchObject({
        error: {
          code: "AUTH_UNAUTHORIZED",
        },
      });

      await loginViaUi(page, { email, password });
      await expect(page.locator("#shell-topbar")).toBeVisible();
      await page.locator("#profile-menu-trigger").click();
      await expect(page.locator("#profile-menu-panel")).toBeVisible();
      await page.locator("#sidebar-signout-btn").click();
      await expect(page.locator("#view-auth")).toBeVisible();
      await expect(page.locator("#shell-topbar")).toBeHidden();
    } finally {
      await app.close();
    }
  });
});
