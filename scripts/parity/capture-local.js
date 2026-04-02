const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_URL = process.env.PARITY_LOCAL_URL || 'http://127.0.0.1:4173/index.html';
const ASSETS_DIR = path.join(__dirname, '..', '..', 'docs', 'reports', 'assets', 'UI4-TW4-E-LOCAL');
const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];
const targets = [
  { name: 'auth', kind: 'auth' },
  { name: 'dashboard', viewId: 'dashboard' },
  { name: 'submissions', viewId: 'submissions' },
  { name: 'reviewer-queue', viewId: 'reviewer-queue' },
  { name: 'reviewer-decision', viewId: 'reviewer-decision' },
  { name: 'notifications', viewId: 'notifications' },
  { name: 'admin-ops', viewId: 'admin-ops' },
  { name: 'settings', viewId: 'settings' },
];

const loginEmail = process.env.PARITY_LOCAL_EMAIL || 'parity-capture-user@fileeaters.local';
const loginPassword = process.env.PARITY_LOCAL_PASSWORD || 'desktop-parity-pass';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function ensureLoggedIn(page) {
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', loginEmail);
  await page.fill('#login-password', loginPassword);
  await page.click('#login-form button[type="submit"]');
  await page.waitForFunction(() => document.body && document.body.dataset && document.body.dataset.activeView === 'dashboard');
  await page.waitForTimeout(400);
}

async function openTarget(page, target) {
  if (target.kind === 'auth') {
    await page.waitForFunction(() => document.body && document.body.dataset && document.body.dataset.activeView === 'auth');
    return;
  }
  await page.click('[data-nav="' + target.viewId + '"]');
  await page.waitForFunction((viewId) => {
    return document.body && document.body.dataset && document.body.dataset.activeView === viewId;
  }, target.viewId);
  await page.waitForTimeout(400);
}

async function capturePage(page, target, viewport) {
  const viewportDir = path.join(ASSETS_DIR, target.name, viewport.name);
  ensureDir(viewportDir);

  const screenshotPath = path.join(viewportDir, 'screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const accessibility = page.accessibility ? await page.accessibility.snapshot() : null;
  const a11yPath = path.join(viewportDir, 'accessibility.json');
  fs.writeFileSync(a11yPath, JSON.stringify(accessibility, null, 2), 'utf8');

  const tokens = await page.evaluate(() => {
    const selectors = ['body', '#sidebar', '#shell-topbar', '#view-mount', 'main h1', 'main h2', 'main button', 'main table'];
    const values = selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) { return { selector, found: false }; }
      const style = getComputedStyle(el);
      return {
        selector,
        found: true,
        background: style.background,
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderRadius: style.borderRadius,
        border: style.border,
        boxShadow: style.boxShadow,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        padding: style.padding,
      };
    });
    const root = getComputedStyle(document.documentElement);
    return {
      root: {
        fontFamily: root.fontFamily,
        color: root.color,
        backgroundColor: root.backgroundColor,
      },
      selectors: values.filter((item) => item.found),
    };
  });
  const tokensPath = path.join(viewportDir, 'computed-styles.json');
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');
  return { screenshotPath, a11yPath, tokensPath };
}

async function run() {
  ensureDir(ASSETS_DIR);
  const browser = await chromium.launch();
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      await context.addInitScript(() => {
        const mockApi = {
          auth: {
            login: async ({ email }) => ({
              ok: true,
              data: {
                user: {
                  id: email || 'parity-capture-user',
                  roles: ['creator', 'reviewer', 'admin'],
                },
              },
            }),
            sendOtp: async () => ({ ok: true, data: { challengeId: 'otp-mock-1' } }),
            verifyOtp: async () => ({ ok: true, data: { verificationToken: 'verify-mock-1' } }),
            register: async () => ({ ok: true, data: { userId: 'new-user' } }),
            forgotPassword: async () => ({ ok: true, data: { challengeId: 'otp-forgot-mock-1' } }),
            resetPassword: async () => ({ ok: true, data: { revokedSessionCount: 1 } }),
            getSession: async () => ({
              ok: true,
              data: {
                user: {
                  id: 'parity-capture-user',
                  roles: ['creator', 'reviewer', 'admin'],
                },
              },
            }),
          },
          submissions: {
            list: async () => ({
              ok: true,
              data: {
                submissions: [
                  {
                    submissionId: 'sub-001',
                    packName: 'Future House Toolkit',
                    creatorId: 'parity-capture-user',
                    currentState: 'under_review',
                    createdAt: '2026-03-10T09:20:00.000Z',
                    updatedAt: '2026-03-14T10:20:00.000Z',
                  },
                  {
                    submissionId: 'sub-002',
                    packName: 'Drum Loop Vault',
                    creatorId: 'parity-capture-user',
                    currentState: 'approved',
                    createdAt: '2026-03-02T12:15:00.000Z',
                    updatedAt: '2026-03-06T08:30:00.000Z',
                  },
                  {
                    submissionId: 'sub-003',
                    packName: 'Ambient Textures',
                    creatorId: 'parity-capture-user',
                    currentState: 'qc_failed',
                    createdAt: '2026-03-01T12:15:00.000Z',
                    updatedAt: '2026-03-12T08:30:00.000Z',
                  },
                ],
              },
            }),
          },
          notifications: {
            list: async () => ({
              ok: true,
              data: {
                notifications: [
                  {
                    notificationId: 'notif-001',
                    title: 'Submission Under Review',
                    type: 'under_review',
                    severity: 'info',
                    status: 'sent',
                    message: 'Your Future House Toolkit is now in reviewer queue.',
                    read: false,
                    createdAt: '2026-03-15T07:30:00.000Z',
                  },
                  {
                    notificationId: 'notif-002',
                    title: 'QC Failed',
                    type: 'qc_failed',
                    severity: 'warning',
                    status: 'failed',
                    message: 'Fix clipping and metadata errors before resubmitting.',
                    read: false,
                    createdAt: '2026-03-14T17:00:00.000Z',
                  },
                  {
                    notificationId: 'notif-003',
                    title: 'Release Scheduled',
                    type: 'scheduled',
                    severity: 'info',
                    status: 'sent',
                    message: 'Approved pack is scheduled for release this Friday.',
                    read: true,
                    createdAt: '2026-03-12T09:00:00.000Z',
                  },
                ],
              },
            }),
            markRead: async () => ({ ok: true }),
            markAllRead: async () => ({ ok: true }),
            retry: async () => ({ ok: true }),
          },
          review: {
            listQueue: async () => ({
              ok: true,
              data: {
                items: [
                  {
                    submissionId: 'sub-001',
                    packName: 'Future House Toolkit',
                    creatorId: 'parity-capture-user',
                    submittedAt: '2026-03-14T10:20:00.000Z',
                    state: 'under_review',
                    ageDays: 3,
                    flags: [{ severity: 'high' }],
                  },
                  {
                    submissionId: 'sub-004',
                    packName: 'Vocal Chops Vol. 2',
                    creatorId: 'creator-a',
                    submittedAt: '2026-03-10T10:20:00.000Z',
                    state: 'under_review',
                    ageDays: 7,
                    flags: [{ severity: 'medium' }],
                  },
                ],
              },
            }),
            getSubmission: async ({ submissionId }) => ({
              ok: true,
              data: {
                submission: {
                  submissionId: submissionId || 'sub-001',
                  packName: 'Future House Toolkit',
                  creatorId: 'parity-capture-user',
                  submittedAt: '2026-03-14T10:20:00.000Z',
                  state: 'under_review',
                },
                metadata: {
                  version: 3,
                  updatedAt: '2026-03-15T08:20:00.000Z',
                },
                qcFindings: [
                  { ruleId: 'MISSING_METADATA', message: 'BPM metadata missing', severity: 'warning' },
                  { ruleId: 'CLIPPING', message: 'Peak clipping detected', severity: 'blocking' },
                ],
                tags: [{ tag: 'metadata' }, { tag: 'urgent' }],
                flags: [{ flagType: 'policy', severity: 'high' }],
              },
            }),
            approve: async () => ({ ok: true }),
            reject: async () => ({ ok: true }),
            reopen: async () => ({ ok: true }),
            addTag: async () => ({ ok: true }),
            addFlag: async () => ({ ok: true }),
          },
          admin: {
            qcPolicy: {
              get: async () => ({
                ok: true,
                data: {
                  policyVersion: 7,
                  policyId: 'default-wave2-policy',
                  rules: [
                    { ruleId: 'MISSING_METADATA', title: 'Metadata Required', severity: 'medium', enabled: true, blocking: false },
                    { ruleId: 'CLIPPING', title: 'No Clipping', severity: 'high', enabled: true, blocking: true },
                  ],
                },
              }),
              update: async () => ({ ok: true, data: { policyVersion: 8 } }),
            },
            configs: {
              list: async () => ({
                ok: true,
                data: {
                  configs: [
                    { id: 'cfg-1', configType: 'qc_policy', version: 7, publishedBy: 'admin', publishedAt: '2026-03-13T12:00:00.000Z', isDraft: false },
                    { id: 'cfg-2', configType: 'release_policy', version: 2, publishedBy: null, publishedAt: null, isDraft: true },
                  ],
                },
              }),
              createDraft: async () => ({ ok: true }),
              publish: async () => ({ ok: true }),
            },
            integrations: {
              listHealth: async () => ({
                ok: true,
                data: {
                  dropbox: { statusClass: 'healthy', latencyMs: 124, credentialStatus: 'valid', recommendedAction: 'None', operatorGuidance: 'No action required', lastFailureAt: null },
                  airtable: { statusClass: 'degraded', latencyMs: 380, credentialStatus: 'expiring', recommendedAction: 'Rotate token', operatorGuidance: 'Token rotation due within 48h', lastFailureAt: '2026-03-15T07:00:00.000Z' },
                  smtp: { statusClass: 'healthy', latencyMs: 90, credentialStatus: 'valid', recommendedAction: 'None', operatorGuidance: 'No action required', lastFailureAt: null },
                },
              }),
              test: async () => ({ ok: true }),
              rotate: async () => ({ ok: true }),
            },
            ops: {
              listHistory: async () => ({
                ok: true,
                data: {
                  items: [
                    { action: 'policy.update', entity: 'qc_policy', actorId: 'admin', reason: 'Align with v4 launch', timestamp: '2026-03-13T12:00:00.000Z' },
                  ],
                },
              }),
              replayJob: async () => ({ ok: true }),
            },
          },
        };
        window.fileeaters = mockApi;
        window.electronAPI = mockApi;
      });

      const page = await context.newPage();
      try {
        const response = await page.goto(APP_URL, { waitUntil: 'networkidle' });
        if (!response || response.status() >= 400) {
          throw new Error('Failed to load local app at ' + APP_URL + '. HTTP status: ' + (response && response.status()));
        }
      } catch (error) {
        throw new Error(
          'Could not load local app for parity capture. ' +
          'Start a local server first (example: `cd src && python3 -m http.server 4173`), then retry. Root error: ' +
          error.message
        );
      }

      await openTarget(page, { kind: 'auth' });
      await capturePage(page, targets[0], viewport);

      await ensureLoggedIn(page);
      for (let index = 1; index < targets.length; index += 1) {
        const target = targets[index];
        await openTarget(page, target);
        const assets = await capturePage(page, target, viewport);
        process.stdout.write('Captured local ' + target.name + '@' + viewport.name + ': ' + JSON.stringify(assets) + '\n');
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
