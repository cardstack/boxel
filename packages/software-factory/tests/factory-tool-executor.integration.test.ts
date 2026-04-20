import { createServer, type IncomingMessage, type Server } from 'node:http';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { ToolExecutor } from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { buildTestClient } from './helpers/test-client';

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
// Integration tests: realm-api tools against a real HTTP server
// ---------------------------------------------------------------------------

module('factory-tool-executor integration > realm-api requests', function () {
  test('realm-read sends correct GET with Authorization and Accept headers', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { data: { id: 'Card/hello', type: 'card' } });
    });

    let realmUrl = `${origin}/user/target/`;
    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: 'Bearer realm-jwt-for-user',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        client,
      });

      let result = await executor.execute('realm-read', {
        'realm-url': realmUrl,
        path: 'Card/hello.gts',
      });

      assert.strictEqual(result.exitCode, 0, 'exitCode is 0');
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
    } finally {
      cleanup();
      await stopServer(server);
    }
  });

  test('realm-write sends correct POST with content and headers', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { ok: true });
    });

    let realmUrl = `${origin}/user/target/`;
    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: 'Bearer realm-jwt-for-user',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        client,
      });

      let result = await executor.execute('realm-write', {
        'realm-url': realmUrl,
        path: 'CardDef/my-card.gts',
        content: 'export class MyCard extends CardDef {}',
      });

      assert.strictEqual(result.exitCode, 0);
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
      assert.strictEqual(
        captured!.body,
        'export class MyCard extends CardDef {}',
      );
    } finally {
      cleanup();
      await stopServer(server);
    }
  });

  test('realm-delete sends correct DELETE with Authorization header', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(204, null);
    });

    let realmUrl = `${origin}/user/target/`;
    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: 'Bearer realm-jwt-for-user',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        client,
      });

      let result = await executor.execute('realm-delete', {
        'realm-url': realmUrl,
        path: 'Card/old-card.json',
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'DELETE');
      assert.strictEqual(captured!.url, '/user/target/Card/old-card.json');
      assert.strictEqual(
        captured!.headers.authorization,
        'Bearer realm-jwt-for-user',
      );
    } finally {
      cleanup();
      await stopServer(server);
    }
  });

  test('realm-search sends correct QUERY to _search with JSON body', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { data: [] });
    });

    let realmUrl = `${origin}/user/target/`;
    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: 'Bearer realm-jwt-for-user',
      realmServerUrl: `${origin}/`,
      realmServerToken: 'Bearer realm-server-jwt',
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        client,
      });

      let query = JSON.stringify({
        filter: {
          type: { module: 'https://example.test/issue', name: 'Issue' },
        },
      });

      let result = await executor.execute('realm-search', {
        'realm-url': realmUrl,
        query,
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'QUERY');
      assert.strictEqual(captured!.url, '/user/target/_search');
      assert.strictEqual(
        captured!.headers.authorization,
        'Bearer realm-jwt-for-user',
      );
      assert.strictEqual(captured!.headers.accept, SupportedMimeType.CardJson);
      assert.strictEqual(
        captured!.headers['content-type'],
        SupportedMimeType.JSON,
      );
      assert.strictEqual(captured!.body, query);
    } finally {
      cleanup();
      await stopServer(server);
    }
  });
});

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
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        client,
      });

      try {
        await executor.execute('realm-read', {
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
