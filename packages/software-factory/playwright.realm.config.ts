import { defineConfig } from '@playwright/test';
import { chromeSandboxEnabled } from '@cardstack/runtime-common/chrome-sandbox';

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
  use: {
    // The specs this config runs come from a realm. The sandbox is off only
    // on Linux, for the reasons `chromeSandboxEnabled` gives.
    launchOptions: { chromiumSandbox: chromeSandboxEnabled() },
  },
});
