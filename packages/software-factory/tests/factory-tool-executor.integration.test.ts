import { createServer, type IncomingMessage, type Server } from 'node:http';
import { module, test } from 'qunit';

import { getToolDefinitions } from '@cardstack/boxel-cli/api';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { adaptBoxelTool, type FactoryTool } from '../src/factory-tool-builder';
import {
  ToolExecutor,
  type RealmSafetyConfig,
} from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { buildTestClient } from './helpers/test-client';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

/**
 * Build a single boxel-cli FactoryTool wrapped with `enforceRealmSafety`,
 * matching what `buildFactoryTools` does at runtime. Used by the
 * realm-api integration tests that exercise wire shape through the
 * agent-facing FactoryTool path.
 */
function buildBoxelFactoryTool(
  toolName: string,
  client: BoxelCLIClient,
  safety: RealmSafetyConfig,
  realmServerUrl: string,
): FactoryTool {
  let tools = getToolDefinitions(client, {
    targetRealmUrl: safety.targetRealmUrl,
    realmServerUrl,
  });
  let boxelTool = tools.find((t) => t.name === toolName);
  if (!boxelTool) {
    throw new Error(
      `boxel-cli tool "${toolName}" not found in getToolDefinitions`,
    );
  }
  return adaptBoxelTool(boxelTool, safety);
}

// ---------------------------------------------------------------------------
// Test server helpers
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function startTestServer(
  handler: (
    req: CapturedRequest,
    respond: (
      status: number,
      body: unknown,
      headers?: Record<string, string>,
    ) => void,
  ) => void,
): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    let server = createServer(async (req: IncomingMessage, res) => {
      let body = '';
      for await (let chunk of req) {
        body += chunk;
      }

      let captured: CapturedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body,
      };

      handler(captured, (status, responseBody, headers) => {
        res.writeHead(status, {
          'Content-Type': SupportedMimeType.JSON,
          ...headers,
        });
        res.end(
          responseBody !== null && responseBody !== undefined
            ? JSON.stringify(responseBody)
            : '',
        );
      });
    });

    server.listen(0, () => {
      let address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected test server to bind to a TCP port');
      }
      let origin = `http://127.0.0.1:${address.port}`;
      resolve({ server, origin });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

// ---------------------------------------------------------------------------
// Integration tests: boxel-cli tool wire shape against a real HTTP server
// ---------------------------------------------------------------------------
// Each test asserts the exact HTTP request the boxel-cli tool emits when the
// factory invokes it via getToolDefinitions(). A regression like "we forgot
// to send the Bearer token" or "we sent JSON instead of card-source" would
// fail one of these tests with a clear diff.

// Wire-shape coverage for realm-* tools comes from the
// `boxel-cli tool wire shape` module below (which exercises
// getToolDefinitions directly). Safety-guard coverage on top of that
// path lives in factory-tool-executor.test.ts via the buildBoxelFactoryTool
// helper. The previous `realm-api requests` module routed through
// `executor.execute('realm-*', …)` — that dispatch path no longer exists.
module(
  'factory-tool-executor integration > boxel-cli tool wire shape',
  function () {
    test('realm_read_file sends GET with realm JWT and card-source Accept', async function (assert) {
      let captured: CapturedRequest | undefined;
      let { server, origin } = await startTestServer((req, respond) => {
        captured = req;
        respond(200, 'export class A {}', {
          'Content-Type': SupportedMimeType.CardSource,
        });
      });

      let realmUrl = `${origin}/user/target/`;
      let realmServerUrl = `${origin}/`;
      let { client, cleanup } = buildTestClient({
        realmUrl,
        realmToken: 'Bearer realm-jwt-for-user',
        realmServerUrl,
        realmServerToken: 'Bearer realm-server-jwt',
      });

      try {
        let tools = getToolDefinitions(client, {
          targetRealmUrl: realmUrl,
          realmServerUrl,
        });
        let realmRead = tools.find((t) => t.name === 'realm_read_file')!;

        await realmRead.execute({
          'realm-url': realmUrl,
          path: 'Card/hello.gts',
        });

        assert.ok(captured, 'request reached the server');
        assert.strictEqual(captured!.method, 'GET');
        assert.strictEqual(captured!.url, '/user/target/Card/hello.gts');
        assert.strictEqual(
          captured!.headers.authorization,
          'Bearer realm-jwt-for-user',
        );
        assert.strictEqual(
          captured!.headers.accept,
          SupportedMimeType.CardSource,
        );
        assert.strictEqual(captured!.body, '');
      } finally {
        cleanup();
        await stopServer(server);
      }
    });

    test('realm_write_file sends POST with content body and card-source headers', async function (assert) {
      let captured: CapturedRequest | undefined;
      let { server, origin } = await startTestServer((req, respond) => {
        captured = req;
        respond(200, { ok: true });
      });

      let realmUrl = `${origin}/user/target/`;
      let realmServerUrl = `${origin}/`;
      let { client, cleanup } = buildTestClient({
        realmUrl,
        realmToken: 'Bearer realm-jwt-for-user',
        realmServerUrl,
        realmServerToken: 'Bearer realm-server-jwt',
      });

      try {
        let tools = getToolDefinitions(client, {
          targetRealmUrl: realmUrl,
          realmServerUrl,
        });
        let realmWrite = tools.find((t) => t.name === 'realm_write_file')!;
        let content = 'export class MyCard extends CardDef {}';

        await realmWrite.execute({
          'realm-url': realmUrl,
          path: 'CardDef/my-card.gts',
          content,
        });

        assert.ok(captured, 'request reached the server');
        assert.strictEqual(captured!.method, 'POST');
        assert.strictEqual(captured!.url, '/user/target/CardDef/my-card.gts');
        assert.strictEqual(
          captured!.headers.authorization,
          'Bearer realm-jwt-for-user',
        );
        assert.strictEqual(
          captured!.headers['content-type'],
          SupportedMimeType.CardSource,
        );
        assert.strictEqual(captured!.body, content);
      } finally {
        cleanup();
        await stopServer(server);
      }
    });

    test('realm_delete_file sends DELETE with realm JWT', async function (assert) {
      let captured: CapturedRequest | undefined;
      let { server, origin } = await startTestServer((req, respond) => {
        captured = req;
        respond(200, { ok: true });
      });

      let realmUrl = `${origin}/user/target/`;
      let realmServerUrl = `${origin}/`;
      let { client, cleanup } = buildTestClient({
        realmUrl,
        realmToken: 'Bearer realm-jwt-for-user',
        realmServerUrl,
        realmServerToken: 'Bearer realm-server-jwt',
      });

      try {
        let tools = getToolDefinitions(client, {
          targetRealmUrl: realmUrl,
          realmServerUrl,
        });
        let realmDelete = tools.find((t) => t.name === 'realm_delete_file')!;

        await realmDelete.execute({
          'realm-url': realmUrl,
          path: 'Card/old.json',
        });

        assert.ok(captured, 'request reached the server');
        assert.strictEqual(captured!.method, 'DELETE');
        assert.strictEqual(captured!.url, '/user/target/Card/old.json');
        assert.strictEqual(
          captured!.headers.authorization,
          'Bearer realm-jwt-for-user',
        );
        assert.strictEqual(captured!.body, '');
      } finally {
        cleanup();
        await stopServer(server);
      }
    });

    test('realm_search sends QUERY to _federated-search with server JWT and realms array', async function (assert) {
      let captured: CapturedRequest | undefined;
      let { server, origin } = await startTestServer((req, respond) => {
        captured = req;
        respond(200, { data: [] });
      });

      let realmUrl = `${origin}/user/target/`;
      let realmServerUrl = `${origin}/`;
      let { client, cleanup } = buildTestClient({
        realmUrl,
        realmToken: 'Bearer realm-jwt-for-user',
        realmServerUrl,
        realmServerToken: 'Bearer realm-server-jwt',
      });

      try {
        let tools = getToolDefinitions(client, {
          targetRealmUrl: realmUrl,
          realmServerUrl,
        });
        let realmSearch = tools.find((t) => t.name === 'realm_search')!;
        let query = { filter: { type: { name: 'Issue' } } };

        await realmSearch.execute({ 'realm-url': realmUrl, query });

        assert.ok(captured, 'request reached the server');
        assert.strictEqual(captured!.method, 'QUERY');
        assert.strictEqual(captured!.url, '/_federated-search');
        assert.strictEqual(
          captured!.headers.authorization,
          'Bearer realm-server-jwt',
        );
        assert.strictEqual(
          captured!.headers['content-type'],
          'application/json',
        );

        let parsed = JSON.parse(captured!.body) as {
          realms: string[];
          filter: unknown;
        };
        assert.deepEqual(parsed.realms, [realmUrl], 'body.realms = [realmUrl]');
        assert.deepEqual(parsed.filter, query.filter, 'query merged into body');
      } finally {
        cleanup();
        await stopServer(server);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Integration tests: safety constraints prevent requests from reaching server
// ---------------------------------------------------------------------------

module('factory-tool-executor integration > safety constraints', function () {
  test('unregistered tool is rejected before any HTTP request', async function (assert) {
    let requestCount = 0;

    let { server, origin } = await startTestServer((_req, respond) => {
      requestCount++;
      respond(200, {});
    });

    let { client, cleanup } = buildTestClient({
      realmUrl: `${origin}/user/target/`,
      realmToken: 'Bearer realm-jwt',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        client,
      });

      try {
        await executor.execute('shell-exec-arbitrary', {
          command: 'rm -rf /',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(
          (err as Error).message.includes('Unregistered tool'),
          'throws for unregistered tool',
        );
      }

      assert.strictEqual(requestCount, 0, 'server received zero requests');
    } finally {
      cleanup();
      await stopServer(server);
    }
  });

  test('source realm targeting is rejected before any HTTP request', async function (assert) {
    let requestCount = 0;

    let { server, origin } = await startTestServer((_req, respond) => {
      requestCount++;
      respond(200, {});
    });

    let { client, cleanup } = buildTestClient({
      realmUrl: `${origin}/user/target/`,
      realmToken: 'Bearer realm-jwt',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let registry = new ToolRegistry();
      let sourceUrl = `${origin}/user/source/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        sourceRealmUrl: sourceUrl,
        client,
      });

      try {
        await executor.execute('search-realm', {
          realm: sourceUrl,
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(
          (err as Error).message.includes('source realm'),
          'throws for source realm targeting',
        );
      }

      assert.strictEqual(requestCount, 0, 'server received zero requests');
    } finally {
      cleanup();
      await stopServer(server);
    }
  });

  test('unknown realm targeting is rejected before any HTTP request', async function (assert) {
    let requestCount = 0;

    let { server, origin } = await startTestServer((_req, respond) => {
      requestCount++;
      respond(200, {});
    });

    let { client, cleanup } = buildTestClient({
      realmUrl: `${origin}/user/target/`,
      realmToken: 'Bearer realm-jwt',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let realmRead = buildBoxelFactoryTool(
        'realm_read_file',
        client,
        {
          targetRealmUrl: `${origin}/user/target/`,
        },
        `${origin}/`,
      );

      try {
        await realmRead.execute({
          'realm-url': 'https://evil.example.test/hacker/realm/',
          path: 'secrets.json',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(
          (err as Error).message.includes('not in the allowed list'),
          'throws for unknown realm',
        );
      }

      assert.strictEqual(requestCount, 0, 'server received zero requests');
    } finally {
      cleanup();
      await stopServer(server);
    }
  });
});
