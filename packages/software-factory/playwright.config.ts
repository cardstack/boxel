import { defineConfig } from '@playwright/test';

import { sharedConfig } from './playwright.shared';

export default defineConfig({
  ...sharedConfig,
  testMatch: ['**/*.spec.ts'],
  // factory-target-realm.spec.ts is excluded here and run separately
  // via `pnpm test:playwright-e2e` (see CS-10472 for context)
  testIgnore: ['**/factory-target-realm.spec.ts'],
  timeout: 60_000,
});
