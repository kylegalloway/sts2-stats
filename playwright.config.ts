import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev -w packages/server',
      url: 'http://localhost:3002/api/status',
      reuseExistingServer: false,
      timeout: 15_000,
      env: { E2E: '1', E2E_DB_PATH: 'sts2-e2e.db', PORT: '3002' },
    },
    {
      command: 'npm run dev -w packages/client',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 15_000,
      env: { VITE_PORT: '5174', VITE_SERVER_PORT: '3002' },
    },
  ],
});
