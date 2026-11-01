import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertPermissions,
  removeRealmPermissions,
} from '@cardstack/runtime-common';
import { removeRealmDatabaseArtifacts } from '../handlers/realm-destruction-utils.ts';
import {
  setupDB,
  setupSimpleRealmServerTemplate,
  startSimpleRealmServer,
  closeServer,
  realmSecretSeed,
} from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import { addUserKey, mintKeyWriteTicket } from '../lib/user-keys.ts';

const require = createRequire(import.meta.url);
const KEY_SHARES_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1792187770930_add-key-shares.js',
);

const OWNER = '@share-owner:localhost';
const WRITER = '@other-writer:localhost';
const SUSPENDER = '@suspending-writer:localhost';
const READER = '@realm-reader:localhost';
const STRANGER = '@stranger:localhost';
const REALM = 'http://127.0.0.1:4444/shared-realm/';
const OTHER_REALM = 'http://127.0.0.1:4444/other-realm/';

module(basename(import.meta.filename), function () {
  module('key shares API', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let keyring: SecretsKeyring;
    let secureOriginURL = new URL('https://secure.keys.test/secure');

    let templateDatabase = setupSimpleRealmServerTemplate(hooks);

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        keyring = installSecretsKeyring(
          await new LocalKeyProvider().loadDataKeys(),
        );
        testRealmServer = await startSimpleRealmServer({
          dbAdapter,
          publisher,
          runner,
          secureOriginURL,
        });
        request = supertest(testRealmServer);
        await insertPermissions(dbAdapter, new URL(REALM), {
          [OWNER]: ['read', 'write'],
          [WRITER]: ['read', 'write'],
          [READER]: ['read'],
        });
        await insertPermissions(dbAdapter, new URL(OTHER_REALM), {
          [OWNER]: ['read', 'write'],
        });
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
        resetSecretsAtRest();
      },
    });

    function auth(user: string): string {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
    }

    async function keyFor(user: string, name = 'weather'): Promise<string> {
      let { ticket } = await mintKeyWriteTicket(dbAdapter, user, {
        action: 'add',
        keyId: null,
        realmURL: null,
        shareId: null,
      });
      let key = await addUserKey(dbAdapter, keyring, {
        owner: user,
        name,
        value: `sk-${name}-value`,
        ticket,
      });
      return key.id;
    }

    async function mint(user: string, attributes: Record<string, unknown>) {
      return await request
        .post('/_key-write-tickets')
        .set('Authorization', await secureSessionAuth(dbAdapter, user))
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'key-write-ticket', attributes } });
    }

    async function ticketFor(
      user: string,
      attributes: Record<string, unknown>,
    ): Promise<string> {
      let response = await mint(user, attributes);
      if (response.status !== 201) {
        throw new Error(
          `could not mint a ticket: ${response.status} ${response.text}`,
        );
      }
      return response.body.data.attributes.ticket;
    }

    async function share(
      user: string,
      attributes: { realm: string; keyId: string; label: string },
      ticket?: string,
    ) {
      ticket ??= await ticketFor(user, {
        action: 'share',
        keyId: attributes.keyId,
        realm: attributes.realm,
      });
      return await request
        .post('/_key-shares')
        .set('Authorization', auth(user))
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'key-share', attributes }, meta: { ticket } });
    }

    async function sharedId(
      user = OWNER,
      label = 'Weather',
      realm = REALM,
    ): Promise<string> {
      let keyId = await keyFor(user, `${label}-key`);
      let response = await share(user, { realm, keyId, label });
      if (response.status !== 201) {
        throw new Error(
          `could not share a key: ${response.status} ${response.text}`,
        );
      }
      return response.body.data.id;
    }

    async function swap(
      user: string,
      shareId: string,
      keyId: string,
      ticket?: string,
    ) {
      ticket ??= await ticketFor(user, { action: 'swap', keyId, shareId });
      return await request
        .post(`/_key-shares/${shareId}/swap`)
        .set('Authorization', auth(user))
        .set('Content-Type', 'application/json')
        .send({
          data: { type: 'key-share', attributes: { keyId } },
          meta: { ticket },
        });
    }

    async function act(user: string, shareId: string, action: string) {
      return await request
        .post(`/_key-shares/${shareId}/${action}`)
        .set('Authorization', auth(user));
    }

    async function resume(user: string, shareId: string, ticket?: string) {
      ticket ??= await ticketFor(user, { action: 'resume', shareId });
      return await request
        .post(`/_key-shares/${shareId}/resume`)
        .set('Authorization', auth(user))
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket } });
    }

    async function realmShares(user: string, realm = REALM) {
      return await request
        .get(`/_key-shares?realm=${encodeURIComponent(realm)}`)
        .set('Authorization', auth(user));
    }

    async function notices(user: string, realm = REALM) {
      return await request
        .get(`/_key-share-notices?realm=${encodeURIComponent(realm)}`)
        .set('Authorization', auth(user));
    }

    async function shareState(shareId: string) {
      let [row] = await dbAdapter.execute(
        `SELECT owner, key_id, state, suspension_reason FROM key_shares WHERE id = $1`,
        { bind: [shareId] },
      );
      return row
        ? {
            owner: row.owner,
            keyId: row.key_id,
            state: row.state,
            reason: row.suspension_reason,
          }
        : undefined;
    }

    test('a direct writer shares their own key into the realm', async function (assert) {
      let keyId = await keyFor(OWNER);
      let response = await share(OWNER, {
        realm: REALM,
        keyId,
        label: 'Weather',
      });
      assert.strictEqual(response.status, 201, response.text);
      let { id, attributes } = response.body.data;
      assert.strictEqual(response.body.data.type, 'key-share');
      assert.deepEqual(
        {
          realm: attributes.realm,
          label: attributes.label,
          owner: attributes.owner,
          keyId: attributes.keyId,
          state: attributes.state,
          suspensionReason: attributes.suspensionReason,
        },
        {
          realm: REALM,
          label: 'Weather',
          owner: OWNER,
          keyId,
          state: 'active',
          suspensionReason: null,
        },
      );
      assert.notOk(
        JSON.stringify(response.body).includes('sk-'),
        'no value is returned',
      );

      let own = await request
        .get('/_key-shares')
        .set('Authorization', auth(OWNER));
      assert.deepEqual(
        own.body.data.map((s: { id: string }) => s.id),
        [id],
        'the owner sees the share',
      );

      let listed = await realmShares(WRITER);
      assert.strictEqual(listed.status, 200, listed.text);
      assert.deepEqual(
        listed.body.data.map(
          (s: { attributes: Record<string, unknown> }) => s.attributes,
        ),
        [
          {
            realm: REALM,
            label: 'Weather',
            owner: OWNER,
            state: 'active',
            suspensionReason: null,
            suspendedBy: null,
            suspendedAt: null,
            createdAt: attributes.createdAt,
            updatedAt: attributes.updatedAt,
            operations: [],
          },
        ],
        `another writer sees the share's owner and state, not its key`,
      );
    });

    test('one key is shared into several realms, its label unique within each', async function (assert) {
      let keyId = await keyFor(OWNER);
      let first = await share(OWNER, { realm: REALM, keyId, label: 'Weather' });
      assert.strictEqual(first.status, 201, first.text);
      let other = await share(OWNER, {
        realm: OTHER_REALM,
        keyId,
        label: 'Weather',
      });
      assert.strictEqual(other.status, 201, 'the same label in another realm');

      let anotherKey = await keyFor(OWNER, 'second');
      let clash = await share(OWNER, {
        realm: REALM,
        keyId: anotherKey,
        label: 'Weather',
      });
      assert.strictEqual(clash.status, 409, 'a label is unique in its realm');
    });

    test('the key listing names the realms each key is shared into, with its shares there', async function (assert) {
      await dbAdapter.execute(
        `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url, pristine_doc)
         VALUES ($1, $2, 'instance', 1, $3, $4)`,
        {
          bind: [
            `${REALM}realm.json`,
            `${REALM}realm`,
            REALM,
            JSON.stringify({ attributes: { cardInfo: { name: 'Team' } } }),
          ],
        },
      );
      let keyId = await keyFor(OWNER);
      let unshared = await keyFor(OWNER, 'unshared');
      let shareIds: Record<string, string> = {};
      for (let [realm, label] of [
        [REALM, 'Weather'],
        [REALM, 'Team weather'],
        [OTHER_REALM, 'Weather'],
      ]) {
        let response = await share(OWNER, { realm, keyId, label });
        assert.strictEqual(response.status, 201, response.text);
        shareIds[`${realm} ${label}`] = response.body.data.id;
      }
      let writerKey = await keyFor(WRITER, 'writer key');
      let writerShare = await share(WRITER, {
        realm: REALM,
        keyId: writerKey,
        label: 'Writer weather',
      });
      assert.strictEqual(writerShare.status, 201, writerShare.text);

      let listed = await request
        .get('/_user-keys')
        .set('Authorization', auth(OWNER));
      assert.strictEqual(listed.status, 200, listed.text);
      let sharedInto = Object.fromEntries(
        listed.body.data.map(
          (key: { id: string; attributes: { sharedInto: unknown } }) => [
            key.id,
            key.attributes.sharedInto,
          ],
        ),
      );
      let expected = [
        {
          url: OTHER_REALM,
          name: null,
          shares: [
            {
              id: shareIds[`${OTHER_REALM} Weather`],
              label: 'Weather',
              state: 'active',
            },
          ],
        },
        {
          url: REALM,
          name: 'Team',
          shares: [
            {
              id: shareIds[`${REALM} Team weather`],
              label: 'Team weather',
              state: 'active',
            },
            {
              id: shareIds[`${REALM} Weather`],
              label: 'Weather',
              state: 'active',
            },
          ],
        },
      ];
      assert.deepEqual(
        sharedInto,
        { [keyId]: expected, [unshared]: [] },
        `each realm once with the key's shares there, by name; a realm whose realm.json isn't indexed has no name; another user's shares aren't listed`,
      );

      let shown = await request
        .get(`/_user-keys/${keyId}`)
        .set('Authorization', auth(OWNER));
      assert.deepEqual(shown.body.data.attributes.sharedInto, expected);

      await removeRealmPermissions(dbAdapter, new URL(REALM));
      let afterLosingAccess = await request
        .get(`/_user-keys/${keyId}`)
        .set('Authorization', auth(OWNER));
      assert.deepEqual(
        afterLosingAccess.body.data.attributes.sharedInto,
        [
          expected[0],
          {
            ...expected[1],
            name: null,
            shares: expected[1].shares.map((s) => ({
              ...s,
              state: 'suspended',
            })),
          },
        ],
        `an owner removed from a realm still sees their suspended shares there by address, but not the realm's name`,
      );
    });

    test("a realm's users row shows its name only to a key owner of the paired homeserver", async function (assert) {
      const ELSEWHERE = '@share-owner:other.example';
      await dbAdapter.execute(
        `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url, pristine_doc)
         VALUES ($1, $2, 'instance', 1, $3, $4)`,
        {
          bind: [
            `${REALM}realm.json`,
            `${REALM}realm`,
            REALM,
            JSON.stringify({ attributes: { cardInfo: { name: 'Team' } } }),
          ],
        },
      );
      await insertPermissions(dbAdapter, new URL(REALM), {
        [ELSEWHERE]: ['read', 'write'],
      });
      let keyIds: Record<string, string> = {};
      for (let [user, label] of [
        [OWNER, 'Paired weather'],
        [ELSEWHERE, 'Federated weather'],
      ]) {
        keyIds[user] = await keyFor(user);
        let response = await share(user, {
          realm: REALM,
          keyId: keyIds[user],
          label,
        });
        assert.strictEqual(response.status, 201, response.text);
      }
      await removeRealmPermissions(dbAdapter, new URL(REALM));
      await insertPermissions(dbAdapter, new URL(REALM), { users: ['read'] });

      let names: Record<string, unknown> = {};
      for (let user of [OWNER, ELSEWHERE]) {
        let shown = await request
          .get(`/_user-keys/${keyIds[user]}`)
          .set('Authorization', auth(user));
        assert.strictEqual(shown.status, 200, shown.text);
        names[user] = shown.body.data.attributes.sharedInto.map(
          (realm: { name: string | null }) => realm.name,
        );
      }
      assert.deepEqual(
        names,
        { [OWNER]: ['Team'], [ELSEWHERE]: [null] },
        'the users row lets a user of the paired homeserver read the realm, and no one else (ADR 004 §1.4)',
      );
    });

    test('a user who is not a direct writer of the realm cannot share into it', async function (assert) {
      let readerKey = await keyFor(READER);
      let byReader = await share(READER, {
        realm: REALM,
        keyId: readerKey,
        label: 'Weather',
      });
      assert.strictEqual(byReader.status, 403, 'a reader is refused');

      let strangerKey = await keyFor(STRANGER);
      let byStranger = await share(STRANGER, {
        realm: REALM,
        keyId: strangerKey,
        label: 'Weather',
      });
      assert.strictEqual(byStranger.status, 403, 'a stranger is refused');

      await insertPermissions(dbAdapter, new URL(REALM), {
        '*': ['read', 'write'],
      });
      let byWildcard = await share(STRANGER, {
        realm: REALM,
        keyId: strangerKey,
        label: 'Weather',
      });
      assert.strictEqual(
        byWildcard.status,
        403,
        'write through a `*` row does not make a direct writer',
      );
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM key_shares`,
      );
      assert.strictEqual(count, 0, 'nothing was shared');
    });

    test('only the owner shares a key, with a ticket for that key and realm', async function (assert) {
      let ownerKey = await keyFor(OWNER);
      let minted = await mint(WRITER, {
        action: 'share',
        keyId: ownerKey,
        realm: REALM,
      });
      assert.strictEqual(
        minted.status,
        404,
        `no ticket is minted to share another user's key`,
      );

      let writerTicket = await ticketFor(WRITER, {
        action: 'share',
        keyId: await keyFor(WRITER),
        realm: REALM,
      });
      let withOwnTicket = await share(
        WRITER,
        { realm: REALM, keyId: ownerKey, label: 'Weather' },
        writerTicket,
      );
      assert.strictEqual(
        withOwnTicket.status,
        403,
        `a ticket for one key doesn't share another`,
      );

      let otherRealmTicket = await ticketFor(OWNER, {
        action: 'share',
        keyId: ownerKey,
        realm: OTHER_REALM,
      });
      let wrongRealm = await share(
        OWNER,
        { realm: REALM, keyId: ownerKey, label: 'Weather' },
        otherRealmTicket,
      );
      assert.strictEqual(
        wrongRealm.status,
        403,
        `a ticket for one realm doesn't share into another`,
      );

      let noTicket = await request
        .post('/_key-shares')
        .set('Authorization', auth(OWNER))
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'key-share',
            attributes: { realm: REALM, keyId: ownerKey, label: 'Weather' },
          },
        });
      assert.strictEqual(noTicket.status, 403, 'a share needs a ticket');
    });

    test(`removing the owner's write suspends their shares, and restoring it resumes them`, async function (assert) {
      let shareId = await sharedId();

      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read'],
      });
      let afterLoss = await shareState(shareId);
      assert.deepEqual(
        [afterLoss?.owner, afterLoss?.state, afterLoss?.reason],
        [OWNER, 'suspended', 'owner-lost-write'],
        'losing write suspends the share, which is kept',
      );

      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read', 'write'],
      });
      assert.strictEqual(
        (await shareState(shareId))!.state,
        'active',
        'regaining write resumes it',
      );

      await insertPermissions(dbAdapter, new URL(REALM), { [OWNER]: [] });
      let afterLeaving = await shareState(shareId);
      assert.deepEqual(
        [afterLeaving?.state, afterLeaving?.reason],
        ['suspended', 'owner-lost-write'],
        'leaving the realm suspends it',
      );

      let listed = await notices(WRITER);
      assert.strictEqual(listed.status, 200, listed.text);
      assert.deepEqual(
        listed.body.data.map((n: { attributes: Record<string, unknown> }) => [
          n.attributes.shareId,
          n.attributes.label,
          n.attributes.owner,
          n.attributes.reason,
        ]),
        [
          [shareId, 'Weather', null, 'owner-lost-write'],
          [shareId, 'Weather', null, 'owner-lost-write'],
        ],
        `the realm's direct writers get a notice of each suspension, without the id of an owner who left`,
      );

      let formerWriter = await realmShares(OWNER);
      assert.strictEqual(
        formerWriter.status,
        403,
        `the former writer no longer sees the realm's shares`,
      );
      let own = await request
        .get('/_key-shares')
        .set('Authorization', auth(OWNER));
      assert.deepEqual(
        own.body.data.map(
          (s: { id: string; attributes: { state: string } }) => [
            s.id,
            s.attributes.state,
          ],
        ),
        [[shareId, 'suspended']],
        'the owner still sees where their key is shared',
      );
    });

    test('a writer sees the owner and suspender of a share only while a permission row in the realm names them', async function (assert) {
      await insertPermissions(dbAdapter, new URL(REALM), {
        [SUSPENDER]: ['read', 'write'],
      });
      let shareId = await sharedId();
      await sharedId(WRITER, 'Maps');

      let suspended = await act(SUSPENDER, shareId, 'suspend');
      assert.strictEqual(suspended.status, 200, suspended.text);
      assert.deepEqual(
        [
          suspended.body.data.attributes.owner,
          suspended.body.data.attributes.suspendedBy,
        ],
        [OWNER, SUSPENDER],
      );

      async function named(user = WRITER) {
        let listed = await realmShares(user);
        assert.strictEqual(listed.status, 200, listed.text);
        return listed.body.data.map(
          (s: { attributes: Record<string, unknown> }) => [
            s.attributes.label,
            s.attributes.owner,
            s.attributes.suspendedBy,
          ],
        );
      }
      async function ownSuspendedBy() {
        let own = await request
          .get('/_key-shares')
          .set('Authorization', auth(OWNER));
        assert.strictEqual(own.status, 200, own.text);
        return own.body.data.map(
          (s: { attributes: Record<string, unknown> }) =>
            s.attributes.suspendedBy,
        );
      }
      async function noticed() {
        let listed = await notices(WRITER);
        assert.strictEqual(listed.status, 200, listed.text);
        return listed.body.data.map(
          (n: { attributes: Record<string, unknown> }) => [
            n.attributes.reason,
            n.attributes.owner,
            n.attributes.suspendedBy,
          ],
        );
      }

      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read'],
      });
      assert.deepEqual(
        await named(),
        [
          ['Maps', WRITER, null],
          ['Weather', OWNER, SUSPENDER],
        ],
        'an owner whose row grants only read is still named',
      );
      assert.deepEqual(
        await ownSuspendedBy(),
        [SUSPENDER],
        'the owner sees who suspended their share while rows name them both',
      );

      await insertPermissions(dbAdapter, new URL(REALM), { [OWNER]: [] });
      assert.deepEqual(
        await ownSuspendedBy(),
        [null],
        `the owner doesn't see who suspended their share once the owner's own row is deleted`,
      );
      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read'],
      });

      await insertPermissions(dbAdapter, new URL(REALM), { [SUSPENDER]: [] });
      assert.deepEqual(
        await named(),
        [
          ['Maps', WRITER, null],
          ['Weather', OWNER, null],
        ],
        'the suspender is withheld once their row is deleted',
      );
      assert.deepEqual(
        await ownSuspendedBy(),
        [null],
        `the owner's own listing withholds the suspender too`,
      );

      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: [],
        '*': ['read'],
        users: ['read'],
      });
      assert.deepEqual(
        await named(),
        [
          ['Maps', WRITER, null],
          ['Weather', null, null],
        ],
        `the owner is withheld once their row is deleted, and a '*' or users row names no one`,
      );
      assert.deepEqual(
        await noticed(),
        [['suspended-by-writer', null, null]],
        'the notice withholds them too',
      );

      let resumed = await resume(WRITER, shareId);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.deepEqual(
        [
          resumed.body.data.attributes.suspensionReason,
          resumed.body.data.attributes.owner,
        ],
        ['owner-lost-write', null],
        'the share a resume answers with withholds the owner',
      );

      let own = await request
        .get('/_key-shares')
        .set('Authorization', auth(OWNER));
      assert.deepEqual(
        own.body.data.map((s: { attributes: Record<string, unknown> }) => [
          s.attributes.label,
          s.attributes.owner,
        ]),
        [['Weather', OWNER]],
        'the owner still sees their own id on their own shares',
      );

      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read'],
      });
      assert.deepEqual(
        (await named()).map(([label, owner]: unknown[]) => [label, owner]),
        [
          ['Maps', WRITER],
          ['Weather', OWNER],
        ],
        'a row naming the owner again shows them again',
      );
    });

    test('a writer suspended share stays suspended when the owner regains write', async function (assert) {
      let shareId = await sharedId();
      let suspended = await act(WRITER, shareId, 'suspend');
      assert.strictEqual(suspended.status, 200, suspended.text);
      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read'],
      });
      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read', 'write'],
      });
      let state = await shareState(shareId);
      assert.deepEqual(
        [state?.state, state?.reason],
        ['suspended', 'suspended-by-writer'],
      );
    });

    test('any direct writer suspends a share, and lifts that suspension', async function (assert) {
      let shareId = await sharedId();

      let byReader = await act(READER, shareId, 'suspend');
      assert.strictEqual(byReader.status, 404, `a reader can't see the share`);

      let suspended = await act(WRITER, shareId, 'suspend');
      assert.strictEqual(suspended.status, 200, suspended.text);
      assert.deepEqual(
        [
          suspended.body.data.attributes.state,
          suspended.body.data.attributes.suspensionReason,
          suspended.body.data.attributes.suspendedBy,
        ],
        ['suspended', 'suspended-by-writer', WRITER],
      );
      assert.strictEqual(
        (await act(WRITER, shareId, 'suspend')).status,
        409,
        'a suspended share is not suspended again',
      );
      let listed = await notices(OWNER);
      assert.deepEqual(
        listed.body.data.map((n: { attributes: Record<string, unknown> }) => [
          n.attributes.reason,
          n.attributes.suspendedBy,
        ]),
        [['suspended-by-writer', WRITER]],
        'the suspension is noticed',
      );

      let noTicket = await request
        .post(`/_key-shares/${shareId}/resume`)
        .set('Authorization', auth(OWNER))
        .set('Content-Type', 'application/json')
        .send({});
      assert.strictEqual(noTicket.status, 403, 'lifting one needs a ticket');
      let otherShare = await sharedId(OWNER, 'Other');
      let otherTicket = await ticketFor(OWNER, {
        action: 'resume',
        shareId: otherShare,
      });
      assert.strictEqual(
        (await resume(OWNER, shareId, otherTicket)).status,
        403,
        `a ticket to resume one share doesn't resume another`,
      );

      let resumed = await resume(OWNER, shareId);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(resumed.body.data.attributes.state, 'active');
    });

    test('a share suspended by a writer, whose owner has lost write, stays suspended for that when lifted', async function (assert) {
      let shareId = await sharedId();
      await act(WRITER, shareId, 'suspend');
      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read'],
      });
      let resumed = await resume(WRITER, shareId);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.deepEqual(
        [
          resumed.body.data.attributes.state,
          resumed.body.data.attributes.suspensionReason,
        ],
        ['suspended', 'owner-lost-write'],
      );
      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read', 'write'],
      });
      assert.strictEqual((await shareState(shareId))!.state, 'active');
    });

    test('a remaining direct writer swaps their own key into a suspended share', async function (assert) {
      let shareId = await sharedId();
      let writerKey = await keyFor(WRITER);

      let whileActive = await swap(WRITER, shareId, writerKey);
      assert.strictEqual(
        whileActive.status,
        409,
        'an active share takes no other key',
      );

      await insertPermissions(dbAdapter, new URL(REALM), { [OWNER]: [] });

      let swapped = await swap(WRITER, shareId, writerKey);
      assert.strictEqual(swapped.status, 200, swapped.text);
      let { attributes } = swapped.body.data;
      assert.deepEqual(
        [
          attributes.label,
          attributes.owner,
          attributes.keyId,
          attributes.state,
          attributes.suspensionReason,
        ],
        ['Weather', WRITER, writerKey, 'active', null],
        'the share keeps its label and takes the writer as owner',
      );

      await insertPermissions(dbAdapter, new URL(REALM), {
        [WRITER]: ['read'],
      });
      assert.strictEqual(
        (await shareState(shareId))!.reason,
        'owner-lost-write',
        'it follows its new owner',
      );
    });

    test(`a non-writer can't swap, and nobody swaps in another user's key`, async function (assert) {
      let shareId = await sharedId();
      await insertPermissions(dbAdapter, new URL(REALM), { [OWNER]: [] });

      let readerKey = await keyFor(READER);
      let byReader = await swap(READER, shareId, readerKey);
      assert.strictEqual(byReader.status, 404, `a reader can't see the share`);

      await insertPermissions(dbAdapter, new URL(REALM), {
        [STRANGER]: ['read'],
      });
      let strangerKey = await keyFor(STRANGER);
      let byStranger = await swap(STRANGER, shareId, strangerKey);
      assert.strictEqual(byStranger.status, 404);

      let readerKeyTicket = await mint(WRITER, {
        action: 'swap',
        keyId: readerKey,
        shareId,
      });
      assert.strictEqual(
        readerKeyTicket.status,
        404,
        `no ticket is minted to swap in another user's key`,
      );
      let writerTicket = await ticketFor(WRITER, {
        action: 'swap',
        keyId: await keyFor(WRITER),
        shareId,
      });
      let withOwnTicket = await swap(WRITER, shareId, readerKey, writerTicket);
      assert.strictEqual(
        withOwnTicket.status,
        403,
        `a ticket for the writer's key doesn't swap in another`,
      );

      let otherShare = await sharedId(WRITER, 'Other');
      await act(WRITER, otherShare, 'suspend');
      let writerKey = await keyFor(WRITER, 'third');
      let otherShareTicket = await ticketFor(WRITER, {
        action: 'swap',
        keyId: writerKey,
        shareId: otherShare,
      });
      let wrongShare = await swap(WRITER, shareId, writerKey, otherShareTicket);
      assert.strictEqual(
        wrongShare.status,
        403,
        `a ticket to swap into one share doesn't swap into another`,
      );

      let state = await shareState(shareId);
      assert.deepEqual(
        [state!.owner, state!.state],
        [OWNER, 'suspended'],
        'the share is unchanged',
      );
    });

    test('deleting a key lists the shares it would affect, and suspends them', async function (assert) {
      let keyId = await keyFor(OWNER);
      let inRealm = await share(OWNER, { realm: REALM, keyId, label: 'A' });
      let inOther = await share(OWNER, {
        realm: OTHER_REALM,
        keyId,
        label: 'B',
      });
      await sharedId(OWNER, 'Unrelated');

      let affected = await request
        .get(`/_key-shares?key=${keyId}`)
        .set('Authorization', auth(OWNER));
      assert.strictEqual(affected.status, 200, affected.text);
      assert.deepEqual(
        affected.body.data.map((s: { id: string }) => s.id).sort(),
        [inRealm.body.data.id, inOther.body.data.id].sort(),
        'the shares holding the key are listed',
      );

      let ticket = await ticketFor(OWNER, { action: 'delete', keyId });
      let deleted = await request
        .delete(`/_user-keys/${keyId}`)
        .set('Authorization', auth(OWNER))
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket } });
      assert.strictEqual(deleted.status, 204, deleted.text);

      for (let id of [inRealm.body.data.id, inOther.body.data.id]) {
        assert.deepEqual(
          await shareState(id),
          {
            owner: OWNER,
            keyId: null,
            state: 'suspended',
            reason: 'key-deleted',
          },
          'the share is suspended and keeps its place',
        );
      }
      let listed = await notices(WRITER);
      assert.deepEqual(
        listed.body.data.map(
          (n: { attributes: Record<string, unknown> }) => n.attributes.reason,
        ),
        ['key-deleted'],
      );

      let writerKey = await keyFor(WRITER);
      let swapped = await swap(WRITER, inRealm.body.data.id, writerKey);
      assert.strictEqual(swapped.status, 200, 'a writer swaps a key into it');
    });

    test(`deleting the key of a share a writer suspended records a notice`, async function (assert) {
      let keyId = await keyFor(OWNER);
      let shared = await share(OWNER, { realm: REALM, keyId, label: 'A' });
      let shareId = shared.body.data.id;
      await act(WRITER, shareId, 'suspend');

      let ticket = await ticketFor(OWNER, { action: 'delete', keyId });
      await request
        .delete(`/_user-keys/${keyId}`)
        .set('Authorization', auth(OWNER))
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket } });

      let state = await shareState(shareId);
      assert.deepEqual(
        [state?.state, state?.reason, state?.keyId],
        ['suspended', 'key-deleted', null],
      );
      let listed = await notices(WRITER);
      assert.deepEqual(
        listed.body.data.map(
          (n: { attributes: Record<string, unknown> }) => n.attributes.reason,
        ),
        ['key-deleted', 'suspended-by-writer'],
        'the writers learn the key is gone',
      );
    });

    test('deleting a realm deletes its shares', async function (assert) {
      let shareId = await sharedId();
      let elsewhere = await sharedId(OWNER, 'Elsewhere', OTHER_REALM);
      await removeRealmPermissions(dbAdapter, new URL(REALM));
      await removeRealmDatabaseArtifacts({ dbAdapter, realmURL: REALM });
      assert.strictEqual(await shareState(shareId), undefined);
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM key_share_notices WHERE share_id = $1`,
        { bind: [shareId] },
      );
      assert.strictEqual(count, 0, 'its notices go with it');

      await insertPermissions(dbAdapter, new URL(REALM), {
        [OWNER]: ['read', 'write'],
      });
      assert.deepEqual(
        (
          await request.get('/_key-shares').set('Authorization', auth(OWNER))
        ).body.data.map((s: { id: string }) => s.id),
        [elsewhere],
        'a realm later made at the same URL gets none of them back',
      );
    });

    test('ids that are not UUIDs name nothing', async function (assert) {
      let shareId = await sharedId();
      let keyId = await keyFor(WRITER);
      assert.strictEqual(
        (await mint(WRITER, { action: 'swap', keyId, shareId: 'nope' })).status,
        404,
        'no swap ticket is minted for a malformed share id',
      );
      assert.strictEqual(
        (await mint(WRITER, { action: 'resume', shareId: 'nope' })).status,
        404,
        'no resume ticket is minted for a malformed share id',
      );
      let ticket = await ticketFor(WRITER, { action: 'swap', keyId, shareId });
      assert.strictEqual(
        (await swap(WRITER, 'nope', keyId, ticket)).status,
        404,
      );
      assert.strictEqual(
        (await swap(WRITER, shareId, 'nope', ticket)).status,
        404,
      );
      assert.strictEqual((await act(WRITER, 'nope', 'suspend')).status, 404);
      assert.strictEqual((await resume(WRITER, 'nope', ticket)).status, 404);
      assert.strictEqual(
        (
          await share(
            WRITER,
            { realm: REALM, keyId: 'nope', label: 'X' },
            ticket,
          )
        ).status,
        404,
      );
      assert.strictEqual(
        (await swap(WRITER, shareId, keyId, ticket)).status,
        409,
        'the refusals left the ticket unspent',
      );
    });

    test(`a reader sees nothing of a realm's shares`, async function (assert) {
      let shareId = await sharedId();
      for (let user of [READER, STRANGER]) {
        assert.strictEqual((await realmShares(user)).status, 403);
        assert.strictEqual((await notices(user)).status, 403);
        let own = await request
          .get('/_key-shares')
          .set('Authorization', auth(user));
        assert.deepEqual(own.body.data, [], `${user} owns no shares`);
        assert.strictEqual((await resume(user, shareId)).status, 404);
        let unshare = await request
          .delete(`/_key-shares/${shareId}`)
          .set('Authorization', auth(user));
        assert.strictEqual(unshare.status, 404);
      }
    });

    test('only its owner unshares a share, with or without write', async function (assert) {
      let shareId = await sharedId();
      let byWriter = await request
        .delete(`/_key-shares/${shareId}`)
        .set('Authorization', auth(WRITER));
      assert.strictEqual(byWriter.status, 403, 'another writer is refused');

      await insertPermissions(dbAdapter, new URL(REALM), { [OWNER]: [] });
      let byOwner = await request
        .delete(`/_key-shares/${shareId}`)
        .set('Authorization', auth(OWNER));
      assert.strictEqual(byOwner.status, 204, byOwner.text);
      assert.strictEqual(await shareState(shareId), undefined);
    });
  });

  module('key shares tables', function (hooks) {
    let dbAdapter: PgAdapter;

    // Roles and memberships are shared by every database on the server, so
    // each test removes the memberships it makes, whatever happens.
    const MEMBER = 'readonly_member_for_key_shares_test';
    const ADMIN_MEMBER = 'readonly_admin_member_for_key_shares_test';
    const OWNER = 'readonly_owner_for_key_shares_test';
    const OTHER_ROLE = 'other_role_for_key_shares_test';
    const TABLES = ['key_shares', 'key_share_notices'];

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        // The role and its blanket grant as staging and production have them.
        await createRole('readonly_role');
        await dbAdapter.execute(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
        );
      },
    });

    async function createRole(name: string) {
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE ${name};
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
    }

    async function runUp() {
      let statements: string[] = [];
      require(KEY_SHARES_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    async function withMemberships(
      memberships: [role: string, member: string, options?: string][],
      fn: () => Promise<void>,
    ) {
      for (let [role, member] of memberships) {
        await createRole(role);
        await createRole(member);
      }
      try {
        for (let [role, member, options] of memberships) {
          await dbAdapter.execute(
            `GRANT ${role} TO ${member}${options ? ` WITH ${options}` : ''}`,
          );
        }
        await fn();
      } finally {
        for (let [role, member] of [...memberships].reverse()) {
          await dbAdapter.execute(`REVOKE ${role} FROM ${member}`);
        }
      }
    }

    async function selectAs(role: string, sql: string) {
      return await dbAdapter.withTransaction(async (query: any) => {
        await query([`SET LOCAL ROLE ${role}`]);
        return await query([sql]);
      });
    }

    async function canSelect(role: string, table: string): Promise<boolean> {
      let [{ readable }] = await dbAdapter.execute(
        `SELECT has_table_privilege('${role}', '${table}', 'SELECT') AS readable`,
      );
      return readable as boolean;
    }

    test("the read-only role and its members can't select either table", async function (assert) {
      // A member that inherits the role and was also granted SELECT on the
      // tables directly.
      await withMemberships([['readonly_role', MEMBER]], async () => {
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE ${TABLES.join(', ')} TO ${MEMBER}`,
        );

        await runUp();

        for (let role of ['readonly_role', MEMBER]) {
          for (let table of TABLES) {
            await assert.rejects(
              selectAs(role, `SELECT * FROM ${table}`),
              new RegExp(`permission denied for table ${table}`),
              `${role} can't select ${table}`,
            );
          }
        }
      });
    });

    test('revokes a grant another role made, and every grant passed on from it', async function (assert) {
      // A role outside the read-only role holds SELECT with the grant option
      // and passes it to a member, which passes it to the role itself.
      await createRole(OTHER_ROLE);
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE key_shares TO ${OTHER_ROLE} WITH GRANT OPTION`,
      );
      await withMemberships([['readonly_role', MEMBER]], async () => {
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${OTHER_ROLE}`]);
          await query([
            `GRANT SELECT ON TABLE key_shares TO ${MEMBER} WITH GRANT OPTION`,
          ]);
        });
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${MEMBER}`]);
          await query([
            `GRANT SELECT (owner) ON TABLE key_shares TO readonly_role`,
          ]);
        });

        await runUp();

        assert.false(await canSelect(MEMBER, 'key_shares'));
        let [{ readable }] = await dbAdapter.execute(
          `SELECT has_column_privilege('readonly_role', 'key_shares', 'owner', 'SELECT') AS readable`,
        );
        assert.false(readable as boolean, 'the grant passed on is gone too');
        assert.true(
          await canSelect(OTHER_ROLE, 'key_shares'),
          'the role outside the read-only role keeps its own',
        );
      });
    });

    test('stops when PUBLIC can read a column', async function (assert) {
      await dbAdapter.execute(
        `GRANT SELECT (owner) ON TABLE key_shares TO PUBLIC`,
      );

      await assert.rejects(
        runUp(),
        /can read key_shares\.owner, which is withheld from readonly_role/,
      );
    });

    test('stops when a member reads a table through another role', async function (assert) {
      await withMemberships(
        [
          ['readonly_role', MEMBER],
          [OTHER_ROLE, MEMBER],
        ],
        async () => {
          await dbAdapter.execute(
            `GRANT SELECT ON TABLE key_share_notices TO ${OTHER_ROLE}`,
          );

          await assert.rejects(
            runUp(),
            new RegExp(
              `${MEMBER} can read key_share_notices\\.\\w+, which is withheld`,
            ),
          );
        },
      );
    });

    test('leaves SELECT to a member that holds only the ADMIN option on the role', async function (assert) {
      // The role that creates the read-only role holds this membership on
      // Postgres 16 and later, and reads nothing through it.
      await withMemberships(
        [
          [
            'readonly_role',
            ADMIN_MEMBER,
            'ADMIN TRUE, INHERIT FALSE, SET FALSE',
          ],
        ],
        async () => {
          await dbAdapter.execute(
            `GRANT SELECT ON TABLE ${TABLES.join(', ')} TO ${ADMIN_MEMBER}`,
          );

          await runUp();

          for (let table of TABLES) {
            assert.true(
              await canSelect(ADMIN_MEMBER, table),
              `it still reads ${table}`,
            );
          }
        },
      );
    });

    test('leaves SELECT to a member that owns a table', async function (assert) {
      await createRole(OWNER);
      await dbAdapter.execute(`ALTER TABLE key_shares OWNER TO ${OWNER}`);
      await withMemberships([['readonly_role', OWNER]], async () => {
        await runUp();

        assert.true(await canSelect(OWNER, 'key_shares'), 'the owner reads it');
        assert.false(
          await canSelect('readonly_role', 'key_shares'),
          'the role itself still does not',
        );
      });
    });
  });
});
