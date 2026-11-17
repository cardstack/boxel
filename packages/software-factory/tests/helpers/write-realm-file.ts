import { expect } from '@playwright/test';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

/**
 * Write one file to a realm, failing the test with everything the write
 * reported when it is refused: the HTTP status and body the realm server or
 * the compat proxy answered with, or the client-side error (with its cause)
 * when no response came back at all.
 *
 * The elapsed time is part of the failure message because it separates a
 * write refused at once from one that failed after the realm server worked on
 * it, which is the first question a refused seed write raises.
 */
export async function writeRealmFile(
  client: BoxelCLIClient,
  realmUrl: string,
  path: string,
  content: string,
): Promise<void> {
  let startedAt = performance.now();
  let result = await client.write(realmUrl, path, content);
  let elapsedMs = Math.round(performance.now() - startedAt);
  expect(
    result.ok,
    `write ${path} to ${realmUrl} failed after ${elapsedMs}ms: ${result.error}`,
  ).toBe(true);
}

/**
 * Push a local workspace to a realm (local copy wins), failing the test with
 * the sync's error and elapsed time when the push fails. A failed push
 * otherwise surfaces later as a missing or stale file in whatever reads the
 * realm next, far from its cause.
 */
export async function syncWorkspaceToRealm(
  client: BoxelCLIClient,
  realmUrl: string,
  workspaceDir: string,
): Promise<void> {
  let startedAt = performance.now();
  let result = await client.sync(realmUrl, workspaceDir, { preferLocal: true });
  let elapsedMs = Math.round(performance.now() - startedAt);
  expect(
    result.hasError,
    `sync ${workspaceDir} to ${realmUrl} failed after ${elapsedMs}ms: ${result.error}`,
  ).toBe(false);
}
