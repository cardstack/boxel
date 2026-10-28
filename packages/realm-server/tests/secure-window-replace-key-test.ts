import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
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
import { markGrantRejected } from '../lib/key-grant-rejection.ts';

// What the secure window's `replace-key` page reads: for each of an
// operation's credential slots, the key the user's binding fills it with and
// whether the service rejected it, or, for a workspace's shared key, the share
// and who can replace it. And that replacing the key the page names, as the
// page does it, returns its rejected grant to use.

const realmURL = new URL('http://127.0.0.1:4444/secure-window-replace-key/');
const secureOriginURL = new URL('https://secure.replace-key.test/secure');
const OWNER = '@replace-owner:localhost';
const WRITER = '@replace-writer:localhost';
const READER = '@replace-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VALUE = 'sk-replace-key-owner-3b81c0';
const NEW_VALUE = 'sk-replace-key-owner-replaced-77d2aa';
const INBOX = { module: rri(`${realmURL.href}inbox`), name: 'Inbox' };

const inboxModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import { operation } from "@cardstack/base/operations";

  export class Inbox extends CardDef {
    static displayName = 'Inbox';

    @operation static check = {
      base: 'callApi',
      url: 'https://api.mail.example.com/v1/inbox',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static shared = {
      base: 'callApi',
      url: 'https://api.mail.example.com/v1/team',
      headers: { authorization: 'Bearer {{apiKey}}' },
    };

    @operation static perCard = {
      base: 'callApi',
      perInstance: true,
      url: 'https://api.mail.example.com/v1/card',
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

module(basename(import.meta.filename), function (hooks) {
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;

  hooks.beforeEach(async function () {
    keyring = installSecretsKeyring(
      await new LocalKeyProvider().loadDataKeys(),
    );
  });
  hooks.afterEach(function () {
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
      'today.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: INBOX },
        },
      },
    },
    onRealmSetup(args) {
      request = args.request;
      dbAdapter = args.dbAdapter;
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm = null,
    }: { keyId?: string | null; realm?: URL | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realm?.href ?? null,
        shareId: null,
      })
    ).ticket;
  }

  async function addKey(owner = OWNER, name = 'mail') {
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
    instance?: string,
  ) {
    let auth = await secureSessionAuth(dbAdapter, user);
    let shown = (
      await request
        .get('/_key-bindings/preview')
        .query({
          realm: realmURL.href,
          module: INBOX.module,
          name: INBOX.name,
          operation,
        })
        .set('Authorization', auth)
    ).body.data.attributes;
    let response = await request
      .post('/_key-bindings')
      .set('Authorization', auth)
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
                ...(instance ? { instance } : {}),
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

  async function reject(grantId: string, shareId?: string) {
    await markGrantRejected(dbAdapter, {
      grantId,
      realmURL: realmURL.href,
      ...(shareId ? { shareId } : {}),
    });
  }

  // What the window asks, for an operation on the type or on `today`.
  async function bound(
    user: string,
    operation: string,
    target: 'type' | 'instance' = 'type',
  ) {
    let response = await request
      .post('/_secure-window/context')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'secure-window-context',
          attributes: {
            target:
              target === 'type'
                ? {
                    kind: 'type',
                    module: INBOX.module,
                    name: INBOX.name,
                    realm: realmURL.href,
                  }
                : { kind: 'instance', url: `${realmURL.href}today` },
            operation,
            bindings: true,
          },
        },
      });
    if (response.status !== 200) {
      throw new Error(`context failed: ${response.status} ${response.text}`);
    }
    return response.body.data.attributes.operation.slots;
  }

  // Replaces a key as the secure window does: a ticket minted for that
  // replace by the window's own session, then the new value.
  async function replaceAsTheWindowDoes(owner: string, keyId: string) {
    let auth = await secureSessionAuth(dbAdapter, owner);
    let minted = await request
      .post('/_key-write-tickets')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-write-ticket',
          attributes: { action: 'replace', keyId },
        },
      });
    if (minted.status !== 201) {
      throw new Error(`ticket refused: ${minted.status} ${minted.text}`);
    }
    return await request
      .patch(`/_user-keys/${keyId}`)
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: { type: 'user-key', id: keyId, attributes: { value: NEW_VALUE } },
        meta: { ticket: minted.body.data.attributes.ticket },
      });
  }

  async function grantState(id: string) {
    let [row] = await dbAdapter.execute(
      `SELECT state FROM user_key_grants WHERE id = $1`,
      { bind: [id] },
    );
    return row?.state;
  }

  test('names the key a user’s binding fills a slot with, and that the service rejected it', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    assert.deepEqual(await bound(OWNER, 'check'), [
      {
        name: 'userKey',
        key: 'userKey',
        bound: { rejected: false, key: { id: key.id, name: 'mail' } },
      },
    ]);

    await reject(approved.meta.grant.id);
    assert.deepEqual(
      await bound(OWNER, 'check'),
      [
        {
          name: 'userKey',
          key: 'userKey',
          bound: { rejected: true, key: { id: key.id, name: 'mail' } },
        },
      ],
      'on the card as on its type',
    );
    assert.deepEqual(
      await bound(OWNER, 'check', 'instance'),
      await bound(OWNER, 'check'),
    );
    assert.deepEqual(
      await bound(READER, 'check'),
      [{ name: 'userKey', key: 'userKey', bound: null }],
      'another user’s binding fills nothing for this one',
    );
  });

  test('replacing the key the window names returns its rejected grant to use', async function (assert) {
    let key = await addKey();
    let approved = await approve(OWNER, 'check', {
      userKey: { keyId: key.id },
    });
    await reject(approved.meta.grant.id);
    assert.strictEqual(await grantState(approved.meta.grant.id), 'rejected');

    let [slot] = await bound(OWNER, 'check');
    let response = await replaceAsTheWindowDoes(OWNER, slot.bound.key.id);
    assert.strictEqual(response.status, 200, response.text);
    assert.strictEqual(await grantState(approved.meta.grant.id), 'active');
    assert.false((await bound(OWNER, 'check'))[0].bound.rejected);
  });

  test('a workspace’s shared key is named to its owner, and who shared it to the workspace’s direct writers', async function (assert) {
    let key = await addKey();
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: key.id,
      label: 'Team mail',
      ticket: await ticket(OWNER, 'share', { keyId: key.id, realm: realmURL }),
    });
    let approved = await approve(OWNER, 'shared', {
      apiKey: { shareId: share.id },
    });
    await reject(approved.meta.grant.id, share.id);

    let slot = (user: string) => bound(user, 'shared').then(([s]) => s.bound);
    assert.deepEqual(await slot(OWNER), {
      rejected: true,
      key: { id: key.id, name: 'mail' },
      share: {
        label: 'Team mail',
        suspended: false,
        ownedByYou: true,
        owner: OWNER,
      },
    });
    assert.deepEqual(await slot(WRITER), {
      rejected: true,
      key: null,
      share: {
        label: 'Team mail',
        suspended: false,
        ownedByYou: false,
        owner: OWNER,
      },
    });
    assert.deepEqual(
      await slot(READER),
      {
        rejected: true,
        key: null,
        share: { label: 'Team mail', suspended: false, ownedByYou: false },
      },
      'a reader isn’t told who shared it',
    );

    let response = await replaceAsTheWindowDoes(OWNER, key.id);
    assert.strictEqual(response.status, 200, response.text);
    assert.strictEqual(await grantState(approved.meta.grant.id), 'active');
    assert.false((await slot(READER)).rejected);
  });

  test('an operation approved per card is answered for the card, not its type', async function (assert) {
    let key = await addKey();
    await approve(
      OWNER,
      'perCard',
      { userKey: { keyId: key.id } },
      `${realmURL.href}today`,
    );
    assert.deepEqual((await bound(OWNER, 'perCard', 'instance'))[0].bound, {
      rejected: false,
      key: { id: key.id, name: 'mail' },
    });
    assert.strictEqual(
      (await bound(OWNER, 'perCard'))[0].bound,
      null,
      'the type has no card to find the binding for',
    );
  });

  test('bindings are asked about for an operation, as true or false', async function (assert) {
    let auth = await secureSessionAuth(dbAdapter, OWNER);
    for (let attributes of [
      { realm: realmURL.href, bindings: true },
      {
        target: { kind: 'instance', url: `${realmURL.href}today` },
        bindings: true,
      },
      {
        target: { kind: 'instance', url: `${realmURL.href}today` },
        operation: 'check',
        bindings: 'yes',
      },
    ]) {
      let response = await request
        .post('/_secure-window/context')
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'secure-window-context', attributes } });
      assert.strictEqual(
        response.status,
        400,
        `${JSON.stringify(attributes)}: ${response.text}`,
      );
    }
  });
});
