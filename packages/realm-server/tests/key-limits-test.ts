import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  DBRateLimitStore,
  fetchDirectWriters,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  createJWT,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
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
import { keyReadiness } from '../lib/key-readiness.ts';
import {
  setKeyLimitSink,
  setKeyLimitStore,
  type KeyLimitEvent,
} from '../lib/key-limits.ts';
import {
  DEFAULT_KEY_LIMITS,
  setKeyLimitDefaults,
} from '../lib/key-limit-settings.ts';

// ============================================================================
// The owner's limits on a key, end to end against the stub vendor: an
// interactive call takes from the caller's token bucket and spends the share's
// or key's daily and monthly budget, a call over either is refused before
// anything is sent, a counter store that can't be read refuses every call,
// pipeline calls count against nothing, readiness answers from the same
// counters, and owners and the realm's direct writers are told once at the
// high-water mark and once at the budget.
//
// No binding can be approved for interactive use yet, so each test turns a
// pipelines-only binding interactive in the database. The counters run on a
// clock the test moves.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/key-limits-test/');
const secureOriginURL = new URL('https://secure.limits.test/secure');
const VENDOR_PORT = 4531;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@limits-owner:localhost';
const WRITER = '@limits-writer:localhost';
const READER = '@limits-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'sk-limits-owner-key-41d2c7';
const INBOX = { module: rri(`${realmURL.href}inbox`), name: 'Inbox' };

// Three calls at once, then one every ten seconds; five calls a day.
const LIMITS = {
  rateBurst: 3,
  rateRefillPerMinute: 6,
  dailyBudget: 5,
  highWaterPercent: 80,
};
// An hour before a UTC day (and month) turns.
const START_MS = Date.UTC(2027, 0, 31, 23);

const inboxModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";

  export class Inbox extends CardDef {
    @operation static check = {
      base: 'callApi',
      params: { code: StringField },
      url: '${VENDOR}/status/{code}',
      path: { code: params('code') },
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static shared = {
      base: 'callApi',
      params: { code: StringField },
      url: '${VENDOR}/status/{code}',
      path: { code: params('code') },
      headers: { authorization: 'Bearer {{apiKey}}' },
    };
  }
`;

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;
  let vendor: StubVendor;
  let events: KeyLimitEvent[];
  let nowMs: number;

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });

  hooks.beforeEach(async function () {
    keyring = installSecretsKeyring(
      await new LocalKeyProvider().loadDataKeys(),
    );
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    events = [];
    setKeyLimitSink((event) => events.push(event));
    nowMs = START_MS;
    setKeyLimitStore((db) => new DBRateLimitStore(db, { now: () => nowMs }));
    setKeyLimitDefaults(LIMITS);
  });
  hooks.afterEach(function () {
    setKeyLimitDefaults(undefined);
    setKeyLimitStore(undefined);
    setKeyLimitSink(undefined);
    resetOutbound();
    resetSecretsAtRest();
  });

  setupPermissionedRealmCached(hooks, {
    realmURL,
    secureOriginURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [WRITER]: ['read', 'write'],
      [READER]: ['read'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'inbox.gts': inboxModule,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
      vendor.requests.length = 0;
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm: realmOf = null,
    }: { keyId?: string | null; realm?: URL | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realmOf?.href ?? null,
        shareId: null,
      })
    ).ticket;
  }

  async function addKey(owner = OWNER, name = 'vendor') {
    return await addUserKey(dbAdapter, keyring, {
      owner,
      name,
      value: VALUE,
      ticket: await ticket(owner, 'add'),
    });
  }

  async function share(keyId: string) {
    return await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId,
      label: 'Vendor',
      ticket: await ticket(OWNER, 'share', { keyId, realm: realmURL }),
    });
  }

  // Approves `operation` with the given slots, then turns its bindings
  // interactive, as allowing interactive use would.
  async function approveInteractive(
    user: string,
    operation: string,
    slots: Record<string, { keyId?: string; shareId?: string }>,
  ) {
    let shown = (
      await request
        .get('/_key-bindings/preview')
        .query({
          realm: realmURL.href,
          module: INBOX.module,
          name: INBOX.name,
          operation,
        })
        .set('Authorization', await secureSessionAuth(dbAdapter, user))
    ).body.data.attributes;
    let response = await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm: realmURL.href,
            operations: [
              {
                codeRef: INBOX,
                operation,
                expectedDestination: shown.destination,
                slots: Object.fromEntries(
                  Object.entries(slots).map(([slot, fill]) => [
                    slot,
                    {
                      ...fill,
                      expectedFingerprint: shown.slots.find(
                        (s: { slot: string }) => s.slot === slot,
                      ).fingerprint,
                    },
                  ]),
                ),
              },
            ],
          },
        },
      });
    if (response.status !== 201) {
      throw new Error(`approval failed: ${JSON.stringify(response.body)}`);
    }
    await dbAdapter.execute(
      `UPDATE key_bindings SET interactive = true WHERE operation_name = $1`,
      { bind: [operation] },
    );
  }

  function envelope(operation: string) {
    return {
      'boxel:operations': [
        {
          op: 'invoke',
          'boxel:name': operation,
          data: { code: '200', meta: { adoptsFrom: INBOX } },
        },
      ],
    };
  }

  // Invokes `operation` as `user` from off the network: an interactive call.
  async function call(operation: string, user = OWNER) {
    let response = await request
      .post('/key-limits-test/_operations')
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
      )
      .send(envelope(operation));
    return {
      status: response.status,
      retryAfter: response.headers['retry-after'] as string | undefined,
      body: response.body,
      code: response.body?.errors?.[0]?.code as string | undefined,
    };
  }

  // Invokes `operation` as a pipeline the realm server runs as `user`.
  async function pipelineCall(operation: string, user = OWNER) {
    let response = (await realm.handlePipeline(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
        },
        body: JSON.stringify(envelope(operation)),
      }),
    ))!;
    return { status: response.status, body: await response.text() };
  }

  async function readiness(operation: string, caller = OWNER) {
    let definition =
      (await realm.operationCore.definitionLookup.lookupDefinition(INBOX))!
        .operations![operation];
    return await keyReadiness(dbAdapter, {
      realmURL: realmURL.href,
      type: { module: String(INBOX.module), name: INBOX.name },
      operation,
      caller,
      request: definition.callApi!,
    });
  }

  // The app's session on the realm server, which card code holds.
  function appSession(user: string): string {
    return `Bearer ${createRealmServerJWT(
      { user, sessionRoom: 'test-session' },
      realmSecretSeed,
    )}`;
  }

  async function setLimits(
    path: string,
    user: string,
    attributes: Record<string, unknown>,
    { secure = true }: { secure?: boolean } = {},
  ) {
    let authorization = secure
      ? await secureSessionAuth(dbAdapter, user)
      : appSession(user);
    return await request
      .put(path)
      .set('Authorization', authorization)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({ data: { type: 'key-limits', attributes } });
  }

  async function notices() {
    return (await dbAdapter.execute(
      `SELECT threshold, period, recipient, owner, label, realm_url, budget FROM key_limit_notices ORDER BY threshold, recipient`,
    )) as {
      threshold: string;
      period: string;
      recipient: string;
      owner: string;
      label: string;
      realm_url: string | null;
      budget: number;
    }[];
  }

  test('an interactive call takes from its caller’s bucket: a burst, then one call per refill', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });

    for (let i = 0; i < LIMITS.rateBurst; i++) {
      let admitted = await call('check');
      assert.strictEqual(admitted.status, 200, JSON.stringify(admitted.body));
    }
    let refused = await call('check');
    assert.strictEqual(refused.status, 429, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'rate-limited');
    assert.strictEqual(
      refused.retryAfter,
      '10',
      'one call back in ten seconds',
    );
    assert.strictEqual(refused.body.errors[0].meta.retryAfterSeconds, 10);
    assert.strictEqual(
      vendor.requests.length,
      LIMITS.rateBurst,
      'the refused call was not sent',
    );
    assert.deepEqual(
      events.filter((e) => e.event === 'refused'),
      [
        {
          event: 'refused',
          code: 'rate-limited',
          share: null,
          key: key.id,
          caller: OWNER,
          realm: realmURL.href,
          operation: 'check',
          limit: { rateBurst: 3, rateRefillPerMinute: 6 },
          retryAfterSeconds: 10,
        },
      ],
      'the refusal is logged with the key, the caller and the limit',
    );

    nowMs += 10_000;
    assert.strictEqual((await call('check')).status, 200, 'one call refilled');
    assert.strictEqual((await call('check')).code, 'rate-limited');
  });

  test('through a share, each caller has a bucket of their own', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });

    for (let i = 0; i < LIMITS.rateBurst; i++) {
      assert.strictEqual((await call('shared', OWNER)).status, 200);
    }
    assert.strictEqual((await call('shared', OWNER)).code, 'rate-limited');
    let writer = await call('shared', WRITER);
    assert.strictEqual(
      writer.status,
      200,
      `another caller is not held to the first one's bucket: ${JSON.stringify(writer.body)}`,
    );
  });

  test('a share’s daily budget is spent across callers, refused with the time to its reset, and reset at midnight UTC', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });
    let set = await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      rateBurst: 100,
      dailyBudget: 4,
    });
    assert.strictEqual(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(set.body.data.attributes, {
      rateBurst: 100,
      rateRefillPerMinute: LIMITS.rateRefillPerMinute,
      dailyBudget: 4,
      monthlyBudget: 120,
    });

    for (let user of [OWNER, OWNER, WRITER, WRITER]) {
      assert.strictEqual((await call('shared', user)).status, 200);
    }
    let refused = await call('shared', WRITER);
    assert.strictEqual(refused.status, 429, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'over-budget');
    assert.strictEqual(refused.retryAfter, '3600', 'resets at midnight UTC');
    assert.notOk(
      /\b4\b/.test(refused.body.errors[0].detail),
      "a caller isn't told the share's budget",
    );
    assert.strictEqual(vendor.requests.length, 4);
    let [event] = events.filter((e) => e.event === 'refused');
    assert.deepEqual(event, {
      event: 'refused',
      code: 'over-budget',
      share: shared.id,
      key: null,
      caller: WRITER,
      realm: realmURL.href,
      operation: 'shared',
      limit: { period: 'day', budget: 4 },
      retryAfterSeconds: 3600,
    });

    nowMs = Date.UTC(2027, 1, 1, 0, 0, 1);
    assert.strictEqual(
      (await call('shared', WRITER)).status,
      200,
      'a new day has a new budget',
    );
  });

  test('a call refused for want of budget takes nothing from its caller’s bucket', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      dailyBudget: 1,
    });
    let tokens = async () =>
      Number(
        (
          await dbAdapter.execute(
            `SELECT tokens FROM rate_limit_buckets ORDER BY bucket_key`,
          )
        )[0].tokens,
      );
    assert.strictEqual((await call('check')).status, 200);
    assert.strictEqual(await tokens(), LIMITS.rateBurst - 1);
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await call('check')).code, 'over-budget');
    }
    assert.strictEqual(
      await tokens(),
      LIMITS.rateBurst - 1,
      'the refused calls took no token',
    );
    assert.strictEqual(vendor.requests.length, 1);
  });

  test('the owner and the realm’s direct writers are told once at the high-water mark and once at the budget', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });
    await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    let recipients = [
      ...new Set([OWNER, ...(await fetchDirectWriters(dbAdapter, realmURL))]),
    ].sort();
    assert.true(recipients.includes(WRITER));
    assert.false(recipients.includes(READER));

    for (let i = 0; i < 3; i++) {
      await call('shared', i % 2 ? WRITER : OWNER);
    }
    assert.deepEqual(await notices(), [], 'nothing below the high-water mark');

    await call('shared', WRITER);
    let highWater = await notices();
    assert.deepEqual(
      highWater.map(({ threshold, recipient }) => [threshold, recipient]),
      recipients.map((recipient) => ['high-water', recipient]),
      'the fourth of five calls reaches 80%',
    );
    assert.deepEqual(
      { ...highWater[0], recipient: undefined },
      {
        threshold: 'high-water',
        period: 'day',
        recipient: undefined,
        owner: OWNER,
        label: 'Vendor',
        realm_url: realmURL.href,
        budget: 5,
      },
    );

    await call('shared', OWNER);
    assert.strictEqual((await call('shared', OWNER)).code, 'over-budget');
    assert.strictEqual((await call('shared', WRITER)).code, 'over-budget');
    assert.deepEqual(
      (await notices()).map(({ threshold, recipient }) => [
        threshold,
        recipient,
      ]),
      [
        ...recipients.map((recipient) => ['budget', recipient]),
        ...recipients.map((recipient) => ['high-water', recipient]),
      ],
      'one notice at the budget, and none for the refusals after it',
    );
    assert.deepEqual(
      events
        .filter((e) => e.event === 'threshold')
        .map((e) => (e as { threshold: string }).threshold),
      ['high-water', 'budget'],
    );
  });

  test('counters that can’t be read refuse every interactive call, and nothing is sent', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await dbAdapter.execute('DROP TABLE rate_limit_budgets');

    let refused = await call('check');
    assert.strictEqual(refused.status, 503, JSON.stringify(refused.body));
    assert.strictEqual(refused.code, 'rate-limit-unavailable');
    assert.strictEqual(refused.retryAfter, '5');
    assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
    assert.deepEqual(
      events.map((e) => [e.event, (e as { code?: string }).code]),
      [['refused', 'rate-limit-unavailable']],
    );
  });

  test('a pipeline call counts against no limit', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 1,
      dailyBudget: 1,
    });
    for (let i = 0; i < 3; i++) {
      let response = await pipelineCall('check');
      assert.strictEqual(response.status, 200, response.body);
    }
    assert.strictEqual(vendor.requests.length, 3);
    assert.strictEqual(
      (await call('check')).status,
      200,
      "an interactive call still finds a full bucket and the day's budget unspent",
    );
    assert.strictEqual((await call('check')).code, 'over-budget');
  });

  test('readiness answers rate-limited and over-budget from the same counters, spending nothing', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    assert.strictEqual(await readiness('check'), 'ready');
    for (let i = 0; i < LIMITS.rateBurst; i++) {
      assert.strictEqual(await readiness('check'), 'ready');
      await call('check');
    }
    assert.strictEqual(await readiness('check'), 'rate-limited');
    nowMs += 10_000;
    assert.strictEqual(await readiness('check'), 'ready');
    await call('check');
    nowMs += 10_000;
    await call('check');
    nowMs += 60_000;
    assert.strictEqual(
      await readiness('check'),
      'over-budget',
      'five calls spent the day',
    );
    assert.strictEqual(vendor.requests.length, 5);
  });

  test('only the share’s owner changes its limits, from a secure session', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    let path = `/_key-shares/${shared.id}/limits`;

    let byWriter = await setLimits(path, WRITER, { dailyBudget: 1000 });
    assert.strictEqual(byWriter.status, 403, JSON.stringify(byWriter.body));
    let byReader = await setLimits(path, READER, { dailyBudget: 1000 });
    assert.strictEqual(byReader.status, 404, 'a reader is told no such share');
    let fromApp = await setLimits(
      path,
      OWNER,
      { dailyBudget: 1000 },
      { secure: false },
    );
    assert.strictEqual(fromApp.status, 403, 'the app session is refused');
    for (let attributes of [
      { dailyBudget: 0 },
      { rateBurst: 2.5 },
      { rateRefillPerMinute: -1 },
      { monthlyBudget: '100' },
      { label: 'x' },
      {},
    ]) {
      let invalid = await setLimits(path, OWNER, attributes);
      assert.strictEqual(
        invalid.status,
        400,
        `${JSON.stringify(attributes)} is refused`,
      );
    }

    let set = await setLimits(path, OWNER, {
      rateRefillPerMinute: 0.5,
      monthlyBudget: 9000,
    });
    assert.strictEqual(set.status, 200, JSON.stringify(set.body));
    let listed = await request
      .get('/_key-shares')
      .query({ realm: realmURL.href })
      .set('Authorization', appSession(WRITER));
    assert.deepEqual(
      listed.body.data[0].attributes.limits,
      {
        rateBurst: LIMITS.rateBurst,
        rateRefillPerMinute: 0.5,
        dailyBudget: LIMITS.dailyBudget,
        monthlyBudget: 9000,
      },
      "the realm's direct writers see the share's limits",
    );

    let reset = await setLimits(path, OWNER, { monthlyBudget: null });
    assert.strictEqual(
      reset.body.data.attributes.monthlyBudget,
      LIMITS.dailyBudget * 30,
      'null goes back to the default',
    );
  });

  test('only a key’s owner changes its limits, and a key nobody set any on lists the defaults', async function (assert) {
    setKeyLimitDefaults(DEFAULT_KEY_LIMITS);
    let key = await addKey();
    let listed = await request
      .get(`/_user-keys/${key.id}`)
      .set('Authorization', appSession(OWNER));
    assert.deepEqual(listed.body.data.attributes.limits, {
      rateBurst: 25,
      rateRefillPerMinute: 15,
      dailyBudget: 2400,
      monthlyBudget: 72000,
    });
    let byOther = await setLimits(`/_user-keys/${key.id}/limits`, WRITER, {
      dailyBudget: 1,
    });
    assert.strictEqual(byOther.status, 404, "another user's key isn't there");
    let byOwner = await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      dailyBudget: 100,
    });
    assert.strictEqual(byOwner.status, 200, JSON.stringify(byOwner.body));
    assert.strictEqual(byOwner.body.data.attributes.monthlyBudget, 3000);
  });
});
