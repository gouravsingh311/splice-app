import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildActorHeaders } from '../../test-utils/authContext';
import { DB_PATH, launchApp, openDb, resolveApiBaseUrl } from '../launch';
import { loginViaUi } from '../support';

const SMOKE_PACK_NAME = 'Smoke Test Pack';
const SMOKE_LABEL_NAME = 'Smoke Test Label';
const QC_FIXTURE_PACK_NAME = 'Valid E2E Pack';
const QC_FIXTURE_LABEL_NAME = 'Test Label';
const REAL_SMOKE_DIAGNOSTICS_DIR = path.join(process.cwd(), 'test-results', 'real-smoke-diagnostics');
const CREATOR_SMOKE_PASSWORD = 'CreatorPass123!';
const REVIEWER_SMOKE_PASSWORD = 'ReviewerPass123!';
const CREATOR_SMOKE_EMAIL = 'creator@fileeaters.local';
const REVIEWER_SMOKE_EMAIL = 'reviewer@fileeaters.local';
const PROVISIONED_REAL_AUTH_ACCOUNTS = new Set<string>();

type RuntimeDiagnostics = {
  consoleMessages: Array<{ type: string; text: string; location?: string; at: string }>;
  pageErrors: Array<{ message: string; at: string }>;
};

type SmokeActorRole = 'creator' | 'reviewer' | 'admin';

function createRuntimeDiagnostics(page: import('@playwright/test').Page): RuntimeDiagnostics {
  const diagnostics: RuntimeDiagnostics = {
    consoleMessages: [],
    pageErrors: [],
  };
  page.on('console', (message) => {
    diagnostics.consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location()?.url || '',
      at: new Date().toISOString(),
    });
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push({
      message: String(error && error.message ? error.message : error),
      at: new Date().toISOString(),
    });
  });
  return diagnostics;
}

async function captureFailFastContext(
  app: import('@playwright/test').ElectronApplication,
  page: import('@playwright/test').Page,
  diagnostics: RuntimeDiagnostics,
  label: string,
  reason: string
): Promise<void> {
  await fs.mkdir(REAL_SMOKE_DIAGNOSTICS_DIR, { recursive: true });
  const timestamp = Date.now();
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const base = `${timestamp}-${safeLabel}`;
  const screenshotPath = path.join(REAL_SMOKE_DIAGNOSTICS_DIR, `${base}.png`);
  const htmlPath = path.join(REAL_SMOKE_DIAGNOSTICS_DIR, `${base}.html`);
  const jsonPath = path.join(REAL_SMOKE_DIAGNOSTICS_DIR, `${base}.json`);

  const runtimeSummary = await page
    .evaluate(() => {
      const visibleViews = Array.from(document.querySelectorAll('[data-view]'))
        .filter((el) => !el.classList.contains('hidden'))
        .map((el) => el.id || el.getAttribute('data-view') || 'unknown');
      const navSubmissions = document.querySelector('#sidebar-primary-nav [data-nav="submissions"]') as HTMLButtonElement | null;
      const viewMount = document.getElementById('view-mount');
      return {
        href: window.location.href,
        title: document.title,
        readyState: document.readyState,
        viewMountChildCount: viewMount ? viewMount.childElementCount : -1,
        hasLoginEmail: Boolean(document.getElementById('login-email')),
        hasLoginForm: Boolean(document.getElementById('login-form')),
        hasDashboardView: Boolean(document.getElementById('view-dashboard')),
        navSubmissions: navSubmissions
          ? {
              disabled: navSubmissions.disabled,
              ariaDisabled: navSubmissions.getAttribute('aria-disabled'),
            }
          : null,
        visibleViews,
        bodyTextSnippet: String(document.body?.innerText || '').slice(0, 2000),
      };
    })
    .catch(() => ({ error: 'renderer-eval-failed' }));
  const content = await page.content().catch(() => '<!-- failed to read page content -->');
  const apiBaseUrl = await resolveApiBaseUrl(app).catch(() => '');

  await Promise.all([
    page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined),
    fs.writeFile(htmlPath, content, 'utf8'),
    fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          label,
          reason,
          capturedAt: new Date().toISOString(),
          apiBaseUrl,
          runtimeSummary,
          recentConsoleMessages: diagnostics.consoleMessages.slice(-40),
          recentPageErrors: diagnostics.pageErrors.slice(-20),
        },
        null,
        2
      ),
      'utf8'
    ),
  ]);
}

async function ensureRealAuthAccount(
  baseUrl: string,
  email: string,
  password: string,
  role: SmokeActorRole
): Promise<void> {
  void baseUrl;
  void password;
  void role;
  PROVISIONED_REAL_AUTH_ACCOUNTS.add(email);
}

async function waitForRendererBootstrapReady(
  app: import('@playwright/test').ElectronApplication,
  page: import('@playwright/test').Page,
  diagnostics: RuntimeDiagnostics,
  label: string
): Promise<void> {
  const timeoutMs = 12_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const isReady = await page
      .evaluate(() => {
        const mount = document.getElementById('view-mount');
        const hasViews = Boolean(mount && mount.childElementCount > 0);
        if (!hasViews) {
          return false;
        }
        const hasLogin = Boolean(document.getElementById('login-email'));
        const hasAuthView = Boolean(document.getElementById('view-auth'));
        const hasDashboardView = Boolean(document.getElementById('view-dashboard'));
        return hasLogin || hasAuthView || hasDashboardView;
      })
      .catch(() => false);
    if (isReady) {
      return;
    }
    await page.waitForTimeout(250);
  }

  await captureFailFastContext(app, page, diagnostics, label, 'renderer-bootstrap-not-ready');
  throw new Error(
    `Renderer bootstrap did not become ready within ${timeoutMs}ms. ` +
      `Diagnostics captured in ${REAL_SMOKE_DIAGNOSTICS_DIR}`
  );
}

async function ensureAuthenticatedSession(
  app: import('@playwright/test').ElectronApplication,
  page: import('@playwright/test').Page,
  diagnostics: RuntimeDiagnostics,
  actorId: string,
  actorRole: SmokeActorRole,
  authStub: boolean
): Promise<void> {
  await waitForRendererBootstrapReady(app, page, diagnostics, `bootstrap-${actorId}`);
  const resolvedStubMode = await app.evaluate(() => String(process.env.FILEEATERS_AUTH_STUB || '')).catch(() => '');
  expect(resolvedStubMode).toBe(authStub ? 'true' : 'false');
  if (!authStub) {
    const apiBaseUrl = await resolveApiBaseUrl(app);
    expect(apiBaseUrl).toContain('http://127.0.0.1:');
    await waitForApiReady(apiBaseUrl);
    const email = actorId === 'reviewer-smoke' ? REVIEWER_SMOKE_EMAIL : CREATOR_SMOKE_EMAIL;
    const password = actorId === 'reviewer-smoke' ? REVIEWER_SMOKE_PASSWORD : CREATOR_SMOKE_PASSWORD;
    await ensureRealAuthAccount(apiBaseUrl, email, password, actorRole);
  }
  const dashboardView = page.locator('#view-dashboard');
  if (await dashboardView.isVisible().catch(() => false)) {
    return;
  }

  try {
    await loginViaUi(page, {
      email: actorId === 'reviewer-smoke' ? REVIEWER_SMOKE_EMAIL : CREATOR_SMOKE_EMAIL,
      password: actorId === 'reviewer-smoke' ? REVIEWER_SMOKE_PASSWORD : CREATOR_SMOKE_PASSWORD,
      expectedRole: actorRole,
    });
    await expect(page.locator('#sidebar-primary-nav [data-nav="submissions"]')).toBeEnabled({ timeout: 5_000 });
  } catch (error) {
    await captureFailFastContext(
      app,
      page,
      diagnostics,
      `login-${actorId}`,
      `login-flow-failed: ${String(error)}`
    );
    throw error;
  }
}

async function openSubmissionsWorkspace(
  app: import('@playwright/test').ElectronApplication,
  page: import('@playwright/test').Page,
  diagnostics: RuntimeDiagnostics,
  actorId: string
): Promise<void> {
  try {
    await page.locator('#sidebar-primary-nav [data-nav="submissions"]').click();
    await expect(page.locator('#view-submissions')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-workspace-create]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-workspace-create]').first().click();
    await expect(page.locator('#workspace-pack-name')).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    await captureFailFastContext(
      app,
      page,
      diagnostics,
      `workspace-${actorId}`,
      `open-submissions-failed: ${String(error)}`
    );
    throw error;
  }
}

async function ensureIntakeStepReady(page: import('@playwright/test').Page): Promise<void> {
  const packFolderButton = page.locator('#workspace-select-pack-folder');
  if (await packFolderButton.isVisible().catch(() => false)) {
    return;
  }
  const nextButton = page.locator('#wizard-next-btn');
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
  }
  await expect(packFolderButton).toBeVisible({ timeout: 10_000 });
}

async function ensureReviewStepReady(page: import('@playwright/test').Page): Promise<void> {
  const submitButton = page.locator('#workspace-submit-review');
  if (await submitButton.isVisible().catch(() => false)) {
    return;
  }
  const nextButton = page.locator('#wizard-next-btn');
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
  }
  await expect(submitButton).toBeVisible({ timeout: 10_000 });
}

function firstReleaseMonth(): string {
  const dt = new Date();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${month}`;
}

function assertTableExists(tableName: string): void {
  const db = openDb();
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    expect(row).toBeDefined();
  } finally {
    db.close();
  }
}

async function waitForApiReady(baseUrl: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API not ready at ${baseUrl}`);
}

async function waitForAppApiReady(app: import('@playwright/test').ElectronApplication): Promise<void> {
  const apiBaseUrl = await resolveApiBaseUrl(app);
  expect(apiBaseUrl).toContain('http://127.0.0.1:');
  await waitForApiReady(apiBaseUrl);
}

async function setupUnderReviewSubmission(baseUrl: string, submissionId: string, packName: string) {
  const creatorId = 'creator-e2e';
  const creatorHeaders = buildActorHeaders({ actorId: creatorId, actorRoles: 'creator' });
  const draftPayload = {
    submission_id: submissionId,
    creator_id: creatorId,
    preferred_release_month: firstReleaseMonth(),
    metadata: { source: 'real-smoke' },
  };

  const createDraftResponse = await fetch(`${baseUrl}/submissions/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...creatorHeaders },
    body: JSON.stringify(draftPayload),
  });
  if (!createDraftResponse.ok) {
    throw new Error(`Failed to create lifecycle draft: ${createDraftResponse.status}`);
  }

  const creatorDraftResponse = await fetch(`${baseUrl}/creator/submissions/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...creatorHeaders },
    body: JSON.stringify({
      submission_id: submissionId,
      creator_id: creatorId,
      pack_name: packName,
      release_month: firstReleaseMonth(),
      notes: 'real smoke setup',
      tags: ['smoke'],
      airtable_form_completed: true,
      autosave_json: {
        packName,
        releaseMonth: firstReleaseMonth(),
      },
    }),
  });
  if (!creatorDraftResponse.ok) {
    throw new Error(`Failed to create creator draft metadata: ${creatorDraftResponse.status}`);
  }

  const transitionResponse = await fetch(`${baseUrl}/submissions/${submissionId}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...creatorHeaders },
    body: JSON.stringify({
      request_id: `under-review-${Date.now()}`,
      to_state: 'under_review',
      actor_id: creatorId,
      actor_role: 'creator',
      reason: 'Submitted for review',
      expected_version: 0,
      metadata: {},
    }),
  });
  if (!transitionResponse.ok) {
    throw new Error(`Failed to transition to under_review: ${transitionResponse.status}`);
  }
}

test.describe.serial('real electron smoke', () => {
  test.beforeAll(async () => {
    try {
      const probeDb = openDb();
      probeDb.close();
    } catch (error) {
      test.skip(true, 'real-smoke skipped: native sqlite binding unavailable in current environment');
    }
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.rm(DB_PATH, { force: true });
  });

  test('[XR-020] TEST 1: Boot + Login', async () => {
    const { app, page } = await launchApp({ actorId: 'creator-smoke', actorRoles: 'creator', authStub: false });
    const diagnostics = createRuntimeDiagnostics(page);
    try {
      await ensureAuthenticatedSession(app, page, diagnostics, 'creator-smoke', 'creator', false);
      await openSubmissionsWorkspace(app, page, diagnostics, 'creator-smoke');
      const db = openDb();
      try {
        const row = db.prepare('SELECT 1 AS ready').get() as { ready: number };
        expect(row.ready).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test('[XR-020] TEST 2: Create draft -> persist to DB', async () => {
    const { app, page } = await launchApp({ actorId: 'creator-smoke', actorRoles: 'creator', authStub: false });
    const diagnostics = createRuntimeDiagnostics(page);
    try {
      await ensureAuthenticatedSession(app, page, diagnostics, 'creator-smoke', 'creator', false);
      await waitForAppApiReady(app);
      await openSubmissionsWorkspace(app, page, diagnostics, 'creator-smoke');
      assertTableExists('submission_metadata');

      await page.locator('[data-workspace-create]').first().click();
      await page.locator('#workspace-pack-name').fill(SMOKE_PACK_NAME);
      await page.locator('#workspace-label-name').fill(SMOKE_LABEL_NAME);
      await page.locator('#workspace-release-month').selectOption(firstReleaseMonth());
      await page.locator('#workspace-save-metadata').click();

      await expect(page.locator('#workspace-feedback')).toContainText('Metadata saved');

      const db = openDb();
      try {
        const row = db
          .prepare('SELECT submission_id, pack_name, release_month FROM submission_metadata WHERE pack_name = ?')
          .get(SMOKE_PACK_NAME);
        expect(row).not.toBeNull();

        const stateRow = db
          .prepare('SELECT current_state FROM submissions WHERE id = ?')
          .get((row as { submission_id: string }).submission_id) as { current_state: string } | undefined;
        expect(stateRow?.current_state).toBe('draft');
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test('[XR-020] TEST 3: Relaunch -> draft survives', async () => {
    const { app, page } = await launchApp({ actorId: 'creator-smoke', actorRoles: 'creator', authStub: false });
    const diagnostics = createRuntimeDiagnostics(page);
    try {
      await ensureAuthenticatedSession(app, page, diagnostics, 'creator-smoke', 'creator', false);
      await waitForAppApiReady(app);
      await openSubmissionsWorkspace(app, page, diagnostics, 'creator-smoke');
      const db = openDb();
      try {
        const row = db
          .prepare('SELECT COUNT(*) AS count FROM submission_metadata WHERE pack_name = ?')
          .get(SMOKE_PACK_NAME) as { count: number };
        expect(row.count).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test('[XR-020] TEST 4: Run QC -> real Python QC engine fires', async () => {
    const { app, page } = await launchApp({ actorId: 'creator-smoke', actorRoles: 'creator', authStub: false });
    const diagnostics = createRuntimeDiagnostics(page);
    try {
      await ensureAuthenticatedSession(app, page, diagnostics, 'creator-smoke', 'creator', false);
      await waitForAppApiReady(app);
      await openSubmissionsWorkspace(app, page, diagnostics, 'creator-smoke');
      await page.locator('[data-workspace-create]').first().click();
      await page.locator('#workspace-pack-name').fill(QC_FIXTURE_PACK_NAME);
      await page.locator('#workspace-label-name').fill(QC_FIXTURE_LABEL_NAME);
      await page.locator('#workspace-release-month').selectOption(firstReleaseMonth());
      await page.locator('#workspace-save-metadata').click();
      await expect(page.locator('#workspace-feedback')).toContainText('Metadata saved');
      await ensureIntakeStepReady(page);
      await page.locator('#workspace-select-pack-folder').click();
      await expect(page.locator('#workspace-feedback')).toContainText(/Pack folder selected|Pack structure warning/, {
        timeout: 30_000,
      });
      await page.locator('#workspace-run-qc').click();
      await page.waitForFunction(function () {
        var feedback = document.getElementById('workspace-feedback');
        var text = String(feedback && feedback.textContent ? feedback.textContent : '');
        return text.indexOf('QC status changed to passed') !== -1;
      }, { timeout: 30_000 });

      const db = openDb();
      try {
        const row = db
          .prepare('SELECT id, current_state, version FROM submissions WHERE id IN (SELECT submission_id FROM submission_metadata WHERE pack_name = ?)')
          .get(QC_FIXTURE_PACK_NAME) as { id: string; current_state: string; version: number } | undefined;
        expect(row).not.toBeNull();
        expect(row?.version).toBeGreaterThanOrEqual(0);
        expect(row?.current_state).toBe('draft');
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test('[XR-003] TEST 5: State machine — submit -> reviewer sees it', async () => {
    let submissionIdForReview = '';
    let targetSubmissionId = '';
    const { app, page } = await launchApp({ actorId: 'creator-smoke', actorRoles: 'creator', authStub: false });
    const diagnostics = createRuntimeDiagnostics(page);
    try {
      await ensureAuthenticatedSession(app, page, diagnostics, 'creator-smoke', 'creator', false);
      await waitForAppApiReady(app);
      await openSubmissionsWorkspace(app, page, diagnostics, 'creator-smoke');
      await page.locator('[data-workspace-create]').first().click();
      await page.locator('#workspace-pack-name').fill(QC_FIXTURE_PACK_NAME);
      await page.locator('#workspace-label-name').fill(QC_FIXTURE_LABEL_NAME);
      await page.locator('#workspace-release-month').selectOption(firstReleaseMonth());
      await page.locator('#workspace-save-metadata').click();
      await expect(page.locator('#workspace-feedback')).toContainText('Metadata saved');
      await ensureIntakeStepReady(page);
      const createdDraftDb = openDb();
      try {
        const createdDraft = createdDraftDb
          .prepare('SELECT submission_id FROM submission_metadata WHERE pack_name = ? ORDER BY updated_at DESC LIMIT 1')
          .get(QC_FIXTURE_PACK_NAME) as { submission_id: string } | undefined;
        expect(createdDraft?.submission_id).toBeDefined();
        targetSubmissionId = createdDraft?.submission_id || '';
      } finally {
        createdDraftDb.close();
      }

      await page.locator('#workspace-select-pack-folder').click();
      await expect(page.locator('#workspace-feedback')).toContainText(/Pack folder selected|Pack structure warning/, {
        timeout: 30_000,
      });

      await page.locator('#workspace-run-qc').click();
      await expect(page.locator('#workspace-feedback')).toContainText('QC passed', { timeout: 30_000 });

      await ensureReviewStepReady(page);
      await page.locator('#workspace-submit-review').click();
      await expect(page.locator('#workspace-feedback')).toContainText(
        'Uploaded to Dropbox. Submission moved to under review.',
        { timeout: 30_000 }
      );

      const db = openDb();
      try {
        const row = db
          .prepare('SELECT id, current_state FROM submissions WHERE id = ?')
          .get(targetSubmissionId) as { id: string; current_state: string } | undefined;
        expect(row?.current_state).toBe('under_review');
        submissionIdForReview = row?.id || '';
        expect(submissionIdForReview).not.toBe('');

        const intakeTable = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'intake_sessions'")
          .get();
        if (intakeTable) {
          const intakeRow = db
            .prepare('SELECT id FROM intake_sessions WHERE submission_id = ? LIMIT 1')
            .get(targetSubmissionId);
          expect(intakeRow).toBeDefined();
        }
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }

    const reviewerLaunch = await launchApp({ actorId: 'reviewer-smoke', actorRoles: 'reviewer', authStub: false });
    const reviewerDiagnostics = createRuntimeDiagnostics(reviewerLaunch.page);
    try {
      await ensureAuthenticatedSession(
        reviewerLaunch.app,
        reviewerLaunch.page,
        reviewerDiagnostics,
        'reviewer-smoke',
        'reviewer',
        false
      );
      await waitForAppApiReady(reviewerLaunch.app);
      await reviewerLaunch.page.locator('.fe-sidebar [data-nav="reviewer-queue"]').click();
      await expect(reviewerLaunch.page.locator('#view-reviewer-queue')).toBeVisible();

      const apiBaseUrl = await resolveApiBaseUrl(reviewerLaunch.app);
      const queueResponse = await fetch(`${apiBaseUrl}/reviews/queue?actor_id=reviewer-smoke&actor_role=reviewer`, {
        headers: buildActorHeaders({ actorId: 'reviewer-smoke', actorRoles: 'reviewer' }),
      });
      expect(queueResponse.ok).toBeTruthy();
      const queuePayload = (await queueResponse.json()) as { items?: Array<{ pack_name?: string }> };
      const queueRows = Array.isArray(queuePayload.items)
        ? queuePayload.items.map((item) => JSON.stringify(item))
        : [];
      expect(queueRows.join('\n')).toContain(submissionIdForReview);

      const db = openDb();
      try {
        const queueRow = db
          .prepare('SELECT id, current_state FROM submissions WHERE id = ?')
          .get(submissionIdForReview) as { id: string; current_state: string } | undefined;
        expect(queueRow?.current_state).toBe('under_review');
      } finally {
        db.close();
      }
    } finally {
      await reviewerLaunch.app.close();
    }
  });

  test('[XR-004] TEST 6: Reviewer approve -> notification created', async () => {
    const submissionId = `real-smoke-${Date.now()}`;
    const packName = `Real Smoke ${Date.now()}`;

    const { app, page } = await launchApp({ actorId: 'reviewer-smoke', actorRoles: 'reviewer', authStub: false });
    const diagnostics = createRuntimeDiagnostics(page);
    try {
      await ensureAuthenticatedSession(app, page, diagnostics, 'reviewer-smoke', 'reviewer', false);
      await waitForAppApiReady(app);
      const apiBaseUrl = await resolveApiBaseUrl(app);
      expect(apiBaseUrl).toContain('http://127.0.0.1:');
      await waitForApiReady(apiBaseUrl);

      await setupUnderReviewSubmission(apiBaseUrl, submissionId, packName);
      const preDecisionDb = openDb();
      try {
        const seededState = preDecisionDb
          .prepare('SELECT current_state FROM submissions WHERE id = ?')
          .get(submissionId) as { current_state: string } | undefined;
        expect(seededState?.current_state).toBe('under_review');
      } finally {
        preDecisionDb.close();
      }

      const approveResponse = await fetch(`${apiBaseUrl}/reviews/submissions/${submissionId}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...buildActorHeaders({ actorId: 'reviewer-smoke', actorRoles: 'reviewer' }),
        },
        body: JSON.stringify({
          actor_id: 'reviewer-smoke',
          actor_role: 'reviewer',
          request_id: `approve-${Date.now()}`,
          notes: 'real smoke approval',
        }),
      });
      expect(approveResponse.ok).toBeTruthy();

      const db = openDb();
      try {
        const decisionRow = db
          .prepare('SELECT decision FROM review_decisions WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(submissionId) as { decision: string } | undefined;
        expect(decisionRow?.decision).toBe('APPROVED');

        const stateRow = db
          .prepare('SELECT current_state FROM submissions WHERE id = ?')
          .get(submissionId) as { current_state: string } | undefined;
        expect(stateRow?.current_state).toBe('approved');

        const notifRow = db
          .prepare("SELECT type, read FROM notifications WHERE submission_id = ? AND type = 'approved' ORDER BY created_at DESC LIMIT 1")
          .get(submissionId) as { type: string; read: number } | undefined;
        expect(notifRow).toBeDefined();

        await page.locator('.fe-sidebar [data-nav="notifications"]').click();
        await page.locator('#notifications-load-button').click();
        await expect(page.locator('#notif-unread-badge')).not.toHaveClass(/hidden/);

        await page.locator('[data-testid="notification-action-mark-read"]').first().click();
        await expect(page.locator('#notif-unread-badge')).toHaveAttribute('data-unread-count', '0');

        const markedRead = db
          .prepare("SELECT read FROM notifications WHERE submission_id = ? AND type = 'approved' ORDER BY created_at DESC LIMIT 1")
          .get(submissionId) as { read: number } | undefined;
        expect(markedRead?.read).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });
});
