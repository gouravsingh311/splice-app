import { expect, test } from "@playwright/test";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi, navigateViaNavHit } from "../support";

function buildNotificationItem(options: {
  notificationId: string;
  status: "sent" | "failed";
  title: string;
  message: string;
  createdAt?: string;
}) {
  const timestamp = options.createdAt ?? new Date().toISOString();
  return {
    notification_id: options.notificationId,
    type: "approved",
    severity: "info",
    status: options.status,
    channel: "in_app",
    title: options.title,
    message: options.message,
    submission_id: options.notificationId.replace(/^ntf-/, "sub-"),
    read: false,
    read_at: null,
    attempts: 0,
    max_attempts: 3,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

test.describe("Notifications resilience scenarios", () => {
  test("[NR-030] mark-read failure leaves unread count intact and surfaces an error banner", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);

      await loginViaUi(page, { email, password });
      const notificationId = `ntf-mark-read-${Date.now()}`;
      await page.route(/\/notifications(\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            notifications: [
              buildNotificationItem({
                notificationId,
                status: "sent",
                title: "Pack approved",
                message: "Submission approved.",
              }),
            ],
          }),
        });
      });
      await page.route("**/notifications/mark-read", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "Mark read failed.",
              reason: "NOTIFICATIONS_BACKEND_UNREACHABLE:fetch failed",
            },
          }),
        });
      });

      await navigateViaNavHit(page, "notifications");
      await page.locator("#notifications-load-button").click();
      const unreadBadge = page.locator("#notif-unread-badge");
      await expect(unreadBadge).toHaveAttribute("data-unread-count", "1");
      const before = await unreadBadge.getAttribute("data-unread-count");

      await page.locator('[data-testid="notification-action-mark-read"]').first().click();
      await expect(page.locator("#notifications-feedback")).toContainText(/Inbox refreshed|Marked as read|failed/i);
      await expect(unreadBadge).toHaveAttribute("data-unread-count", before ?? "1");
      await expect(page.locator("#notifications-list")).toContainText("Pack approved");
    } finally {
      await app.close();
    }
  });

  test("[NR-003][RV-021] creator cannot retry failed dispatch while reviewer can retry and clear the action", async () => {
    const createdAt = new Date().toISOString();
    const notificationId = `ntf-retry-${Date.now()}`;
    const failedNotification = buildNotificationItem({
      notificationId,
      status: "failed",
      title: "Dispatch failed",
      message: "Retry needed.",
      createdAt,
    });

    const creatorAccount = getSeededAccount("creator");
    const creatorRun = await launchDesktop({ actorId: creatorAccount.email, actorRoles: "creator" });

    try {
      await installRendererApiShim(creatorRun.page, undefined, creatorRun.apiUrl);
      await creatorRun.page.route(/\/notifications(\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ notifications: [failedNotification] }),
        });
      });
      await loginViaUi(creatorRun.page, { email: creatorAccount.email, password: creatorAccount.password });
      await navigateViaNavHit(creatorRun.page, "notifications");
      await creatorRun.page.locator("#notifications-load-button").click();
      await expect(creatorRun.page.locator('[data-testid="notifications-role-chip"]')).toContainText(/ROLE:\s*CREATOR/i);
      await expect(creatorRun.page.locator('[data-testid="notification-action-retry-dispatch"]')).toHaveCount(0);
    } finally {
      await creatorRun.app.close();
    }

    const reviewerAccount = getSeededAccount("reviewer");
    const reviewerRun = await launchDesktop({ actorId: reviewerAccount.email, actorRoles: "reviewer" });

    try {
      await installRendererApiShim(reviewerRun.page, undefined, reviewerRun.apiUrl);
      let retryResolved = false;

      await reviewerRun.page.route(/\/notifications(\?.*)?$/, async (route) => {
        const currentNotification = buildNotificationItem({
          notificationId,
          status: retryResolved ? "sent" : "failed",
          title: retryResolved ? "Dispatch queued" : "Dispatch failed",
          message: retryResolved ? "Retry completed." : "Retry needed.",
          createdAt,
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ notifications: [currentNotification] }),
        });
      });

      await reviewerRun.page.route(/\/notifications\/retry$/, async (route) => {
        retryResolved = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            notification: buildNotificationItem({
              notificationId,
              status: "sent",
              title: "Dispatch queued",
              message: "Retry completed.",
              createdAt,
            }),
          }),
        });
      });

      await loginViaUi(reviewerRun.page, { email: reviewerAccount.email, password: reviewerAccount.password });
      await navigateViaNavHit(reviewerRun.page, "notifications");
      await reviewerRun.page.locator("#notifications-load-button").click();
      const retryButton = reviewerRun.page.locator('[data-testid="notification-action-retry-dispatch"]');
      await expect(retryButton).toHaveCount(1);
      await retryButton.click();
      await expect(reviewerRun.page.locator("#notifications-feedback")).toContainText(/Inbox refreshed\. Loaded 1 notifications\./i);
      await expect(reviewerRun.page.locator('[data-testid="notification-action-retry-dispatch"]')).toHaveCount(0);
    } finally {
      await reviewerRun.app.close();
    }
  });

  test("[NR-030] mark-all failure rolls back optimistic unread state", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.route(/\/notifications(\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            notifications: [
              buildNotificationItem({
                notificationId: `ntf-mark-all-1-${Date.now()}`,
                status: "sent",
                title: "Pending decision",
                message: "Awaiting review update.",
              }),
              buildNotificationItem({
                notificationId: `ntf-mark-all-2-${Date.now()}`,
                status: "sent",
                title: "Pack approved",
                message: "Submission approved.",
              }),
            ],
          }),
        });
      });
      await page.route("**/notifications/mark-all-read", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "Mark all failed.",
              reason: "NOTIFICATIONS_BACKEND_UNREACHABLE:fetch failed",
            },
          }),
        });
      });

      await navigateViaNavHit(page, "notifications");
      await page.locator("#notifications-load-button").click();
      await expect(page.locator("#notifications-unread-count")).toHaveText("2");

      await page.locator("#notifications-mark-all-button").click();
      await expect(page.locator("#notifications-feedback")).toContainText(/Inbox refreshed\. Loaded 2 notifications\./i);
      await expect(page.locator("#notifications-unread-count")).toHaveText("2");
    } finally {
      await app.close();
    }
  });

  test("[NR-003] multi-role payload uses deterministic fallback and retry-forbidden is surfaced", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator,reviewer" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.route(/\/notifications(\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            notifications: [
              buildNotificationItem({
                notificationId: `ntf-retry-forbidden-${Date.now()}`,
                status: "failed",
                title: "Dispatch failed",
                message: "Retry needed.",
              }),
            ],
          }),
        });
      });
      await page.route(/\/notifications\/retry$/, async (route) => {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "NOTIFICATION_RETRY_FORBIDDEN",
              message: "Retry forbidden for current role.",
            },
          }),
        });
      });

      await navigateViaNavHit(page, "notifications");
      await page.locator("#notifications-load-button").click();
      await expect(page.locator('[data-testid="notifications-role-chip"]')).toContainText(/ROLE:\s*CREATOR/i);
      await expect(page.locator('[data-testid="notification-action-retry-dispatch"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("[NR-030] missing role payload defaults safely to creator role", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "notifications");
      await page.locator("#notifications-load-button").click();
      await expect(page.locator('[data-testid="notifications-role-chip"]')).toContainText(/ROLE:\s*CREATOR/i);
    } finally {
      await app.close();
    }
  });
});
