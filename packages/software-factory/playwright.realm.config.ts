import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  testIgnore: ['**/.boxel-history/**', '**/node_modules/**'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
});
