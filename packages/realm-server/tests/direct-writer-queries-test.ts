import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  fetchDirectWriters,
  insertPermissions,
  isDirectWriter,
  isRealmAdministrator,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A direct writer of a realm is a person whose own permission row grants
// `write`. Wildcard rows, bot accounts and policy grants admit writes without
// making anyone a direct writer.
module(basename(import.meta.filename), function () {
  module('permission rows', function (hooks) {
    let dbAdapter: PgAdapter;
    const realmURL = new URL('http://127.0.0.1:4444/test/');
    const otherRealmURL = new URL('http://127.0.0.1:4444/other/');

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    test('a user whose own row grants write is a direct writer', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@owner:localhost': ['read', 'write', 'realm-owner'],
        '@writer:localhost': ['read', 'write'],
        '@reader:localhost': ['read'],
      });

      assert.true(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@owner:localhost',
          'localhost',
        ),
      );
      assert.true(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@writer:localhost',
          'localhost',
        ),
      );
      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@reader:localhost',
          'localhost',
        ),
        'a read-only row does not count',
      );
      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@stranger:localhost',
          'localhost',
        ),
        'a user with no row does not count',
      );
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        ['@owner:localhost', '@writer:localhost'],
      );
    });

    test('`*` and `users` rows that grant write make no one a direct writer', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@owner:localhost': ['read', 'write', 'realm-owner'],
        '*': ['read', 'write'],
        users: ['read', 'write'],
      });

      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@anyone:localhost',
          'localhost',
        ),
        'a user the wildcard rows grant write is not a direct writer',
      );
      assert.false(await isDirectWriter(dbAdapter, realmURL, '*', 'localhost'));
      assert.false(
        await isDirectWriter(dbAdapter, realmURL, 'users', 'localhost'),
      );
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        ['@owner:localhost'],
      );
    });

    test('a bot account with a write row is not a direct writer', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@owner:localhost': ['read', 'write', 'realm-owner'],
        '@realm/test:localhost': ['read', 'write', 'realm-owner'],
        '@aibot:localhost': ['read', 'write'],
        '@submissionbot:localhost': ['read', 'write'],
        '@skills_realm:localhost': ['read', 'write', 'realm-owner'],
        '@skills_writer:localhost': ['read', 'write'],
      });

      for (let bot of [
        '@realm/test:localhost',
        '@aibot:localhost',
        '@submissionbot:localhost',
        '@skills_realm:localhost',
        '@skills_writer:localhost',
      ]) {
        assert.false(
          await isDirectWriter(dbAdapter, realmURL, bot, 'localhost'),
          `${bot} is not a direct writer`,
        );
      }
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        ['@owner:localhost'],
      );
    });

    test('an account on another homeserver named like a bot is a direct writer', async function (assert) {
      // The platform's service accounts all live on the paired homeserver, so
      // a user elsewhere is a person whatever they are called.
      await insertPermissions(dbAdapter, realmURL, {
        '@skills_realm:other.example': ['read', 'write'],
        '@aibot:other.example': ['read', 'write'],
        '@skills_realm:localhost': ['read', 'write'],
      });

      assert.true(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@skills_realm:other.example',
          'localhost',
        ),
      );
      assert.true(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@aibot:other.example',
          'localhost',
        ),
      );
      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@skills_realm:localhost',
          'localhost',
        ),
        'the same name on the paired homeserver is the bot',
      );
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        ['@aibot:other.example', '@skills_realm:other.example'],
      );
    });

    test('a removed row stops counting', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@owner:localhost': ['read', 'write', 'realm-owner'],
        '@writer:localhost': ['read', 'write'],
      });
      assert.true(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@writer:localhost',
          'localhost',
        ),
      );

      await insertPermissions(dbAdapter, realmURL, {
        '@writer:localhost': [],
      });

      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@writer:localhost',
          'localhost',
        ),
      );
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        ['@owner:localhost'],
      );
    });

    test('a row that drops write stops counting', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@writer:localhost': ['read', 'write'],
      });

      await insertPermissions(dbAdapter, realmURL, {
        '@writer:localhost': ['read'],
      });

      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@writer:localhost',
          'localhost',
        ),
      );
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        [],
      );
    });

    test('a write row in another realm does not count', async function (assert) {
      await insertPermissions(dbAdapter, otherRealmURL, {
        '@writer:localhost': ['read', 'write'],
      });
      await insertPermissions(dbAdapter, realmURL, {
        '@owner:localhost': ['read', 'write', 'realm-owner'],
      });

      assert.false(
        await isDirectWriter(
          dbAdapter,
          realmURL,
          '@writer:localhost',
          'localhost',
        ),
      );
      assert.deepEqual(
        await fetchDirectWriters(dbAdapter, realmURL, 'localhost'),
        ['@owner:localhost'],
      );
    });
  });

  // Administering a realm is direct write, with one addition: a service
  // account administers a realm it created under its own name.
  module('administering', function () {
    const realmServerURL = new URL('http://127.0.0.1:4444/');
    const bot = '@submissionbot:localhost';
    const botWrite: RealmPermissions = { [bot]: ['read', 'write'] };

    function administers(
      permissions: RealmPermissions,
      userId: string,
      realmURL: string,
      serverURL = realmServerURL,
    ) {
      return isRealmAdministrator(
        permissions,
        userId,
        'localhost',
        new URL(realmURL),
        serverURL,
      );
    }

    test('a person whose own row grants write administers the realm', function (assert) {
      let permissions: RealmPermissions = {
        '@writer:localhost': ['read', 'write'],
        '@reader:localhost': ['read'],
        users: ['read', 'write'],
      };
      let realmURL = 'http://127.0.0.1:4444/mango/shared/';
      assert.true(administers(permissions, '@writer:localhost', realmURL));
      assert.false(administers(permissions, '@reader:localhost', realmURL));
      assert.false(
        administers(permissions, 'users', realmURL),
        'a wildcard row names no one',
      );
      assert.false(
        administers(permissions, '@stranger:localhost', realmURL),
        'no row, no authority',
      );
    });

    test('a service account administers a realm under its own name', function (assert) {
      assert.true(
        administers(botWrite, bot, 'http://127.0.0.1:4444/submissionbot/pr-1/'),
      );
      assert.true(
        administers(
          botWrite,
          bot,
          'http://127.0.0.1:4444/realms/submissionbot/pr-1/',
          new URL('http://127.0.0.1:4444/realms/'),
        ),
        'on a realm server mounted under a path',
      );
    });

    test('a service account with write on a realm it did not create does not administer it', function (assert) {
      for (let [realmURL, what] of [
        ['http://127.0.0.1:4444/mango/shared/', 'a realm another user created'],
        ['http://127.0.0.1:4444/submissions/', 'a bootstrap realm'],
        [
          'http://127.0.0.1:4444/submissionbot/',
          'a realm merely named after the account',
        ],
        [
          'http://127.0.0.1:4444/experiments/submissionbot/pr-1/',
          'a realm nested under another path',
        ],
        [
          'http://127.0.0.1:4444/submissionbot/pr-1/nested/',
          'a realm below one it could create',
        ],
        ['http://other.example/submissionbot/pr-1/', 'a realm on another host'],
        [
          'http://127.0.0.1:4444/submissionbot/PR_1/',
          'an endpoint the realm server would not create',
        ],
      ]) {
        assert.false(administers(botWrite, bot, realmURL), what);
      }
    });

    test('a service account needs its own write row even under its own name', function (assert) {
      let realmURL = 'http://127.0.0.1:4444/submissionbot/pr-1/';
      assert.false(
        administers({ [bot]: ['read'] }, bot, realmURL),
        'a read row',
      );
      assert.false(
        administers({ users: ['read', 'write'] }, bot, realmURL),
        'a wildcard write row',
      );
    });

    test("one service account does not administer a realm under another service account's name", function (assert) {
      assert.false(
        administers(
          { '@aibot:localhost': ['read', 'write'] },
          '@aibot:localhost',
          'http://127.0.0.1:4444/submissionbot/pr-1/',
        ),
      );
    });
  });

  module('a policy grant', function (hooks) {
    // The Open realm's policy grants every card write outright, so a user
    // with no permission row there can still write its cards.
    const OPEN = 'http://127.0.0.1:4444/open/';
    const OPEN_POLICY_CARD = `${OPEN}policies/open`;
    const OPEN_NOTE = `${OPEN}notes/n1`;
    const ADMIN = '@open-admin:localhost';
    const EDITOR = '@editor:localhost';
    const REALM_POLICY = {
      module: rri('@cardstack/catalog/realm-policy/realm-policy'),
      name: 'RealmPolicy',
    };
    const CARD_DEF = {
      module: rri('@cardstack/base/card-api'),
      name: 'CardDef',
    };

    let open: Realm;
    let request: SuperTest<Test>;
    let server: Server;
    let db: PgAdapter;

    setupCatalogTestSubset(hooks);

    async function start({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      db = dbAdapter;
      let result = await runTestRealmServerWithRealms({
        virtualNetwork: createVirtualNetwork(),
        realmsRootPath: join(dirSync().name, 'realm_server_1'),
        realms: [
          {
            realmURL: new URL(OPEN),
            fileSystem: {
              'realm.json': realmConfigCardJSON({
                name: 'Open',
                policy: OPEN_POLICY_CARD,
              }),
              'policies/open.json': JSON.stringify({
                data: {
                  type: 'card',
                  attributes: {
                    rules: [
                      {
                        targetType: CARD_DEF,
                        grants: [
                          { operation: 'create' },
                          { operation: 'update' },
                          { operation: 'delete' },
                        ],
                      },
                    ],
                  },
                  meta: { adoptsFrom: REALM_POLICY },
                },
              }),
              'notes/n1.json': JSON.stringify({
                data: {
                  type: 'card',
                  attributes: { cardInfo: { name: 'A note' } },
                  meta: { adoptsFrom: CARD_DEF },
                },
              }),
            },
            permissions: {
              [ADMIN]: ['read', 'write', 'realm-owner'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });
      server = result.testRealmHttpServer;
      request = supertest(server);
      open = result.realms.find((realm) => realm.url === OPEN)!;
    }

    async function stop() {
      open.__testOnlyClearCaches();
      open.unsubscribe();
      await closeServer(server);
      resetCatalogRealms();
    }

    // The realm `start` brings up is indexed once, into a template database
    // each test starts from, rather than from scratch before each test.
    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async (args) => {
        await start(args);
        return stop;
      },
    });

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (dbAdapter, publisher, runner) => {
        await start({ dbAdapter, publisher, runner });
      },
      afterEach: stop,
    });

    test('a user a policy lets write is not a direct writer', async function (assert) {
      let patched = await request
        .patch(new URL(OPEN_NOTE).pathname)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${createJWT(open, EDITOR, [])}`)
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Renamed' } },
              meta: { adoptsFrom: CARD_DEF },
            },
          }),
        );
      assert.strictEqual(patched.status, 200, 'the policy admits the write');

      assert.false(
        await isDirectWriter(db, new URL(OPEN), EDITOR, 'localhost'),
      );
      assert.deepEqual(
        await fetchDirectWriters(db, new URL(OPEN), 'localhost'),
        [ADMIN],
      );
    });
  });
});
