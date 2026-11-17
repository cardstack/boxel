import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Readable } from 'stream';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType, type Realm } from '@cardstack/runtime-common';
import {
  RUN_LOG_PATH,
  readRunLog,
} from '@cardstack/runtime-common/automation-run-log';
import { RUN_COMMIT_PATH } from '@cardstack/runtime-common/run-overlay';
import {
  automationFixture,
  createAutomationRunToken,
  createJWT,
  setupPermissionedRealmCached,
  TEST_AUTOMATION_PATH,
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
import { addUserKey, mintKeyWriteTicket } from '../lib/user-keys.ts';
import { nodeStreamToBuffer } from '../stream.ts';

// A credential a vendor echoes back never reaches an automation run's
// script, its log or a card it writes. The stub vendor plants the key the
// run's call carried in a response body, in an error answer, and in the
// address of a redirect to another origin. For each, the test reads what the
// script is handed, sends that to the run's log as a script would print it,
// writes it into a card through the run's overlay and commits it, and looks
// for the key everywhere it went.

const realmURL = new URL(
  'http://127.0.0.1:4444/automation-run-log-redaction-test/',
);
const secureOriginURL = new URL('https://secure.run-log.test/secure');
const VENDOR_PORT = 4544;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const JSONAPI = 'application/vnd.api+json';
const SOURCE = 'application/vnd.card+source';
const OWNER = '@run-log-redaction-owner:localhost';
const REALM_USER = '@node-test_realm:localhost';
// Not shaped like any vendor's key, so only the scrubber, which knows the
// value it sent, can find it.
const VALUE = 'plain-vendor-credential-5be0a91f7d';
const VAULT = { module: rri(`${realmURL.href}vault`), name: 'Vault' };

const vaultModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import { operation } from "@cardstack/base/operations";

  export class Vault extends CardDef {
    @operation static body = {
      base: 'callApi',
      url: '${VENDOR}/leak/body',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static failure = {
      base: 'callApi',
      url: '${VENDOR}/leak/error',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static redirect = {
      base: 'callApi',
      url: '${VENDOR}/leak/redirect',
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

const LEAKS = ['body', 'failure', 'redirect'] as const;

module(basename(import.meta.filename), function (hooks) {
  setupCatalogTestSubset(hooks);

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
  });
  hooks.afterEach(function () {
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
      'vault.gts': vaultModule,
      ...automationFixture({
        operations: [{ type: VAULT, names: [...LEAKS] }],
      }),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter as PgAdapter;
      vendor.requests.length = 0;
    },
  });

  async function approveAll() {
    let key = await addUserKey(dbAdapter, keyring, {
      owner: OWNER,
      name: 'vendor',
      value: VALUE,
      ticket: (
        await mintKeyWriteTicket(dbAdapter, OWNER, {
          action: 'add',
          keyId: null,
          realmURL: null,
          shareId: null,
        })
      ).ticket,
    });
    let operations = [];
    for (let operation of LEAKS) {
      let preview = await request
        .get('/_key-bindings/preview')
        .query({
          realm: realmURL.href,
          module: VAULT.module,
          name: VAULT.name,
          operation,
        })
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER));
      operations.push({
        codeRef: VAULT,
        operation,
        expectedDestination: `${VENDOR}/leak/`,
        slots: {
          userKey: {
            keyId: key.id,
            expectedFingerprint: preview.body.data?.attributes?.slots.find(
              (s: { slot: string }) => s.slot === 'userKey',
            )?.fingerprint,
          },
        },
      });
    }
    let approved = await request
      .post('/_key-bindings')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: { realm: realmURL.href, operations },
        },
      });
    if (approved.status !== 201) {
      throw new Error(`approval failed: ${JSON.stringify(approved.body)}`);
    }
  }

  async function asRun(token: string, path: string, init: RequestInit) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${token}`,
        },
      }),
    ))! as Response & { nodeStream?: Readable };
    return {
      status: response.status,
      text: response.nodeStream
        ? (await nodeStreamToBuffer(response.nodeStream)).toString()
        : await response.text(),
    };
  }

  for (let leak of LEAKS) {
    test(`a key the vendor echoes in ${leak === 'body' ? 'a response body' : leak === 'failure' ? 'an error' : 'a redirect'} reaches neither the script, the log nor a written card`, async function (assert) {
      await approveAll();
      let { token, run } = await createAutomationRunToken(
        dbAdapter,
        realm,
        OWNER,
        { automation: TEST_AUTOMATION_PATH },
      );

      // What the script is handed.
      let answer = await asRun(token, '_operations', {
        method: 'POST',
        headers: { Accept: OPERATIONS, 'Content-Type': OPERATIONS },
        body: JSON.stringify({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': leak,
              data: { meta: { adoptsFrom: VAULT } },
            },
          ],
        }),
      });
      assert.strictEqual(answer.status, 200, answer.text);
      assert.strictEqual(vendor.requests.length, 1, 'the vendor was called');
      assert.strictEqual(
        vendor.requests[0].headers.authorization,
        `Bearer ${VALUE}`,
        'the call carried the key',
      );
      assert.false(
        answer.text.includes(VALUE),
        `the script sees: ${answer.text}`,
      );
      assert.true(
        answer.text.includes('[REDACTED]'),
        `the vendor's echo reached the answer, scrubbed: ${answer.text}`,
      );

      // The script prints what it was handed.
      let logged = await asRun(token, RUN_LOG_PATH.slice(1), {
        method: 'POST',
        headers: { Accept: JSONAPI, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [
            {
              kind: 'console',
              at: Date.now(),
              level: 'log',
              message: answer.text,
            },
          ],
        }),
      });
      assert.strictEqual(logged.status, 200, logged.text);

      // And writes it into a card.
      let staged = await asRun(token, `leaks/${leak}.json`, {
        method: 'POST',
        headers: { Accept: SOURCE },
        body: JSON.stringify({
          data: {
            type: 'card',
            attributes: { cardInfo: { name: answer.text.slice(0, 2000) } },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        }),
      });
      assert.strictEqual(staged.status, 204, staged.text);
      let committed = await asRun(token, RUN_COMMIT_PATH.slice(1), {
        method: 'POST',
        headers: { Accept: JSONAPI },
      });
      assert.strictEqual(committed.status, 200, committed.text);

      let log = JSON.stringify(await readRunLog(dbAdapter, run.id));
      assert.true(log.includes('callApi'), 'the call is in the log');
      assert.false(log.includes(VALUE), `the log holds: ${log}`);

      let written = await asRun(
        createJWT(realm, OWNER, ['read', 'write']),
        `leaks/${leak}.json`,
        { headers: { Accept: SOURCE } },
      );
      assert.strictEqual(written.status, 200, written.text);
      assert.false(
        written.text.includes(VALUE),
        `the card holds: ${written.text}`,
      );
    });
  }
});
