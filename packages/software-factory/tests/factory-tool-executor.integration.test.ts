import { createServer, type IncomingMessage, type Server } from 'node:http';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { ToolExecutor } from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { buildTestClient } from './helpers/test-client';

// ---------------------------------------------------------------------------
// Test server helpers
// ---------------------------------------------------------------------------
//
// After the CS-10883 retirements the registry only contains
// `realm-create`, so the executor's request-shape coverage moved into
// the `factory-tool-executor.spec.ts` Playwright suite (which exercises
// realm-create against a real harness server). What stays here are the
// pure unit-level checks: argument-validation rejection and the safety
// guards that fire BEFORE any HTTP traffic — those don't need a live
// realm and shouldn't drag the harness in.

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
        targetRealmUrl: `${origin}/user/target/`,
        sourceRealmUrl: sourceUrl,
        client,
      });

      try {
        await executor.execute('realm-create', {
          'realm-server-url': sourceUrl,
          name: 'My Realm',
          endpoint: 'user/my-realm',
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
        targetRealmUrl: `${origin}/user/target/`,
        client,
      });

      try {
        await executor.execute('realm-create', {
          'realm-server-url': 'https://evil.example.test/',
          name: 'My Realm',
          endpoint: 'user/my-realm',
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
