const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'docs', 'reports', 'assets', 'UI4-TW4-E-REFERENCE');
const targets = [
  { name: 'login', path: '/login' },
  { name: 'dashboard', path: '/' },
  { name: 'projects', path: '/projects' },
  { name: 'teams', path: '/teams' },
  { name: 'ops-submissions', path: '/ops/submissions' },
  { name: 'notifications', path: '/notifications' },
];
const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

const email = process.env.PARITY_REF_EMAIL || 'sanidhya.sodhani@codiant.com';
const password = process.env.PARITY_REF_PASSWORD || '123456789';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function capturePage(page, target, viewport) {
  const viewportDir = path.join(ASSETS_DIR, target.name, viewport.name);
  ensureDir(viewportDir);

  const screenshotPath = path.join(viewportDir, 'screenshot.png');
  const status = await page.goto(`https://acme-sanidhya.splice.org${target.path}`, {
    waitUntil: 'networkidle',
  });
  if (!status || status.status() >= 400) {
    throw new Error(`Failed to load ${target.path}: ${status && status.status()}`);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const accessibility = page.accessibility ? await page.accessibility.snapshot() : null;
  const a11yPath = path.join(viewportDir, 'accessibility.json');
  fs.writeFileSync(a11yPath, JSON.stringify(accessibility, null, 2), 'utf8');

  const tokens = await page.evaluate(() => {
    const selectors = ['body', 'nav', 'main', 'main h1', 'main button', 'main table', '.card', '.notification-item'];
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
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://acme-sanidhya.splice.org/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  const submitButton = await page.waitForSelector('button[type="submit"], input[type="submit"], button:has-text("Sign In")', { timeout: 30000 });
  await submitButton.click();
  await page.waitForTimeout(4000);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const target of targets) {
      const assets = await capturePage(page, target, viewport);
      console.log(`Captured ${target.name}@${viewport.name}:`, assets);
    }
  }

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
