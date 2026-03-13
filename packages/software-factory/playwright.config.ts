import { defineConfig } from '@playwright/test';

const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4444);
const realmURL =
  process.env.SOFTWARE_FACTORY_REALM_URL ?? `http://127.0.0.1:${realmPort}/`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: 60_000,
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
