#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', 'assets', 'e2e-visual-baseline', 'current');
const VIEWPORT = { width: 1600, height: 1000 };
const PAGES = [
  { name: 'dashboard', nav: 'dashboard' },
  { name: 'submissions', nav: 'submissions' },
  { name: 'review-queue', nav: 'reviewer-queue' },
  { name: 'notifications', nav: 'notifications' },
  { name: 'admin-ops', nav: 'admin-ops' },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function login(page) {
  await page.waitForSelector('#login-email', { timeout: 20000 });
  await page.fill('#login-email', process.env.VISUAL_BASELINE_EMAIL || 'visual-baseline@fileeaters.local');
  await page.fill('#login-password', process.env.VISUAL_BASELINE_PASSWORD || 'SuperSecretPassword123!');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#view-dashboard', { timeout: 20000 });
}

async function capture() {
  ensureDir(OUT_DIR);
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      FILEEATERS_ACTOR_ID: process.env.VISUAL_BASELINE_ACTOR_ID || 'visual-baseline',
      FILEEATERS_AUTH_ROLES: process.env.VISUAL_BASELINE_ROLES || 'admin,reviewer,creator',
      SPLICE_ENV: 'local',
      SPLICE_ENABLE_HEALTH_SERVER: 'false',
      PLAYWRIGHT_E2E: '1',
    },
  });

  try {
    const page = await app.firstWindow();
    await page.setViewportSize(VIEWPORT);
    await login(page);
    await page.waitForTimeout(500);

    for (const target of PAGES) {
      const navSelector = `#sidebar-primary-nav [data-nav="${target.nav}"]`;
      await page.waitForSelector(navSelector, { timeout: 10000 });
      await page.click(navSelector);
      await page.waitForTimeout(500);
      const outPath = path.join(OUT_DIR, `${target.name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
    }
  } finally {
    await app.close();
  }
}

capture().catch((error) => {
  console.error(error);
  process.exit(1);
});
