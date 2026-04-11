import { defineConfig, devices } from '@playwright/test';

const NEXT_PORT = process.env.NEXT_PORT || '3666';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${NEXT_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Assumes ./start.sh from the repo root is already running both processes.
  // Manual: cd ../../.. && ./start.sh, then in another terminal: npm run test:e2e
  // CI: starts the stack via a separate workflow step.
});
