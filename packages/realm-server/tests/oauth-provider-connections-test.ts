import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomBytes } from 'crypto';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  insertUser,
  realmSecretSeed,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { testOAuthSecureOriginURL } from './helpers/oauth-provider.ts';
import {
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_SERVER_URL,
  OAUTH_TEST_WEB_REDIRECT_URI,
  codeForOAuthClient,
  decideOAuthFlow,
  exchangeOAuthCode,
  randomMatrixId,
  refreshOAuthTokens,
  registerOAuthClient,
  startOAuthFlow,
  startOAuthProviderServer,
  type OAuthTestUser,
  type OAuthTokenResponse,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { appName } from '../lib/oauth-provider/app-name.ts';
import type { Connection } from '../lib/oauth-provider/connections.ts';
import { createGrant, endGrant } from '../lib/oauth-provider/grants.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import type { OAuthResourceDefinition } from '../lib/oauth-provider/registry.ts';
import { withOAuthProviderSecretsLabeled } from '../lib/request-telemetry.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const SECURE_ORIGIN = testOAuthSecureOriginURL.origin;

// A resource whose read route the realm server serves behind its controller,
// so a test can see whether a connection's access token still works.
const TEST_RESOURCE: OAuthResourceDefinition = {
  path: '/test-apps',
  name: 'Test workspaces',
  description: 'A test resource.',
  coverage: 'Test only.',
  scopes: [
    {
      name: 'boxel:read',
      description: 'Read.',
      label: 'Read',
      caution: false,
      routes: [{ on: 'server', method: 'GET', path: '/test-apps/read' }],
    },
    {
      name: 'boxel:write',
      description: 'Write.',
      label: 'Change',
      caution: true,
      routes: [{ on: 'server', method: 'POST', path: '/test-apps/write' }],
    },
  ],
  clients: 'open',
};
const RESOURCE = `${OAUTH_TEST_ISSUER}/test-apps`;

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_connections', {
    testResources: [TEST_RESOURCE],
  });
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let db: PgAdapter;

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      let built = await start(args);
      return () => closeServer(built);
    },
  });
  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      db = dbAdapter;
      server = await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  async function user(): Promise<OAuthTestUser> {
    let matrixId = randomMatrixId('connections');
    let { id } = await insertUser(db, matrixId, `cus_${matrixId}`, null);
    return { matrixId, id, session: await secureSessionAuth(db, matrixId) };
  }

  interface Connected {
    clientId: string;
    grantId: string;
    tokens: OAuthTokenResponse;
  }

  // A whole flow, through the code exchange: the app is connected.
  async function connect(
    who: OAuthTestUser,
    {
      clientId,
      renew = true,
      scope = 'boxel:read',
      redirectUri = OAUTH_TEST_WEB_REDIRECT_URI,
    }: {
      clientId?: string;
      renew?: boolean;
      scope?: string;
      redirectUri?: string;
    } = {},
  ): Promise<Connected> {
    clientId = clientId ?? (await registerOAuthClient(server!));
    let code = await codeForOAuthClient(server!, clientId, who.session, {
      renew,
      scope,
      resources: [RESOURCE],
      redirectUri,
    });
    let response = await exchangeOAuthCode(server!, clientId, code, {
      redirectUri,
    });
    if (response.status !== 200) {
      throw new Error(`the code exchange failed: ${response.text}`);
    }
    let tokens = response.body as OAuthTokenResponse;
    return {
      clientId,
      grantId: await grantOf(tokens.access_token),
      tokens,
    };
  }

  async function grantOf(accessToken: string): Promise<string> {
    let [{ grant_id }] = (await db.execute(
      `SELECT grant_id FROM oauth_provider_tokens
        WHERE id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(accessToken)] },
    )) as { grant_id: string }[];
    return grant_id;
  }

  async function grantsOf(who: OAuthTestUser): Promise<string[]> {
    let rows = (await db.execute(
      `SELECT id FROM oauth_provider_grants WHERE user_id = $1
        ORDER BY created_at`,
      { bind: [who.id] },
    )) as { id: string }[];
    return rows.map(({ id }) => id);
  }

  async function grantRow(grantId: string) {
    let [row] = (await db.execute(
      `SELECT ended_at, ended_reason,
              (SELECT count(*)::int FROM oauth_provider_tokens
                WHERE grant_id = g.id) AS tokens
         FROM oauth_provider_grants AS g WHERE id = $1`,
      { bind: [grantId] },
    )) as {
      ended_at: string | null;
      ended_reason: string | null;
      tokens: number;
    }[];
    return row;
  }

  interface Caller {
    authorization?: string;
    origin?: string;
    host?: string;
  }

  function withCaller(request: supertest.Test, caller: Caller) {
    request = request
      .set('Host', caller.host ?? OAUTH_TEST_SERVER_URL.host)
      .set('Origin', caller.origin ?? SECURE_ORIGIN);
    return caller.authorization
      ? request.set('Authorization', caller.authorization)
      : request;
  }

  function list(caller: Caller) {
    return withCaller(
      supertest(server!).get('/_oauth-provider/connections'),
      caller,
    );
  }

  async function listed(who: OAuthTestUser): Promise<Connection[]> {
    let response = await list({ authorization: who.session });
    if (response.status !== 200) {
      throw new Error(`the list failed: ${response.status} ${response.text}`);
    }
    return response.body.connections as Connection[];
  }

  function disconnect(grantId: string, caller: Caller) {
    return withCaller(
      supertest(server!).delete(
        `/_oauth-provider/connections/${encodeURIComponent(grantId)}`,
      ),
      caller,
    );
  }

  // Whether an access token still reaches the test resource.
  async function reaches(accessToken: string): Promise<boolean> {
    let response = await supertest(server!)
      .get('/test-apps/read')
      .set('Host', OAUTH_TEST_SERVER_URL.host)
      .set('Authorization', `Bearer ${accessToken}`);
    return response.status === 200;
  }

  // Moves a grant, and its tokens, back in time by `seconds`.
  async function age(grantId: string, seconds: number) {
    await db.execute(
      `UPDATE oauth_provider_grants
          SET created_at = created_at - make_interval(secs => $2),
              expires_at = expires_at - make_interval(secs => $2)
        WHERE id = $1`,
      { bind: [grantId, seconds] },
    );
    await db.execute(
      `UPDATE oauth_provider_tokens
          SET created_at = created_at - make_interval(secs => $2),
              expires_at = expires_at - make_interval(secs => $2)
        WHERE grant_id = $1`,
      { bind: [grantId, seconds] },
    );
  }

  module('the list', function () {
    test('describes a live connection by the registry and as consent named the app', async function (assert) {
      let who = await user();
      let { clientId, grantId } = await connect(who, {
        scope: 'boxel:read boxel:write',
      });
      let [row] = (await db.execute(
        `SELECT extract(epoch FROM created_at) AS created,
                extract(epoch FROM expires_at) AS expires
           FROM oauth_provider_grants WHERE id = $1`,
        { bind: [grantId] },
      )) as { created: string; expires: string }[];
      assert.deepEqual(await listed(who), [
        {
          id: grantId,
          app: appName({
            clientId,
            clientName: 'Test App',
            redirectUri: OAUTH_TEST_WEB_REDIRECT_URI,
          }),
          resources: [
            {
              id: RESOURCE,
              name: 'Test workspaces',
              scopes: [
                { name: 'boxel:read', label: 'Read' },
                { name: 'boxel:write', label: 'Change' },
              ],
            },
          ],
          connectedAt: new Date(Number(row.created) * 1000).toISOString(),
          lastUsedAt: null,
          endsAt: new Date(Number(row.expires) * 1000).toISOString(),
          renewing: true,
        },
      ]);
    });

    test('says when a connection was last used, once a resource accepts its token', async function (assert) {
      let who = await user();
      let { tokens } = await connect(who);
      assert.strictEqual((await listed(who))[0].lastUsedAt, null);
      assert.true(await reaches(tokens.access_token));
      let [connection] = await listed(who);
      assert.strictEqual(typeof connection.lastUsedAt, 'string');
    });

    test('names an app that registered itself by the redirect URI each connection used', async function (assert) {
      let who = await user();
      let registered = await supertest(server!)
        .post('/_oauth-provider/reg')
        .set('Host', OAUTH_TEST_SERVER_URL.host)
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            client_name: 'Two Homes',
            redirect_uris: [
              'https://app.first-home.example/callback',
              'https://app.second-home.example/callback',
            ],
          }),
        );
      assert.strictEqual(registered.status, 201, registered.text);
      let clientId = registered.body.client_id as string;
      await connect(who, {
        clientId,
        redirectUri: 'https://app.first-home.example/callback',
      });
      await connect(who, {
        clientId,
        redirectUri: 'https://app.second-home.example/callback',
      });
      let shown = (await listed(who)).map(({ app }) => app);
      assert.deepEqual(
        shown.map(({ shown }) => shown).sort(),
        ['first-home.example', 'second-home.example'],
        'each connection is named by its own redirect URI',
      );
      for (let app of shown) {
        assert.false(app.verified);
        assert.strictEqual(app.claimedName, 'Two Homes');
      }
    });

    test('names an app by its one registered redirect URI when the flow left it out', async function (assert) {
      let who = await user();
      let clientId = await registerOAuthClient(server!, {
        redirectUri: 'https://app.only-home.example/callback',
      });
      let code = await codeForOAuthClient(server!, clientId, who.session, {
        resources: [RESOURCE],
        redirectUri: null,
      });
      let exchanged = await exchangeOAuthCode(server!, clientId, code, {
        redirectUri: 'https://app.only-home.example/callback',
      });
      assert.strictEqual(exchanged.status, 200, exchanged.text);
      let [connection] = await listed(who);
      assert.strictEqual(connection.app.shown, 'only-home.example');
    });

    test('names a client by its metadata document as consent does, without fetching it', async function (assert) {
      let who = await user();
      let clientId = 'https://apps.document-client.example/oauth/client.json';
      let grantId = await createGrant(db, {
        userId: who.id,
        clientId,
        resources: { [RESOURCE]: ['boxel:read'] },
        renewing: true,
        consentedAt: new Date(),
        redirectUri: 'https://apps.document-client.example/callback',
      });
      await db.execute(
        `INSERT INTO oauth_provider_tokens
           (id_hash, kind, grant_id, resource, scope, payload, expires_at,
            rotation)
           VALUES (decode($1, 'hex'), 'RefreshToken', $2, $3, 'boxel:read',
                   '{}'::jsonb, now() + interval '1 day', 0)`,
        {
          bind: [sha256Hex(randomBytes(16).toString('hex')), grantId, RESOURCE],
        },
      );
      let [connection] = await listed(who);
      assert.deepEqual(connection.app, {
        kind: 'metadata-document',
        shown: 'document-client.example',
        verified: true,
      });
    });

    test('leaves out connections that have ended, expired, or been revoked', async function (assert) {
      let who = await user();
      let live = await connect(who);
      let ended = await connect(who);
      let expired = await connect(who);
      let revoked = await connect(who);
      await disconnect(ended.grantId, { authorization: who.session });
      await db.execute(
        `UPDATE oauth_provider_grants SET expires_at = now() - interval '1 second'
          WHERE id = $1`,
        { bind: [expired.grantId] },
      );
      // A revocation of the user's grants covers one created before it, even
      // before anything has ended it.
      await age(revoked.grantId, 120);
      await db.execute(
        `UPDATE users SET oauth_grants_revoked_at = now() - interval '60 seconds'
          WHERE id = $1`,
        { bind: [who.id] },
      );
      assert.strictEqual(
        (await grantRow(revoked.grantId)).ended_at,
        null,
        'the revoked grant has not ended yet',
      );
      assert.deepEqual(
        (await listed(who)).map(({ id }) => id),
        [live.grantId],
      );
    });

    test('lists a 60-minute connection during its hour, and not after it', async function (assert) {
      let who = await user();
      let { grantId } = await connect(who, { renew: false });
      await age(grantId, 59 * 60);
      let [connection] = await listed(who);
      assert.strictEqual(connection?.id, grantId, 'listed within its hour');
      assert.false(connection.renewing);
      await age(grantId, 2 * 60);
      assert.deepEqual(await listed(who), [], 'not listed after its hour');
    });

    test('keeps listing a connection that renews after its access tokens are gone', async function (assert) {
      let who = await user();
      let { grantId } = await connect(who);
      await db.execute(
        `DELETE FROM oauth_provider_tokens
          WHERE grant_id = $1 AND kind = 'AccessToken'`,
        { bind: [grantId] },
      );
      assert.deepEqual(
        (await listed(who)).map(({ id }) => id),
        [grantId],
      );
    });

    test('leaves out a flow abandoned before its code was exchanged', async function (assert) {
      let who = await user();
      let clientId = await registerOAuthClient(server!);

      // Finished, but the browser never followed the resume, so no code was
      // issued.
      let browser = supertest.agent(server!);
      let uid = await startOAuthFlow(browser, clientId, {
        resources: [RESOURCE],
      });
      let ticket = await decideOAuthFlow(server!, uid, who.session);
      let finished = await browser
        .get(
          `/_oauth-provider/interaction/${uid}/finish?${new URLSearchParams({ ticket })}`,
        )
        .set('Host', OAUTH_TEST_SERVER_URL.host);
      assert.strictEqual(finished.status, 303);
      assert.strictEqual((await grantsOf(who)).length, 1, 'a grant exists');
      assert.deepEqual(await listed(who), [], 'not listed without a code');

      // A code issued, but not exchanged yet.
      let code = await codeForOAuthClient(server!, clientId, who.session, {
        resources: [RESOURCE],
      });
      assert.strictEqual((await grantsOf(who)).length, 2);
      assert.deepEqual(await listed(who), [], 'not listed before the exchange');

      let exchanged = await exchangeOAuthCode(server!, clientId, code);
      assert.strictEqual(exchanged.status, 200, exchanged.text);
      let grantId = await grantOf(
        (exchanged.body as OAuthTokenResponse).access_token,
      );
      assert.deepEqual(
        (await listed(who)).map(({ id }) => id),
        [grantId],
        'listed once the app has its tokens',
      );
    });

    test("never lists another user's connections", async function (assert) {
      let alice = await user();
      let bob = await user();
      let { grantId } = await connect(alice);
      assert.deepEqual(await listed(bob), []);
      assert.deepEqual(
        (await listed(alice)).map(({ id }) => id),
        [grantId],
      );
    });
  });

  module('disconnecting', function () {
    test('ends one of two connections of the same app, and leaves the other working', async function (assert) {
      let who = await user();
      let first = await connect(who);
      let second = await connect(who, { clientId: first.clientId });

      let response = await disconnect(first.grantId, {
        authorization: who.session,
      });
      assert.strictEqual(response.status, 204, response.text);
      assert.strictEqual(response.headers['cache-control'], 'no-store');

      let ended = await grantRow(first.grantId);
      assert.strictEqual(ended.ended_reason, 'user', 'ended by the user');
      assert.notStrictEqual(ended.ended_at, null);
      assert.strictEqual(ended.tokens, 0, 'its tokens are deleted');
      assert.deepEqual(
        (await listed(who)).map(({ id }) => id),
        [second.grantId],
        'no longer listed',
      );
      assert.false(
        await reaches(first.tokens.access_token),
        'its access token is refused',
      );
      let refreshed = await refreshOAuthTokens(
        server!,
        first.clientId,
        first.tokens.refresh_token!,
      );
      assert.strictEqual(refreshed.status, 400, 'its refresh is refused');
      assert.strictEqual(refreshed.body.error, 'invalid_grant');
      assert.strictEqual(
        (await grantRow(first.grantId)).ended_reason,
        'user',
        'and it stays ended by the user',
      );

      assert.true(
        await reaches(second.tokens.access_token),
        "the other's access token still works",
      );
      let other = await refreshOAuthTokens(
        server!,
        second.clientId,
        second.tokens.refresh_token!,
      );
      assert.strictEqual(other.status, 200, "the other's refresh still works");
    });

    test("answers another user's connection as not found, and changes nothing", async function (assert) {
      let alice = await user();
      let bob = await user();
      let connected = await connect(alice);
      let before = await grantRow(connected.grantId);

      let response = await disconnect(connected.grantId, {
        authorization: bob.session,
      });
      assert.strictEqual(response.status, 404);
      assert.deepEqual(response.body, { error: 'not-found' });

      let after = await grantRow(connected.grantId);
      assert.strictEqual(after.ended_at, null, 'not ended');
      assert.strictEqual(after.tokens, before.tokens, 'its tokens are kept');
      assert.true(await reaches(connected.tokens.access_token));
      let refreshed = await refreshOAuthTokens(
        server!,
        connected.clientId,
        connected.tokens.refresh_token!,
      );
      assert.strictEqual(refreshed.status, 200, 'it still refreshes');
    });

    test('ends a live grant whose code has not been exchanged, so the code is refused', async function (assert) {
      let who = await user();
      let clientId = await registerOAuthClient(server!);
      let code = await codeForOAuthClient(server!, clientId, who.session, {
        resources: [RESOURCE],
      });
      let [grantId] = await grantsOf(who);
      assert.deepEqual(await listed(who), [], 'not listed yet');

      let response = await disconnect(grantId, { authorization: who.session });
      assert.strictEqual(response.status, 204, response.text);
      assert.strictEqual((await grantRow(grantId)).ended_reason, 'user');

      let exchanged = await exchangeOAuthCode(server!, clientId, code);
      assert.strictEqual(exchanged.status, 400, 'its code is refused');
      assert.strictEqual(exchanged.body.error, 'invalid_grant');
      assert.deepEqual(await listed(who), [], 'and it is never listed');
    });

    test("answers a disconnect of the user's own connection that is no longer live as done, and changes nothing", async function (assert) {
      let who = await user();
      let disconnected = await connect(who);
      let endedByClient = await connect(who);
      let expired = await connect(who);
      let revoked = await connect(who);
      assert.strictEqual(
        (await disconnect(disconnected.grantId, { authorization: who.session }))
          .status,
        204,
      );
      await endGrant(db, endedByClient.grantId, 'client');
      await db.execute(
        `UPDATE oauth_provider_grants SET expires_at = now() - interval '1 second'
          WHERE id = $1`,
        { bind: [expired.grantId] },
      );
      await age(revoked.grantId, 120);
      await db.execute(
        `UPDATE users SET oauth_grants_revoked_at = now() - interval '60 seconds'
          WHERE id = $1`,
        { bind: [who.id] },
      );
      let before = new Map<string, Awaited<ReturnType<typeof grantRow>>>();
      for (let { grantId } of [disconnected, endedByClient, expired, revoked]) {
        before.set(grantId, await grantRow(grantId));
      }
      for (let [name, grantId] of [
        ['disconnected again', disconnected.grantId],
        ['ended by its client', endedByClient.grantId],
        ['expired', expired.grantId],
        ['revoked', revoked.grantId],
      ]) {
        let response = await disconnect(grantId, {
          authorization: who.session,
        });
        assert.strictEqual(response.status, 204, name);
        assert.deepEqual(
          await grantRow(grantId),
          before.get(grantId),
          `${name}: unchanged`,
        );
      }
      assert.strictEqual(
        (await grantRow(endedByClient.grantId)).ended_reason,
        'client',
        'an ended connection keeps its first reason',
      );
      assert.strictEqual(
        (await grantRow(revoked.grantId)).ended_reason,
        null,
        'a revoked one is not recorded as ended by the user',
      );
    });

    test('answers a grant ID that names no grant as not found', async function (assert) {
      let who = await user();
      let response = await disconnect(randomBytes(32).toString('base64url'), {
        authorization: who.session,
      });
      assert.strictEqual(response.status, 404);
      assert.deepEqual(response.body, { error: 'not-found' });
    });

    test('records the disconnect without the grant, the user or a token', async function (assert) {
      let who = await user();
      let { grantId, tokens, clientId } = await connect(who);
      let telemetry = await telemetryDuring(async () => {
        let response = await disconnect(grantId, {
          authorization: who.session,
        });
        assert.strictEqual(response.status, 204);
      });
      assert.true(
        telemetry.logs.includes(`grant ended: user, client ${clientId}`),
        telemetry.logs,
      );
      assert.true(
        telemetry.logs.includes('/_oauth-provider/connections/:grantId'),
        'the request log names the route by its label',
      );
      assertNoSecrets(assert, telemetry, {
        'grant ID': grantId,
        'access token': tokens.access_token,
        'refresh token': tokens.refresh_token!,
        user: who.matrixId,
      });
    });

    test('the grant ID in a path is replaced by a label', function (assert) {
      assert.strictEqual(
        withOAuthProviderSecretsLabeled(
          '<-- DELETE https://realm.test/_oauth-provider/connections/grant-id-1',
        ),
        '<-- DELETE https://realm.test/_oauth-provider/connections/:grantId',
      );
      assert.strictEqual(
        withOAuthProviderSecretsLabeled('/_oauth-provider/connections'),
        '/_oauth-provider/connections',
        'the list names no grant',
      );
    });
  });

  module('who may ask', function () {
    test('only the secure origin, under a secure window session, may list or disconnect', async function (assert) {
      let who = await user();
      let { grantId } = await connect(who);
      let appSession = `Bearer ${createRealmServerJWT(
        { user: who.matrixId, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      let cliSession = await secureSessionAuth(db, who.matrixId, {
        client: 'cli',
      });
      let refusals: [string, Caller, number][] = [
        ['no session', {}, 401],
        ['the app session', { authorization: appSession }, 401],
        ['a CLI secure session', { authorization: cliSession }, 401],
        [
          'a secure window session from another origin',
          { authorization: who.session, origin: 'https://app.boxel.test' },
          403,
        ],
        [
          'a secure window session with no origin',
          { authorization: who.session, origin: '' },
          403,
        ],
      ];
      for (let [name, caller, status] of refusals) {
        let listedResponse = await list(caller);
        assert.strictEqual(listedResponse.status, status, `list: ${name}`);
        assert.strictEqual(
          listedResponse.headers['cache-control'],
          'no-store',
          `list: ${name}`,
        );
        assert.strictEqual(listedResponse.body.connections, undefined);
        let disconnected = await disconnect(grantId, caller);
        assert.strictEqual(disconnected.status, status, `disconnect: ${name}`);
        assert.strictEqual(
          disconnected.headers['cache-control'],
          'no-store',
          `disconnect: ${name}`,
        );
      }
      assert.strictEqual(
        (await grantRow(grantId)).ended_at,
        null,
        'nothing was disconnected',
      );
      let allowed = await list({ authorization: who.session });
      assert.strictEqual(allowed.status, 200);
      assert.strictEqual(allowed.headers['cache-control'], 'no-store');
    });

    test('a request on another host is not answered by the provider', async function (assert) {
      let who = await user();
      let { grantId } = await connect(who);
      let caller = {
        authorization: who.session,
        host: 'published.example.test',
      };
      let listedResponse = await list(caller);
      assert.notStrictEqual(listedResponse.status, 200);
      assert.strictEqual(listedResponse.body.connections, undefined);
      let disconnected = await disconnect(grantId, caller);
      assert.notStrictEqual(disconnected.status, 204);
      assert.strictEqual((await grantRow(grantId)).ended_at, null);
    });
  });
});
