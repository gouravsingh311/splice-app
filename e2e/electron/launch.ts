import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import Database from 'better-sqlite3';
import {
  DEFAULT_E2E_AUTH_ACCESS_SECRET,
  DEFAULT_E2E_INTERNAL_API_TOKEN,
  resolveEnvOrDefault,
} from '../test-utils/authContext';

export const DB_PATH = path.join(process.cwd(), 'data', 'test.db');

export async function launchApp(options?: {
  actorId?: string;
  actorRoles?: 'creator' | 'reviewer' | 'admin';
  authStub?: boolean;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const authStub = options?.authStub ?? true;
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'electron/main.js')],
    env: {
      ...process.env,
      FILEEATERS_AUTH_STUB: authStub ? 'true' : 'false',
      FILEEATERS_ACTOR_ID: options?.actorId ?? 'e2e-user',
      FILEEATERS_AUTH_ROLES: options?.actorRoles ?? 'creator',
      SPLICE_AUTH_ACCESS_SECRET: resolveEnvOrDefault(process.env.SPLICE_AUTH_ACCESS_SECRET, DEFAULT_E2E_AUTH_ACCESS_SECRET),
      SPLICE_INTERNAL_API_TOKEN: resolveEnvOrDefault(process.env.SPLICE_INTERNAL_API_TOKEN, DEFAULT_E2E_INTERNAL_API_TOKEN),
      SPLICE_ENV: resolveEnvOrDefault(process.env.SPLICE_ENV, 'local'),
      SPLICE_DB_PATH: './data/test.db',
      SPLICE_HEALTH_PORT: '0',
      NODE_ENV: 'test',
      PLAYWRIGHT_E2E: '1',
      E2E_PACK_PATH: path.join(process.cwd(), 'e2e/fixtures/valid_pack'),
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

export function openDb(): Database.Database {
  return new Database(DB_PATH);
}

export async function resolveApiBaseUrl(app: ElectronApplication): Promise<string> {
  const baseUrl = await app.evaluate(async () => process.env.SPLICE_API_BASE_URL || '');
  return String(baseUrl || '').trim();
}
