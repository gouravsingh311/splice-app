import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/electron',
  timeout: 120_000,
  outputDir: './test-results/playwright-demo',
  reporter: [['list'], ['html', { outputFolder: 'test-results/playwright-demo-report', open: 'never' }]],
  projects: [
    {
      name: 'electron-demo-video',
      testMatch: /demo-capture\.spec\.ts/,
      use: {
        video: 'on',
        trace: 'off',
        screenshot: 'off',
      },
    },
    {
      name: 'electron-demo-stills',
      testMatch: /demo-capture\.spec\.ts/,
      use: {
        video: 'off',
        trace: 'off',
        screenshot: 'off',
      },
    },
  ],
});
