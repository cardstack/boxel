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
import { secureSessionAuth } from './helpers/secure-session.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
  USER_KEY_VALUE_FIELD,
  type KeyWriteAction,
} from '../lib/user-keys.ts';
import { deserializeGoogleServiceAccount } from '../lib/outbound/google-service-account.ts';

const require = createRequire(import.meta.url);
const USER_KEYS_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1792100613068_add-user-keys.js',
);

const OWNER = '@key-owner:localhost';
const OTHER_USER = '@other-user:localhost';
const VALUE = 'sk-user-key-value-5b0e7c21d9';
const NEW_VALUE = 'sk-user-key-replacement-a41f93';

// A Google service account's JSON key file, with a real RSA key so the
// realm server can check it signs.
function serviceAccountKeyFile(clientEmail: string): {
  file: string;
  privateKey: string;
} {
  let privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return {
    privateKey,
    file: JSON.stringify({
      type: 'service_account',
      private_key_id: 'kid-1',
      private_key: privateKey,
      client_email: clientEmail,
    }),
  };
}
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const ADD_TICKET = {
  data: { type: 'key-write-ticket', attributes: { action: 'add' } },
};

async function sealedRow(
  dbAdapter: PgAdapter,
  id: string,
): Promise<{
  owner: string;
  sealed: SealedSecret;
}> {
  let [row] = await dbAdapter.execute(
    `SELECT owner,
            encode(value_ciphertext, 'base64') AS ciphertext,
            encode(value_nonce, 'base64') AS nonce,
            encode(value_tag, 'base64') AS tag,
            value_key_id
       FROM user_keys WHERE id = $1`,
    { bind: [id] },
  );
  return {
    owner: row.owner as string,
    sealed: {
      keyId: row.value_key_id as string,
      ciphertext: Buffer.from(row.ciphertext as string, 'base64'),
      nonce: Buffer.from(row.nonce as string, 'base64'),
      tag: Buffer.from(row.tag as string, 'base64'),
    },
  };
}

function bindingFor(owner: string, id: string): SecretBinding {
  return { field: USER_KEY_VALUE_FIELD, owner, id };
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

    // Key write tickets are minted only for a session signed in on the secure
    // origin.
    async function mint(attributes: Record<string, unknown>, user = OWNER) {
      return await request
        .post('/_key-write-tickets')
        .set('Authorization', await secureSessionAuth(dbAdapter, user))
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'key-write-ticket', attributes } });
    }

    // A ticket for an add, or for a replace or delete of `keyId`.
    async function ticketFor(
      action: KeyWriteAction = 'add',
      keyId?: string,
      user = OWNER,
    ): Promise<string> {
      let response = await mint({ action, keyId }, user);
      if (response.status !== 201) {
        throw new Error(
          `could not mint a ticket: ${response.status} ${response.text}`,
        );
      }
      return response.body.data.attributes.ticket;
    }

    async function remove(id: string, ticket: string, user = OWNER) {
      return await request
        .delete(`/_user-keys/${id}`)
        .set('Authorization', auth(user))
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket } });
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
        { ticket: await ticketFor('add', undefined, user) },
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
        ['createdAt', 'kind', 'name', 'state', 'updatedAt'],
        'the response carries metadata only',
      );
      assert.strictEqual(added.body.data.attributes.name, 'weather');
      assert.strictEqual(added.body.data.attributes.kind, 'static');
      assert.strictEqual(added.body.data.attributes.state, 'active');

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

      let replaced = await replace(
        id,
        NEW_VALUE,
        await ticketFor('replace', id),
      );
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

      let deleted = await remove(id, await ticketFor('delete', id));
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

      for (let action of ['replace', 'delete']) {
        let minted = await mint({ action, keyId: id }, OTHER_USER);
        assert.strictEqual(
          minted.status,
          404,
          `a ticket to ${action} it answers as for no key`,
        );
      }

      // Their own ticket names no key of theirs, so it spends on nothing here.
      let theirTicket = await ticketFor('add', undefined, OTHER_USER);
      let replaced = await replace(id, NEW_VALUE, theirTicket, OTHER_USER);
      assert.strictEqual(replaced.status, 403, 'replace is refused');
      let deleted = await remove(id, theirTicket, OTHER_USER);
      assert.strictEqual(deleted.status, 403, 'delete is refused');

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

      let theirs = await ticketFor('add', undefined, OTHER_USER);
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

    test('a ticket spends only on the change it was minted for', async function (assert) {
      let weather = await addKey('weather');
      let news = await addKey('news', OWNER, NEW_VALUE);

      let addTicket = await ticketFor('add');
      assert.strictEqual(
        (await replace(weather, NEW_VALUE, addTicket)).status,
        403,
        'a ticket to add a key replaces none',
      );
      assert.strictEqual(
        (await remove(weather, addTicket)).status,
        403,
        'nor deletes one',
      );

      let replaceWeather = await ticketFor('replace', weather);
      assert.strictEqual(
        (await replace(news, VALUE, replaceWeather)).status,
        403,
        'a ticket to replace one key replaces no other',
      );
      assert.strictEqual(
        (await remove(weather, replaceWeather)).status,
        403,
        'nor deletes the key it names',
      );
      assert.strictEqual(
        (await add({ name: 'maps', value: VALUE }, { ticket: replaceWeather }))
          .status,
        403,
        'nor adds a key',
      );

      let deleteWeather = await ticketFor('delete', weather);
      assert.strictEqual(
        (await remove(news, deleteWeather)).status,
        403,
        'a ticket to delete one key deletes no other',
      );
      assert.strictEqual(
        (await replace(weather, NEW_VALUE, deleteWeather)).status,
        403,
        'nor replaces the key it names',
      );

      let row = await sealedRow(dbAdapter, news);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, news)),
        NEW_VALUE,
        'the refused changes changed nothing',
      );

      assert.strictEqual(
        (await add({ name: 'maps', value: VALUE }, { ticket: addTicket }))
          .status,
        201,
        'a refused use leaves each ticket good for its own change',
      );
      assert.strictEqual(
        (await replace(weather, NEW_VALUE, replaceWeather)).status,
        200,
      );
      assert.strictEqual((await remove(weather, deleteWeather)).status, 204);
    });

    test('a ticket names its change', async function (assert) {
      let id = await addKey();
      for (let [attributes, why] of [
        [{}, 'no action'],
        [{ action: 'rotate' }, 'an unknown action'],
        [{ action: 'add', keyId: id }, 'an add that names a key'],
        [{ action: 'replace' }, 'a replace that names no key'],
        [{ action: 'delete' }, 'a delete that names no key'],
      ] as const) {
        let response = await mint(attributes);
        assert.strictEqual(response.status, 400, `${why} is refused`);
      }
      let unknownKey = await mint({
        action: 'delete',
        keyId: '00000000-0000-4000-8000-000000000001',
      });
      assert.strictEqual(unknownKey.status, 404, 'a key that does not exist');
      let tickets = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM key_write_tickets`,
      );
      assert.strictEqual(tickets[0].count, 0, 'no ticket was minted');
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
      // A session signed in on the secure origin, so only where the request
      // comes from decides.
      let secureAuth = await secureSessionAuth(dbAdapter, OWNER);
      let fromApp = await request
        .post('/_key-write-tickets')
        .set('Authorization', secureAuth)
        .set('Origin', 'https://app.keys.test')
        .set('Content-Type', 'application/json')
        .send(ADD_TICKET);
      assert.strictEqual(fromApp.status, 403, 'the app page is refused');
      assert.strictEqual(
        fromApp.body.data,
        undefined,
        'no ticket is returned to it',
      );

      let opaque = await request
        .post('/_key-write-tickets')
        .set('Authorization', secureAuth)
        .set('Origin', 'null')
        .set('Content-Type', 'application/json')
        .send(ADD_TICKET);
      assert.strictEqual(opaque.status, 403, 'an opaque origin is refused');

      let fromSecureOrigin = await request
        .post('/_key-write-tickets')
        .set('Authorization', secureAuth)
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send(ADD_TICKET);
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

      let fromCLI = await mint({ action: 'add' });
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

      let anonymous = await request
        .post('/_key-write-tickets')
        .set('Content-Type', 'application/json')
        .send(ADD_TICKET);
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
          .set('Authorization', auth(OWNER, claims))
          .set('Content-Type', 'application/json')
          .send(ADD_TICKET);
        assert.strictEqual(minted.status, status, `${kind} mints no ticket`);
        let listed = await request
          .get('/_user-keys')
          .set('Authorization', auth(OWNER, claims));
        assert.strictEqual(listed.status, status, `${kind} lists no key`);
      }
    });

    test('a Google service account is added from its key file, subject and scopes, and sealed as one value', async function (assert) {
      let { file, privateKey } = serviceAccountKeyFile(
        'sheets-bot@boxel-test.iam.gserviceaccount.com',
      );
      let added = await add(
        {
          name: 'sheets',
          kind: 'google-service-account',
          value: file,
          subject: 'owner@example.com',
          scopes: [SHEETS_SCOPE],
        },
        { ticket: await ticketFor() },
      );
      assert.strictEqual(added.status, 201, added.text);
      assert.strictEqual(
        added.body.data.attributes.kind,
        'google-service-account',
      );
      let pemLine = privateKey.split('\n')[1];
      assert.false(added.text.includes(pemLine), 'the answer carries no key');
      let id = added.body.data.id as string;
      let row = await sealedRow(dbAdapter, id);
      assert.deepEqual(
        deserializeGoogleServiceAccount(
          keyring.open(row.sealed, bindingFor(OWNER, id)),
        ),
        {
          clientEmail: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
          privateKeyId: 'kid-1',
          privateKey,
          subject: 'owner@example.com',
          scopes: [SHEETS_SCOPE],
        },
      );

      let next = serviceAccountKeyFile(
        'sheets-bot@boxel-test.iam.gserviceaccount.com',
      );
      let replaced = await request
        .patch(`/_user-keys/${id}`)
        .set('Authorization', auth())
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'user-key',
            id,
            attributes: { value: next.file, scopes: ['openid', SHEETS_SCOPE] },
          },
          meta: { ticket: await ticketFor('replace', id) },
        });
      assert.strictEqual(replaced.status, 200, replaced.text);
      let reopened = deserializeGoogleServiceAccount(
        keyring.open(
          (await sealedRow(dbAdapter, id)).sealed,
          bindingFor(OWNER, id),
        ),
      );
      assert.strictEqual(reopened.privateKey, next.privateKey);
      assert.strictEqual(
        reopened.subject,
        null,
        'a replace sets the subject anew',
      );
      assert.deepEqual(reopened.scopes, ['openid', SHEETS_SCOPE]);
    });

    test('a service account’s email, subject and scopes are listed and shown beside it, never its key file', async function (assert) {
      let { file, privateKey } = serviceAccountKeyFile(
        'sheets-bot@boxel-test.iam.gserviceaccount.com',
      );
      let added = await add(
        {
          name: 'sheets',
          kind: 'google-service-account',
          value: file,
          subject: 'owner@example.com',
          scopes: [SHEETS_SCOPE, 'openid'],
        },
        { ticket: await ticketFor() },
      );
      assert.strictEqual(added.status, 201, added.text);
      let id = added.body.data.id as string;
      await addKey('weather');
      let details = {
        email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
        subject: 'owner@example.com',
        scopes: [SHEETS_SCOPE, 'openid'],
      };
      assert.deepEqual(
        added.body.data.attributes.serviceAccount,
        details,
        'the answer to the add carries them',
      );

      let pemLine = privateKey.split('\n')[1];
      let listed = await request
        .get('/_user-keys')
        .set('Authorization', auth());
      assert.strictEqual(listed.status, 200, listed.text);
      let [sheets, weather] = listed.body.data;
      assert.strictEqual(sheets.attributes.name, 'sheets');
      assert.deepEqual(sheets.attributes.serviceAccount, details, 'listed');
      assert.strictEqual(weather.attributes.name, 'weather');
      assert.false(
        'serviceAccount' in weather.attributes,
        'a static key has none',
      );
      let shown = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth());
      assert.strictEqual(shown.status, 200, shown.text);
      assert.deepEqual(shown.body.data.attributes.serviceAccount, details);
      for (let [name, response] of [
        ['add', added],
        ['listing', listed],
        ['show', shown],
      ] as const) {
        assert.false(response.text.includes(pemLine), `${name}: no key`);
        assert.false(
          response.text.includes('kid-1'),
          `${name}: nor the key's id`,
        );
      }

      let next = serviceAccountKeyFile(
        'reports-bot@boxel-test.iam.gserviceaccount.com',
      );
      let replaced = await request
        .patch(`/_user-keys/${id}`)
        .set('Authorization', auth())
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'user-key',
            id,
            attributes: { value: next.file, scopes: [SHEETS_SCOPE] },
          },
          meta: { ticket: await ticketFor('replace', id) },
        });
      assert.strictEqual(replaced.status, 200, replaced.text);
      let replacedDetails = {
        email: 'reports-bot@boxel-test.iam.gserviceaccount.com',
        subject: null,
        scopes: [SHEETS_SCOPE],
      };
      assert.deepEqual(
        replaced.body.data.attributes.serviceAccount,
        replacedDetails,
        'a replace sets them anew',
      );
      let reshown = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth());
      assert.deepEqual(
        reshown.body.data.attributes.serviceAccount,
        replacedDetails,
      );
      assert.false(reshown.text.includes(next.privateKey.split('\n')[1]));
    });

    test('a service account’s details are not shown once its value is sealed without them', async function (assert) {
      let { file } = serviceAccountKeyFile(
        'sheets-bot@boxel-test.iam.gserviceaccount.com',
      );
      let added = await add(
        {
          name: 'sheets',
          kind: 'google-service-account',
          value: file,
          subject: 'owner@example.com',
          scopes: [SHEETS_SCOPE],
        },
        { ticket: await ticketFor() },
      );
      assert.strictEqual(added.status, 201, added.text);
      let id = added.body.data.id as string;
      // What a revision that seals a new value without writing the details
      // leaves behind: `updated_at` moves, the details stay as they were.
      await dbAdapter.execute(
        `UPDATE user_keys SET updated_at = updated_at + interval '1 second' WHERE id = $1`,
        { bind: [id] },
      );
      let shown = await request
        .get(`/_user-keys/${id}`)
        .set('Authorization', auth());
      assert.strictEqual(shown.status, 200, shown.text);
      assert.false(
        'serviceAccount' in shown.body.data.attributes,
        'details written for an earlier value are not shown',
      );
      let listed = await request
        .get('/_user-keys')
        .set('Authorization', auth());
      assert.false('serviceAccount' in listed.body.data[0].attributes);
    });

    test('a key file, subject or scopes a service account can’t use are refused, and leave the ticket unspent', async function (assert) {
      let { file, privateKey } = serviceAccountKeyFile(
        'sheets-bot@boxel-test.iam.gserviceaccount.com',
      );
      let ticket = await ticketFor();
      let cases: [string, Record<string, unknown>, RegExp][] = [
        [
          'not a key file',
          { value: file.slice(0, 200), scopes: [SHEETS_SCOPE] },
          /not valid JSON/,
        ],
        [
          'another kind of file',
          {
            value: JSON.stringify({ type: 'authorized_user' }),
            scopes: [SHEETS_SCOPE],
          },
          /not a service account key file/,
        ],
        ['no scopes', { value: file }, /at least one scope/],
        [
          'a subject that is not an email address',
          { value: file, subject: 'owner', scopes: [SHEETS_SCOPE] },
          /email address/,
        ],
      ];
      for (let [name, attributes, message] of cases) {
        let response = await add(
          { name: 'sheets', kind: 'google-service-account', ...attributes },
          { ticket },
        );
        assert.strictEqual(response.status, 400, name);
        assert.true(message.test(response.text), `${name}: ${response.text}`);
        assert.false(
          response.text.includes(privateKey.split('\n')[1]),
          `${name}: the refusal quotes none of the key`,
        );
      }
      let staticWithScopes = await add(
        { name: 'weather', value: VALUE, scopes: [SHEETS_SCOPE] },
        { ticket },
      );
      assert.strictEqual(staticWithScopes.status, 400);
      assert.true(
        /only a google-service-account key takes a subject or scopes/.test(
          staticWithScopes.text,
        ),
      );
      let keyFileAsStatic = await add(
        { name: 'sheets', value: file },
        { ticket },
      );
      assert.strictEqual(
        keyFileAsStatic.status,
        400,
        'a key file is never stored as a key sent as it is',
      );
      assert.true(
        /add it as a google-service-account key/.test(keyFileAsStatic.text),
        keyFileAsStatic.text,
      );
      let added = await add(
        {
          name: 'sheets',
          kind: 'google-service-account',
          value: file,
          scopes: [SHEETS_SCOPE],
        },
        { ticket },
      );
      assert.strictEqual(added.status, 201, 'the ticket is still good');
    });

    test('an add sets only a name, a kind and a value', async function (assert) {
      for (let attribute of ['destination', 'state', 'id']) {
        let response = await add(
          { name: 'weather', value: VALUE, [attribute]: 'x' },
          { ticket: await ticketFor() },
        );
        assert.strictEqual(response.status, 400, `'${attribute}' is refused`);
      }
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

    async function addDirectly(name = 'weather', sealWith = keyring) {
      let { ticket } = await mintKeyWriteTicket(dbAdapter, OWNER, {
        action: 'add',
        keyId: null,
        realmURL: null,
        shareId: null,
      });
      return await addUserKey(dbAdapter, sealWith, {
        owner: OWNER,
        name,
        value: VALUE,
        ticket,
      });
    }

    test('a value opens only for its own owner and row', async function (assert) {
      let key = await addDirectly();
      let other = await addDirectly('news');
      let row = await sealedRow(dbAdapter, key.id);
      assert.strictEqual(
        keyring.open(row.sealed, bindingFor(OWNER, key.id)),
        VALUE,
        'it opens bound to field, owner and id',
      );
      assert.throws(
        () => keyring.open(row.sealed, bindingFor(OTHER_USER, key.id)),
        SecretDecryptionError,
        'not for another owner',
      );
      assert.throws(
        () => keyring.open(row.sealed, bindingFor(OWNER, other.id)),
        SecretDecryptionError,
        'nor as another row',
      );
    });

    test('rotating the data key re-seals every key', async function (assert) {
      let oldBytes = randomBytes(32);
      let oldKey = new Keyring(
        [{ keyId: 'rotation-old', key: Buffer.from(oldBytes) }],
        'rotation-old',
      );
      let first = await addDirectly('weather', oldKey);
      let second = await addDirectly('news', oldKey);

      // The old data key stays loaded; a new one becomes current.
      assert.strictEqual(
        (await sealedRow(dbAdapter, first.id)).sealed.keyId,
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

      for (let key of [first, second]) {
        let row = await sealedRow(dbAdapter, key.id);
        assert.strictEqual(row.sealed.keyId, 'rotation-new');
        assert.strictEqual(
          during.open(row.sealed, bindingFor(OWNER, key.id)),
          VALUE,
          'it opens under its own binding',
        );
        assert.throws(
          () => during.open(row.sealed, bindingFor(OTHER_USER, key.id)),
          SecretDecryptionError,
        );
      }
    });

    test("the migration leaves the owner's own privileges when the owner administers the read-only role", async function (assert) {
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
      // As Postgres 16 makes a role with CREATEROLE that creates the
      // read-only role: a member with ADMIN alone, neither inheriting nor
      // able to SET ROLE to it. Here that role owns both tables.
      const OWNER = 'admin_owner_for_user_keys_test';
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE ${OWNER};
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(`ALTER TABLE user_keys OWNER TO ${OWNER}`);
      await dbAdapter.execute(
        `ALTER TABLE key_write_tickets OWNER TO ${OWNER}`,
      );
      await dbAdapter.execute(
        `GRANT readonly_role TO ${OWNER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
      );
      try {
        let ownerSelects = async () => {
          return await dbAdapter.execute(
            `SELECT tbl.relname::text AS table_name
             FROM pg_class tbl
             CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
             WHERE tbl.relname IN ('user_keys', 'key_write_tickets')
               AND acl.grantee = tbl.relowner
               AND acl.privilege_type = 'SELECT'
             ORDER BY 1`,
          );
        };
        let before = await ownerSelects();
        assert.deepEqual(before, [
          { table_name: 'key_write_tickets' },
          { table_name: 'user_keys' },
        ]);

        let statements: string[] = [];
        require(USER_KEYS_MIGRATION).up({
          sql: (statement: string) => statements.push(statement),
        });
        for (let statement of statements) {
          await dbAdapter.execute(statement);
        }

        assert.deepEqual(await ownerSelects(), before);
      } finally {
        await dbAdapter.execute(`REVOKE readonly_role FROM ${OWNER}`);
      }
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
      async function grantAs(role: string, sql: string) {
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          await query([sql]);
        });
      }
      // A user that inherits the role and was also granted SELECT on the
      // tables directly, with the right to grant it on, which it used to pass
      // SELECT on to a role outside the read-only role.
      await createRole('readonly_member_for_user_keys_test');
      await createRole('recipient_for_user_keys_test');
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_member_for_user_keys_test`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE user_keys, key_write_tickets TO readonly_member_for_user_keys_test WITH GRANT OPTION`,
      );
      await grantAs(
        'readonly_member_for_user_keys_test',
        `GRANT SELECT ON TABLE user_keys, key_write_tickets TO recipient_for_user_keys_test`,
      );
      // A user that inherits the role and was granted SELECT on a column of
      // each table by that member, from its table grant.
      await createRole('readonly_column_recipient_for_user_keys_test');
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_column_recipient_for_user_keys_test`,
      );
      for (let table of ['user_keys', 'key_write_tickets']) {
        await grantAs(
          'readonly_member_for_user_keys_test',
          `GRANT SELECT (owner) ON TABLE ${table} TO readonly_column_recipient_for_user_keys_test`,
        );
      }
      // A user that inherits the role and was granted SELECT on the tables by
      // a role other than their owner.
      await createRole('readonly_delegated_member_for_user_keys_test');
      await createRole('delegator_for_user_keys_test');
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_delegated_member_for_user_keys_test`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE user_keys, key_write_tickets TO delegator_for_user_keys_test WITH GRANT OPTION`,
      );
      await grantAs(
        'delegator_for_user_keys_test',
        `GRANT SELECT ON TABLE user_keys, key_write_tickets TO readonly_delegated_member_for_user_keys_test`,
      );
      // A user that reaches the role through another role, and was granted
      // SELECT on the tables directly.
      await createRole('readonly_group_for_user_keys_test');
      await createRole('readonly_group_member_for_user_keys_test');
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_group_for_user_keys_test`,
      );
      await dbAdapter.execute(
        `GRANT readonly_group_for_user_keys_test TO readonly_group_member_for_user_keys_test`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE user_keys, key_write_tickets TO readonly_group_member_for_user_keys_test`,
      );
      let statements: string[] = [];
      require(USER_KEYS_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
      await addDirectly();
      await mintKeyWriteTicket(dbAdapter, OWNER, {
        action: 'add',
        keyId: null,
        realmURL: null,
        shareId: null,
      });

      async function selectAs(role: string, sql: string) {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }

      for (let role of [
        'readonly_role',
        'readonly_member_for_user_keys_test',
        'readonly_column_recipient_for_user_keys_test',
        'readonly_delegated_member_for_user_keys_test',
        'readonly_group_member_for_user_keys_test',
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
