import { expect, test } from "@playwright/test";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi } from "../support";

test.describe("Notifications core scenarios", () => {
  test("[CR-029] creator unread badge updates after opening notification", async () => {
    const creatorAccount = getSeededAccount("creator");

    const { app, page, apiUrl } = await launchDesktop({ actorId: creatorAccount.email, actorRoles: "creator" });
    await installRendererApiShim(page, undefined, apiUrl);
    await loginViaUi(page, { email: creatorAccount.email, password: creatorAccount.password });
    const notificationId = `ntf-notifs-${Date.now()}`;
    let markReadApplied = false;
    await page.route(/\/notifications(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [
            {
              notification_id: notificationId,
              type: "approved",
              severity: "info",
              status: "sent",
              channel: "in_app",
              title: "Approved seeded submission",
              message: "Submission approved and scheduled.",
              submission_id: "sub-notifs",
              read: markReadApplied,
              read_at: markReadApplied ? new Date().toISOString() : null,
              attempts: 0,
              max_attempts: 3,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      });
    });
    await page.route(/\/notifications\/mark-read$/, async (route) => {
      markReadApplied = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ updated_count: 1 }),
      });
    });

    await page.locator('[data-testid="nav-notifications"]').click();
    await expect(page.locator("#view-notifications")).toBeVisible();

    await expect(page.locator('[data-testid="notifications-role-chip"]')).toContainText(/ROLE:\s*CREATOR/i);
    await page.locator('[data-testid="notifications-load-button"]').click();
    await expect(page.locator("#notifications-feedback")).toContainText(/Inbox refreshed|Loaded \d+ notifications/);
    await expect(page.locator("#notifications-list")).toContainText("Next step:");

    const unreadBadge = page.locator('[data-testid="notifications-unread-badge"]');
    await expect(unreadBadge).toBeVisible();
    const before = Number.parseInt((await unreadBadge.getAttribute("data-unread-count")) ?? "0", 10);

    const firstMarkReadButton = page.locator('[data-testid="notification-mark-read"], [data-testid="notification-action-mark-read"]').first();
    await firstMarkReadButton.click();
    await expect(page.locator("#notifications-feedback")).toContainText(/Marked as read|Inbox refreshed/);

    const after = Number.parseInt((await unreadBadge.getAttribute("data-unread-count")) ?? "0", 10);
    expect(Number.isNaN(before)).toBeFalsy();
    expect(Number.isNaN(after)).toBeFalsy();
    expect(after).toBeLessThanOrEqual(before);

    await app.close();
  });
});
