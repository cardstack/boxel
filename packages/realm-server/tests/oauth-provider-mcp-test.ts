import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomBytes } from 'crypto';
import supertest from 'supertest';
import { JSDOM } from 'jsdom';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  insertUser,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_MCP,
  OAUTH_TEST_SERVER_URL,
  codeForOAuthClient,
  decideOAuthFlow,
  exchangeOAuthCode,
  inProcessProviderTransport,
  interactionUid,
  landOAuthFlow,
  randomMatrixId,
  registerOAuthClient,
  revokeOAuthToken,
  startOAuthProviderServer,
  type OAuthTokenResponse,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { startExampleAIApp } from './support/mock-oauth-client/server.ts';
import type { RunningExampleAIApp } from './support/mock-oauth-client/server.ts';
import { MCP_MAX_BODY_BYTES, MCP_SERVER_NAME } from '../handlers/handle-mcp.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const METADATA = `${OAUTH_TEST_ISSUER}/.well-known/oauth-protected-resource/mcp`;
const BROWSER_ORIGIN = 'https://inspector.example.test';
// What an MCP client sends with each request over Streamable HTTP.
const MCP_ACCEPT = 'application/json, text/event-stream';

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_mcp');
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let dbAdapter: PgAdapter;
  let running: RunningExampleAIApp | undefined;
  let clients: Client[] = [];

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      let built = await start(args);
      return () => closeServer(built);
    },
  });
  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (db, publisher, runner) => {
      dbAdapter = db;
      server = await start({ dbAdapter: db, publisher, runner });
    },
    afterEach: async () => {
      for (let client of clients) {
        await client.close();
      }
      clients = [];
      await running?.close();
      running = undefined;
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  async function secureSession(): Promise<string> {
    let matrixId = randomMatrixId('mcp');
    await insertUser(dbAdapter, matrixId, `cus_${matrixId}`, null);
    return await secureSessionAuth(dbAdapter, matrixId);
  }

  // A whole flow for a new client and user, and its access token for `/mcp`.
  async function accessToken({
    scope = 'boxel:read',
  }: { scope?: string } = {}) {
    let clientId = await registerOAuthClient(server!);
    let code = await codeForOAuthClient(
      server!,
      clientId,
      await secureSession(),
      {
        scope,
      },
    );
    let response = await exchangeOAuthCode(server!, clientId, code);
    if (response.status !== 200) {
      throw new Error(`the code exchange failed: ${response.text}`);
    }
    return {
      clientId,
      token: (response.body as OAuthTokenResponse).access_token,
    };
  }

  // A fetch that sends each request to the test's realm server in process,
  // as the issuer's host, for the MCP SDK's client.
  async function inProcessFetch(
    url: string | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    let { pathname, search } = new URL(url);
    let method = (init.method ?? 'GET').toLowerCase() as
      | 'get'
      | 'post'
      | 'delete';
    let request = supertest(server!)
      [method](`${pathname}${search}`)
      .set('Host', OAUTH_TEST_SERVER_URL.host);
    new Headers(init.headers).forEach((value, name) => {
      request = request.set(name, value);
    });
    let response = init.body
      ? await request.send(String(init.body))
      : await request;
    let headers = new Headers();
    for (let [name, value] of Object.entries(response.headers)) {
      for (let one of [value].flat()) {
        headers.append(name, String(one));
      }
    }
    return new Response(response.text ? response.text : null, {
      status: response.status,
      headers,
    });
  }

  // The MCP SDK's own client, connected to `/mcp` with a token.
  async function mcpClient(token: string): Promise<Client> {
    let client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(OAUTH_TEST_MCP), {
        fetch: inProcessFetch,
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  // A POST to `/mcp` with the headers an MCP client sends.
  function post(
    token: string | undefined,
    body: string,
    { host = OAUTH_TEST_SERVER_URL.host }: { host?: string } = {},
  ) {
    let request = supertest(server!)
      .post('/mcp')
      .set('Host', host)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .set('MCP-Protocol-Version', '2025-06-18');
    if (token) {
      request = request.set('Authorization', `Bearer ${token}`);
    }
    return request.send(body);
  }

  // One JSON-RPC request to `/mcp`, as an MCP client sends it.
  function rpc(
    token: string | undefined,
    method: string,
    params: Record<string, unknown> = {},
    options: { host?: string } = {},
  ) {
    return post(
      token,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      options,
    );
  }

  test('the mock client connects, and lists the tools at /mcp with its token', async function (assert) {
    running = await startExampleAIApp({
      mode: 'loopback',
      issuer: OAUTH_TEST_ISSUER,
      transport: inProcessProviderTransport(() => server!),
    });
    let appPages = supertest.agent(running.server);
    let started = await appPages.get('/connect');
    assert.strictEqual(started.status, 302, 'Connect starts a flow');
    let authorize = new URL(started.headers.location);
    assert.strictEqual(
      authorize.searchParams.get('resource'),
      OAUTH_TEST_MCP,
      'for /mcp',
    );
    let browser = supertest.agent(server!);
    let flow = await browser
      .get(`${authorize.pathname}${authorize.search}`)
      .set('Host', OAUTH_TEST_SERVER_URL.host);
    let uid = interactionUid(flow.headers.location);
    let ticket = await decideOAuthFlow(server!, uid, await secureSession());
    let landed = await landOAuthFlow(browser, uid, ticket);
    let result = await appPages.get(`/callback${landed.search}`);
    assert.strictEqual(
      new JSDOM(result.text).window.document
        .querySelector('[data-test-result]')
        ?.getAttribute('data-test-result'),
      'connected',
      'the app got a token',
    );
    let token = running.app.heldTokensForTests!.accessToken;

    let client = await mcpClient(token);
    assert.strictEqual(
      client.getServerVersion()?.name,
      MCP_SERVER_NAME,
      'initialize answers the server',
    );
    assert.deepEqual(
      client.getServerCapabilities()?.tools,
      {},
      'which offers tools',
    );
    let { tools } = await client.listTools();
    assert.deepEqual(tools, [], 'and lists none');
    assert.deepEqual(await client.ping(), {}, 'ping answers');
  });

  test('a request with no token is answered 401, naming the metadata of /mcp, which describes it', async function (assert) {
    let response = await rpc(undefined, 'tools/list').set(
      'Origin',
      BROWSER_ORIGIN,
    );
    assert.strictEqual(response.status, 401);
    assert.strictEqual(
      response.headers['www-authenticate'],
      `Bearer resource_metadata="${METADATA}", scope="boxel:read boxel:write"`,
    );
    assert.true(
      /\bWWW-Authenticate\b/i.test(
        response.headers['access-control-expose-headers'] ?? '',
      ),
      'a browser client can read the challenge',
    );

    let metadata = await supertest(server!)
      .get(new URL(METADATA).pathname)
      .set('Host', OAUTH_TEST_SERVER_URL.host);
    assert.strictEqual(metadata.status, 200);
    assert.strictEqual(metadata.body.resource, OAUTH_TEST_MCP);
    assert.deepEqual(metadata.body.authorization_servers, [OAUTH_TEST_ISSUER]);
  });

  test('a token with either scope reaches /mcp', async function (assert) {
    for (let scope of ['boxel:read', 'boxel:write']) {
      let { token } = await accessToken({ scope });
      let response = await rpc(token, 'tools/list');
      assert.strictEqual(response.status, 200, scope);
      assert.deepEqual(
        response.body,
        { jsonrpc: '2.0', id: 1, result: { tools: [] } },
        `${scope}: no tools`,
      );
    }
  });

  test('a notification is answered 202 with no body', async function (assert) {
    let { token } = await accessToken();
    let response = await post(
      token,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    assert.strictEqual(response.status, 202);
    assert.strictEqual(response.text, '');
    assert.strictEqual(response.headers['content-type'], undefined);
  });

  test('a body over the limit is answered 413', async function (assert) {
    let { token } = await accessToken();
    let request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { padding: 'a'.repeat(MCP_MAX_BODY_BYTES) },
    });
    let response = await post(token, request);
    assert.strictEqual(response.status, 413);
    assert.strictEqual(response.body.jsonrpc, '2.0');
    assert.strictEqual(response.body.id, null);

    let small = await rpc(token, 'ping');
    assert.strictEqual(small.status, 200, 'a body under it is served');
  });

  test('a body sent with no declared length is answered 413 once it passes the limit', async function (assert) {
    let { token } = await accessToken();
    let { port } = server!.address() as AddressInfo;
    let chunk = 'a'.repeat(4 * 1024);
    let chunks = Math.ceil(MCP_MAX_BODY_BYTES / chunk.length) + 2;
    let response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        let request = http.request({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/mcp',
          headers: {
            Host: OAUTH_TEST_SERVER_URL.host,
            Accept: MCP_ACCEPT,
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': '2025-06-18',
            Authorization: `Bearer ${token}`,
            'Transfer-Encoding': 'chunked',
          },
        });
        let answered = false;
        request.on('response', (res) => {
          answered = true;
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (data: string) => (body += data));
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        });
        // The server may stop reading before the last chunk is written.
        request.on('error', (error) => {
          if (!answered) {
            reject(error);
          }
        });
        request.write(
          '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"padding":"',
        );
        for (let i = 0; i < chunks; i++) {
          request.write(chunk);
        }
        request.end('"}}');
      },
    );
    assert.strictEqual(response.status, 413);
    let body = JSON.parse(response.body);
    assert.strictEqual(body.jsonrpc, '2.0');
    assert.strictEqual(body.id, null);
  });

  test('a call to /mcp logs the token nowhere and sends it nowhere', async function (assert) {
    let { token } = await accessToken();
    let telemetry = await telemetryDuring(async () => {
      let listed = await rpc(token, 'tools/list');
      assert.strictEqual(listed.status, 200);
      let called = await rpc(token, 'tools/call', { name: 'search' });
      assert.strictEqual(called.status, 200);
      assert.strictEqual(called.body.error.code, ErrorCode.InvalidParams);
    });
    assertNoSecrets(assert, telemetry, { 'access token': token });
  });

  test('every tool call is refused, whatever the scope', async function (assert) {
    for (let scope of ['boxel:read', 'boxel:read boxel:write']) {
      let { token } = await accessToken({ scope });
      let client = await mcpClient(token);
      for (let name of ['search', 'read_card', 'write_card']) {
        try {
          await client.callTool({ name, arguments: {} });
          assert.ok(false, `${scope}: ${name} was served`);
        } catch (error) {
          assert.true(error instanceof McpError, `${scope}: ${name}`);
          assert.strictEqual(
            (error as McpError).code,
            ErrorCode.InvalidParams,
            `${scope}: ${name} is an unknown tool`,
          );
        }
      }
    }
  });

  test('a revoked connection is refused on its next call', async function (assert) {
    let { clientId, token } = await accessToken();
    let before = await rpc(token, 'ping');
    assert.strictEqual(before.status, 200, 'the token works');
    assert.deepEqual(before.body.result, {});

    let revoked = await revokeOAuthToken(server!, {
      client_id: clientId,
      token,
    });
    assert.strictEqual(revoked.status, 200, 'the app revokes its token');

    let after = await rpc(token, 'ping');
    assert.strictEqual(after.status, 401);
    assert.strictEqual(
      after.headers['www-authenticate'],
      `Bearer error="invalid_token", resource_metadata="${METADATA}", scope="boxel:read boxel:write"`,
    );
  });

  test('GET and DELETE are answered 405, with or without a token', async function (assert) {
    let { token } = await accessToken();
    for (let method of ['get', 'delete'] as const) {
      for (let withToken of [false, true]) {
        let request = supertest(server!)
          [method]('/mcp')
          .set('Host', OAUTH_TEST_SERVER_URL.host)
          .set('Accept', 'text/event-stream');
        if (withToken) {
          request = request.set('Authorization', `Bearer ${token}`);
        }
        let response = await request;
        let what = `${method.toUpperCase()} ${withToken ? 'with' : 'without'} a token`;
        assert.strictEqual(response.status, 405, what);
        assert.strictEqual(response.headers['allow'], 'POST', what);
      }
    }
  });

  test('a browser client may call /mcp from any origin', async function (assert) {
    let preflight = await supertest(server!)
      .options('/mcp')
      .set('Host', OAUTH_TEST_SERVER_URL.host)
      .set('Origin', BROWSER_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'authorization, content-type, mcp-protocol-version',
      );
    assert.strictEqual(preflight.status, 204);
    assert.ok(preflight.headers['access-control-allow-origin'], 'any origin');
    let allowed = preflight.headers['access-control-allow-headers'] ?? '';
    for (let header of [
      'Authorization',
      'Content-Type',
      'MCP-Protocol-Version',
    ]) {
      assert.true(
        new RegExp(`\\b${header}\\b`, 'i').test(allowed),
        `${header} is allowed`,
      );
    }

    let { token } = await accessToken();
    let response = await rpc(token, 'tools/list').set('Origin', BROWSER_ORIGIN);
    assert.strictEqual(response.status, 200);
    assert.ok(response.headers['access-control-allow-origin']);
  });

  test("answers only on the issuer's host", async function (assert) {
    let response = await rpc(
      undefined,
      'tools/list',
      {},
      {
        host: `site-${randomBytes(4).toString('hex')}.published.example.test`,
      },
    );
    assert.notStrictEqual(response.status, 401, 'no challenge');
    assert.strictEqual(response.headers['www-authenticate'], undefined);
  });
});
