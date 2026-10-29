import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  fetchDirectWriters,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
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
  replaceUserKeyValue,
  type KeyWriteAction,
} from '../lib/user-keys.ts';
import { shareKey } from '../lib/key-shares.ts';
import { pipelineAdmission } from '../lib/key-bindings.ts';
import { keyReadiness } from '../lib/key-readiness.ts';
import { listKeyGrants } from '../lib/user-key-grants.ts';
import {
  claimProbe,
  markGrantRejected,
  probeIntervalFromEnv,
  setKeyGrantSink,
  type KeyGrantEvent,
} from '../lib/key-grant-rejection.ts';

// ============================================================================
// Rejected grants end to end, against the stub vendor: a 401 rejects the
// grant the key was sent under and nothing else, a 403 is recorded and changes
// nothing, calls under a rejected grant are refused without reaching the
// vendor except one probe per interval, an accepted probe clears the grant,
// replacing the key clears all of them, and entering the state notifies once.
//
// Each operation sends to `/status/{code}`, so one grant answers whichever
// status a test asks the vendor for. The vendor's URL is written into the card
// module before anything starts, so it listens on a fixed port; its other
// loopback name is another host.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/key-grant-rejection-test/');
const secureOriginURL = new URL('https://secure.rejection.test/secure');
const VENDOR_PORT = 4524;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OTHER_HOST = `http://localhost:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@rejection-owner:localhost';
const WRITER = '@rejection-writer:localhost';
const READER = '@rejection-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'sk-rejection-owner-key-5a07d1';
const NEW_VALUE = 'sk-rejection-owner-key-replaced-9c22e4';
const INBOX = { module: rri(`${realmURL.href}inbox`), name: 'Inbox' };

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

    @operation static elsewhere = {
      base: 'callApi',
      params: { code: StringField },
      url: '${OTHER_HOST}/status/{code}',
      path: { code: params('code') },
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static recheck = {
      base: 'callApi',
      params: { code: StringField },
      url: '${VENDOR}/status/{code}',
      path: { code: params('code') },
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static pair = {
      base: 'callApi',
      params: { code: StringField },
      url: '${VENDOR}/status/{code}',
      path: { code: params('code') },
      headers: {
        authorization: 'Bearer {{userKey:first}}',
        'x-second-key': '{{userKey:second}}',
      },
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
  let events: KeyGrantEvent[];

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
    setKeyGrantSink((event) => events.push(event));
  });
  hooks.afterEach(function () {
    setKeyGrantSink(undefined);
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

  async function approve(
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
    return response.body.data[0] as { meta: { grant: { id: string } } };
  }

  // Invokes `operation` on the type as a pipeline the realm server runs as
  // `user`, asking the vendor to answer `code`.
  async function call(operation: string, code: number, user = OWNER) {
    let response = (await realm.handlePipeline(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
        },
        body: JSON.stringify({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': operation,
              data: { code: String(code), meta: { adoptsFrom: INBOX } },
            },
          ],
        }),
      }),
    ))!;
    return {
      status: response.status,
      body: JSON.parse(await response.text()),
    };
  }

  async function grantRow(id: string) {
    let [row] = await dbAdapter.execute(
      `SELECT state, rejected_at, last_probe_at, last_forbidden_at, last_forbidden_host FROM user_key_grants WHERE id = $1`,
      { bind: [id] },
    );
    return row;
  }

  // Lets the next call under a rejected grant be its probe, as if the
  // interval had passed.
  async function probeIsDue(grantId: string) {
    await dbAdapter.execute(
      `UPDATE user_key_grants SET last_probe_at = NOW() - interval '1 day' WHERE id = $1`,
      { bind: [grantId] },
    );
  }

  async function notices() {
    return await dbAdapter.execute(
      `SELECT grant_id, key_name, destination, recipient, owner, realm_url, share_id, reason FROM user_key_grant_notices ORDER BY recipient`,
    );
  }

  test('a 401 rejects the grant the key was sent under, and the same key keeps working at another host', async function (assert) {
    let key = await addKey();
    let here = await approve(OWNER, 'check', { userKey: { keyId: key.id } });
    let there = await approve(OWNER, 'elsewhere', {
      userKey: { keyId: key.id },
    });
    assert.notStrictEqual(
      here.meta.grant.id,
      there.meta.grant.id,
      'one grant per host',
    );

    let refused = await call('check', 401);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].code, 'credential-rejected');
    assert.deepEqual(refused.body.errors[0].meta, {
      slot: { name: 'userKey', key: 'userKey' },
      destination: `${VENDOR}/status/`,
      entry: 0,
    });
    assert.strictEqual(
      (await grantRow(here.meta.grant.id)).state,
      'rejected',
      'the grant at the host that answered 401 is rejected',
    );
    assert.strictEqual(
      (await grantRow(there.meta.grant.id)).state,
      'active',
      "the key's other grant is not",
    );

    let elsewhere = await call('elsewhere', 200);
    assert.strictEqual(elsewhere.status, 200, JSON.stringify(elsewhere.body));
    assert.strictEqual(
      vendor.requests[vendor.requests.length - 1].headers.authorization,
      `Bearer ${VALUE}`,
      'the same key is still sent to the other host',
    );

    let rejected = (await listKeyGrants(dbAdapter, OWNER, key.id)).find(
      (g) => g.id === here.meta.grant.id,
    )!;
    assert.strictEqual(rejected.state, 'rejected', 'the owner sees it');
    assert.ok(rejected.rejectedAt, 'with when it was rejected');
    assert.deepEqual(
      events.filter((e) => e.event === 'grant-rejected'),
      [
        {
          event: 'grant-rejected',
          grant: here.meta.grant.id,
          host: `127.0.0.1:${VENDOR_PORT}`,
          realm: realmURL.href,
          share: null,
        },
      ],
      'entering the state is recorded',
    );
    assert.deepEqual(
      events
        .filter((e) => e.event === 'vendor-outcome')
        .map((e) => (e as { status: number }).status),
      [401, 200],
      'every vendor answer is recorded by host and status',
    );
  });

  test('a 403 is recorded and changes no state, and other statuses are answers', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    let forbidden = await call('check', 403);
    assert.strictEqual(forbidden.status, 200, JSON.stringify(forbidden.body));
    let row = await grantRow(approved.meta.grant.id);
    assert.strictEqual(row.state, 'active', 'a 403 changes nothing');
    let [listed] = await listKeyGrants(dbAdapter, OWNER, key.id);
    assert.strictEqual(
      listed.vendorForbidden?.host,
      `127.0.0.1:${VENDOR_PORT}`,
      'the owner sees the vendor-forbidden outcome',
    );
    assert.ok(row.last_forbidden_at, 'but is recorded on the grant');
    assert.strictEqual(row.last_forbidden_host, `127.0.0.1:${VENDOR_PORT}`);

    for (let code of [404, 429, 500]) {
      let answered = await call('check', code);
      assert.strictEqual(
        answered.status,
        200,
        `a ${code} is the vendor's answer, not a refusal`,
      );
    }
    assert.strictEqual(
      (await grantRow(approved.meta.grant.id)).state,
      'active',
    );
    assert.strictEqual(vendor.requests.length, 4);
  });

  test('while rejected, calls are refused without reaching the vendor, except one probe per interval', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    let grantId = approved.meta.grant.id;
    await call('check', 401);
    assert.strictEqual(vendor.requests.length, 1);

    for (let i = 0; i < 3; i++) {
      let refused = await call('check', 200);
      assert.strictEqual(refused.status, 424);
      assert.strictEqual(refused.body.errors[0].code, 'credential-rejected');
    }
    assert.strictEqual(
      vendor.requests.length,
      1,
      'nothing reached the vendor while the probe was not due',
    );
    let admission = await pipelineAdmission(dbAdapter, {
      core: realm.operationCore,
      realmURL,
      codeRef: INBOX,
      operation: 'check',
      payer: OWNER,
    });
    assert.strictEqual(
      admission?.error.code,
      'credential-rejected',
      'a run is not admitted while no probe is due',
    );

    await probeIsDue(grantId);
    assert.strictEqual(
      await pipelineAdmission(dbAdapter, {
        core: realm.operationCore,
        realmURL,
        codeRef: INBOX,
        operation: 'check',
        payer: OWNER,
      }),
      undefined,
      'a run is admitted once a probe is due',
    );
    let probe = await call('check', 401);
    assert.strictEqual(probe.status, 424, 'the probe was refused again');
    assert.strictEqual(vendor.requests.length, 2, 'the probe was sent');
    let after = await call('check', 200);
    assert.strictEqual(after.status, 424);
    assert.strictEqual(
      vendor.requests.length,
      2,
      'and the next call waits for the next interval',
    );
    assert.strictEqual((await grantRow(grantId)).state, 'rejected');
    assert.deepEqual(
      events
        .filter((e) => e.event === 'probe')
        .map((e) => (e as { status: number | null }).status),
      [401],
      'the probe and its result are recorded',
    );
  });

  test('readiness answers credential-rejected while a call would be held back, and ready once a probe is due', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    let grantId = approved.meta.grant.id;
    await dbAdapter.execute(
      `UPDATE key_bindings SET interactive = true WHERE grant_id = $1`,
      { bind: [grantId] },
    );
    let definition =
      (await realm.operationCore.definitionLookup.lookupDefinition(INBOX))!
        .operations!.check;
    let readiness = () =>
      keyReadiness(dbAdapter, {
        realmURL: realmURL.href,
        type: { module: String(INBOX.module), name: INBOX.name },
        operation: 'check',
        caller: OWNER,
        request: definition.callApi!,
      });
    assert.strictEqual(await readiness(), 'ready');
    await call('check', 401);
    assert.strictEqual(await readiness(), 'credential-rejected');
    await probeIsDue(grantId);
    assert.strictEqual(
      await readiness(),
      'ready',
      'a call would be sent as the probe',
    );
  });

  test('a probe the vendor accepts clears the grant', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    let grantId = approved.meta.grant.id;
    await call('check', 401);
    await probeIsDue(grantId);

    let probe = await call('check', 200);
    assert.strictEqual(probe.status, 200, JSON.stringify(probe.body));
    let row = await grantRow(grantId);
    assert.strictEqual(row.state, 'active');
    assert.strictEqual(row.rejected_at, null);

    let next = await call('check', 200);
    assert.strictEqual(next.status, 200, 'calls are sent again');
    assert.strictEqual(vendor.requests.length, 3);
    assert.deepEqual(
      events
        .filter((e) => e.event === 'grant-cleared')
        .map((e) => (e as { reason: string }).reason),
      ['probe'],
    );
  });

  test('replacing the key clears every one of its rejected grants', async function (assert) {
    let key = await addKey();
    let here = await approve(OWNER, 'check', { userKey: { keyId: key.id } });
    let there = await approve(OWNER, 'elsewhere', {
      userKey: { keyId: key.id },
    });
    await call('check', 401);
    await call('elsewhere', 401);
    assert.strictEqual((await grantRow(here.meta.grant.id)).state, 'rejected');
    assert.strictEqual((await grantRow(there.meta.grant.id)).state, 'rejected');

    await replaceUserKeyValue(dbAdapter, keyring, {
      owner: OWNER,
      id: key.id,
      value: NEW_VALUE,
      ticket: await ticket(OWNER, 'replace', { keyId: key.id }),
    });
    for (let grant of [here, there]) {
      let row = await grantRow(grant.meta.grant.id);
      assert.strictEqual(row.state, 'active');
      assert.strictEqual(row.rejected_at, null);
    }
    let sent = await call('check', 200);
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
    assert.strictEqual(
      vendor.requests[vendor.requests.length - 1].headers.authorization,
      `Bearer ${NEW_VALUE}`,
    );
    assert.deepEqual(
      events
        .filter((e) => e.event === 'grant-cleared')
        .map((e) => (e as { reason: string }).reason),
      ['key-replaced', 'key-replaced'],
    );
  });

  test("entering the state sends exactly one notice, to the owner and, for a share, to the realm's direct writers", async function (assert) {
    let key = await addKey();
    let mine = await approve(OWNER, 'check', { userKey: { keyId: key.id } });
    await call('check', 401);
    await probeIsDue(mine.meta.grant.id);
    await call('check', 401);
    await call('check', 401);
    assert.deepEqual(
      await notices(),
      [
        {
          grant_id: mine.meta.grant.id,
          key_name: 'vendor',
          destination: `${VENDOR}/status/`,
          recipient: OWNER,
          owner: OWNER,
          realm_url: null,
          share_id: null,
          reason: 'credential-rejected',
        },
      ],
      'one notice, to the owner, naming the key and the destination',
    );

    await dbAdapter.execute(`DELETE FROM user_key_grant_notices`);
    let sharedKey = await addKey(OWNER, 'shared vendor');
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: sharedKey.id,
      label: 'Vendor',
      ticket: await ticket(OWNER, 'share', {
        keyId: sharedKey.id,
        realm: realmURL,
      }),
    });
    let shared = await approve(OWNER, 'shared', {
      apiKey: { shareId: share.id },
    });
    let refused = await call('shared', 401, WRITER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.deepEqual(
      (await notices()).map((n: Record<string, unknown>) => ({
        recipient: n.recipient,
        grant_id: n.grant_id,
        realm_url: n.realm_url,
        share_id: n.share_id,
      })),
      (await fetchDirectWriters(dbAdapter, realmURL)).map((recipient) => ({
        recipient,
        grant_id: shared.meta.grant.id,
        realm_url: realmURL.href,
        share_id: share.id,
      })),
      "the owner and the realm's direct writers, and not its readers",
    );
    assert.false(
      (await notices()).some(
        (n: Record<string, unknown>) => n.recipient === READER,
      ),
      'a reader gets none',
    );
  });

  test('a 401 to a request carrying two keys rejects the grant of each', async function (assert) {
    let first = await addKey(OWNER, 'first');
    let second = await addKey(OWNER, 'second');
    let approved = await request
      .get('/_key-bindings/preview')
      .query({
        realm: realmURL.href,
        module: INBOX.module,
        name: INBOX.name,
        operation: 'pair',
      })
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER));
    assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));
    await approve(OWNER, 'pair', {
      'userKey:first': { keyId: first.id },
      'userKey:second': { keyId: second.id },
    });
    let refused = await call('pair', 401);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    let states = await dbAdapter.execute(
      `SELECT key_id, state FROM user_key_grants WHERE key_id = ANY($1::uuid[]) ORDER BY key_id`,
      { bind: [[first.id, second.id]] },
    );
    assert.deepEqual(
      states.map((r: Record<string, unknown>) => r.state),
      ['rejected', 'rejected'],
      'the vendor does not say which key it refused, so both are held back',
    );
  });

  test('a 401 to the value a key held before it was replaced leaves the replaced key alone', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    let grantId = approved.meta.grant.id;
    let [{ copy }] = await dbAdapter.execute(
      `SELECT encode(value_nonce, 'base64') AS copy FROM user_key_grants WHERE id = $1`,
      { bind: [grantId] },
    );
    await replaceUserKeyValue(dbAdapter, keyring, {
      owner: OWNER,
      id: key.id,
      value: NEW_VALUE,
      ticket: await ticket(OWNER, 'replace', { keyId: key.id }),
    });
    assert.false(
      await markGrantRejected(dbAdapter, {
        grantId,
        realmURL: realmURL.href,
        copy: copy as string,
      }),
      'a refusal of the old value',
    );
    assert.strictEqual((await grantRow(grantId)).state, 'active');
    assert.deepEqual(await notices(), [], 'and nobody is told');
  });

  test('of probes claimed at once, exactly one wins', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    let grantId = approved.meta.grant.id;
    await call('check', 401);
    await probeIsDue(grantId);
    let claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        claimProbe(dbAdapter, grantId, 15 * 60 * 1000),
      ),
    );
    assert.strictEqual(claims.filter(Boolean).length, 1);
  });

  test("approving another operation at a rejected grant's destination reuses the grant, still rejected", async function (assert) {
    let key = await addKey();
    let first = await approve(OWNER, 'check', { userKey: { keyId: key.id } });
    await call('check', 401);
    let again = await approve(OWNER, 'recheck', {
      userKey: { keyId: key.id },
    });
    assert.strictEqual(again.meta.grant.id, first.meta.grant.id);
    let refused = await call('recheck', 200);
    assert.strictEqual(
      refused.body.errors?.[0]?.code,
      'credential-rejected',
      'the refused key is not sent there again through a new approval',
    );
    assert.strictEqual(vendor.requests.length, 1);
  });

  test('the probe interval is a platform setting', function (assert) {
    assert.strictEqual(probeIntervalFromEnv(undefined), 15 * 60 * 1000);
    assert.strictEqual(probeIntervalFromEnv('60'), 60 * 1000);
    assert.throws(() => probeIntervalFromEnv('soon'), /must be a number/);
  });
});
