import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupDB,
  setupSimpleRealmServerTemplate,
  startSimpleRealmServer,
  closeServer,
  realmSecretSeed,
} from './helpers/index.ts';
import { logLinesDuring, withLogDefinition } from './helpers/log-capture.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import { randomBytes } from 'node:crypto';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  SecretDecryptionError,
  SecretsKeyring as Keyring,
  type SealedSecret,
  type SecretBinding,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  resealUnderCurrentKey,
  SEALED_COLUMNS,
} from '../lib/secrets-at-rest/rotation.ts';
import {
  addUserKey,
  mintKeyWriteTicket,
  setUserKeyDestination,
  USER_KEY_VALUE_FIELD,
} from '../lib/user-keys.ts';

const require = createRequire(import.meta.url);
const USER_KEYS_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1791999986682_add-user-keys.js',
);

const OWNER = '@key-owner:localhost';
const OTHER_USER = '@other-user:localhost';
const VALUE = 'sk-user-key-value-5b0e7c21d9';
const NEW_VALUE = 'sk-user-key-replacement-a41f93';
const DESTINATION = 'https://api.example.com/v1/';

async function sealedRow(
  dbAdapter: PgAdapter,
  id: string,
): Promise<{
  owner: string;
  destination: string | null;
  sealed: SealedSecret;
}> {
  let [row] = await dbAdapter.execute(
    `SELECT owner, destination,
            encode(value_ciphertext, 'base64') AS ciphertext,
            encode(value_nonce, 'base64') AS nonce,
            encode(value_tag, 'base64') AS tag,
            value_key_id
       FROM user_keys WHERE id = $1`,
    { bind: [id] },
  );
  return {
    owner: row.owner as string,
    destination: (row.destination as string | null) ?? null,
    sealed: {
      keyId: row.value_key_id as string,
      ciphertext: Buffer.from(row.ciphertext as string, 'base64'),
      nonce: Buffer.from(row.nonce as string, 'base64'),
      tag: Buffer.from(row.tag as string, 'base64'),
    },
  };
}

function bindingFor(
  owner: string,
  id: string,
  destination?: string,
): SecretBinding {
  return {
    field: USER_KEY_VALUE_FIELD,
    owner,
    id,
    ...(destination !== undefined ? { destination } : {}),
  };
}

// Every row of both tables, as text, to check no value or ticket is stored in
// the clear.
async function storedText(dbAdapter: PgAdapter): Promise<string> {
  let keys = await dbAdapter.execute(
    `SELECT row_to_json(user_keys)::text AS row FROM user_keys`,
  );
  let tickets = await dbAdapter.execute(
    `SELECT row_to_json(key_write_tickets)::text AS row FROM key_write_tickets`,
  );
  return [...keys, ...tickets].map((r) => r.row).join('\n');
}

module(basename(import.meta.filename), function () {
  module('user keys management API', function (hooks) {
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
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
        resetSecretsAtRest();
      },
    });

    function auth(
      user = OWNER,
      claims: Partial<RealmServerTokenClaim> = {},
    ): string {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'test-session', ...claims },
        realmSecretSeed,
      )}`;
    }

    async function ticketFor(user = OWNER): Promise<string> {
      let response = await request
        .post('/_key-write-tickets')
        .set('Authorization', auth(user));
      if (response.status !== 201) {
        throw new Error(`could not mint a ticket: ${response.status}`);
      }
      return response.body.data.attributes.ticket;
    }

    async function add(
      attributes: Record<string, unknown>,
      meta: Record<string, unknown>,
      user = OWNER,
    ) {
      return await request
        .post('/_user-keys')
        .set('Authorization', auth(user))
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'user-key', attributes }, meta });
    }

    async function replace(
      id: string,
      value: string,
      ticket: string | undefined,
      user = OWNER,
    ) {
      return await request
        .patch(`/_user-keys/${id}`)
        .set('Authorization', auth(user))
        .set('Content-Type', 'application/json')
        .send({
          data: { type: 'user-key', id, attributes: { value } },
          ...(ticket !== undefined ? { meta: { ticket } } : {}),
        });
    }

    async function addKey(name = 'weather', user = OWNER, value = VALUE) {
      let response = await add(
        { name, value },
        { ticket: await ticketFor(user) },
        user,
      );
      if (response.status !== 201) {
        throw new Error(
          `could not add a key: ${response.status} ${response.text}`,
        );
      }
      return response.body.data.id as string;
    }

    test('add, list, show, replace and delete a key, and no response carries its value', async function (assert) {
      let responses: string[] = [];

      let added = await add(
        { name: 'weather', value: VALUE },
        { ticket: await ticketFor() },
      );
      responses.push(added.text);
      assert.strictEqual(added.status, 201, 'the key is added');
      let id = added.body.data.id;
      assert.strictEqual(added.body.data.type, 'user-key');
      assert.deepEqual(
        Object.keys(added.body.data.attributes).sort(),
        [
          'createdAt',
          'destination',
          'kind',
          'name',
          'placementHints',
          'state',
          'updatedAt',
        ],
        'the response carries metadata only',
      );
      assert.strictEqual(added.body.data.attributes.name, 'weather');
      assert.strictEqual(added.body.data.attributes.kind, 'static');
      assert.strictEqual(added.body.data.attributes.state, 'active');
      assert.strictEqual(added.body.data.attributes.destination, null);

      let listed = await request
        .get('/_user-keys')
        .set('Authorization', auth());
      responses.push(listed.text);
      assert.strictEqual(listed.status, 200);
      assert.deepEqual(
        listed.body.data.map((key: { id: string }) => key.id),
        [id],
        'the key is listed',
      );

      let shown = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth());
      responses.push(shown.text);
      assert.strictEqual(shown.status, 200);
      assert.strictEqual(shown.body.data.attributes.name, 'weather');

      let row = await sealedRow(dbAdapter, id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, id)),
        VALUE,
        'the stored value opens to what was added',
      );

      let replaced = await replace(id, NEW_VALUE, await ticketFor());
      responses.push(replaced.text);
      assert.strictEqual(replaced.status, 200, 'the value is replaced');
      assert.strictEqual(replaced.body.data.attributes.name, 'weather');
      row = await sealedRow(dbAdapter, id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, id)),
        NEW_VALUE,
        'the stored value opens to the replacement',
      );

      let stored = await storedText(dbAdapter);
      assert.false(stored.includes(VALUE), 'no value is stored in the clear');
      assert.false(stored.includes(NEW_VALUE), 'nor its replacement');

      let deleted = await request
        .delete(`/_user-keys/${id}`)
        .set('Authorization', auth())
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket: await ticketFor() } });
      responses.push(deleted.text);
      assert.strictEqual(deleted.status, 204, 'the key is deleted');
      let gone = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth());
      assert.strictEqual(gone.status, 404, 'a deleted key is gone');

      for (let text of responses) {
        assert.false(text.includes(VALUE), 'no response carries the value');
        assert.false(
          text.includes(NEW_VALUE),
          'no response carries the replacement',
        );
      }
    });

    test("another user can't see or touch a key", async function (assert) {
      let id = await addKey();

      let listed = await request
        .get('/_user-keys')
        .set('Authorization', auth(OTHER_USER));
      assert.strictEqual(listed.status, 200);
      assert.deepEqual(listed.body.data, [], 'their list is empty');

      let shown = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth(OTHER_USER));
      assert.strictEqual(shown.status, 404, 'show answers as for no key');

      let replaced = await replace(
        id,
        NEW_VALUE,
        await ticketFor(OTHER_USER),
        OTHER_USER,
      );
      assert.strictEqual(replaced.status, 404, 'replace answers as for no key');

      let deleted = await request
        .delete(`/_user-keys/${id}`)
        .set('Authorization', auth(OTHER_USER))
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket: await ticketFor(OTHER_USER) } });
      assert.strictEqual(deleted.status, 404, 'delete answers as for no key');

      let row = await sealedRow(dbAdapter, id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, id)),
        VALUE,
        'the key is unchanged',
      );
    });

    test('names are unique among an owner’s keys, not across owners', async function (assert) {
      await addKey('weather');

      let ticket = await ticketFor();
      let duplicate = await add(
        { name: 'weather', value: NEW_VALUE },
        { ticket },
      );
      assert.strictEqual(
        duplicate.status,
        409,
        'a second key of that name is refused',
      );

      let renamed = await add(
        { name: 'weather 2', value: NEW_VALUE },
        { ticket },
      );
      assert.strictEqual(
        renamed.status,
        201,
        'a refused write leaves its ticket unused',
      );

      await addKey('weather', OTHER_USER);
      let theirs = await request
        .get('/_user-keys')
        .set('Authorization', auth(OTHER_USER));
      assert.deepEqual(
        theirs.body.data.map(
          (key: { attributes: { name: string } }) => key.attributes.name,
        ),
        ['weather'],
        'another owner may use the same name',
      );
    });

    test('a value is written only with a valid ticket', async function (assert) {
      let missing = await add({ name: 'weather', value: VALUE }, {});
      assert.strictEqual(
        missing.status,
        403,
        'a write without a ticket is refused',
      );

      let made = await add(
        { name: 'weather', value: VALUE },
        { ticket: 'not-a-ticket' },
      );
      assert.strictEqual(made.status, 403, 'a made-up ticket is refused');

      let ticket = await ticketFor();
      let first = await add({ name: 'weather', value: VALUE }, { ticket });
      assert.strictEqual(first.status, 201);
      let reused = await add({ name: 'news', value: VALUE }, { ticket });
      assert.strictEqual(reused.status, 403, 'a used ticket is refused');

      let expired = await ticketFor();
      await dbAdapter.execute(
        `UPDATE key_write_tickets SET expires_at = NOW() - interval '1 second'`,
      );
      let late = await add({ name: 'news', value: VALUE }, { ticket: expired });
      assert.strictEqual(late.status, 403, 'an expired ticket is refused');

      let theirs = await ticketFor(OTHER_USER);
      let borrowed = await add(
        { name: 'news', value: VALUE },
        { ticket: theirs },
      );
      assert.strictEqual(
        borrowed.status,
        403,
        "another user's ticket is refused",
      );

      let id = first.body.data.id;
      let unticketed = await replace(id, NEW_VALUE, undefined);
      assert.strictEqual(
        unticketed.status,
        403,
        'a replacement without a ticket is refused',
      );
      let row = await sealedRow(dbAdapter, id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, id)),
        VALUE,
        'the refused replacement changed nothing',
      );

      let keys = await request.get('/_user-keys').set('Authorization', auth());
      assert.deepEqual(
        keys.body.data.map(
          (key: { attributes: { name: string } }) => key.attributes.name,
        ),
        ['weather'],
        'only the ticketed write stored a key',
      );
    });

    test('a key is deleted only with a valid ticket', async function (assert) {
      let id = await addKey();
      let unticketed = await request
        .delete(`/_user-keys/${id}`)
        .set('Authorization', auth());
      assert.strictEqual(
        unticketed.status,
        400,
        'a delete with no body is refused',
      );
      let noTicket = await request
        .delete(`/_user-keys/${id}`)
        .set('Authorization', auth())
        .set('Content-Type', 'application/json')
        .send({ meta: {} });
      assert.strictEqual(
        noTicket.status,
        403,
        'a delete without a ticket is refused',
      );
      let shown = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth());
      assert.strictEqual(shown.status, 200, 'the key is still there');
    });

    test('of two concurrent uses of one ticket, exactly one succeeds', async function (assert) {
      let ticket = await ticketFor();
      let responses = await Promise.all([
        add({ name: 'weather', value: VALUE }, { ticket }),
        add({ name: 'news', value: NEW_VALUE }, { ticket }),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [201, 403],
        'one write succeeds and the other is refused',
      );
      let keys = await request.get('/_user-keys').set('Authorization', auth());
      assert.strictEqual(keys.body.data.length, 1, 'one key is stored');
    });

    test('an oversized body is refused before it is read', async function (assert) {
      let response = await add(
        { name: 'weather', value: 'x'.repeat(70 * 1024) },
        { ticket: await ticketFor() },
      );
      assert.strictEqual(response.status, 413, 'the body is refused');
      let keys = await request.get('/_user-keys').set('Authorization', auth());
      assert.deepEqual(keys.body.data, [], 'nothing was stored');
    });

    test('tickets are minted for the secure origin and the CLI, never the app page', async function (assert) {
      let fromApp = await request
        .post('/_key-write-tickets')
        .set('Authorization', auth())
        .set('Origin', 'https://app.keys.test');
      assert.strictEqual(fromApp.status, 403, 'the app page is refused');
      assert.strictEqual(
        fromApp.body.data,
        undefined,
        'no ticket is returned to it',
      );

      let opaque = await request
        .post('/_key-write-tickets')
        .set('Authorization', auth())
        .set('Origin', 'null');
      assert.strictEqual(opaque.status, 403, 'an opaque origin is refused');

      let fromSecureOrigin = await request
        .post('/_key-write-tickets')
        .set('Authorization', auth())
        .set('Origin', secureOriginURL.origin);
      assert.strictEqual(
        fromSecureOrigin.status,
        201,
        'the secure origin gets one',
      );
      assert.strictEqual(
        typeof fromSecureOrigin.body.data.attributes.ticket,
        'string',
      );
      assert.true(
        Date.parse(fromSecureOrigin.body.data.attributes.expiresAt) >
          Date.now(),
        'it expires in the future',
      );

      let fromCLI = await request
        .post('/_key-write-tickets')
        .set('Authorization', auth());
      assert.strictEqual(
        fromCLI.status,
        201,
        'a client with no origin gets one',
      );

      let stored = await storedText(dbAdapter);
      assert.false(
        stored.includes(fromSecureOrigin.body.data.attributes.ticket),
        'a ticket is not stored in the clear',
      );

      let anonymous = await request.post('/_key-write-tickets');
      assert.strictEqual(
        anonymous.status,
        401,
        'a signed-out caller is refused',
      );
    });

    test('keys are managed only in their owner’s own session', async function (assert) {
      for (let [claims, status, kind] of [
        [
          { delegated: true, realm: 'http://127.0.0.1:4444/test/' },
          401,
          'a delegated session',
        ],
        [{ realmAuthority: true as const }, 403, 'a realm-authority session'],
      ] as const) {
        let minted = await request
          .post('/_key-write-tickets')
          .set('Authorization', auth(OWNER, claims));
        assert.strictEqual(minted.status, status, `${kind} mints no ticket`);
        let listed = await request
          .get('/_user-keys')
          .set('Authorization', auth(OWNER, claims));
        assert.strictEqual(listed.status, status, `${kind} lists no key`);
      }
    });

    test('a destination is never typed', async function (assert) {
      let typed = await add(
        { name: 'weather', value: VALUE, destination: DESTINATION },
        { ticket: await ticketFor() },
      );
      assert.strictEqual(
        typed.status,
        400,
        'a destination attribute is refused',
      );
      assert.true(typed.text.includes('destination'), 'the refusal says why');

      let forOperation = await add(
        { name: 'weather', value: VALUE },
        {
          ticket: await ticketFor(),
          operation: {
            realmURL: 'http://127.0.0.1:4444/test/',
            definitionURL: 'http://127.0.0.1:4444/test/weather',
            exportName: 'Weather',
            operationName: 'forecast',
          },
        },
      );
      assert.strictEqual(
        forOperation.status,
        422,
        'an operation that declares no destination is refused',
      );

      let malformed = await add(
        { name: 'weather', value: VALUE },
        { ticket: await ticketFor(), operation: { realmURL: 'x' } },
      );
      assert.strictEqual(
        malformed.status,
        400,
        'a partial reference is refused',
      );

      let keys = await request.get('/_user-keys').set('Authorization', auth());
      assert.deepEqual(keys.body.data, [], 'nothing was stored');
    });

    test('the value never reaches the request log', async function (assert) {
      let ticket = await ticketFor();
      let lines = await withLogDefinition('realm:requests', 'info', () =>
        logLinesDuring(['realm:requests', 'realm:user-keys'], async () => {
          let response = await add(
            { name: 'weather', value: VALUE },
            { ticket },
          );
          assert.strictEqual(response.status, 201);
          await add({ name: 'weather', value: NEW_VALUE }, { ticket });
          await request
            .get(`/_user-keys?ticket=${ticket}&value=${VALUE}`)
            .set('Authorization', auth());
        }),
      );
      assert.true(lines.length > 0, 'the requests are logged');
      for (let line of lines) {
        assert.false(line.message.includes(VALUE), 'no line carries the value');
        assert.false(line.message.includes(NEW_VALUE), 'nor a refused value');
        assert.false(line.message.includes(ticket), 'nor the ticket');
      }
    });
  });

  module('user keys at rest', function (hooks) {
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

    async function addWithoutDestination() {
      let { ticket } = await mintKeyWriteTicket(dbAdapter, OWNER);
      return await addUserKey(dbAdapter, keyring, {
        owner: OWNER,
        name: 'weather',
        value: VALUE,
        ticket,
      });
    }

    test('a key added without a destination stores none, and setting one re-seals it', async function (assert) {
      let key = await addWithoutDestination();
      assert.strictEqual(key.destination, null, 'no destination is stored');
      let row = await sealedRow(dbAdapter, key.id);
      assert.strictEqual(row.destination, null);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, key.id)),
        VALUE,
        'it opens bound to field, owner and id alone',
      );

      let updated = await setUserKeyDestination(dbAdapter, keyring, {
        owner: OWNER,
        id: key.id,
        destination: DESTINATION,
        placementHints: { placement: 'header', name: 'Authorization' },
      });
      assert.strictEqual(updated.destination, DESTINATION);
      assert.deepEqual(updated.placementHints, {
        placement: 'header',
        name: 'Authorization',
      });

      row = await sealedRow(dbAdapter, key.id);
      assert.strictEqual(row.destination, DESTINATION);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, key.id, DESTINATION)),
        VALUE,
        'it opens with its destination',
      );
      assert.throws(
        () => keyring.open(row.sealed, bindingFor(OWNER, key.id)),
        SecretDecryptionError,
        'it no longer opens without one',
      );
      assert.throws(
        () =>
          keyring.open(
            row.sealed,
            bindingFor(OWNER, key.id, 'https://elsewhere.example.com/'),
          ),
        SecretDecryptionError,
        'nor with another destination',
      );
      assert.throws(
        () =>
          keyring.open(row.sealed, bindingFor(OTHER_USER, key.id, DESTINATION)),
        SecretDecryptionError,
        'nor for another owner',
      );
    });

    test("a key's destination can't change once set", async function (assert) {
      let key = await addWithoutDestination();
      await setUserKeyDestination(dbAdapter, keyring, {
        owner: OWNER,
        id: key.id,
        destination: DESTINATION,
      });
      let again = await setUserKeyDestination(dbAdapter, keyring, {
        owner: OWNER,
        id: key.id,
        destination: DESTINATION,
      });
      assert.strictEqual(
        again.destination,
        DESTINATION,
        'setting it again changes nothing',
      );

      await assert.rejects(
        setUserKeyDestination(dbAdapter, keyring, {
          owner: OWNER,
          id: key.id,
          destination: 'https://elsewhere.example.com/',
        }),
        /can't change/,
      );
      await assert.rejects(
        setUserKeyDestination(dbAdapter, keyring, {
          owner: OTHER_USER,
          id: key.id,
          destination: DESTINATION,
        }),
        /no such key/,
        "another user can't set it",
      );
      let row = await sealedRow(dbAdapter, key.id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, key.id, DESTINATION)),
        VALUE,
      );
    });

    test('a key added for an operation is sealed with its destination', async function (assert) {
      let { ticket } = await mintKeyWriteTicket(dbAdapter, OWNER);
      let key = await addUserKey(dbAdapter, keyring, {
        owner: OWNER,
        name: 'weather',
        value: VALUE,
        ticket,
        destination: DESTINATION,
      });
      assert.strictEqual(key.destination, DESTINATION);
      let row = await sealedRow(dbAdapter, key.id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, key.id, DESTINATION)),
        VALUE,
      );
      assert.throws(
        () => keyring.open(row.sealed, bindingFor(OWNER, key.id)),
        SecretDecryptionError,
      );
    });

    test('rotating the data key re-seals keys with and without a destination', async function (assert) {
      let oldBytes = randomBytes(32);
      let oldKey = new Keyring(
        [{ keyId: 'rotation-old', key: Buffer.from(oldBytes) }],
        'rotation-old',
      );
      let { ticket: first } = await mintKeyWriteTicket(dbAdapter, OWNER);
      let bare = await addUserKey(dbAdapter, oldKey, {
        owner: OWNER,
        name: 'bare',
        value: VALUE,
        ticket: first,
      });
      let { ticket: second } = await mintKeyWriteTicket(dbAdapter, OWNER);
      let bound = await addUserKey(dbAdapter, oldKey, {
        owner: OWNER,
        name: 'bound',
        value: NEW_VALUE,
        ticket: second,
        destination: DESTINATION,
      });

      // The old data key stays loaded; a new one becomes current.
      assert.strictEqual(
        (await sealedRow(dbAdapter, bare.id)).sealed.keyId,
        'rotation-old',
      );
      let during = new Keyring(
        [
          { keyId: 'rotation-old', key: Buffer.from(oldBytes) },
          { keyId: 'rotation-new', key: randomBytes(32) },
        ],
        'rotation-new',
      );
      let report = await resealUnderCurrentKey(dbAdapter, during, {
        columns: SEALED_COLUMNS.filter(
          (column) => column.field === USER_KEY_VALUE_FIELD,
        ),
      });
      assert.deepEqual(
        report.columns.map(({ field, resealed, unopenable }) => ({
          field,
          resealed,
          unopenable,
        })),
        [{ field: USER_KEY_VALUE_FIELD, resealed: 2, unopenable: 0 }],
        'both keys are re-sealed',
      );

      let bareRow = await sealedRow(dbAdapter, bare.id);
      assert.strictEqual(bareRow.sealed.keyId, 'rotation-new');
      assert.strictEqual(
        during.open(bareRow.sealed, bindingFor(OWNER, bare.id)),
        VALUE,
        'a key with no destination still opens without one',
      );
      let boundRow = await sealedRow(dbAdapter, bound.id);
      assert.strictEqual(boundRow.sealed.keyId, 'rotation-new');
      assert.strictEqual(
        during.open(boundRow.sealed, bindingFor(OWNER, bound.id, DESTINATION)),
        NEW_VALUE,
        'a key with a destination opens only with it',
      );
      assert.throws(
        () => during.open(boundRow.sealed, bindingFor(OWNER, bound.id)),
        SecretDecryptionError,
      );
    });

    test("the read-only role can't select either table", async function (assert) {
      // The role and its blanket grant as staging and production have them,
      // then the migration that withholds these tables.
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE readonly_role;
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
      );
      // A user that inherits the role and was also granted SELECT on the
      // tables directly.
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE readonly_member_for_user_keys_test;
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_member_for_user_keys_test`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE user_keys, key_write_tickets TO readonly_member_for_user_keys_test`,
      );
      let statements: string[] = [];
      require(USER_KEYS_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
      await addWithoutDestination();
      await mintKeyWriteTicket(dbAdapter, OWNER);

      async function selectAs(role: string, sql: string) {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }

      for (let role of [
        'readonly_role',
        'readonly_member_for_user_keys_test',
      ]) {
        for (let table of ['user_keys', 'key_write_tickets']) {
          await assert.rejects(
            selectAs(role, `SELECT * FROM ${table}`),
            new RegExp(`permission denied for table ${table}`),
            `${role} can't select ${table}`,
          );
        }
      }
      assert.deepEqual(
        await selectAs(
          'readonly_role',
          'SELECT COUNT(*) >= 0 AS readable FROM plans',
        ),
        [{ readable: true }],
        'the role keeps reading other tables',
      );
    });
  });
});
