import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { randomBytes } from 'node:crypto';
import fsExtra from 'fs-extra';
import { dirSync } from 'tmp';

const { copySync, ensureDirSync } = fsExtra;
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  SupportedMimeType,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
} from '@cardstack/runtime-common';
import { revokeUserSessions } from '@cardstack/runtime-common/db-queries/user-queries';
import {
  closeServer,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_MCP,
  OAUTH_TEST_SERVER_URL,
  ROOMY_LIMIT,
  ROOMY_TOKEN_LIMIT,
} from './helpers/oauth-provider-flow.ts';
import {
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
} from './helpers/oauth-provider.ts';
import {
  endGrant,
  revokeUserOAuthGrants,
} from '../lib/oauth-provider/grants.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import {
  boxelApiResource,
  buildRegistry,
} from '../lib/oauth-provider/registry.ts';
import type { RealmHttpServer as Server } from '../server.ts';

// The Boxel API (ADR 021): the realm and realm-server routes Boxel's own apps
// call with an OAuth access token. Its tokens are minted here straight into
// the provider's tables, since only a pre-registered client may get one and
// the flow for one is tested with the provider.

const BOXEL_API = OAUTH_TEST_ISSUER;
const REALM_URL = OAUTH_TEST_SERVER_URL.href;
const OWNER = '@oauth-owner:localhost';
const READER = '@oauth-reader:localhost';
const STRANGER = '@oauth-stranger:localhost';

interface Started {
  server: Server;
  realm: Realm;
  app: { middleware: unknown[] };
}

async function start({
  dbAdapter,
  publisher,
  runner,
}: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Started> {
  let realmsRootPath = join(dirSync().name, 'realm_server_oauth_boxel_api');
  let testRealmDir = join(realmsRootPath, 'root');
  ensureDirSync(testRealmDir);
  copySync(fixtureDir('simple'), testRealmDir);
  let { testRealmHttpServer, testRealm, testRealmServer } =
    await runTestRealmServer({
      virtualNetwork: createVirtualNetwork(),
      testRealmDir,
      realmsRootPath,
      realmURL: OAUTH_TEST_SERVER_URL,
      permissions: {
        [OWNER]: ['read', 'write', 'realm-owner'],
        [READER]: ['read'],
      },
      dbAdapter,
      publisher,
      runner,
      matrixURL,
      secureOriginURL: testOAuthSecureOriginURL,
      clientAddress: { trustedProxyHops: 0, infraAddresses: [] },
      oauthProvider: testOAuthProviderConfig(),
      oauthNewClientLimit: ROOMY_LIMIT,
      oauthAuthorizationLimit: ROOMY_LIMIT,
      oauthTokenLimit: ROOMY_TOKEN_LIMIT,
    });
  return {
    server: testRealmHttpServer,
    realm: testRealm,
    app: testRealmServer.app,
  };
}

function succeeded(response: { status: number }): boolean {
  return response.status >= 200 && response.status < 300;
}

function refusedAsClientError(response: { status: number }): boolean {
  return response.status >= 400 && response.status < 500;
}

module(basename(import.meta.filename), function (hooks) {
  let started: Started | undefined;
  let dbAdapter: PgAdapter;
  let userIds: Record<string, string>;

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      let built = await start(args);
      return () => closeServer(built.server);
    },
  });
  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (db, publisher, runner) => {
      dbAdapter = db;
      started = await start({ dbAdapter: db, publisher, runner });
      userIds = {};
      // The realm server may hold an account already, or be writing one, for
      // a user its realm's permissions name.
      for (let user of [OWNER, READER, STRANGER]) {
        let [{ id }] = (await dbAdapter.execute(
          `INSERT INTO users (matrix_user_id) VALUES ($1)
             ON CONFLICT (matrix_user_id)
             DO UPDATE SET matrix_user_id = EXCLUDED.matrix_user_id
             RETURNING id`,
          { bind: [user] },
        )) as { id: string }[];
        userIds[user] = id;
      }
    },
    afterEach: async () => {
      if (started) {
        await closeServer(started.server);
        started = undefined;
      }
    },
  });

  // An access token as the provider stores one: its hash, bound to one
  // resource, on a grant of its own.
  async function oauthToken(
    user: string,
    {
      scope = 'boxel:read boxel:write',
      resource = BOXEL_API,
    }: { scope?: string; resource?: string } = {},
  ): Promise<{ token: string; grantId: string }> {
    let grantId = randomBytes(16).toString('base64url');
    let token = randomBytes(32).toString('base64url');
    await dbAdapter.execute(
      `INSERT INTO oauth_provider_grants
         (id, user_id, client_id, resources, renewing, expires_at)
         VALUES ($1, $2::uuid, 'boxel-cli', $3::jsonb, false,
                 now() + interval '1 hour')`,
      {
        bind: [
          grantId,
          userIds[user],
          JSON.stringify({ [resource]: scope.split(' ') }),
        ],
      },
    );
    await dbAdapter.execute(
      `INSERT INTO oauth_provider_tokens
         (id_hash, kind, grant_id, resource, scope, payload, expires_at)
         VALUES (decode($1, 'hex'), 'AccessToken', $2, $3, $4, '{}'::jsonb,
                 now() + interval '10 minutes')`,
      { bind: [sha256Hex(token), grantId, resource, scope] },
    );
    return { token, grantId };
  }

  // A realm at the test URL is matched by the request's `Host`.
  function request() {
    let agent = supertest(started!.server);
    let withHost =
      (method: 'get' | 'post' | 'patch' | 'delete' | 'put') => (path: string) =>
        agent[method](path).set('Host', OAUTH_TEST_SERVER_URL.host);
    return {
      get: withHost('get'),
      post: withHost('post'),
      patch: withHost('patch'),
      delete: withHost('delete'),
      put: withHost('put'),
    };
  }

  // Reads and writes go through card source: a card at the test realm's URL
  // can't be indexed, since the stack's renderer can't reach port 0.
  function readCard(token: string) {
    return request()
      .get('/person-1.json')
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', `Bearer ${token}`);
  }

  function federatedInfo(token: string) {
    return request()
      .post('/_federated-info')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', `Bearer ${token}`)
      .send({ realms: [REALM_URL] });
  }

  function archivedRealms(token: string) {
    return request()
      .get('/_archived-realms')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Authorization', `Bearer ${token}`);
  }

  function patchCard(token: string) {
    return writeSource(token, '/notes.md', '# Changed');
  }

  function writeSource(token: string, path: string, content: string) {
    return request()
      .post(path)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Content-Type', SupportedMimeType.CardSource)
      .set('Authorization', `Bearer ${token}`)
      .send(content);
  }

  function assertInvalidToken(
    assert: Assert,
    response: supertest.Response,
    label: string,
  ) {
    assert.strictEqual(response.status, 401, `${label}: ${response.text}`);
    assert.true(
      /error="invalid_token"/.test(response.headers['www-authenticate'] ?? ''),
      `${label}: the challenge says invalid_token`,
    );
  }

  module('a Boxel API token', function () {
    test('reads a realm as its user, with that user’s permissions', async function (assert) {
      let { token } = await oauthToken(READER, { scope: 'boxel:read' });
      let response = await readCard(token);
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(
        JSON.parse(response.text).data.attributes.firstName,
        'Mango',
      );

      let stranger = await oauthToken(STRANGER, { scope: 'boxel:read' });
      let refused = await readCard(stranger.token);
      assert.strictEqual(
        refused.status,
        403,
        'a user who may not read the realm is refused as that user',
      );
    });

    test('passes the realm server’s session check as its user', async function (assert) {
      let { token } = await oauthToken(OWNER, { scope: 'boxel:read' });
      let response = await archivedRealms(token);
      assert.strictEqual(response.status, 200, response.text);
    });

    test('passes the federated endpoints’ check as its user', async function (assert) {
      let { token } = await oauthToken(READER, { scope: 'boxel:read' });
      let response = await federatedInfo(token);
      assert.strictEqual(response.status, 200, response.text);

      let stranger = await oauthToken(STRANGER, { scope: 'boxel:read' });
      let refused = await federatedInfo(stranger.token);
      assert.strictEqual(refused.status, 403, refused.text);
    });

    test('writes to a realm with boxel:write, as a user who may write', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let response = await patchCard(token);
      assert.true(succeeded(response), `${response.status} ${response.text}`);
      let written = await request()
        .get('/notes.md')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(written.text, '# Changed');
    });

    test('never writes more than its user may', async function (assert) {
      let { token } = await oauthToken(READER);
      let response = await patchCard(token);
      assert.strictEqual(response.status, 403, response.text);
      assert.false(
        /insufficient_scope/.test(response.headers['www-authenticate'] ?? ''),
        'refused for the user’s permissions, not the token’s scopes',
      );
    });
  });

  module('a boxel:read token', function () {
    test('can’t write to a realm', async function (assert) {
      let { token } = await oauthToken(OWNER, { scope: 'boxel:read' });
      let response = await patchCard(token);
      assert.strictEqual(response.status, 403, response.text);
      assert.true(
        /error="insufficient_scope"/.test(
          response.headers['www-authenticate'] ?? '',
        ),
        response.headers['www-authenticate'],
      );
      assert.true(
        /scope="boxel:write"/.test(response.headers['www-authenticate'] ?? ''),
        'the challenge names the scope that would admit it',
      );
      let unwritten = await request()
        .get('/notes.md')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(unwritten.status, 404, 'nothing was written');
    });

    test('can’t reach a realm-server write', async function (assert) {
      let { token } = await oauthToken(OWNER, { scope: 'boxel:read' });
      let response = await request()
        .post('/_create-realm')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      assert.strictEqual(response.status, 403, response.text);
      assert.strictEqual(response.body.error, 'insufficient_scope');
    });
  });

  module('what a Boxel API token never reaches', function () {
    test('realm-server routes for keys, secure sessions, token minting and more refuse it as an unknown token', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let routes: ['get' | 'post' | 'delete' | 'put', string][] = [
        // Key management, reads included.
        ['get', '/_user-keys'],
        ['post', '/_user-keys'],
        ['get', '/_user-keys/a-key'],
        ['post', '/_key-write-tickets'],
        ['get', '/_key-shares'],
        ['get', '/_key-shares/a-share/usage'],
        ['post', '/_key-bindings/batch'],
        ['delete', '/_user-key-grants/a-grant'],
        ['post', '/_key-policy-notices/read'],
        // Secure sessions and the secure window.
        ['post', '/_secure-session/login-token'],
        ['post', '/_secure-session/renewal'],
        ['delete', '/_secure-sessions'],
        ['post', '/_secure-window/context'],
        ['get', '/_secure-window/realms'],
        // Minting a token.
        ['post', '/_realm-auth'],
        // Connecting other services.
        ['get', '/_oauth/clients'],
        ['post', '/_oauth/connections'],
        // Routes no scope maps.
        ['get', '/_user'],
        ['post', '/_stripe-session'],
        ['post', '/_prerender-card'],
        ['post', '/_incoming-webhooks'],
        ['get', '/_public-realms'],
        ['post', '/_request-forward'],
      ];
      for (let [method, path] of routes) {
        let response = await request()
          [method](path)
          .set('Accept', 'application/json')
          .set('Authorization', `Bearer ${token}`);
        assertInvalidToken(assert, response, `${method.toUpperCase()} ${path}`);
      }
    });

    test('routes that check a token their own way refuse it', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let routes: ['get' | 'post', string][] = [
        ['post', '/_server-session'],
        ['post', '/_delegate-session'],
        ['post', '/_diagnostic-render-token'],
        ['get', '/_data-keys'],
        ['get', '/_system-keys'],
        ['get', '/_platform-oauth-clients/a-client'],
        ['get', `/_download-realm?realm=${encodeURIComponent(REALM_URL)}`],
        ['get', '/_oauth-provider/connections'],
      ];
      for (let [method, path] of routes) {
        let response = await request()
          [method](path)
          .set('Accept', 'application/json')
          .set('Authorization', `Bearer ${token}`);
        assert.true(
          refusedAsClientError(response),
          `${method.toUpperCase()} ${path} is refused: ${response.status}`,
        );
      }
    });

    test('a realm’s session, permissions and signed capture URLs refuse it as an unknown token', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let session = await request()
        .post('/_session')
        .set('Accept', SupportedMimeType.Session)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      assertInvalidToken(assert, session, '_session');
      let permissions = await request()
        .get('/_permissions')
        .set('Accept', SupportedMimeType.Permissions)
        .set('Authorization', `Bearer ${token}`);
      assertInvalidToken(assert, permissions, 'GET _permissions');
      let changePermissions = await request()
        .patch('/_permissions')
        .set('Accept', SupportedMimeType.Permissions)
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { id: REALM_URL, type: 'permissions', attributes: {} } });
      assertInvalidToken(assert, changePermissions, 'PATCH _permissions');
      let signed = await request()
        .post('/_sign-capture-urls')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${token}`)
        .send({ urls: [] });
      assertInvalidToken(assert, signed, '_sign-capture-urls');
    });

    test('a write that would change what the realm’s policy admits is refused, and other realm.json edits are not', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let current = { name: 'Test Workspace' };
      let created = await writeSource(
        token,
        '/realm.json',
        JSON.stringify(current),
      );
      assert.true(
        succeeded(created),
        `a realm.json with no policy or config is written: ${created.status} ${created.text}`,
      );
      let renamed = await writeSource(
        token,
        '/realm.json',
        JSON.stringify({ ...current, name: 'Renamed' }),
      );
      assert.true(
        succeeded(renamed),
        `a name change is accepted: ${renamed.status} ${renamed.text}`,
      );
      let policy = await writeSource(
        token,
        '/realm.json',
        JSON.stringify({ ...current, policy: { card: './policy' } }),
      );
      assert.strictEqual(policy.status, 403, `policy: ${policy.text}`);
      let config = await writeSource(
        token,
        '/realm.json',
        JSON.stringify({ ...current, config: { anything: true } }),
      );
      assert.strictEqual(config.status, 403, `config: ${config.text}`);
      let removal = await request()
        .delete('/realm.json')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(removal.status, 403, `removal: ${removal.text}`);
    });
  });

  module('how a Boxel API token is checked', function () {
    test('a token in the query string is refused without a lookup', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let realm = await request()
        .get(`/person-1?access_token=${token}`)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(realm.status, 400, realm.text);
      let server = await request()
        .get(`/_archived-realms?access_token=${token}`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(server.status, 400, server.text);
    });

    test('an /mcp token is refused on every realm and realm-server route', async function (assert) {
      let { token } = await oauthToken(OWNER, { resource: OAUTH_TEST_MCP });
      assertInvalidToken(assert, await readCard(token), 'realm');
      assertInvalidToken(assert, await archivedRealms(token), 'realm server');
      assertInvalidToken(assert, await federatedInfo(token), 'federated');
    });

    test('a token that isn’t one is refused as an unknown token', async function (assert) {
      assertInvalidToken(assert, await readCard('not-a-token'), 'realm');
      assertInvalidToken(
        assert,
        await archivedRealms('not-a-token'),
        'realm server',
      );
    });

    test('disconnecting the app applies on its next request', async function (assert) {
      let { token, grantId } = await oauthToken(OWNER);
      assert.strictEqual((await readCard(token)).status, 200);
      await endGrant(dbAdapter, grantId, 'user');
      assertInvalidToken(assert, await readCard(token), 'realm');
      assertInvalidToken(assert, await archivedRealms(token), 'realm server');
    });

    test('revoking the user’s sessions alone leaves it, and revoking their grants ends it', async function (assert) {
      let { token } = await oauthToken(OWNER);
      // The later revocation after a password change moves only the session
      // cutoff, which never ends an OAuth grant (ADR 021 §1.9).
      await revokeUserSessions(dbAdapter, OWNER);
      assert.strictEqual((await readCard(token)).status, 200);
      assert.strictEqual((await archivedRealms(token)).status, 200);
      await revokeUserOAuthGrants(dbAdapter, OWNER);
      assertInvalidToken(assert, await readCard(token), 'realm');
    });
  });

  module('the Boxel API’s route map', function () {
    test('names only routes the routers register, and none it must never map', async function (assert) {
      let resource = boxelApiResource(
        buildRegistry(OAUTH_TEST_ISSUER),
        OAUTH_TEST_ISSUER,
      );
      let serverRoutes = new Set<string>();
      for (let middleware of started!.app.middleware) {
        let router = (middleware as { router?: { stack: unknown[] } }).router;
        for (let layer of (router?.stack ?? []) as {
          path: string;
          methods: string[];
        }[]) {
          for (let method of layer.methods) {
            serverRoutes.add(`${method} ${layer.path}`);
          }
        }
      }
      let realmRoutes = new Set(
        started!.realm
          .routeDescriptions()
          .map(({ method, mimeType, path }) => `${method} ${mimeType} ${path}`),
      );
      let forbidden = [
        /^\/_session$/,
        /^\/_permissions$/,
        /^\/_sign-capture-urls$/,
        /^\/_server-session$/,
        /^\/_realm-auth$/,
        /^\/_delegate-session$/,
        /^\/_diagnostic-render-token$/,
        /^\/_(user-keys|key-|user-key-grants|system-keys|data-keys|platform-)/,
        /^\/_secure-/,
        /^\/_oauth(\/|-provider|$)/,
        /^\/mcp$/,
      ];
      for (let scope of resource.scopes) {
        for (let route of scope.routes) {
          let named =
            route.on === 'server'
              ? `${route.method} ${route.path}`
              : `${route.method} ${route.mimeType} ${route.path}`;
          assert.true(
            route.on === 'server'
              ? serverRoutes.has(named)
              : realmRoutes.has(named),
            `${scope.name}: ${route.on} route ${named} is registered`,
          );
          assert.false(
            forbidden.some((pattern) => pattern.test(route.path)),
            `${scope.name}: ${named} is not one a scope may map`,
          );
        }
      }
    });
  });
});
