import { expect, test } from "@playwright/test";

import {
  getSeededAccount,
  installRendererApiShim,
  launchDesktop,
  loginViaUi,
  navigateViaNavHit,
} from "../support";

test.describe("Creator dashboard scenarios", () => {
  test("[CR-028] dashboard shows parity nav labels, KPI block, hero CTA, and recent activity table", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.submissions.list = async () => ({
          ok: true,
          data: {
            submissions: [
              {
                submissionId: "sub-1",
                creatorId: "creator-1",
                currentState: "under_review",
                version: 1,
                packName: "Cinematic Industrial Vol. 4",
                updatedAt: "2026-03-06T10:00:00Z",
              },
              {
                submissionId: "sub-2",
                creatorId: "creator-1",
                currentState: "approved",
                version: 1,
                packName: "Deep Space Textures",
                updatedAt: "2026-03-05T10:00:00Z",
              },
              {
                submissionId: "sub-3",
                creatorId: "creator-1",
                currentState: "draft",
                version: 1,
                packName: "Vintage Analog Percussion",
                updatedAt: "2026-03-04T10:00:00Z",
              },
              {
                submissionId: "sub-4",
                creatorId: "creator-1",
                currentState: "qc_failed",
                version: 1,
                packName: "Cyberpunk Glitch Fx",
                updatedAt: "2026-03-03T10:00:00Z",
              },
            ],
          },
        });
        api.notifications.list = async () => ({
          ok: true,
          data: {
            notifications: [
              { notificationId: "n1", read: false },
              { notificationId: "n2", read: false },
              { notificationId: "n3", read: true },
            ],
          },
        });
        if ((window as any).viewDashboard?.refresh) {
          (window as any).viewDashboard.refresh();
        }
      });

      await navigateViaNavHit(page, "dashboard");

      await expect(page.locator(".fe-topnav-nav .fe-nav-item:not(.hidden)")).toHaveCount(4);
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
      expect(creatorLabels.some((label) => /^Notifications\b/.test(label))).toBeTruthy();
      expect(creatorLabels).toContain("Settings");

      await expect(page.locator("#dashboard-kpis")).toContainText("Total");
      await expect(page.locator("#dashboard-kpis")).toContainText("Under Review");
      await expect(page.locator("#dashboard-kpis")).toContainText("Approved");
      await expect(page.locator("#dashboard-kpis")).toContainText("QC Failed");
      await expect(page.locator("#dashboard-kpi-total")).toHaveText("4");
      await expect(page.locator("#dashboard-kpi-under-review")).toHaveText("1");
      await expect(page.locator("#dashboard-kpi-approved")).toHaveText("1");
      await expect(page.locator("#dashboard-kpi-qc-failed")).toHaveText("1");

      await expect(page.locator("#dashboard-hero-cta")).toContainText("Start New Pack Submission");
      await expect(page.locator("#dashboard-create-pack")).toContainText("Create New Pack");

      await expect(page.locator("#view-dashboard")).toContainText("Recent Activity");
      await expect(page.locator("#dashboard-recent-activity-body")).toContainText("Cinematic Industrial Vol. 4");
      await expect(page.locator("#dashboard-recent-activity-body")).toContainText("Deep Space Textures");
      await expect(page.locator("#dashboard-recent-activity-body")).toContainText("Vintage Analog Percussion");
      await expect(page.locator("#dashboard-recent-activity-body")).toContainText("Cyberpunk Glitch Fx");
    } finally {
      await app.close();
    }
  });

  test("[CR-021] dashboard shows creator-safe zero-data empty state when submissions list is successful but empty", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.submissions.list = async () => ({
          ok: true,
          data: {
            submissions: [],
          },
        });
        api.notifications.list = async () => ({
          ok: true,
          data: {
            notifications: [],
          },
        });
        if ((window as any).viewDashboard?.refresh) {
          (window as any).viewDashboard.refresh();
        }
      });

      await navigateViaNavHit(page, "dashboard");
      await expect(page.locator("#dashboard-kpi-total")).toHaveText("0");
      await expect(page.locator("#dashboard-submissions-error")).toBeHidden();
      await expect(page.locator("#dashboard-recent-activity-body")).toContainText(
        "No creator submissions yet. Use Create New Pack to start the canonical submissions workflow.",
      );
      await expect(page.locator("#dashboard-recent-activity-body")).not.toContainText("Submission service unavailable");
    } finally {
      await app.close();
    }
  });

  test("[CR-030] dashboard shows API-unavailable state with explicit next-step guidance", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.submissions.list = async () => ({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            reason: "OPERATIONS_BACKEND_UNREACHABLE:connect ECONNREFUSED 127.0.0.1:8017",
            message: "Operations backend is unavailable",
          },
        });
        api.notifications.list = async () => ({
          ok: true,
          data: {
            notifications: [],
          },
        });
        if ((window as any).viewDashboard?.refresh) {
          (window as any).viewDashboard.refresh();
        }
      });

      await navigateViaNavHit(page, "dashboard");
      await expect(page.locator("#dashboard-kpi-total")).toHaveText("0");
      await expect(page.locator("#dashboard-submissions-error")).toBeVisible();
      await expect(page.locator("#dashboard-submissions-status")).toContainText(
        "Dashboard data is temporarily unavailable.",
      );
      await expect(page.locator("#dashboard-submissions-status")).toContainText(
        "Next step: confirm the FileEaters backend service is running, verify your network connection, then select Retry Dashboard Data.",
      );
      await expect(page.locator("#dashboard-recent-activity-body")).toContainText(
        "Submission service unavailable. Start the backend service, check connectivity, then retry dashboard data.",
      );
    } finally {
      await app.close();
    }
  });

  test("[CR-028] dashboard aliases route safely into canonical submissions flow", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.submissions.list = async () => ({
          ok: true,
          data: {
            submissions: [
              {
                submissionId: "sub-draft",
                creatorId: "creator-1",
                currentState: "draft",
                version: 2,
                packName: "Dashboard Draft Pack",
                labelName: "Creator Label",
                releaseMonth: "2026-03",
                notes: "Resume from dashboard",
                tags: [],
                airtableFormCompleted: true,
                airtablePayloadChecksum: "checksum-draft",
                airtableSyncStatus: "linked",
                updatedAt: "2026-03-06T10:00:00Z",
              },
              {
                submissionId: "sub-approved",
                creatorId: "creator-1",
                currentState: "approved",
                version: 4,
                packName: "Dashboard Approved Pack",
                labelName: "Creator Label",
                releaseMonth: "2026-02",
                notes: "Already reviewed",
                tags: [],
                airtableFormCompleted: true,
                airtablePayloadChecksum: "checksum-approved",
                airtableSyncStatus: "linked",
                updatedAt: "2026-03-05T10:00:00Z",
              },
            ],
          },
        });
        api.submissions.timeline = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            timeline:
              submissionId === "sub-draft"
                ? [
                    { toState: "rejected", createdAt: "2026-03-06T09:00:00Z", reason: "Needs fixes" },
                    { toState: "draft", createdAt: "2026-03-06T10:00:00Z", reason: "Reopened" },
                  ]
                : [
                    { toState: "under_review", createdAt: "2026-03-05T09:00:00Z", reason: "Submitted" },
                    { toState: "approved", createdAt: "2026-03-05T10:00:00Z", reason: "Approved" },
                  ],
          },
        });
        if ((window as any).viewDashboard?.refresh) {
          (window as any).viewDashboard.refresh();
        }
      });
      await navigateViaNavHit(page, "dashboard");

      await page.getByRole("button", { name: "Create New Pack" }).click();
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#workspace-pack-name")).toBeVisible();

      await navigateViaNavHit(page, "dashboard");
      await page.getByRole("button", { name: "View All History" }).click();
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#workspace-main-panel")).toContainText(/Submission History|No submissions yet/);

      await expect(page.locator('#sidebar-primary-nav [data-nav="upload-qc"]')).toHaveCount(0);
      await expect(page.locator('#sidebar-primary-nav [data-nav="qc-results"]')).toHaveCount(0);
      await expect(page.locator('#sidebar-primary-nav [data-nav="submission-detail"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("[CR-028] dashboard recent activity rows deep-link into canonical submission modes", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.submissions.list = async () => ({
          ok: true,
          data: {
            submissions: [
              {
                submissionId: "sub-draft-deeplink",
                creatorId: "creator-1",
                currentState: "draft",
                version: 5,
                packName: "Deep Link Draft Pack",
                labelName: "Creator Label",
                releaseMonth: "2026-03",
                notes: "Resume me",
                tags: [],
                airtableFormCompleted: true,
                airtablePayloadChecksum: "checksum-draft",
                airtableSyncStatus: "linked",
                updatedAt: "2026-03-06T10:00:00Z",
              },
              {
                submissionId: "sub-approved-deeplink",
                creatorId: "creator-1",
                currentState: "approved",
                version: 6,
                packName: "Deep Link Approved Pack",
                labelName: "Creator Label",
                releaseMonth: "2026-02",
                notes: "Timeline only",
                tags: [],
                airtableFormCompleted: true,
                airtablePayloadChecksum: "checksum-approved",
                airtableSyncStatus: "linked",
                updatedAt: "2026-03-05T10:00:00Z",
              },
            ],
          },
        });
        api.submissions.timeline = async ({ submissionId }: any) => ({
          ok: true,
          data: {
            timeline:
              submissionId === "sub-draft-deeplink"
                ? [
                    { toState: "rejected", createdAt: "2026-03-06T09:00:00Z", reason: "Needs fixes" },
                    { toState: "draft", createdAt: "2026-03-06T10:00:00Z", reason: "Reopened" },
                  ]
                : [
                    { toState: "under_review", createdAt: "2026-03-05T09:00:00Z", reason: "Submitted" },
                    { toState: "approved", createdAt: "2026-03-05T10:00:00Z", reason: "Approved" },
                  ],
          },
        });
        if ((window as any).viewDashboard?.refresh) {
          (window as any).viewDashboard.refresh();
        }
      });

      await navigateViaNavHit(page, "dashboard");
      await expect(page.locator('[data-submission-id="sub-draft-deeplink"]')).toBeVisible();
      await page.locator('[data-submission-id="sub-draft-deeplink"]').click();
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Reopened for amendment");
      await expect(page.locator("#workspace-main-panel")).toContainText("Pack Folder");
      await page.locator('#wizard-prev-btn').click();
      await expect(page.locator("#workspace-pack-name")).toHaveValue("Deep Link Draft Pack");
      await expect(page.locator("#workspace-label-name")).toHaveValue("Creator Label");
      await expect(page.locator("#workspace-release-month")).toHaveValue("2026-03");

      await navigateViaNavHit(page, "dashboard");
      await expect(page.locator('[data-submission-id="sub-approved-deeplink"]')).toBeVisible();
      await page.locator('[data-submission-id="sub-approved-deeplink"]').click();
      await expect(page.locator("#view-submissions")).toBeVisible();
      await expect(page.locator("#workspace-lifecycle-banner")).toContainText("Lifecycle status");
      await expect(page.locator("#workspace-main-panel")).toContainText("Timeline");
    } finally {
      await app.close();
    }
  });
});
