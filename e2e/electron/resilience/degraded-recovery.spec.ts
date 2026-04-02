import { expect, test } from "@playwright/test";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi, navigateViaNavHit } from "../support";

test.describe("Resilience degraded-recovery scenarios", () => {
  test("[CR-030] creator workspace distinguishes no-data and backend-unreachable states", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });
      await page.evaluate(() => {
        (window as any).electronAPI.submissions.list = async () => ({
          ok: true,
          data: { submissions: [] },
        });
      });
      await navigateViaNavHit(page, "submissions");

      await expect(page.locator("#workspace-main-panel")).toContainText(/No submissions yet/i);

      await page.evaluate(() => {
        (window as any).electronAPI.submissions.list = async () => ({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            reason: "OPERATIONS_BACKEND_UNREACHABLE:fetch failed",
            message: "Operations backend is unavailable",
          },
        });
        (window as any).viewSubmissions.wire();
      });

      await expect(page.locator("#workspace-feedback")).toContainText(/backend unreachable/i);
    } finally {
      await app.close();
    }
  });

  test("[RV-001] reviewer queue shows explicit backend-unreachable recovery guidance", async () => {
    const { email, password } = getSeededAccount("reviewer");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "reviewer" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "reviewer-queue");

      await page.evaluate(() => {
        const failingListQueue = async () => ({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            reason: "OPERATIONS_BACKEND_UNREACHABLE:fetch failed",
            message: "Operations backend is unavailable",
          },
        });
        const nextBridge = {
          ...(window as any).splice,
          review: {
            ...(window as any).splice.review,
            listQueue: failingListQueue,
          },
        };
        (window as any).splice = nextBridge;
        (window as any).electronAPI = nextBridge;
        if ((window as any).reviewQueuePage?.wire) {
          (window as any).reviewQueuePage.wire({ api: nextBridge });
        }
      });

      await page.locator("#review-queue-refresh").click();
      await expect(page.locator("#review-queue-feedback")).toContainText(/backend is unreachable/i);
      await expect(page.locator("#review-queue-tbody")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[NR-030] notifications preserves continuity on partial failure and gives safe retry guidance", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await page.route(/\/notifications(\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            notifications: [
              {
                notification_id: `ntf-degraded-${Date.now()}`,
                type: "approved",
                severity: "info",
                status: "sent",
                channel: "in_app",
                title: "Approved degraded-notifications-pack",
                message: "Submission approved.",
                submission_id: "sub-degraded-notifs",
                read: false,
                read_at: null,
                attempts: 0,
                max_attempts: 3,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          }),
        });
      });

      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "notifications");

      await expect(page.locator('[data-testid="notifications-role-chip"]')).toContainText(/ROLE:\s*CREATOR/i);
      await page.locator("#notifications-load-button").click();
      await expect(page.locator("#notifications-feedback")).toContainText(/loaded \d+ notifications/i);

      const initialCards = await page.locator("#notifications-list .notification-card").count();
      expect(initialCards).toBeGreaterThan(0);

      await page.evaluate(() => {
        (window as any).electronAPI.notifications.list = async () => ({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            reason: "NOTIFICATIONS_BACKEND_UNREACHABLE:fetch failed",
            message: "Notifications backend is unavailable",
          },
        });
      });

      await page.locator("#notifications-load-button").click();
      await expect(page.locator("#notifications-feedback")).toContainText(/showing last loaded notifications/i);
      await expect(page.locator("#notifications-list .notification-card").first()).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[CR-030] shell navigation remains usable after degraded notifications fetch", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "notifications");

      await page.evaluate(() => {
        (window as any).electronAPI.notifications.list = async () => ({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            reason: "NOTIFICATIONS_BACKEND_UNREACHABLE:fetch failed",
            message: "Notifications backend is unavailable",
          },
        });
      });

      await page.locator("#notifications-load-button").click();
      await expect(page.locator("#notifications-feedback")).toContainText(/backend is unreachable/i);

      await navigateViaNavHit(page, "dashboard");
      await expect(page.locator("#view-dashboard")).toBeVisible();
      await navigateViaNavHit(page, "submissions");
      await expect(page.locator("#view-submissions")).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
