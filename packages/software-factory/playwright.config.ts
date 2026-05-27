import { defineConfig } from '@playwright/test';

// TEMPORARY diagnostic verbosity (revert before merge): surface what the
// harness is doing while a realm stack is set up / torn down, so a "setting
// up realm" hang is legible in CI. `*=info` lifts the harness loggers
// (`software-factory:harness:*`) above the old warn baseline; the two
// TEST_HARNESS_* knobs stream the realm-server / worker / prerender child
// output (`inherit`) and forward the serve-realm child's stdout to the test
// output. Shell env still wins via `??=`.
const defaultPlaywrightLogLevels =
  '*=info,render-desync=info,prerenderer-chrome=none';
process.env.LOG_LEVELS ??= defaultPlaywrightLogLevels;
process.env.TEST_HARNESS_DEBUG_SERVER ??= '1';
process.env.TEST_HARNESS_FORWARD_REALM_LOGS ??= '1';

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
