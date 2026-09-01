import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';
import {
  assignSpecFiles,
  discoverSpecFiles,
  loadSpecTimings,
  parseShardCoordinates,
  specFileMatchers,
} from './support/shard-spec-files.ts';

/**
 * See https://playwright.dev/docs/test-configuration.
 */

const testDir = join(import.meta.dirname, 'tests');

// CI splits the suite across shards by cost rather than by test count, so
// `--shard` is not used: each shard is handed its coordinates as
// MATRIX_TEST_SHARD (`<index>/<total>`) and narrows `testMatch` to the spec
// files bin-packed onto it. See support/shard-spec-files.ts. Unset — a local
// `pnpm test` — runs the whole suite.
const shard = parseShardCoordinates(process.env.MATRIX_TEST_SHARD);
const shardSpecFiles = shard
  ? assignSpecFiles(
      discoverSpecFiles(testDir),
      shard.index,
      shard.total,
      loadSpecTimings(join(testDir, 'spec-timings.json')),
    )
  : undefined;

export default defineConfig({
  testDir,
  ...(shardSpecFiles
    ? { testMatch: specFileMatchers(testDir, shardSpecFiles) }
    : {}),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  globalSetup: 'tests/global.setup.ts',
  // Without `--shard`, every shard's blob report would default to the same
  // `report.zip`, and the merge job downloads all of them into one directory.
  reporter: process.env.CI
    ? [
        [
          'blob',
          { fileName: shard ? `report-${shard.index}.zip` : 'report.zip' },
        ],
      ]
    : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: 'https://localhost:4205/test',
    ignoreHTTPSErrors: true,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retry-with-trace',
  },
  // General timeout per test
  timeout: 60000,

  // For expect calls
  expect: {
    timeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Simulate resolving a custom workspace domain to a realm server.
            // The second rule points the mock OIDC provider's container-name
            // host (the issuer Synapse advertises) at its published host port,
            // so the browser and Synapse resolve `boxel-mock-oauth:8080` to the
            // same server and the issuer / `iss` claim stays consistent.
            '--host-resolver-rules=MAP published.realm 127.0.0.1:4205,MAP boxel-mock-oauth 127.0.0.1:8083',
            // The mkcert leaf's SAN is `localhost` only — the published
            // realm subdomain (`https://published.realm:4205/`) and the
            // tenant-style subdomains under `*.localhost:4205` that
            // publish-realm.spec.ts exercises fail strict cert
            // validation. Pair --ignore-certificate-errors with
            // --allow-insecure-localhost so chrome 144+ actually honors
            // the relaxation (Chrome silently demoted
            // --ignore-certificate-errors to a dev-only flag without
            // --allow-insecure-localhost).
            '--ignore-certificate-errors',
            '--allow-insecure-localhost',
            // Allow iframe to request storage access depsite being considered insecure
            '--unsafely-treat-insecure-origin-as-secure=https://published.realm',
          ],
          // devtools: true,
        },
      },
    },
  ],
});
