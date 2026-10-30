import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { generateKeyPairSync } from 'node:crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  fetchDirectWriters,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  configureGoogleTokens,
  resetGoogleTokens,
} from '../lib/outbound/google-service-account.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  addUserKey,
  listUserKeys,
  mintKeyWriteTicket,
  replaceUserKeyValue,
  type KeyWriteAction,
} from '../lib/user-keys.ts';
import { shareKey } from '../lib/key-shares.ts';
import {
  markKeyRejected,
  setKeyGrantSink,
  type KeyGrantEvent,
} from '../lib/key-grant-rejection.ts';

// ============================================================================
// Service-account keys Google refuses, end to end against a stub token
// endpoint: a refused mint makes the key `rejected` and readiness answers
// `credential-rejected`; while it is rejected, calls are refused without
// contacting Google except one probe per interval; a probe that mints clears
// it, and so does replacing the key; entering the state notifies once.
//
// The vendor's URL is written into the card module before anything starts,
// so it listens on a fixed port; its other loopback name is a second Google
// host, and its `/google-token` path stands in for Google's token endpoint.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/service-account-rejection/');
const secureOriginURL = new URL(
  'https://secure.service-account-rejection.test/secure',
);
const VENDOR_PORT = 4528;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const SECOND_HOST = `http://localhost:${VENDOR_PORT}`;
const TOKEN_ENDPOINT = `${VENDOR}/google-token`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@sa-rejection-owner:localhost';
const WRITER = '@sa-rejection-writer:localhost';
const READER = '@sa-rejection-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const SHEET = { module: rri(`${realmURL.href}sheet`), name: 'Sheet' };
const BUDGET = `${realmURL.href}budget`;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const REFUSED = {
  status: 400,
  body: { error: 'invalid_grant', error_description: 'Invalid grant.' },
};

function keyFile() {
  return JSON.stringify({
    type: 'service_account',
    private_key_id: 'kid-1',
    private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    client_email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
  });
}

const sheetModule = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Sheet extends CardDef {
    @field title = contains(StringField);

    @operation static values = {
      base: 'callApi',
      url: '${VENDOR}/echo/sheets/values',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static files = {
      base: 'callApi',
      url: '${SECOND_HOST}/echo/drive/files',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static shared = {
      base: 'callApi',
      url: '${VENDOR}/echo/sheets/shared',
      headers: { authorization: 'Bearer {{apiKey}}' },
    };
  }
`;

const budgetCard: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: { title: 'Budget' },
    meta: { adoptsFrom: SHEET },
  },
};

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
    configureGoogleTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      retryDelaysMs: [1, 1],
    });
    vendor.googleTokenAnswers.length = 0;
    vendor.googleTokensMinted.length = 0;
    vendor.googleTokenLifetime = 3600;
    events = [];
    setKeyGrantSink((event) => events.push(event));
  });
  hooks.afterEach(function () {
    setKeyGrantSink(undefined);
    resetGoogleTokens();
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
      'sheet.gts': sheetModule,
      'budget.json': budgetCard,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
      vendor.requests.length = 0;
    },
  });

  async function ticket(
    action: KeyWriteAction,
    {
      keyId = null,
      realm = null,
    }: { keyId?: string | null; realm?: URL | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, OWNER, {
        action,
        keyId,
        realmURL: realm?.href ?? null,
        shareId: null,
      })
    ).ticket;
  }

  async function addServiceAccount(name = 'sheets') {
    return await addUserKey(dbAdapter, keyring, {
      owner: OWNER,
      name,
      kind: 'google-service-account',
      value: keyFile(),
      scopes: SCOPES,
      ticket: await ticket('add'),
    });
  }

  // Approves `operation`'s one slot, naming what the approval screen shows
  // for it now, and allows its interactive use, so readiness reads `ready`
  // for a key Google accepts.
  async function approve(
    operation: string,
    fill: { keyId: string } | { shareId: string },
  ) {
    let shown = (
      await request
        .get('/_key-bindings/preview')
        .query({
          realm: realmURL.href,
          module: SHEET.module,
          name: SHEET.name,
          operation,
        })
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
    ).body.data.attributes;
    let [slot] = shown.slots;
    let response = await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm: realmURL.href,
            operations: [
              {
                codeRef: SHEET,
                operation,
                expectedDestination: shown.destination,
                slots: {
                  [slot.slot]: {
                    ...fill,
                    expectedFingerprint: slot.fingerprint,
                  },
                },
              },
            ],
          },
        },
      });
    if (response.status !== 201) {
      throw new Error(
        `approving ${operation} answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    let [binding] = response.body.data;
    await dbAdapter.execute(
      `UPDATE key_bindings SET interactive = true WHERE id = $1`,
      { bind: [binding.id] },
    );
    return binding as { id: string; meta: { grant: { id: string } } };
  }

  async function invoke(operation: string, user = OWNER) {
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
            { op: 'invoke', 'boxel:name': operation, href: '/budget' },
          ],
        }),
      }),
    ))!;
    let text = await response.text();
    let body = JSON.parse(text);
    let [result] = body['boxel:results'] ?? [body];
    return {
      status: response.status,
      text,
      error: result?.errors?.[0] as
        | { code: string; meta?: { reason?: string } }
        | undefined,
    };
  }

  async function readiness(operation: string, user = OWNER) {
    let response = await request
      .post(`${realmURL.pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
      )
      .send({ checks: [{ target: BUDGET, operation, readiness: true }] });
    if (response.status !== 200) {
      throw new Error(
        `_capabilities answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body.checks[0].readiness;
  }

  async function keyRow(id: string) {
    let [row] = await dbAdapter.execute(
      `SELECT state, rejected_at, last_probe_at FROM user_keys WHERE id = $1`,
      { bind: [id] },
    );
    return row;
  }

  // Lets the next call under a rejected key be its probe, as if the interval
  // had passed.
  async function probeIsDue(keyId: string) {
    await dbAdapter.execute(
      `UPDATE user_keys SET last_probe_at = NOW() - interval '1 day' WHERE id = $1`,
      { bind: [keyId] },
    );
  }

  async function notices() {
    return await dbAdapter.execute(
      `SELECT grant_id, key_id, key_name, destination, recipient, owner, realm_url, share_id, reason FROM user_key_grant_notices ORDER BY recipient`,
    );
  }

  function tokenRequests() {
    return vendor.requests.filter((r) => r.path.startsWith('/google-token'));
  }

  function apiRequests() {
    return vendor.requests.filter((r) => r.path.startsWith('/echo/'));
  }

  test('a key Google refuses becomes rejected, and readiness answers credential-rejected', async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    assert.strictEqual(await readiness('values'), 'ready');

    vendor.googleTokenAnswers.push(REFUSED);
    let refused = await invoke('values');
    assert.strictEqual(refused.status, 424, refused.text);
    assert.strictEqual(refused.error?.code, 'credential-rejected');
    assert.strictEqual(refused.error?.meta?.reason, 'rejected');
    assert.false(
      refused.text.includes('Invalid grant.'),
      "Google's own description stays on the server",
    );
    assert.deepEqual(apiRequests(), [], 'the API was never called');

    let row = await keyRow(key.id);
    assert.strictEqual(row.state, 'rejected');
    assert.notStrictEqual(row.rejected_at, null);
    let [listed] = await listUserKeys(dbAdapter, OWNER);
    assert.strictEqual(listed.state, 'rejected', "the owner's list says so");
    assert.strictEqual(await readiness('values'), 'credential-rejected');
    assert.deepEqual(
      events.filter((e) => e.event === 'key-rejected'),
      [
        {
          event: 'key-rejected',
          key: key.id,
          realm: realmURL.href,
          share: null,
        },
      ],
    );
  });

  test('while rejected, calls through any grant of the key send nothing to Google until a probe is due', async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    await approve('files', { keyId: key.id });
    vendor.googleTokenAnswers.push(REFUSED);
    await invoke('values');
    assert.strictEqual(tokenRequests().length, 1);

    for (let operation of ['values', 'files', 'values']) {
      let refused = await invoke(operation);
      assert.strictEqual(refused.status, 424, refused.text);
      assert.strictEqual(refused.error?.code, 'credential-rejected');
      assert.strictEqual(refused.error?.meta?.reason, 'rejected');
    }
    assert.strictEqual(
      tokenRequests().length,
      1,
      'within the interval, nothing reaches the token endpoint',
    );
    assert.deepEqual(apiRequests(), []);
    assert.strictEqual(
      await readiness('files'),
      'credential-rejected',
      'every grant of the key reads as rejected',
    );
  });

  test('a probe Google refuses again keeps the key rejected; a probe that mints clears it', async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    vendor.googleTokenAnswers.push(REFUSED);
    await invoke('values');

    await probeIsDue(key.id);
    vendor.googleTokenAnswers.push(REFUSED);
    let reprobed = await invoke('values');
    assert.strictEqual(reprobed.status, 424, reprobed.text);
    assert.strictEqual(tokenRequests().length, 2, 'the probe asked Google');
    assert.strictEqual((await keyRow(key.id)).state, 'rejected');
    assert.strictEqual(
      (await invoke('values')).status,
      424,
      'the probe started a new interval',
    );
    assert.strictEqual(tokenRequests().length, 2);

    await probeIsDue(key.id);
    let probed = await invoke('values');
    assert.strictEqual(probed.status, 200, probed.text);
    assert.strictEqual(
      apiRequests()[0].headers.authorization,
      'Bearer stub-access-1',
      'the probe that minted sends its token',
    );
    let row = await keyRow(key.id);
    assert.strictEqual(row.state, 'active');
    assert.strictEqual(row.rejected_at, null);
    assert.strictEqual(row.last_probe_at, null);
    assert.strictEqual(await readiness('values'), 'ready');
    assert.strictEqual((await invoke('values')).status, 200);
    assert.deepEqual(
      events
        .filter((e) => e.event === 'key-probe' || e.event === 'key-cleared')
        .map((e) => ({ ...e, key: undefined })),
      [
        { event: 'key-probe', key: undefined, minted: false },
        { event: 'key-probe', key: undefined, minted: true },
        { event: 'key-cleared', key: undefined, reason: 'probe' },
      ],
    );
  });

  test('replacing the key clears the state for all of its grants at once', async function (assert) {
    let key = await addServiceAccount();
    let values = await approve('values', { keyId: key.id });
    await approve('files', { keyId: key.id });
    vendor.googleTokenAnswers.push(REFUSED);
    await invoke('values');
    // A vendor's 401 under one grant rejects that grant too, which the
    // replacement clears with the key.
    await dbAdapter.execute(
      `UPDATE user_key_grants SET state = 'rejected', rejected_at = NOW() WHERE id = $1`,
      { bind: [values.meta.grant.id] },
    );

    let replaced = await replaceUserKeyValue(dbAdapter, keyring, {
      owner: OWNER,
      id: key.id,
      value: keyFile(),
      scopes: SCOPES,
      ticket: await ticket('replace', { keyId: key.id }),
    });
    assert.strictEqual(replaced.state, 'active');
    let row = await keyRow(key.id);
    assert.strictEqual(row.state, 'active');
    assert.strictEqual(row.rejected_at, null);
    let grants = await dbAdapter.execute(
      `SELECT state FROM user_key_grants WHERE key_id = $1`,
      { bind: [key.id] },
    );
    assert.deepEqual(
      grants.map((g: Record<string, unknown>) => g.state),
      ['active', 'active'],
    );
    assert.strictEqual(await readiness('values'), 'ready');
    assert.strictEqual(await readiness('files'), 'ready');
    assert.strictEqual((await invoke('values')).status, 200);
    assert.strictEqual((await invoke('files')).status, 200);
    assert.deepEqual(
      events.filter((e) => e.event === 'key-cleared'),
      [{ event: 'key-cleared', key: key.id, reason: 'key-replaced' }],
    );
  });

  test('entering the state sends exactly one notice, to the owner', async function (assert) {
    let key = await addServiceAccount();
    let values = await approve('values', { keyId: key.id });
    vendor.googleTokenAnswers.push(REFUSED);
    await invoke('values');
    await invoke('values');
    await probeIsDue(key.id);
    vendor.googleTokenAnswers.push(REFUSED);
    await invoke('values');
    assert.deepEqual(await notices(), [
      {
        grant_id: values.meta.grant.id,
        key_id: key.id,
        key_name: 'sheets',
        destination: `${VENDOR}/echo/sheets/`,
        recipient: OWNER,
        owner: OWNER,
        realm_url: null,
        share_id: null,
        reason: 'key-rejected',
      },
    ]);
  });

  test("a shared key Google refuses notifies its owner and the realm's direct writers once, and readiness tells every caller", async function (assert) {
    let key = await addServiceAccount('team sheets');
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Team sheets',
      ticket: await ticket('share', { keyId: key.id, realm: realmURL }),
    });
    let shared = await approve('shared', { shareId: share.id });
    assert.strictEqual(await readiness('shared', WRITER), 'ready');

    vendor.googleTokenAnswers.push(REFUSED);
    let refused = await invoke('shared', WRITER);
    assert.strictEqual(refused.status, 424, refused.text);
    assert.strictEqual(refused.error?.code, 'credential-rejected');
    await invoke('shared', WRITER);

    let recipients = (await notices()).map((n: Record<string, unknown>) => ({
      recipient: n.recipient,
      grant_id: n.grant_id,
      realm_url: n.realm_url,
      share_id: n.share_id,
    }));
    let expected = [
      ...new Set([
        OWNER,
        ...(await fetchDirectWriters(dbAdapter, realmURL, 'localhost')),
      ]),
    ]
      .sort()
      .map((recipient) => ({
        recipient,
        grant_id: shared.meta.grant.id,
        realm_url: realmURL.href,
        share_id: share.id,
      }));
    assert.deepEqual(recipients, expected, 'one notice per recipient');
    assert.false(
      recipients.some((n) => n.recipient === READER),
      'readers are not notified',
    );
    assert.strictEqual(
      await readiness('shared', WRITER),
      'credential-rejected',
    );
    assert.strictEqual(await readiness('shared', OWNER), 'credential-rejected');
  });

  test('an endpoint that keeps failing leaves the key active, and the next call mints again', async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    vendor.googleTokenAnswers.push(
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    );
    let unavailable = await invoke('values');
    assert.strictEqual(unavailable.status, 424, unavailable.text);
    assert.strictEqual(unavailable.error?.meta?.reason, 'unavailable');
    assert.strictEqual((await keyRow(key.id)).state, 'active');
    assert.strictEqual(await readiness('values'), 'ready');
    assert.strictEqual((await invoke('values')).status, 200);
    assert.deepEqual(await notices(), []);
  });

  test("a refusal that isn't about the key refuses the call and leaves the key active", async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    vendor.googleTokenAnswers.push(
      { status: 403, body: {} },
      {
        status: 400,
        body: {
          error: 'invalid_grant',
          error_description:
            'Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.',
        },
      },
    );
    for (let i = 0; i < 2; i++) {
      let refused = await invoke('values');
      assert.strictEqual(refused.status, 424, refused.text);
      assert.strictEqual(refused.error?.code, 'credential-rejected');
      assert.strictEqual((await keyRow(key.id)).state, 'active');
    }
    assert.strictEqual(await readiness('values'), 'ready');
    assert.deepEqual(await notices(), []);
    assert.deepEqual(
      events.filter((e) => e.event === 'key-rejected'),
      [],
    );
    assert.strictEqual((await invoke('values')).status, 200);
  });

  test('of two calls arriving together when the probe is due, only one probes', async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    vendor.googleTokenAnswers.push(REFUSED);
    await invoke('values');
    await probeIsDue(key.id);

    // Google refuses the probe too, so the key stays rejected however the two
    // calls interleave.
    vendor.googleTokenAnswers.push(REFUSED, REFUSED);
    let statuses = (
      await Promise.all([invoke('values'), invoke('values')])
    ).map((r) => r.status);
    assert.deepEqual(statuses, [424, 424]);
    assert.strictEqual(
      events.filter((e) => e.event === 'key-probe').length,
      1,
      'one call claimed the probe',
    );
    assert.strictEqual(tokenRequests().length, 2, 'one refusal, one probe');
  });

  test('a probe asks Google even when this process cached a token for the key', async function (assert) {
    let key = await addServiceAccount();
    await approve('values', { keyId: key.id });
    assert.strictEqual(
      (await invoke('values')).status,
      200,
      'a token is cached',
    );
    // Another process found the key refused; this one still holds its token.
    await dbAdapter.execute(
      `UPDATE user_keys SET state = 'rejected', rejected_at = NOW(), last_probe_at = NOW() - interval '1 day' WHERE id = $1`,
      { bind: [key.id] },
    );
    vendor.googleTokenAnswers.push(REFUSED);
    let probed = await invoke('values');
    assert.strictEqual(probed.status, 424, probed.text);
    assert.strictEqual(tokenRequests().length, 2, 'the probe asked Google');
    assert.strictEqual((await keyRow(key.id)).state, 'rejected');
  });

  test('a refusal of a value since replaced leaves the new value alone', async function (assert) {
    let key = await addServiceAccount();
    let values = await approve('values', { keyId: key.id });
    let [{ copy }] = await dbAdapter.execute(
      `SELECT encode(value_nonce, 'base64') AS copy FROM user_keys WHERE id = $1`,
      { bind: [key.id] },
    );
    await replaceUserKeyValue(dbAdapter, keyring, {
      owner: OWNER,
      id: key.id,
      value: keyFile(),
      scopes: SCOPES,
      ticket: await ticket('replace', { keyId: key.id }),
    });
    let moved = await markKeyRejected(dbAdapter, {
      keyId: key.id,
      grantId: values.meta.grant.id,
      realmURL: realmURL.href,
      copy: copy as string,
    });
    assert.false(moved);
    assert.strictEqual((await keyRow(key.id)).state, 'active');
    assert.deepEqual(await notices(), []);
  });

  test('readiness answers credential-rejected for any rejected key, whatever its kind', async function (assert) {
    let key = await addUserKey(dbAdapter, keyring, {
      owner: OWNER,
      name: 'static sheets',
      value: 'sk-static-sheets-value-3d81a0',
      ticket: await ticket('add'),
    });
    await approve('values', { keyId: key.id });
    assert.strictEqual(await readiness('values'), 'ready');
    // An OAuth connection its vendor refused to refresh is `rejected` the
    // same way.
    await dbAdapter.execute(
      `UPDATE user_keys SET state = 'rejected' WHERE id = $1`,
      { bind: [key.id] },
    );
    assert.strictEqual(await readiness('values'), 'credential-rejected');
  });
});
