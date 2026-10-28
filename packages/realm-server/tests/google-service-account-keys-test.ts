import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { generateKeyPairSync } from 'node:crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
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
import { addUserKey, mintKeyWriteTicket } from '../lib/user-keys.ts';

// ============================================================================
// Google service-account keys end to end: an owner adds a service account's
// key file, approves a card's `callApi` operations for it in a realm, and a
// pipeline the realm server runs invokes them. The realm server mints an
// access token at a stub token endpoint and sends that, never the key.
//
// The vendor's URL is written into the card module before anything starts,
// so it listens on a fixed port. Its other loopback name stands in for a
// second Google host, and its `/google-token` path for Google's token
// endpoint.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/google-service-account-keys/');
const secureOriginURL = new URL('https://secure.service-accounts.test/secure');
const VENDOR_PORT = 4527;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const SECOND_HOST = `http://localhost:${VENDOR_PORT}`;
const TOKEN_ENDPOINT = `${VENDOR}/google-token`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@service-account-owner:localhost';
const REALM_USER = '@node-test_realm:localhost';
const SHEET = { module: rri(`${realmURL.href}sheet`), name: 'Sheet' };
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
// A run of the key's base64 body, which any echo of the key would carry.
const PRIVATE_KEY_LINE = PRIVATE_KEY.split('\n')[1];
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  private_key_id: 'kid-1',
  private_key: PRIVATE_KEY,
  client_email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
});

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

    @operation static mintOwn = {
      base: 'callApi',
      method: 'POST',
      url: '${TOKEN_ENDPOINT}',
      json: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer' },
    };
  }
`;

const sheetCard: LooseSingleCardDocument = {
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
  });
  hooks.afterEach(function () {
    resetGoogleTokens();
    resetOutbound();
    resetSecretsAtRest();
  });

  setupPermissionedRealmCached(hooks, {
    realmURL,
    secureOriginURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'sheet.gts': sheetModule,
      'budget.json': sheetCard,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
      vendor.requests.length = 0;
    },
  });

  async function addServiceAccount() {
    return await addUserKey(dbAdapter, keyring, {
      owner: OWNER,
      name: 'sheets',
      kind: 'google-service-account',
      value: KEY_FILE,
      scopes: SCOPES,
      ticket: (
        await mintKeyWriteTicket(dbAdapter, OWNER, {
          action: 'add',
          keyId: null,
          realmURL: null,
          shareId: null,
        })
      ).ticket,
    });
  }

  async function approve(keyId: string, operations: string[]) {
    let approvals = [];
    for (let operation of operations) {
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
      approvals.push({
        codeRef: SHEET,
        operation,
        expectedDestination: shown.destination,
        slots: {
          userKey: {
            keyId,
            expectedFingerprint: shown.slots[0].fingerprint,
          },
        },
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
          attributes: { realm: realmURL.href, operations: approvals },
        },
      });
  }

  async function invoke(operation: string) {
    let response = (await realm.handlePipeline(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${createJWT(realm, OWNER, ['read', 'write'])}`,
        },
        body: JSON.stringify({
          'boxel:operations': [
            { op: 'invoke', 'boxel:name': operation, href: '/budget' },
          ],
        }),
      }),
    ))!;
    return {
      status: response.status,
      text: await response.text(),
    };
  }

  function sentTo(path: string) {
    return vendor.requests.filter((r) => r.path.startsWith(path));
  }

  test('the operation receives a minted access token, never the private key', async function (assert) {
    let key = await addServiceAccount();
    let approved = await approve(key.id, ['values']);
    assert.strictEqual(approved.status, 201, approved.text);

    let response = await invoke('values');
    assert.strictEqual(response.status, 200, response.text);
    let [sent] = sentTo('/echo/sheets/');
    assert.strictEqual(
      sent.headers.authorization,
      'Bearer stub-access-1',
      'the slot is filled with the token minted for the key',
    );
    for (let request of sentTo('/echo/')) {
      assert.false(
        JSON.stringify(request).includes(PRIVATE_KEY_LINE),
        'no request to the API carries the key',
      );
    }
    let [exchange] = sentTo('/google-token');
    let claims = JSON.parse(
      Buffer.from(
        new URLSearchParams(exchange.body).get('assertion')!.split('.')[1],
        'base64url',
      ).toString(),
    );
    assert.strictEqual(
      claims.iss,
      'sheets-bot@boxel-test.iam.gserviceaccount.com',
    );
    assert.strictEqual(claims.scope, SCOPES.join(' '));
    assert.false(
      response.text.includes('stub-access-1'),
      'the echoed token is scrubbed from the answer',
    );
  });

  test('a token is reused until near its expiry, and concurrent calls mint once', async function (assert) {
    let key = await addServiceAccount();
    await approve(key.id, ['values']);
    let responses = await Promise.all([
      invoke('values'),
      invoke('values'),
      invoke('values'),
    ]);
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200, 200],
    );
    await invoke('values');
    assert.strictEqual(
      sentTo('/google-token').length,
      1,
      'four calls, one exchange',
    );
    assert.deepEqual(
      sentTo('/echo/sheets/').map((r) => r.headers.authorization),
      Array(4).fill('Bearer stub-access-1'),
    );
  });

  test('one key serves two Google hosts through two grants', async function (assert) {
    let key = await addServiceAccount();
    let approved = await approve(key.id, ['values', 'files']);
    assert.strictEqual(approved.status, 201, approved.text);
    let grants = approved.body.data.map(
      (binding: { meta: { grant: { destination: string } } }) =>
        binding.meta.grant.destination,
    );
    assert.deepEqual(grants, [
      `${VENDOR}/echo/sheets/`,
      `${SECOND_HOST}/echo/drive/`,
    ]);
    let rows = await dbAdapter.execute(
      `SELECT destination FROM user_key_grants WHERE key_id = $1 ORDER BY destination`,
      { bind: [key.id] },
    );
    assert.strictEqual(rows.length, 2, 'a grant per host, never a wildcard');

    assert.strictEqual((await invoke('values')).status, 200);
    assert.strictEqual((await invoke('files')).status, 200);
    assert.strictEqual(
      sentTo('/echo/drive/')[0].headers.authorization,
      'Bearer stub-access-1',
      'both hosts get the one token minted for the key',
    );
    assert.strictEqual(sentTo('/google-token').length, 1);
  });

  test('an operation addressed to the token endpoint is refused, and nothing is sent', async function (assert) {
    let response = await invoke('mintOwn');
    assert.strictEqual(response.status, 502, response.text);
    let [refusal] = JSON.parse(response.text).errors;
    assert.strictEqual(refusal.code, 'guard-refused');
    assert.strictEqual(refusal.meta.reason, 'platform-only');
    assert.deepEqual(sentTo('/google-token'), [], 'the endpoint never heard');
  });

  test('a key Google refuses surfaces credential-rejected, and an endpoint that keeps failing does too', async function (assert) {
    let key = await addServiceAccount();
    await approve(key.id, ['values']);

    vendor.googleTokenAnswers.push({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Invalid grant.' },
    });
    let rejected = await invoke('values');
    assert.strictEqual(rejected.status, 424, rejected.text);
    let [refusal] = JSON.parse(rejected.text).errors;
    assert.strictEqual(refusal.code, 'credential-rejected');
    assert.strictEqual(refusal.meta.reason, 'rejected');
    assert.false(
      rejected.text.includes('Invalid grant.'),
      "Google's own description stays on the server",
    );
    assert.deepEqual(sentTo('/echo/'), [], 'the API was never called');

    vendor.googleTokenAnswers.push(
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    );
    let unavailable = await invoke('values');
    assert.strictEqual(unavailable.status, 424, unavailable.text);
    assert.strictEqual(
      JSON.parse(unavailable.text).errors[0].meta.reason,
      'unavailable',
    );

    let recovered = await invoke('values');
    assert.strictEqual(
      recovered.status,
      200,
      'a failure is not cached: the next call mints again',
    );
  });
});
