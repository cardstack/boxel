import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

// Model smoke runner: drives the REAL local dev stack (host at :4200, realm
// server at :4201, synapse at :8008, the real ai-bot talking to the provider)
// and asks each model to build and show a hello-world card. Not a test suite
// that CI runs: `pnpm smoke`. See README.md.
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /model-smoke\.spec\.ts/,
  // One test per model; models run in parallel, `SMOKE_WORKERS` at a time
  // (default 5). Headed runs use one worker: `smoke:headed` sets it.
  fullyParallel: true,
  workers: Number(process.env.SMOKE_WORKERS ?? 5),
  retries: 0,
  // One model can legitimately take several minutes (reads, writes, the
  // correctness check). The spec bounds a run itself; this is the backstop.
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: join(
          import.meta.dirname,
          'smoke-results',
          'playwright.json',
        ),
      },
    ],
  ],
  outputDir: join(import.meta.dirname, 'smoke-results', 'artifacts'),
  use: {
    baseURL: process.env.SMOKE_HOST_URL ?? 'https://localhost:4200',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        launchOptions: {
          args: ['--ignore-certificate-errors', '--allow-insecure-localhost'],
        },
      },
    },
  ],
});
