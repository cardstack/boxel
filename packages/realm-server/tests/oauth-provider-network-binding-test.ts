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
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  OAUTH_TEST_CODE_CHALLENGE,
  OAUTH_TEST_CODE_VERIFIER,
  OAUTH_TEST_SERVER_URL,
  OAUTH_TEST_WEB_REDIRECT_URI,
  decideOAuthFlow,
  exchangeOAuthCode,
  finishOAuthFlow,
  startOAuthFlow,
  startOAuthProviderServer,
  tokenRequest,
  type OAuthRequester,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { logLinesDuring } from './helpers/log-capture.ts';
import {
  oauthEvents,
  readableMessage,
} from './helpers/oauth-provider-events.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { FINISH_NETWORK_TTL_SECONDS } from '../lib/oauth-provider/objects.ts';
import { BOXEL_CLI_CLIENT_ID } from '../lib/oauth-provider/pre-registered-clients.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const CLI_REDIRECT_URI = 'http://127.0.0.1:51234/callback';

// The sentences captured lines give an operator, an event line's `message`
// among them.
function readableLines(logs: string): string[] {
  return logs.split('\n').map(readableMessage);
}

// Addresses from the documentation ranges (RFC 5737, RFC 3849).
const HOME = '203.0.113.17';
const HOME_OTHER_HOST = '203.0.113.200';
const ELSEWHERE = '198.51.100.9';
const HOME_V6 = '2001:db8:1234:1::17';
const HOME_V6_OTHER_SUBNET = '2001:db8:1234:ff::99';
const ELSEWHERE_V6 = '2001:db8:9999::1';

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_network', {
    trustedProxyHops: 1,
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

  // A secure window session's `Authorization` header, for a new user.
  async function session(): Promise<string> {
    let matrixId = `@network-${randomBytes(6).toString('hex')}:localhost`;
    await insertUser(db, matrixId, `cus_${matrixId}`, null);
    return await secureSessionAuth(db, matrixId);
  }

  // A browser at `address`: it keeps the cookies the provider sets.
  function browserAt(address: string): OAuthRequester {
    let agent = supertest.agent(server!);
    return {
      get: (url) => agent.get(url).set('X-Forwarded-For', address),
    };
  }

  // Runs a flow in a browser at `address`, the user allowing it, and
  // answers the code the app is sent.
  async function codeFinishedAt(
    address: string,
    clientId: string,
    {
      redirectUri,
      confirmationCode,
    }: { redirectUri: string; confirmationCode?: string },
  ): Promise<string> {
    let browser = browserAt(address);
    let uid = await startOAuthFlow(browser, clientId, {
      redirectUri,
      codeChallenge: OAUTH_TEST_CODE_CHALLENGE,
      confirmationCode,
    });
    let ticket = await decideOAuthFlow(server!, uid, await session());
    return await finishOAuthFlow(browser, uid, ticket);
  }

  function cliCodeFinishedAt(address: string): Promise<string> {
    return codeFinishedAt(address, BOXEL_CLI_CLIENT_ID, {
      redirectUri: CLI_REDIRECT_URI,
      confirmationCode: 'WDJB-MJHT',
    });
  }

  function cliExchangeFrom(address: string, code: string) {
    return exchangeOAuthCode(server!, BOXEL_CLI_CLIENT_ID, code, {
      redirectUri: CLI_REDIRECT_URI,
    }).set('X-Forwarded-For', address);
  }

  async function finishNetworks(): Promise<
    { payload: Record<string, unknown>; lasts_seconds: number }[]
  > {
    return (await db.execute(
      `SELECT payload,
              extract(epoch FROM expires_at - now())::int AS lasts_seconds
         FROM oauth_provider_objects WHERE kind = 'FinishNetwork'`,
    )) as { payload: Record<string, unknown>; lasts_seconds: number }[];
  }

  // The `token issued` line of a boxel-cli exchange from `exchangedFrom` of a
  // code whose flow finished at `finishedAt`.
  async function issuedLine(
    assert: Assert,
    finishedAt: string,
    exchangedFrom: string,
  ): Promise<string | undefined> {
    let code = await cliCodeFinishedAt(finishedAt);
    let status = 0;
    let telemetry = await telemetryDuring(async () => {
      status = (await cliExchangeFrom(exchangedFrom, code)).status;
    });
    assert.strictEqual(status, 200, 'the exchange succeeds whatever matched');
    return readableLines(telemetry.logs).find((line) =>
      line.startsWith('token issued:'),
    );
  }

  test('the finish of a boxel-cli flow records its network, for two minutes at most', async function (assert) {
    let code = await cliCodeFinishedAt(HOME);
    let [recorded, ...others] = await finishNetworks();
    assert.strictEqual(others.length, 0, 'one record');
    assert.deepEqual(
      recorded.payload,
      { family: 4, network: '203.0.113.0/24' },
      "the browser's network and its family, not its address",
    );
    let keptForAWhile =
      recorded.lasts_seconds > 0 &&
      recorded.lasts_seconds <= FINISH_NETWORK_TTL_SECONDS;
    assert.true(
      keptForAWhile,
      `kept no longer than ${FINISH_NETWORK_TTL_SECONDS}s (${recorded.lasts_seconds}s)`,
    );
    let exchanged = await cliExchangeFrom(HOME, code);
    assert.strictEqual(exchanged.status, 200, exchanged.text);
  });

  test('an exchange from another address in the same IPv4 /24 is logged as the same network', async function (assert) {
    assert.strictEqual(
      await issuedLine(assert, HOME, HOME_OTHER_HOST),
      'token issued: client boxel-cli, network same',
    );
  });

  test('an exchange from another IPv4 network is logged as another network, and still succeeds', async function (assert) {
    assert.strictEqual(
      await issuedLine(assert, HOME, ELSEWHERE),
      'token issued: client boxel-cli, network other',
    );
  });

  test('the token-issued event carries the comparison as networkMatch, and neither network', async function (assert) {
    let code = await cliCodeFinishedAt(HOME);
    let lines = await logLinesDuring(['boxel:oauth-provider'], async () => {
      let exchanged = await cliExchangeFrom(ELSEWHERE, code);
      assert.strictEqual(exchanged.status, 200, exchanged.text);
    });
    let issued = oauthEvents(lines).filter(
      ({ event }) => event === 'token-issued',
    );
    assert.strictEqual(issued.length, 1, 'one token-issued event');
    assert.strictEqual(issued[0].networkMatch, 'other');
    assert.strictEqual(issued[0].client, 'boxel-cli');
    assert.false('network' in issued[0], 'no network pseudonym');
  });

  test('IPv6 addresses compare by their /48', async function (assert) {
    assert.strictEqual(
      await issuedLine(assert, HOME_V6, HOME_V6_OTHER_SUBNET),
      'token issued: client boxel-cli, network same',
      'another /64 in the same /48',
    );
    assert.strictEqual(
      await issuedLine(assert, HOME_V6, ELSEWHERE_V6),
      'token issued: client boxel-cli, network other',
      'another /48',
    );
  });

  test('a finish and an exchange of different address families are logged as such', async function (assert) {
    assert.strictEqual(
      await issuedLine(assert, HOME_V6, HOME),
      'token issued: client boxel-cli, network other-family',
    );
  });

  test("an exchange the library refuses doesn't spend the record, so the one that follows still compares", async function (assert) {
    let code = await cliCodeFinishedAt(HOME);
    // With no `redirect_uri`, Boxel's check finds the code's grant, and the
    // library refuses the exchange without spending the code.
    let refused = await tokenRequest(server!, {
      grant_type: 'authorization_code',
      client_id: BOXEL_CLI_CLIENT_ID,
      code,
      code_verifier: OAUTH_TEST_CODE_VERIFIER,
    }).set('X-Forwarded-For', ELSEWHERE);
    assert.strictEqual(refused.status, 400, refused.text);
    assert.strictEqual(
      (await finishNetworks()).length,
      1,
      'the record is still there',
    );
    let telemetry = await telemetryDuring(async () => {
      let exchanged = await cliExchangeFrom(ELSEWHERE, code);
      assert.strictEqual(exchanged.status, 200, exchanged.text);
    });
    assert.true(
      readableLines(telemetry.logs).includes(
        'token issued: client boxel-cli, network other',
      ),
      telemetry.logs,
    );
  });

  test('an exchange with no recorded network is logged as unknown', async function (assert) {
    let code = await cliCodeFinishedAt(HOME);
    await db.execute(
      `DELETE FROM oauth_provider_objects WHERE kind = 'FinishNetwork'`,
    );
    let telemetry = await telemetryDuring(async () => {
      let exchanged = await cliExchangeFrom(HOME, code);
      assert.strictEqual(exchanged.status, 200, exchanged.text);
    });
    assert.true(
      readableLines(telemetry.logs).includes(
        'token issued: client boxel-cli, network unknown',
      ),
      telemetry.logs,
    );
  });

  test("a client that isn't a pre-registered app on the user's computer records no network, and its exchange says nothing of one", async function (assert) {
    let registered = await supertest(server!)
      .post('/_oauth-provider/reg')
      .set('Host', OAUTH_TEST_SERVER_URL.host)
      .set('X-Forwarded-For', HOME)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          client_name: 'Test App',
          redirect_uris: [OAUTH_TEST_WEB_REDIRECT_URI],
        }),
      );
    assert.strictEqual(registered.status, 201, registered.text);
    let clientId = registered.body.client_id as string;
    let code = await codeFinishedAt(HOME, clientId, {
      redirectUri: OAUTH_TEST_WEB_REDIRECT_URI,
    });
    assert.deepEqual(await finishNetworks(), [], 'nothing recorded');
    let telemetry = await telemetryDuring(async () => {
      let exchanged = await exchangeOAuthCode(server!, clientId, code).set(
        'X-Forwarded-For',
        ELSEWHERE,
      );
      assert.strictEqual(exchanged.status, 200, exchanged.text);
    });
    assert.true(
      readableLines(telemetry.logs).includes(
        `token issued: client ${clientId}`,
      ),
      telemetry.logs,
    );
  });

  // A Sentry event's request context keeps the request's own headers other
  // than credentials (`lib/request-telemetry.ts`), the caller's address among
  // them, as for every request; the recorded network is never sent.
  test('no network is logged or sent to Sentry, and no address is logged', async function (assert) {
    let telemetry = await telemetryDuring(async () => {
      let code = await cliCodeFinishedAt(HOME);
      let exchanged = await cliExchangeFrom(ELSEWHERE, code);
      assert.strictEqual(exchanged.status, 200, exchanged.text);
    });
    assert.true(
      telemetry.logs.includes('network other'),
      'precondition: the comparison was logged',
    );
    assertNoSecrets(assert, telemetry, {
      "browser's network": '203.0.113.0',
      "app's network": '198.51.100.0',
    });
    for (let address of [HOME, ELSEWHERE]) {
      assert.false(
        telemetry.logs.includes(address),
        `no log line carries ${address}`,
      );
    }
  });
});
