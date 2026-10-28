import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { dirSync } from 'tmp';
import { createRequire } from 'module';
import { randomBytes, randomUUID } from 'node:crypto';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import { destinationCovers } from '@cardstack/runtime-common/card-operations';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  SecretDecryptionError,
  SecretsKeyring as Keyring,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  resealUnderCurrentKey,
  SEALED_COLUMNS,
} from '../lib/secrets-at-rest/rotation.ts';
import {
  addUserKey,
  deleteUserKey,
  mintKeyWriteTicket,
  replaceUserKeyValue,
  USER_KEY_GRANT_VALUE_FIELD,
  type KeyWriteAction,
  type UserKeyMetadata,
} from '../lib/user-keys.ts';
import {
  createOrReuseGrant,
  createOrReuseGrantForOperation,
  normalizeGrantDestination,
  openGrantForSending,
  removeGrant,
} from '../lib/user-key-grants.ts';
import { UserKeyError } from '../lib/user-keys.ts';

const require = createRequire(import.meta.url);
const GRANTS_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1793030727036_add-user-key-grants.js',
);

const OWNER = '@grant-owner:localhost';
const OTHER_USER = '@other-grant-user:localhost';
const VALUE = 'sk-grant-key-value-7c1e94ab02';
const NEW_VALUE = 'sk-grant-key-replacement-3d58f1';

async function addKey(
  dbAdapter: PgAdapter,
  keyring: SecretsKeyring,
  { owner = OWNER, name = 'openai', value = VALUE } = {},
): Promise<UserKeyMetadata> {
  let { ticket } = await mintKeyWriteTicket(dbAdapter, owner, {
    action: 'add',
    keyId: null,
    realmURL: null,
    shareId: null,
  });
  return await addUserKey(dbAdapter, keyring, { owner, name, value, ticket });
}

async function ticket(
  dbAdapter: PgAdapter,
  action: KeyWriteAction,
  keyId: string,
  owner = OWNER,
): Promise<string> {
  return (
    await mintKeyWriteTicket(dbAdapter, owner, {
      action,
      keyId,
      realmURL: null,
      shareId: null,
    })
  ).ticket;
}

async function grantColumns(
  dbAdapter: PgAdapter,
  id: string,
): Promise<Record<string, unknown>> {
  let [row] = await dbAdapter.execute(
    `SELECT key_id, owner, destination, value_key_id,
            encode(value_ciphertext, 'base64') AS ciphertext,
            encode(value_nonce, 'base64') AS nonce,
            encode(value_tag, 'base64') AS tag
       FROM user_key_grants WHERE id = $1`,
    { bind: [id] },
  );
  return row;
}

// Writes another row's sealed columns over a grant's.
async function copySealedColumns(
  dbAdapter: PgAdapter,
  { from, table, to }: { from: string; table: string; to: string },
) {
  await dbAdapter.execute(
    `UPDATE user_key_grants AS grant_row
        SET value_ciphertext = source.value_ciphertext,
            value_nonce = source.value_nonce,
            value_tag = source.value_tag,
            value_key_id = source.value_key_id
       FROM ${table} AS source
      WHERE grant_row.id = $1 AND source.id = $2`,
    { bind: [to, from] },
  );
}

module(basename(import.meta.filename), function () {
  module('grants at rest', function (hooks) {
    let dbAdapter: PgAdapter;
    let keyring: SecretsKeyring;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        keyring = installSecretsKeyring(
          await new LocalKeyProvider().loadDataKeys(),
        );
      },
      afterEach: async () => {
        resetSecretsAtRest();
      },
    });

    async function grant(
      keyId: string,
      destination: string,
      { owner = OWNER, sealWith = keyring } = {},
    ) {
      return await createOrReuseGrant(dbAdapter, sealWith, {
        owner,
        keyId,
        destination,
        via: 'window',
      });
    }

    test('a grant stores the normalized href, and a destination it covers reuses it', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let first = await grant(key.id, 'https://API.openai.com:443/v1/../v1/');
      assert.true(first.created);
      assert.strictEqual(first.grant.destination, 'https://api.openai.com/v1/');
      assert.strictEqual(first.grant.approvedVia, 'window');

      let covered = await grant(key.id, 'https://api.openai.com/v1/chat/');
      assert.false(covered.created, 'a prefix under it reuses the grant');
      assert.strictEqual(covered.grant.id, first.grant.id);

      let again = await grant(key.id, 'https://api.openai.com/v1/');
      assert.strictEqual(
        again.grant.id,
        first.grant.id,
        'so does the same one',
      );
    });

    test('another host, or a sibling prefix, is a second grant on the same key', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let v1 = await grant(key.id, 'https://api.openai.com/v1/');
      let beta = await grant(key.id, 'https://api.openai.com/v1beta/');
      let eu = await grant(key.id, 'https://eu.api.openai.com/v1/');
      assert.true(beta.created, '/v1beta/ beside /v1/ is a grant of its own');
      assert.true(eu.created, 'another host is a grant of its own');
      assert.strictEqual(
        new Set([v1.grant.id, beta.grant.id, eu.grant.id]).size,
        3,
      );
      for (let { grant: g } of [v1, beta, eu]) {
        assert.strictEqual(g.keyId, key.id);
        let opened = await openGrantForSending(dbAdapter, keyring, {
          owner: OWNER,
          grantId: g.id,
        });
        assert.strictEqual(opened.value, VALUE, `${g.destination} opens`);
        assert.strictEqual(opened.destination, g.destination);
      }
    });

    test('a match always ends at a /', async function (assert) {
      assert.false(
        destinationCovers(
          'https://api.openai.com/',
          'https://api.openai.com.evil.net/',
        ),
      );
      assert.false(
        destinationCovers(
          'https://api.example.com/v1/',
          'https://api.example.com/v1beta',
        ),
      );

      let key = await addKey(dbAdapter, keyring);
      let root = await grant(key.id, 'https://api.openai.com/');
      let evil = await grant(key.id, 'https://api.openai.com.evil.net/');
      assert.true(evil.created, 'a longer host is not under the grant');
      assert.notStrictEqual(evil.grant.id, root.grant.id);

      let other = await addKey(dbAdapter, keyring, { name: 'example' });
      await grant(other.id, 'https://api.example.com/v1/');
      let beta = await grant(other.id, 'https://api.example.com/v1beta/');
      assert.true(beta.created, '/v1/ does not cover /v1beta');
    });

    test('a destination names one host, as an href with a path ending at /', async function (assert) {
      for (let destination of [
        'https://*.googleapis.com/',
        'https://%2A.googleapis.com/',
        'https://api.openai.com/v1',
        'https://user:pw@api.openai.com/',
        'https://api.openai.com/?q=1',
        'https://api.openai.com./',
        'ftp://api.openai.com/',
        'http://api.openai.com/',
        'not a url',
      ]) {
        assert.throws(
          () => normalizeGrantDestination(destination),
          (e: unknown) => e instanceof UserKeyError && e.status === 400,
          `${destination} is refused`,
        );
      }
      let key = await addKey(dbAdapter, keyring);
      await assert.rejects(
        grant(key.id, 'https://*.googleapis.com/'),
        /host wildcard/,
      );
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM user_key_grants`,
      );
      assert.strictEqual(count, 0, 'no grant is written');
    });

    test("another user's key gets no grant", async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      await assert.rejects(
        grant(key.id, 'https://api.openai.com/', { owner: OTHER_USER }),
        /no such key/,
      );
    });

    test('a grant row written outside the realm server sends nothing', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let other = await addKey(dbAdapter, keyring, { name: 'second' });
      let { grant: real } = await grant(key.id, 'https://api.openai.com/');
      let { grant: sibling } = await grant(
        key.id,
        'https://eu.api.openai.com/',
      );
      let { grant: otherKeys } = await grant(
        other.id,
        'https://api.openai.com/',
      );

      // Inserted directly, with the sealed columns of a real grant.
      let inserted = randomUUID();
      await dbAdapter.execute(
        `INSERT INTO user_key_grants
           (id, key_id, owner, destination, state, approved_via,
            value_ciphertext, value_nonce, value_tag, value_key_id)
         SELECT $1, key_id, owner, 'https://attacker.example/', 'active', 'window',
                value_ciphertext, value_nonce, value_tag, value_key_id
           FROM user_key_grants WHERE id = $2`,
        { bind: [inserted, real.id] },
      );
      // Sealed columns copied from another grant of the key, from another
      // key's grant and from the key's own master copy.
      await copySealedColumns(dbAdapter, {
        from: real.id,
        table: 'user_key_grants',
        to: sibling.id,
      });
      await copySealedColumns(dbAdapter, {
        from: key.id,
        table: 'user_keys',
        to: otherKeys.id,
      });

      for (let grantId of [inserted, sibling.id, otherKeys.id]) {
        await assert.rejects(
          openGrantForSending(dbAdapter, keyring, { owner: OWNER, grantId }),
          SecretDecryptionError,
          `grant ${grantId} doesn't open`,
        );
      }
      let opened = await openGrantForSending(dbAdapter, keyring, {
        owner: OWNER,
        grantId: real.id,
      });
      assert.strictEqual(opened.value, VALUE, 'the real grant still opens');
    });

    test('a grant whose destination or key is edited in the database fails to open', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let other = await addKey(dbAdapter, keyring, { name: 'second' });
      let { grant: moved } = await grant(key.id, 'https://api.openai.com/');
      let { grant: repointed } = await grant(
        key.id,
        'https://eu.api.openai.com/',
      );
      await dbAdapter.execute(
        `UPDATE user_key_grants SET destination = 'https://attacker.example/' WHERE id = $1`,
        { bind: [moved.id] },
      );
      await dbAdapter.execute(
        `UPDATE user_key_grants SET key_id = $1 WHERE id = $2`,
        { bind: [other.id, repointed.id] },
      );
      for (let grantId of [moved.id, repointed.id]) {
        await assert.rejects(
          openGrantForSending(dbAdapter, keyring, { owner: OWNER, grantId }),
          SecretDecryptionError,
        );
      }
    });

    test("replacing a key doesn't seal its value to a grant row written outside the realm server", async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let { grant: real } = await grant(key.id, 'https://api.openai.com/');
      let { grant: moved } = await grant(key.id, 'https://eu.api.openai.com/');
      let inserted = randomUUID();
      await dbAdapter.execute(
        `INSERT INTO user_key_grants
           (id, key_id, owner, destination, state, approved_via,
            value_ciphertext, value_nonce, value_tag, value_key_id)
         SELECT $1, key_id, owner, 'https://attacker.example/', 'active', 'window',
                value_ciphertext, value_nonce, value_tag, value_key_id
           FROM user_key_grants WHERE id = $2`,
        { bind: [inserted, real.id] },
      );
      await dbAdapter.execute(
        `UPDATE user_key_grants SET destination = 'https://attacker.example/v2/' WHERE id = $1`,
        { bind: [moved.id] },
      );
      let before = await Promise.all(
        [inserted, moved.id].map((id) => grantColumns(dbAdapter, id)),
      );

      await replaceUserKeyValue(dbAdapter, keyring, {
        owner: OWNER,
        id: key.id,
        value: NEW_VALUE,
        ticket: await ticket(dbAdapter, 'replace', key.id),
      });

      for (let [index, grantId] of [inserted, moved.id].entries()) {
        assert.deepEqual(
          await grantColumns(dbAdapter, grantId),
          before[index],
          `row ${grantId} is left as it is`,
        );
        await assert.rejects(
          openGrantForSending(dbAdapter, keyring, { owner: OWNER, grantId }),
          SecretDecryptionError,
          `row ${grantId} still sends nothing`,
        );
      }
      let opened = await openGrantForSending(dbAdapter, keyring, {
        owner: OWNER,
        grantId: real.id,
      });
      assert.strictEqual(opened.value, NEW_VALUE, 'the real grant is resealed');
    });

    test("approving doesn't reuse a grant row written outside the realm server", async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let { grant: real } = await grant(key.id, 'https://eu.api.openai.com/');
      let forged = randomUUID();
      await dbAdapter.execute(
        `INSERT INTO user_key_grants
           (id, key_id, owner, destination, state, approved_via,
            value_ciphertext, value_nonce, value_tag, value_key_id)
         SELECT $1, key_id, owner, 'https://api.openai.com/', 'active', 'window',
                value_ciphertext, value_nonce, value_tag, value_key_id
           FROM user_key_grants WHERE id = $2`,
        { bind: [forged, real.id] },
      );
      let approved = await grant(key.id, 'https://api.openai.com/v1/');
      assert.true(approved.created, 'a grant of its own is made');
      assert.notStrictEqual(approved.grant.id, forged);
      let opened = await openGrantForSending(dbAdapter, keyring, {
        owner: OWNER,
        grantId: approved.grant.id,
      });
      assert.strictEqual(opened.value, VALUE);
      let again = await grant(key.id, 'https://api.openai.com/v1/chat/');
      assert.strictEqual(
        again.grant.id,
        approved.grant.id,
        'and is the one reused after it',
      );
    });

    test('replacing a key re-seals every copy, and the old value opens nowhere', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let grants = [
        (await grant(key.id, 'https://api.openai.com/v1/')).grant,
        (await grant(key.id, 'https://eu.api.openai.com/v1/')).grant,
      ];
      let before = await Promise.all(
        grants.map((g) => grantColumns(dbAdapter, g.id)),
      );

      await replaceUserKeyValue(dbAdapter, keyring, {
        owner: OWNER,
        id: key.id,
        value: NEW_VALUE,
        ticket: await ticket(dbAdapter, 'replace', key.id),
      });

      for (let [index, g] of grants.entries()) {
        let after = await grantColumns(dbAdapter, g.id);
        assert.notStrictEqual(
          after.ciphertext,
          before[index].ciphertext,
          `${g.destination}'s copy is sealed again`,
        );
        let opened = await openGrantForSending(dbAdapter, keyring, {
          owner: OWNER,
          grantId: g.id,
        });
        assert.strictEqual(opened.value, NEW_VALUE);
      }
      let created = await grant(key.id, 'https://api.openai.com/v2/');
      let opened = await openGrantForSending(dbAdapter, keyring, {
        owner: OWNER,
        grantId: created.grant.id,
      });
      assert.strictEqual(
        opened.value,
        NEW_VALUE,
        'a grant made afterwards copies the new master copy',
      );
      let stored = await dbAdapter.execute(
        `SELECT row_to_json(user_key_grants)::text AS row FROM user_key_grants`,
      );
      assert.false(
        stored.some(({ row }) => String(row).includes(VALUE)),
        'no value is stored in the clear',
      );
    });

    test('a replace waits for a grant being created, and re-seals it too', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let replaceTicket = await ticket(dbAdapter, 'replace', key.id);
      let [created] = await Promise.all([
        grant(key.id, 'https://api.openai.com/'),
        replaceUserKeyValue(dbAdapter, keyring, {
          owner: OWNER,
          id: key.id,
          value: NEW_VALUE,
          ticket: replaceTicket,
        }),
      ]);
      let opened = await openGrantForSending(dbAdapter, keyring, {
        owner: OWNER,
        grantId: created.grant.id,
      });
      assert.strictEqual(opened.value, NEW_VALUE);
    });

    test('rotating the data key re-seals grant copies, and they still open', async function (assert) {
      let oldBytes = randomBytes(32);
      let oldKey = new Keyring(
        [{ keyId: 'grants-old', key: Buffer.from(oldBytes) }],
        'grants-old',
      );
      let key = await addKey(dbAdapter, oldKey);
      let grants = [
        (await grant(key.id, 'https://api.openai.com/', { sealWith: oldKey }))
          .grant,
        (
          await grant(key.id, 'https://eu.api.openai.com/', {
            sealWith: oldKey,
          })
        ).grant,
      ];
      let during = new Keyring(
        [
          { keyId: 'grants-old', key: Buffer.from(oldBytes) },
          { keyId: 'grants-new', key: randomBytes(32) },
        ],
        'grants-new',
      );
      let report = await resealUnderCurrentKey(dbAdapter, during, {
        columns: SEALED_COLUMNS.filter(
          (column) => column.field === USER_KEY_GRANT_VALUE_FIELD,
        ),
      });
      assert.deepEqual(
        report.columns.map(({ field, resealed, unopenable }) => ({
          field,
          resealed,
          unopenable,
        })),
        [{ field: USER_KEY_GRANT_VALUE_FIELD, resealed: 2, unopenable: 0 }],
      );
      for (let g of grants) {
        assert.strictEqual(
          (await grantColumns(dbAdapter, g.id)).value_key_id,
          'grants-new',
        );
        let opened = await openGrantForSending(dbAdapter, during, {
          owner: OWNER,
          grantId: g.id,
        });
        assert.strictEqual(opened.value, VALUE);
      }
    });

    test("an operation whose module is in a realm the caller can't read gets no grant", async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let module = 'https://private.example/realm/vendor';
      let asked: { href: string; caller: unknown }[] = [];
      let answer: { realm: string; read: boolean } | undefined;
      let core = {
        resolveCodeRef: (ref: any) => ref,
        definitionLookup: {
          lookupDefinition: async () => ({
            operations: {
              chat: {
                base: 'callApi',
                callApi: { destination: 'https://api.openai.com/v1/' },
                deterministic: true,
              },
            },
          }),
        },
        readsRealmOf: async (href: string, caller: unknown) => {
          asked.push({ href, caller });
          return answer;
        },
      } as any;
      let approve = () =>
        createOrReuseGrantForOperation(dbAdapter, keyring, {
          core,
          realmURL: new URL('https://readable.example/realm/'),
          codeRef: { module: rri(module), name: 'Vendor' },
          operationName: 'chat',
          owner: OWNER,
          keyId: key.id,
          expectedDestination: 'https://api.openai.com/v1/',
          via: 'window',
        });

      answer = { realm: 'https://private.example/realm/', read: false };
      await assert.rejects(
        approve(),
        /no such operation/,
        'an unreadable realm',
      );
      answer = undefined;
      await assert.rejects(
        approve(),
        /no such operation/,
        'a realm not served',
      );
      assert.deepEqual(
        asked[0],
        { href: module, caller: { kind: 'user', actor: OWNER } },
        "the module's own realm is asked about, for the caller",
      );
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM user_key_grants`,
      );
      assert.strictEqual(count, 0, 'no grant is written');

      answer = { realm: 'https://private.example/realm/', read: true };
      let { created, grant: made } = await approve();
      assert.true(created, 'a readable one gets its grant');
      assert.strictEqual(made.destination, 'https://api.openai.com/v1/');
    });

    test('grants go with their key, and only their owner removes one', async function (assert) {
      let key = await addKey(dbAdapter, keyring);
      let { grant: kept } = await grant(key.id, 'https://api.openai.com/');
      let { grant: removed } = await grant(
        key.id,
        'https://eu.api.openai.com/',
      );

      await assert.rejects(
        removeGrant(dbAdapter, {
          owner: OTHER_USER,
          grantId: removed.id,
          via: 'window',
        }),
        /no such grant/,
      );
      assert.deepEqual(
        await removeGrant(dbAdapter, {
          owner: OWNER,
          grantId: removed.id,
          via: 'window',
        }),
        { revokedBindings: [] },
      );
      await assert.rejects(
        openGrantForSending(dbAdapter, keyring, {
          owner: OWNER,
          grantId: removed.id,
        }),
        /no such grant/,
      );

      await deleteUserKey(dbAdapter, {
        owner: OWNER,
        id: key.id,
        ticket: await ticket(dbAdapter, 'delete', key.id),
      });
      let rows = await dbAdapter.execute(
        `SELECT id FROM user_key_grants WHERE id = $1`,
        { bind: [kept.id] },
      );
      assert.strictEqual(rows.length, 0, 'deleting the key deletes its grants');
    });
  });

  module('grants API', function (hooks) {
    const realmURL = new URL('http://127.0.0.1:4444/user-key-grants-test/');
    const secureOriginURL = new URL('https://secure.grants.test/secure');
    const APP_ORIGIN = 'http://localhost:4200';
    const TESTER = '@grant-tester:localhost';
    const OUTSIDER = '@grant-outsider:localhost';
    // The realm reads its own files as this user when it indexes them.
    const REALM_USER = '@node-test_realm:localhost';
    const VENDOR = {
      module: rri(`${realmURL.href}vendor`),
      name: 'Vendor',
    };

    function vendorModule(chatURL: string) {
      return `
        import { CardDef } from "@cardstack/base/card-api";
        import { operation } from "@cardstack/base/operations";

        export class Vendor extends CardDef {
          @operation static models = {
            base: 'callApi',
            url: 'https://api.openai.com/v1/models',
            headers: { authorization: 'Bearer {{userKey}}' },
          };

          @operation static chat = {
            base: 'callApi',
            url: '${chatURL}',
            headers: { authorization: 'Bearer {{userKey}}' },
          };

          @operation static betaModels = {
            base: 'callApi',
            url: 'https://api.openai.com/v1beta/models',
            headers: { authorization: 'Bearer {{userKey}}' },
          };

          @operation static euModels = {
            base: 'callApi',
            url: 'https://eu.api.openai.com/v1/models',
            headers: { authorization: 'Bearer {{userKey}}' },
          };
        }
      `;
    }

    let realm: Realm;
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
        [TESTER]: ['read'],
        [REALM_USER]: ['read', 'write', 'realm-owner'],
      },
      fileSystem: {
        'vendor.gts': vendorModule(
          'https://api.openai.com/v1/chat/completions',
        ),
      },
      onRealmSetup(args) {
        realm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    function appSession(user = TESTER): string {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
    }

    function create(
      authorization: string,
      attributes: Record<string, unknown>,
      origin: string | undefined = secureOriginURL.origin,
    ) {
      let req = request
        .post('/_user-key-grants')
        .set('Authorization', authorization)
        .set('Content-Type', 'application/json');
      if (origin) {
        req = req.set('Origin', origin);
      }
      return req.send({ data: { type: 'user-key-grant', attributes } });
    }

    // What each operation sends to, as the approval shows it.
    const DESTINATIONS: Record<string, string> = {
      models: 'https://api.openai.com/v1/',
      chat: 'https://api.openai.com/v1/chat/',
      betaModels: 'https://api.openai.com/v1beta/',
      euModels: 'https://eu.api.openai.com/v1/',
    };

    function forOperation(
      keyId: string,
      operation: string,
      expectedDestination = DESTINATIONS[operation] ??
        'https://api.openai.com/',
    ) {
      return {
        keyId,
        realm: realmURL.href,
        codeRef: VENDOR,
        operation,
        expectedDestination,
      };
    }

    test('approving an operation creates a grant for its destination, and one under it reuses it', async function (assert) {
      let key = await addKey(dbAdapter, keyring, { owner: TESTER });
      let auth = await secureSessionAuth(dbAdapter, TESTER);

      let models = await create(auth, forOperation(key.id, 'models'));
      assert.strictEqual(models.status, 201, models.text);
      assert.strictEqual(
        models.body.data.attributes.destination,
        'https://api.openai.com/v1/',
      );
      assert.strictEqual(models.body.data.attributes.approvedVia, 'window');
      assert.true(models.body.meta.created);

      let chat = await create(auth, forOperation(key.id, 'chat'));
      assert.strictEqual(chat.status, 200, 'a covered prefix reuses it');
      assert.strictEqual(chat.body.data.id, models.body.data.id);
      assert.false(chat.body.meta.created);

      let beta = await create(auth, forOperation(key.id, 'betaModels'));
      let eu = await create(auth, forOperation(key.id, 'euModels'));
      assert.strictEqual(beta.status, 201, '/v1beta/ is a second grant');
      assert.strictEqual(eu.status, 201, 'another host is a third');
      assert.strictEqual(
        beta.body.data.attributes.destination,
        'https://api.openai.com/v1beta/',
      );
      assert.strictEqual(
        eu.body.data.attributes.destination,
        'https://eu.api.openai.com/v1/',
      );

      let shown = await request
        .get(`/_user-keys/${key.id}`)
        .set('Authorization', appSession());
      assert.strictEqual(shown.status, 200);
      assert.deepEqual(
        shown.body.data.attributes.grants.map(
          (g: { destination: string }) => g.destination,
        ),
        [
          'https://api.openai.com/v1/',
          'https://api.openai.com/v1beta/',
          'https://eu.api.openai.com/v1/',
        ],
        "the key's metadata lists its grants",
      );
      let listed = await request
        .get('/_user-keys')
        .set('Authorization', appSession());
      assert.strictEqual(listed.body.data[0].attributes.grants.length, 3);
      assert.notOk(
        JSON.stringify([shown.body, listed.body, models.body]).includes(VALUE),
        'no response carries the value',
      );
    });

    test("editing the operation's destination after approval leaves the grant as approved", async function (assert) {
      let key = await addKey(dbAdapter, keyring, { owner: TESTER });
      let auth = await secureSessionAuth(dbAdapter, TESTER);
      let chat = await create(auth, forOperation(key.id, 'chat'));
      assert.strictEqual(chat.status, 201, chat.text);
      let grantId = chat.body.data.id;
      let before = await grantColumns(dbAdapter, grantId);

      await realm.write(
        'vendor.gts',
        vendorModule('https://attacker.example/v1/chat/completions'),
      );
      await realm.incrementalIndexing();

      let after = await grantColumns(dbAdapter, grantId);
      assert.deepEqual(after, before, 'the grant row is untouched');
      let opened = await openGrantForSending(dbAdapter, keyring, {
        owner: TESTER,
        grantId,
      });
      assert.strictEqual(
        opened.destination,
        'https://api.openai.com/v1/chat/',
        'sending reads the destination stored on the grant',
      );
      assert.strictEqual(opened.value, VALUE);

      let stale = await create(auth, forOperation(key.id, 'chat'));
      assert.strictEqual(
        stale.status,
        409,
        'approving what was shown before the edit is refused',
      );
      let moved = await create(
        auth,
        forOperation(key.id, 'chat', 'https://attacker.example/v1/chat/'),
      );
      assert.strictEqual(moved.status, 201, moved.text);
      assert.strictEqual(
        moved.body.data.attributes.destination,
        'https://attacker.example/v1/chat/',
        'approving again reads the edited declaration, as a new grant',
      );
      assert.notStrictEqual(moved.body.data.id, grantId);
    });

    test("a session without the secure origin's sign-in can't create or remove a grant", async function (assert) {
      let key = await addKey(dbAdapter, keyring, { owner: TESTER });
      let attributes = forOperation(key.id, 'models');
      let secure = await secureSessionAuth(dbAdapter, TESTER);

      // The app's session, and the CLI's ordinary session, from the secure
      // origin's `Origin`, the app's, or none.
      for (let origin of [secureOriginURL.origin, APP_ORIGIN, undefined]) {
        let response = await create(appSession(), attributes, origin);
        assert.strictEqual(
          response.status,
          403,
          `an ordinary session from ${origin ?? 'no Origin'} is refused`,
        );
      }
      let fromApp = await create(secure, attributes, APP_ORIGIN);
      assert.strictEqual(
        fromApp.status,
        403,
        'a secure session from the app page is refused',
      );
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM user_key_grants`,
      );
      assert.strictEqual(count, 0, 'no grant was created');

      let fromWindow = await create(secure, attributes);
      assert.strictEqual(fromWindow.status, 201, fromWindow.text);
      let cli = await secureSessionAuth(dbAdapter, TESTER, { client: 'cli' });
      let fromCLI = await create(
        cli,
        forOperation(key.id, 'euModels'),
        undefined,
      );
      assert.strictEqual(fromCLI.status, 201, fromCLI.text);
      assert.strictEqual(fromCLI.body.data.attributes.approvedVia, 'cli');

      let grantId = fromWindow.body.data.id;
      for (let [authorization, origin] of [
        [appSession(), secureOriginURL.origin],
        [appSession(), undefined],
        [secure, APP_ORIGIN],
      ] as [string, string | undefined][]) {
        let req = request
          .delete(`/_user-key-grants/${grantId}`)
          .set('Authorization', authorization);
        if (origin) {
          req = req.set('Origin', origin);
        }
        assert.strictEqual((await req).status, 403);
      }
      let other = await secureSessionAuth(dbAdapter, OUTSIDER);
      let byOther = await request
        .delete(`/_user-key-grants/${grantId}`)
        .set('Authorization', other)
        .set('Origin', secureOriginURL.origin);
      assert.strictEqual(
        byOther.status,
        404,
        "another user's grant is unknown",
      );

      let removed = await request
        .delete(`/_user-key-grants/${grantId}`)
        .set('Authorization', secure)
        .set('Origin', secureOriginURL.origin);
      assert.strictEqual(removed.status, 200, removed.text);
      assert.deepEqual(removed.body.meta, { revokedBindings: [] });
    });

    test('a grant names a readable realm, an operation that sends a request, and its own key', async function (assert) {
      let key = await addKey(dbAdapter, keyring, { owner: TESTER });
      let auth = await secureSessionAuth(dbAdapter, TESTER);

      let unknown = await create(auth, forOperation(key.id, 'nothingHere'));
      assert.strictEqual(unknown.status, 404);

      let unreadable = await addKey(dbAdapter, keyring, { owner: OUTSIDER });
      let outsider = await create(
        await secureSessionAuth(dbAdapter, OUTSIDER),
        forOperation(unreadable.id, 'models'),
      );
      assert.strictEqual(
        outsider.status,
        404,
        "a realm the caller can't read answers as no realm",
      );

      let notTheirs = await create(auth, forOperation(unreadable.id, 'models'));
      assert.strictEqual(
        notTheirs.status,
        404,
        "another user's key is unknown",
      );

      let destination = await create(auth, {
        ...forOperation(key.id, 'models'),
        destination: 'https://attacker.example/',
      });
      assert.strictEqual(
        destination.status,
        400,
        'a destination is read from the operation, never sent',
      );

      let { expectedDestination: _, ...unshown } = forOperation(
        key.id,
        'models',
      );
      let missing = await create(auth, unshown);
      assert.strictEqual(
        missing.status,
        400,
        'an approval names the destination it showed',
      );
      let broader = await create(
        auth,
        forOperation(key.id, 'models', 'https://api.openai.com/'),
      );
      assert.strictEqual(
        broader.status,
        409,
        "a destination the operation doesn't send to is refused",
      );
      let plain = await create(
        auth,
        forOperation(key.id, 'models', 'http://api.openai.com/v1/'),
      );
      assert.strictEqual(plain.status, 400, 'an http destination is refused');
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM user_key_grants`,
      );
      assert.strictEqual(count, 0, 'no grant was created');
    });
  });

  module('grants API across realms', function (hooks) {
    const PUBLIC_REALM = 'http://127.0.0.1:4444/grants-public-realm/';
    const PRIVATE_REALM = 'http://127.0.0.1:4444/grants-private-realm/';
    const secureOriginURL = new URL('https://secure.grants.test/secure');
    const REALM_USER = '@node-test_realm:localhost';
    const READER = '@grants-private-reader:localhost';
    const STRANGER = '@grants-stranger:localhost';
    const PRIVATE_VENDOR = {
      module: rri(`${PRIVATE_REALM}vendor`),
      name: 'Vendor',
    };

    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let server: Server;
    let realms: Realm[] = [];
    let keyring: SecretsKeyring;

    async function start({
      dbAdapter: _dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      dbAdapter = _dbAdapter;
      let result = await runTestRealmServerWithRealms({
        virtualNetwork: createVirtualNetwork(),
        realmsRootPath: join(dirSync().name, 'realm_server_1'),
        secureOriginURL,
        realms: [
          {
            realmURL: new URL(PUBLIC_REALM),
            fileSystem: {},
            permissions: {
              [REALM_USER]: ['read', 'write', 'realm-owner'],
              '*': ['read'],
            },
          },
          {
            realmURL: new URL(PRIVATE_REALM),
            fileSystem: {
              'vendor.gts': `
                import { CardDef } from "@cardstack/base/card-api";
                import { operation } from "@cardstack/base/operations";

                export class Vendor extends CardDef {
                  @operation static models = {
                    base: 'callApi',
                    url: 'https://private-vendor.example/v1/models',
                    headers: { authorization: 'Bearer {{userKey}}' },
                  };
                }
              `,
            },
            permissions: {
              [REALM_USER]: ['read', 'write', 'realm-owner'],
              [READER]: ['read'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });
      server = result.testRealmHttpServer;
      realms = result.realms;
      request = supertest(server);
    }

    // One server for the module: its tests write only grants and keys,
    // which name the key's owner, so they don't see each other's rows.
    // Booting indexes both realms inside the first test's budget.
    hooks.before(function (assert) {
      assert.timeout(300_000);
    });

    setupDB(hooks, {
      before: async (_dbAdapter, publisher, runner) => {
        keyring = installSecretsKeyring(
          await new LocalKeyProvider().loadDataKeys(),
        );
        await start({ dbAdapter: _dbAdapter, publisher, runner });
      },
      after: async () => {
        for (let realm of realms) {
          realm?.unsubscribe();
        }
        if (server) {
          await closeServer(server);
        }
        resetCatalogRealms();
        resetSecretsAtRest();
      },
    });

    async function approve(user: string) {
      let key = await addKey(dbAdapter, keyring, { owner: user });
      return {
        key,
        response: await request
          .post('/_user-key-grants')
          .set('Authorization', await secureSessionAuth(dbAdapter, user))
          .set('Origin', secureOriginURL.origin)
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'user-key-grant',
              attributes: {
                keyId: key.id,
                realm: PUBLIC_REALM,
                codeRef: PRIVATE_VENDOR,
                operation: 'models',
                expectedDestination: 'https://private-vendor.example/v1/',
              },
            },
          }),
      };
    }

    test("naming a readable realm doesn't reach an operation whose module is in one the caller can't read", async function (assert) {
      let { key, response } = await approve(STRANGER);
      assert.strictEqual(response.status, 404, response.text);
      assert.notOk(
        response.text.includes('private-vendor.example'),
        "the private realm's destination is not disclosed",
      );
      let rows = await dbAdapter.execute(
        `SELECT id FROM user_key_grants WHERE key_id = $1`,
        { bind: [key.id] },
      );
      assert.strictEqual(rows.length, 0, 'no grant is written');

      let { response: allowed } = await approve(READER);
      assert.strictEqual(
        allowed.status,
        201,
        `a reader of the module's realm gets the grant: ${allowed.text}`,
      );
      assert.strictEqual(
        allowed.body.data.attributes.destination,
        'https://private-vendor.example/v1/',
      );
    });
  });

  module('grants table', function (hooks) {
    let dbAdapter: PgAdapter;

    // Roles and memberships are shared by every database on the server, so
    // each test removes the memberships it makes, whatever happens.
    const MEMBER = 'readonly_member_for_user_key_grants_test';

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
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
      require(GRANTS_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    test("the read-only role and its members can't select it", async function (assert) {
      await createRole(MEMBER);
      await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
      try {
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE user_key_grants TO ${MEMBER}`,
        );
        await runUp();
        for (let role of ['readonly_role', MEMBER]) {
          await assert.rejects(
            dbAdapter.withTransaction(async (query: any) => {
              await query([`SET LOCAL ROLE ${role}`]);
              return await query([`SELECT * FROM user_key_grants`]);
            }),
            /permission denied for table user_key_grants/,
            `${role} can't select user_key_grants`,
          );
        }
      } finally {
        await dbAdapter.execute(`REVOKE readonly_role FROM ${MEMBER}`);
      }
    });

    test('stops when PUBLIC can read a column', async function (assert) {
      await dbAdapter.execute(
        `GRANT SELECT (destination) ON TABLE user_key_grants TO PUBLIC`,
      );
      await assert.rejects(
        runUp(),
        /can read user_key_grants\.destination, which is withheld from readonly_role/,
      );
    });
  });
});
