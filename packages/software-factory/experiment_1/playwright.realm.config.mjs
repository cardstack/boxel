import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.mjs'],
  testIgnore: ['**/.boxel-history/**', '**/node_modules/**'],
});
