import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const PACK_PATH = '/Users/Vijay/Documents/Splice/Splice Sample Packs/Test Press - Serum 2 DnB Essentials';
const ACTOR_ID = 'admin-policy-scenario';
const EMAIL = 'admin-policy-scenario@example.com';
const PASSWORD = 'SuperSecretPassword123!';

function releaseMonth() {
  const dt = new Date();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${month}`;
}

async function resolveApiBaseUrl(app) {
  for (let i = 0; i < 40; i += 1) {
    const url = await app.evaluate(() => process.env.SPLICE_API_BASE_URL || '');
    if (url && String(url).startsWith('http://127.0.0.1:')) return String(url);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Could not resolve API base URL from Electron app env.');
}

async function waitForApiReady(apiBaseUrl) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${apiBaseUrl}/health/ready`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API not ready at ${apiBaseUrl}`);
}

async function login(page) {
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#view-dashboard')).toBeVisible({ timeout: 15000 });
}

async function openAdmin(page) {
  await page.locator('#sidebar-primary-nav [data-nav="admin-ops"]').first().click();
  await expect(page.locator('#view-admin-ops')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#admin-qc-rules-body')).toBeVisible({ timeout: 15000 });
}

async function setAllBlocking(page, enabled) {
  const boxes = page.locator('input[data-ui-control="admin-rule-blocking"]');
  const count = await boxes.count();
  if (count === 0) throw new Error('No admin blocking rule checkboxes found.');
  for (let i = 0; i < count; i += 1) {
    await boxes.nth(i).setChecked(enabled);
  }
}

async function savePolicy(page, reason, normalizationTarget = null) {
  if (normalizationTarget !== null) {
    const input = page.locator('#admin-policy-normalization-target-input');
    await input.fill('');
    await input.type(String(normalizationTarget));
  }
  await page.locator('#admin-policy-reason-input').fill(reason);
  await page.locator('#admin-qc-save-policy').click();
  await expect(page.locator('#admin-qc-feedback')).toContainText(/Policy saved to version/i, { timeout: 20000 });
  const feedback = await page.locator('#admin-qc-feedback').innerText();
  return feedback.trim();
}

async function openSubmissions(page) {
  await page.locator('#sidebar-primary-nav [data-nav="submissions"]').first().click();
  await expect(page.locator('#view-submissions')).toBeVisible({ timeout: 15000 });
}

async function runQcFromUi(page, apiBaseUrl, label) {
  const packName = `Scenario ${label} ${Date.now()}`;
  const labelName = `Label ${label}`;

  await openSubmissions(page);
  await page.locator('[data-workspace-create]').first().click();
  await page.locator('#workspace-pack-name').fill(packName);
  await page.locator('#workspace-label-name').fill(labelName);
  await page.locator('#workspace-release-month').selectOption(releaseMonth());
  await page.locator('#workspace-save-metadata').click();
  await expect(page.locator('#workspace-feedback')).toContainText(/Metadata saved/i, { timeout: 15000 });

  await page.locator('[data-wizard-next="intake"]').click();
  await page.locator('#workspace-select-pack-folder').click();
  await expect(page.locator('#workspace-feedback')).toContainText(/Pack folder selected|Pack structure warning/i, { timeout: 30000 });

  await page.locator('#workspace-run-qc').click();
  await expect(page.locator('#workspace-feedback')).toContainText(/QC passed|QC failed|QC finished/i, { timeout: 120000 });

  const uiFeedback = (await page.locator('#workspace-feedback').innerText()).trim();
  const runStatusText = (await page.locator('#workspace-qc-run-status').innerText().catch(() => '')).trim();

  const listRes = await fetch(`${apiBaseUrl}/creator/submissions?creator_id=${encodeURIComponent(ACTOR_ID)}`);
  if (!listRes.ok) throw new Error(`creator submissions list failed: ${listRes.status}`);
  const submissions = await listRes.json();
  const created = Array.isArray(submissions)
    ? submissions.find((s) => s && s.pack_name === packName)
    : null;
  if (!created || !created.submission_id) {
    throw new Error(`Could not find created submission for pack ${packName}`);
  }

  const submissionId = String(created.submission_id);
  const resultsRes = await fetch(`${apiBaseUrl}/qc/results/${encodeURIComponent(submissionId)}`);
  if (!resultsRes.ok) throw new Error(`qc results failed for ${submissionId}: ${resultsRes.status}`);
  const results = await resultsRes.json();
  const latest = results.latest || {};
  const summary = latest.summary || {};

  return {
    label,
    submissionId,
    packName,
    uiFeedback,
    runStatusText,
    latestStatus: latest.status ?? null,
    blockingFailures: summary.blocking_failures ?? null,
    warningFindings: summary.warning_findings ?? null,
    generatedAt: latest.generated_at ?? null,
    policyVersion: latest.policy_version ?? null,
    ruleSetVersion: latest.rule_set_version ?? null,
  };
}

async function main() {
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'electron/main.js')],
    env: {
      ...process.env,
      SPLICE_ACTOR_ID: ACTOR_ID,
      SPLICE_AUTH_ROLES: 'admin',
      SPLICE_DB_PATH: './data/test.db',
      SPLICE_HEALTH_PORT: '0',
      NODE_ENV: 'test',
      PLAYWRIGHT_E2E: '1',
      E2E_PACK_PATH: PACK_PATH,
    },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#login-form')).toBeVisible({ timeout: 15000 });
    await login(page);

    const apiBaseUrl = await resolveApiBaseUrl(app);
    await waitForApiReady(apiBaseUrl);

    await openAdmin(page);

    await setAllBlocking(page, true);
    const saveAllBlockingFeedback = await savePolicy(page, 'Scenario step 1: enforce all blocking');
    const run1 = await runQcFromUi(page, apiBaseUrl, 'all-blocking');

    await openAdmin(page);
    await setAllBlocking(page, false);
    const saveNonBlockingFeedback = await savePolicy(page, 'Scenario step 2: set all non-blocking');
    const run2 = await runQcFromUi(page, apiBaseUrl, 'all-non-blocking');

    await openAdmin(page);
    const saveNormZeroFeedback = await savePolicy(page, 'Scenario step 3: set normalization target to 0 dB', 0);
    const run3 = await runQcFromUi(page, apiBaseUrl, 'norm-db-zero');

    const report = {
      timestamp: new Date().toISOString(),
      actorId: ACTOR_ID,
      actorRole: 'admin',
      packPath: PACK_PATH,
      saveFeedback: {
        allBlocking: saveAllBlockingFeedback,
        allNonBlocking: saveNonBlockingFeedback,
        normalizationZeroDb: saveNormZeroFeedback,
      },
      runs: [run1, run2, run3],
    };

    const reportPath = path.join(process.cwd(), 'docs/reports/admin-policy-qc-ui-scenario-20260319.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(JSON.stringify({ ok: true, reportPath, report }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
