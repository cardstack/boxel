import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'blob' : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: 'http://localhost:4202/test',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  // General timeout per test
  timeout: 60000,

  // For expect calls
  expect: {
    timeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Simulate resolving a custom workspace domain to a realm server
            '--host-resolver-rules=MAP published.realm 127.0.0.1:4205',
            // Allow iframe to request storage access depsite being considered insecure
            '--unsafely-treat-insecure-origin-as-secure=http://published.realm',
          ],
          // devtools: true,
        },
      },
    },
  ],
});
