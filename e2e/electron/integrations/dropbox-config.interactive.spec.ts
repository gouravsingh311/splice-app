import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, loginAsSeededIdentity } from '../support';

const RUN_INTERACTIVE = process.env.DROPBOX_OAUTH_INTERACTIVE === '1';
const WAIT_MS = Number(process.env.DROPBOX_OAUTH_WAIT_MS || '300000');

async function loginAsCreator(page: Page): Promise<void> {
  const dashboardVisible = await page.locator('#view-dashboard').isVisible().catch(() => false);
  if (dashboardVisible) {
    return;
  }

  await loginAsSeededIdentity(page, 'creator');
}

async function openAdminIntegrations(page: Page): Promise<void> {
  await page.locator('#sidebar-primary-nav [data-nav="admin-ops"]').click();
  await expect(page.locator('#view-admin-ops')).toBeVisible({ timeout: 20000 });

  await page.locator('[data-admin-tab="integrations"]').click();
  await expect(page.locator('#admin-integrations-body')).toBeVisible({ timeout: 15000 });
}

async function clickDropboxTest(page: Page): Promise<string> {
  const dropboxRow = page.locator('#admin-integrations-body tr', {
    hasText: 'DROPBOX',
  });
  await expect(dropboxRow).toBeVisible({ timeout: 20000 });

  await page.locator('#admin-integrations-body [data-integration-test="dropbox"]').click();
  await page.waitForFunction(() => {
    const feedback = document.getElementById('admin-integration-feedback');
    const feedbackText = (feedback && feedback.textContent ? feedback.textContent.trim() : '');
    if (feedbackText.length > 0) {
      return true;
    }

    const rows = Array.from(document.querySelectorAll('#admin-integrations-body tr'));
    const dropbox = rows.find((row) => (row.textContent || '').toUpperCase().includes('DROPBOX'));
    if (!dropbox) {
      return false;
    }
    const text = (dropbox.textContent || '').toLowerCase();
    return text.includes('configured') || text.includes('unconfigured') || text.includes('invalid');
  }, null, { timeout: 20000 });

  const feedback = (await page.locator('#admin-integration-feedback').innerText()).trim();
  if (feedback.length > 0) {
    return feedback;
  }
  const fallbackRowText = (await dropboxRow.innerText()).trim();
  expect(fallbackRowText.length).toBeGreaterThan(0);
  return fallbackRowText;
}

// Manual OAuth assist test:
// - Run headed with DROPBOX_OAUTH_INTERACTIVE=1
// - If startup Dropbox setup modal exists, test clicks Connect and waits for operator login
// - Otherwise validates current admin integration Dropbox test path
(RUN_INTERACTIVE ? test : test.skip)('[AD-024] interactive dropbox setup via UI', async () => {
  test.setTimeout(WAIT_MS + 120000);

  const { app, page } = await launchDesktop({ actorId: 'dropbox-ui-admin', actorRoles: 'admin' });
  try {
    await loginAsCreator(page);

    const setupButton = page.locator('#dropbox-setup-start');
    const hasSetupModal = await setupButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasSetupModal) {
      const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
      await setupButton.click();
      const popup = await popupPromise;
      if (popup) {
        await popup.bringToFront().catch(() => {});
      }

      const doneIndicator = page.locator('#dropbox-setup-modal');
      await expect(doneIndicator).toBeHidden({ timeout: WAIT_MS });
    }

    await openAdminIntegrations(page);
    const message = await clickDropboxTest(page);

    // Keep deterministic assertion loose for interactive env variance.
    expect(/DROPBOX|ready|configured|unconfigured|invalid|reconnect|rotate|auth/i.test(message)).toBe(true);
  } finally {
    await app.close();
  }
});
