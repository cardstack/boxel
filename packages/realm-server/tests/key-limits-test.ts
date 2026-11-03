import QUnit from 'qunit';
const { module, test } = QUnit;
import sinon from 'sinon';
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
  insertUser,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import {
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  KEY_NOTICES_UPDATED_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { upsertSessionRoom } from '@cardstack/runtime-common/db-queries/session-room-queries';
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
import { shareKey, suspendShare, swapKeyIntoShare } from '../lib/key-shares.ts';
import { keyReadiness } from '../lib/key-readiness.ts';
import {
  setKeyLimitNoticeSender,
  setKeyLimitSink,
  settleKeyLimitNoticeSends,
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
// Each test approves a binding, then turns it interactive in the database (see
// `approveInteractive`). The counters run on a clock the test moves.
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
  anonymousSharePercent: 50,
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

    @operation static both = {
      base: 'callApi',
      params: { code: StringField },
      url: '${VENDOR}/status/{code}',
      path: { code: params('code') },
      headers: {
        authorization: 'Bearer {{userKey}}',
        'x-shared-key': '{{apiKey}}',
      },
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
  // Each `[recipient, event type]` the realm server sent when it recorded a
  // limit notice.
  let told: [string, string][];
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
    told = [];
    setKeyLimitNoticeSender(async (user, eventType) => {
      told.push([user, eventType]);
    });
    nowMs = START_MS;
    setKeyLimitStore((db) => new DBRateLimitStore(db, { now: () => nowMs }));
    setKeyLimitDefaults(LIMITS);
  });
  hooks.afterEach(function () {
    setKeyLimitDefaults(undefined);
    setKeyLimitStore(undefined);
    setKeyLimitSink(undefined);
    setKeyLimitNoticeSender(undefined);
    sinon.restore();
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

  async function bucketTokens(
    subject: 'key' | 'share',
    id: string,
    caller = OWNER,
  ) {
    let [row] = await dbAdapter.execute(
      `SELECT tokens FROM rate_limit_buckets WHERE bucket_key = $1`,
      { bind: [JSON.stringify(['key-limit', subject, id, caller])] },
    );
    return row ? Number(row.tokens) : undefined;
  }

  async function budgetUsed(subject: 'key' | 'share', id: string) {
    let [row] = await dbAdapter.execute(
      `SELECT count FROM rate_limit_budgets WHERE budget_key = $1 AND period = 'day'`,
      { bind: [JSON.stringify(['key-limit', subject, id])] },
    );
    return row ? Number(row.count) : 0;
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
  // interactive by setting the column the call reads. Approving with
  // `interactive` would set a share's daily budget on its first interactive
  // approval, and these tests measure the platform's defaults.
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

  async function listLimitNotices(authorization: string) {
    return await request
      .get('/_key-limit-notices')
      .set('Accept', 'application/vnd.api+json')
      .set('Authorization', authorization);
  }

  async function markLimitNoticesRead(
    authorization: string,
    ids: unknown[],
    type = 'key-limit-notice',
  ) {
    return await request
      .post('/_key-limit-notices/read')
      .set('Authorization', authorization)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({ data: ids.map((id) => ({ type, id })) });
  }

  test('each recipient of a limit notice is told it is waiting, once per notice recorded', async function (assert) {
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

    for (let i = 0; i < 3; i++) {
      await call('shared');
    }
    assert.deepEqual(told, [], 'nothing below the high-water mark');

    await call('shared');
    await settleKeyLimitNoticeSends();
    assert.deepEqual(
      told.map(([user]) => user).sort(),
      recipients,
      'each recipient of the high-water notice is told',
    );
    assert.true(
      told.every(
        ([, eventType]) => eventType === KEY_NOTICES_UPDATED_EVENT_TYPE,
      ),
    );

    told = [];
    await call('shared');
    await settleKeyLimitNoticeSends();
    assert.deepEqual(
      told.map(([user]) => user).sort(),
      recipients,
      'and each recipient of the budget notice',
    );

    told = [];
    assert.strictEqual((await call('shared')).code, 'over-budget');
    await settleKeyLimitNoticeSends();
    assert.deepEqual(told, [], 'a refusal past the budget records nothing');
  });

  test('the call that crosses a threshold doesn’t wait for the push', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    let release!: () => void;
    let held = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    setKeyLimitNoticeSender(async () => {
      started++;
      await held;
    });
    for (let i = 0; i < 4; i++) {
      let response = await call('check');
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    }
    assert.strictEqual(started, 1, 'the push started');
    assert.strictEqual(
      vendor.requests.length,
      4,
      'the call that crossed the high-water mark was sent while its push was still waiting',
    );
    release();
    await settleKeyLimitNoticeSends();
  });

  test('a notice that can’t be sent is still recorded, and the call still goes through', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    setKeyLimitNoticeSender(async () => {
      throw new Error('the homeserver is down');
    });
    for (let i = 0; i < 4; i++) {
      let response = await call('check');
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    }
    assert.deepEqual(
      (await notices()).map(({ threshold, recipient }) => [
        threshold,
        recipient,
      ]),
      [['high-water', OWNER]],
    );
  });

  test('a recipient lists the limit notices whose period hasn’t ended, with an unread count', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    let shared = await share((await addKey(OWNER, 'shared vendor')).id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });
    await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    for (let i = 0; i < 4; i++) {
      await call('check');
    }
    for (let i = 0; i < 5; i++) {
      await call('shared');
    }

    // The app's own session reads them: the badge is shown in the app.
    let owners = await listLimitNotices(appSession(OWNER));
    assert.strictEqual(owners.status, 200, owners.text);
    assert.strictEqual(owners.body.meta.unread, 3);
    let listed = (
      owners.body.data as {
        type: string;
        attributes: Record<string, unknown>;
      }[]
    ).map(({ type, attributes }) => ({
      type,
      share: attributes.share,
      key: attributes.key,
      realm: attributes.realm,
      label: attributes.label,
      yours: attributes.yours,
      period: attributes.period,
      threshold: attributes.threshold,
      budget: attributes.budget,
      readAt: attributes.readAt,
    }));
    assert.deepEqual(
      listed,
      [
        {
          type: 'key-limit-notice',
          share: shared.id,
          key: null,
          realm: realmURL.href,
          label: 'Vendor',
          yours: true,
          period: 'day',
          threshold: 'budget',
          budget: 5,
          readAt: null,
        },
        {
          type: 'key-limit-notice',
          share: shared.id,
          key: null,
          realm: realmURL.href,
          label: 'Vendor',
          yours: true,
          period: 'day',
          threshold: 'high-water',
          budget: 5,
          readAt: null,
        },
        {
          type: 'key-limit-notice',
          share: null,
          key: key.id,
          realm: null,
          label: 'vendor',
          yours: true,
          period: 'day',
          threshold: 'high-water',
          budget: 5,
          readAt: null,
        },
      ],
      'newest first, a share’s naming its realm and a key’s naming neither',
    );
    assert.strictEqual(
      owners.body.data[0].attributes.periodEndsAt,
      new Date(Date.UTC(2027, 1, 1)).toISOString(),
      'the day ends at UTC midnight',
    );

    let writers = await listLimitNotices(appSession(WRITER));
    assert.deepEqual(
      (writers.body.data as { attributes: Record<string, unknown> }[]).map(
        ({ attributes }) => [attributes.label, attributes.yours],
      ),
      [
        ['Vendor', false],
        ['Vendor', false],
      ],
      'a direct writer sees the share’s notices, and that the key isn’t theirs',
    );
    let readers = await listLimitNotices(appSession(READER));
    assert.deepEqual(readers.body.data, [], 'a reader is told nothing');
    assert.strictEqual(readers.body.meta.unread, 0);

    await dbAdapter.execute(
      `UPDATE key_limit_notices SET period_ends_at = NOW() - interval '1 minute' WHERE key_id = $1`,
      { bind: [key.id] },
    );
    let afterReset = await listLimitNotices(appSession(OWNER));
    assert.deepEqual(
      (afterReset.body.data as { attributes: { label: string } }[]).map(
        ({ attributes }) => attributes.label,
      ),
      ['Vendor', 'Vendor'],
      'a notice whose period has ended is no longer listed',
    );
    assert.strictEqual(
      afterReset.body.meta.unread,
      2,
      'nor counted unread, since no page can show it to mark it read',
    );
  });

  test('a notice whose budget the owner has since raised is no longer listed or counted', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    for (let i = 0; i < 5; i++) {
      await call('check');
    }
    let before = await listLimitNotices(appSession(OWNER));
    assert.strictEqual(before.body.meta.unread, 2, 'high-water and budget');

    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      dailyBudget: 10,
    });
    let after = await listLimitNotices(appSession(OWNER));
    assert.deepEqual(
      after.body.data,
      [],
      'the key isn’t refused any more, so nothing says it is',
    );
    assert.strictEqual(after.body.meta.unread, 0);

    for (let i = 0; i < 3; i++) {
      await call('check');
    }
    let reached = await listLimitNotices(appSession(OWNER));
    assert.deepEqual(
      (
        reached.body.data as {
          attributes: { threshold: string; budget: number };
        }[]
      ).map(({ attributes }) => [attributes.threshold, attributes.budget]),
      [['high-water', 10]],
      'reaching the new budget’s high-water mark is a notice of its own',
    );

    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      dailyBudget: 5,
    });
    assert.deepEqual(
      (
        (await listLimitNotices(appSession(OWNER))).body.data as {
          attributes: { budget: number };
        }[]
      ).map(({ attributes }) => attributes.budget),
      [10, 5, 5],
      'a budget lowered below what a notice was for leaves it listed',
    );
  });

  test('a share’s notices follow its owner and its realm’s writers as they are now', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });
    await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    for (let i = 0; i < 4; i++) {
      await call('shared');
    }
    let yours = async (user: string) =>
      (
        (await listLimitNotices(appSession(user))).body.data as {
          attributes: { yours: boolean };
        }[]
      ).map(({ attributes }) => attributes.yours);
    assert.deepEqual(await yours(OWNER), [true]);
    assert.deepEqual(await yours(WRITER), [false]);

    // The share now holds the writer's key: `yours` follows it, whoever the
    // notice was recorded for.
    await dbAdapter.execute(`UPDATE key_shares SET owner = $1 WHERE id = $2`, {
      bind: [WRITER, shared.id],
    });
    assert.deepEqual(await yours(WRITER), [true]);
    assert.deepEqual(await yours(OWNER), [false]);

    await dbAdapter.execute(`UPDATE key_shares SET owner = $1 WHERE id = $2`, {
      bind: [OWNER, shared.id],
    });
    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, WRITER] },
    );
    let lost = await listLimitNotices(appSession(WRITER));
    assert.deepEqual(
      lost.body.data,
      [],
      'a writer who lost direct write no longer sees the share',
    );
    assert.strictEqual(lost.body.meta.unread, 0);
  });

  test('only a secure session marks a recipient’s own limit notices read, and their sessions are told', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 100,
    });
    for (let i = 0; i < 5; i++) {
      await call('check');
    }
    let ids = (
      (await listLimitNotices(appSession(OWNER))).body.data as { id: string }[]
    ).map(({ id }) => id);
    assert.strictEqual(ids.length, 2);

    const OWNER_ROOM = '!limits-owner-session-room:localhost';
    try {
      await upsertSessionRoom(dbAdapter, OWNER, OWNER_ROOM);
    } catch {
      await insertUser(dbAdapter, OWNER, 'cus_key_limits_owner', null);
      await upsertSessionRoom(dbAdapter, OWNER, OWNER_ROOM);
    }
    sinon.stub(MatrixClient.prototype, 'isLoggedIn').returns(true);
    let sent = sinon.stub(MatrixClient.prototype, 'sendEvent').resolves();
    let pushes = () =>
      sent
        .getCalls()
        .map((c) => c.args as [string, string, Record<string, any>])
        .filter(
          (args) =>
            args[0] === OWNER_ROOM &&
            args[2]?.msgtype === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE &&
            JSON.parse(args[2].body).eventType ===
              KEY_NOTICES_UPDATED_EVENT_TYPE,
        ).length;

    let fromApp = await request
      .post('/_key-limit-notices/read')
      .set('Authorization', appSession(OWNER))
      .set('Content-Type', 'application/json')
      .send({ data: ids.map((id) => ({ type: 'key-limit-notice', id })) });
    assert.strictEqual(
      fromApp.status,
      403,
      'the app page, where card code runs, cannot clear the badge',
    );

    let byOther = await markLimitNoticesRead(
      await secureSessionAuth(dbAdapter, WRITER),
      ids,
    );
    assert.strictEqual(byOther.status, 200, byOther.text);
    assert.strictEqual(byOther.body.meta.marked, 0, 'not the writer’s notices');

    assert.strictEqual(
      (
        await markLimitNoticesRead(await secureSessionAuth(dbAdapter, OWNER), [
          'x1',
        ])
      ).status,
      400,
      'a malformed id is refused',
    );
    assert.strictEqual(
      (
        await markLimitNoticesRead(
          await secureSessionAuth(dbAdapter, OWNER),
          ids,
          'key-policy-notice',
        )
      ).status,
      400,
      'so is another kind of notice',
    );
    assert.strictEqual(pushes(), 0);

    let marked = await markLimitNoticesRead(
      await secureSessionAuth(dbAdapter, OWNER),
      [ids[0]],
    );
    assert.strictEqual(marked.status, 200, marked.text);
    assert.deepEqual(marked.body.meta, { marked: 1, unread: 1 });
    assert.strictEqual(pushes(), 1, 'the owner’s sessions are told');

    let again = await markLimitNoticesRead(
      await secureSessionAuth(dbAdapter, OWNER),
      ids,
    );
    assert.deepEqual(again.body.meta, { marked: 1, unread: 0 });
    let listed = await listLimitNotices(appSession(OWNER));
    assert.true(
      (listed.body.data as { attributes: { readAt: string | null } }[]).every(
        ({ attributes }) => typeof attributes.readAt === 'string',
      ),
    );

    let none = await markLimitNoticesRead(
      await secureSessionAuth(dbAdapter, OWNER),
      ids,
    );
    assert.deepEqual(none.body.meta, { marked: 0, unread: 0 });
    assert.strictEqual(pushes(), 2, 'marking nothing tells nobody');
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
  test('a call refused at one share or key is counted against none of them', async function (assert) {
    let personal = await addKey(OWNER, 'personal');
    let sharedKey = await addKey(OWNER, 'shared');
    let shared = await share(sharedKey.id);
    await approveInteractive(OWNER, 'both', {
      userKey: { keyId: personal.id },
      apiKey: { shareId: shared.id },
    });
    await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      rateBurst: 1,
    });

    assert.strictEqual((await call('both')).status, 200);
    assert.strictEqual(await bucketTokens('key', personal.id), 2);
    assert.strictEqual(await budgetUsed('key', personal.id), 1);

    let refused = await call('both');
    assert.strictEqual(
      refused.code,
      'rate-limited',
      JSON.stringify(refused.body),
    );
    assert.strictEqual(
      await bucketTokens('key', personal.id),
      2,
      "the personal key's token is put back when the share refuses the call",
    );
    assert.strictEqual(
      await budgetUsed('key', personal.id),
      1,
      'and its budget is not spent',
    );
    assert.strictEqual(vendor.requests.length, 1);
  });

  test('a call refused for a limit uses up no probe of a rejected grant', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, { rateBurst: 1 });
    assert.strictEqual((await call('check')).status, 200);

    await dbAdapter.execute(
      `UPDATE user_key_grants SET state = 'rejected', rejected_at = NOW(), last_probe_at = NOW() - interval '1 day' WHERE key_id = $1`,
      { bind: [key.id] },
    );
    let refused = await call('check');
    assert.strictEqual(
      refused.code,
      'rate-limited',
      JSON.stringify(refused.body),
    );
    let [grant] = await dbAdapter.execute(
      `SELECT last_probe_at < NOW() - interval '1 hour' AS still_due FROM user_key_grants WHERE key_id = $1`,
      { bind: [key.id] },
    );
    assert.true(Boolean(grant.still_due), 'the probe is still due');
    assert.strictEqual(vendor.requests.length, 1, 'nothing more was sent');
  });

  test('a monthly budget refuses with the time to the first of the month', async function (assert) {
    nowMs = Date.UTC(2027, 0, 15, 12);
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await setLimits(`/_user-keys/${key.id}/limits`, OWNER, {
      rateBurst: 100,
      dailyBudget: 100,
      monthlyBudget: 2,
    });
    assert.strictEqual((await call('check')).status, 200);
    assert.strictEqual((await call('check')).status, 200);
    let refused = await call('check');
    assert.strictEqual(refused.code, 'over-budget');
    let toMonthEnd = (Date.UTC(2027, 1, 1) - nowMs) / 1000;
    assert.strictEqual(refused.retryAfter, String(toMonthEnd));
    assert.deepEqual(
      (events.find((e) => e.event === 'refused') as { limit: unknown }).limit,
      { period: 'month', budget: 2 },
    );
  });

  test('a writer who swaps their own key into a share starts from the default limits', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      dailyBudget: 7,
      rateBurst: 9,
    });
    await suspendShare(dbAdapter, { user: WRITER, shareId: shared.id });
    let writerKey = await addKey(WRITER, 'writer-vendor');
    let { share: swapped } = await swapKeyIntoShare(dbAdapter, keyring, {
      user: WRITER,
      shareId: shared.id,
      keyId: writerKey.id,
      ticket: (
        await mintKeyWriteTicket(dbAdapter, WRITER, {
          action: 'swap',
          keyId: writerKey.id,
          realmURL: null,
          shareId: shared.id,
        })
      ).ticket,
      via: undefined,
    });
    assert.strictEqual(swapped.owner, WRITER);
    assert.deepEqual(
      swapped.limits,
      {
        rateBurst: LIMITS.rateBurst,
        rateRefillPerMinute: LIMITS.rateRefillPerMinute,
        dailyBudget: LIMITS.dailyBudget,
        monthlyBudget: LIMITS.dailyBudget * 30,
      },
      "the previous owner's limits don't carry over to the new owner's key",
    );
  });
});
