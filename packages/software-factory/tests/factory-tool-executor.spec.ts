/**
 * Live integration test for the ToolExecutor against the software-factory
 * harness realm server.
 *
 * Runs as a Playwright spec so it shares the harness lifecycle (global-setup
 * starts serve:support + cache:prepare, fixtures start serve:realm per spec).
 * No browser is needed — this is a pure Node test that happens to use the
 * Playwright test runner for harness management.
 *
 * The full factory-tool surface that used to live here (`update_project`,
 * `update_issue`, `add_comment`, `create_knowledge`, `create_catalog_spec`)
 * was retired alongside CS-10883's broader push to native tools — the agent
 * now writes those `.json` files directly via `Write` / `write_file`. That
 * left only one assertion worth keeping in this file: that the executor
 * rejects unregistered tool names before any HTTP request reaches the realm
 * server. (The realm-side request-shape coverage for `realm-create` —
 * the only surviving registry tool — is a follow-up worth adding here.)
 */

import { test } from './fixtures.ts';

import {
  ToolExecutor,
  ToolNotFoundError,
} from '../src/factory-tool-executor.ts';
import { ToolRegistry } from '../src/factory-tool-registry.ts';
import { buildTestClient } from './helpers/test-client.ts';

test('unregistered tool is rejected without reaching the server', async ({
  realm,
}) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealm: realm.realmURL.href,
      client,
    });

    let threw: unknown;
    try {
      await executor.execute('shell-exec-arbitrary', { command: 'rm -rf /' });
    } catch (err) {
      threw = err;
    }
    if (!(threw instanceof ToolNotFoundError)) {
      throw new Error(
        `expected ToolNotFoundError, got ${
          threw instanceof Error ? threw.message : String(threw)
        }`,
      );
    }
  } finally {
    cleanup();
  }
});
