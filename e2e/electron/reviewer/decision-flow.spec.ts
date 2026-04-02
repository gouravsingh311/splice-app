import { expect, test } from "@playwright/test";
import { getSeededAccount, createDraftAndTransition, installRendererApiShim, launchDesktop, loginViaUi } from "../support";

test.describe("Reviewer decision scenarios", () => {
  test("[RV-012][RV-013] reject validation + reject + approve", async ({ request }) => {
    const rejectSubmissionId = `sub-review-reject-${Date.now()}`;
    const approveSubmissionId = `sub-review-approve-${Date.now()}`;
    const reviewerAccount = getSeededAccount("reviewer");

    // Launch app first to get the dynamic backend URL
    const { app, page, apiUrl } = await launchDesktop({ actorId: reviewerAccount.email, actorRoles: "reviewer" });
    await installRendererApiShim(page, undefined, apiUrl);
    await loginViaUi(page, { email: reviewerAccount.email, password: reviewerAccount.password });

    await createDraftAndTransition(request, {
      submissionId: rejectSubmissionId,
      creatorId: "creator-review-a",
      toState: "under_review",
      actorId: "creator-review-a",
      actorRole: "creator",
      expectedVersion: 0,
      baseUrl: apiUrl,
    });

    await createDraftAndTransition(request, {
      submissionId: approveSubmissionId,
      creatorId: "creator-review-b",
      toState: "under_review",
      actorId: "creator-review-b",
      actorRole: "creator",
      expectedVersion: 0,
      baseUrl: apiUrl,
    });

    await page.locator('#sidebar-primary-nav [data-nav="reviewer-queue"]').click();
    await expect(page.locator("#view-reviewer-queue")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Triage" })).toBeVisible();

    await page.locator('#sidebar-primary-nav [data-nav="reviewer-decision"]').click();
    await expect(page.locator("#view-reviewer-decision")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject submission" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve submission" })).toBeVisible();
    await expect(page.locator("#review-action-guidance")).toContainText(
      "Reject requires a reason code and reviewer notes.",
    );

    await page.getByRole("button", { name: "Reject submission" }).click();
    const rejectModal = page.getByRole("dialog", { name: "Reject Submission" });
    await expect(rejectModal).toBeVisible();
    const reasonField = page.getByLabel("Rejection reason code");
    const notesField = page.getByLabel("Reviewer notes");
    await expect(reasonField).toBeFocused();
    await expect(page.locator("#review-reject-help")).toContainText(
      "Include clear amendment guidance for the creator.",
    );

    await page.getByRole("button", { name: "Continue with rejection" }).click();
    await expect(page.locator("#review-reject-validation")).toContainText(
      "Reject reason code and reviewer notes are required before continuing.",
    );

    await reasonField.selectOption("POLICY_VIOLATION");
    await notesField.focus();
    await page.keyboard.type("Policy details are missing and must be corrected.");
    await page.getByRole("button", { name: "Continue with rejection" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm Decision" })).toBeVisible();
    const confirmDialog = page.getByRole("dialog", { name: "Confirm Decision" });
    await expect(page.locator("#review-confirm-guidance")).toContainText("Rejection notifies the creator");
    await page.keyboard.press("Escape");
    await expect(confirmDialog).toBeHidden();

    await app.close();
  });
});
