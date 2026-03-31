import { createServer, type IncomingMessage, type Server } from 'node:http';
import { module, test } from 'qunit';

import { SupportedMimeType } from '../src/mime-types';

import { ToolExecutor } from '../scripts/lib/factory-tool-executor';
import { ToolRegistry } from '../scripts/lib/factory-tool-registry';

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

    try {
      let registry = new ToolRegistry();
      let realmUrl = `${origin}/user/target/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-jwt-for-user',
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-read',
        toolArgs: {
          'realm-url': realmUrl,
          path: 'Card/hello.gts',
        },
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
      await stopServer(server);
    }
  });

  test('realm-write sends correct POST with content and headers', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { ok: true });
    });

    try {
      let registry = new ToolRegistry();
      let realmUrl = `${origin}/user/target/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-jwt-for-user',
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-write',
        toolArgs: {
          'realm-url': realmUrl,
          path: 'CardDef/my-card.gts',
          content: 'export class MyCard extends CardDef {}',
        },
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
      await stopServer(server);
    }
  });

  test('realm-delete sends correct DELETE with Authorization header', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(204, null);
    });

    try {
      let registry = new ToolRegistry();
      let realmUrl = `${origin}/user/target/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-jwt-for-user',
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-delete',
        toolArgs: {
          'realm-url': realmUrl,
          path: 'Card/old-card.json',
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'DELETE');
      assert.strictEqual(captured!.url, '/user/target/Card/old-card.json');
      assert.strictEqual(
        captured!.headers.authorization,
        'Bearer realm-jwt-for-user',
      );
    } finally {
      await stopServer(server);
    }
  });

  test('realm-search sends correct QUERY to _search with JSON body', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { data: [] });
    });

    try {
      let registry = new ToolRegistry();
      let realmUrl = `${origin}/user/target/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-jwt-for-user',
      });

      let query = JSON.stringify({
        filter: {
          type: { module: 'https://example.test/ticket', name: 'Ticket' },
        },
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-search',
        toolArgs: {
          'realm-url': realmUrl,
          query,
        },
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
      await stopServer(server);
    }
  });

  test('realm-atomic sends correct POST to _atomic with JSON:API operations', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { ok: true });
    });

    try {
      let registry = new ToolRegistry();
      let realmUrl = `${origin}/user/target/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: realmUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-jwt-for-user',
      });

      let ops = [
        { op: 'add', href: './CardDef/new.gts', data: { type: 'module' } },
        { op: 'remove', href: './Card/old.json' },
      ];

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-atomic',
        toolArgs: {
          'realm-url': realmUrl,
          operations: JSON.stringify(ops),
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'POST');
      assert.strictEqual(captured!.url, '/user/target/_atomic');
      assert.strictEqual(
        captured!.headers['content-type'],
        SupportedMimeType.JSONAPI,
      );
      assert.strictEqual(
        captured!.headers.authorization,
        'Bearer realm-jwt-for-user',
      );

      let body = JSON.parse(captured!.body);
      assert.deepEqual(body['atomic:operations'], ops);
    } finally {
      await stopServer(server);
    }
  });

  test('realm-auth sends correct POST to _realm-auth with Authorization header', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(200, { ok: true });
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-server-jwt-xyz',
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-auth',
        toolArgs: {
          'realm-server-url': `${origin}/user/target/`,
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'POST');
      assert.strictEqual(captured!.url, '/user/target/_realm-auth');
      assert.strictEqual(
        captured!.headers.authorization,
        'Bearer realm-server-jwt-xyz',
      );
    } finally {
      await stopServer(server);
    }
  });

  test('realm-create sends correct JSON:API POST to _create-realm with realm-server JWT', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(201, {
        data: { type: 'realm', id: `${origin}/user/new-realm/` },
      });
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: 'Bearer realm-server-jwt-minted',
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-create',
        toolArgs: {
          'realm-server-url': `${origin}/user/target/`,
          name: 'New Realm',
          endpoint: 'user/new-realm',
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'POST');
      assert.strictEqual(captured!.url, '/user/target/_create-realm');
      assert.strictEqual(
        captured!.headers.authorization,
        'Bearer realm-server-jwt-minted',
      );
      assert.strictEqual(captured!.headers.accept, SupportedMimeType.JSONAPI);
      assert.strictEqual(
        captured!.headers['content-type'],
        SupportedMimeType.JSONAPI,
      );

      let body = JSON.parse(captured!.body);
      assert.strictEqual(body.data.type, 'realm');
      assert.strictEqual(body.data.attributes.name, 'New Realm');
      assert.strictEqual(body.data.attributes.endpoint, 'user/new-realm');
      assert.ok(body.data.attributes.iconURL, 'body includes iconURL');
      assert.ok(
        body.data.attributes.backgroundURL,
        'body includes backgroundURL',
      );
    } finally {
      await stopServer(server);
    }
  });

  test('realm-server-session sends OpenID token and returns JWT from Authorization header', async function (assert) {
    let captured: CapturedRequest | undefined;

    let { server, origin } = await startTestServer((req, respond) => {
      captured = req;
      respond(201, null, {
        Authorization: 'Bearer freshly-minted-jwt',
      });
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        testRealmUrl: `${origin}/user/target-tests/`,
      });

      let result = await executor.execute({
        type: 'invoke_tool',
        tool: 'realm-server-session',
        toolArgs: {
          'realm-server-url': `${origin}/user/target/`,
          'openid-token': 'matrix-openid-access-token',
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(captured!.method, 'POST');
      assert.strictEqual(captured!.url, '/user/target/_server-session');
      assert.strictEqual(
        captured!.headers['content-type'],
        SupportedMimeType.JSON,
      );

      let body = JSON.parse(captured!.body);
      assert.strictEqual(
        body.access_token,
        'matrix-openid-access-token',
        'sends OpenID token in request body',
      );

      assert.deepEqual(
        result.output,
        { token: 'Bearer freshly-minted-jwt' },
        'captures JWT from Authorization response header',
      );
    } finally {
      await stopServer(server);
    }
  });

  test('end-to-end: realm-server-session → realm-create flow', async function (assert) {
    let requests: CapturedRequest[] = [];

    let { server, origin } = await startTestServer((req, respond) => {
      requests.push(req);

      if (req.url?.endsWith('_server-session')) {
        respond(201, null, {
          Authorization: 'Bearer e2e-realm-server-jwt',
        });
      } else if (req.url?.endsWith('_create-realm')) {
        respond(201, {
          data: { type: 'realm', id: `${origin}/user/e2e-scratch/` },
        });
      } else {
        respond(404, { error: 'not found' });
      }
    });

    try {
      let registry = new ToolRegistry();
      let serverUrl = `${origin}/user/target/`;

      // Step 1: Obtain realm-server JWT
      let sessionExecutor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: serverUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
      });

      let sessionResult = await sessionExecutor.execute({
        type: 'invoke_tool',
        tool: 'realm-server-session',
        toolArgs: {
          'realm-server-url': serverUrl,
          'openid-token': 'e2e-openid-token',
        },
      });

      assert.strictEqual(sessionResult.exitCode, 0);
      let jwt = (sessionResult.output as { token: string }).token;
      assert.strictEqual(jwt, 'Bearer e2e-realm-server-jwt');

      // Step 2: Use JWT to create a realm
      let createExecutor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: serverUrl,
        testRealmUrl: `${origin}/user/target-tests/`,
        authorization: jwt,
      });

      let createResult = await createExecutor.execute({
        type: 'invoke_tool',
        tool: 'realm-create',
        toolArgs: {
          'realm-server-url': serverUrl,
          name: 'E2E Scratch',
          endpoint: 'user/e2e-scratch',
        },
      });

      assert.strictEqual(createResult.exitCode, 0);
      assert.strictEqual(requests.length, 2, 'two requests made');

      // Verify the create request used the minted JWT
      let createReq = requests[1];
      assert.strictEqual(createReq.method, 'POST');
      assert.strictEqual(createReq.url, '/user/target/_create-realm');
      assert.strictEqual(
        createReq.headers.authorization,
        'Bearer e2e-realm-server-jwt',
        'create request uses the JWT from session',
      );
    } finally {
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

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        testRealmUrl: `${origin}/user/target-tests/`,
      });

      try {
        await executor.execute({
          type: 'invoke_tool',
          tool: 'shell-exec-arbitrary',
          toolArgs: { command: 'rm -rf /' },
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
      await stopServer(server);
    }
  });

  test('source realm targeting is rejected before any HTTP request', async function (assert) {
    let requestCount = 0;

    let { server, origin } = await startTestServer((_req, respond) => {
      requestCount++;
      respond(200, {});
    });

    try {
      let registry = new ToolRegistry();
      let sourceUrl = `${origin}/user/source/`;
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        testRealmUrl: `${origin}/user/target-tests/`,
        sourceRealmUrl: sourceUrl,
      });

      try {
        await executor.execute({
          type: 'invoke_tool',
          tool: 'search-realm',
          toolArgs: { realm: sourceUrl },
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
      await stopServer(server);
    }
  });

  test('unknown realm targeting is rejected before any HTTP request', async function (assert) {
    let requestCount = 0;

    let { server, origin } = await startTestServer((_req, respond) => {
      requestCount++;
      respond(200, {});
    });

    try {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: '/fake',
        targetRealmUrl: `${origin}/user/target/`,
        testRealmUrl: `${origin}/user/target-tests/`,
      });

      try {
        await executor.execute({
          type: 'invoke_tool',
          tool: 'realm-read',
          toolArgs: {
            'realm-url': 'https://evil.example.test/hacker/realm/',
            path: 'secrets.json',
          },
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
      await stopServer(server);
    }
  });
});
