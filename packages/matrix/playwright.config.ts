import { defineConfig, devices } from '@playwright/test';
import { readdirSync } from 'fs';

let tests = readdirSync('./tests');
let middle = Math.floor(tests.length / 2);
let group1 = tests.slice(0, middle);
let group2 = tests.slice(middle);

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: 'http://localhost:4202/test',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'all',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'group1',
      testMatch: new RegExp(
        `.*(${group1.map((i) => i.replace(/\./g, '\\.')).join('|')})`,
      ),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'group2',
      testMatch: new RegExp(
        `.*(${group2.map((i) => i.replace(/\./g, '\\.')).join('|')})`,
      ),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // General timeout per test
  timeout: 30000,

  // For expect calls
  expect: {
    timeout: 30000,
  },
});
