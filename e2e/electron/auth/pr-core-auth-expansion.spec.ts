import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getSeededAccount, launchDesktop, loginViaUi, navigateViaNavHit } from "../support";

const SQLITE_CLI = process.env.SQLITE_CLI || "sqlite3";
const AUTH_DB_PATH = path.join(process.cwd(), "data", "splice.db");

type AuthSessionResponse = {
  ok: boolean;
  data?: {
    actor: {
      id: string;
      roles: string[];
    };
    permissions?: string[];
    sessionIssuedAt?: string;
  };
};

async function readRendererSession(page: Page, includePermissions = false): Promise<AuthSessionResponse> {
  return page.evaluate(
    async ({ withPermissions }) => {
      return (window as any).splice.auth.getSession({ includePermissions: withPermissions });
    },
    { withPermissions: includePermissions },
  );
}

async function loginBundle(
  request: APIRequestContext,
  apiUrl: string,
  email: string,
  password: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  user: { id: string; roles: string[] };
}> {
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: {
      email,
      password,
      device_id: "pr-core-auth-expansion",
    },
  });

  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function runSql(sql: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      execFileSync(SQLITE_CLI, [AUTH_DB_PATH, sql], { stdio: "pipe" });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function expireLoginLockout(email: string): Promise<void> {
  const escapedEmail = email.replace(/'/g, "''");
  await runSql(
    `UPDATE auth_login_failures SET failed_count = 0, locked_until = datetime('now', '-1 minute') WHERE email = '${escapedEmail}';`,
  );
}

async function failLoginAttempts(
  request: APIRequestContext,
  apiUrl: string,
  email: string,
  password: string,
  attempts: number,
): Promise<number[]> {
  const statuses: number[] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request.post(`${apiUrl}/auth/login`, {
      data: {
        email,
        password,
        device_id: `lockout-attempt-${attempt + 1}`,
      },
    });
    statuses.push(response.status());
  }

  return statuses;
}

test.describe.configure({ timeout: 180_000 });

test.describe("Auth PR-core expansion scenarios", () => {
  test("[AUTH-002][AUTH-003] seeded reviewer/admin login success", async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    const reviewer = getSeededAccount("reviewer");
    const admin = getSeededAccount("admin");
    const { app, page } = await launchDesktop();

    try {
      await loginViaUi(page, {
        email: reviewer.email,
        password: reviewer.password,
        expectedRole: "reviewer",
      });
      await expect(page.locator("#sidebar-role-badge")).toHaveText("REVIEWER");
      await expect(page.locator('[data-testid="nav-reviewer-queue"]')).toBeVisible();
      await expect(page.locator('[data-testid="nav-admin-ops"]')).toBeHidden();

      await page.locator("#profile-menu-trigger").click();
      await page.locator("#sidebar-signout-btn").click();
      await expect(page.locator("#login-form")).toBeVisible();

      await loginViaUi(page, {
        email: admin.email,
        password: admin.password,
        expectedRole: "admin",
      });
      await expect(page.locator("#sidebar-role-badge")).toHaveText("ADMIN");
      await expect(page.locator('[data-testid="nav-admin-ops"]')).toBeVisible();
      await expect(page.locator('[data-testid="nav-reviewer-queue"]')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[AUTH-006][AUTH-007] lockout and cooldown recovery", async ({ request }, testInfo) => {
    testInfo.setTimeout(180_000);
    const reviewer = getSeededAccount("reviewer");
    const { app, page, apiUrl } = await launchDesktop({ actorId: reviewer.email, actorRoles: "reviewer" });

    try {
      const statuses = await failLoginAttempts(
        request,
        apiUrl,
        reviewer.email,
        "DefinitelyWrongPass123!",
        5,
      );
      expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
      expect(statuses[4]).toBe(423);

      await expect(page.locator("#login-form")).toBeVisible();
      await page.locator("#login-email").fill(reviewer.email);
      await page.locator("#login-password").fill(reviewer.password);
      await page.locator("#login-form button[type='submit']").click();
      await expect(page.locator("#login-feedback")).toContainText(/temporarily locked/i);

      await expireLoginLockout(reviewer.email);

      await loginViaUi(page, {
        email: reviewer.email,
        password: reviewer.password,
        expectedRole: "reviewer",
      });
      await expect(page.locator("#sidebar-role-badge")).toHaveText("REVIEWER");
    } finally {
      await app.close();
    }
  });

  test("[AUTH-021][AUTH-022] session persistence across reload/relaunch", async ({ request }, testInfo) => {
    testInfo.setTimeout(180_000);
    const reviewer = getSeededAccount("reviewer");
    const { app, page, apiUrl } = await launchDesktop();
    const { access_token: accessToken, refresh_token: refreshToken } = await loginBundle(
      request,
      apiUrl,
      reviewer.email,
      reviewer.password,
    );

    try {
      await loginViaUi(page, {
        email: reviewer.email,
        password: reviewer.password,
        expectedRole: "reviewer",
      });

      const sessionBeforeReload = await readRendererSession(page);
      expect(sessionBeforeReload.ok).toBeTruthy();
      expect(sessionBeforeReload.data).toMatchObject({
        actor: {
          id: reviewer.email,
          roles: ["reviewer"],
        },
      });

      await page.reload();
      await expect(page.locator("#login-form")).toBeVisible();

      const sessionAfterReload = await readRendererSession(page);
      expect(sessionAfterReload.ok).toBeTruthy();
      expect(sessionAfterReload.data).toMatchObject({
        actor: {
          id: reviewer.email,
          roles: ["reviewer"],
        },
      });
      expect(sessionAfterReload.data?.sessionIssuedAt).toBe(sessionBeforeReload.data?.sessionIssuedAt);
    } finally {
      await app.close();
    }

    const relaunched = await launchDesktop();
    try {
      await expect(relaunched.page.locator("#login-form")).toBeVisible();

      const refreshResponse = await request.post(`${relaunched.apiUrl}/auth/refresh`, {
        data: {
          refresh_token: refreshToken,
        },
      });
      expect(refreshResponse.ok()).toBeTruthy();
      const refreshedBundle = await refreshResponse.json();
      expect(refreshedBundle.refresh_token).not.toBe(refreshToken);
      expect(refreshedBundle.access_token).not.toBe(accessToken);

      const meResponse = await request.get(`${relaunched.apiUrl}/auth/me`, {
        headers: {
          Authorization: `Bearer ${refreshedBundle.access_token}`,
        },
      });
      expect(meResponse.ok()).toBeTruthy();
      const mePayload = await meResponse.json();
      expect(mePayload).toMatchObject({
        user: {
          email: reviewer.email,
          roles: ["reviewer"],
        },
      });
    } finally {
      await relaunched.app.close();
    }
  });

  test("[AUTH-024] restricted deep-link redirects safely", async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    const creator = getSeededAccount("creator");
    const { app, page } = await launchDesktop({ actorId: creator.email, actorRoles: "creator" });

    try {
      await loginViaUi(page, {
        email: creator.email,
        password: creator.password,
        expectedRole: "creator",
      });

      await navigateViaNavHit(page, "submission-detail", "submissions");
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#view-submission-detail")).toBeHidden();

      const routeNotice = await page.evaluate(() => (window as any).__workspaceRouteNotice || "");
      expect(routeNotice).toContain("Alias route normalized");
      await expect(page.locator("body")).toHaveAttribute("data-active-view", "submissions");
    } finally {
      await app.close();
    }
  });

  test("[NR-028][NR-029] logout-all and refresh-failure fallback behavior", async ({ request }, testInfo) => {
    testInfo.setTimeout(180_000);
    const admin = getSeededAccount("admin");
    const { app, page, apiUrl } = await launchDesktop({ actorId: admin.email, actorRoles: "admin" });

    try {
      const bundle = await loginBundle(request, apiUrl, admin.email, admin.password);

      await loginViaUi(page, {
        email: admin.email,
        password: admin.password,
        expectedRole: "admin",
      });

      const logoutAllResponse = await request.post(`${apiUrl}/auth/logout-all`, {
        data: {
          access_token: bundle.access_token,
        },
      });
      expect(logoutAllResponse.ok()).toBeTruthy();
      const logoutAllPayload = await logoutAllResponse.json();
      expect(logoutAllPayload).toMatchObject({
        revoked_session_count: expect.any(Number),
      });

      const refreshAfterLogout = await request.post(`${apiUrl}/auth/refresh`, {
        data: {
          refresh_token: bundle.refresh_token,
        },
      });
      expect(refreshAfterLogout.status()).toBe(401);
      const refreshAfterLogoutPayload = await refreshAfterLogout.json();
      expect(refreshAfterLogoutPayload).toMatchObject({
        error: {
          code: "AUTH_UNAUTHORIZED",
        },
      });

      await page.reload();
      await expect(page.locator("#login-form")).toBeVisible();

      await loginViaUi(page, {
        email: admin.email,
        password: admin.password,
        expectedRole: "admin",
      });
      await expect(page.locator("#sidebar-role-badge")).toHaveText("ADMIN");
    } finally {
      await app.close();
    }
  });
});
