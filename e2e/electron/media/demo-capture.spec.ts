import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const {
  DEFAULT_LOGIN,
  FLOWS,
  OUTPUT_DIRS,
  flowSlug,
  screenshotName,
  masterVideoName,
} = require('../../scripts/demo-media/shot-list.js');

const CAPTURE_MODE = String(process.env.DEMO_MEDIA_CAPTURE_MODE || 'master').toLowerCase();
const VIEWPORT = { width: 1600, height: 1000 };
const STEP_TYPE_DELAY_MS = 70;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fs.mkdir(OUTPUT_DIRS.masters, { recursive: true });
  await fs.mkdir(OUTPUT_DIRS.screenshots, { recursive: true });
  await fs.mkdir(OUTPUT_DIRS.tmp, { recursive: true });
});

for (const flow of FLOWS) {
  test(`demo capture ${flowSlug(flow)}`, async () => {
    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        FILEEATERS_ACTOR_ID: flow.actorId,
        FILEEATERS_AUTH_ROLES: flow.actorRoles,
        FILEEATERS_AUTH_STUB: 'true',
        SPLICE_ENV: 'local',
        SPLICE_ENABLE_HEALTH_SERVER: 'false',
        SPLICE_SKIP_PYTHON_BACKEND: 'true',
        SPLICE_API_BASE_URL: 'http://127.0.0.1:8017',
        SPLICE_INTERNAL_API_TOKEN: 'demo-internal-token',
        PLAYWRIGHT_E2E: '1',
      },
    });

    const page = await app.firstWindow();
    const video = page.video();

    try {
      await page.setViewportSize(VIEWPORT);
      await installCursorOverlay(page);
      await ensureLoggedIn(page, flow);

      const timeline: Array<{ stepId: string; caption: string; startMs: number; endMs: number }> = [];
      const startedAt = Date.now();

      for (const step of flow.steps) {
        await goToNav(page, step.nav, step.expect);

        if (step.action) {
          await performAction(page, step.action);
        }

        const stepStart = Date.now() - startedAt;
        const screenshotPath = path.join(OUTPUT_DIRS.screenshots, screenshotName(flow, step));
        await page.screenshot({ path: screenshotPath, fullPage: false });

        await page.waitForTimeout(step.holdMs || 2400);
        const stepEnd = Date.now() - startedAt;

        timeline.push({
          stepId: step.id,
          caption: step.caption,
          startMs: stepStart,
          endMs: stepEnd,
        });
      }

      const captureManifestPath = path.join(OUTPUT_DIRS.tmp, `${flowSlug(flow)}.json`);
      await fs.writeFile(
        captureManifestPath,
        JSON.stringify(
          {
            role: flow.role,
            flow: flow.flow,
            actorId: flow.actorId,
            actorRoles: flow.actorRoles,
            narrationText: flow.narrationText,
            captureMode: CAPTURE_MODE,
            timeline,
            masterVideo: masterVideoName(flow),
          },
          null,
          2,
        ),
        'utf8',
      );

      await page.waitForTimeout(350);
    } finally {
      await app.close();
    }

    if (CAPTURE_MODE !== 'screenshots' && video) {
      const targetVideoPath = path.join(OUTPUT_DIRS.masters, masterVideoName(flow));
      await video.saveAs(targetVideoPath);
    }
  });
}

async function ensureLoggedIn(page: Page, flow: any): Promise<void> {
  const dashboard = page.locator('#view-dashboard');
  if (await dashboard.isVisible().catch(() => false)) {
    return;
  }

  const loginEmail = page.locator('#login-email');
  await expect(loginEmail).toBeVisible({ timeout: 20_000 });

  await humanType(page, loginEmail, `${flow.role}.${DEFAULT_LOGIN.email}`);
  await humanType(page, page.locator('#login-password'), DEFAULT_LOGIN.password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForTimeout(1200);
}

async function goToNav(page: Page, nav: string, expectedSelector: string): Promise<void> {
  await page.evaluate((navId) => {
    const navSelector = `#sidebar-primary-nav [data-nav="${navId}"]`;
    const navButton = document.querySelector(navSelector);
    if (navButton) {
      navButton.removeAttribute('aria-disabled');
      navButton.removeAttribute('disabled');
      (navButton as HTMLElement).click();
      return;
    }
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('data-nav', navId);
    trigger.style.display = 'none';
    document.body.appendChild(trigger);
    trigger.click();
    trigger.remove();
  }, nav);

  const expected = page.locator(expectedSelector);
  try {
    await expect(expected).toBeVisible({ timeout: 3500 });
  } catch (_) {
    await page.evaluate((selector) => {
      document.querySelectorAll('[data-view]').forEach((el) => el.classList.add('hidden'));
      const target = document.querySelector(selector);
      if (target) {
        target.classList.remove('hidden');
      }
    }, expectedSelector);
    await expect(expected).toBeVisible({ timeout: 2500 });
  }

  await page.waitForTimeout(350);
}

async function performAction(page: Page, action: { type: string; selector: string }): Promise<void> {
  if (action.type === 'click') {
    const target = page.locator(action.selector).first();
    if (await target.count()) {
      await target.waitFor({ state: 'visible', timeout: 7000 }).catch(() => undefined);
      if (await target.isVisible().catch(() => false)) {
        await humanClick(page, target);
      }
    }
  }
}

async function humanType(page: Page, locator: Locator, value: string): Promise<void> {
  await humanClick(page, locator);
  await locator.fill('');
  await page.keyboard.type(value, { delay: STEP_TYPE_DELAY_MS });
  await page.waitForTimeout(180);
}

async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click();
    await page.waitForTimeout(220);
    return;
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y, { steps: 14 });
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  await page.waitForTimeout(220);
}

async function installCursorOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('demo-media-cursor-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'demo-media-cursor-style';
    style.textContent = `
      #demo-media-cursor {
        position: fixed;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.95);
        border: 2px solid rgba(17, 24, 39, 0.95);
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.35);
        pointer-events: none;
        z-index: 2147483647;
        transform: translate(-50%, -50%);
      }
      .demo-media-click-pulse {
        position: fixed;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 2px solid rgba(59, 130, 246, 0.95);
        transform: translate(-50%, -50%) scale(1);
        pointer-events: none;
        z-index: 2147483646;
        animation: demoMediaPulse 500ms ease-out forwards;
      }
      @keyframes demoMediaPulse {
        from { opacity: 0.9; transform: translate(-50%, -50%) scale(1); }
        to { opacity: 0; transform: translate(-50%, -50%) scale(2.6); }
      }
    `;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'demo-media-cursor';
    cursor.style.left = '24px';
    cursor.style.top = '24px';
    document.body.appendChild(cursor);

    document.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }, true);

    document.addEventListener('mousedown', (event) => {
      const pulse = document.createElement('div');
      pulse.className = 'demo-media-click-pulse';
      pulse.style.left = `${event.clientX}px`;
      pulse.style.top = `${event.clientY}px`;
      document.body.appendChild(pulse);
      window.setTimeout(() => pulse.remove(), 520);
    }, true);
  });
}
