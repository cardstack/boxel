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
  use: {
    // The specs this config runs come from a realm. Playwright starts Chromium
    // with its sandbox off unless asked. On macOS and Windows the sandbox needs
    // no privileges, so it is on. On Linux the bundled Chromium has no setuid
    // sandbox helper, so it needs unprivileged user namespaces, which Ubuntu
    // 23.10+ blocks for it by default. There the run keeps the sandbox off
    // rather than depend on the host's settings.
    launchOptions: { chromiumSandbox: process.platform !== 'linux' },
  },
});
