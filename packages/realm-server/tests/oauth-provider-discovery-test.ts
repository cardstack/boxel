import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { inspect } from 'util';
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
  OAuthProviderConfigError,
  readOAuthProviderConfig,
} from '../lib/oauth-provider/config.ts';
import {
  createOAuthProvider,
  startOAuthProvider,
} from '../lib/oauth-provider/provider.ts';
import {
  buildRegistry,
  oauthIssuer,
  registryScopes,
  type OAuthResourceDefinition,
  type OAuthRoute,
  type OAuthScope,
} from '../lib/oauth-provider/registry.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const { copySync, ensureDirSync } = fsExtra;

const DISCOVERY = '/.well-known/oauth-authorization-server';
const OPENID_DISCOVERY = '/.well-known/openid-configuration';

// The realm is mounted at the server's root, so every request here would
// reach it if the provider's routes didn't come first.
const serverURL = new URL('http://127.0.0.1:0/');

// A second resource, with a scope of its own, so the tests can tell the
// registry's scopes from any list the library keeps.
const testResource: OAuthResourceDefinition = {
  path: '/_test-resource',
  name: 'Test resource',
  description: 'A resource only tests declare.',
  coverage: 'This covers nothing outside the tests.',
  scopes: [
    {
      name: 'boxel:read',
      description: 'Read.',
      label: 'Read',
      caution: false,
      routes: [{ on: 'server', method: 'GET', path: '/_test-resource' }],
    },
    {
      name: 'test:probe',
      description: 'Probe.',
      label: 'Probe',
      caution: false,
      routes: [{ on: 'server', method: 'POST', path: '/_test-resource' }],
    },
  ],
  clients: 'pre-registered',
};

async function start({
  dbAdapter,
  publisher,
  runner,
  provider,
}: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
  provider?: boolean;
}): Promise<Server> {
  let realmsRootPath = join(dirSync().name, 'realm_server_oauth_discovery');
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
    ...(provider
      ? {
          oauthProvider: testOAuthProviderConfig(),
          oauthTestResources: [testResource],
        }
      : {}),
  });
  return testRealmHttpServer;
}

// Whether the provider is on changes how the server answers, not what it
// indexes, so both setups share one template.
function setupServer(hooks: NestedHooks, { provider }: { provider: boolean }) {
  let server: Server | undefined;
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
      server = await start({ dbAdapter, publisher, runner, provider });
    },
    afterEach: async () => {
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });
  // Every request carries the server's own host unless a test names another,
  // so the realm at the root claims every path it would if the provider's
  // routes didn't come first.
  return {
    get: (path: string, host = serverURL.host) =>
      supertest(server!).get(path).set('Host', host),
    options: (path: string) =>
      supertest(server!).options(path).set('Host', serverURL.host),
  };
}

module(basename(import.meta.filename), function () {
  module('reading the configuration', function () {
    const secureOriginURL = testOAuthSecureOriginURL;
    const secret = 'do-not-print-this-secret';

    test('the provider is off unless the flag is exactly "true"', function (assert) {
      for (let value of [undefined, '', 'false', '1', 'TRUE']) {
        assert.strictEqual(
          readOAuthProviderConfig(
            {
              BOXEL_OAUTH_PROVIDER_ENABLED: value,
              // Never read while the flag is off, even when malformed.
              BOXEL_OAUTH_CONFIG: secret,
            },
            { secureOriginURL: undefined },
          ),
          undefined,
          `off for ${JSON.stringify(value)}`,
        );
      }
    });

    test('returns the cookie keys and key set when the flag is on', function (assert) {
      let config = testOAuthProviderConfig();
      assert.deepEqual(
        readOAuthProviderConfig(
          {
            BOXEL_OAUTH_PROVIDER_ENABLED: 'true',
            BOXEL_OAUTH_CONFIG: JSON.stringify(config),
          },
          { secureOriginURL },
        ),
        config,
      );
    });

    test('fails clearly, without printing a value, when the flag is on and the setup is incomplete', function (assert) {
      let validConfig = JSON.stringify(testOAuthProviderConfig());
      let cases: {
        name: string;
        config: string | undefined;
        secureOriginURL?: URL;
        message: RegExp;
      }[] = [
        {
          name: 'no secure origin',
          config: validConfig,
          secureOriginURL: undefined,
          message: /no secureOriginURL/,
        },
        {
          name: 'no configuration',
          config: undefined,
          message: /BOXEL_OAUTH_CONFIG is not set/,
        },
        {
          name: 'not JSON',
          config: secret,
          message: /BOXEL_OAUTH_CONFIG is not valid JSON/,
        },
        {
          name: 'not an object',
          config: JSON.stringify([secret]),
          message: /must be a JSON object/,
        },
        {
          name: 'no cookie keys',
          config: JSON.stringify({ cookieKeys: [], jwks: { keys: [{}] } }),
          message: /cookieKeys must be a non-empty list/,
        },
        {
          name: 'a cookie key that is not a string',
          config: JSON.stringify({ cookieKeys: [1], jwks: { keys: [{}] } }),
          message: /cookieKeys must be a non-empty list/,
        },
        {
          name: 'no key set',
          config: JSON.stringify({ cookieKeys: [secret] }),
          message: /jwks must be a JSON Web Key Set/,
        },
        {
          name: 'an empty key set',
          config: JSON.stringify({ cookieKeys: [secret], jwks: { keys: [] } }),
          message: /jwks must be a JSON Web Key Set/,
        },
      ];
      for (let testCase of cases) {
        let thrown: unknown;
        try {
          readOAuthProviderConfig(
            {
              BOXEL_OAUTH_PROVIDER_ENABLED: 'true',
              BOXEL_OAUTH_CONFIG: testCase.config,
            },
            {
              secureOriginURL:
                'secureOriginURL' in testCase
                  ? testCase.secureOriginURL
                  : secureOriginURL,
            },
          );
        } catch (error) {
          thrown = error;
        }
        assert.true(
          thrown instanceof OAuthProviderConfigError,
          `${testCase.name}: throws`,
        );
        let message = (thrown as Error | undefined)?.message ?? '';
        assert.true(
          testCase.message.test(message),
          `${testCase.name}: says why (${message})`,
        );
        assert.false(
          message.includes(secret),
          `${testCase.name}: prints no value`,
        );
      }
    });

    test('a key the library refuses fails clearly, without printing the key', function (assert) {
      let config = testOAuthProviderConfig();
      // An RSA key missing one private parameter: well-formed enough for the
      // configuration's own check, refused by the library's.
      let { dp: _dp, ...key } = config.jwks.keys[0];
      let thrown: unknown;
      try {
        createOAuthProvider({
          issuer: 'https://a.test',
          config: { ...config, jwks: { keys: [key] } },
          registry: buildRegistry('https://a.test'),
        });
      } catch (error) {
        thrown = error;
      }
      assert.true(thrown instanceof OAuthProviderConfigError, 'throws');
      // What a boot failure prints, cause and all.
      let printed = inspect(thrown, { depth: Infinity });
      assert.true(
        /jwks\.keys\[0\]\.dp/.test(printed),
        `says which key and parameter (${(thrown as Error).message})`,
      );
      for (let parameter of ['d', 'p', 'q', 'dq', 'qi']) {
        assert.false(
          printed.includes(String(key[parameter])),
          `prints no ${parameter}`,
        );
      }
    });
  });

  module('starting the provider', function () {
    test('needs a secure origin', function (assert) {
      assert.throws(
        () =>
          startOAuthProvider({
            serverURL: new URL('https://realms.example.test/'),
            config: testOAuthProviderConfig(),
            hasSecureOrigin: false,
          }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /no secureOriginURL/.test(error.message),
      );
    });

    test('refuses a server URL with a path, since discovery is served at the root', function (assert) {
      assert.throws(
        () =>
          startOAuthProvider({
            serverURL: new URL('https://realms.example.test/boxel/'),
            config: testOAuthProviderConfig(),
            hasSecureOrigin: true,
          }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /must have no path/.test(error.message),
      );
    });

    test('takes its issuer from the server URL, with no trailing slash', function (assert) {
      let provider = startOAuthProvider({
        serverURL: new URL('https://realms.example.test/'),
        config: testOAuthProviderConfig(),
        hasSecureOrigin: true,
      });
      assert.strictEqual(provider.issuer, 'https://realms.example.test');
    });
  });

  module('the registry', function () {
    test("derives the issuer and each resource's identifier from the server URL, with no trailing slash", function (assert) {
      assert.strictEqual(
        oauthIssuer(new URL('https://realms.example.test/')),
        'https://realms.example.test',
      );
      let registry = buildRegistry('https://realms.example.test/', [
        { ...testResource, path: '/_test-resource/' },
      ]);
      assert.deepEqual(
        registry.map(({ id }) => id),
        [
          'https://realms.example.test/mcp',
          'https://realms.example.test/_test-resource',
        ],
      );
    });

    test("lists each resource's scopes once, in order", function (assert) {
      assert.deepEqual(registryScopes(buildRegistry('https://a.test')), [
        'boxel:read',
        'boxel:write',
      ]);
      assert.deepEqual(
        registryScopes(buildRegistry('https://a.test', [testResource])),
        ['boxel:read', 'boxel:write', 'test:probe'],
      );
    });

    test('is frozen, all the way down', function (assert) {
      let registry = buildRegistry('https://a.test', [testResource]);
      assert.true(Object.isFrozen(registry), 'the list');
      for (let resource of registry) {
        assert.true(Object.isFrozen(resource), `${resource.id}`);
        assert.true(Object.isFrozen(resource.scopes), `${resource.id} scopes`);
        for (let scope of resource.scopes) {
          assert.true(Object.isFrozen(scope), `${resource.id} ${scope.name}`);
          assert.true(
            Object.isFrozen(scope.routes),
            `${resource.id} ${scope.name} routes`,
          );
          for (let route of scope.routes) {
            assert.true(
              Object.isFrozen(route),
              `${resource.id} ${scope.name} ${route.method} ${route.path}`,
            );
          }
        }
      }
      assert.throws(() => {
        (registry[0].scopes as OAuthScope[]).push(testResource.scopes[1]);
      }, TypeError);
      assert.throws(() => {
        (registry[0].scopes[0].routes as OAuthRoute[]).push({
          on: 'server',
          method: 'DELETE',
          path: '/_delete-realm',
        });
      }, TypeError);
      assert.false(
        Object.isFrozen(testResource.scopes),
        "the caller's definition is left as it was",
      );
      assert.false(
        Object.isFrozen(testResource.scopes[0].routes),
        "the caller's routes are left as they were",
      );
    });

    test('refuses two resources with one identifier', function (assert) {
      assert.throws(
        () =>
          buildRegistry('https://a.test', [{ ...testResource, path: '/mcp' }]),
        /declared twice/,
      );
    });
  });

  module('with the provider off', function (hooks) {
    let request = setupServer(hooks, { provider: false });

    test('serves no discovery and none of the provider routes', async function (assert) {
      for (let path of [
        DISCOVERY,
        OPENID_DISCOVERY,
        '/_oauth-provider/auth',
        '/_oauth-provider/jwks',
      ]) {
        let response = await request.get(path);
        assert.strictEqual(response.status, 404, `${path} is not found`);
      }
    });

    test('a preflight allows MCP-Protocol-Version, and a response exposes WWW-Authenticate', async function (assert) {
      let preflight = await request
        .options('/_public-realms')
        .set('Origin', 'https://client.example.test')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'mcp-protocol-version');
      assert.strictEqual(preflight.status, 204);
      assert.true(
        /\bMCP-Protocol-Version\b/i.test(
          preflight.headers['access-control-allow-headers'] ?? '',
        ),
        'MCP-Protocol-Version is allowed',
      );

      // A realm-server route refusing a request without a session, where a
      // challenge would be. A realm's own responses carry their own list.
      let response = await request
        .get('/_public-realms')
        .set('Origin', 'https://client.example.test');
      assert.strictEqual(response.status, 401);
      assert.true(
        /\bWWW-Authenticate\b/i.test(
          response.headers['access-control-expose-headers'] ?? '',
        ),
        'WWW-Authenticate is exposed',
      );
    });
  });

  module('with the provider on', function (hooks) {
    let request = setupServer(hooks, { provider: true });

    test('serves the discovery document, listing only what Boxel serves', async function (assert) {
      let response = await request
        .get(DISCOVERY)
        .set('Origin', 'https://client.example.test');
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body, {
        issuer: 'http://127.0.0.1:0',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['boxel:read', 'boxel:write', 'test:probe'],
      });
      assert.strictEqual(
        response.headers['access-control-allow-origin'],
        '*',
        'any origin may read it',
      );
    });

    test("answers only on the issuer's host", async function (assert) {
      // Published sites are served on other hosts, from pages users write.
      for (let path of [DISCOVERY, '/_oauth-provider/auth']) {
        let response = await request.get(path, 'site.published.example.test');
        assert.strictEqual(
          response.status,
          404,
          `${path} on another host is not found`,
        );
      }
    });

    test('serves no OpenID discovery, signing keys, or endpoint not yet built', async function (assert) {
      for (let path of [
        OPENID_DISCOVERY,
        '/_oauth-provider/jwks',
        '/_oauth-provider/auth',
        '/_oauth-provider/token',
      ]) {
        let response = await request.get(path);
        assert.strictEqual(response.status, 404, `${path} is not found`);
      }
    });

    test('the realm at the root still answers its own routes', async function (assert) {
      let response = await request
        .get('/person-1.json')
        .set('Accept', 'application/vnd.card+source');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        JSON.parse(response.text).data.attributes.firstName,
        'Mango',
      );
    });
  });
});
