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
 * Tests skip gracefully when the realm server is not running.
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
const REALM_SERVER_SECRET_SEED = "mum's the word";
const DEFAULT_REALM_OWNER = '@software-factory-owner:localhost';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRealmToken(
  realmURL: string,
  user = DEFAULT_REALM_OWNER,
  permissions = ['read', 'write', 'realm-owner'],
): string {
  return jwt.sign(
    {
      user,
      realm: realmURL,
      permissions,
      sessionRoom: `software-factory-session-room-for-${user}`,
      realmServerURL: REALM_SERVER_URL,
    },
    REALM_SECRET_SEED,
    { expiresIn: '7d' },
  );
}

function buildRealmServerToken(user = DEFAULT_REALM_OWNER): string {
  return jwt.sign(
    {
      user,
      sessionRoom: `software-factory-session-room-for-${user}`,
    },
    REALM_SERVER_SECRET_SEED,
    { expiresIn: '7d' },
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
  let serverRunning = false;

  hooks.before(async function () {
    serverRunning = await isRealmServerRunning();
    if (!serverRunning) {
      console.log(
        '\n  [SKIP] Realm server not running at ' +
          REALM_SERVER_URL +
          ' — run: pnpm serve:support && pnpm cache:prepare && pnpm serve:realm\n',
      );
    }
  });

  test('realm-read fetches .realm.json from the test realm', async function (assert) {
    if (!serverRunning) {
      assert.expect(0);
    } else {
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
    }
  });

  test('realm-search returns results from the test realm', async function (assert) {
    if (!serverRunning) {
      assert.expect(0);
    } else {
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
          query: JSON.stringify({ filter: {}, page: { size: 1 } }),
        },
      });

      assert.strictEqual(
        result.exitCode,
        0,
        `exitCode 0, got: ${JSON.stringify(result.output)}`,
      );
      let output = result.output as { data?: unknown[] };
      assert.true(Array.isArray(output.data), 'output has data array');
    }
  });

  test('realm-create creates a scratch realm with icon and background', async function (assert) {
    if (!serverRunning) {
      assert.expect(0);
    } else {
      let serverJwt = buildRealmServerToken();
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(
        registry,
        makeExecutorConfig({ authorization: serverJwt }),
      );

      let timestamp = Date.now();
      let endpoint = `live-test-${timestamp}`;

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-create',
        toolArgs: {
          'realm-server-url': REALM_SERVER_URL,
          name: `Live Test ${timestamp}`,
          endpoint,
        },
      });

      assert.strictEqual(
        result.exitCode,
        0,
        `exitCode 0, got: ${JSON.stringify(result.output)}`,
      );

      let output = result.output as {
        data?: {
          type?: string;
          id?: string;
          attributes?: Record<string, unknown>;
        };
      };
      assert.strictEqual(output.data?.type, 'realm', 'response type is realm');
      assert.strictEqual(
        typeof output.data?.id,
        'string',
        'response has realm id',
      );
    }
  });

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
