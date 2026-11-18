import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  insertUser,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  OAUTH_TEST_MCP,
  OAUTH_TEST_SERVER_URL,
  codeForOAuthClient,
  exchangeOAuthCode,
  randomMatrixId,
  refreshOAuthTokens,
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
import { resolveOAuthAccessToken } from '../lib/oauth-provider/lookup.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import { REVOCATION_GRANT_LIMIT } from '../lib/oauth-provider/revocation.ts';
import type { TokenLimit } from '../lib/oauth-provider/token-limit.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const OTHER_ORIGIN = 'https://elsewhere.example.test';

interface StartOptions {
  tokenLimit?: TokenLimit;
}

function start(
  args: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  },
  { tokenLimit }: StartOptions = {},
): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_revocation', {
    ...(tokenLimit ? { tokenLimit } : {}),
  });
}

function setupProvider(hooks: NestedHooks, options: StartOptions = {}) {
  let state: { server?: Server; db?: PgAdapter } = {};
  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: `${import.meta.filename}:${JSON.stringify(options)}`,
    build: async (args) => {
      let built = await start(args, options);
      return () => closeServer(built);
    },
  });
  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      state.db = dbAdapter;
      state.server = await start({ dbAdapter, publisher, runner }, options);
    },
    afterEach: async () => {
      if (state.server) {
        await closeServer(state.server);
        state.server = undefined;
      }
    },
  });
  return state;
}

// What a test needs of one connection: its client, its tokens, and its grant.
interface Connection {
  clientId: string;
  tokens: OAuthTokenResponse;
  grantId: string;
}

function helpers(state: { server?: Server; db?: PgAdapter }) {
  let server = () => state.server!;
  let db = () => state.db!;

  // A whole flow for a new user, ending in a code exchange. Given a client,
  // it is another connection of that client, as when the same app is signed
  // in on another machine; otherwise it registers a client of its own.
  async function connect({
    clientId,
    redirectUri,
  }: { clientId?: string; redirectUri?: string } = {}): Promise<Connection> {
    let id =
      clientId ??
      (await registerOAuthClient(server(), {
        ...(redirectUri ? { redirectUri } : {}),
      }));
    let matrixId = randomMatrixId('revoke');
    await insertUser(db(), matrixId, `cus_${matrixId}`, null);
    let code = await codeForOAuthClient(
      server(),
      id,
      await secureSessionAuth(db(), matrixId),
      { ...(redirectUri ? { redirectUri } : {}) },
    );
    let response = await exchangeOAuthCode(server(), id, code, {
      ...(redirectUri ? { redirectUri } : {}),
    });
    if (response.status !== 200) {
      throw new Error(`the code exchange failed: ${response.text}`);
    }
    let tokens = response.body as OAuthTokenResponse;
    let [{ grant_id: grantId }] = (await db().execute(
      `SELECT grant_id FROM oauth_provider_tokens
        WHERE id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(tokens.access_token)] },
    )) as { grant_id: string }[];
    return { clientId: id, tokens, grantId };
  }

  async function grant(grantId: string) {
    let [row] = (await db().execute(
      `SELECT ended_at IS NOT NULL AS ended, ended_reason,
              (SELECT count(*)::int FROM oauth_provider_tokens AS t
                WHERE t.grant_id = g.id) AS tokens
         FROM oauth_provider_grants AS g
        WHERE g.id = $1`,
      { bind: [grantId] },
    )) as { ended: boolean; ended_reason: string | null; tokens: number }[];
    return row;
  }

  // Whether a connection still works: its refresh token gets new tokens.
  async function refreshes(connection: Connection): Promise<boolean> {
    let response = await refreshOAuthTokens(
      server(),
      connection.clientId,
      connection.tokens.refresh_token!,
    );
    if (response.status === 200) {
      connection.tokens = response.body as OAuthTokenResponse;
    }
    return response.status === 200;
  }

  return { server, db, connect, grant, refreshes };
}

module(basename(import.meta.filename), function () {
  module('with roomy limits', function (hooks) {
    let state = setupProvider(hooks);
    let { server, db, connect, grant, refreshes } = helpers(state);

    async function assertEndedByClient(
      assert: Assert,
      connection: Connection,
      accessToken: string,
    ) {
      assert.deepEqual(
        await grant(connection.grantId),
        { ended: true, ended_reason: 'client', tokens: 0 },
        'the grant is kept, ended by its client, with no tokens left',
      );
      assert.false(
        (await resolveOAuthAccessToken(db(), accessToken, OAUTH_TEST_MCP)).ok,
        'its access token is refused at the resource',
      );
      let refresh = await refreshOAuthTokens(
        server(),
        connection.clientId,
        connection.tokens.refresh_token!,
      );
      assert.strictEqual(refresh.status, 400, 'and its refresh fails');
      assert.strictEqual(refresh.body.error, 'invalid_grant');
    }

    test('revoking the refresh token ends the grant', async function (assert) {
      let connection = await connect();
      let response = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.refresh_token,
        token_type_hint: 'refresh_token',
      });
      assert.strictEqual(response.status, 200, response.text);
      await assertEndedByClient(
        assert,
        connection,
        connection.tokens.access_token,
      );
    });

    test('revoking the access token ends the grant, whatever the hint says', async function (assert) {
      let connection = await connect();
      let response = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.access_token,
        token_type_hint: 'refresh_token',
      });
      assert.strictEqual(response.status, 200, response.text);
      await assertEndedByClient(
        assert,
        connection,
        connection.tokens.access_token,
      );
    });

    test('revoking a refresh token already rotated out ends the grant as its client’s revocation', async function (assert) {
      let connection = await connect();
      let original = connection.tokens.refresh_token!;
      assert.true(await refreshes(connection), 'the connection refreshes');
      // Past the grace window, so presenting it at the token endpoint would
      // end the grant as reuse.
      await db().execute(
        `UPDATE oauth_provider_tokens
            SET consumed_at = now() - interval '60 seconds'
          WHERE id_hash = decode($1, 'hex')`,
        { bind: [sha256Hex(original)] },
      );
      let response = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: original,
      });
      assert.strictEqual(response.status, 200, response.text);
      await assertEndedByClient(
        assert,
        connection,
        connection.tokens.access_token,
      );
    });

    test("revoking one connection leaves the same client's other connection working", async function (assert) {
      let first = await connect();
      let second = await connect({ clientId: first.clientId });
      let response = await revokeOAuthToken(server(), {
        client_id: first.clientId,
        token: first.tokens.refresh_token,
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.true((await grant(first.grantId)).ended, 'the first one ends');
      assert.false(
        (await grant(second.grantId)).ended,
        'the second one is live',
      );
      assert.true(await refreshes(second), 'and still refreshes');
    });

    test("a client can't revoke another client's token", async function (assert) {
      let theirs = await connect();
      let mine = await connect();
      let response = await revokeOAuthToken(server(), {
        client_id: mine.clientId,
        token: theirs.tokens.refresh_token,
      });
      assert.strictEqual(response.status, 200, 'answered as for any token');
      assert.false((await grant(theirs.grantId)).ended, 'their grant is live');
      assert.true(await refreshes(theirs), 'and still refreshes');
    });

    test('an unknown or already-revoked token is answered 200', async function (assert) {
      let connection = await connect();
      let unknown = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: 'not-a-token',
      });
      assert.strictEqual(unknown.status, 200, 'an unknown token');
      let first = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(first.status, 200, 'the first revocation');
      let again = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(again.status, 200, 'the same token again');
      assert.strictEqual(
        (await grant(connection.grantId)).ended_reason,
        'client',
      );
    });

    test('an expired access token is answered 200 and leaves its grant live', async function (assert) {
      let connection = await connect();
      await db().execute(
        `UPDATE oauth_provider_tokens SET expires_at = now() - interval '1 second'
          WHERE id_hash = decode($1, 'hex')`,
        { bind: [sha256Hex(connection.tokens.access_token)] },
      );
      let response = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.access_token,
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.false(
        (await grant(connection.grantId)).ended,
        'the grant is live',
      );
      assert.true(await refreshes(connection), 'and still refreshes');
    });

    test('a request that names no client, or an unknown one, is refused and revokes nothing', async function (assert) {
      let connection = await connect();
      let noClient = await revokeOAuthToken(server(), {
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(noClient.status, 400, 'no client');
      assert.strictEqual(noClient.body.error, 'invalid_request');
      let unknownClient = await revokeOAuthToken(server(), {
        client_id: 'not-a-client',
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(unknownClient.status, 401, 'an unknown client');
      assert.strictEqual(unknownClient.body.error, 'invalid_client');
      assert.false(
        (await grant(connection.grantId)).ended,
        'the grant is live',
      );
      assert.true(await refreshes(connection), 'and still refreshes');
    });

    test("a request on another host doesn't reach the provider", async function (assert) {
      let connection = await connect();
      let response = await supertest(server())
        .post('/_oauth-provider/token/revocation')
        .set('Host', 'site.published.example.test')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(
          new URLSearchParams({
            client_id: connection.clientId,
            token: connection.tokens.refresh_token!,
          }).toString(),
        );
      assert.notStrictEqual(response.status, 200, 'not answered as revoked');
      assert.false(
        (await grant(connection.grantId)).ended,
        'the grant is live',
      );
    });

    test('no token is logged, sent to Sentry, or stored readable', async function (assert) {
      let connection = await connect();
      let telemetry = await telemetryDuring(async () => {
        await revokeOAuthToken(server(), {
          client_id: connection.clientId,
          token: 'unknown-token-marker-5d1f',
        });
        await revokeOAuthToken(server(), {
          client_id: connection.clientId,
          token: connection.tokens.access_token,
        });
      });
      let secrets = {
        'unknown token': 'unknown-token-marker-5d1f',
        'access token': connection.tokens.access_token,
        'refresh token': connection.tokens.refresh_token!,
      };
      assertNoSecrets(assert, telemetry, secrets);
      assert.true(
        /grant ended: client/.test(telemetry.logs),
        'the end of the grant is logged with its reason',
      );
      let stored = JSON.stringify(
        await db().execute(
          `SELECT encode(id_hash, 'hex') AS id_hash, payload::text AS payload
             FROM oauth_provider_tokens
           UNION ALL
           SELECT encode(id_hash, 'hex'), payload::text
             FROM oauth_provider_objects`,
        ),
      );
      for (let [name, value] of Object.entries(secrets)) {
        assert.false(stored.includes(value), `no row holds the ${name}`);
      }
    });

    test('a revocation that fails part way leaves its token, so a retry still ends the grant', async function (assert) {
      let connection = await connect();
      // Every update of a grant fails, so ending one fails part way.
      await db().execute(`
        CREATE FUNCTION refuse_grant_update() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'grant updates are refused for this test';
        END
        $$ LANGUAGE plpgsql`);
      await db().execute(`
        CREATE TRIGGER refuse_grant_update
          BEFORE UPDATE ON oauth_provider_grants
          FOR EACH ROW EXECUTE FUNCTION refuse_grant_update()`);
      try {
        let failed = await revokeOAuthToken(server(), {
          client_id: connection.clientId,
          token: connection.tokens.refresh_token,
        });
        assert.notStrictEqual(failed.status, 200, 'the revocation fails');
      } finally {
        await db().execute(
          `DROP TRIGGER refuse_grant_update ON oauth_provider_grants`,
        );
        await db().execute(`DROP FUNCTION refuse_grant_update()`);
      }
      assert.deepEqual(
        await grant(connection.grantId),
        { ended: false, ended_reason: null, tokens: 2 },
        'the grant is live and keeps its tokens',
      );
      let retried = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(retried.status, 200, retried.text);
      assert.deepEqual(
        await grant(connection.grantId),
        { ended: true, ended_reason: 'client', tokens: 0 },
        'the retry ends the grant',
      );
    });

    module('CORS', function () {
      test('a page on another origin is refused, and revokes nothing', async function (assert) {
        let connection = await connect();
        let response = await revokeOAuthToken(
          server(),
          {
            client_id: connection.clientId,
            token: connection.tokens.refresh_token,
          },
          { origin: OTHER_ORIGIN },
        );
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.body.error, 'invalid_request');
        assert.strictEqual(
          response.headers['access-control-allow-origin'],
          undefined,
          'and its page may not read the answer',
        );
        assert.true(await refreshes(connection), 'the grant still refreshes');
      });

      test('nor through another spelling of the path', async function (assert) {
        let connection = await connect();
        for (let path of [
          '/_oauth-provider/token/revocation/',
          '/_oauth-provider/TOKEN/Revocation',
        ]) {
          let response = await revokeOAuthToken(
            server(),
            {
              client_id: connection.clientId,
              token: connection.tokens.refresh_token,
            },
            { origin: OTHER_ORIGIN, path },
          );
          assert.strictEqual(
            response.headers['access-control-allow-origin'],
            undefined,
            `${path} gives the page nothing to read`,
          );
        }
        assert.false(
          (await grant(connection.grantId)).ended,
          'the grant is live',
        );
      });

      test("a page on the origin of the client's redirect URI can, as a browser-based client does", async function (assert) {
        let redirectUri = 'http://localhost:6274/oauth/callback';
        let connection = await connect({ redirectUri });
        let preflight = await supertest(server())
          .options('/_oauth-provider/token/revocation')
          .set('Host', OAUTH_TEST_SERVER_URL.host)
          .set('Origin', 'http://localhost:6274')
          .set('Access-Control-Request-Method', 'POST')
          .set('Access-Control-Request-Headers', 'content-type');
        assert.strictEqual(preflight.status, 204, 'its preflight is answered');
        let response = await revokeOAuthToken(
          server(),
          {
            client_id: connection.clientId,
            token: connection.tokens.refresh_token,
          },
          { origin: 'http://localhost:6274' },
        );
        assert.strictEqual(response.status, 200, response.text);
        assert.strictEqual(
          response.headers['access-control-allow-origin'],
          'http://localhost:6274',
        );
        assert.true((await grant(connection.grantId)).ended, 'it revoked');
      });
    });
  });

  module('with tight limits', function (hooks) {
    let state = setupProvider(hooks, {
      tokenLimit: {
        perGrant: { requests: 1000, windowSeconds: 3600 },
        failures: {
          perAddress: { requests: 3, windowSeconds: 600 },
          perNetwork: { requests: 1000, windowSeconds: 600 },
          overall: { requests: 1000, windowSeconds: 600 },
          alertAfter: 999,
        },
      },
    });
    let { server, connect, grant } = helpers(state);

    async function revokeUnknown(clientId: string, i: number) {
      return revokeOAuthToken(server(), {
        client_id: clientId,
        token: `not-a-token-${i}`,
      });
    }

    test('unknown tokens count as failed attempts against the address', async function (assert) {
      let clientId = await registerOAuthClient(server());
      for (let i = 0; i < 3; i++) {
        let response = await revokeUnknown(clientId, i);
        assert.strictEqual(response.status, 200, `unknown token ${i + 1}`);
      }
      let limited = await revokeUnknown(clientId, 4);
      assert.strictEqual(limited.status, 429, 'the address is limited');
      assert.strictEqual(limited.body.error, 'temporarily_unavailable');
      assert.ok(limited.headers['retry-after'], 'with when to try again');
    });

    test("another client's token counts as a failed attempt", async function (assert) {
      let theirs = await connect();
      let mine = await connect();
      for (let i = 0; i < 3; i++) {
        await revokeOAuthToken(server(), {
          client_id: mine.clientId,
          token: theirs.tokens.refresh_token,
        });
      }
      let limited = await revokeOAuthToken(server(), {
        client_id: mine.clientId,
        token: theirs.tokens.refresh_token,
      });
      assert.strictEqual(limited.status, 429, 'the address is limited');
      assert.false((await grant(theirs.grantId)).ended, 'their grant is live');
    });

    test('failures at the revocation and token endpoints count together', async function (assert) {
      let clientId = await registerOAuthClient(server());
      await revokeUnknown(clientId, 1);
      await revokeUnknown(clientId, 2);
      let refresh = await refreshOAuthTokens(server(), clientId, 'not-a-token');
      assert.strictEqual(refresh.status, 400, 'the third failure, a refresh');
      assert.strictEqual(
        (await revokeUnknown(clientId, 3)).status,
        429,
        'the revocation endpoint is limited',
      );
      assert.strictEqual(
        (await refreshOAuthTokens(server(), clientId, 'not-a-token')).status,
        429,
        'and so is the token endpoint',
      );
    });

    // A body sent as written, which `revokeOAuthToken` would encode.
    function revokeWithBody(body: string) {
      return supertest(server())
        .post('/_oauth-provider/token/revocation')
        .set('Host', OAUTH_TEST_SERVER_URL.host)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);
    }

    test('a body that hides an unknown token behind a live one counts as a failed attempt', async function (assert) {
      let connection = await connect();
      let live = encodeURIComponent(connection.tokens.refresh_token!);
      let client = encodeURIComponent(connection.clientId);
      let bodies = [
        // The library reads the first parameter as `?token`, so the token it
        // acts on is the second.
        `?token=${live}&token=not-a-token-1&client_id=${client}`,
        `token=${live}&token=not-a-token-2&client_id=${client}`,
        `token=not-a-token-3&client_id=${client}&client_id=${client}`,
      ];
      for (let body of bodies) {
        await revokeWithBody(body);
      }
      let limited = await revokeWithBody(
        `?token=${live}&token=not-a-token-4&client_id=${client}`,
      );
      assert.strictEqual(limited.status, 429, 'the address is limited');
      assert.false(
        (await grant(connection.grantId)).ended,
        'the live token was never revoked',
      );
    });

    test('a body too large to read counts as a failed attempt', async function (assert) {
      let connection = await connect();
      let body = `token=${encodeURIComponent(
        connection.tokens.refresh_token!,
      )}&client_id=${encodeURIComponent(connection.clientId)}&pad=${'x'.repeat(
        9 * 1024,
      )}`;
      for (let i = 0; i < 3; i++) {
        let response = await revokeWithBody(body);
        assert.strictEqual(response.status, 400, `too large ${i + 1}`);
        assert.strictEqual(response.body.error, 'invalid_request');
      }
      let limited = await revokeWithBody(body);
      assert.strictEqual(limited.status, 429, 'the address is limited');
      assert.false(
        (await grant(connection.grantId)).ended,
        'the live token in it was never revoked',
      );
    });

    test("a client's own revocation goes through from a limited address", async function (assert) {
      let connection = await connect();
      for (let i = 0; i < 3; i++) {
        await revokeUnknown(connection.clientId, i);
      }
      assert.strictEqual(
        (await revokeUnknown(connection.clientId, 4)).status,
        429,
        'the address is limited',
      );
      let response = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(
        (await grant(connection.grantId)).ended_reason,
        'client',
        'and ends its grant',
      );
    });
  });

  module('with a raised grant limit', function (hooks) {
    let state = setupProvider(hooks, {
      tokenLimit: {
        perGrant: { requests: 1000, windowSeconds: 3600 },
        failures: {
          perAddress: { requests: 1000, windowSeconds: 600 },
          perNetwork: { requests: 1000, windowSeconds: 600 },
          overall: { requests: 1000, windowSeconds: 600 },
          alertAfter: 999,
        },
      },
    });
    let { server, connect, grant, refreshes } = helpers(state);

    test("a live token sent in requests the library refuses counts against its grant's own revocation limit, which the grant limit doesn't raise", async function (assert) {
      let connection = await connect();
      let other = await connect();
      for (let i = 0; i < REVOCATION_GRANT_LIMIT.requests; i++) {
        let refused = await revokeOAuthToken(
          server(),
          {
            client_id: connection.clientId,
            token: connection.tokens.refresh_token,
          },
          { origin: OTHER_ORIGIN },
        );
        assert.strictEqual(refused.status, 400, `refused ${i + 1}`);
      }
      let limited = await revokeOAuthToken(server(), {
        client_id: connection.clientId,
        token: connection.tokens.refresh_token,
      });
      assert.strictEqual(
        limited.status,
        429,
        "the grant's revocations are limited",
      );
      assert.ok(limited.headers['retry-after'], 'with when to try again');
      assert.true(
        await refreshes(connection),
        'its refreshes are counted apart, and still go through',
      );
      let revoked = await revokeOAuthToken(server(), {
        client_id: other.clientId,
        token: other.tokens.refresh_token,
      });
      assert.strictEqual(revoked.status, 200, 'another grant is not limited');
      assert.true((await grant(other.grantId)).ended, 'and is revoked');
    });
  });
});
