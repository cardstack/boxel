import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  CapabilityCheck,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
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

// ============================================================================
// Readiness through `_capabilities`: what a card learns about a `callApi`
// before it invokes it, answered from the bindings and grants a call would
// be filled from. Nothing here is sent anywhere, so the destinations name a
// port nothing listens on.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/key-readiness-test/');
const secureOriginURL = new URL('https://secure.readiness.test/secure');
const VENDOR = 'http://127.0.0.1:4524';
const OWNER = '@readiness-owner:localhost';
const WRITER = '@readiness-writer:localhost';
const READER = '@readiness-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'sk-readiness-owner-key-0a71e3';
const INBOX = { module: rri(`${realmURL.href}inbox`), name: 'Inbox' };
const GENERAL = `${realmURL.href}general`;

function inboxModule({ listHeader = 'authorization' } = {}) {
  return `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { operation } from "@cardstack/base/operations";

    export class Inbox extends CardDef {
      @field channel = contains(StringField);

      @operation static list = {
        base: 'callApi',
        url: '${VENDOR}/echo/list',
        headers: { '${listHeader}': 'Bearer {{userKey}}' },
      };

      @operation static note = {
        base: 'callApi',
        url: '${VENDOR}/echo/note',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static elsewhere = {
        base: 'callApi',
        url: 'http://localhost:4524/elsewhere/',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static shared = {
        base: 'callApi',
        url: '${VENDOR}/echo/shared',
        headers: { authorization: 'Bearer {{apiKey}}' },
      };

      @operation static ping = {
        base: 'callApi',
        url: '${VENDOR}/echo/ping',
      };
    }
  `;
}

function card(channel: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { channel },
      meta: { adoptsFrom: INBOX },
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;

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
      '*': ['read'],
      [OWNER]: ['read', 'write'],
      [WRITER]: ['read', 'write'],
      [READER]: ['read'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'inbox.gts': inboxModule(),
      'general.json': card('general'),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
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

  async function addKey(owner = OWNER) {
    return await addUserKey(dbAdapter, keyring, {
      owner,
      name: 'vendor',
      value: VALUE,
      ticket: await ticket(owner, 'add'),
    });
  }

  async function share(keyId: string) {
    return await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId,
      label: 'Team vendor key',
      ticket: await ticket(OWNER, 'share', { keyId, realm: realmURL }),
    });
  }

  // Approves `operation`'s one slot as `user`, naming the destination and
  // fingerprint the approval screen shows for it now.
  async function approve(
    user: string,
    operation: string,
    fill: { keyId: string } | { shareId: string },
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
    let [slot] = shown.slots;
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
    return response.body.data[0].id as string;
  }

  // Interactive use isn't offered by any approval route, so a binding that
  // allows it is made by setting the column the call reads.
  async function allowInteractive(bindingId: string) {
    await dbAdapter.execute(
      `UPDATE key_bindings SET interactive = true WHERE id = $1`,
      { bind: [bindingId] },
    );
  }

  async function capabilities(
    user: string | undefined,
    checks: CapabilityCheck[],
  ) {
    let call = request
      .post(`${realmURL.pathname}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON);
    if (user) {
      call = call.set(
        'Authorization',
        `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
      );
    }
    return await call.send({ checks });
  }

  async function readiness(user: string | undefined, operation: string) {
    let response = await capabilities(user, [
      { target: GENERAL, operation, readiness: true },
    ]);
    if (response.status !== 200) {
      throw new Error(
        `_capabilities answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body.checks[0].readiness;
  }

  test("a caller's own key: connect, then approve, then ready once interactive use is allowed", async function (assert) {
    assert.strictEqual(
      await readiness(OWNER, 'list'),
      'needs-connect',
      'no key has a grant covering the destination',
    );

    let key = await addKey();
    assert.strictEqual(
      await readiness(OWNER, 'list'),
      'needs-connect',
      'a key with no grant for the destination still needs connecting',
    );

    let binding = await approve(OWNER, 'list', { keyId: key.id });
    assert.strictEqual(
      await readiness(OWNER, 'list'),
      'needs-approval',
      'approved for pipelines only',
    );
    assert.strictEqual(
      await readiness(OWNER, 'note'),
      'needs-approval',
      'a key whose grant covers the destination, with no binding here',
    );
    assert.strictEqual(
      await readiness(OWNER, 'elsewhere'),
      'needs-connect',
      'the grant covers one host, not another',
    );

    await allowInteractive(binding);
    assert.strictEqual(
      await readiness(OWNER, 'list'),
      'ready',
      'the answer follows the approval, with nothing restarted',
    );
    assert.strictEqual(
      await readiness(WRITER, 'list'),
      'needs-connect',
      "a userKey binding is its approver's alone",
    );
  });

  test('editing what the operation sends needs re-approval, and reading readiness moves nothing', async function (assert) {
    let key = await addKey();
    let binding = await approve(OWNER, 'list', { keyId: key.id });
    await allowInteractive(binding);
    await realm.write('inbox.gts', inboxModule({ listHeader: 'x-api-key' }));
    await realm.indexing();
    assert.strictEqual(await readiness(OWNER, 'list'), 'needs-reapproval');
    let [row] = await dbAdapter.execute(
      `SELECT state FROM key_bindings WHERE id = $1`,
      { bind: [binding] },
    );
    assert.strictEqual(
      row.state,
      'active',
      'only a call moves the binding and notifies its owner',
    );
  });

  test("someone not signed in needs to sign in for a slot that takes the caller's own key", async function (assert) {
    let response = await capabilities(undefined, [
      { target: GENERAL, operation: 'list', readiness: true },
    ]);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    let [answer] = response.body.checks;
    assert.false(answer.allowed, 'they may not invoke it as they are');
    assert.strictEqual(
      answer.readiness,
      'needs-sign-in',
      JSON.stringify(response.body),
    );
  });

  test('a keyless operation is ready, and a pair that asks nothing gets no readiness', async function (assert) {
    assert.strictEqual(await readiness(WRITER, 'ping'), 'ready');
    let response = await capabilities(OWNER, [
      { target: GENERAL, operation: 'list' },
    ]);
    assert.strictEqual(response.status, 200);
    assert.deepEqual(response.body.checks, [
      { allowed: true, operation: 'list', target: GENERAL },
    ]);
  });

  test('a pair that asks for readiness with anything but true is refused', async function (assert) {
    let response = await capabilities(OWNER, [
      {
        target: GENERAL,
        operation: 'list',
        readiness: 'yes',
      } as unknown as CapabilityCheck,
    ]);
    assert.strictEqual(response.status, 400);
  });

  test("a share slot: an administrator's to set up for anyone but its key's owner, the owner's to approve, and no share details either way", async function (assert) {
    assert.strictEqual(
      await readiness(WRITER, 'shared'),
      'needs-admin',
      'no share is approved for the slot',
    );

    let key = await addKey();
    let { id: shareId } = await share(key.id);
    let binding = await approve(OWNER, 'shared', { shareId });
    assert.strictEqual(
      await readiness(OWNER, 'shared'),
      'needs-approval',
      'the owner of the share’s key can allow interactive use',
    );
    let response = await capabilities(WRITER, [
      { target: GENERAL, operation: 'shared', readiness: true },
    ]);
    assert.strictEqual(
      response.body.checks[0].readiness,
      'needs-admin',
      'anyone else is told an administrator needs to set it up',
    );
    let details = [shareId, OWNER, 'Team vendor key', key.id, binding];
    let body = JSON.stringify(response.body);
    for (let detail of details) {
      assert.false(body.includes(detail), `the answer names no ${detail}`);
    }
    // A reader the realm doesn't let invoke the operation has no readiness
    // to be told at all.
    let read = await capabilities(READER, [
      { target: GENERAL, operation: 'shared', readiness: true },
    ]);
    assert.false(read.body.checks[0].allowed);
    assert.strictEqual(read.body.checks[0].readiness, undefined);
    for (let detail of details) {
      assert.false(
        JSON.stringify(read.body).includes(detail),
        `a reader's answer names no ${detail}`,
      );
    }

    await allowInteractive(binding);
    assert.strictEqual(await readiness(WRITER, 'shared'), 'ready');
    assert.strictEqual(
      await readiness(undefined, 'shared'),
      'needs-sign-in',
      'a share serves only a signed-in caller, as a call sending a credential needs one',
    );

    await dbAdapter.execute(
      `UPDATE key_shares SET state = 'suspended', suspension_reason = 'suspended-by-writer', suspended_by = $1, suspended_at = NOW() WHERE id = $2`,
      { bind: [WRITER, shareId] },
    );
    assert.strictEqual(
      await readiness(OWNER, 'shared'),
      'needs-admin',
      'a suspended share needs an administrator, whoever asks',
    );
  });

  // Marks the grant a binding sends under as rejected by the vendor, its last
  // probe `probedAgo` ago.
  async function rejectGrantOf(bindingId: string, probedAgo: string) {
    await dbAdapter.execute(
      `UPDATE user_key_grants SET state = 'rejected', rejected_at = NOW(), last_probe_at = NOW() - $2::interval
        WHERE id = (SELECT grant_id FROM key_bindings WHERE id = $1)`,
      { bind: [bindingId, probedAgo] },
    );
  }

  test('a grant the vendor rejected reads as rejected until its probe is due, and reading readiness claims no probe', async function (assert) {
    let key = await addKey();
    let binding = await approve(OWNER, 'list', { keyId: key.id });
    await allowInteractive(binding);
    await rejectGrantOf(binding, '0 seconds');
    assert.strictEqual(
      await readiness(OWNER, 'list'),
      'credential-rejected',
      'the call would be refused until the next probe',
    );

    await rejectGrantOf(binding, '1 day');
    assert.strictEqual(
      await readiness(OWNER, 'list'),
      'ready',
      'a call now would be sent, as the probe',
    );
    let [grant] = await dbAdapter.execute(
      `SELECT g.last_probe_at < NOW() - interval '1 hour' AS untouched
         FROM user_key_grants g JOIN key_bindings b ON b.grant_id = g.id
        WHERE b.id = $1`,
      { bind: [binding] },
    );
    assert.true(grant.untouched, 'only a call claims the probe');

    let { id: shareId } = await share(key.id);
    let shared = await approve(OWNER, 'shared', { shareId });
    await allowInteractive(shared);
    await rejectGrantOf(shared, '0 seconds');
    assert.strictEqual(
      await readiness(OWNER, 'shared'),
      'credential-rejected',
      "the owner of the share's key is told the vendor rejected it",
    );
    assert.strictEqual(
      await readiness(WRITER, 'shared'),
      'needs-admin',
      'anyone else is told an administrator needs to fix it',
    );
  });
});
