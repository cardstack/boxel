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
import { testOAuthSecureOriginURL } from './helpers/oauth-provider.ts';
import {
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_MCP,
  OAUTH_TEST_SERVER_URL,
  OAUTH_TEST_STATE,
  OAUTH_TEST_WEB_REDIRECT_URI,
  registerOAuthClient,
  startOAuthFlow,
  startOAuthProviderServer,
  type OAuthRequester,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { authorizePageURL } from '../lib/oauth-provider/authorization.ts';
import { InteractionAdapter } from '../lib/oauth-provider/objects.ts';
import {
  NON_RENEWING_GRANT_TTL_SECONDS,
  RENEWING_GRANT_TTL_SECONDS,
} from '../lib/oauth-provider/grants.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const serverURL = OAUTH_TEST_SERVER_URL;
const SECURE_ORIGIN = testOAuthSecureOriginURL.origin;
const AUTHORIZE_PAGE = authorizePageURL(testOAuthSecureOriginURL).href;
const EXPIRED_PAGE = `${AUTHORIZE_PAGE}?error=expired`;
const RESUME_PREFIX = `${OAUTH_TEST_ISSUER}/_oauth-provider/auth/`;

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_finish');
}

// The parts of a URL a browser was sent to.
function sentTo(location: string | undefined): URL {
  if (!location) {
    throw new Error('the browser was not sent on');
  }
  return new URL(location);
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

  interface TestUser {
    // The Matrix user ID the secure session names.
    matrixId: string;
    // The internal ID (`users.id`) a grant stores.
    id: string;
    // The secure window session's `Authorization` header.
    session: string;
  }

  // A user with a row in `users` and a secure window session.
  async function user(): Promise<TestUser> {
    let matrixId = `@finish-${randomBytes(6).toString('hex')}:localhost`;
    let { id } = await insertUser(db, matrixId, `cus_${matrixId}`, null);
    return { matrixId, id, session: await secureSessionAuth(db, matrixId) };
  }

  // A browser: it keeps the cookies the provider sets.
  function browser(): OAuthRequester {
    return supertest.agent(server!);
  }

  function register(options?: Parameters<typeof registerOAuthClient>[1]) {
    return registerOAuthClient(server!, options);
  }

  // The user's decision on a flow, posted by the authorize page under their
  // secure session, and the ticket it answers.
  async function decide(
    uid: string,
    { session }: TestUser,
    {
      decision = 'allow',
      renew = true,
    }: { decision?: string; renew?: boolean } = {},
  ): Promise<string> {
    let response = await supertest(server!)
      .post(`/_oauth-provider/consent/${uid}`)
      .set('Host', serverURL.host)
      .set('Origin', SECURE_ORIGIN)
      .set('Authorization', session)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ decision, renew }));
    if (response.status !== 201) {
      throw new Error(`the decision wasn't recorded: ${response.status}`);
    }
    return response.body.ticket as string;
  }

  function finishRequest(
    requester: OAuthRequester,
    uid: string,
    query: Record<string, string> | string,
  ) {
    let search =
      typeof query === 'string' ? query : new URLSearchParams(query).toString();
    return requester
      .get(`/_oauth-provider/interaction/${uid}/finish?${search}`)
      .set('Host', serverURL.host);
  }

  // Finishes a flow in a browser and follows the library's resume, as a
  // browser does: answers where the browser ends up, and both responses.
  async function finishAndFollow(
    requester: OAuthRequester,
    uid: string,
    query: Record<string, string> | string,
  ) {
    let finished = await finishRequest(requester, uid, query);
    let location = finished.headers.location as string | undefined;
    if (finished.status !== 303 || !location?.startsWith(RESUME_PREFIX)) {
      return { finished, resumed: undefined, landed: location };
    }
    let resumed = await requester
      .get(new URL(location).pathname)
      .set('Host', serverURL.host);
    return {
      finished,
      resumed,
      landed: resumed.headers.location as string | undefined,
    };
  }

  // Asserts the browser was sent to the app with a code, and answers it.
  function codeFrom(assert: Assert, landed: string | undefined): string {
    let url = sentTo(landed);
    assert.strictEqual(
      `${url.origin}${url.pathname}`,
      OAUTH_TEST_WEB_REDIRECT_URI,
      'the browser goes back to the app',
    );
    assert.strictEqual(url.searchParams.get('state'), OAUTH_TEST_STATE);
    assert.strictEqual(
      url.searchParams.get('iss'),
      OAUTH_TEST_ISSUER,
      'the response names the issuer',
    );
    let code = url.searchParams.get('code');
    assert.ok(code, 'with a code');
    return code!;
  }

  async function grants() {
    return (await db.execute(
      `SELECT user_id, client_id, resources, renewing,
              extract(epoch FROM expires_at - created_at)::float AS lifetime
         FROM oauth_provider_grants ORDER BY created_at`,
    )) as {
      user_id: string;
      client_id: string;
      resources: Record<string, string[]>;
      renewing: boolean;
      lifetime: number;
    }[];
  }

  // The account each stored authorization code was issued to.
  async function codeAccounts(): Promise<string[]> {
    let rows = (await db.execute(
      `SELECT payload->>'accountId' AS account FROM oauth_provider_objects
         WHERE kind = 'AuthorizationCode' ORDER BY created_at`,
    )) as { account: string }[];
    return rows.map(({ account }) => account);
  }

  async function rawObjects(): Promise<string> {
    let rows = await db.execute(
      `SELECT kind, encode(id_hash, 'hex') AS id_hash, payload::text AS payload
         FROM oauth_provider_objects`,
    );
    return JSON.stringify(rows);
  }

  module('the browser that started the flow', function () {
    test('Allow finishes the flow there, with a code for the user who decided', async function (assert) {
      let ada = await user();
      let clientId = await register();
      let app = browser();
      let uid = await startOAuthFlow(app, clientId);
      let ticket = await decide(uid, ada);

      let { finished, resumed, landed } = await finishAndFollow(app, uid, {
        ticket,
      });
      assert.strictEqual(finished.status, 303);
      assert.strictEqual(finished.headers['referrer-policy'], 'no-referrer');
      assert.strictEqual(finished.headers['cache-control'], 'no-store');
      assert.strictEqual(
        finished.headers.location,
        `${RESUME_PREFIX}${uid}`,
        'the finish hands the flow back to the library',
      );
      assert.strictEqual(resumed?.status, 303);
      assert.strictEqual(
        resumed?.headers['referrer-policy'],
        'no-referrer',
        'the response that carries the code sends no referrer',
      );
      codeFrom(assert, landed);
      assert.deepEqual(
        await codeAccounts(),
        [ada.id],
        "the code is the user's, by their internal ID",
      );
      let [grant, ...others] = await grants();
      assert.strictEqual(others.length, 0, 'one grant');
      assert.strictEqual(grant.user_id, ada.id, 'the grant names users.id');
      assert.notStrictEqual(grant.user_id, ada.matrixId);
      assert.strictEqual(grant.client_id, clientId);
      assert.deepEqual(grant.resources, { [OAUTH_TEST_MCP]: ['boxel:read'] });
    });

    test('a ticket presented without the cookie is spent, and refused afterwards with it', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      let ticket = await decide(uid, ada);

      let elsewhere = await finishRequest(browser(), uid, { ticket });
      assert.strictEqual(elsewhere.status, 303);
      assert.strictEqual(
        elsewhere.headers.location,
        EXPIRED_PAGE,
        'without the cookie the flow ends on the expired page',
      );
      assert.strictEqual(elsewhere.headers['referrer-policy'], 'no-referrer');

      let { landed } = await finishAndFollow(app, uid, { ticket });
      assert.strictEqual(
        landed,
        EXPIRED_PAGE,
        'the browser holding the cookie can no longer use the ticket',
      );
      assert.deepEqual(await grants(), [], 'no grant');
      assert.deepEqual(await codeAccounts(), [], 'no code');
    });

    test('the browser holding the cookie can’t finish without the ticket', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      let ticket = await decide(uid, ada);

      for (let [name, query] of [
        ['no ticket', ''],
        ['an empty ticket', 'ticket='],
        ['a made-up ticket', `ticket=${randomBytes(32).toString('base64url')}`],
      ] as const) {
        let response = await finishRequest(app, uid, query);
        assert.strictEqual(response.headers.location, EXPIRED_PAGE, name);
      }
      assert.deepEqual(await grants(), [], 'no grant yet');

      let { landed } = await finishAndFollow(app, uid, { ticket });
      codeFrom(assert, landed);
    });

    test('a ticket works once', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      let ticket = await decide(uid, ada);
      codeFrom(assert, (await finishAndFollow(app, uid, { ticket })).landed);

      let again = await finishRequest(app, uid, { ticket });
      assert.strictEqual(again.headers.location, EXPIRED_PAGE);
      assert.strictEqual((await grants()).length, 1, 'still one grant');
    });

    test('the cookie, the route and the ticket must name the same flow', async function (assert) {
      let ada = await user();
      let clientId = await register();
      let app = browser();
      let first = await startOAuthFlow(app, clientId);
      let second = await startOAuthFlow(app, clientId);
      let firstTicket = await decide(first, ada);
      let secondTicket = await decide(second, ada);

      // The browser has a cookie for each flow, each for its own route.
      let crossed = await finishRequest(app, first, { ticket: secondTicket });
      assert.strictEqual(
        crossed.headers.location,
        EXPIRED_PAGE,
        "another flow's ticket doesn't finish this one",
      );

      // A browser whose cookie names another flow, on this flow's route.
      let other = supertest(server!);
      let started = await other
        .get(
          `/_oauth-provider/auth?${new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: OAUTH_TEST_WEB_REDIRECT_URI,
            scope: 'boxel:read',
            resource: OAUTH_TEST_MCP,
            code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
            code_challenge_method: 'S256',
          })}`,
        )
        .set('Host', serverURL.host);
      let otherCookies = ([] as string[])
        .concat(started.headers['set-cookie'] ?? [])
        .filter((cookie) => /^_interaction(\.sig)?=/.test(cookie))
        .map((cookie) => cookie.split(';')[0]);
      assert.strictEqual(
        otherCookies.length,
        2,
        'the cookie and its signature',
      );
      let wrongCookie = await other
        .get(
          `/_oauth-provider/interaction/${first}/finish?ticket=${firstTicket}`,
        )
        .set('Host', serverURL.host)
        .set('Cookie', otherCookies.join('; '));
      assert.strictEqual(
        wrongCookie.headers.location,
        EXPIRED_PAGE,
        "a cookie for another flow doesn't finish this one",
      );

      // Both tickets were spent on those attempts.
      for (let [uid, ticket] of [
        [first, firstTicket],
        [second, secondTicket],
      ]) {
        let { landed } = await finishAndFollow(app, uid, { ticket });
        assert.strictEqual(landed, EXPIRED_PAGE, 'a spent ticket stays spent');
      }
      assert.deepEqual(await grants(), [], 'no grant');
    });

    test('a decision made in another browser finishes the flow in neither', async function (assert) {
      let victim = await user();
      let attacker = browser();
      let uid = await startOAuthFlow(attacker, await register());
      // The victim opens the attacker's link and allows it.
      let ticket = await decide(uid, victim);

      let victimFinish = await finishAndFollow(browser(), uid, { ticket });
      assert.strictEqual(victimFinish.landed, EXPIRED_PAGE, "victim's browser");
      let attackerFinish = await finishAndFollow(attacker, uid, '');
      assert.strictEqual(
        attackerFinish.landed,
        EXPIRED_PAGE,
        "attacker's browser, without the ticket",
      );
      let attackerWithTicket = await finishAndFollow(attacker, uid, { ticket });
      assert.strictEqual(
        attackerWithTicket.landed,
        EXPIRED_PAGE,
        "attacker's browser, with the ticket copied after the victim used it",
      );
      assert.deepEqual(await grants(), [], 'no grant');
      assert.deepEqual(await codeAccounts(), [], 'no code');
    });
  });

  module('outcomes', function () {
    test('Deny sends the app access_denied', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      let ticket = await decide(uid, ada, { decision: 'deny' });

      let { landed } = await finishAndFollow(app, uid, { ticket });
      let url = sentTo(landed);
      assert.strictEqual(
        `${url.origin}${url.pathname}`,
        OAUTH_TEST_WEB_REDIRECT_URI,
      );
      assert.strictEqual(url.searchParams.get('error'), 'access_denied');
      assert.strictEqual(url.searchParams.get('state'), OAUTH_TEST_STATE);
      assert.strictEqual(url.searchParams.get('iss'), OAUTH_TEST_ISSUER);
      assert.false(url.searchParams.has('code'), 'no code');
      assert.deepEqual(await grants(), [], 'no grant');
    });

    test('Cancel needs only the cookie, and sends the app access_denied', async function (assert) {
      let app = browser();
      let uid = await startOAuthFlow(app, await register());

      let elsewhere = await finishRequest(browser(), uid, { cancel: '1' });
      assert.strictEqual(
        elsewhere.headers.location,
        EXPIRED_PAGE,
        'not without the cookie',
      );

      let { landed } = await finishAndFollow(app, uid, { cancel: '1' });
      let url = sentTo(landed);
      assert.strictEqual(
        `${url.origin}${url.pathname}`,
        OAUTH_TEST_WEB_REDIRECT_URI,
      );
      assert.strictEqual(url.searchParams.get('error'), 'access_denied');
      assert.deepEqual(await grants(), [], 'no grant');
    });

    test('a cancel spends a ticket it carries', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      let ticket = await decide(uid, ada);
      let cancelled = await finishRequest(browser(), uid, {
        cancel: '1',
        ticket,
      });
      assert.strictEqual(cancelled.headers.location, EXPIRED_PAGE);
      let { landed } = await finishAndFollow(app, uid, { ticket });
      assert.strictEqual(landed, EXPIRED_PAGE);
    });

    test('each consent is its own grant, with its own scopes and expiry', async function (assert) {
      let ada = await user();
      let clientId = await register();
      let app = browser();

      let first = await startOAuthFlow(app, clientId);
      codeFrom(
        assert,
        (
          await finishAndFollow(app, first, {
            ticket: await decide(first, ada, { renew: true }),
          })
        ).landed,
      );
      let second = await startOAuthFlow(app, clientId, {
        scope: 'boxel:read boxel:write',
      });
      codeFrom(
        assert,
        (
          await finishAndFollow(app, second, {
            ticket: await decide(second, ada, { renew: false }),
          })
        ).landed,
      );

      let [renewing, shortLived, ...others] = await grants();
      assert.strictEqual(others.length, 0, 'two grants');
      assert.deepEqual(renewing.resources, {
        [OAUTH_TEST_MCP]: ['boxel:read'],
      });
      assert.true(renewing.renewing);
      assert.strictEqual(
        Math.round(renewing.lifetime),
        RENEWING_GRANT_TTL_SECONDS,
        'a renewing grant lasts 30 days',
      );
      assert.deepEqual(shortLived.resources, {
        [OAUTH_TEST_MCP]: ['boxel:read', 'boxel:write'],
      });
      assert.false(shortLived.renewing);
      assert.strictEqual(
        Math.round(shortLived.lifetime),
        NON_RENEWING_GRANT_TTL_SECONDS,
        'a grant that does not renew lasts 60 minutes',
      );
    });
  });

  module('switching users in one browser', function () {
    test('after the secure session changes user, the next flow gets a code for the new user', async function (assert) {
      let ada = await user();
      let bea = await user();
      let clientId = await register();
      let app = browser();

      let first = await startOAuthFlow(app, clientId);
      codeFrom(
        assert,
        (
          await finishAndFollow(app, first, {
            ticket: await decide(first, ada),
          })
        ).landed,
      );
      let second = await startOAuthFlow(app, clientId);
      let { resumed, landed } = await finishAndFollow(app, second, {
        ticket: await decide(second, bea),
      });
      assert.strictEqual(
        resumed?.status,
        303,
        "no page of the library's own, such as its logout confirmation",
      );
      codeFrom(assert, landed);
      assert.deepEqual(
        await codeAccounts(),
        [ada.id, bea.id],
        "the second code is the new user's, never the first's",
      );
      assert.deepEqual(
        (await grants()).map(({ user_id }) => user_id),
        [ada.id, bea.id],
      );
    });

    test('two flows started at once finish for the users who decided them', async function (assert) {
      let ada = await user();
      let bea = await user();
      let clientId = await register();
      let app = browser();

      let first = await startOAuthFlow(app, clientId);
      let second = await startOAuthFlow(app, clientId);
      let firstTicket = await decide(first, ada);
      let secondTicket = await decide(second, bea);
      codeFrom(
        assert,
        (await finishAndFollow(app, first, { ticket: firstTicket })).landed,
      );
      let { resumed, landed } = await finishAndFollow(app, second, {
        ticket: secondTicket,
      });
      assert.strictEqual(
        resumed?.status,
        303,
        "the first flow's login doesn't make the library ask to log out",
      );
      codeFrom(assert, landed);
      assert.deepEqual(await codeAccounts(), [ada.id, bea.id]);
    });
  });

  module('the resume route', function () {
    test('a resume URL used again ends on the error page, never the library’s JSON', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      let { finished } = await finishAndFollow(app, uid, {
        ticket: await decide(uid, ada),
      });

      let again = await app
        .get(new URL(finished.headers.location).pathname)
        .set('Host', serverURL.host);
      assert.strictEqual(again.status, 303);
      let url = sentTo(again.headers.location);
      assert.strictEqual(
        `${url.origin}${url.pathname}`,
        AUTHORIZE_PAGE,
        "the browser goes to Boxel's error page",
      );
      assert.ok(url.searchParams.get('error'), 'with an error reference');
    });
  });

  module('secrets', function () {
    test('no code, session, ticket or interaction ID is stored readable or logged', async function (assert) {
      let ada = await user();
      let clientId = await register();
      let app = browser();
      let uid = '';
      let ticket = '';
      let code = '';
      let sessionCookie = '';
      let telemetry = await telemetryDuring(async () => {
        uid = await startOAuthFlow(app, clientId);
        ticket = await decide(uid, ada);
        let { resumed, landed } = await finishAndFollow(app, uid, { ticket });
        code = sentTo(landed).searchParams.get('code') ?? '';
        // The resume response first expires any session the browser
        // brought, then sets the new one.
        sessionCookie =
          ([] as string[])
            .concat(resumed?.headers['set-cookie'] ?? [])
            .map((cookie) => /^_session=([^;]*)/.exec(cookie)?.[1] ?? '')
            .filter(Boolean)
            .pop() ?? '';
      });
      assert.ok(code, 'precondition: a code was issued');
      assert.ok(sessionCookie, "precondition: the library's session was set");
      assert.true(
        telemetry.logs.includes('/_oauth-provider/interaction/:uid/finish'),
        'the request log names the finish route by its label',
      );
      assert.true(
        telemetry.logs.includes('/_oauth-provider/auth/:uid'),
        'and the resume route',
      );
      assert.true(
        telemetry.logs.includes('flow finished: allowed'),
        'finished flows are logged',
      );
      assertNoSecrets(assert, telemetry, {
        'interaction ID': uid,
        ticket,
        code,
        'session cookie': sessionCookie,
      });

      let stored = await rawObjects();
      for (let kind of ['Session', 'AuthorizationCode']) {
        assert.true(stored.includes(kind), `precondition: a ${kind} is stored`);
      }
      assert.false(stored.includes(code), 'no row holds the code');
      assert.false(stored.includes(sessionCookie), 'no row holds the session');
      assert.false(stored.includes(ticket), 'no row holds the ticket');
      assert.false(stored.includes(uid), 'no row holds the interaction ID');
    });

    test('a code lives a minute', async function (assert) {
      let ada = await user();
      let app = browser();
      let uid = await startOAuthFlow(app, await register());
      codeFrom(
        assert,
        (await finishAndFollow(app, uid, { ticket: await decide(uid, ada) }))
          .landed,
      );
      let [{ lifetime }] = (await db.execute(
        `SELECT extract(epoch FROM expires_at - created_at)::float AS lifetime
           FROM oauth_provider_objects WHERE kind = 'AuthorizationCode'`,
      )) as { lifetime: number }[];
      assert.strictEqual(Math.round(lifetime), 60);
    });

    test("an interaction never stores a library session's ID", async function (assert) {
      let id = `interaction-${randomBytes(8).toString('hex')}`;
      let sessionId = `session-${randomBytes(8).toString('hex')}`;
      let adapter = new InteractionAdapter(
        db,
        (uid) => `${RESUME_PREFIX}${uid}`,
      );
      await adapter.upsert(
        id,
        {
          params: {},
          session: { accountId: 'someone', uid: 'a-uid', cookie: sessionId },
        },
        60,
      );
      assert.false((await rawObjects()).includes(sessionId));
      let found = await adapter.find(id);
      assert.deepEqual(found?.session, { accountId: 'someone', uid: 'a-uid' });
    });
  });
});
