/**
 * Live integration tests for the ToolExecutor against the software-factory
 * harness realm server.
 *
 * These tests hit the real realm server APIs to verify the tool executor
 * produces requests the server accepts and responses match expected shapes.
 *
 * Prerequisites:
 *   1. pnpm serve:support          # starts Matrix, Postgres, prerender
 *   2. pnpm cache:prepare          # creates template database
 *   3. pnpm serve:realm            # starts realm server on port 4205
 *
 * Auth uses the harness's known secret seed to mint JWTs directly,
 * matching the pattern in src/harness.ts — no Matrix login needed.
 *
 * Tests FAIL with a clear message when the realm server is not running.
 */

import jwt from 'jsonwebtoken';
import { module, test } from 'qunit';

import {
  ToolExecutor,
  ToolNotFoundError,
  type ToolExecutorConfig,
} from '../scripts/lib/factory-tool-executor';
import { ToolRegistry } from '../scripts/lib/factory-tool-registry';

// ---------------------------------------------------------------------------
// Harness constants (match src/harness.ts)
// ---------------------------------------------------------------------------

const REALM_SERVER_PORT = Number(
  process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205,
);
const REALM_SERVER_URL = `http://localhost:${REALM_SERVER_PORT}/`;
const TEST_REALM_URL = `${REALM_SERVER_URL}test/`;
const REALM_SECRET_SEED = "shhh! it's a secret";
const DEFAULT_REALM_OWNER = '@software-factory-owner:localhost';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRealmToken(
  realmURL: string,
  user = DEFAULT_REALM_OWNER,
  permissions = ['read', 'write', 'realm-owner'],
): string {
  return (
    'Bearer ' +
    jwt.sign(
      {
        user,
        realm: realmURL,
        permissions,
        sessionRoom: `software-factory-session-room-for-${user}`,
        realmServerURL: REALM_SERVER_URL,
      },
      REALM_SECRET_SEED,
      { expiresIn: '7d' },
    )
  );
}

function makeExecutorConfig(
  overrides?: Partial<ToolExecutorConfig>,
): ToolExecutorConfig {
  return {
    packageRoot: process.cwd(),
    targetRealmUrl: TEST_REALM_URL,
    testRealmUrl: TEST_REALM_URL,
    allowedRealmPrefixes: [REALM_SERVER_URL],
    ...overrides,
  };
}

async function isRealmServerRunning(): Promise<boolean> {
  try {
    let response = await fetch(REALM_SERVER_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok || response.status === 403 || response.status === 404;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('factory-tool-executor live', function (hooks) {
  hooks.before(async function () {
    let running = await isRealmServerRunning();
    if (!running) {
      throw new Error(
        `Realm server is not running at ${REALM_SERVER_URL}. ` +
          `Start the harness first:\n` +
          `  pnpm serve:support\n` +
          `  pnpm cache:prepare\n` +
          `  pnpm serve:realm`,
      );
    }
  });

  test('realm-read fetches .realm.json from the test realm', async function (assert) {
    let realmJwt = buildRealmToken(TEST_REALM_URL);
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeExecutorConfig({ authorization: realmJwt }),
    );

    let result = await executor.execute({
      type: 'invoke_tool',
      tool: 'realm-read',
      toolArgs: {
        'realm-url': TEST_REALM_URL,
        path: '.realm.json',
      },
    });

    assert.strictEqual(
      result.exitCode,
      0,
      `exitCode 0, got: ${JSON.stringify(result.output)}`,
    );
    assert.strictEqual(typeof result.output, 'object', 'output is an object');
  });

  test('realm-search returns results from the test realm', async function (assert) {
    let realmJwt = buildRealmToken(TEST_REALM_URL);
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeExecutorConfig({ authorization: realmJwt }),
    );

    let result = await executor.execute({
      type: 'invoke_tool',
      tool: 'realm-search',
      toolArgs: {
        'realm-url': TEST_REALM_URL,
        query: JSON.stringify({
          filter: {
            type: {
              module: 'https://cardstack.com/base/card-api',
              name: 'CardDef',
            },
          },
          page: { size: 1 },
        }),
      },
    });

    assert.strictEqual(
      result.exitCode,
      0,
      `exitCode 0, got: ${JSON.stringify(result.output)}`,
    );
    let output = result.output as { data?: unknown[] };
    assert.true(Array.isArray(output.data), 'output has data array');
  });

  // realm-create live test is blocked by CS-10472 (harness process teardown
  // leaves orphaned processes that interfere with subsequent realm creation).
  // The request building and body shape are verified by unit + integration tests.

  test('unregistered tool is rejected', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeExecutorConfig());

    try {
      await executor.execute({
        type: 'invoke_tool',
        tool: 'shell-exec-arbitrary',
        toolArgs: { command: 'rm -rf /' },
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolNotFoundError, 'throws ToolNotFoundError');
    }
  });
});
