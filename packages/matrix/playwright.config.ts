import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'https://localhost:4205/test',
    ignoreHTTPSErrors: true,

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
            // Simulate resolving a custom workspace domain to a realm server.
            // The second rule points the mock OIDC provider's container-name
            // host (the issuer Synapse advertises) at its published host port,
            // so the browser and Synapse resolve `boxel-mock-oauth:8080` to the
            // same server and the issuer / `iss` claim stays consistent.
            '--host-resolver-rules=MAP published.realm 127.0.0.1:4205,MAP boxel-mock-oauth 127.0.0.1:8083',
            // The mkcert leaf's SAN is `localhost` only — the published
            // realm subdomain (`https://published.realm:4205/`) and the
            // tenant-style subdomains under `*.localhost:4205` that
            // publish-realm.spec.ts exercises fail strict cert
            // validation. Pair --ignore-certificate-errors with
            // --allow-insecure-localhost so chrome 144+ actually honors
            // the relaxation (Chrome silently demoted
            // --ignore-certificate-errors to a dev-only flag without
            // --allow-insecure-localhost).
            '--ignore-certificate-errors',
            '--allow-insecure-localhost',
            // Allow iframe to request storage access depsite being considered insecure
            '--unsafely-treat-insecure-origin-as-secure=https://published.realm',
          ],
          // devtools: true,
        },
      },
    },
  ],
});
