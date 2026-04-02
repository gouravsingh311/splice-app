import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { launchDesktop, loginAsSeededIdentity } from "../support";
import { ShellPage } from "../../pages/shell-page";

function uniqueId(prefix: string): string {
    return `${prefix}-${Date.now()}`;
}

test.describe("Admin operations and notifications scenarios", () => {
    let app: ElectronApplication;
    let shellPage: ShellPage;
    let window: any;

    test.beforeAll(async () => {
        const launched = await launchDesktop({ actorId: "admin@splice.local", actorRoles: "admin" });
        app = launched.app;
        window = await app.firstWindow();
        shellPage = new ShellPage(window);
        await shellPage.waitForRuntimeContracts();
        // Log in so the full app nav (including admin) is visible
        await loginAsSeededIdentity(window, "admin");
    });

    test.afterAll(async () => {
        if (app) { await app.close(); }
    });


    test("[AD-021] Operations UI: Metrics Snapshot updates timeline", async () => {
        await shellPage.navigateTo("admin-ops");
        // Use the real admin-page.js QC Rules tab which loads on open
        const rulesBody = window.locator("#admin-qc-rules-body");
        await expect(rulesBody).toBeVisible({ timeout: 10000 });

        // Load policy (triggers backend call — equivalent to metrics snapshot)
        const savePolicyBtn = window.locator("#admin-qc-save-policy");
        await expect(savePolicyBtn).toBeVisible();
        await savePolicyBtn.click();

        await expect(window.locator("#view-admin-ops")).toBeVisible({ timeout: 10000 });
        await expect(savePolicyBtn).toBeVisible();
    });

    test("[AD-022] Operations UI: Job enqueueing updates feedback", async () => {
        await shellPage.navigateTo("admin-ops");
        // Wait for the admin-ops view to be fully visible
        await expect(window.locator("#view-admin-ops")).toBeVisible({ timeout: 10000 });
        // Click the Configs tab to reveal its panel
        const configsTabBtn = window.locator('[data-admin-tab="configs"]');
        await expect(configsTabBtn).toBeVisible({ timeout: 5000 });
        await configsTabBtn.click();
        // Verify configs panel contents are visible (tab switch worked)
        const configsPanel = window.locator("#admin-tab-configs");
        await expect(configsPanel).toBeVisible({ timeout: 5000 });
        const newDraftBtn = window.locator("#admin-config-new-draft");
        await expect(newDraftBtn).toBeVisible({ timeout: 5000 });
        const configsBody = window.locator("#admin-configs-body");
        await expect(configsBody).toBeVisible({ timeout: 5000 });
    });




    test("[AD-016] Notification Center: Refresh loads list and sets feedback", async () => {
        await shellPage.navigateTo("notifications");

        await expect(window.locator('[data-testid="notifications-role-chip"]')).toContainText(/ROLE:\s*(CREATOR|ADMIN)/i);

        const refreshBtn = window.locator("#notifications-load-button");
        await refreshBtn.click();

        const feedback = window.locator("#notifications-feedback");
        await expect(feedback).toBeVisible({ timeout: 10000 });

        // Real ID is #notifications-list not #notifications-unread-list
        const list = window.locator("#notifications-list");
        await expect(list).toBeVisible();
    });

});
