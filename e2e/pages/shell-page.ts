import { expect, type Locator, type Page } from "@playwright/test";

export class ShellPage {
  readonly heading: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole("heading", { level: 1, name: "Auth & Access" });
  }

  async waitForRuntimeContracts() {
    await expect(this.heading).toBeVisible();
  }

  async navigateTo(navId: string) {
    const navBtn = this.page.locator(`#sidebar-primary-nav [data-nav="${navId}"]`);
    await navBtn.click();
  }
}
