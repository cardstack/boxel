import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  DEFAULT_PERMISSIONS,
  rri,
  SupportedMimeType,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWTForRealmURL,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
  waitUntil,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  addUserKey,
  mintKeyWriteTicket,
  type KeyWriteAction,
} from '../lib/user-keys.ts';

// ============================================================================
// A published realm serving a key shared into its source. The source's owner
// shares a key that allows anonymous use into the source realm, approves a
// card's shared-key `callApi` there, and the source's policy opens that call
// to people who aren't signed in. Publishing the source gives the copy the
// snapshot of that policy, of which it keeps only the grants on such calls,
// and the copy reads the share's bindings through its source. So a visitor who
// isn't signed in is served on the published site, and the published realm
// still admits no write.
// ============================================================================

const testRealm2URL = 'http://127.0.0.1:4445/test/';
const publishedRealmURL = 'http://testuser.localhost:4445/weather-site/';
const secureOriginURL = new URL(
  'https://secure.published-shared-key.test/secure',
);
const VENDOR_PORT = 4538;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const DESTINATION = `${VENDOR}/`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@published-key-owner:localhost';
const STRANGER = '@published-key-stranger:localhost';
const VALUE = 'weather-key-published-3be41c';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// `forecast` sends the realm's shared key; `myStations` the invoking user's
// own.
function weatherModule(field = 'login') {
  return `import { CardDef } from '@cardstack/base/card-api';
import { operation } from '@cardstack/base/operations';

export class Weather extends CardDef {
  static displayName = 'Weather';

  @operation static forecast = {
    base: 'callApi',
    label: 'Read the forecast',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{apiKey}}' },
    graphql: { document: 'query { viewer { ${field} } }' },
  };

  @operation static myStations = {
    base: 'callApi',
    label: 'List your weather stations',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{userKey}}' },
    graphql: { document: 'query { viewer { id } }' },
  };
}
`;
}

const ANONYMOUS = 'actor() == "anonymous"';

module(basename(import.meta.filename), function (hooks) {
  let testRealmServer: Awaited<
    ReturnType<typeof runTestRealmServer>
  >['testRealmServer'];
  let server: Server;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;
  let vendor: StubVendor;
  let source: Realm;

  setupCatalogTestSubset(hooks);

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });

  // Each call writes the server's realm into its own directory: the template
  // build runs before any test, and every test starts from a copy of its
  // database with a fresh directory.
  async function start({
    dbAdapter: adapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let realmsRootPath = join(dirSync().name, 'realm_server_4');
    let testRealmDir = join(realmsRootPath, 'test');
    ensureDirSync(testRealmDir);
    copySync(fixtureDir('blank'), testRealmDir);
    let result = await runTestRealmServer({
      virtualNetwork: createVirtualNetwork(),
      testRealmDir,
      realmsRootPath,
      realmURL: new URL(testRealm2URL),
      dbAdapter: adapter,
      publisher,
      runner,
      matrixURL,
      secureOriginURL,
      permissions: {
        '*': ['read'],
        [OWNER]: DEFAULT_PERMISSIONS,
      },
      domainsForPublishedRealms: {
        boxelSpace: 'localhost',
        boxelSite: 'localhost:4445',
      },
    });
    testRealmServer = result.testRealmServer;
    server = result.testRealmHttpServer;
    request = supertest(server);
  }

  async function stop() {
    await closeServer(server);
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (adapter, publisher, runner) => {
      dbAdapter = adapter;
      keyring = installSecretsKeyring(
        await new LocalKeyProvider().loadDataKeys(),
      );
      configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
      await start({ dbAdapter: adapter, publisher, runner });
      vendor.requests.length = 0;
    },
    afterEach: async () => {
      resetOutbound();
      resetSecretsAtRest();
      await stop();
    },
  });

  // The source workspace: a weather card whose `forecast` the policy opens to
  // anyone, signed in or not, and whose `create` it grants to any signed-in
  // caller. The policy names the card's type by the source's own URL, as an
  // owner writing it in the source would.
  hooks.beforeEach(async function () {
    let created = await request
      .post('/_create-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: OWNER, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            attributes: {
              name: 'Weather',
              endpoint: `weather-${uuidv4()}`,
            },
          },
        }),
      );
    let sourceURL = created.body.data.id as string;
    source =
      (await testRealmServer.testingOnlyReconciler.lookupOrMount(sourceURL))!;
    let weather = { module: rri(`${sourceURL}weather`), name: 'Weather' };
    await source.write('weather.gts', weatherModule());
    await source.write(
      'today.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: './weather', name: 'Weather' } },
        },
      }),
    );
    await source.write(
      'policies/site.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            rules: [
              {
                targetType: weather,
                grants: [
                  { operation: 'forecast' },
                  { operation: 'forecast', where: ANONYMOUS },
                  { operation: 'myStations' },
                  { operation: 'create' },
                ],
              },
            ],
          },
          meta: { adoptsFrom: REALM_POLICY },
        },
      }),
    );
    await source.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Weather',
        policy: `${sourceURL}policies/site`,
      }),
    );
    await source.indexing();
  });

  async function ticket(
    action: KeyWriteAction,
    {
      keyId = null,
      realm = null,
    }: { keyId?: string | null; realm?: string | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, OWNER, {
        action,
        keyId,
        realmURL: realm,
        shareId: null,
      })
    ).ticket;
  }

  // Approves `forecast` in the source, filled from the share, for interactive
  // use, naming the fingerprint the approval screen's preview shows.
  async function approveForecast(shareId: string) {
    let shown = (
      await request
        .get('/_key-bindings/preview')
        .query({
          realm: source.url,
          module: `${source.url}weather`,
          name: 'Weather',
          operation: 'forecast',
        })
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
    ).body.data.attributes as {
      slots: { slot: string; fingerprint: string }[];
    };
    return await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm: source.url,
            operations: [
              {
                codeRef: { module: `${source.url}weather`, name: 'Weather' },
                operation: 'forecast',
                expectedDestination: DESTINATION,
                slots: Object.fromEntries(
                  shown.slots.map((s) => [
                    s.slot,
                    { shareId, expectedFingerprint: s.fingerprint },
                  ]),
                ),
              },
            ],
            interactive: true,
            dailyBudgets: { [shareId]: 500 },
          },
        },
      });
  }

  // A key its owner lets people who aren't signed in use, shared into the
  // source and approved there for `forecast`.
  async function shareIntoSource() {
    let key = await addUserKey(dbAdapter, keyring, {
      owner: OWNER,
      name: 'weather',
      value: VALUE,
      anonymous: true,
      ticket: await ticket('add'),
    });
    let shared = await request
      .post('/_key-shares')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-share',
          attributes: { realm: source.url, keyId: key.id, label: 'Weather' },
        },
        meta: {
          ticket: await ticket('share', { keyId: key.id, realm: source.url }),
        },
      });
    if (shared.status !== 201) {
      throw new Error(`could not share: ${shared.status} ${shared.text}`);
    }
    let shareId = shared.body.data.id as string;
    let approved = await approveForecast(shareId);
    if (approved.status !== 201) {
      throw new Error(`could not approve: ${approved.status} ${approved.text}`);
    }
    return { shareId };
  }

  async function publish() {
    let response = await request
      .post('/_publish-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: OWNER, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(JSON.stringify({ sourceRealmURL: source.url, publishedRealmURL }));
    if (response.status !== 202) {
      throw new Error(`could not publish: ${response.status} ${response.text}`);
    }
    let { host, pathname } = new URL(publishedRealmURL);
    await testRealmServer.testingOnlyReconcile();
    await waitUntil(
      async () =>
        (
          await request
            .get(`${pathname}_readiness-check`)
            .set('Host', host)
            .set('Accept', 'application/vnd.api+json')
        ).status === 200,
      {
        timeout: 120_000,
        interval: 500,
        timeoutMessage: 'published realm never passed its readiness check',
      },
    );
    return (await testRealmServer.testingOnlyReconciler.lookupOrMount(
      publishedRealmURL,
    ))!;
  }

  function signedIn(
    realmURL: string,
    user: string,
    permissions: RealmPermissions['user'],
  ) {
    return `Bearer ${createJWTForRealmURL({
      realmURL,
      realmServerURL: new URL(testRealm2URL).origin + '/',
      user,
      permissions,
    })}`;
  }

  // Invokes `name` on the realm's `today` card, as `auth` or, without it, as
  // a visitor who isn't signed in.
  async function invoke(realmURL: string, name: string, auth?: string) {
    let { host, pathname } = new URL(realmURL);
    let req = request
      .post(`${pathname}_operations`)
      .set('Host', host)
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS);
    if (auth) {
      req = req.set('Authorization', auth);
    }
    let response = await req.send(
      JSON.stringify({
        'boxel:operations': [
          { op: 'invoke', 'boxel:name': name, href: `${realmURL}today` },
        ],
      }),
    );
    return {
      status: response.status,
      body: response.body,
      code: response.body?.errors?.[0]?.code as string | undefined,
    };
  }

  // What the realm tells a visitor who isn't signed in about `forecast` on
  // its `today` card, before they invoke it.
  async function readiness(realmURL: string) {
    let { host, pathname } = new URL(realmURL);
    let response = await request
      .post(`${pathname}_capabilities`)
      .set('Host', host)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .send(
        JSON.stringify({
          checks: [
            {
              operation: 'forecast',
              target: `${realmURL}today`,
              readiness: true,
            },
          ],
        }),
      );
    return response.body?.checks?.[0];
  }

  async function shareSpent(shareId: string) {
    let rows = await dbAdapter.execute(
      `SELECT count FROM rate_limit_budgets WHERE budget_key = $1 AND period = 'day'`,
      { bind: [JSON.stringify(['key-limit', 'share', shareId])] },
    );
    return rows.length === 0 ? 0 : Number(rows[0].count);
  }

  test("a visitor who isn't signed in is served on the published realm through its source's share", async function (assert) {
    let { shareId } = await shareIntoSource();
    let published = await publish();

    assert.deepEqual(
      await published.getRealmPolicy(),
      { card: `${publishedRealmURL}policies/site` },
      "the published realm is governed by its snapshot of the source's policy",
    );
    assert.strictEqual(
      (await readiness(publishedRealmURL))?.readiness,
      'ready',
      'a visitor is told the call is ready on the published realm',
    );

    let served = await invoke(publishedRealmURL, 'forecast');
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(vendor.requests.length, 1, 'one request was sent');
    assert.strictEqual(
      vendor.requests[0].headers.authorization,
      `Bearer ${VALUE}`,
      "the source's shared key is sent for the visitor",
    );

    let stranger = await invoke(
      publishedRealmURL,
      'forecast',
      signedIn(publishedRealmURL, STRANGER, ['read']),
    );
    assert.strictEqual(
      stranger.status,
      200,
      'a signed-in caller is served on the published realm too',
    );
    assert.strictEqual(
      await shareSpent(shareId),
      2,
      "both calls spent the source share's daily budget",
    );
  });

  test('the published realm keeps only the grants on calls that send a shared key, so it admits no write', async function (assert) {
    await shareIntoSource();
    let published = await publish();

    let grants = (await published.getCompiledPolicy())?.rules.flatMap((rule) =>
      rule.grants.map((grant) => grant.operation),
    );
    assert.deepEqual(
      grants,
      ['forecast', 'forecast'],
      "only the shared-key call's grants are kept: not the personal-key call's, nor the create",
    );

    let { host, pathname } = new URL(publishedRealmURL);
    let create = await request
      .post(pathname)
      .set('Host', host)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', signedIn(publishedRealmURL, STRANGER, ['read']))
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: `${publishedRealmURL}weather`,
                name: 'Weather',
              },
            },
          },
        }),
      );
    assert.strictEqual(
      create.status,
      403,
      "a signed-in caller's create is refused on the published realm",
    );
    let sourceCreate = await request
      .post(new URL(source.url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', signedIn(source.url, STRANGER, []))
      .send(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: { module: `${source.url}weather`, name: 'Weather' },
            },
          },
        }),
      );
    assert.strictEqual(
      sourceCreate.status,
      201,
      "the source's policy still admits the create in the source",
    );
  });

  test("a call the source's owner approved again for newer code is refused on an older snapshot, and stays active in the source", async function (assert) {
    let { shareId } = await shareIntoSource();
    await publish();

    await source.write('weather.gts', weatherModule('name'));
    await source.indexing();
    let owner = signedIn(source.url, OWNER, ['read', 'write', 'realm-owner']);
    let changed = await invoke(source.url, 'forecast', owner);
    assert.strictEqual(
      changed.code,
      'binding-needs-reapproval',
      "the source's own call finds its request changed",
    );
    let reapproved = await approveForecast(shareId);
    assert.strictEqual(
      reapproved.status,
      201,
      `approved again in the source: ${reapproved.text}`,
    );

    let stale = await invoke(publishedRealmURL, 'forecast');
    assert.strictEqual(stale.status, 409, JSON.stringify(stale.body));
    assert.strictEqual(stale.code, 'binding-needs-reapproval');
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');

    let rows = await dbAdapter.execute(
      `SELECT state FROM key_bindings WHERE realm_url = $1`,
      { bind: [source.url] },
    );
    assert.deepEqual(
      rows.map((row) => row.state),
      ['active'],
      "the source's binding is left active",
    );
    let fromSource = await invoke(source.url, 'forecast', owner);
    assert.strictEqual(fromSource.status, 200, 'the source is still served');

    await publish();
    let republished = await invoke(publishedRealmURL, 'forecast');
    assert.strictEqual(
      republished.status,
      200,
      'a republished snapshot is served again',
    );
  });
});
