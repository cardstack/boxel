import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
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
import { shareKey } from '../lib/key-shares.ts';
import { setShareLimits } from '../lib/key-limits.ts';

// ============================================================================
// Anonymous use of a share, end to end against the stub vendor. A realm's
// policy opens a card's `callApi` operations to callers who aren't signed in,
// and the owner of the key a share holds approves anonymous use of it, naming
// the anonymous cap. A visitor who isn't signed in is served only when both
// are present: counted by address against the share's per-person rate, and
// together with every other such visitor against the anonymous cap, which
// sits inside the share's daily budget. A personal key never fills for such
// a visitor.
// ============================================================================

const TEAM = 'http://127.0.0.1:4444/anonymous-key-use-team/';
const ORG = 'http://127.0.0.1:4444/anonymous-key-use-org/';
const TEAM_POLICY = `${ORG}policies/team`;
const secureOriginURL = new URL('https://secure.anonymous-key-use.test/secure');
const VENDOR_PORT = 4536;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const DESTINATION = `${VENDOR}/`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@anonymous-owner:localhost';
const READER = '@anonymous-reader:localhost';
const ORG_ADMIN = '@anonymous-org-admin:localhost';
const VALUE = 'weather-key-anonymous-5d1e07';
const PERSONAL_VALUE = 'ghp-anonymous-personal-key-81c2fa';

// Callers' addresses come from the ranges reserved for documentation.
const VISITOR = '192.0.2.10';
const OTHER_VISITOR = '198.51.100.20';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// A public weather widget: `forecast` and `alerts` send the realm's shared
// key, `myStations` the invoking user's own.
const WEATHER_MODULE = `import { CardDef } from '@cardstack/base/card-api';
import { operation } from '@cardstack/base/operations';

export class Weather extends CardDef {
  static displayName = 'Weather';

  @operation static forecast = {
    base: 'callApi',
    label: 'Read the forecast',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{apiKey}}' },
    graphql: { document: 'query { viewer { login } }' },
  };

  @operation static alerts = {
    base: 'callApi',
    label: 'Read the weather alerts',
    url: '${VENDOR}/graphql',
    headers: { authorization: 'Bearer {{apiKey}}' },
    graphql: { document: 'query { viewer { name } }' },
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

const WEATHER = { module: `${TEAM}weather`, name: 'Weather' };

const ANONYMOUS = 'actor() == "anonymous"';

// `forecast` and `myStations` are opened to callers who aren't signed in;
// `alerts` only to signed-in ones. Every operation is opened to signed-in
// callers.
const POLICY = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        {
          targetType: { module: rri(WEATHER.module), name: WEATHER.name },
          grants: [
            { operation: 'forecast' },
            { operation: 'alerts' },
            { operation: 'myStations' },
            { operation: 'forecast', where: ANONYMOUS },
            { operation: 'myStations', where: ANONYMOUS },
          ],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
});

module(basename(import.meta.filename), function (hooks) {
  let team: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;
  let vendor: StubVendor;

  setupCatalogTestSubset(hooks);

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });

  async function start({
    dbAdapter: adapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      clientAddress: { trustedProxyHops: 1, infraAddresses: [] },
      secureOriginURL,
      realms: [
        {
          realmURL: new URL(TEAM),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Weather',
              policy: TEAM_POLICY,
            }),
            'weather.gts': WEATHER_MODULE,
          },
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
            [READER]: ['read', 'write'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/team.json': POLICY,
          },
          permissions: { [ORG_ADMIN]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter: adapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    team = result.realms.find((realm) => realm.url === TEAM)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [team, org]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
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

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm = null,
    }: { keyId?: string | null; realm?: string | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realm,
        shareId: null,
      })
    ).ticket;
  }

  async function addKey(value = VALUE) {
    return await addUserKey(dbAdapter, keyring, {
      owner: OWNER,
      name: 'weather',
      value,
      ticket: await ticket(OWNER, 'add'),
    });
  }

  async function addShare() {
    let key = await addKey();
    return await shareKey(dbAdapter, {
      owner: OWNER,
      realm: TEAM,
      keyId: key.id,
      label: 'Team weather',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: TEAM }),
    });
  }

  // Approves the named operations, every slot filled with `fill`, naming the
  // fingerprints the approval screen's preview shows.
  async function approve(
    names: string[],
    fill: { keyId: string } | { shareId: string },
    attributes: Record<string, unknown> = {},
  ) {
    let operations = [];
    for (let name of names) {
      let shown = (
        await request
          .get('/_key-bindings/preview')
          .query({
            realm: TEAM,
            module: WEATHER.module,
            name: WEATHER.name,
            operation: name,
          })
          .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      ).body.data.attributes as {
        slots: { slot: string; fingerprint: string }[];
      };
      operations.push({
        codeRef: WEATHER,
        operation: name,
        expectedDestination: DESTINATION,
        slots: Object.fromEntries(
          shown.slots.map((s) => [
            s.slot,
            { ...fill, expectedFingerprint: s.fingerprint },
          ]),
        ),
      });
    }
    return await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: { realm: TEAM, operations, ...attributes },
        },
      });
  }

  function onWeather(name: string) {
    return JSON.stringify({
      'boxel:operations': [
        {
          op: 'invoke',
          'boxel:name': name,
          data: {
            meta: {
              adoptsFrom: { module: rri(WEATHER.module), name: WEATHER.name },
            },
          },
        },
      ],
    });
  }

  // Invokes from a card someone opened: signed in as `user`, or, without
  // one, as a visitor who isn't signed in, from `address`.
  async function invoke(
    name: string,
    { user, address = VISITOR }: { user?: string; address?: string } = {},
  ) {
    let req = request
      .post(`${new URL(TEAM).pathname}_operations`)
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .set('X-Forwarded-For', address);
    if (user) {
      req = req.set(
        'Authorization',
        `Bearer ${createJWT(team, user, ['read', 'write'])}`,
      );
    }
    let response = await req.send(onWeather(name));
    return {
      status: response.status,
      body: response.body,
      code: response.body?.errors?.[0]?.code as string | undefined,
    };
  }

  // What the realm tells a visitor who isn't signed in about an operation,
  // before they invoke it.
  async function readiness(name: string, address = VISITOR) {
    let response = await request
      .post(`${new URL(TEAM).pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('X-Forwarded-For', address)
      .send(
        JSON.stringify({
          checks: [
            {
              operation: name,
              target: {
                type: { module: rri(WEATHER.module), name: WEATHER.name },
              },
              readiness: true,
            },
          ],
        }),
      );
    return response.body?.answers?.[0];
  }

  async function used(key: unknown[]) {
    let rows = await dbAdapter.execute(
      `SELECT count FROM rate_limit_budgets WHERE budget_key = $1 AND period = 'day'`,
      { bind: [JSON.stringify(key)] },
    );
    return rows.length === 0 ? 0 : Number(rows[0].count);
  }

  test('the policy opens a callApi that sends only shared keys to callers who are not signed in, and warns about one that sends their own key', async function (assert) {
    let policy = await team.getCompiledPolicy();
    assert.deepEqual(
      policy?.issues.map(({ code, path, severity }) => ({
        code,
        path,
        severity,
      })),
      [
        {
          code: 'anonymous-grant-user-key',
          path: 'rules[0].grants[4].operation',
          severity: 'warning',
        },
      ],
      'the grant on the operation that sends the caller’s own key admits none of them, and is kept for signed-in callers',
    );
    assert.deepEqual(
      policy?.anonymous?.operations,
      ['forecast'],
      'only the operation that sends a shared key is open to them',
    );
  });

  test('a visitor who is not signed in is refused until the share is approved for anonymous use and the policy opens the operation to them, and then served', async function (assert) {
    let share = await addShare();
    let signedInOnly = await approve(
      ['forecast', 'alerts'],
      { shareId: share.id },
      { interactive: true, dailyBudgets: { [share.id]: 500 } },
    );
    assert.strictEqual(
      signedInOnly.status,
      201,
      JSON.stringify(signedInOnly.body),
    );
    assert.false(signedInOnly.body.data[0].attributes.anonymous);

    let refused = await invoke('forecast');
    assert.strictEqual(refused.status, 401, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'anonymous-use-not-approved');
    assert.strictEqual(
      (await readiness('forecast'))?.readiness,
      'needs-sign-in',
      'readiness tells the visitor that signing in is what serves them',
    );

    let noCap = await approve(
      ['forecast', 'alerts'],
      { shareId: share.id },
      { interactive: true, anonymous: true },
    );
    assert.strictEqual(noCap.status, 400, JSON.stringify(noCap.body));
    assert.true(
      JSON.stringify(noCap.body).includes('anonymous cap'),
      'the first anonymous approval names the anonymous cap',
    );
    let overBudget = await approve(
      ['forecast', 'alerts'],
      { shareId: share.id },
      {
        interactive: true,
        anonymous: true,
        anonymousCaps: { [share.id]: 501 },
      },
    );
    assert.strictEqual(
      overBudget.status,
      400,
      'the cap is at most the share’s daily budget',
    );
    let notInteractive = await approve(
      ['forecast'],
      { shareId: share.id },
      { anonymous: true, anonymousCaps: { [share.id]: 100 } },
    );
    assert.strictEqual(
      notInteractive.status,
      400,
      'anonymous use is approved with interactive use',
    );

    let approved = await approve(
      ['forecast', 'alerts'],
      { shareId: share.id },
      {
        interactive: true,
        anonymous: true,
        anonymousCaps: { [share.id]: 100 },
      },
    );
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    assert.true(approved.body.data[0].attributes.anonymous);
    let [row] = await dbAdapter.execute(
      `SELECT anonymous_daily_cap FROM key_shares WHERE id = $1`,
      { bind: [share.id] },
    );
    assert.strictEqual(Number(row.anonymous_daily_cap), 100);

    assert.strictEqual((await readiness('forecast'))?.readiness, 'ready');
    let served = await invoke('forecast');
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(vendor.requests.length, 1);
    assert.strictEqual(
      vendor.requests[0].headers.authorization,
      `Bearer ${VALUE}`,
      'the share’s key is sent for the visitor',
    );

    let notOpened = await invoke('alerts');
    assert.notStrictEqual(
      notOpened.status,
      200,
      'an operation the policy opens only to signed-in callers is refused, whatever the binding allows',
    );
    assert.strictEqual(vendor.requests.length, 1, 'nothing more was sent');

    let signedIn = await invoke('alerts', { user: READER });
    assert.strictEqual(
      signedIn.status,
      200,
      'a signed-in reader is served as before',
    );

    let pipelinesOnly = await approve(['forecast'], { shareId: share.id });
    assert.strictEqual(pipelinesOnly.status, 201);
    assert.false(
      pipelinesOnly.body.data[0].attributes.anonymous,
      'approving again without anonymous use returns the binding to signed-in callers',
    );
  });

  test("a visitor's address is held to the share's rate, and other addresses are not", async function (assert) {
    let share = await addShare();
    await approve(
      ['forecast'],
      { shareId: share.id },
      {
        interactive: true,
        dailyBudgets: { [share.id]: 500 },
        anonymous: true,
        anonymousCaps: { [share.id]: 100 },
      },
    );
    await setShareLimits(dbAdapter, {
      user: OWNER,
      shareId: share.id,
      changes: { rateBurst: 1, rateRefillPerMinute: 0.01 },
    });
    let first = await invoke('forecast');
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    let second = await invoke('forecast');
    assert.strictEqual(second.status, 429, JSON.stringify(second.body));
    assert.strictEqual(second.code, 'rate-limited');
    assert.strictEqual(
      (await readiness('forecast'))?.readiness,
      'rate-limited',
      'readiness says so for that address',
    );
    let elsewhere = await invoke('forecast', { address: OTHER_VISITOR });
    assert.strictEqual(
      elsewhere.status,
      200,
      'another address has a bucket of its own',
    );
    let reader = await invoke('forecast', { user: READER });
    assert.strictEqual(
      reader.status,
      200,
      'a signed-in reader has a bucket of their own',
    );
    assert.strictEqual(vendor.requests.length, 3);
  });

  test("the anonymous cap is shared by every visitor who isn't signed in, and spending it leaves the share's budget for signed-in readers", async function (assert) {
    let share = await addShare();
    await approve(
      ['forecast'],
      { shareId: share.id },
      {
        interactive: true,
        dailyBudgets: { [share.id]: 500 },
        anonymous: true,
        anonymousCaps: { [share.id]: 1 },
      },
    );
    let first = await invoke('forecast');
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    let capped = await invoke('forecast', { address: OTHER_VISITOR });
    assert.strictEqual(capped.status, 429, JSON.stringify(capped.body));
    assert.strictEqual(capped.code, 'over-budget');
    assert.true(
      String(capped.body.errors[0].detail).includes("aren't signed in"),
      'the refusal says the limit is the one for visitors who aren’t signed in',
    );
    assert.strictEqual(
      (await readiness('forecast', OTHER_VISITOR))?.readiness,
      'over-budget',
    );

    let reader = await invoke('forecast', { user: READER });
    assert.strictEqual(
      reader.status,
      200,
      'a signed-in reader is served though the anonymous cap is spent',
    );
    assert.strictEqual(
      await used(['key-limit', 'share', share.id]),
      2,
      'both served calls spent the share’s daily budget',
    );
    assert.strictEqual(
      await used(['key-limit', 'share', share.id, 'anonymous']),
      1,
      'only the visitor’s call spent the anonymous cap',
    );
  });

  test("a personal key never fills for a visitor who isn't signed in", async function (assert) {
    let key = await addKey(PERSONAL_VALUE);
    let approved = await approve(
      ['myStations'],
      { keyId: key.id },
      { interactive: true },
    );
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));
    let anonymous = await approve(
      ['myStations'],
      { keyId: key.id },
      { interactive: true, anonymous: true },
    );
    assert.strictEqual(
      anonymous.status,
      400,
      'anonymous use is approved only for a shared key',
    );

    let refused = await invoke('myStations');
    assert.strictEqual(refused.status, 401, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'actor-required');
    assert.strictEqual(
      (await readiness('myStations'))?.readiness,
      'needs-sign-in',
    );
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');

    let owner = await invoke('myStations', { user: OWNER });
    assert.strictEqual(owner.status, 200, 'its owner is served as before');
  });
});
