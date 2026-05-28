import { defineConfig } from '@playwright/test';

// `render-desync=info` stays on so the desync detector's verdicts (warns
// on detection, plus any debug logs we add later) make it into CI output;
// everything else is at the same warn-baseline as before CS-10860.
const defaultPlaywrightLogLevels =
  '*=warn,software-factory:playwright=info,software-factory:playwright:support=info,software-factory:playwright:cache=info,render-desync=info,prerenderer-chrome=none';
process.env.LOG_LEVELS ??= defaultPlaywrightLogLevels;

const realmPort = Number(process.env.TEST_HARNESS_REALM_PORT ?? 4205);
const realmURL =
  process.env.TEST_HARNESS_REALM_URL ?? `http://localhost:${realmPort}/test/`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  reporter: process.env.CI ? [['list']] : undefined,
  // The runQunitInBrowser-based tests (factory-test-realm.spec.ts and
  // run-tests-in-memory.spec.ts) each spawn a fresh Chromium and load
  // the full vite-bundled host runtime. With workers > 1, multiple heavy
  // browsers run in parallel and exhaust the 7GB GitHub-hosted runner —
  // observed as "hosted runner lost communication with the server" at
  // ~53min. Serializing keeps total runtime at ~33min and is reliable.
  // TODO: revisit after the vite migration stabilises (e.g. tag the
  // heavy specs and run them in a dedicated worker pool).
  workers: 1,
  timeout: 300_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: realmURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: './playwright.global-setup.ts',
  globalTeardown: './playwright.global-teardown.ts',
});
