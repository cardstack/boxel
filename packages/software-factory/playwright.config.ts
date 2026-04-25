import { defineConfig } from '@playwright/test';

// CS-10860 diagnostic: prerenderer + render-route channels were silenced
// at warn-only by default, which left us blind when an SF test timed
// out waiting on a render (we couldn't tell whether the prerender server
// was busy, the page pool was churning, or a render had stalled). The
// `prerenderer-chrome` channel remains off because Chrome console output
// is too noisy to leave on by default; everything else is bumped to info
// so the next timeout has a usable trail in the CI log.
const defaultPlaywrightLogLevels =
  '*=warn,software-factory:playwright=info,software-factory:playwright:support=info,software-factory:playwright:cache=info,prerenderer=info,prerenderer-manager=info,render-ready=info,render-desync=info,prerenderer-chrome=none';
process.env.LOG_LEVELS ??= defaultPlaywrightLogLevels;

const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205);
const realmURL =
  process.env.SOFTWARE_FACTORY_REALM_URL ??
  `http://localhost:${realmPort}/test/`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  reporter: process.env.CI ? [['list']] : undefined,
  workers: 3,
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
