import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  globalSetup: './e2e/globalSetup.ts',
  globalTeardown: './e2e/globalTeardown.ts',
  outputDir: './test-results/playwright',
  reporter: [['list'], ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // no browserName — tests use _electron.launch()
  },
  projects: [
    {
      name: 'electron-ui',
      testMatch: /electron\/.*\.spec\.ts/,
      testIgnore: /electron\/media\/demo-capture\.spec\.ts/,
    },
    {
      name: 'api-contract',
      testMatch: /api\/.*\.spec\.ts/,
      use: {
        baseURL: process.env.PW_API_BASE_URL || 'http://127.0.0.1:8017',
      },
    },
  ],
});
