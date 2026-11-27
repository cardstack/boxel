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
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_SERVER_URL,
  ROOMY_DEVICE_CODE_LIMIT,
  ROOMY_LIMIT,
  ROOMY_TOKEN_LIMIT,
  registerOAuthClient,
  startOAuthProviderServer,
  tokenRequest,
  type OAuthTokenResponse,
} from './helpers/oauth-provider-flow.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { registerUser } from '../synapse.ts';
import { devicePageURL } from '../lib/oauth-provider/authorization.ts';
import type { CallerLimit } from '../lib/oauth-provider/caller-limit.ts';
import type { DeviceCodeLimit } from '../lib/oauth-provider/device.ts';
import type { TokenLimit } from '../lib/oauth-provider/token-limit.ts';
import {
  BOXEL_CLI_CLIENT_ID,
  DEVICE_CODE_GRANT_TYPE,
} from '../lib/oauth-provider/pre-registered-clients.ts';
import { RENEWING_GRANT_TTL_SECONDS } from '../lib/oauth-provider/grants.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const SECURE_ORIGIN = testOAuthSecureOriginURL.origin;
const DEVICE_PAGE = devicePageURL(testOAuthSecureOriginURL).href;
// The Boxel API, which boxel-cli signs in for.
const BOXEL_API = OAUTH_TEST_ISSUER;
const BOXEL_API_SCOPES = 'boxel:read boxel:write';
// Two groups of four consonants, the confirmation code's alphabet.
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let db: PgAdapter;
  let queue: { publisher: QueuePublisher; runner: QueueRunner };

  hooks.before(async function () {
    await ensureMatrixAdminUser();
  });

  function start(
    args: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    },
    limits: {
      authorizationLimit?: CallerLimit;
      deviceCodeLimit?: DeviceCodeLimit;
      tokenLimit?: TokenLimit;
    } = {},
  ): Promise<Server> {
    return startOAuthProviderServer(args, 'realm_server_oauth_device', limits);
  }

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
      queue = { publisher, runner };
      server = await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  async function restartWith(limits: {
    authorizationLimit?: CallerLimit;
    deviceCodeLimit?: DeviceCodeLimit;
    tokenLimit?: TokenLimit;
  }) {
    await closeServer(server!);
    server = undefined;
    server = await start({ dbAdapter: db, ...queue }, limits);
  }

  // Restarts the server on a database where every device code is denied the
  // moment a grant is stored: as when another decision wins the race while
  // an Allow is under way.
  async function restartLosingDecisionsOnGrant() {
    await closeServer(server!);
    server = undefined;
    let losing = new Proxy(db, {
      get(target, property) {
        if (property === 'execute') {
          return async (...args: Parameters<PgAdapter['execute']>) => {
            let result = await target.execute(...args);
            if (/\bINSERT INTO oauth_provider_grants\b/.test(args[0])) {
              await target.execute(
                `UPDATE oauth_provider_objects
                    SET payload = payload || '{"error":"access_denied"}'::jsonb
                  WHERE kind = 'DeviceCode'`,
              );
            }
            return result;
          };
        }
        let value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    server = await start({ dbAdapter: losing, ...queue });
  }

  interface TestUser {
    matrixId: string;
    id: string;
    session: string;
  }

  // A user with a Matrix account (consent shows its name), a row in `users`
  // (a grant stores its ID) and a secure window session.
  async function user(): Promise<TestUser> {
    let username = `device-${randomBytes(6).toString('hex')}`;
    let { userId: matrixId } = await registerUser({
      matrixURL,
      displayname: username,
      username,
      password: `pw-${randomBytes(12).toString('hex')}`,
      registrationSecret: matrixRegistrationSecret,
    });
    let { id } = await insertUser(db, matrixId, `cus_${matrixId}`, null);
    return { matrixId, id, session: await secureSessionAuth(db, matrixId) };
  }

  // A device authorization request, as an app sends one.
  function authorizeDevice(params: Record<string, string>): supertest.Test {
    return supertest(server!)
      .post('/_oauth-provider/device/auth')
      .set('Host', OAUTH_TEST_SERVER_URL.host)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(params).toString());
  }

  // boxel-cli asking for a device code, for the Boxel API.
  async function startDeviceSignIn(): Promise<DeviceAuthorization> {
    let response = await authorizeDevice({
      client_id: BOXEL_CLI_CLIENT_ID,
      scope: BOXEL_API_SCOPES,
      resource: BOXEL_API,
    });
    if (response.status !== 200) {
      throw new Error(
        `no device code: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return response.body as DeviceAuthorization;
  }

  // A request from the `device` page, under a secure window session.
  function fromDevicePage(
    path: 'lookup' | 'decision',
    body: object,
    {
      session,
      origin = SECURE_ORIGIN,
    }: { session?: string; origin?: string | null } = {},
  ): supertest.Test {
    let request = supertest(server!)
      .post(`/_oauth-provider/device/${path}`)
      .set('Host', OAUTH_TEST_SERVER_URL.host)
      .set('Content-Type', 'application/json');
    if (origin !== null) {
      request = request.set('Origin', origin);
    }
    if (session) {
      request = request.set('Authorization', session);
    }
    return request.send(JSON.stringify(body));
  }

  function lookUp(userCode: string, session: string) {
    return fromDevicePage('lookup', { user_code: userCode }, { session });
  }

  function decide(
    userCode: string,
    session: string,
    {
      decision = 'allow',
      renew = true,
    }: { decision?: 'allow' | 'deny'; renew?: boolean } = {},
  ) {
    return fromDevicePage(
      'decision',
      { user_code: userCode, decision, renew },
      { session },
    );
  }

  function poll(deviceCode: string, clientId = BOXEL_CLI_CLIENT_ID) {
    return tokenRequest(server!, {
      grant_type: DEVICE_CODE_GRANT_TYPE,
      client_id: clientId,
      device_code: deviceCode,
    });
  }

  module('starting a device sign-in', function () {
    test('boxel-cli gets a device code and a user code to type into the device page', async function (assert) {
      let response = await authorizeDevice({
        client_id: BOXEL_CLI_CLIENT_ID,
        scope: BOXEL_API_SCOPES,
        resource: BOXEL_API,
      });
      assert.strictEqual(response.status, 200, response.text);
      let body = response.body as DeviceAuthorization;
      assert.true(body.device_code.length >= 32, 'a long device code');
      assert.true(USER_CODE.test(body.user_code), body.user_code);
      assert.strictEqual(
        body.verification_uri,
        DEVICE_PAGE,
        "names the secure origin's device page",
      );
      assert.strictEqual(
        body.verification_uri_complete,
        undefined,
        'offers no address with the code already in it',
      );
      assert.strictEqual(body.expires_in, 600, 'lasts ten minutes');
      assert.strictEqual(body.interval, 5, 'says how often to poll');
    });

    test('a client that is not pre-registered for it is refused', async function (assert) {
      let dynamic = await registerOAuthClient(server!);
      for (let clientId of [dynamic, 'no-such-client', '']) {
        let response = await authorizeDevice({
          client_id: clientId,
          scope: BOXEL_API_SCOPES,
          resource: BOXEL_API,
        });
        assert.strictEqual(response.status, 400, `${clientId || 'none'}`);
        assert.strictEqual(response.body.error, 'unauthorized_client');
      }
      let [{ count }] = (await db.execute(
        `SELECT count(*)::int AS count FROM oauth_provider_objects
          WHERE kind IN ('DeviceCode', 'DeviceUserCode')`,
      )) as { count: number }[];
      assert.strictEqual(count, 0, 'no code is stored');
    });

    test('a client registering for the device-code grant is refused', async function (assert) {
      let response = await supertest(server!)
        .post('/_oauth-provider/reg')
        .set('Host', OAUTH_TEST_SERVER_URL.host)
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            client_name: 'Device App',
            redirect_uris: ['https://app.example.test/callback'],
            grant_types: ['authorization_code', DEVICE_CODE_GRANT_TYPE],
          }),
        );
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'invalid_client_metadata');
    });

    test('a request must name one resource the provider serves, its scopes, and nothing else', async function (assert) {
      let cases: [Record<string, string>, string][] = [
        [
          { client_id: BOXEL_CLI_CLIENT_ID, scope: BOXEL_API_SCOPES },
          'invalid_target',
        ],
        [
          {
            client_id: BOXEL_CLI_CLIENT_ID,
            scope: BOXEL_API_SCOPES,
            resource: 'https://elsewhere.example.test',
          },
          'invalid_target',
        ],
        [
          { client_id: BOXEL_CLI_CLIENT_ID, resource: BOXEL_API },
          'invalid_scope',
        ],
        [
          {
            client_id: BOXEL_CLI_CLIENT_ID,
            scope: 'boxel:read test:probe',
            resource: BOXEL_API,
          },
          'invalid_scope',
        ],
        [
          {
            client_id: BOXEL_CLI_CLIENT_ID,
            scope: BOXEL_API_SCOPES,
            resource: BOXEL_API,
            redirect_uri: 'https://elsewhere.example.test/',
          },
          'invalid_request',
        ],
      ];
      for (let [params, error] of cases) {
        let response = await authorizeDevice(params);
        assert.strictEqual(response.status, 400, JSON.stringify(params));
        assert.strictEqual(response.body.error, error, JSON.stringify(params));
      }
    });

    test('starting one counts against the authorization limit', async function (assert) {
      await restartWith({
        authorizationLimit: {
          ...ROOMY_LIMIT,
          perAddress: { requests: 2, windowSeconds: 600 },
        },
      });
      await startDeviceSignIn();
      await startDeviceSignIn();
      let response = await authorizeDevice({
        client_id: BOXEL_CLI_CLIENT_ID,
        scope: BOXEL_API_SCOPES,
        resource: BOXEL_API,
      });
      assert.strictEqual(response.status, 429);
      assert.strictEqual(response.body.error, 'temporarily_unavailable');
      assert.ok(response.headers['retry-after'], 'says when to try again');
    });
  });

  module('entering the code', function () {
    test('only the secure window, under its own session, may look a code up or decide one', async function (assert) {
      let { user_code } = await startDeviceSignIn();
      let { matrixId, session } = await user();
      let cases: [string, Parameters<typeof fromDevicePage>[2], number][] = [
        ['no Origin', { session, origin: null }, 403],
        ['the app origin', { session, origin: 'http://localhost:4200' }, 403],
        ['no session', {}, 401],
        [
          "the CLI's session",
          { session: await secureSessionAuth(db, matrixId, { client: 'cli' }) },
          401,
        ],
      ];
      for (let [what, options, status] of cases) {
        for (let path of ['lookup', 'decision'] as const) {
          let response = await fromDevicePage(
            path,
            { user_code, decision: 'allow', renew: true },
            options,
          );
          assert.strictEqual(response.status, status, `${path}: ${what}`);
        }
      }
    });

    test('a code is shown with the same consent as the authorize page, typed in any case and spacing', async function (assert) {
      let { user_code } = await startDeviceSignIn();
      let { session } = await user();
      let typed = ` ${user_code.replace('-', ' ').toLowerCase()} `;
      let response = await lookUp(typed, session);
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      assert.strictEqual(response.body.app.kind, 'pre-registered');
      assert.strictEqual(response.body.app.shown, 'Boxel CLI');
      assert.false(response.body.outsideApp, "Boxel's own app");
      assert.deepEqual(
        response.body.resources.map(
          (resource: { id: string; scopes: { name: string }[] }) => [
            resource.id,
            resource.scopes.map(({ name }) => name),
          ],
        ),
        [[BOXEL_API, ['boxel:read', 'boxel:write']]],
      );
      assert.true(
        response.body.renewalOffered,
        'offers to keep the connection',
      );
      assert.strictEqual(
        response.body.confirmationCode,
        user_code,
        'shows the code typed, as the terminal shows it, to check once more',
      );
    });

    test('a code nobody issued, one already decided and one that expired are each said so', async function (assert) {
      let { session } = await user();
      let unknown = await lookUp('BCDF-GHJK', session);
      assert.strictEqual(unknown.status, 404);
      assert.strictEqual(unknown.body.error, 'unknown-code');

      let decided = await startDeviceSignIn();
      assert.strictEqual(
        (await decide(decided.user_code, session, { decision: 'deny' })).status,
        200,
      );
      let again = await lookUp(decided.user_code, session);
      assert.strictEqual(again.status, 409);
      assert.strictEqual(again.body.error, 'decided');
      let secondDecision = await decide(decided.user_code, session);
      assert.strictEqual(secondDecision.status, 409, 'decided once');

      let expired = await startDeviceSignIn();
      await expire();
      let late = await lookUp(expired.user_code, session);
      assert.strictEqual(late.status, 410);
      assert.strictEqual(late.body.error, 'expired');
      assert.strictEqual(
        (await decide(expired.user_code, session)).status,
        410,
        'an expired code is never allowed',
      );
      let polled = await poll(expired.device_code);
      assert.strictEqual(polled.status, 400);
      assert.strictEqual(polled.body.error, 'expired_token');
    });

    test('entering codes is limited per user', async function (assert) {
      await restartWith({
        deviceCodeLimit: {
          ...ROOMY_DEVICE_CODE_LIMIT,
          perUser: { requests: 2, windowSeconds: 600 },
        },
      });
      let { session } = await user();
      let other = await user();
      assert.strictEqual((await lookUp('BCDF-GHJK', session)).status, 404);
      assert.strictEqual((await lookUp('BCDF-GHJL', session)).status, 404);
      let { user_code } = await startDeviceSignIn();
      let limited = await lookUp(user_code, session);
      assert.strictEqual(limited.status, 429, 'even a real code');
      assert.strictEqual(limited.body.error, 'rate-limited');
      assert.ok(limited.headers['retry-after'], 'says when to try again');
      assert.strictEqual(
        (await lookUp(user_code, other.session)).status,
        200,
        'another user is not limited',
      );
    });

    test('entering codes is limited per address', async function (assert) {
      await restartWith({
        deviceCodeLimit: {
          ...ROOMY_DEVICE_CODE_LIMIT,
          caller: {
            ...ROOMY_LIMIT,
            perAddress: { requests: 2, windowSeconds: 600 },
          },
        },
      });
      let users = [await user(), await user(), await user()];
      assert.strictEqual(
        (await lookUp('BCDF-GHJK', users[0].session)).status,
        404,
      );
      assert.strictEqual(
        (await lookUp('BCDF-GHJK', users[1].session)).status,
        404,
      );
      let limited = await lookUp('BCDF-GHJK', users[2].session);
      assert.strictEqual(limited.status, 429, 'a third user from the address');
      assert.strictEqual(limited.body.error, 'rate-limited');
    });
  });

  module('signing in', function () {
    test('allowed, the next poll gets a token for the Boxel API from a renewing grant', async function (assert) {
      let signedIn = await user();
      let device: DeviceAuthorization | undefined;
      let tokens: OAuthTokenResponse | undefined;
      let telemetry = await telemetryDuring(async () => {
        device = await startDeviceSignIn();
        let pending = await poll(device.device_code);
        assert.strictEqual(pending.status, 400);
        assert.strictEqual(pending.body.error, 'authorization_pending');

        assert.strictEqual(
          (await lookUp(device.user_code, signedIn.session)).status,
          200,
        );
        let decided = await decide(device.user_code, signedIn.session);
        assert.strictEqual(decided.status, 200, decided.text);
        assert.deepEqual(decided.body, { decision: 'allow' });

        let issued = await poll(device.device_code);
        assert.strictEqual(issued.status, 200, issued.text);
        tokens = issued.body as OAuthTokenResponse;
      });
      assert.ok(tokens?.access_token, 'an access token');
      assert.ok(tokens?.refresh_token, 'a refresh token: the grant renews');

      let [grant] = (await db.execute(
        `SELECT user_id, client_id, resources, renewing, exchanged_at,
                redirect_uri,
                extract(epoch FROM expires_at - created_at)::int AS lifetime
           FROM oauth_provider_grants`,
      )) as {
        user_id: string;
        client_id: string;
        resources: Record<string, string[]>;
        renewing: boolean;
        exchanged_at: string | null;
        redirect_uri: string | null;
        lifetime: number;
      }[];
      assert.strictEqual(grant.user_id, signedIn.id);
      assert.strictEqual(grant.client_id, BOXEL_CLI_CLIENT_ID);
      assert.deepEqual(grant.resources, {
        [BOXEL_API]: ['boxel:read', 'boxel:write'],
      });
      assert.true(grant.renewing);
      assert.strictEqual(grant.lifetime, RENEWING_GRANT_TTL_SECONDS);
      assert.ok(grant.exchanged_at, 'the app connected');
      assert.strictEqual(grant.redirect_uri, null, 'no browser was redirected');

      let [token] = (await db.execute(
        `SELECT resource, scope FROM oauth_provider_tokens WHERE kind = 'AccessToken'`,
      )) as { resource: string; scope: string }[];
      assert.strictEqual(token.resource, BOXEL_API, 'bound to the Boxel API');
      assert.strictEqual(token.scope, BOXEL_API_SCOPES);

      // Nothing holds either code readable, and no log line or Sentry event
      // carries one.
      let stored = (await db.execute(
        `SELECT kind, payload::text AS payload FROM oauth_provider_objects
         UNION ALL SELECT 'grant', row_to_json(g)::text FROM oauth_provider_grants g
         UNION ALL SELECT 'token', row_to_json(t)::text FROM oauth_provider_tokens t`,
      )) as { kind: string; payload: string }[];
      let normalized = device!.user_code.replace('-', '');
      for (let { kind, payload } of stored) {
        assert.false(
          payload.includes(device!.device_code),
          `${kind} holds no device code`,
        );
        for (let form of [device!.user_code, normalized]) {
          assert.false(payload.includes(form), `${kind} holds no user code`);
        }
      }
      assertNoSecrets(assert, telemetry, {
        'device code': device!.device_code,
        'user code': device!.user_code,
        'normalized user code': normalized,
        'access token': tokens!.access_token,
      });
    });

    test('not kept, the grant ends in an hour and issues no refresh token', async function (assert) {
      let { session } = await user();
      let device = await startDeviceSignIn();
      await decide(device.user_code, session, { renew: false });
      let issued = await poll(device.device_code);
      assert.strictEqual(issued.status, 200, issued.text);
      assert.strictEqual(issued.body.refresh_token, undefined);
      let [{ renewing }] = (await db.execute(
        `SELECT renewing FROM oauth_provider_grants`,
      )) as { renewing: boolean }[];
      assert.false(renewing);
    });

    test('denied, the next poll is told access_denied', async function (assert) {
      let { session } = await user();
      let device = await startDeviceSignIn();
      let decided = await decide(device.user_code, session, {
        decision: 'deny',
      });
      assert.deepEqual(decided.body, { decision: 'deny' });
      let polled = await poll(device.device_code);
      assert.strictEqual(polled.status, 400);
      assert.strictEqual(polled.body.error, 'access_denied');
      let [{ count }] = (await db.execute(
        `SELECT count(*)::int AS count FROM oauth_provider_grants`,
      )) as { count: number }[];
      assert.strictEqual(count, 0, 'no grant');
    });

    test('polling faster than the interval is told to slow down, and counts as no failure', async function (assert) {
      // One failed token request allowed per address: a poll that counted
      // as one would leave none for the request below.
      await restartWith({
        tokenLimit: {
          ...ROOMY_TOKEN_LIMIT,
          failures: {
            ...ROOMY_TOKEN_LIMIT.failures,
            perAddress: { requests: 1, windowSeconds: 600 },
          },
        },
      });
      let device = await startDeviceSignIn();
      let answers: string[] = [];
      for (let i = 0; i < 3; i++) {
        answers.push((await poll(device.device_code)).body.error);
      }
      assert.deepEqual(answers, [
        'authorization_pending',
        'authorization_pending',
        'slow_down',
      ]);
      let unknown = await poll('no-such-device-code');
      assert.strictEqual(
        unknown.status,
        400,
        'the address still has its one failure left',
      );
      assert.strictEqual(unknown.body.error, 'invalid_grant');
      let limited = await poll('no-such-device-code');
      assert.strictEqual(limited.status, 429, 'and has now spent it');
    });

    test('an Allow that loses to another decision stores no grant', async function (assert) {
      await restartLosingDecisionsOnGrant();
      let { session } = await user();
      let device = await startDeviceSignIn();
      let decided = await decide(device.user_code, session);
      assert.strictEqual(decided.status, 409);
      assert.strictEqual(decided.body.error, 'decided');
      let [{ count }] = (await db.execute(
        `SELECT count(*)::int AS count FROM oauth_provider_grants`,
      )) as { count: number }[];
      assert.strictEqual(count, 0, 'the grant it made is deleted');
      let polled = await poll(device.device_code);
      assert.strictEqual(polled.body.error, 'access_denied');
    });

    test('a device code exchanged again ends its grant', async function (assert) {
      let { session } = await user();
      let device = await startDeviceSignIn();
      await decide(device.user_code, session);
      assert.strictEqual((await poll(device.device_code)).status, 200);
      let again = await poll(device.device_code);
      assert.strictEqual(again.status, 400);
      assert.strictEqual(again.body.error, 'invalid_grant');
      let [{ ended_reason }] = (await db.execute(
        `SELECT ended_reason FROM oauth_provider_grants`,
      )) as { ended_reason: string | null }[];
      assert.strictEqual(ended_reason, 'reuse');
    });

    test("another client can't poll for boxel-cli's device code", async function (assert) {
      let { session } = await user();
      let device = await startDeviceSignIn();
      await decide(device.user_code, session);
      let other = await registerOAuthClient(server!);
      let polled = await poll(device.device_code, other);
      assert.strictEqual(polled.status, 400);
      assert.strictEqual(polled.body.access_token, undefined, 'no token');
      assert.strictEqual(
        (await poll(device.device_code)).status,
        200,
        'boxel-cli still can',
      );
    });
  });

  // Moves every device code past its expiry, as the library and the table
  // each record it.
  async function expire() {
    await db.execute(
      `UPDATE oauth_provider_objects
          SET expires_at = now() - interval '1 second',
              payload = payload || jsonb_build_object(
                'exp', floor(extract(epoch FROM now()))::bigint - 1
              )
        WHERE kind = 'DeviceCode'`,
    );
  }
});
