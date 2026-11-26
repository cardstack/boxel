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
  ensureMatrixAdminUser,
  fixtureDir,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
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
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import {
  endGrant,
  revokeUserOAuthGrants,
} from '../lib/oauth-provider/grants.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import {
  boxelApiResource,
  buildRegistry,
} from '../lib/oauth-provider/registry.ts';
import {
  registerListUser,
  setWorkspaceListOf,
} from './helpers/workspace-list.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import jwt from 'jsonwebtoken';
import {
  oauthTabTokenSecret,
  type OAuthTabPurpose,
} from '@cardstack/runtime-common/oauth-tab-token';
import { buildCreateOAuthTabAuth } from '../lib/oauth-tab-token.ts';

// The Boxel API (ADR 021): the realm and realm-server routes Boxel's own apps
// call with an OAuth access token. Its tokens are minted here straight into
// the provider's tables, since only a pre-registered client may get one and
// the flow for one is tested with the provider.

const BOXEL_API = OAUTH_TEST_ISSUER;
const REALM_URL = OAUTH_TEST_SERVER_URL.href;
const OWNER = '@oauth-owner:localhost';
const READER = '@oauth-reader:localhost';
const STRANGER = '@oauth-stranger:localhost';
// The card a realm's policy pointer names in the tests of the policy guard.
// The guard refuses a write to the path the pointer names whatever the card
// there is, so it needn't be a RealmPolicy, which the catalog defines.
const POLICY_CARD_URL = `${REALM_URL}policy`;
const CARD_DEF = {
  module: 'https://cardstack.com/base/card-api',
  name: 'CardDef',
};

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

  module('the caller’s workspace list', function () {
    test('a boxel:read token reads its user’s workspace list and display name', async function (assert) {
      await ensureMatrixAdminUser();
      let user = await registerListUser('oauth-list');
      await setWorkspaceListOf(user, ['https://elsewhere.example/a/']);
      let [{ id }] = (await dbAdapter.execute(
        `INSERT INTO users (matrix_user_id) VALUES ($1) RETURNING id`,
        { bind: [user.userId] },
      )) as { id: string }[];
      userIds[user.userId] = id;
      let { token } = await oauthToken(user.userId, { scope: 'boxel:read' });

      let list = await request()
        .get('/_user-realms')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(list.status, 200, list.text);
      assert.deepEqual(list.body.data.attributes.realms, [
        'https://elsewhere.example/a/',
      ]);

      let name = await request()
        .get('/_user-display-name')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(name.status, 200, name.text);
      assert.strictEqual(
        name.body.data.attributes.displayName,
        user.displayName,
      );
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

    test('a realm.json write that changes the policy pointer, the config or the card’s type is refused, and other edits are not', async function (assert) {
      let { token } = await oauthToken(OWNER);
      await started!.realm.write(
        'realm.json',
        realmConfigCardJSON({ name: 'Test Workspace' }),
      );
      let renamed = await writeSource(
        token,
        '/realm.json',
        realmConfigCardJSON({ name: 'Renamed' }),
      );
      assert.true(
        succeeded(renamed),
        `a name change is accepted: ${renamed.status} ${renamed.text}`,
      );
      let refused: [string, string][] = [
        [
          'the policy pointer',
          realmConfigCardJSON({ name: 'Renamed', policy: POLICY_CARD_URL }),
        ],
        [
          'the config',
          realmConfigCardJSON({ name: 'Renamed', config: { anything: true } }),
        ],
        [
          'the card’s type',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Renamed' } },
              meta: {
                adoptsFrom: { module: `${REALM_URL}my-config`, name: 'Mine' },
              },
            },
          }),
        ],
        ['a document the realm can’t read', 'not json'],
      ];
      for (let [label, content] of refused) {
        let response = await writeSource(token, '/realm.json', content);
        assert.strictEqual(
          response.status,
          403,
          `a source write changing ${label}: ${response.text}`,
        );
      }
      let atomic = await request()
        .post('/_atomic')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', `Bearer ${token}`)
        .send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'update',
                href: './realm.json',
                data: JSON.parse(
                  realmConfigCardJSON({
                    name: 'Renamed',
                    policy: POLICY_CARD_URL,
                  }),
                ).data,
              },
            ],
          }),
        );
      assert.strictEqual(
        atomic.status,
        403,
        `an /_atomic write changing the policy pointer: ${atomic.text}`,
      );
      let removal = await request()
        .delete('/realm.json')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(removal.status, 403, `removal: ${removal.text}`);
      let stored = JSON.parse(
        (await started!.realm.operationCore.readFileAsText('realm.json'))!,
      );
      assert.strictEqual(
        stored.data.attributes.cardInfo.name,
        'Renamed',
        'realm.json keeps the name change',
      );
      assert.strictEqual(
        stored.data.attributes.policy,
        undefined,
        'and has no policy pointer',
      );
    });

    test('a realm.json whose type is a RealmConfig subclass refuses every change, since the subclass may compute its config from any field', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let subclassConfig = (attributes: Record<string, unknown>) =>
        JSON.stringify({
          data: {
            type: 'card',
            attributes,
            meta: {
              adoptsFrom: { module: './computed-config', name: 'Computed' },
            },
          },
        });
      let original = subclassConfig({
        cardInfo: { name: 'Test Workspace' },
        mode: 'strict',
      });
      await started!.realm.write('realm.json', original);
      let refused: [string, string][] = [
        [
          'an attribute the subclass may read',
          subclassConfig({
            cardInfo: { name: 'Test Workspace' },
            mode: 'open',
          }),
        ],
        [
          'the name',
          subclassConfig({ cardInfo: { name: 'Renamed' }, mode: 'strict' }),
        ],
      ];
      for (let [label, content] of refused) {
        let response = await writeSource(token, '/realm.json', content);
        assert.strictEqual(
          response.status,
          403,
          `a source write changing ${label}: ${response.text}`,
        );
      }
      let unchanged = await writeSource(token, '/realm.json', original);
      assert.true(
        succeeded(unchanged),
        `rewriting the same document is accepted: ${unchanged.status} ${unchanged.text}`,
      );
      let stored = JSON.parse(
        (await started!.realm.operationCore.readFileAsText('realm.json'))!,
      );
      assert.deepEqual(
        stored.data.attributes,
        { cardInfo: { name: 'Test Workspace' }, mode: 'strict' },
        'realm.json is unchanged',
      );
    });

    test('no write route writes or removes the policy card the realm points at', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let policyCard = JSON.stringify({
        data: {
          type: 'card',
          attributes: { cardInfo: { name: 'Policy' } },
          meta: { adoptsFrom: CARD_DEF },
        },
      });
      await started!.realm.write(
        'realm.json',
        realmConfigCardJSON({
          name: 'Test Workspace',
          policy: POLICY_CARD_URL,
        }),
      );
      await started!.realm.write('policy.json', policyCard);
      let changed = JSON.parse(policyCard);
      changed.data.attributes.cardInfo.name = 'Taken';
      let authed = (req: supertest.Test) =>
        req.set('Authorization', `Bearer ${token}`);
      let attempts: [string, () => supertest.Test][] = [
        [
          'a source write',
          () => writeSource(token, '/policy.json', JSON.stringify(changed)),
        ],
        [
          'a binary upload',
          () =>
            authed(
              request()
                .post('/policy.json')
                .set('Accept', SupportedMimeType.OctetStream)
                .set('Content-Type', SupportedMimeType.OctetStream),
            ).send(Buffer.from(JSON.stringify(changed))),
        ],
        [
          'an /_atomic update',
          () =>
            authed(
              request()
                .post('/_atomic')
                .set('Accept', SupportedMimeType.JSONAPI),
            ).send(
              JSON.stringify({
                'atomic:operations': [
                  { op: 'update', href: './policy.json', data: changed.data },
                ],
              }),
            ),
        ],
        [
          'an /_operations update',
          () =>
            authed(
              request()
                .post('/_operations')
                .set('Accept', SupportedMimeType.BoxelOperations)
                .set('Content-Type', SupportedMimeType.BoxelOperations),
            ).send(
              JSON.stringify({
                'boxel:operations': [
                  {
                    op: 'invoke',
                    'boxel:name': 'update',
                    href: POLICY_CARD_URL,
                    data: changed.data,
                  },
                ],
              }),
            ),
        ],
        [
          'an /_operations delete',
          () =>
            authed(
              request()
                .post('/_operations')
                .set('Accept', SupportedMimeType.BoxelOperations)
                .set('Content-Type', SupportedMimeType.BoxelOperations),
            ).send(
              JSON.stringify({
                'boxel:operations': [
                  {
                    op: 'invoke',
                    'boxel:name': 'delete',
                    href: POLICY_CARD_URL,
                  },
                ],
              }),
            ),
        ],
        [
          'a card PATCH',
          () =>
            authed(
              request()
                .patch('/policy')
                .set('Accept', SupportedMimeType.CardJson),
            ).send(JSON.stringify(changed)),
        ],
        [
          'a card DELETE',
          () =>
            authed(
              request()
                .delete('/policy')
                .set('Accept', SupportedMimeType.CardJson),
            ),
        ],
        [
          'a source DELETE',
          () =>
            authed(
              request()
                .delete('/policy.json')
                .set('Accept', SupportedMimeType.CardSource),
            ),
        ],
      ];
      // Each attempt starts from the stored card, so each route is judged on
      // its own rather than on what an earlier one left behind.
      for (let [label, attempt] of attempts) {
        await started!.realm.write('policy.json', policyCard);
        let response = await attempt();
        assert.strictEqual(response.status, 403, `${label}: ${response.text}`);
        assert.strictEqual(
          await started!.realm.operationCore.readFileAsText('policy.json'),
          policyCard,
          `${label}: the policy card is untouched`,
        );
      }
    });

    test('an admitted token can’t assume another user', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let response = await readCard(token).set('X-Boxel-Assume-User', READER);
      assertInvalidToken(assert, response, 'X-Boxel-Assume-User');
    });

    test('a route the realm dispatches on its path alone refuses it as an unknown token', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let response = await request()
        .get('/_capture/person-1')
        .set('Accept', '*/*')
        .set('Authorization', `Bearer ${token}`);
      assertInvalidToken(assert, response, '_capture/');
    });
  });

  module('how a Boxel API token is checked', function () {
    test('a token in the query string is refused without a lookup, and isn’t logged', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let telemetry = await telemetryDuring(
        async () => {
          let realm = await request()
            .get(`/person-1?access_token=${token}`)
            .set('Accept', SupportedMimeType.CardJson);
          assert.strictEqual(realm.status, 400, realm.text);
          let server = await request()
            .get(`/_archived-realms?access_token=${token}`)
            .set('Accept', SupportedMimeType.JSONAPI)
            .set('Authorization', `Bearer ${token}`);
          assert.strictEqual(server.status, 400, server.text);
        },
        { channels: ['realm'] },
      );
      assert.true(
        telemetry.logs.includes('not in the header'),
        'the refusal is logged',
      );
      assertNoSecrets(assert, telemetry, { 'access token': token });
    });

    test('a token in a form-encoded body is refused without a lookup, and isn’t logged', async function (assert) {
      let { token } = await oauthToken(OWNER);
      let telemetry = await telemetryDuring(
        async () => {
          let realm = await request()
            .post('/notes.md')
            .set('Accept', SupportedMimeType.CardSource)
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .send(`access_token=${token}`);
          assert.strictEqual(realm.status, 400, realm.text);
          let server = await request()
            .post('/_create-realm')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .send(`access_token=${token}`);
          assert.strictEqual(server.status, 400, server.text);
        },
        { channels: ['realm'] },
      );
      assertNoSecrets(assert, telemetry, { 'access token': token });
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

  // A tab token (`runtime-common/oauth-tab-token.ts`): what the prerender tab
  // of a command or capture an OAuth app starts holds in place of the user's
  // sessions. Code the app chose runs in that tab, so these pin that a tab
  // token reaches no more than the OAuth token behind it (ADR 021 §1.5). The
  // host sends a realm its session bare, so these do too.
  module('a tab token', function () {
    async function tabToken(
      user: string,
      {
        scope = 'boxel:read boxel:write',
        purpose = 'run-command',
        lifetimeSeconds,
        realm = REALM_URL,
      }: {
        scope?: string;
        purpose?: OAuthTabPurpose;
        lifetimeSeconds?: number;
        realm?: string;
      } = {},
    ): Promise<{ token: string; grantId: string }> {
      let { grantId } = await oauthToken(user, { scope });
      let createOAuthTabAuth = buildCreateOAuthTabAuth(realmSecretSeed, {
        realmServerURL: REALM_URL,
        ...(lifetimeSeconds !== undefined
          ? { lifetimeSeconds: () => lifetimeSeconds }
          : {}),
      });
      let sessions = JSON.parse(
        createOAuthTabAuth({
          userId: user,
          permissions: { [realm]: ['read', 'write', 'realm-owner'] },
          grantId,
          scopes: scope.split(' '),
          purpose,
          permissionCeiling: 'write',
        }),
      ) as Record<string, string>;
      return { token: sessions[realm], grantId };
    }

    function readCardWith(token: string) {
      return request()
        .get('/person-1.json')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', token);
    }

    function writeSourceWith(token: string) {
      return request()
        .post('/notes.md')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Content-Type', SupportedMimeType.CardSource)
        .set('Authorization', token)
        .send('# Changed by a tab');
    }

    function federatedInfoWith(token: string) {
      return request()
        .post('/_federated-info')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', token)
        .send({ realms: [REALM_URL] });
    }

    test('reads a realm as its grant’s user, with that user’s permissions', async function (assert) {
      let { token } = await tabToken(READER, { scope: 'boxel:read' });
      let response = await readCardWith(token);
      assert.strictEqual(response.status, 200, response.text);

      let stranger = await tabToken(STRANGER, { scope: 'boxel:read' });
      let refused = await readCardWith(stranger.token);
      assert.strictEqual(refused.status, 403, refused.text);
    });

    test('passes the federated endpoints’ check as its grant’s user', async function (assert) {
      let { token } = await tabToken(READER, { scope: 'boxel:read' });
      let response = await federatedInfoWith(token);
      assert.strictEqual(response.status, 200, response.text);
    });

    test('a command’s writes as far as the grant’s scopes allow', async function (assert) {
      let { token } = await tabToken(OWNER);
      let written = await writeSourceWith(token);
      assert.true(succeeded(written), `${written.status} ${written.text}`);

      let read = await tabToken(OWNER, { scope: 'boxel:read' });
      let refused = await writeSourceWith(read.token);
      assert.strictEqual(
        refused.status,
        403,
        `a boxel:read grant can't write: ${refused.text}`,
      );
    });

    test('a capture’s never writes, whatever its grant allows', async function (assert) {
      let { token } = await tabToken(OWNER, { purpose: 'capture' });
      assert.strictEqual((await readCardWith(token)).status, 200);
      let refused = await writeSourceWith(token);
      assert.strictEqual(refused.status, 403, refused.text);
      let unwritten = await request()
        .get('/notes.md')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', token);
      assert.notStrictEqual(unwritten.text, '# Changed by a tab');
    });

    test('is refused everywhere the Boxel API maps nothing, and on every route that checks a session itself', async function (assert) {
      let { token } = await tabToken(OWNER);
      let realmRoutes: ['get' | 'post', string][] = [
        ['get', '/_permissions'],
        ['post', '/_session'],
      ];
      for (let [method, path] of realmRoutes) {
        let response = await request()
          [method](path)
          .set('Accept', SupportedMimeType.JSONAPI)
          .set('Authorization', token);
        let refused = refusedAsClientError(response) && response.status !== 404;
        assert.true(
          refused,
          `${method.toUpperCase()} ${path}: ${response.status} ${response.text}`,
        );
      }
      // A realm-server route behind a session check refuses it on its
      // signature, mapped or not: a tab never reaches the realm server but
      // through the federated reads.
      let serverRoutes: ['get' | 'post', string][] = [
        ['post', '/_realm-auth'],
        ['post', '/_server-session'],
        ['get', '/_user'],
        ['get', '/_archived-realms'],
        ['post', '/_run-command'],
        ['post', '/_capture'],
        ['post', '/_request-forward'],
        ['get', '/_user-keys'],
      ];
      for (let [method, path] of serverRoutes) {
        let response = await request()
          [method](path)
          .set('Accept', 'application/json')
          .set('Authorization', token);
        let refused = refusedAsClientError(response) && response.status !== 404;
        assert.true(
          refused,
          `${method.toUpperCase()} ${path}: ${response.status} ${response.text}`,
        );
      }
    });

    test('disconnecting the app ends it on its next request', async function (assert) {
      let { token, grantId } = await tabToken(OWNER);
      assert.strictEqual((await readCardWith(token)).status, 200);
      assert.strictEqual((await federatedInfoWith(token)).status, 200);
      await endGrant(dbAdapter, grantId, 'user');
      assertNoCredential(assert, await readCardWith(token), 'realm');
      assertInvalidToken(assert, await federatedInfoWith(token), 'federated');
    });

    test('revoking the user’s sessions alone leaves it, and revoking their grants ends it', async function (assert) {
      let { token } = await tabToken(OWNER);
      // As for the access token it stands in for (ADR 021 §1.9).
      await revokeUserSessions(dbAdapter, OWNER);
      assert.strictEqual((await readCardWith(token)).status, 200);
      await revokeUserOAuthGrants(dbAdapter, OWNER);
      assertNoCredential(assert, await readCardWith(token), 'realm');
      assertInvalidToken(assert, await federatedInfoWith(token), 'federated');
    });

    // A realm judges a tab token it can't admit as a session that doesn't
    // verify: no credential, so a realm only its users may read refuses it.
    function assertNoCredential(
      assert: Assert,
      response: supertest.Response,
      label: string,
    ) {
      assert.strictEqual(response.status, 401, `${label}: ${response.text}`);
    }

    test('is refused once it expires', async function (assert) {
      let { token } = await tabToken(OWNER, { lifetimeSeconds: -60 });
      assertNoCredential(assert, await readCardWith(token), 'realm');
      assertInvalidToken(assert, await federatedInfoWith(token), 'federated');
    });

    test('is no credential in a realm it wasn’t minted for', async function (assert) {
      let { token } = await tabToken(OWNER, {
        realm: 'http://127.0.0.1:0/another-realm/',
      });
      assertNoCredential(assert, await readCardWith(token), 'realm');
    });

    // The keys never cross: a tab token never verifies as a session (the
    // tests above present real ones to session checks), and whatever the
    // tab-token key signs is never a session either.
    test('what the tab-token key signs is no session', async function (assert) {
      let sessionShaped = jwt.sign(
        {
          user: OWNER,
          realm: REALM_URL,
          permissions: ['read', 'write', 'realm-owner'],
          sessionRoom: '',
          realmServerURL: REALM_URL,
        },
        oauthTabTokenSecret(realmSecretSeed),
        { expiresIn: '1h' },
      );
      assertNoCredential(assert, await readCardWith(sessionShaped), 'realm');
      assertNoCredential(
        assert,
        await federatedInfoWith(sessionShaped),
        'federated',
      );
      assertNoCredential(
        assert,
        await request()
          .get('/_archived-realms')
          .set('Accept', SupportedMimeType.JSONAPI)
          .set('Authorization', `Bearer ${sessionShaped}`),
        'realm server',
      );
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
