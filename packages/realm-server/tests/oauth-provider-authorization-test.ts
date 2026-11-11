import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
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
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
} from './helpers/oauth-provider.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { ObjectAdapter, sha256Hex } from '../lib/oauth-provider/objects.ts';
import { appName } from '../lib/oauth-provider/app-name.ts';
import {
  scrubRequestTelemetry,
  withOAuthProviderSecretsLabeled,
} from '../lib/request-telemetry.ts';
import type { CallerLimit } from '../lib/oauth-provider/caller-limit.ts';
import { DEFAULT_AUTHORIZATION_LIMIT } from '../lib/oauth-provider/authorization.ts';
import {
  OAuthProviderConfigError,
  readAuthorizationLimit,
} from '../lib/oauth-provider/config.ts';
import type {
  OAuthResourceDefinition,
  OAuthScope,
} from '../lib/oauth-provider/registry.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const { copySync, ensureDirSync } = fsExtra;

const AUTHORIZATION = '/_oauth-provider/auth';

// The realm is mounted at the server's root, so a request the provider's
// routes didn't answer would reach it.
const serverURL = new URL('http://127.0.0.1:0/');
const ISSUER = 'http://127.0.0.1:0';
const MCP = `${ISSUER}/mcp`;
const AUTHORIZE_PAGE = `${testOAuthSecureOriginURL.href}/authorize`;
const REDIRECT_URI = 'http://127.0.0.1/callback';

function scope(name: string): OAuthScope {
  return {
    name,
    description: `Test scope ${name}.`,
    label: name,
    caution: false,
    routes: [],
  };
}

// Two resources that share a scope, so a request naming neither can't be
// given one by its scopes, and one only Boxel's own apps may use.
const TEST_RESOURCES: OAuthResourceDefinition[] = [
  {
    path: '/test-a',
    name: 'Test A',
    description: 'A test resource.',
    coverage: 'Test A only.',
    scopes: [scope('test:shared'), scope('test:a')],
    clients: 'open',
  },
  {
    path: '/test-b',
    name: 'Test B',
    description: 'A test resource.',
    coverage: 'Test B only.',
    scopes: [scope('test:shared')],
    clients: 'open',
  },
  {
    path: '/test-own-apps',
    name: 'Test for own apps',
    description: 'A test resource only pre-registered clients may use.',
    coverage: 'Test only.',
    scopes: [scope('test:own')],
    clients: 'pre-registered',
  },
];

// Generous enough that no test but the limit's own reaches it, for starting
// a flow and for registering the clients that start one.
const ROOMY_LIMIT: CallerLimit = {
  perAddress: { requests: 1000, windowSeconds: 600 },
  perNetwork: { requests: 1000, windowSeconds: 600 },
  overall: { requests: 1000, windowSeconds: 600 },
  alertAfter: 999,
};

interface StartOptions {
  provider?: boolean;
  authorizationLimit?: CallerLimit;
  trustedProxyHops?: number;
}

async function start({
  dbAdapter,
  publisher,
  runner,
  provider = true,
  authorizationLimit = ROOMY_LIMIT,
  trustedProxyHops = 0,
}: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
} & StartOptions): Promise<Server> {
  let realmsRootPath = join(dirSync().name, 'realm_server_oauth_authorization');
  let testRealmDir = join(realmsRootPath, 'root');
  ensureDirSync(testRealmDir);
  copySync(fixtureDir('simple'), testRealmDir);
  let { testRealmHttpServer } = await runTestRealmServer({
    virtualNetwork: createVirtualNetwork(),
    testRealmDir,
    realmsRootPath,
    realmURL: serverURL,
    dbAdapter,
    publisher,
    runner,
    matrixURL,
    secureOriginURL: testOAuthSecureOriginURL,
    clientAddress: { trustedProxyHops, infraAddresses: [] },
    ...(provider
      ? {
          oauthProvider: testOAuthProviderConfig(),
          oauthTestResources: TEST_RESOURCES,
          oauthNewClientLimit: ROOMY_LIMIT,
          oauthAuthorizationLimit: authorizationLimit,
        }
      : {}),
  });
  return testRealmHttpServer;
}

type Params = Record<string, string | string[] | undefined>;

function setupServer(hooks: NestedHooks, options: StartOptions = {}) {
  let server: Server | undefined;
  let db: PgAdapter | undefined;
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
      server = await start({ dbAdapter, publisher, runner, ...options });
    },
    afterEach: async () => {
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  function get(path: string) {
    return supertest(server!).get(path).set('Host', serverURL.host);
  }

  return {
    get,
    db: () => db!,
    async register(redirectUris: string[] = [REDIRECT_URI]): Promise<string> {
      let response = await supertest(server!)
        .post('/_oauth-provider/reg')
        .set('Host', serverURL.host)
        // Read as the caller's address wherever a proxy of ours is trusted.
        .set('X-Forwarded-For', '192.0.2.200')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            client_name: 'Test App',
            redirect_uris: redirectUris,
          }),
        );
      if (response.status !== 201) {
        throw new Error(
          `registration failed: ${JSON.stringify(response.body)}`,
        );
      }
      return response.body.client_id as string;
    },
    authorize(
      params: Params,
      { forwardedFor, cookie }: { forwardedFor?: string; cookie?: string } = {},
    ) {
      let query = new URLSearchParams();
      for (let [name, value] of Object.entries(params)) {
        for (let item of Array.isArray(value) ? value : [value]) {
          if (item !== undefined) {
            query.append(name, item);
          }
        }
      }
      let request = get(`${AUTHORIZATION}?${query}`);
      if (forwardedFor) {
        request = request.set('X-Forwarded-For', forwardedFor);
      }
      if (cookie) {
        request = request.set('Cookie', cookie);
      }
      return request;
    },
    async objectRows(): Promise<
      { kind: string; payload: unknown; lifetime: number }[]
    > {
      return (await db!.execute(
        `SELECT kind, payload,
           extract(epoch FROM expires_at - created_at)::int AS lifetime
           FROM oauth_provider_objects ORDER BY created_at`,
      )) as { kind: string; payload: unknown; lifetime: number }[];
    },
    async objectCount(): Promise<number> {
      let [{ count }] = await db!.execute(
        `SELECT count(*)::int AS count FROM oauth_provider_objects`,
      );
      return count as number;
    },
    async rawObjects(): Promise<string> {
      let rows = await db!.execute(
        `SELECT kind, encode(id_hash, 'hex') AS id_hash, payload::text AS payload
           FROM oauth_provider_objects`,
      );
      return JSON.stringify(rows);
    },
    interaction(uid: string) {
      return new ObjectAdapter(db!, 'Interaction').find(uid);
    },
  };
}

// A request every check passes, for the client registered with `REDIRECT_URI`.
function validParams(clientId: string, overrides: Params = {}): Params {
  return {
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'boxel:read',
    resource: MCP,
    state: 'state-marker-5a1c',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    ...overrides,
  };
}

function interactionUid(location: string): string {
  let prefix = `${ISSUER}/_oauth-provider/interaction/`;
  if (!location.startsWith(prefix)) {
    throw new Error(`not the interaction route: ${location}`);
  }
  return location.slice(prefix.length);
}

// The reference of an error the browser was sent to the error page with.
function errorReference(assert: Assert, location: string | undefined): string {
  assert.ok(location, 'the browser is sent on');
  let url = new URL(location!);
  assert.strictEqual(
    `${url.origin}${url.pathname}`,
    AUTHORIZE_PAGE,
    `the error goes to the secure origin's authorize page, not ${location}`,
  );
  let reference = url.searchParams.get('error');
  assert.ok(reference, 'with an error');
  return reference!;
}

module(basename(import.meta.filename), function () {
  module('naming an app', function () {
    test('a client ID metadata document is named by its registrable domain', function (assert) {
      assert.deepEqual(
        appName({ clientId: 'https://claude.ai.example.com/client.json' }),
        { kind: 'metadata-document', shown: 'example.com', verified: true },
      );
    });

    test('a client that registered itself is unverified, named by its redirect', function (assert) {
      assert.deepEqual(
        appName({
          clientId: 'generated-id',
          clientName: 'Claude',
          redirectUri: 'https://app.attacker.example.co.uk/callback',
        }),
        {
          kind: 'dynamic',
          shown: 'example.co.uk',
          verified: false,
          claimedName: 'Claude',
        },
      );
      assert.strictEqual(
        appName({
          clientId: 'generated-id',
          redirectUri: 'http://localhost:51234/callback',
        }).shown,
        'an app on this computer',
      );
    });

    test('a pre-registered client is named by its own name', function (assert) {
      assert.deepEqual(
        appName({
          clientId: 'boxel-cli',
          clientName: 'Boxel CLI',
          preRegistered: new Set(['boxel-cli']),
        }),
        { kind: 'pre-registered', shown: 'Boxel CLI', verified: true },
      );
    });
  });

  module('telemetry labels', function () {
    test('an interaction ID or error reference in a path is replaced by a label', function (assert) {
      assert.strictEqual(
        withOAuthProviderSecretsLabeled(
          '<-- GET https://realm.test/_oauth-provider/interaction/uid-secret-1/finish?ticket=t',
        ),
        '<-- GET https://realm.test/_oauth-provider/interaction/:uid/finish?ticket=t',
      );
      assert.strictEqual(
        withOAuthProviderSecretsLabeled('/_oauth-provider/auth/uid-secret-2'),
        '/_oauth-provider/auth/:uid',
      );
      assert.strictEqual(
        withOAuthProviderSecretsLabeled(
          '/_oauth-provider/error/ref-secret-3/return',
        ),
        '/_oauth-provider/error/:ref/return',
      );
      assert.strictEqual(
        withOAuthProviderSecretsLabeled('/_oauth-provider/auth?client_id=x'),
        '/_oauth-provider/auth?client_id=x',
        'the authorization endpoint itself names no secret',
      );
    });

    test('a Sentry event names the routes by their labels everywhere', function (assert) {
      let event = scrubRequestTelemetry({
        transaction: 'GET /_oauth-provider/error/ref-secret-4',
        request: {
          method: 'GET',
          url: 'https://realm.test/_oauth-provider/interaction/uid-secret-5',
        },
        breadcrumbs: [
          {
            message:
              '--> GET https://realm.test/_oauth-provider/interaction/uid-secret-5: 303',
          },
        ],
        contexts: {
          trace: {
            data: {
              'http.target': '/_oauth-provider/interaction/uid-secret-5',
            },
          },
        },
      });
      let sent = JSON.stringify(event);
      assert.false(sent.includes('uid-secret-5'), sent);
      assert.false(sent.includes('ref-secret-4'), sent);
      assert.strictEqual(
        event.request?.url,
        'https://realm.test/_oauth-provider/interaction/:uid',
      );
      assert.strictEqual(event.transaction, 'GET /_oauth-provider/error/:ref');
    });
  });

  module('with the provider on', function (hooks) {
    let server = setupServer(hooks);

    function details(reference: string) {
      return server
        .get(`/_oauth-provider/error/${reference}`)
        .set('Origin', testOAuthSecureOriginURL.origin);
    }

    test('a request every check passes starts an interaction and goes to the interaction route', async function (assert) {
      let clientId = await server.register();
      let response = await server.authorize(validParams(clientId));
      assert.strictEqual(response.status, 303, response.text);
      let uid = interactionUid(response.headers.location);
      let cookies = ([] as string[]).concat(
        response.headers['set-cookie'] ?? [],
      );
      assert.true(
        cookies.some(
          (cookie) =>
            cookie.startsWith('_interaction=') &&
            cookie.includes(`path=/_oauth-provider/interaction/${uid}`),
        ),
        `the interaction cookie is set for the interaction route: ${cookies}`,
      );

      let interaction = await server.interaction(uid);
      assert.ok(interaction, 'the interaction is stored');
      let params = interaction!.params as Record<string, unknown>;
      assert.strictEqual(params.resource, MCP);
      assert.strictEqual(params.client_id, clientId);
      let prompt = interaction!.prompt as { name: string };
      assert.strictEqual(prompt.name, 'login', 'the flow asks for sign-in');
    });

    test('a request naming no resource is given the one whose scopes it asks for', async function (assert) {
      let clientId = await server.register();
      let response = await server.authorize(
        validParams(clientId, { resource: undefined }),
      );
      assert.strictEqual(response.status, 303, response.text);
      let interaction = await server.interaction(
        interactionUid(response.headers.location),
      );
      assert.strictEqual(
        (interaction!.params as Record<string, unknown>).resource,
        MCP,
      );
    });

    test('a request Boxel refuses goes to the error page, never to the client, and starts no interaction', async function (assert) {
      let clientId = await server.register();
      let cases: [string, Params, string, string][] = [
        [
          'an unknown scope, naming no resource',
          { resource: undefined, scope: 'test:unknown' },
          'invalid_scope',
          'unknown-scope',
        ],
        [
          'scopes two resources share, naming no resource',
          { resource: undefined, scope: 'test:shared' },
          'invalid_target',
          'no-resource-for-scopes',
        ],
        ['openid', { scope: 'boxel:read openid' }, 'invalid_scope', 'openid'],
        ['prompt=none', { prompt: 'none' }, 'invalid_request', 'prompt-none'],
        [
          'no PKCE challenge',
          { code_challenge: undefined, code_challenge_method: undefined },
          'invalid_request',
          'pkce-required',
        ],
        [
          'a plain PKCE challenge',
          { code_challenge_method: 'plain' },
          'invalid_request',
          'pkce-required',
        ],
        [
          'the implicit grant',
          { response_type: 'token' },
          'unsupported_response_type',
          'unsupported-response-type',
        ],
        [
          'an unknown resource',
          { resource: `${ISSUER}/unknown` },
          'invalid_target',
          'unknown-resource',
        ],
        [
          'a resource the client may not use',
          { resource: `${ISSUER}/test-own-apps`, scope: 'test:own' },
          'invalid_target',
          'client-not-allowed',
        ],
        [
          'a scope the named resource does not offer',
          { scope: 'boxel:read test:a' },
          'invalid_scope',
          'unknown-scope',
        ],
        [
          'no scope of one of the resources named',
          { resource: [MCP, `${ISSUER}/test-a`], scope: 'boxel:read' },
          'invalid_scope',
          'missing-scope',
        ],
      ];
      for (let [name, overrides, error, reason] of cases) {
        let response = await server.authorize(validParams(clientId, overrides));
        assert.strictEqual(response.status, 303, `${name}: ${response.text}`);
        assert.strictEqual(
          response.headers['referrer-policy'],
          'no-referrer',
          `${name}: no referrer`,
        );
        let reference = errorReference(assert, response.headers.location);
        let found = await details(reference);
        assert.strictEqual(found.status, 200, name);
        assert.strictEqual(found.body.error, error, `${name}: error`);
        assert.strictEqual(found.body.reason, reason, `${name}: reason`);
        assert.true(found.body.returnOffered, `${name}: "Return" is offered`);
      }
      let rows = await server.objectRows();
      assert.deepEqual(
        [...new Set(rows.map(({ kind }) => kind))],
        ['ErrorReference'],
        'no interaction was started',
      );
    });

    test("an unknown client and a redirect URI the client didn't register reach the error page with nothing to return to", async function (assert) {
      let clientId = await server.register();
      let unknown = await server.authorize(
        validParams('no-such-client', {
          redirect_uri: 'https://attacker.test/',
        }),
      );
      assert.strictEqual(unknown.status, 303, unknown.text);
      let unknownDetails = await details(
        errorReference(assert, unknown.headers.location),
      );
      assert.strictEqual(unknownDetails.body.error, 'invalid_client');
      assert.strictEqual(unknownDetails.body.reason, 'unknown-client');
      assert.false(unknownDetails.body.returnOffered);
      assert.false('app' in unknownDetails.body, 'no app is named');

      let badRedirect = await server.authorize(
        validParams(clientId, { redirect_uri: 'https://attacker.test/' }),
      );
      assert.strictEqual(badRedirect.status, 303, badRedirect.text);
      let badRedirectDetails = await details(
        errorReference(assert, badRedirect.headers.location),
      );
      assert.strictEqual(badRedirectDetails.body.reason, 'bad-redirect-uri');
      assert.false(badRedirectDetails.body.returnOffered);

      // Refused by Boxel's checks, with a redirect URI the client didn't
      // register.
      let refused = await server.authorize(
        validParams(clientId, {
          prompt: 'none',
          redirect_uri: 'https://attacker.test/',
        }),
      );
      let refusedDetails = await details(
        errorReference(assert, refused.headers.location),
      );
      assert.strictEqual(refusedDetails.body.reason, 'prompt-none');
      assert.false(refusedDetails.body.returnOffered);
      let back = await server.get(
        `/_oauth-provider/error/${errorReference(assert, refused.headers.location)}/return`,
      );
      assert.strictEqual(
        back.headers.location,
        `${AUTHORIZE_PAGE}?error=expired`,
        'its "Return" leads to the expired page, never the redirect URI',
      );
    });

    test('the error page names the app and offers "Return", which goes to the client with the error once', async function (assert) {
      let clientId = await server.register();
      let refused = await server.authorize(
        validParams(clientId, { scope: 'boxel:read openid' }),
      );
      let reference = errorReference(assert, refused.headers.location);

      let found = await details(reference);
      assert.deepEqual(found.body, {
        error: 'invalid_scope',
        reason: 'openid',
        app: {
          kind: 'dynamic',
          shown: 'an app on this computer',
          verified: false,
          claimedName: 'Test App',
        },
        returnOffered: true,
      });
      assert.strictEqual(found.headers['cache-control'], 'no-store');

      let back = await server.get(`/_oauth-provider/error/${reference}/return`);
      assert.strictEqual(back.status, 303);
      assert.strictEqual(back.headers['referrer-policy'], 'no-referrer');
      let destination = new URL(back.headers.location);
      assert.strictEqual(
        `${destination.origin}${destination.pathname}`,
        REDIRECT_URI,
      );
      assert.strictEqual(
        destination.searchParams.get('error'),
        'invalid_scope',
      );
      assert.strictEqual(
        destination.searchParams.get('state'),
        'state-marker-5a1c',
      );
      assert.strictEqual(destination.searchParams.get('iss'), ISSUER);

      let again = await server.get(
        `/_oauth-provider/error/${reference}/return`,
      );
      assert.strictEqual(again.status, 303);
      assert.strictEqual(
        again.headers.location,
        `${AUTHORIZE_PAGE}?error=expired`,
        'a second "Return" shows the expired page',
      );
      assert.strictEqual(
        (await details(reference)).status,
        404,
        'the error is gone',
      );
    });

    test('a hand-made reference leads nowhere', async function (assert) {
      let made = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      let found = await details(made);
      assert.strictEqual(found.status, 404);
      let back = await server.get(`/_oauth-provider/error/${made}/return`);
      assert.strictEqual(back.status, 303);
      assert.strictEqual(
        back.headers.location,
        `${AUTHORIZE_PAGE}?error=expired`,
      );
    });

    test("an error's details answer only the secure origin", async function (assert) {
      let clientId = await server.register();
      let refused = await server.authorize(
        validParams(clientId, { prompt: 'none' }),
      );
      let reference = errorReference(assert, refused.headers.location);
      let noOrigin = await server.get(`/_oauth-provider/error/${reference}`);
      assert.strictEqual(noOrigin.status, 403);
      let otherOrigin = await server
        .get(`/_oauth-provider/error/${reference}`)
        .set('Origin', 'https://attacker.test');
      assert.strictEqual(otherOrigin.status, 403);
    });

    test('the interaction route hands the flow to the authorize page, and the library answers nothing there', async function (assert) {
      let clientId = await server.register();
      let started = await server.authorize(validParams(clientId));
      let uid = interactionUid(started.headers.location);
      let response = await server.get(`/_oauth-provider/interaction/${uid}`);
      assert.strictEqual(response.status, 303);
      assert.strictEqual(
        response.headers.location,
        `${AUTHORIZE_PAGE}?interaction=${uid}`,
      );
      assert.strictEqual(response.headers['referrer-policy'], 'no-referrer');
      assert.false(
        /login/i.test(response.text ?? ''),
        'no sign-in page of the library',
      );
    });

    test("the library's session cookie is dropped at the start of each flow", async function (assert) {
      let clientId = await server.register();
      let response = await server.authorize(validParams(clientId), {
        cookie: '_session=remembered-session; _session.sig=signature; kept=1',
      });
      assert.strictEqual(response.status, 303, response.text);
      let cookies = ([] as string[]).concat(
        response.headers['set-cookie'] ?? [],
      );
      for (let name of ['_session', '_session.sig']) {
        assert.true(
          cookies.some(
            (cookie) =>
              cookie.startsWith(`${name}=;`) &&
              /expires=Thu, 01 Jan 1970/i.test(cookie),
          ),
          `${name} is expired: ${cookies}`,
        );
      }
      let interaction = await server.interaction(
        interactionUid(response.headers.location),
      );
      assert.strictEqual(
        (interaction!.prompt as { name: string }).name,
        'login',
        'the flow still asks for sign-in',
      );
    });

    test('no interaction ID or error reference is stored readable, and an interaction lasts 10 minutes', async function (assert) {
      let clientId = await server.register();
      let started = await server.authorize(validParams(clientId));
      let uid = interactionUid(started.headers.location);
      let refused = await server.authorize(
        validParams(clientId, { prompt: 'none' }),
      );
      let reference = errorReference(assert, refused.headers.location);

      let raw = await server.rawObjects();
      assert.false(raw.includes(uid), 'no row holds the interaction ID');
      assert.false(raw.includes(reference), 'no row holds the error reference');
      assert.true(
        raw.includes(sha256Hex(uid)),
        'the interaction is keyed by its hash',
      );

      let rows = await server.objectRows();
      assert.deepEqual(
        rows.map(({ kind, lifetime }) => [kind, lifetime]),
        [
          ['Interaction', 600],
          ['ErrorReference', 600],
        ],
      );

      let interaction = await server.interaction(uid);
      assert.strictEqual(interaction?.jti, uid, 'found with its ID restored');
      assert.true(
        String(interaction?.returnTo).endsWith(`/${uid}`),
        'its resume URL is restored',
      );

      await server
        .db()
        .execute(
          `UPDATE oauth_provider_objects SET expires_at = now() - interval '1 second'`,
        );
      assert.strictEqual(
        await server.interaction(uid),
        undefined,
        'an expired interaction is gone',
      );
      assert.strictEqual(
        (await details(reference)).status,
        404,
        'an expired error is gone',
      );
    });

    test('the interaction and error routes reach logs and Sentry only by fixed labels', async function (assert) {
      let clientId = await server.register();
      let uid = '';
      let reference = '';
      let telemetry = await telemetryDuring(async () => {
        let started = await server.authorize(validParams(clientId));
        uid = interactionUid(started.headers.location);
        await server.get(`/_oauth-provider/interaction/${uid}`);
        let refused = await server.authorize(
          validParams(clientId, { prompt: 'none' }),
        );
        reference = errorReference(assert, refused.headers.location);
        await details(reference);
        await server.get(`/_oauth-provider/error/${reference}/return`);
      });
      assert.true(
        telemetry.logs.includes('/_oauth-provider/interaction/:uid'),
        'the request log names the interaction route by its label',
      );
      assert.true(
        telemetry.logs.includes('/_oauth-provider/error/:ref/return'),
        'the request log names the return route by its label',
      );
      assert.true(
        telemetry.transactions.length > 0,
        'precondition: the requests reached Sentry',
      );
      assertNoSecrets(assert, telemetry, {
        'interaction ID': uid,
        'error reference': reference,
        state: 'state-marker-5a1c',
      });
    });
  });

  module('over the authorization limit', function (hooks) {
    // Behind one proxy of ours, so the caller is the address it forwards.
    let server = setupServer(hooks, {
      trustedProxyHops: 1,
      authorizationLimit: {
        perAddress: { requests: 2, windowSeconds: 600 },
        perNetwork: { requests: 3, windowSeconds: 600 },
        overall: { requests: 1000, windowSeconds: 600 },
        alertAfter: 999,
      },
    });

    test('a request over the limit shows the page and writes nothing, keyed on the forwarded address', async function (assert) {
      let clientId = await server.register();
      let first = { forwardedFor: '203.0.113.9, 192.0.2.10' };
      for (let i = 0; i < 2; i++) {
        let response = await server.authorize(validParams(clientId), first);
        assert.strictEqual(response.status, 303, `request ${i + 1}`);
        interactionUid(response.headers.location);
      }
      let before = await server.objectCount();
      let refused = await server.authorize(validParams(clientId), first);
      assert.strictEqual(refused.status, 303);
      assert.strictEqual(
        refused.headers.location,
        `${AUTHORIZE_PAGE}?error=rate_limited`,
      );
      assert.strictEqual(
        await server.objectCount(),
        before,
        'nothing is written',
      );

      let another = await server.authorize(validParams(clientId), {
        forwardedFor: '192.0.2.11',
      });
      assert.strictEqual(another.status, 303);
      interactionUid(another.headers.location);
    });

    test('addresses in one network share its allowance', async function (assert) {
      let clientId = await server.register();
      for (let address of ['203.0.113.1', '203.0.113.1', '203.0.113.2']) {
        let response = await server.authorize(validParams(clientId), {
          forwardedFor: address,
        });
        interactionUid(response.headers.location);
      }
      let refused = await server.authorize(validParams(clientId), {
        forwardedFor: '203.0.113.3',
      });
      assert.strictEqual(
        refused.headers.location,
        `${AUTHORIZE_PAGE}?error=rate_limited`,
        'a fresh address in the same /24 is refused',
      );
      let elsewhere = await server.authorize(validParams(clientId), {
        forwardedFor: '198.51.100.1',
      });
      assert.strictEqual(elsewhere.status, 303);
      interactionUid(elsewhere.headers.location);
    });
  });

  module('reading the authorization limit', function () {
    test('defaults when unset, reads named parts, and stops the server when malformed', function (assert) {
      assert.deepEqual(readAuthorizationLimit({}), DEFAULT_AUTHORIZATION_LIMIT);
      assert.deepEqual(
        readAuthorizationLimit({
          BOXEL_OAUTH_AUTHORIZATION_RATE_LIMIT: 'address=5/60',
        }),
        {
          ...DEFAULT_AUTHORIZATION_LIMIT,
          perAddress: { requests: 5, windowSeconds: 60 },
        },
        'a part left out keeps its default',
      );
      assert.throws(
        () =>
          readAuthorizationLimit({
            BOXEL_OAUTH_AUTHORIZATION_RATE_LIMIT: '30/600,1000/600',
          }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /BOXEL_OAUTH_AUTHORIZATION_RATE_LIMIT must be named parts/.test(
            error.message,
          ),
      );
    });
  });

  module('with the provider off', function (hooks) {
    let server = setupServer(hooks, { provider: false });

    test("none of the flow's routes is served", async function (assert) {
      for (let path of [
        `${AUTHORIZATION}?response_type=code`,
        '/_oauth-provider/interaction/some-uid',
        '/_oauth-provider/error/some-reference',
        '/_oauth-provider/error/some-reference/return',
      ]) {
        let response = await server
          .get(path)
          .set('Origin', testOAuthSecureOriginURL.origin);
        assert.notStrictEqual(response.status, 303, path);
        assert.notStrictEqual(response.status, 200, path);
      }
    });
  });
});
