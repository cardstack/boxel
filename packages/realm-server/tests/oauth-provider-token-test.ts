import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  insertUser,
  matrixURL,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  OAUTH_TEST_CODE_CHALLENGE,
  OAUTH_TEST_CODE_VERIFIER,
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_MCP,
  OAUTH_TEST_SERVER_URL,
  OAUTH_TEST_WEB_REDIRECT_URI,
  codeForOAuthClient,
  decideOAuthFlow,
  exchangeOAuthCode,
  finishOAuthFlow,
  randomMatrixId,
  refreshOAuthTokens,
  registerOAuthClient,
  startOAuthFlow,
  startOAuthProviderServer,
  tokenRequest,
  type OAuthTestUser,
  type OAuthTokenResponse,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { revokeUserOAuthGrants } from '../lib/oauth-provider/grants.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import type { OAuthResourceDefinition } from '../lib/oauth-provider/registry.ts';
import type { TokenLimit } from '../lib/oauth-provider/token-limit.ts';
import { runDueDeviceSweeps } from '../lib/secure-session.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const serverURL = OAUTH_TEST_SERVER_URL;
const SECOND_RESOURCE = `${OAUTH_TEST_ISSUER}/test-second`;
const TEST_RESOURCES: OAuthResourceDefinition[] = [
  {
    path: '/test-second',
    name: 'Test second resource',
    description: 'A test resource.',
    coverage: 'Test only.',
    scopes: [
      {
        name: 'boxel:read',
        description: 'Read.',
        label: 'Read',
        caution: false,
        routes: [],
      },
    ],
    clients: 'open',
  },
];

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
  return startOAuthProviderServer(args, 'realm_server_oauth_token', {
    testResources: TEST_RESOURCES,
    ...(tokenLimit ? { tokenLimit } : {}),
  });
}

interface GrantRow {
  id: string;
  ended_reason: string | null;
  ended: boolean;
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

module(basename(import.meta.filename), function () {
  module('with roomy limits', function (hooks) {
    let state = setupProvider(hooks);
    let server = () => state.server!;
    let db = () => state.db!;

    async function user(): Promise<OAuthTestUser> {
      let matrixId = randomMatrixId('token');
      let { id } = await insertUser(db(), matrixId, `cus_${matrixId}`, null);
      return {
        matrixId,
        id,
        session: await secureSessionAuth(db(), matrixId),
      };
    }

    // A registered client, a user, and the code a whole flow sends the app.
    async function codeFor(
      options: Parameters<typeof codeForOAuthClient>[3] = {},
    ) {
      let clientId = await registerOAuthClient(server());
      let who = await user();
      let code = await codeForOAuthClient(
        server(),
        clientId,
        who.session,
        options,
      );
      return { clientId, user: who, code };
    }

    async function tokensFor(
      options: Parameters<typeof codeForOAuthClient>[3] = {},
    ) {
      let { clientId, user: who, code } = await codeFor(options);
      let response = await exchangeOAuthCode(server(), clientId, code);
      if (response.status !== 200) {
        throw new Error(`the code exchange failed: ${response.text}`);
      }
      return {
        clientId,
        user: who,
        code,
        tokens: response.body as OAuthTokenResponse,
      };
    }

    async function grants(): Promise<GrantRow[]> {
      return (await db().execute(
        `SELECT id, ended_reason, ended_at IS NOT NULL AS ended
           FROM oauth_provider_grants ORDER BY created_at`,
      )) as unknown as GrantRow[];
    }

    async function tokenRows() {
      return (await db().execute(
        `SELECT kind, resource, scope, rotation,
                consumed_at IS NOT NULL AS consumed,
                revoked_at IS NOT NULL AS revoked
           FROM oauth_provider_tokens ORDER BY kind, rotation`,
      )) as {
        kind: string;
        resource: string | null;
        scope: string;
        rotation: number | null;
        consumed: boolean;
        revoked: boolean;
      }[];
    }

    // Moves a refresh token's first use back, as though it were `seconds`
    // ago.
    async function usedSecondsAgo(refreshToken: string, seconds: number) {
      await db().execute(
        `UPDATE oauth_provider_tokens
            SET consumed_at = now() - make_interval(secs => $2)
          WHERE id_hash = decode($1, 'hex')`,
        { bind: [sha256Hex(refreshToken), seconds] },
      );
    }

    module('code exchange', function () {
      test('a code and its verifier get an access token bound to the resource, and a refresh token on a grant that renews', async function (assert) {
        let { tokens } = await tokensFor();
        assert.strictEqual(tokens.token_type, 'Bearer');
        assert.ok(tokens.access_token, 'an access token');
        assert.ok(
          tokens.refresh_token,
          'a refresh token, with no offline_access asked for',
        );
        assert.strictEqual(tokens.expires_in, 600, 'lasting 10 minutes');
        assert.strictEqual(tokens.scope, 'boxel:read');
        let rows = await tokenRows();
        assert.deepEqual(
          rows.map(({ kind, resource, scope }) => ({ kind, resource, scope })),
          [
            {
              kind: 'AccessToken',
              resource: OAUTH_TEST_MCP,
              scope: 'boxel:read',
            },
            {
              kind: 'RefreshToken',
              resource: OAUTH_TEST_MCP,
              scope: 'boxel:read',
            },
          ],
          'both stored, the access token bound to the one resource',
        );
      });

      test('a grant that does not renew gets no refresh token, and an access token lasting up to an hour', async function (assert) {
        let { tokens } = await tokensFor({ renew: false });
        assert.ok(tokens.access_token);
        assert.strictEqual(tokens.refresh_token, undefined, 'no refresh token');
        let aboutAnHour = tokens.expires_in > 3500 && tokens.expires_in <= 3600;
        assert.true(
          aboutAnHour,
          `lasting about an hour, never past the grant (${tokens.expires_in})`,
        );
      });

      test('a client that may not use the refresh grant gets no refresh token', async function (assert) {
        let clientId = await registerOAuthClient(server(), {
          grantTypes: ['authorization_code'],
        });
        let who = await user();
        let code = await codeForOAuthClient(server(), clientId, who.session);
        let response = await exchangeOAuthCode(server(), clientId, code);
        assert.strictEqual(response.status, 200, response.text);
        assert.strictEqual(response.body.refresh_token, undefined);
      });

      test('a wrong verifier is refused', async function (assert) {
        let { clientId, code } = await codeFor();
        let response = await exchangeOAuthCode(server(), clientId, code, {
          verifier: 'another-verifier-'.padEnd(64, 'x'),
        });
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.body.error, 'invalid_grant');
      });

      test('a code used twice ends its grant and the tokens it issued', async function (assert) {
        let { clientId, code, tokens } = await tokensFor();
        let again = await exchangeOAuthCode(server(), clientId, code);
        assert.strictEqual(again.status, 400);
        assert.strictEqual(again.body.error, 'invalid_grant');
        let [grant] = await grants();
        assert.deepEqual(
          { ended: grant.ended, reason: grant.ended_reason },
          { ended: true, reason: 'reuse' },
          'the grant ended as reuse',
        );
        assert.deepEqual(await tokenRows(), [], 'its tokens are gone');
        let refresh = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(refresh.status, 400, 'its refresh token is refused');
      });

      test('two exchanges of one code at once give tokens at most once, and end the grant', async function (assert) {
        let { clientId, code } = await codeFor();
        let responses = await Promise.all([
          exchangeOAuthCode(server(), clientId, code),
          exchangeOAuthCode(server(), clientId, code),
        ]);
        assert.deepEqual(
          responses.map(({ status }) => status).sort(),
          [200, 400],
          'one exchange gets tokens',
        );
        let [grant] = await grants();
        assert.strictEqual(grant.ended_reason, 'reuse', 'the grant ended');
      });

      test('a request for two resources at once is refused', async function (assert) {
        let twoResources = { resources: [OAUTH_TEST_MCP, SECOND_RESOURCE] };
        let first = await codeFor(twoResources);
        let both = await exchangeOAuthCode(
          server(),
          first.clientId,
          first.code,
        );
        assert.strictEqual(both.status, 400, 'naming none, with two granted');
        assert.strictEqual(both.body.error, 'invalid_target');
        // A code is spent by an exchange that fails, so the next is a new
        // flow's.
        let second = await codeFor(twoResources);
        let one = await exchangeOAuthCode(
          server(),
          second.clientId,
          second.code,
          {
            resource: SECOND_RESOURCE,
          },
        );
        assert.strictEqual(one.status, 200, 'naming one of them');
        let [row] = (await db().execute(
          `SELECT resource FROM oauth_provider_tokens WHERE kind = 'AccessToken'`,
        )) as { resource: string }[];
        assert.strictEqual(row.resource, SECOND_RESOURCE, 'bound to that one');
      });
    });

    module('refresh', function () {
      test('every refresh rotates the refresh token', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let first = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(first.status, 200, first.text);
        assert.notStrictEqual(
          first.body.refresh_token,
          tokens.refresh_token,
          'a new refresh token',
        );
        assert.ok(first.body.access_token, 'and a new access token');
        let second = await refreshOAuthTokens(
          server(),
          clientId,
          first.body.refresh_token,
        );
        assert.strictEqual(second.status, 200, second.text);
        assert.deepEqual(
          (await tokenRows())
            .filter(({ kind }) => kind === 'RefreshToken')
            .map(({ rotation, consumed }) => ({ rotation, consumed })),
          [
            { rotation: 0, consumed: true },
            { rotation: 1, consumed: true },
            { rotation: 2, consumed: false },
          ],
          'one chain, each token used once',
        );
      });

      test('a refresh token presented again within 30 seconds rotates again', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let first = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(first.status, 200);
        let retry = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(retry.status, 200, retry.text);
        assert.ok(retry.body.refresh_token, 'a refresh token again');
        let [grant] = await grants();
        assert.false(grant.ended, 'the grant goes on');
        let next = await refreshOAuthTokens(
          server(),
          clientId,
          retry.body.refresh_token,
        );
        assert.strictEqual(next.status, 200, 'and the retry’s token works');
      });

      test('a refresh token presented again after 30 seconds ends its grant', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let first = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(first.status, 200);
        await usedSecondsAgo(tokens.refresh_token!, 31);
        let reuse = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(reuse.status, 400);
        assert.strictEqual(reuse.body.error, 'invalid_grant');
        let [grant] = await grants();
        assert.strictEqual(grant.ended_reason, 'reuse', 'the grant ended');
        let child = await refreshOAuthTokens(
          server(),
          clientId,
          first.body.refresh_token,
        );
        assert.strictEqual(
          child.status,
          400,
          'its newest token is refused too',
        );
      });

      test('two refreshes of one token at once both succeed', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let responses = await Promise.all([
          refreshOAuthTokens(server(), clientId, tokens.refresh_token!),
          refreshOAuthTokens(server(), clientId, tokens.refresh_token!),
        ]);
        assert.deepEqual(
          responses.map(({ status }) => status),
          [200, 200],
        );
        let [grant] = await grants();
        assert.false(grant.ended, 'the grant goes on');
      });

      test('a token presented again after one it issued was used ends its grant, even within 30 seconds', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let first = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        let second = await refreshOAuthTokens(
          server(),
          clientId,
          first.body.refresh_token,
        );
        assert.strictEqual(second.status, 200);
        let replay = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(replay.status, 400);
        let [grant] = await grants();
        assert.strictEqual(grant.ended_reason, 'reuse');
      });

      test('once one of two sibling tokens is used, presenting the other ends the grant', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let [a, b] = [
          await refreshOAuthTokens(server(), clientId, tokens.refresh_token!),
          await refreshOAuthTokens(server(), clientId, tokens.refresh_token!),
        ];
        assert.strictEqual(a.status, 200);
        assert.strictEqual(b.status, 200, 'the retry gets a sibling');
        let used = await refreshOAuthTokens(
          server(),
          clientId,
          a.body.refresh_token,
        );
        assert.strictEqual(used.status, 200, 'one sibling is used');
        let sibling = await refreshOAuthTokens(
          server(),
          clientId,
          b.body.refresh_token,
        );
        assert.strictEqual(sibling.status, 400, 'the other is refused');
        let [grant] = await grants();
        assert.strictEqual(grant.ended_reason, 'reuse', 'and the grant ended');
      });

      test('a refresh fails once the grant has expired', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        await db().execute(
          `UPDATE oauth_provider_grants
              SET created_at = now() - interval '31 days',
                  expires_at = now() - interval '1 day'`,
        );
        let response = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.body.error, 'invalid_grant');
      });

      test('a refresh fails once the grant has ended', async function (assert) {
        let { clientId, tokens } = await tokensFor();
        let [grant] = await grants();
        await db().execute(
          `UPDATE oauth_provider_grants
              SET ended_at = now(), ended_reason = 'user' WHERE id = $1`,
          { bind: [grant.id] },
        );
        let response = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(response.status, 400);
      });
    });

    module('revocation', function () {
      test("revoking a user's OAuth grants ends them, and their refresh fails", async function (assert) {
        let { clientId, user: who, tokens } = await tokensFor();
        await revokeUserOAuthGrants(db(), who.matrixId);
        let [grant] = await grants();
        assert.strictEqual(grant.ended_reason, 'sessions-revoked');
        assert.deepEqual(await tokenRows(), [], 'its tokens are gone');
        let response = await refreshOAuthTokens(
          server(),
          clientId,
          tokens.refresh_token!,
        );
        assert.strictEqual(response.status, 400);
      });

      test('a flow decided before a revocation and finished after it sends the app no code', async function (assert) {
        let clientId = await registerOAuthClient(server());
        let who = await user();
        let browser = supertest.agent(server());
        let uid = await startOAuthFlow(browser, clientId, {
          codeChallenge: OAUTH_TEST_CODE_CHALLENGE,
        });
        let ticket = await decideOAuthFlow(server(), uid, who.session);
        // The revocation's cutoff is after the decision, by at least a
        // moment.
        await new Promise((resolve) => setTimeout(resolve, 20));
        await revokeUserOAuthGrants(db(), who.matrixId);
        let code: string | undefined;
        try {
          code = await finishOAuthFlow(browser, uid, ticket);
        } catch {
          code = undefined;
        }
        assert.strictEqual(code, undefined, 'the app gets no code');
        let [grant] = await grants();
        assert.strictEqual(
          grant.ended_reason,
          'sessions-revoked',
          'and the grant the flow created has ended',
        );
      });

      test("a password change's first revocation ends the grants made before it, and its later one leaves those made since", async function (assert) {
        let earlier = await tokensFor();
        let who = earlier.user;
        await db().execute(
          `INSERT INTO password_change_device_sweeps (user_id, sweep_at)
             VALUES ($1, NOW())`,
          { bind: [who.matrixId] },
        );
        await runDueDeviceSweeps({
          dbAdapter: db(),
          matrixClient: { matrixURL },
        } as any);
        let [before] = await grants();
        assert.strictEqual(
          before.ended_reason,
          'sessions-revoked',
          'the first revocation ends the grant made before it',
        );

        // A grant made after the first revocation, under a secure session
        // signed in with the new password. The revocation ended the old
        // session, and sessions are revoked by the second they were issued
        // in.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        let session = await secureSessionAuth(db(), who.matrixId);
        let clientId = await registerOAuthClient(server());
        let code = await codeForOAuthClient(server(), clientId, session);
        let exchange = await exchangeOAuthCode(server(), clientId, code);
        assert.strictEqual(exchange.status, 200, exchange.text);

        await db().execute(
          `UPDATE password_change_device_sweeps SET revoke_at = NOW()
            WHERE user_id = $1`,
          { bind: [who.matrixId] },
        );
        await runDueDeviceSweeps({
          dbAdapter: db(),
          matrixClient: { matrixURL },
        } as any);
        let refresh = await refreshOAuthTokens(
          server(),
          clientId,
          exchange.body.refresh_token,
        );
        assert.strictEqual(
          refresh.status,
          200,
          'the later revocation, for OpenID tokens, leaves the newer grant',
        );
        let rows = await grants();
        assert.false(rows[1].ended, 'which is still current');
      });
    });

    module('storage and telemetry', function () {
      test('no token, code or verifier is stored readable, logged or sent to Sentry', async function (assert) {
        let { clientId, code } = await codeFor();
        let exchanged: OAuthTokenResponse | undefined;
        let refreshed: OAuthTokenResponse | undefined;
        let telemetry = await telemetryDuring(async () => {
          exchanged = (await exchangeOAuthCode(server(), clientId, code))
            .body as OAuthTokenResponse;
          refreshed = (
            await refreshOAuthTokens(
              server(),
              clientId,
              exchanged.refresh_token!,
            )
          ).body as OAuthTokenResponse;
        });
        let secrets = {
          code,
          verifier: OAUTH_TEST_CODE_VERIFIER,
          'access token': exchanged!.access_token,
          'refresh token': exchanged!.refresh_token!,
          'refreshed access token': refreshed!.access_token,
          'refreshed refresh token': refreshed!.refresh_token!,
        };
        assertNoSecrets(assert, telemetry, secrets);
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
    });

    module('CORS', function () {
      test('a page on another origin cannot call the token endpoint', async function (assert) {
        let { clientId, code } = await codeFor();
        let response = await tokenRequest(
          server(),
          {
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            code_verifier: OAUTH_TEST_CODE_VERIFIER,
            redirect_uri: OAUTH_TEST_WEB_REDIRECT_URI,
          },
          { origin: 'https://elsewhere.example.test' },
        );
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.body.error, 'invalid_request');
        assert.strictEqual(
          response.headers['access-control-allow-origin'],
          undefined,
          'and its page may not read the answer',
        );
      });

      test("a page on the origin of the client's redirect URI can, as a browser-based client does", async function (assert) {
        let redirectUri = 'http://localhost:6274/oauth/callback';
        let clientId = await registerOAuthClient(server(), { redirectUri });
        let who = await user();
        let code = await codeForOAuthClient(server(), clientId, who.session, {
          redirectUri,
        });
        let preflight = await supertest(server())
          .options('/_oauth-provider/token')
          .set('Host', serverURL.host)
          .set('Origin', 'http://localhost:6274')
          .set('Access-Control-Request-Method', 'POST')
          .set('Access-Control-Request-Headers', 'content-type');
        assert.strictEqual(preflight.status, 204, 'its preflight is answered');
        let response = await tokenRequest(
          server(),
          {
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            code_verifier: OAUTH_TEST_CODE_VERIFIER,
            redirect_uri: redirectUri,
          },
          { origin: 'http://localhost:6274' },
        );
        assert.strictEqual(response.status, 200, response.text);
        assert.strictEqual(
          response.headers['access-control-allow-origin'],
          'http://localhost:6274',
        );
      });
    });
  });

  module('with tight limits', function (hooks) {
    let state = setupProvider(hooks, {
      tokenLimit: {
        perGrant: { requests: 3, windowSeconds: 3600 },
        failuresPerAddress: { requests: 3, windowSeconds: 600 },
      },
    });
    let server = () => state.server!;
    let db = () => state.db!;

    async function tokensFor() {
      let clientId = await registerOAuthClient(server());
      let matrixId = randomMatrixId('limit');
      await insertUser(db(), matrixId, `cus_${matrixId}`, null);
      let code = await codeForOAuthClient(
        server(),
        clientId,
        await secureSessionAuth(db(), matrixId),
      );
      let response = await exchangeOAuthCode(server(), clientId, code);
      return {
        clientId,
        refreshToken: response.body.refresh_token as string,
      };
    }

    test('a grant over its limit is refused while another is not', async function (assert) {
      let a = await tokensFor();
      let b = await tokensFor();
      let token = a.refreshToken;
      for (let i = 0; i < 2; i++) {
        let response = await refreshOAuthTokens(server(), a.clientId, token);
        assert.strictEqual(response.status, 200, `refresh ${i + 1} of grant A`);
        token = response.body.refresh_token;
      }
      let over = await refreshOAuthTokens(server(), a.clientId, token);
      assert.strictEqual(over.status, 429, 'grant A is over its limit');
      assert.ok(over.headers['retry-after'], 'with when to try again');
      let other = await refreshOAuthTokens(
        server(),
        b.clientId,
        b.refreshToken,
      );
      assert.strictEqual(other.status, 200, 'grant B is not');
    });

    test('an address that keeps failing is refused before its request is read', async function (assert) {
      let clientId = await registerOAuthClient(server());
      for (let i = 0; i < 3; i++) {
        let response = await refreshOAuthTokens(
          server(),
          clientId,
          `not-a-token-${i}`,
        );
        assert.strictEqual(response.status, 400, `failure ${i + 1}`);
      }
      // The library counts a failure after it answers.
      await new Promise((resolve) => setTimeout(resolve, 50));
      let refused = await refreshOAuthTokens(server(), clientId, 'not-a-token');
      assert.strictEqual(refused.status, 429);
    });
  });
});
