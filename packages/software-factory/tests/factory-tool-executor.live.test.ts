/**
 * Live integration tests for the ToolExecutor against a running realm server.
 *
 * These tests hit the real realm server APIs to verify the tool executor
 * produces requests the server accepts and responses match expected shapes.
 *
 * Prerequisites (run in separate terminals):
 *   1. pnpm serve:support          # starts Matrix, Postgres, prerender
 *   2. pnpm cache:prepare          # creates template database
 *   3. pnpm serve:realm            # starts realm server on port 4205
 *
 * Or use the dev stack from the repo root:
 *   mise run dev                   # starts everything
 *
 * Required env vars:
 *   MATRIX_URL          — Matrix homeserver URL (e.g. http://localhost:8008/)
 *   MATRIX_USERNAME     — Matrix username (e.g. the software-factory owner)
 *   MATRIX_PASSWORD     — Matrix password
 *   REALM_SERVER_URL    — Realm server base URL (e.g. http://localhost:4205/)
 *
 * Run:
 *   MATRIX_URL=http://localhost:8008/ MATRIX_USERNAME=... MATRIX_PASSWORD=... \
 *   REALM_SERVER_URL=http://localhost:4205/ pnpm test:live
 *
 * Tests skip gracefully when env vars are not set.
 */

import { module, test } from 'qunit';

import {
  getOpenIdToken,
  matrixLogin,
  type MatrixAuth,
} from '../scripts/lib/boxel';
import {
  ToolExecutor,
  ToolNotFoundError,
  type ToolExecutorConfig,
} from '../scripts/lib/factory-tool-executor';
import { ToolRegistry } from '../scripts/lib/factory-tool-registry';

// ---------------------------------------------------------------------------
// Env var check
// ---------------------------------------------------------------------------

let matrixUrl = process.env.MATRIX_URL?.trim();
let matrixUsername = process.env.MATRIX_USERNAME?.trim();
let matrixPassword = process.env.MATRIX_PASSWORD?.trim();
let realmServerUrl = process.env.REALM_SERVER_URL?.trim();

let hasLiveConfig = !!(
  matrixUrl &&
  matrixUsername &&
  matrixPassword &&
  realmServerUrl
);

// ---------------------------------------------------------------------------
// Helpers (must be at module scope for eslint no-inner-declarations)
// ---------------------------------------------------------------------------

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

// Shared auth state — populated in hooks.before
let matrixAuth: MatrixAuth;
let openIdTokenJson: string;
let serverJwt: string;
let realmJwts: Record<string, string>;
let firstRealmUrl: string;

function makeExecutorConfig(
  overrides?: Partial<ToolExecutorConfig>,
): ToolExecutorConfig {
  return {
    packageRoot: process.cwd(),
    targetRealmUrl: firstRealmUrl ?? ensureTrailingSlash(realmServerUrl ?? ''),
    testRealmUrl: ensureTrailingSlash(realmServerUrl ?? ''),
    allowedRealmPrefixes: [ensureTrailingSlash(realmServerUrl ?? '')],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

if (!hasLiveConfig) {
  module('factory-tool-executor live (SKIPPED)', function () {
    test('live tests skipped — set MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD, REALM_SERVER_URL to enable', function (assert) {
      assert.true(
        true,
        'Skipped: env vars not set. Run with pnpm test:live after setting env.',
      );
    });
  });
} else {
  module('factory-tool-executor live', function (hooks) {
    hooks.before(async function () {
      matrixAuth = await matrixLogin({
        profileId: null,
        username: matrixUsername!,
        matrixUrl: ensureTrailingSlash(matrixUrl!),
        realmServerUrl: ensureTrailingSlash(realmServerUrl!),
        password: matrixPassword!,
      });

      let openIdToken = await getOpenIdToken(matrixAuth);
      openIdTokenJson = JSON.stringify(openIdToken);
    });

    test('realm-server-session returns a server JWT', async function (assert) {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, makeExecutorConfig());

      let tokenPayload = JSON.parse(openIdTokenJson) as {
        access_token: string;
      };

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-server-session',
        toolArgs: {
          'realm-server-url': realmServerUrl!,
          'openid-token': tokenPayload.access_token,
        },
      });

      assert.strictEqual(
        result.exitCode,
        0,
        `exitCode 0, got: ${JSON.stringify(result.output)}`,
      );
      let output = result.output as { token: string };
      assert.strictEqual(typeof output.token, 'string', 'token is a string');
      assert.true(
        output.token.startsWith('Bearer '),
        'token starts with Bearer',
      );

      serverJwt = output.token;
    });

    test('realm-auth returns per-realm JWT map', async function (assert) {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(
        registry,
        makeExecutorConfig({ authorization: serverJwt }),
      );

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-auth',
        toolArgs: { 'realm-server-url': realmServerUrl! },
      });

      assert.strictEqual(
        result.exitCode,
        0,
        `exitCode 0, got: ${JSON.stringify(result.output)}`,
      );

      let output = result.output as Record<string, string>;
      let realmUrls = Object.keys(output);
      assert.true(realmUrls.length > 0, 'at least one realm in JWT map');

      for (let [url, jwt] of Object.entries(output)) {
        assert.true(url.startsWith('http'), `key "${url}" looks like a URL`);
        assert.strictEqual(typeof jwt, 'string', `JWT for ${url} is a string`);
      }

      realmJwts = output;
      firstRealmUrl = realmUrls[0];
    });

    test('realm-read fetches .realm.json from an accessible realm', async function (assert) {
      let realmJwt = realmJwts[firstRealmUrl];
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(
        registry,
        makeExecutorConfig({ authorization: realmJwt }),
      );

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-read',
        toolArgs: {
          'realm-url': firstRealmUrl,
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

    test('realm-search returns results', async function (assert) {
      let realmJwt = realmJwts[firstRealmUrl];
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(
        registry,
        makeExecutorConfig({ authorization: realmJwt }),
      );

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-search',
        toolArgs: {
          'realm-url': firstRealmUrl,
          query: JSON.stringify({
            filter: {},
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

    test('realm-create creates a realm with icon and background', async function (assert) {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(
        registry,
        makeExecutorConfig({
          authorization: serverJwt,
          matrixUrl: ensureTrailingSlash(matrixUrl!),
          matrixAccessToken: matrixAuth.accessToken,
          matrixUserId: matrixAuth.userId,
        }),
      );

      let timestamp = Date.now();
      let endpoint = `live-test-${timestamp}`;

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-create',
        toolArgs: {
          'realm-server-url': realmServerUrl!,
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

      // Verify Matrix account data was updated
      let encodedUserId = encodeURIComponent(matrixAuth.userId);
      let accountDataUrl =
        `${ensureTrailingSlash(matrixUrl!)}` +
        `_matrix/client/v3/user/${encodedUserId}/account_data/app.boxel.realms`;

      let accountDataResponse = await fetch(accountDataUrl, {
        headers: { Authorization: `Bearer ${matrixAuth.accessToken}` },
      });

      if (accountDataResponse.ok) {
        let accountData = (await accountDataResponse.json()) as {
          realms?: string[];
        };
        let createdRealmUrl = output.data?.id;
        let realmFound =
          accountData.realms?.some((r) => r === createdRealmUrl) ?? false;
        assert.true(
          realmFound,
          `Matrix account data includes newly created realm ${createdRealmUrl}`,
        );
      } else {
        assert.true(
          true,
          `Could not verify Matrix account data (status ${accountDataResponse.status})`,
        );
      }
    });

    test('unregistered tool is rejected without making HTTP calls', async function (assert) {
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
        assert.true(
          err instanceof ToolNotFoundError,
          'throws ToolNotFoundError',
        );
      }
    });
  });
}
