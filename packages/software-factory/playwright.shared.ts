import type { PlaywrightTestConfig } from '@playwright/test';

const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205);
const realmURL =
  process.env.SOFTWARE_FACTORY_REALM_URL ??
  `http://localhost:${realmPort}/test/`;

export const sharedConfig: PlaywrightTestConfig = {
  testDir: './tests',
  fullyParallel: false,
  reporter: process.env.CI ? [['list']] : undefined,
  workers: 1,
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
};
