/**
 * Seed files into a realm and block until the indexer has settled.
 *
 * Stages the given files in a fresh temp dir and pushes them with
 * `client.sync(..., { preferLocal: true, waitForIndex: true })`. The
 * `_atomic` upload appends `?waitForIndex=true`, so the realm-server
 * returns only after the indexer has processed every uploaded file —
 * including resolving a Spec's `linkedExamples` links to the examples
 * seeded in the same batch.
 *
 * Tests that assert on indexed state (search results, whole-realm
 * spec/example discovery) need this boundary. A per-file `client.write` +
 * `waitForFile` gate does not provide it: `waitForFile` polls a source
 * GET, which succeeds the moment the file lands on disk, while indexing
 * runs asynchronously afterward with no ordering guarantee relative to a
 * subsequent read. A search or `_federated-search` issued off
 * source-existence can therefore miss a freshly-written card regardless
 * of how long it polls. The `_atomic` waitForIndex query param is the
 * realm-server's first-class hook for read-after-write consistency in
 * tests, trading a one-shot push latency for a deterministic "indexer is
 * settled" boundary.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { expect } from '@playwright/test';

export async function seedFilesAndWaitForIndex(
  client: BoxelCLIClient,
  realmUrl: string,
  files: { path: string; content: string }[],
): Promise<void> {
  for (let { path } of files) {
    let segments = path.split('/');
    // Every path must resolve to a concrete file directly under the staging
    // dir: no absolute paths, no `..` escape, and no empty segment — the
    // latter rejects the empty string, a leading/trailing slash, and
    // doubled slashes, all of which would otherwise target the staging dir
    // root or an ambiguous location rather than a named file.
    if (
      isAbsolute(path) ||
      segments.includes('..') ||
      segments.some((segment) => segment === '')
    ) {
      throw new Error(
        `seedFilesAndWaitForIndex path must be a non-empty realm-relative file path with no absolute, "..", or empty segments; got ${JSON.stringify(path)}`,
      );
    }
  }

  // Retry the sync once on failure. The realm-server's /_atomic
  // endpoint can return 500 ("Write Error") for transient causes —
  // for example a concurrent indexing pass or a worker-side
  // fileSerialization that doesn't recur on retry — and a one-shot
  // retry with a short backoff lets the helper recover instead of
  // surfacing the failure as a confusing test flake.
  //
  // Each attempt uses a fresh staging dir: `RealmSyncer` writes
  // `.boxel-sync.json` even when the batch failed, recording hashes
  // for the staged files. A retry against the same dir would see
  // those hashes match the (unchanged) local files, classify the
  // entries as "unchanged locally / deleted remotely" (since the
  // failed batch never actually wrote them), and with `preferLocal:
  // true` resolve as a noop — silently skipping the upload while
  // reporting success. Fresh dir = no stale manifest = honest
  // re-upload on attempt 2.
  const maxAttempts = 2;
  let syncResult: Awaited<ReturnType<typeof client.sync>> | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let stagingDir = mkdtempSync(join(tmpdir(), 'sf-seed-'));
    try {
      for (let { path, content } of files) {
        let absolute = join(stagingDir, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
      }
      syncResult = await client.sync(realmUrl, stagingDir, {
        preferLocal: true,
        waitForIndex: true,
      });
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    if (!syncResult.hasError) {
      if (attempt > 1) {
        console.log(
          `seedFilesAndWaitForIndex: sync succeeded on attempt ${attempt}/${maxAttempts} for ${realmUrl}`,
        );
      }
      break;
    }
    console.log(
      `seedFilesAndWaitForIndex: sync attempt ${attempt}/${maxAttempts} for ${realmUrl} failed: ${
        syncResult.error ?? '(no error message)'
      }`,
    );
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  expect(
    syncResult!.hasError,
    `seed sync to ${realmUrl} reported an error after ${maxAttempts} attempt(s): ${
      syncResult!.error ?? '(no error message)'
    }`,
  ).toBe(false);
}
