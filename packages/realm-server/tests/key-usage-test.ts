import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  DBRateLimitStore,
  insertPermissions,
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
import { setKeyLimitStore } from '../lib/key-limits.ts';
import { KEY_USE_RETENTION_DAYS } from '../lib/key-uses.ts';
import { setKeyLimitDefaults } from '../lib/key-limit-settings.ts';

// ============================================================================
// The usage of a share or a personal key, end to end against the stub vendor:
// after calls through it, `GET /_user-keys/:id/usage` and
// `GET /_key-shares/:id/usage` report what it spent against its budgets, the
// last use and by whom, the top callers, refusals by code (each counted
// against the share or key that refused it), the vendor's answers by status
// with 403 named `vendor-forbidden`, and its grants with which the vendor
// rejected. A share's usage is for its realm's direct writers, of whom only
// the owner may change its limits; a reader, and an owner who lost write, are
// told it doesn't exist.
//
// The approval API approves a binding for pipelines only, so each test turns
// one interactive in the database. The counters run on a clock the test moves.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/key-usage-test/');
const secureOriginURL = new URL('https://secure.usage.test/secure');
const VENDOR_PORT = 4532;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@usage-owner:localhost';
const WRITER = '@usage-writer:localhost';
const READER = '@usage-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const STRANGER = '@usage-stranger:localhost';
const OTHER_STRANGER = '@usage-other-stranger:localhost';
const VALUE = 'sk-usage-owner-key-7e30a1';
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
    nowMs = START_MS;
    setKeyLimitStore((db) => new DBRateLimitStore(db, { now: () => nowMs }));
    setKeyLimitDefaults(LIMITS);
  });
  hooks.afterEach(function () {
    setKeyLimitDefaults(undefined);
    setKeyLimitStore(undefined);
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

  function envelope(operation: string, code = '200') {
    return {
      'boxel:operations': [
        {
          op: 'invoke',
          'boxel:name': operation,
          data: { code, meta: { adoptsFrom: INBOX } },
        },
      ],
    };
  }

  // Invokes `operation` as `user` from off the network: an interactive call.
  async function call(operation: string, user = OWNER, code = '200') {
    let response = await request
      .post('/key-usage-test/_operations')
      .set('Accept', OPERATIONS)
      .set('Content-Type', OPERATIONS)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
      )
      .send(envelope(operation, code));
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

  async function usage(path: string, user: string) {
    return await request
      .get(path)
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Authorization', appSession(user));
  }

  async function keyUsage(keyId: string, user = OWNER) {
    return await usage(`/_user-keys/${keyId}/usage`, user);
  }

  async function shareUsage(shareId: string, user = OWNER) {
    return await usage(`/_key-shares/${shareId}/usage`, user);
  }

  async function useRows() {
    return (await dbAdapter.execute(
      `SELECT share_id, key_id, caller, mode, outcome, code, status, host FROM key_uses ORDER BY id`,
    )) as Record<string, unknown>[];
  }

  test('a personal key’s usage counts its calls, the budget they spent, and the vendor’s answers', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });

    assert.strictEqual((await call('check')).status, 200);
    assert.strictEqual((await call('check')).status, 200);
    let forbidden = await call('check', OWNER, '403');
    assert.strictEqual(
      forbidden.status,
      200,
      'a vendor’s 403 is a response the card reads',
    );
    assert.strictEqual((await pipelineCall('check')).status, 200);

    let response = await keyUsage(key.id);
    assert.strictEqual(response.status, 200, response.text);
    let { type, id, attributes } = response.body.data;
    assert.strictEqual(type, 'key-usage');
    assert.strictEqual(id, key.id);
    assert.deepEqual(
      [attributes.budgets.day.used, attributes.budgets.month.used],
      [3, 3],
      'the interactive calls spent the budgets; the pipeline call spent nothing',
    );
    assert.deepEqual(
      [attributes.budgets.day.budget, attributes.budgets.month.budget],
      [LIMITS.dailyBudget, LIMITS.dailyBudget * 30],
    );
    assert.strictEqual(
      attributes.budgets.day.resetsAt,
      new Date(Date.UTC(2027, 1, 1)).toISOString(),
      'the day resets at midnight UTC',
    );
    assert.strictEqual(attributes.calls, 4, 'every use is counted');
    assert.deepEqual(attributes.topCallers, [{ caller: OWNER, calls: 4 }]);
    assert.deepEqual(attributes.vendorOutcomes, [
      { status: 200, count: 3 },
      { status: 403, count: 1, outcome: 'vendor-forbidden' },
    ]);
    assert.deepEqual(attributes.refusals, []);
    assert.strictEqual(attributes.lastUse.caller, OWNER);
    assert.strictEqual(attributes.lastUse.operation, 'check');
    assert.strictEqual(attributes.lastUse.outcome, 'sent');
    assert.true(attributes.canEditLimits);
    assert.deepEqual(attributes.limits, {
      rateBurst: LIMITS.rateBurst,
      rateRefillPerMinute: LIMITS.rateRefillPerMinute,
      dailyBudget: LIMITS.dailyBudget,
      monthlyBudget: LIMITS.dailyBudget * 30,
    });
    assert.strictEqual(attributes.grants.length, 1);
    let [grant] = attributes.grants;
    assert.strictEqual(grant.host, `127.0.0.1:${VENDOR_PORT}`);
    assert.strictEqual(grant.state, 'active');
    assert.ok(grant.lastForbiddenAt, 'the 403 is recorded on the grant');

    assert.deepEqual(
      (await useRows()).map((row) => [row.mode, row.status, row.host]),
      [
        ['interactive', 200, `127.0.0.1:${VENDOR_PORT}`],
        ['interactive', 200, `127.0.0.1:${VENDOR_PORT}`],
        ['interactive', 403, `127.0.0.1:${VENDOR_PORT}`],
        ['pipeline', 200, `127.0.0.1:${VENDOR_PORT}`],
      ],
    );
    assert.notOk(
      JSON.stringify(await useRows()).includes(VALUE),
      'no value is recorded',
    );
  });

  test('refusals are counted by code, against the share or key that refused', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });

    for (let i = 0; i < LIMITS.rateBurst; i++) {
      assert.strictEqual((await call('shared', OWNER)).status, 200);
    }
    assert.strictEqual((await call('shared', OWNER)).code, 'rate-limited');
    assert.strictEqual((await call('shared', WRITER)).status, 200);
    assert.strictEqual((await call('shared', WRITER)).status, 200);
    assert.strictEqual(
      (await call('shared', WRITER)).code,
      'over-budget',
      'the share’s daily budget of five is spent',
    );

    let response = await shareUsage(shared.id);
    assert.strictEqual(response.status, 200, response.text);
    let { attributes } = response.body.data;
    assert.deepEqual(
      attributes.budgets.day.used,
      LIMITS.dailyBudget,
      'refused calls spent nothing',
    );
    assert.strictEqual(attributes.calls, 7);
    assert.deepEqual(attributes.topCallers, [
      { caller: OWNER, calls: 4 },
      { caller: WRITER, calls: 3 },
    ]);
    assert.deepEqual(attributes.refusals, [
      { code: 'over-budget', count: 1 },
      { code: 'rate-limited', count: 1 },
    ]);
    assert.deepEqual(attributes.vendorOutcomes, [{ status: 200, count: 5 }]);
    assert.deepEqual(
      [
        attributes.lastUse.caller,
        attributes.lastUse.outcome,
        attributes.lastUse.operation,
      ],
      [WRITER, 'refused', 'shared'],
    );
    assert.deepEqual(
      (await keyUsage(key.id)).body.data.attributes.calls,
      0,
      'a call through the share is the share’s use, not the key’s',
    );
  });

  test('a call refused before any binding names a key is recorded against nothing', async function (assert) {
    let key = await addKey();
    let refused = await call('check');
    assert.strictEqual(refused.code, 'binding-not-approved');
    assert.deepEqual(await useRows(), []);
    assert.strictEqual(
      (await keyUsage(key.id)).body.data.attributes.lastUse,
      null,
    );
  });

  test('a vendor’s 401 is counted as its answer and as a refusal, and shows the grant rejected', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });

    assert.strictEqual(
      (await call('check', OWNER, '401')).code,
      'credential-rejected',
    );
    assert.strictEqual(
      (await call('check')).code,
      'credential-rejected',
      'the rejected grant refuses the next call without sending it',
    );

    let { attributes } = (await keyUsage(key.id)).body.data;
    assert.deepEqual(attributes.vendorOutcomes, [{ status: 401, count: 1 }]);
    assert.deepEqual(attributes.refusals, [
      { code: 'credential-rejected', count: 2 },
    ]);
    assert.strictEqual(attributes.grants[0].state, 'rejected');
    assert.ok(attributes.grants[0].rejectedAt);
  });

  test('a share’s usage is for its realm’s direct writers, and only its owner may edit its limits', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);

    let owner = await shareUsage(shared.id, OWNER);
    assert.strictEqual(owner.status, 200, owner.text);
    assert.true(owner.body.data.attributes.canEditLimits);

    let writer = await shareUsage(shared.id, WRITER);
    assert.strictEqual(writer.status, 200, writer.text);
    assert.false(
      writer.body.data.attributes.canEditLimits,
      'another direct writer sees the numbers but can’t edit limits',
    );

    let reader = await shareUsage(shared.id, READER);
    assert.strictEqual(reader.status, 404, 'a reader is told nothing');
    assert.strictEqual((await shareUsage('not-a-share', OWNER)).status, 404);
  });

  test('an owner who lost write no longer sees their suspended share’s usage', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });
    assert.strictEqual((await call('shared', WRITER)).status, 200);

    await insertPermissions(dbAdapter, realmURL, { [OWNER]: ['read'] });
    assert.strictEqual(
      (await shareUsage(shared.id, OWNER)).status,
      404,
      'the former writer is told nothing',
    );

    assert.strictEqual((await call('shared', WRITER)).code, 'share-suspended');
    let writer = await shareUsage(shared.id, WRITER);
    assert.strictEqual(writer.status, 200, writer.text);
    assert.deepEqual(writer.body.data.attributes.refusals, [
      { code: 'share-suspended', count: 1 },
    ]);
  });

  test('a caller no permission row in the realm names is withheld from a share’s usage', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    await approveInteractive(OWNER, 'shared', {
      apiKey: { shareId: shared.id },
    });
    assert.strictEqual((await call('shared', WRITER)).status, 200);
    // Someone admitted only by a `users` or `*` row, or a policy grant, which
    // name no one, and someone not signed in.
    for (let caller of [STRANGER, STRANGER, OTHER_STRANGER, null]) {
      await dbAdapter.execute(
        `INSERT INTO key_uses (share_id, realm_url, operation, caller, mode, outcome, status) VALUES ($1, $2, 'shared', $3, 'interactive', 'sent', 200)`,
        { bind: [shared.id, realmURL.href, caller] },
      );
    }
    await dbAdapter.execute(
      `INSERT INTO key_uses (share_id, realm_url, operation, caller, mode, outcome, status) VALUES ($1, $2, 'shared', $3, 'interactive', 'sent', 200)`,
      { bind: [shared.id, realmURL.href, STRANGER] },
    );

    let response = await shareUsage(shared.id, OWNER);
    assert.strictEqual(response.status, 200, response.text);
    let { attributes } = response.body.data;
    assert.notOk(
      JSON.stringify(attributes).includes('stranger'),
      'no unnamed caller’s id is shown',
    );
    assert.deepEqual(attributes.topCallers, [
      { caller: null, calls: 4, withheld: true },
      { caller: WRITER, calls: 1 },
      { caller: null, calls: 1 },
    ]);
    assert.deepEqual(
      [attributes.lastUse.caller, attributes.lastUse.withheld],
      [null, true],
      'the last caller is withheld too',
    );
  });

  test('a personal key’s usage is for its owner alone', async function (assert) {
    let key = await addKey();
    assert.strictEqual((await keyUsage(key.id, OWNER)).status, 200);
    assert.strictEqual((await keyUsage(key.id, WRITER)).status, 404);
    assert.strictEqual((await keyUsage('not-a-key', OWNER)).status, 404);
  });

  test('a use older than the retention window is removed when its key is next used', async function (assert) {
    let key = await addKey();
    await approveInteractive(OWNER, 'check', { userKey: { keyId: key.id } });
    await dbAdapter.execute(
      `INSERT INTO key_uses (key_id, realm_url, operation, caller, mode, outcome, created_at) VALUES ($1, $2, 'check', $3, 'interactive', 'sent', $4)`,
      {
        bind: [
          key.id,
          realmURL.href,
          OWNER,
          new Date(
            Date.now() - (KEY_USE_RETENTION_DAYS + 1) * 86_400_000,
          ).toISOString(),
        ],
      },
    );
    assert.strictEqual((await call('check')).status, 200);
    assert.strictEqual((await useRows()).length, 1, 'only the new use is kept');
  });

  test('changing a share’s limits shows in its usage', async function (assert) {
    let key = await addKey();
    let shared = await share(key.id);
    let changed = await setLimits(`/_key-shares/${shared.id}/limits`, OWNER, {
      dailyBudget: 9,
    });
    assert.strictEqual(changed.status, 200, changed.text);
    let { attributes } = (await shareUsage(shared.id, WRITER)).body.data;
    assert.strictEqual(attributes.budgets.day.budget, 9);
    assert.strictEqual(attributes.limits.dailyBudget, 9);
  });
});
