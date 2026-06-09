import { createServer, type IncomingMessage, type Server } from 'node:http';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { ToolExecutor } from '../src/factory-tool-executor.ts';
import { ToolRegistry } from '../src/factory-tool-registry.ts';
import { buildTestClient } from './helpers/test-client.ts';

// ---------------------------------------------------------------------------
// Test server helpers
// ---------------------------------------------------------------------------
//
// After the CS-10883 retirements the registry only contains
// `realm-create`, and the per-tool request-shape coverage that used to
// live here (realm-read / realm-write / realm-delete / realm-search)
// went away with those tools. `realm-create` does NOT yet have an
// equivalent live HTTP-shape test in the Playwright spec — the
// entrypoint integration test covers it end-to-end via `factory:go`,
// but a focused unit-level "does the executor send the right shape to
// `_create-realm`?" assertion is a follow-up. What stays here are the
// pre-flight safety guards that fire BEFORE any HTTP traffic
// (unregistered tool, source realm, foreign origin) — those don't
// need a live realm and shouldn't drag the harness in.

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
        targetRealm: `${origin}/user/target/`,
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

  test('source realm targeting via realm-server-url is rejected before any HTTP request', async function (assert) {
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
      let sourceUrl = `${origin}/source/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealm: `${origin}/user/target/`,
        sourceRealm: sourceUrl,
        client,
      });

      try {
        await executor.execute('realm-create', {
          'realm-server-url': sourceUrl,
          name: 'My Realm',
          endpoint: 'my-realm',
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

  test('realm-server-url with foreign origin is rejected before any HTTP request', async function (assert) {
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
        targetRealm: `${origin}/user/target/`,
        client,
      });

      try {
        await executor.execute('realm-create', {
          'realm-server-url': 'https://evil.example.test/',
          name: 'My Realm',
          endpoint: 'my-realm',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(
          (err as Error).message.includes('not in the allowed origins'),
          'throws for foreign realm-server-url origin',
        );
      }

      assert.strictEqual(requestCount, 0, 'server received zero requests');
    } finally {
      cleanup();
      await stopServer(server);
    }
  });
});
