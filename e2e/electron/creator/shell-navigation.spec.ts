import { expect, test } from "@playwright/test";

import {
  getSeededAccount,
  launchDesktop,
  loginViaUi,
  navigateViaNavHit,
} from "../support";

test.describe("Creator shell/navigation scenarios", () => {
  test("[CR-001] creator shell shows parity nav labels while preserving canonical route ids", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await loginViaUi(page, { email, password });

      const visibleNavIds = await page
        .locator(".fe-topnav-nav .fe-nav-item:not(.hidden)")
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node as HTMLElement).dataset.nav || "")
            .filter((value) => value.length > 0),
        );

      expect(visibleNavIds.filter((navId) => navId !== "auth")).toEqual([
        "dashboard",
        "submissions",
        "notifications",
        "settings",
      ]);

      const creatorLabels = await page
        .locator(".fe-topnav-nav .fe-nav-item:not(.hidden)")
        .evaluateAll((nodes) =>
          nodes.map((node) => ((node as HTMLElement).innerText || "").trim()).filter(Boolean),
        );

      expect(creatorLabels).toContain("Dashboard");
      expect(creatorLabels).toContain("Submissions");
      expect(creatorLabels.some((label) => label.startsWith("Notifications"))).toBeTruthy();
      expect(creatorLabels).toContain("Settings");

      await expect(page.locator('#sidebar-primary-nav [data-nav="upload-qc"]')).toHaveCount(0);
      await expect(page.locator('#sidebar-primary-nav [data-nav="qc-results"]')).toHaveCount(0);
      await expect(page.locator('#sidebar-primary-nav [data-nav="submission-detail"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("[CR-028] dashboard quick actions follow creator-primary flow", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "dashboard");

      await page.getByRole("button", { name: "Create New Pack" }).click();
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#view-submissions")).toContainText("Creator Workspace");

      await navigateViaNavHit(page, "dashboard");
      await page.getByRole("button", { name: "Open Inbox" }).click();
      await expect(page.locator("#view-notifications")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("[AUTH-023] settings renders creator-safe content without diagnostics controls", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await loginViaUi(page, { email, password });
      await navigateViaNavHit(page, "settings");

      await expect(page.locator("#view-settings")).toContainText("Creator Settings");
      await expect(page.locator("#view-settings")).toContainText("Notification Preferences");

      await expect(page.locator("#view-settings")).not.toContainText("Desktop Security");
      await expect(page.locator("#view-settings")).not.toContainText("Run Security Check");
      await expect(page.locator("#view-settings")).not.toContainText("Audit Events");

      await expect(page.locator("#environment-name")).toHaveCount(0);
      await expect(page.locator("#health-port")).toHaveCount(0);
      await expect(page.locator("#electron-version")).toHaveCount(0);
      await expect(page.locator("#chrome-version")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("[CR-001] shell navigation sets deterministic focus and aria-current state", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await loginViaUi(page, { email, password });

      await page.locator('[data-testid="nav-notifications"]').click();
      await expect(page.locator('#view-notifications [data-view-title]')).toBeFocused();
      await expect(page.locator('#sidebar-primary-nav [data-nav="notifications"][aria-current="page"]')).toHaveCount(1);

      await page.locator('[data-testid="nav-settings"]').click();
      await expect(page.locator('#view-settings h2, #view-settings h1')).toBeFocused();
      await expect(page.locator('#sidebar-primary-nav [data-nav="settings"][aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('#sidebar-primary-nav [data-nav="notifications"][aria-current="page"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("[AUTH-023] role switches update shell identity and gating", async () => {
    const creator = getSeededAccount("creator");
    const reviewer = getSeededAccount("reviewer");
    const { app, page } = await launchDesktop({ actorId: creator.email, actorRoles: "creator" });

    try {
      await loginViaUi(page, { email: creator.email, password: creator.password });
      await expect(page.locator("#sidebar-role-badge")).toHaveText("CREATOR");
      await expect(page.locator('[data-testid="nav-reviewer-queue"]')).toBeHidden();
      await expect(page.locator('[data-testid="nav-admin-ops"]')).toBeHidden();
      const creatorActorLabel = await page.locator("#sidebar-actor-label").textContent();

      await page.locator("#profile-menu-trigger").click();
      await page.locator("#sidebar-signout-btn").click();
      await expect(page.locator("#view-auth")).toBeVisible();

      await loginViaUi(page, { email: reviewer.email, password: reviewer.password });
      await expect(page.locator("#sidebar-role-badge")).toHaveText("REVIEWER");
      await expect(page.locator('[data-testid="nav-reviewer-queue"]')).toBeVisible();
      await expect(page.locator('[data-testid="nav-admin-ops"]')).toBeHidden();
      await expect(page.locator("#sidebar-actor-label")).not.toHaveText(creatorActorLabel || "");
      await expect(page.locator("#sidebar-actor-label")).not.toBeEmpty();
    } finally {
      await app.close();
    }
  });
});
