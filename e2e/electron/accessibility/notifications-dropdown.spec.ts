import { expect, test } from "@playwright/test";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi, navigateViaNavHit } from "../support";

test.describe("Accessibility dropdown scenarios", () => {
  test("[CR-029] notifications filter dropdown supports keyboard flow, focus return, outside close, and viewport positioning", async () => {
    const { email, password } = getSeededAccount("creator");
    const { app, page, apiUrl } = await launchDesktop({ actorId: email, actorRoles: "creator" });

    try {
      await installRendererApiShim(page, undefined, apiUrl);
      await loginViaUi(page, { email, password });

      await navigateViaNavHit(page, "notifications");
      await page.locator("#notifications-load-button").click();

      const trigger = page.locator("#notifications-severity-trigger");
      const menu = page.locator("#notifications-severity-menu");

      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");

      const selectedBefore = await page.locator("#notifications-severity-label").textContent();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      const selectedAfter = await page.locator("#notifications-severity-label").textContent();
      expect(selectedAfter).not.toEqual(selectedBefore);

      await trigger.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.click();
      await expect(menu).toBeVisible();
      await page.locator("#notifications-title").click();
      await expect(menu).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.click();
      await expect(menu).toBeVisible();
      const placementClass = await menu.getAttribute("class");
      expect(placementClass || "").toMatch(/ui-dropdown-menu--(top|bottom)/);
      const styleTopBefore = await menu.evaluate((el) => el.style.top);
      await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
      const styleTopAfter = await menu.evaluate((el) => el.style.top);
      expect(styleTopAfter).not.toEqual("");
      expect(styleTopBefore).toEqual(styleTopAfter);
    } finally {
      await app.close();
    }
  });
});
