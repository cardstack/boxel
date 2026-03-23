import { defineConfig } from '@playwright/test';

import { sharedConfig } from './playwright.shared';

export default defineConfig({
  ...sharedConfig,
  testMatch: ['**/factory-target-realm.spec.ts'],
  timeout: 180_000,
});
