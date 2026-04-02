import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: process.env.PLAYWRIGHT_TEST_DIR || '.',
  testMatch: ['**/*.spec.ts'],
  testIgnore: ['**/.boxel-history/**', '**/node_modules/**'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
});
