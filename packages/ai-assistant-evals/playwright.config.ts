import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

// run-eval.ts points this at a per-session directory; a plain `pnpm eval:models`
// writes to eval-results/.
const RESULTS_DIR =
  process.env.EVAL_RESULTS_DIR ?? join(import.meta.dirname, 'eval-results');

// Model eval runner: drives the REAL local dev stack (host at :4200, realm
// server at :4201, synapse at :8008, the real ai-bot talking to the provider)
// and asks each model to build and show a hello-world card. Not a test suite
// that CI runs: `pnpm eval:models`. See README.md.
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /assistant-eval\.spec\.ts/,
  // One test per model; models run in parallel, `EVAL_WORKERS` at a time
  // (default 5). Headed runs use one worker: `eval:models:headed` sets it.
  fullyParallel: true,
  workers: Number(process.env.EVAL_WORKERS ?? 5),
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
        outputFile: join(RESULTS_DIR, 'playwright.json'),
      },
    ],
  ],
  outputDir: join(RESULTS_DIR, 'artifacts'),
  use: {
    baseURL: process.env.EVAL_HOST_URL ?? 'https://localhost:4200',
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
