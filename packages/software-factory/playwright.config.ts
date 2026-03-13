import { defineConfig } from '@playwright/test';

const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205);
const realmURL =
  process.env.SOFTWARE_FACTORY_REALM_URL ??
  `http://localhost:${realmPort}/test/`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
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
});
