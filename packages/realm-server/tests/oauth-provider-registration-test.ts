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
import type { NewClientLimit } from '../lib/oauth-provider/new-client-limit.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const { copySync, ensureDirSync } = fsExtra;

const REGISTRATION = '/_oauth-provider/reg';

// The realm is mounted at the server's root, so a request the provider's
// routes didn't answer would reach it.
const serverURL = new URL('http://127.0.0.1:0/');

const PUBLISHED_DOMAINS = {
  boxelSite: 'boxel.site',
  boxelSpace: 'boxel.space',
};
const APP_ORIGINS = ['https://*.app-origin.test'];

// Generous enough that no test but the limit's own reaches it.
const ROOMY_LIMIT: NewClientLimit = {
  perAddress: { requests: 100, windowSeconds: 3600 },
  overall: { requests: 100, windowSeconds: 3600 },
};

interface StartOptions {
  provider?: boolean;
  newClientLimit?: NewClientLimit;
  // How many proxies of ours sit in front of the server, so a test can name
  // each caller in `X-Forwarded-For`.
  trustedProxyHops?: number;
}

async function start({
  dbAdapter,
  publisher,
  runner,
  provider = true,
  newClientLimit = ROOMY_LIMIT,
  trustedProxyHops = 0,
}: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
} & StartOptions): Promise<Server> {
  let realmsRootPath = join(dirSync().name, 'realm_server_oauth_registration');
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
    secureOriginAppOrigins: APP_ORIGINS,
    domainsForPublishedRealms: PUBLISHED_DOMAINS,
    clientAddress: { trustedProxyHops, infraAddresses: [] },
    ...(provider
      ? {
          oauthProvider: testOAuthProviderConfig(),
          oauthNewClientLimit: newClientLimit,
        }
      : {}),
  });
  return testRealmHttpServer;
}

// How the server is set up changes how it answers, not what it indexes, so
// every setup shares one template.
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
  return {
    register: (
      body: unknown,
      { forwardedFor }: { forwardedFor?: string } = {},
    ) => {
      let request = supertest(server!)
        .post(REGISTRATION)
        .set('Host', serverURL.host)
        .set('Content-Type', 'application/json');
      if (forwardedFor) {
        request = request.set('X-Forwarded-For', forwardedFor);
      }
      return request.send(JSON.stringify(body));
    },
    post: (path: string) =>
      supertest(server!).post(path).set('Host', serverURL.host),
    storedClient: async (clientId: string) => {
      let [row] = await db!.execute(
        `SELECT metadata FROM oauth_provider_clients WHERE client_id = $1`,
        { bind: [clientId] },
      );
      return row?.metadata as Record<string, unknown> | undefined;
    },
    storedClientCount: async () => {
      let [{ count }] = await db!.execute(
        `SELECT count(*)::int AS count FROM oauth_provider_clients`,
      );
      return count as number;
    },
  };
}

const loopbackClient = {
  client_name: 'An app on this computer',
  redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

module(basename(import.meta.filename), function () {
  module('with the provider on', function (hooks) {
    let server = setupServer(hooks);

    test('a loopback client gets an ID and no secret, and is stored as native', async function (assert) {
      let response = await server.register(loopbackClient);
      assert.strictEqual(response.status, 201, JSON.stringify(response.body));
      let clientId = response.body.client_id;
      assert.strictEqual(typeof clientId, 'string');
      assert.false('client_secret' in response.body, 'no secret returned');
      assert.false(
        'registration_access_token' in response.body,
        'no registration access token',
      );
      assert.strictEqual(response.body.application_type, 'native');
      assert.strictEqual(response.body.token_endpoint_auth_method, 'none');

      let stored = await server.storedClient(clientId);
      assert.strictEqual(stored?.application_type, 'native');
      assert.strictEqual(stored?.client_name, 'An app on this computer');
      assert.deepEqual(stored?.redirect_uris, loopbackClient.redirect_uris);
      assert.deepEqual(stored?.grant_types, [
        'authorization_code',
        'refresh_token',
      ]);
      assert.false('client_secret' in (stored ?? {}), 'no secret stored');
    });

    test('a client with an HTTPS redirect is stored as web', async function (assert) {
      let response = await server.register({
        redirect_uris: ['https://client.example.test/callback'],
      });
      assert.strictEqual(response.status, 201, JSON.stringify(response.body));
      let stored = await server.storedClient(response.body.client_id);
      assert.strictEqual(stored?.application_type, 'web');
    });

    test('a client that names no authentication method gets no secret, and both grants', async function (assert) {
      let response = await server.register({
        redirect_uris: ['http://127.0.0.1/callback'],
      });
      assert.strictEqual(response.status, 201, JSON.stringify(response.body));
      assert.false('client_secret' in response.body, 'no secret returned');
      let stored = await server.storedClient(response.body.client_id);
      assert.strictEqual(stored?.token_endpoint_auth_method, 'none');
      assert.false('client_secret' in (stored ?? {}), 'no secret stored');
      assert.deepEqual(stored?.grant_types, [
        'authorization_code',
        'refresh_token',
      ]);
    });

    test('the scopes a client names are kept only where the provider offers them', async function (assert) {
      let response = await server.register({
        ...loopbackClient,
        scope: 'openid profile boxel:read boxel:write',
      });
      assert.strictEqual(response.status, 201, JSON.stringify(response.body));
      assert.strictEqual(response.body.scope, 'boxel:read boxel:write');

      let onlyUnknown = await server.register({
        ...loopbackClient,
        scope: 'openid email',
      });
      assert.strictEqual(onlyUnknown.status, 201);
      assert.false('scope' in onlyUnknown.body, 'no scope left to keep');
    });

    test("a client's logo, website and key set aren't stored", async function (assert) {
      let response = await server.register({
        ...loopbackClient,
        logo_uri: 'https://client.example.test/logo.png',
        client_uri: 'https://client.example.test/',
        jwks_uri: 'https://client.example.test/jwks.json',
        policy_uri: 'https://client.example.test/policy',
        application_type: 'web',
      });
      assert.strictEqual(response.status, 201, JSON.stringify(response.body));
      let stored = await server.storedClient(response.body.client_id);
      for (let field of ['logo_uri', 'client_uri', 'jwks_uri', 'policy_uri']) {
        assert.false(field in (stored ?? {}), `${field} isn't stored`);
        assert.false(field in response.body, `${field} isn't returned`);
      }
      assert.strictEqual(
        stored?.application_type,
        'native',
        'Boxel decides the application type, not the client',
      );
    });

    test('a client asking for a secret is refused', async function (assert) {
      for (let body of [
        {
          ...loopbackClient,
          token_endpoint_auth_method: 'client_secret_basic',
        },
        { ...loopbackClient, token_endpoint_auth_method: 'client_secret_post' },
        { ...loopbackClient, client_secret: 'chosen-by-the-client' },
      ]) {
        let response = await server.register(body);
        assert.strictEqual(response.status, 400, JSON.stringify(body));
        assert.strictEqual(response.body.error, 'invalid_client_metadata');
      }
      assert.strictEqual(await server.storedClientCount(), 0, 'none stored');
    });

    test('a redirect URI the rules refuse is refused', async function (assert) {
      for (let uri of [
        'http://client.example.test/callback',
        'cursor://anysphere.cursor-retrieval/callback',
        'https://secure.oauth-provider.test/callback',
        'https://pr-1.app-origin.test/callback',
        'https://example-user.boxel.site/callback',
        'https://example-user.boxel.space/callback',
      ]) {
        let response = await server.register({
          ...loopbackClient,
          redirect_uris: ['http://127.0.0.1/callback', uri],
        });
        assert.strictEqual(response.status, 400, uri);
        assert.strictEqual(response.body.error, 'invalid_redirect_uri', uri);
      }
      let none = await server.register({
        ...loopbackClient,
        redirect_uris: [],
      });
      assert.strictEqual(
        none.body.error,
        'invalid_redirect_uri',
        'none listed',
      );
      assert.strictEqual(await server.storedClientCount(), 0, 'none stored');
    });

    test('a registration that is not a JSON object is refused', async function (assert) {
      let notJSON = await server
        .post(REGISTRATION)
        .set('Content-Type', 'application/json')
        .send('{"redirect_uris":');
      assert.strictEqual(notJSON.status, 400);
      assert.strictEqual(notJSON.body.error, 'invalid_client_metadata');

      let notAnObject = await server.register(['http://127.0.0.1/callback']);
      assert.strictEqual(notAnObject.status, 400);
      assert.strictEqual(notAnObject.body.error, 'invalid_client_metadata');

      let form = await server
        .post(REGISTRATION)
        .type('form')
        .send({ redirect_uris: 'http://127.0.0.1/callback' });
      assert.strictEqual(form.status, 400);
      assert.strictEqual(form.body.error, 'invalid_client_metadata');
    });
  });

  module('over the new-client limit', function (hooks) {
    // Behind one proxy of ours, so the caller is the address it forwards.
    let server = setupServer(hooks, {
      trustedProxyHops: 1,
      newClientLimit: {
        perAddress: { requests: 2, windowSeconds: 3600 },
        overall: { requests: 3, windowSeconds: 3600 },
      },
    });

    test('an address over its limit gets 429 and when to retry, keyed on the forwarded address', async function (assert) {
      // Every caller reaches the server through the same load balancer, so
      // the socket's address is the same for all of them.
      let first = { forwardedFor: '203.0.113.9, 192.0.2.10' };
      for (let i = 0; i < 2; i++) {
        let response = await server.register(loopbackClient, first);
        assert.strictEqual(response.status, 201, `registration ${i + 1}`);
      }
      let refused = await server.register(loopbackClient, first);
      assert.strictEqual(refused.status, 429);
      assert.true(
        Number(refused.headers['retry-after']) > 0,
        `Retry-After: ${refused.headers['retry-after']}`,
      );

      let another = await server.register(loopbackClient, {
        forwardedFor: '192.0.2.11',
      });
      assert.strictEqual(
        another.status,
        201,
        'another address still registers: the count is not the socket peer',
      );
    });

    test('a refused registration counts', async function (assert) {
      let caller = { forwardedFor: '192.0.2.20' };
      for (let i = 0; i < 2; i++) {
        let response = await server.register(
          { ...loopbackClient, redirect_uris: ['cursor://callback'] },
          caller,
        );
        assert.strictEqual(response.status, 400);
      }
      let refused = await server.register(loopbackClient, caller);
      assert.strictEqual(refused.status, 429);
    });

    test('the overall limit refuses every address', async function (assert) {
      for (let address of ['192.0.2.31', '192.0.2.32', '192.0.2.33']) {
        let response = await server.register(loopbackClient, {
          forwardedFor: address,
        });
        assert.strictEqual(response.status, 201, address);
      }
      let refused = await server.register(loopbackClient, {
        forwardedFor: '192.0.2.34',
      });
      assert.strictEqual(refused.status, 429);
    });

    test('a caller whose address is unknown is refused', async function (assert) {
      let response = await server.register(loopbackClient);
      assert.strictEqual(response.status, 403);
      assert.strictEqual(await server.storedClientCount(), 0, 'none stored');
    });
  });

  module('with the provider off', function (hooks) {
    let server = setupServer(hooks, { provider: false });

    test('registration is not served', async function (assert) {
      let response = await server.register(loopbackClient);
      assert.notStrictEqual(response.status, 201);
      assert.false('client_id' in (response.body ?? {}), 'no client issued');
      assert.strictEqual(await server.storedClientCount(), 0, 'none stored');
    });
  });
});
