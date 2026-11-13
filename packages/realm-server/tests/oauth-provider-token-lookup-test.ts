import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import { revokeUserSessions } from '@cardstack/runtime-common/db-queries/user-queries';
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
  exchangeOAuthCode,
  randomMatrixId,
  registerOAuthClient,
  startOAuthProviderServer,
  type OAuthTestUser,
  type OAuthTokenResponse,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import {
  endGrant,
  revokeUserOAuthGrants,
} from '../lib/oauth-provider/grants.ts';
import { resolveOAuthAccessToken } from '../lib/oauth-provider/lookup.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import type { OAuthResourceDefinition } from '../lib/oauth-provider/registry.ts';
import { admitsRoute } from '../lib/oauth-provider/resource.ts';
import type { RealmHttpServer as Server } from '../server.ts';

// Two test resources, each with a route its read scope admits and one its
// write scope admits, which the realm server serves behind its controller.
function testResource(path: string): OAuthResourceDefinition {
  return {
    path,
    name: `Test resource ${path}`,
    description: 'A test resource.',
    coverage: 'Test only.',
    scopes: [
      {
        name: 'boxel:read',
        description: 'Read.',
        label: 'Read',
        caution: false,
        routes: [{ on: 'server', method: 'GET', path: `${path}/read` }],
      },
      {
        name: 'boxel:write',
        description: 'Write.',
        label: 'Change',
        caution: true,
        routes: [{ on: 'server', method: 'POST', path: `${path}/write` }],
      },
    ],
    clients: 'open',
  };
}

const TEST_RESOURCES = [testResource('/test-a'), testResource('/test-b')];
const RESOURCE_A = `${OAUTH_TEST_ISSUER}/test-a`;
const RESOURCE_B = `${OAUTH_TEST_ISSUER}/test-b`;
const METADATA_A = `${OAUTH_TEST_ISSUER}/.well-known/oauth-protected-resource/test-a`;

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_token_lookup', {
    testResources: TEST_RESOURCES,
  });
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let dbAdapter: PgAdapter;

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
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  async function user(): Promise<OAuthTestUser> {
    let matrixId = randomMatrixId('lookup');
    let { id } = await insertUser(dbAdapter, matrixId, `cus_${matrixId}`, null);
    return {
      matrixId,
      id,
      session: await secureSessionAuth(dbAdapter, matrixId),
    };
  }

  // A whole flow for a new client and user, and the access token for one
  // of the resources it named.
  async function accessToken({
    scope = 'boxel:read',
    resources = [RESOURCE_A],
    resource,
  }: { scope?: string; resources?: string[]; resource?: string } = {}) {
    let clientId = await registerOAuthClient(server!);
    let who = await user();
    let code = await codeForOAuthClient(server!, clientId, who.session, {
      scope,
      resources,
    });
    let response = await exchangeOAuthCode(server!, clientId, code, {
      ...(resource ? { resource } : {}),
    });
    if (response.status !== 200) {
      throw new Error(`the code exchange failed: ${response.text}`);
    }
    let tokens = response.body as OAuthTokenResponse;
    let [{ grant_id: grantId }] = (await dbAdapter.execute(
      `SELECT grant_id FROM oauth_provider_tokens
        WHERE id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(tokens.access_token)] },
    )) as { grant_id: string }[];
    return { clientId, user: who, token: tokens.access_token, grantId };
  }

  function call(
    path: string,
    token?: string,
    { method = 'get' }: { method?: 'get' | 'post' } = {},
  ) {
    let request = supertest(server!)
      [method](path)
      .set('Host', OAUTH_TEST_SERVER_URL.host);
    return token ? request.set('Authorization', `Bearer ${token}`) : request;
  }

  async function grant(grantId: string) {
    let [row] = (await dbAdapter.execute(
      `SELECT ended_reason, last_used_at FROM oauth_provider_grants
        WHERE id = $1`,
      { bind: [grantId] },
    )) as { ended_reason: string | null; last_used_at: string | null }[];
    return row;
  }

  module('the lookup', function () {
    test('answers the verified caller for a valid token', async function (assert) {
      let { token, clientId, user: who, grantId } = await accessToken();
      let result = await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      let answered = result.ok
        ? {
            ...result.caller,
            grantCreatedAt: typeof result.caller.grantCreatedAt,
          }
        : result;
      assert.deepEqual(
        answered,
        {
          user: who.matrixId,
          userId: who.id,
          grantId,
          clientId,
          scopes: ['boxel:read'],
          grantCreatedAt: 'number',
        },
        'exactly the user, grant, client, scopes and grant creation time',
      );
    });

    test('refuses an unknown token', async function (assert) {
      let result = await resolveOAuthAccessToken(
        dbAdapter,
        'not-a-token',
        RESOURCE_A,
      );
      assert.deepEqual(result, { ok: false, reason: 'unknown' });
    });

    test('refuses an expired token', async function (assert) {
      let { token } = await accessToken();
      await dbAdapter.execute(
        `UPDATE oauth_provider_tokens
            SET expires_at = now() - interval '1 second'
          WHERE id_hash = decode($1, 'hex')`,
        { bind: [sha256Hex(token)] },
      );
      let result = await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      assert.deepEqual(result, { ok: false, reason: 'expired' });
    });

    test('refuses a token at a resource it was not issued for, even one its grant also holds', async function (assert) {
      let { token } = await accessToken({
        resources: [RESOURCE_A, RESOURCE_B],
        resource: RESOURCE_A,
      });
      assert.true(
        (await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A)).ok,
        'accepted where it was issued',
      );
      assert.deepEqual(
        await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_B),
        { ok: false, reason: 'wrong-resource' },
      );
      assert.deepEqual(
        await resolveOAuthAccessToken(dbAdapter, token, OAUTH_TEST_MCP),
        { ok: false, reason: 'wrong-resource' },
      );
    });

    test('refuses a token whose grant has expired', async function (assert) {
      let { token, grantId } = await accessToken();
      await dbAdapter.execute(
        `UPDATE oauth_provider_grants
            SET expires_at = now() - interval '1 second'
          WHERE id = $1`,
        { bind: [grantId] },
      );
      let result = await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      assert.deepEqual(result, { ok: false, reason: 'revoked' });
    });

    test('refuses a token whose grant was created before the user’s grants were revoked, and ends the grant', async function (assert) {
      let { token, grantId } = await accessToken();
      // The cutoff alone, without ending the grant the way a revocation
      // does, as for a grant created at the moment of a revocation.
      await dbAdapter.execute(
        `UPDATE users SET oauth_grants_revoked_at = g.created_at
           FROM oauth_provider_grants AS g
          WHERE g.id = $1 AND users.id = g.user_id`,
        { bind: [grantId] },
      );
      let result = await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      assert.deepEqual(result, { ok: false, reason: 'revoked' });
      assert.strictEqual(
        (await grant(grantId)).ended_reason,
        'sessions-revoked',
        'the grant is ended',
      );
    });

    test('writes "last used" at most once every 5 minutes', async function (assert) {
      let { token, grantId } = await accessToken();
      assert.strictEqual((await grant(grantId)).last_used_at, null);
      await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      let first = (await grant(grantId)).last_used_at;
      assert.ok(first, 'written on first use');
      await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      assert.deepEqual(
        (await grant(grantId)).last_used_at,
        first,
        'not written again within 5 minutes',
      );
      await dbAdapter.execute(
        `UPDATE oauth_provider_grants
            SET last_used_at = now() - interval '5 minutes 1 second'
          WHERE id = $1`,
        { bind: [grantId] },
      );
      let backdated = (await grant(grantId)).last_used_at;
      await resolveOAuthAccessToken(dbAdapter, token, RESOURCE_A);
      let third = (await grant(grantId)).last_used_at;
      assert.true(
        new Date(third!).getTime() > new Date(backdated!).getTime(),
        'written again once 5 minutes have passed',
      );
    });
  });

  module('a resource’s answers', function () {
    test('a request with no token is answered 401, naming the resource’s metadata and scopes', async function (assert) {
      let response = await call('/test-a/read');
      assert.strictEqual(response.status, 401);
      assert.strictEqual(
        response.headers['www-authenticate'],
        `Bearer resource_metadata="${METADATA_A}", scope="boxel:read boxel:write"`,
      );
    });

    test('a valid token reaches the route as its verified caller, never with secureSession', async function (assert) {
      let { token, user: who } = await accessToken();
      let response = await call('/test-a/read', token);
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(response.body.caller.user, who.matrixId);
      assert.deepEqual(response.body.caller.scopes, ['boxel:read']);
      assert.false('secureSession' in response.body.caller);
    });

    test('a refused token is answered 401 invalid_token, whatever the reason', async function (assert) {
      let { token } = await accessToken({
        resources: [RESOURCE_A, RESOURCE_B],
        resource: RESOURCE_A,
      });
      for (let [path, presented] of [
        ['/test-a/read', 'not-a-token'],
        ['/test-b/read', token],
      ]) {
        let response = await call(path, presented);
        assert.strictEqual(response.status, 401, path);
        assert.true(
          String(response.headers['www-authenticate']).startsWith(
            'Bearer error="invalid_token", resource_metadata=',
          ),
          `${path}: ${response.headers['www-authenticate']}`,
        );
        assert.deepEqual(
          response.body,
          { error: 'invalid_token' },
          'the reason is not in the response',
        );
      }
    });

    test('a read-only token on a route that needs boxel:write is answered 403 insufficient_scope, never 401', async function (assert) {
      let { token } = await accessToken();
      let response = await call('/test-a/write', token, { method: 'post' });
      assert.strictEqual(response.status, 403);
      assert.strictEqual(
        response.headers['www-authenticate'],
        `Bearer error="insufficient_scope", resource_metadata="${METADATA_A}", scope="boxel:write"`,
      );
    });

    test('a token in the query string is answered 400 and never looked up', async function (assert) {
      let { token, grantId } = await accessToken();
      let telemetry = await telemetryDuring(async () => {
        let alone = await supertest(server!)
          .get(`/test-a/read?access_token=${token}`)
          .set('Host', OAUTH_TEST_SERVER_URL.host);
        assert.strictEqual(alone.status, 400);
        assert.strictEqual(alone.body.error, 'invalid_request');
        let beside = await call(`/test-a/read?access_token=${token}`, token);
        assert.strictEqual(beside.status, 400, 'even beside one in the header');
      });
      assert.strictEqual(
        (await grant(grantId)).last_used_at,
        null,
        'no lookup accepted it',
      );
      assert.false(
        /token (accepted|refused: (unknown|expired|revoked|wrong-resource))/.test(
          telemetry.logs,
        ),
        'no lookup ran',
      );
      assertNoSecrets(assert, telemetry, { 'access token': token });
    });

    test('a token in a form-encoded body is answered 400 and never looked up', async function (assert) {
      let { token, grantId } = await accessToken({ scope: 'boxel:write' });
      let response = await supertest(server!)
        .post('/test-a/write')
        .set('Host', OAUTH_TEST_SERVER_URL.host)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(new URLSearchParams({ access_token: token }).toString());
      assert.strictEqual(response.status, 400);
      assert.strictEqual((await grant(grantId)).last_used_at, null);
    });

    test('disconnecting a grant applies on the next request', async function (assert) {
      let { token, grantId } = await accessToken();
      assert.strictEqual((await call('/test-a/read', token)).status, 200);
      await endGrant(dbAdapter, grantId, 'user');
      assert.strictEqual((await call('/test-a/read', token)).status, 401);
    });

    test('revoking the user’s grants applies on the next request, and revoking only their sessions doesn’t', async function (assert) {
      let { token, user: who } = await accessToken();
      // The later revocation after a password change moves only the
      // sessions' cutoff, which never ends an OAuth grant.
      await revokeUserSessions(dbAdapter, who.matrixId);
      assert.strictEqual(
        (await call('/test-a/read', token)).status,
        200,
        'a session revocation alone leaves the token working',
      );
      await revokeUserOAuthGrants(dbAdapter, who.matrixId);
      assert.strictEqual((await call('/test-a/read', token)).status, 401);
    });
  });

  module('protected-resource metadata', function () {
    test('each resource serves its metadata, naming the issuer and its scopes', async function (assert) {
      let response = await supertest(server!)
        .get('/.well-known/oauth-protected-resource/test-a')
        .set('Host', OAUTH_TEST_SERVER_URL.host);
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body, {
        resource: RESOURCE_A,
        resource_name: 'Test resource /test-a',
        authorization_servers: [OAUTH_TEST_ISSUER],
        scopes_supported: ['boxel:read', 'boxel:write'],
        bearer_methods_supported: ['header'],
      });
      let mcp = await supertest(server!)
        .get('/.well-known/oauth-protected-resource/mcp')
        .set('Host', OAUTH_TEST_SERVER_URL.host);
      assert.strictEqual(mcp.body.resource, OAUTH_TEST_MCP);
      assert.deepEqual(mcp.body.scopes_supported, [
        'boxel:read',
        'boxel:write',
      ]);
    });

    test('is served only on the issuer’s host', async function (assert) {
      let response = await supertest(server!)
        .get('/.well-known/oauth-protected-resource/test-a')
        .set('Host', 'published.example.test');
      assert.notStrictEqual(response.body?.resource, RESOURCE_A);
    });
  });

  module('the route check', function () {
    test('admits a route only through a scope that maps it', function (assert) {
      let [{ scopes }] = TEST_RESOURCES;
      let route = { method: 'GET', path: '/test-a/read' };
      assert.deepEqual(admitsRoute(scopes, { scopes: ['boxel:read'] }, route), {
        admitted: true,
      });
      assert.deepEqual(
        admitsRoute(
          scopes,
          { scopes: ['boxel:read'] },
          {
            method: 'HEAD',
            path: '/test-a/read',
          },
        ),
        { admitted: true },
        'HEAD reaches the GET route',
      );
      assert.deepEqual(
        admitsRoute(
          scopes,
          { scopes: ['boxel:read'] },
          {
            method: 'POST',
            path: '/test-a/write',
          },
        ),
        { admitted: false, scopes: ['boxel:write'] },
      );
      assert.deepEqual(
        admitsRoute(
          scopes,
          { scopes: ['boxel:read', 'boxel:write'] },
          {
            method: 'GET',
            path: '/test-a/unmapped',
          },
        ),
        { admitted: false, scopes: [] },
        'a route no scope maps is refused',
      );
    });
  });
});
