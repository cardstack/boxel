import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomBytes } from 'crypto';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  ensureMatrixAdminUser,
  insertUser,
  matrixRegistrationSecret,
  matrixURL,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { testOAuthSecureOriginURL } from './helpers/oauth-provider.ts';
import {
  OAUTH_TEST_CODE_CHALLENGE,
  OAUTH_TEST_CODE_VERIFIER,
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_SERVER_URL,
  OAUTH_TEST_STATE,
  OAUTH_TEST_WEB_REDIRECT_URI,
  codeForOAuthClient,
  decideOAuthFlow,
  exchangeOAuthCode,
  finishOAuthFlow,
  refreshOAuthTokens,
  registerOAuthClient,
  revokeOAuthToken,
  startOAuthFlow,
  startOAuthProviderServer,
  type OAuthTokenResponse,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { sha256Hex } from '../lib/oauth-provider/objects.ts';
import type { OAuthResourceDefinition } from '../lib/oauth-provider/registry.ts';
import { registerUser } from '../synapse.ts';
import type { RealmHttpServer as Server } from '../server.ts';

// Two whole connections, from an app registering to its tokens ending,
// driven with known values: none of the secret values the flows hand out
// may reach the request log (`realm:requests`), the provider's log channel
// (`boxel:oauth-provider`) or Sentry, or be stored readable in any of the
// provider's tables at any step (ADR 021 §1.2). Each endpoint's own test
// checks its values one step at a time; this one checks them all together,
// on every table, including any added later.

const SECURE_ORIGIN = testOAuthSecureOriginURL.origin;
const HOST = OAUTH_TEST_SERVER_URL.host;

// A resource whose read route the realm server serves behind its
// controller, so the flow can make a call with its access token.
const TEST_RESOURCE: OAuthResourceDefinition = {
  path: '/test-secrecy',
  name: 'Test resource',
  description: 'A test resource.',
  coverage: 'Test only.',
  scopes: [
    {
      name: 'boxel:read',
      description: 'Read.',
      label: 'Read',
      caution: false,
      routes: [{ on: 'server', method: 'GET', path: '/test-secrecy/read' }],
    },
  ],
  clients: 'open',
};
const RESOURCE = `${OAUTH_TEST_ISSUER}/test-secrecy`;

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_secrecy', {
    testResources: [TEST_RESOURCE],
  });
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let db: PgAdapter;

  hooks.before(async function () {
    await ensureMatrixAdminUser();
  });

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

  // A Matrix account, which consent's details name, with its row in
  // `users`, which a grant names, and its secure window session.
  async function user(): Promise<{ matrixId: string; session: string }> {
    let username = `secrecy-${randomBytes(6).toString('hex')}`;
    let { userId: matrixId } = await registerUser({
      matrixURL,
      displayname: username,
      username,
      password: `pw-${randomBytes(12).toString('hex')}`,
      registrationSecret: matrixRegistrationSecret,
    });
    await insertUser(db, matrixId, `cus_${username}`, null);
    return { matrixId, session: await secureSessionAuth(db, matrixId) };
  }

  function exchanged(response: supertest.Response): OAuthTokenResponse {
    if (response.status !== 200 || !response.body.refresh_token) {
      throw new Error(
        `no tokens: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return response.body as OAuthTokenResponse;
  }

  async function grantOf(accessToken: string): Promise<string> {
    let [{ grant_id }] = (await db.execute(
      `SELECT grant_id FROM oauth_provider_tokens
        WHERE id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(accessToken)] },
    )) as { grant_id: string }[];
    return grant_id;
  }

  // Every row of every `oauth_provider_*` table, one line each, prefixed
  // with its table's name, found by name so that a table added later is
  // checked without listing it here.
  async function storedRows(): Promise<{ tables: string[]; rows: string }> {
    let tables = (
      (await db.execute(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name LIKE 'oauth\\_provider\\_%'
          ORDER BY table_name`,
      )) as { table_name: string }[]
    ).map(({ table_name }) => table_name);
    let rows: string[] = [];
    for (let table of tables) {
      let found = (await db.execute(
        `SELECT t::text AS row FROM "${table}" AS t`,
      )) as { row: string }[];
      rows.push(...found.map(({ row }) => `${table}: ${row}`));
    }
    return { tables, rows: rows.join('\n') };
  }

  // Whether a table holds a row whose text has every one of `parts`.
  function holds(rows: string, table: string, ...parts: string[]): boolean {
    return rows
      .split('\n')
      .some(
        (row) =>
          row.startsWith(`${table}: `) &&
          parts.every((part) => row.includes(part)),
      );
  }

  test('no secret of a whole connection is logged, sent to Sentry, or stored readable', async function (assert) {
    let who = await user();
    let values = {} as {
      interactionId: string;
      ticket: string;
      code: string;
      tokens: OAuthTokenResponse;
      refreshed: OAuthTokenResponse;
      errorReference: string;
      clientId: string;
      grantId: string;
      secondClientId: string;
      secondCode: string;
      secondTokens: OAuthTokenResponse;
      secondGrantId: string;
    };
    // The tables as they stood at each step, read while that step's values
    // are still stored: ending a grant deletes its tokens, and finishing a
    // flow takes its ticket and decision.
    let snapshots = new Map<string, string>();
    async function snapshot(step: string) {
      snapshots.set(step, (await storedRows()).rows);
    }

    let telemetry = await telemetryDuring(async () => {
      // The first app: registered, authorized, consented to, finished,
      // exchanged, refreshed, used, and revoked by the app.
      values.clientId = await registerOAuthClient(server!, {
        clientName: 'Secrecy App',
      });
      let browser = supertest.agent(server!);
      values.interactionId = await startOAuthFlow(browser, values.clientId, {
        resources: [RESOURCE],
        codeChallenge: OAUTH_TEST_CODE_CHALLENGE,
      });
      await snapshot('started');
      let details = await supertest(server!)
        .get(`/_oauth-provider/consent/${values.interactionId}`)
        .set('Host', HOST)
        .set('Origin', SECURE_ORIGIN)
        .set('Authorization', who.session);
      assert.strictEqual(details.status, 200, 'consent shows its details');
      values.ticket = await decideOAuthFlow(
        server!,
        values.interactionId,
        who.session,
      );
      await snapshot('decided');
      values.code = await finishOAuthFlow(
        browser,
        values.interactionId,
        values.ticket,
      );
      await snapshot('finished');
      values.tokens = exchanged(
        await exchangeOAuthCode(server!, values.clientId, values.code),
      );
      values.grantId = await grantOf(values.tokens.access_token);
      values.refreshed = exchanged(
        await refreshOAuthTokens(
          server!,
          values.clientId,
          values.tokens.refresh_token!,
        ),
      );
      let call = await supertest(server!)
        .get('/test-secrecy/read')
        .set('Host', HOST)
        .set('Authorization', `Bearer ${values.refreshed.access_token}`);
      assert.strictEqual(call.status, 200, 'the access token makes a call');
      await snapshot('refreshed');
      let revoked = await revokeOAuthToken(server!, {
        client_id: values.clientId,
        token: values.refreshed.refresh_token,
      });
      assert.strictEqual(revoked.status, 200, 'the app revokes its tokens');
      let afterRevoke = await supertest(server!)
        .get('/test-secrecy/read')
        .set('Host', HOST)
        .set('Authorization', `Bearer ${values.refreshed.access_token}`);
      assert.strictEqual(afterRevoke.status, 401, 'which then fail');

      // A flow the provider refuses, which sends the browser to the
      // authorize page with an error reference the page then reads.
      let refused = await supertest(server!)
        .get(
          `/_oauth-provider/auth?${new URLSearchParams({
            client_id: values.clientId,
            response_type: 'code',
            redirect_uri: OAUTH_TEST_WEB_REDIRECT_URI,
            scope: 'boxel:read',
            resource: RESOURCE,
            state: OAUTH_TEST_STATE,
            code_challenge: OAUTH_TEST_CODE_CHALLENGE,
            code_challenge_method: 'S256',
            prompt: 'none',
          })}`,
        )
        .set('Host', HOST);
      let reference = new URL(
        refused.headers.location ?? 'http://none/',
      ).searchParams.get('error');
      if (!reference) {
        throw new Error(`no error reference: ${refused.headers.location}`);
      }
      values.errorReference = reference;
      await snapshot('refused');
      let error = await supertest(server!)
        .get(`/_oauth-provider/error/${values.errorReference}`)
        .set('Host', HOST)
        .set('Origin', SECURE_ORIGIN);
      assert.strictEqual(error.status, 200, 'the authorize page reads it');

      // The second app: connected, then disconnected by the user through
      // the route Connected apps calls.
      values.secondClientId = await registerOAuthClient(server!, {
        clientName: 'Second Secrecy App',
      });
      values.secondCode = await codeForOAuthClient(
        server!,
        values.secondClientId,
        who.session,
        { resources: [RESOURCE] },
      );
      values.secondTokens = exchanged(
        await exchangeOAuthCode(
          server!,
          values.secondClientId,
          values.secondCode,
        ),
      );
      values.secondGrantId = await grantOf(values.secondTokens.access_token);
      await snapshot('second connected');
      let disconnected = await supertest(server!)
        .delete(`/_oauth-provider/connections/${values.secondGrantId}`)
        .set('Host', HOST)
        .set('Origin', SECURE_ORIGIN)
        .set('Authorization', who.session);
      assert.strictEqual(disconnected.status, 204, 'the user disconnects it');
    });

    let secrets: Record<string, string> = {
      'interaction ID': values.interactionId,
      ticket: values.ticket,
      code: values.code,
      'PKCE verifier': OAUTH_TEST_CODE_VERIFIER,
      'access token': values.tokens.access_token,
      'refresh token': values.tokens.refresh_token!,
      'refreshed access token': values.refreshed.access_token,
      'refreshed refresh token': values.refreshed.refresh_token!,
      'error reference': values.errorReference,
      "second app's code": values.secondCode,
      "second app's access token": values.secondTokens.access_token,
      "second app's refresh token": values.secondTokens.refresh_token!,
    };
    assertNoSecrets(assert, telemetry, secrets);
    // A grant ID is no secret, and is stored, but the provider's telemetry
    // never names one (`grant ended` names the client).
    assertNoSecrets(assert, telemetry, {
      'grant ID': values.grantId,
      "second app's grant ID": values.secondGrantId,
    });

    let { tables, rows } = await storedRows();
    snapshots.set('end', rows);
    for (let table of [
      'oauth_provider_dynamic_clients',
      'oauth_provider_grants',
      'oauth_provider_objects',
      'oauth_provider_tokens',
    ]) {
      assert.true(tables.includes(table), `${table} is checked`);
    }
    assert.true(rows.includes(values.grantId), 'the rows checked hold a grant');
    assert.true(
      rows.includes(values.secondGrantId),
      "and the second app's grant",
    );
    // Each snapshot holds the rows its step's values live in, so the checks
    // below can't pass on tables already emptied.
    let stored: [string, string, string[]][] = [
      ['started', 'oauth_provider_objects', ['(Interaction,']],
      ['decided', 'oauth_provider_objects', ['(ConsentTicket,']],
      ['finished', 'oauth_provider_objects', ['(AuthorizationCode,']],
      [
        'refreshed',
        'oauth_provider_tokens',
        [',AccessToken,', `,${values.grantId},`],
      ],
      [
        'refreshed',
        'oauth_provider_tokens',
        [',RefreshToken,', `,${values.grantId},`],
      ],
      ['refused', 'oauth_provider_objects', ['(ErrorReference,']],
      [
        'second connected',
        'oauth_provider_tokens',
        [',AccessToken,', `,${values.secondGrantId},`],
      ],
    ];
    for (let [step, table, parts] of stored) {
      assert.true(
        holds(snapshots.get(step)!, table, ...parts),
        `${step}: ${table} holds ${parts.join(' ')}`,
      );
    }
    for (let [step, stepRows] of snapshots) {
      for (let [name, value] of Object.entries(secrets)) {
        assert.false(
          stepRows.includes(value),
          `${step}: no row holds the ${name}`,
        );
      }
    }

    // The capture saw the flow, so the checks above can't pass on an
    // empty log.
    for (let line of [
      'consent shown:',
      `grant ended: client, client ${values.clientId}`,
      `grant ended: user, client ${values.secondClientId}`,
    ]) {
      assert.true(telemetry.logs.includes(line), `the log has "${line}"`);
    }
    assert.true(
      telemetry.transactions.length > 0,
      'Sentry was sent the requests',
    );
  });
});
