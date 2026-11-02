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
  RealmAction,
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
  realmSecretSeed,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
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
import { shareKey, swapKeyIntoShare } from '../lib/key-shares.ts';
import { opensSharedKeysToAnonymous } from '../lib/anonymous-key-use.ts';
import { setShareLimits } from '../lib/key-limits.ts';

// ============================================================================
// Anonymous use of a share, end to end against the stub vendor. A realm's
// policy opens a card's `callApi` operations to callers who aren't signed in,
// and the owner of the key a share holds lets such callers use the key, a
// setting of the key itself, optionally with an anonymous cap. Sharing makes
// no choice: a key that doesn't allow it isn't shared into a realm whose
// policy opens such a call, since sharing there means they will use it. A
// visitor who isn't signed in is served only when both are present: counted
// by address against the share's per-person rate, together with every other
// such visitor against their part of the share's daily budget, and against
// the key's anonymous cap where one is set. A personal key never fills for
// such a visitor.
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

  @operation static status = {
    base: 'callApi',
    label: 'Read the service status',
    url: '${VENDOR}/graphql',
    graphql: { document: 'query { status }' },
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
// The published card a visitor opens. Every behavior but a create is judged
// against a stored card, so a visitor invokes the operations on this one.
const TODAY = `${TEAM}today`;

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
            { operation: 'status', where: ANONYMOUS },
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
            'today.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {},
                meta: { adoptsFrom: { module: './weather', name: 'Weather' } },
              },
            }),
          },
          // Anyone may read it, as a realm a public card lives in is; only
          // its policy opens anything more to visitors.
          permissions: {
            '*': ['read'],
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
      shareId = null,
    }: {
      keyId?: string | null;
      realm?: string | null;
      shareId?: string | null;
    } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realm,
        shareId,
      })
    ).ticket;
  }

  let keysAdded = 0;
  // Adds a key of the owner's; `anonymous` and `anonymousDailyCap` are its
  // owner's setting for people who aren't signed in.
  async function addKey({
    value = VALUE,
    owner = OWNER,
    ...use
  }: {
    value?: string;
    owner?: string;
    anonymous?: boolean;
    anonymousDailyCap?: number;
  } = {}) {
    return await addUserKey(dbAdapter, keyring, {
      owner,
      name: `weather-${++keysAdded}`,
      value,
      ...use,
      ticket: await ticket(owner, 'add'),
    });
  }

  // Shares a key into the team realm through the route the secure window and
  // the CLI use, with any further `attributes`.
  async function share(
    attributes: Record<string, unknown> = {},
    key?: { id: string },
  ) {
    key ??= await addKey();
    let keyId = key.id;
    let response = await request
      .post('/_key-shares')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-share',
          attributes: {
            realm: TEAM,
            keyId,
            label: 'Team weather',
            ...attributes,
          },
        },
        meta: {
          ticket: await ticket(OWNER, 'share', { keyId, realm: TEAM }),
        },
      });
    return Object.assign(response, { keyId });
  }

  async function keyUse(keyId: string) {
    let [row] = await dbAdapter.execute(
      `SELECT anonymous, anonymous_daily_cap FROM user_keys WHERE id = $1`,
      { bind: [keyId] },
    );
    return {
      anonymous: Boolean(row.anonymous),
      cap:
        row.anonymous_daily_cap == null
          ? null
          : Number(row.anonymous_daily_cap),
    };
  }

  // A share of a key its owner lets people who aren't signed in use, with
  // `cap`, approved for interactive use of `names` with a daily budget of 500.
  async function sharedForAnyone(names: string[], cap?: number) {
    let key = await addKey({
      anonymous: true,
      ...(cap !== undefined ? { anonymousDailyCap: cap } : {}),
    });
    let response = await share({}, key);
    if (response.status !== 201) {
      throw new Error(`could not share: ${response.status} ${response.text}`);
    }
    let shareId = response.body.data.id as string;
    let approved = await approve(
      names,
      { shareId },
      { interactive: true, dailyBudgets: { [shareId]: 500 } },
    );
    if (approved.status !== 201) {
      throw new Error(`could not approve: ${approved.status} ${approved.text}`);
    }
    return { shareId, keyId: key.id };
  }

  // Whether the secure window is told the realm opens shared keys to people
  // who aren't signed in.
  async function opensToAnonymous(realm: string, user: string) {
    let response = await request
      .post('/_secure-window/context')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: { type: 'secure-window-context', attributes: { realm } },
      });
    return response.body?.data?.attributes?.realm?.opensToAnonymous;
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
      'boxel:operations': [{ op: 'invoke', 'boxel:name': name, href: TODAY }],
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
      // A session's permissions match the realm's for its user.
      let permissions: RealmAction[] =
        user === OWNER ? ['read', 'write', 'realm-owner'] : ['read', 'write'];
      req = req.set(
        'Authorization',
        `Bearer ${createJWT(team, user, permissions)}`,
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
          checks: [{ operation: name, target: TODAY, readiness: true }],
        }),
      );
    return response.body?.checks?.[0];
  }

  async function used(key: unknown[], period: 'day' | 'month' = 'day') {
    let rows = await dbAdapter.execute(
      `SELECT count FROM rate_limit_budgets WHERE budget_key = $1 AND period = $2`,
      { bind: [JSON.stringify(key), period] },
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
      ['forecast', 'status'],
      'the operation that sends a shared key is open to them, and so is one that sends no key, which only the grant limits',
    );
  });

  test("a key's owner lets people who aren't signed in use it, on the key itself, and sharing only reflects the realm's policy", async function (assert) {
    assert.true(
      await opensToAnonymous(TEAM, OWNER),
      'the secure window is told the team realm opens a shared key to people who aren’t signed in',
    );
    assert.false(
      await opensToAnonymous(ORG, ORG_ADMIN),
      'and that a realm with no such grant does not',
    );

    let allowed = await addKey({ anonymous: true, anonymousDailyCap: 100 });
    assert.true(allowed.anonymous, 'set when the key is added');
    assert.strictEqual(allowed.anonymousDailyCap, 100);
    let shared = await share({}, allowed);
    assert.strictEqual(shared.status, 201, 'a key that allows it is shared');

    let refused = await share();
    assert.strictEqual(refused.status, 400, refused.text);
    assert.true(
      refused.text.includes('boxel keys anonymous'),
      'sharing a key that doesn’t allow it into a realm where visitors will use it is refused, saying where to allow it',
    );
    assert.false(
      (await keyUse(refused.keyId)).anonymous,
      'and sharing changed nothing about the key',
    );
    let chosenHere = await share({ anonymous: true });
    assert.strictEqual(
      chosenHere.status,
      400,
      'sharing makes no choice about people who aren’t signed in',
    );

    let elsewhere = await addKey();
    let signedInOnly = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: TEAM,
      keyId: elsewhere.id,
      label: 'Elsewhere',
      opensToAnonymous: async () => false,
      ticket: await ticket(OWNER, 'share', {
        keyId: elsewhere.id,
        realm: TEAM,
      }),
    });
    assert.strictEqual(
      signedInOnly.state,
      'active',
      'where the policy opens nothing to visitors, any key is shared',
    );
  });

  test("a key's owner changes whether people who aren't signed in may use it, from the secure window", async function (assert) {
    let { keyId } = await sharedForAnyone(['forecast'], 100);
    assert.strictEqual((await invoke('forecast')).status, 200);
    let put = (attributes: Record<string, unknown>) =>
      request
        .put(`/_user-keys/${keyId}/anonymous-use`)
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'anonymous-use', attributes } });
    let off = await put({ anonymous: false }).set(
      'Authorization',
      await secureSessionAuth(dbAdapter, OWNER),
    );
    assert.strictEqual(off.status, 200, off.text);
    assert.false(off.body.data.attributes.anonymous);
    assert.strictEqual(
      off.body.data.attributes.anonymousDailyCap,
      null,
      'turning it off clears the cap',
    );
    let refused = await invoke('forecast');
    assert.strictEqual(refused.code, 'anonymous-use-not-approved');
    assert.strictEqual(
      (await readiness('forecast'))?.readiness,
      'needs-sign-in',
    );
    let someoneElse = await put({ anonymous: true }).set(
      'Authorization',
      await secureSessionAuth(dbAdapter, READER),
    );
    assert.strictEqual(
      someoneElse.status,
      404,
      'another user’s key answers as one that doesn’t exist',
    );
    let on = await put({ anonymous: true, anonymousDailyCap: 5 }).set(
      'Authorization',
      await secureSessionAuth(dbAdapter, OWNER),
    );
    assert.strictEqual(on.status, 200, on.text);
    assert.strictEqual(on.body.data.attributes.anonymousDailyCap, 5);
    assert.strictEqual(
      (await invoke('forecast')).status,
      200,
      'visitors are served again',
    );
  });

  test('only a grant on a call that sends a shared key counts as opening shared keys to visitors; one on a keyless call does not', async function (assert) {
    let policy = (await team.getCompiledPolicy())!;
    let opening = (operation: string) => ({
      getCompiledPolicy: async () => ({
        ...policy,
        rules: policy.rules.map((rule) => ({
          ...rule,
          grants: rule.grants.filter(
            (grant) => grant.anonymous && grant.operation === operation,
          ),
        })),
      }),
    });
    assert.true(await opensSharedKeysToAnonymous(opening('forecast')));
    assert.false(
      await opensSharedKeysToAnonymous(opening('status')),
      'a keyless call opened to visitors sends no key, so it puts no shared key in front of them',
    );

    // A share's operations are in its owner's batch.
    let shared = await share({}, await addKey({ anonymous: true }));
    assert.strictEqual(shared.status, 201, shared.text);
    let batch = await request
      .post('/_key-bindings/batch')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-batch',
          attributes: {
            target: { kind: 'type', ...WEATHER, realm: TEAM },
            interactive: true,
          },
        },
      });
    assert.strictEqual(batch.status, 200, batch.text);
    let open = Object.fromEntries(
      (
        batch.body.data.attributes.groups as {
          operations: { name: string; openToAnonymous: boolean }[];
        }[]
      )
        .flatMap((group) => group.operations)
        .map((operation) => [operation.name, operation.openToAnonymous]),
    );
    assert.deepEqual(
      open,
      { alerts: false, forecast: true, myStations: false },
      'the window is told which of the card’s calls visitors can make',
    );
  });

  test('a visitor who is not signed in is served through a share whose key allows it, for the operations the policy opens to them', async function (assert) {
    let { shareId, keyId } = await sharedForAnyone(['forecast', 'alerts']);
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
      'an operation the policy opens only to signed-in callers is refused',
    );
    assert.strictEqual(vendor.requests.length, 1, 'nothing more was sent');

    let signedIn = await invoke('alerts', { user: READER });
    assert.strictEqual(
      signedIn.status,
      200,
      'a signed-in reader is served as before',
    );
    assert.strictEqual(
      await used(['key-limit', 'key', keyId, 'anonymous']),
      0,
      'a key with no anonymous cap counts none',
    );
    assert.strictEqual(
      await used(['key-limit', 'share', shareId]),
      2,
      'the visitor’s call spent the share’s daily budget, as the reader’s did',
    );
  });

  test("a share whose key doesn't allow anonymous use serves signed-in readers only", async function (assert) {
    // Shared before the realm's policy opened anything to visitors.
    let key = await addKey();
    await shareKey(dbAdapter, {
      owner: OWNER,
      realm: TEAM,
      keyId: key.id,
      label: 'Team weather',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: TEAM }),
    });
    let [{ id: shareId }] = (await dbAdapter.execute(
      `SELECT id FROM key_shares WHERE key_id = $1`,
      { bind: [key.id] },
    )) as { id: string }[];
    let approved = await approve(
      ['forecast'],
      { shareId },
      { interactive: true, dailyBudgets: { [shareId]: 500 } },
    );
    assert.strictEqual(approved.status, 201, approved.text);
    let anonymousBinding = await approve(
      ['forecast'],
      { shareId },
      { interactive: true, anonymous: true },
    );
    assert.strictEqual(
      anonymousBinding.status,
      403,
      'an approval never allows anonymous use itself',
    );

    let refused = await invoke('forecast');
    assert.strictEqual(refused.status, 401, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'anonymous-use-not-approved');
    assert.strictEqual(
      (await readiness('forecast'))?.readiness,
      'needs-sign-in',
      'readiness tells the visitor that signing in is what serves them',
    );
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
    let reader = await invoke('forecast', { user: READER });
    assert.strictEqual(reader.status, 200, 'a signed-in reader is served');
  });

  test("a visitor's address is held to the share's rate, and other addresses are not", async function (assert) {
    let { shareId } = await sharedForAnyone(['forecast']);
    await setShareLimits(dbAdapter, {
      user: OWNER,
      shareId,
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

  test("the key's anonymous cap is shared by every visitor who isn't signed in, and spending it leaves the share's budget for signed-in readers", async function (assert) {
    let { shareId, keyId } = await sharedForAnyone(['forecast'], 1);
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
      await used(['key-limit', 'share', shareId]),
      2,
      'both served calls spent the share’s daily budget',
    );
    assert.strictEqual(
      await used(['key-limit', 'key', keyId, 'anonymous']),
      1,
      'only the visitor’s call spent the key’s anonymous cap',
    );
  });

  test("a key swapped into the share is held to the rule sharing is, and brings its own owner's setting", async function (assert) {
    let { shareId } = await sharedForAnyone(['forecast'], 100);
    // The owner leaves, which suspends the share.
    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [TEAM, OWNER] },
    );
    let opens = async () => true;
    let signedInOnly = await addKey({
      owner: READER,
      value: 'reader-weather-key-3c90aa',
    });
    await assert.rejects(
      swapKeyIntoShare(dbAdapter, keyring, {
        user: READER,
        shareId,
        keyId: signedInOnly.id,
        ticket: await ticket(READER, 'swap', {
          keyId: signedInOnly.id,
          shareId,
        }),
        via: 'window',
        opensToAnonymous: opens,
      }),
      /boxel keys anonymous/,
      'a key that doesn’t allow anonymous use isn’t swapped into a realm where visitors will use it',
    );

    let allowed = await addKey({
      owner: READER,
      value: 'reader-weather-key-3c90aa',
      anonymous: true,
    });
    await swapKeyIntoShare(dbAdapter, keyring, {
      user: READER,
      shareId,
      keyId: allowed.id,
      ticket: await ticket(READER, 'swap', { keyId: allowed.id, shareId }),
      via: 'window',
      opensToAnonymous: opens,
    });
    let served = await invoke('forecast');
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(
      vendor.requests[0].headers.authorization,
      'Bearer reader-weather-key-3c90aa',
      'visitors are served with the key swapped in, which allows them',
    );
  });

  test("people who aren't signed in never spend more than their part of a share's daily budget, whatever the key's cap", async function (assert) {
    let { shareId } = await sharedForAnyone(['forecast'], 1000);
    await setShareLimits(dbAdapter, {
      user: OWNER,
      shareId,
      changes: { dailyBudget: 4 },
    });
    let first = await invoke('forecast', { address: VISITOR });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    let second = await invoke('forecast', { address: OTHER_VISITOR });
    assert.strictEqual(second.status, 200, JSON.stringify(second.body));
    let third = await invoke('forecast', { address: '203.0.113.30' });
    assert.strictEqual(
      third.code,
      'over-budget',
      'visitors stop at half of the share’s daily budget, though the key’s cap is far above it',
    );
    assert.strictEqual(
      (await invoke('forecast', { user: READER })).status,
      200,
      'signed-in readers keep the rest',
    );
    assert.strictEqual((await invoke('forecast', { user: OWNER })).status, 200);
    assert.strictEqual(
      await used(['key-limit', 'share', shareId, 'anonymous']),
      2,
    );
  });

  test("people who aren't signed in never spend more than their part of a share's monthly budget either", async function (assert) {
    let { shareId } = await sharedForAnyone(['forecast']);
    await setShareLimits(dbAdapter, {
      user: OWNER,
      shareId,
      changes: { monthlyBudget: 4 },
    });
    assert.strictEqual(
      (await invoke('forecast', { address: VISITOR })).status,
      200,
    );
    assert.strictEqual(
      (await invoke('forecast', { address: OTHER_VISITOR })).status,
      200,
    );
    let third = await invoke('forecast', { address: '203.0.113.30' });
    assert.strictEqual(
      third.code,
      'over-budget',
      'visitors stop at half of the share’s monthly budget, with the day far from used up',
    );
    assert.strictEqual(
      (await invoke('forecast', { user: READER })).status,
      200,
      'signed-in readers keep the rest of the month',
    );
    assert.strictEqual(
      await used(['key-limit', 'share', shareId, 'anonymous'], 'month'),
      2,
    );
  });

  test("a key's anonymous use is changed only with a session signed in on the secure origin", async function (assert) {
    let key = await addKey();
    let response = await request
      .put(`/_user-keys/${key.id}/anonymous-use`)
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: OWNER, sessionRoom: 'test-session' },
          realmSecretSeed,
        )}`,
      )
      .set('Content-Type', 'application/json')
      .send({
        data: { type: 'anonymous-use', attributes: { anonymous: true } },
      });
    assert.strictEqual(
      response.status,
      403,
      'the app’s session, which card code can reach, can’t allow it',
    );
    assert.false((await keyUse(key.id)).anonymous);
  });

  test("a personal key never fills for a visitor who isn't signed in, even one that allows anonymous use", async function (assert) {
    let key = await addKey({ value: PERSONAL_VALUE, anonymous: true });
    let approved = await approve(
      ['myStations'],
      { keyId: key.id },
      { interactive: true },
    );
    assert.strictEqual(approved.status, 201, JSON.stringify(approved.body));

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
