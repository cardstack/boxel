import { defineConfig, devices } from '@playwright/test';
import { appURL } from './helpers/isolated-realm-server';
import {
  isEnvironmentMode,
  getEnvironmentSlug,
} from './helpers/environment-config';

// In environment mode, the isolated realm server is behind Traefik on port 80.
// In non-env mode, it listens directly on port 4205.
let realmPort = isEnvironmentMode() ? 80 : 4205;

/**
 * See https://playwright.dev/docs/test-configuration.
 */

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  globalSetup: 'tests/global.setup.ts',
  reporter: process.env.CI ? 'blob' : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: appURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retry-with-trace',
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
            `--host-resolver-rules=MAP published.realm 127.0.0.1:${realmPort}`,
            // Allow iframe to request storage access depsite being considered insecure
            '--unsafely-treat-insecure-origin-as-secure=http://published.realm',
          ],
          // devtools: true,
        },
      },
    },
  ],
});
