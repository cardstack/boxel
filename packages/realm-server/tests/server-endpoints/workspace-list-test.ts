import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
import { dirSync } from 'tmp';
import { v4 as uuidv4 } from 'uuid';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertPermissions,
  SupportedMimeType,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import {
  closeServer,
  createVirtualNetwork,
  ensureMatrixAdminUser,
  fixtureDir,
  matrixURL,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
} from '../helpers/index.ts';
import {
  registerListUser,
  setWorkspaceListOf,
  workspaceListOf,
} from '../helpers/workspace-list.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmURLFor } from '../../handlers/create-realm.ts';
import type { RealmHttpServer as Server } from '../../server.ts';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';

const { copySync, ensureDirSync, existsSync } = fsExtra;

// A workspace that isn't on this server, so a list that names it shows the
// server's edits keep what they didn't make.
const OTHER_WORKSPACE = 'https://elsewhere.example/someone/other/';

function bearer(user: string) {
  return `Bearer ${createRealmServerJWT(
    { user, sessionRoom: 'session-room-test' },
    realmSecretSeed,
  )}`;
}

function createRealm(
  request: supertest.SuperTest<supertest.Test>,
  user: string,
  endpoint: string,
) {
  return request
    .post('/_create-realm')
    .set('Accept', SupportedMimeType.JSONAPI)
    .set('Content-Type', 'application/json')
    .set('Authorization', bearer(user))
    .send(
      JSON.stringify({
        data: { type: 'realm', attributes: { name: 'Listed', endpoint } },
      }),
    );
}

function deleteRealm(
  request: supertest.SuperTest<supertest.Test>,
  user: string,
  realmURL: string,
) {
  return request
    .delete('/_delete-realm')
    .set('Accept', SupportedMimeType.JSONAPI)
    .set('Content-Type', 'application/json')
    .set('Authorization', bearer(user))
    .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));
}

function read(
  request: supertest.SuperTest<supertest.Test>,
  path: '/_user-realms' | '/_user-display-name',
  user: string,
) {
  return request
    .get(path)
    .set('Accept', SupportedMimeType.JSONAPI)
    .set('Authorization', bearer(user));
}

async function registryHas(dbAdapter: PgAdapter, realmURL: string) {
  let rows = (await dbAdapter.execute(
    `SELECT url FROM realm_registry WHERE url = $1`,
    { bind: [realmURL] },
  )) as { url: string }[];
  return rows.length > 0;
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('a user’s workspace list', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    hooks.before(async function () {
      await ensureMatrixAdminUser();
    });

    test('creating a workspace adds it to its owner’s list, and deleting it takes it off', async function (assert) {
      let owner = await registerListUser('list-owner');
      await setWorkspaceListOf(owner, [OTHER_WORKSPACE]);

      let created = await createRealm(
        context.request,
        owner.userId,
        `listed-${uuidv4()}`,
      );
      assert.strictEqual(created.status, 202, created.text);
      let realmURL = created.body.data.id as string;
      assert.deepEqual(
        await workspaceListOf(owner),
        [OTHER_WORKSPACE, realmURL],
        'the new workspace is on the list once it is created',
      );

      let deleted = await deleteRealm(context.request, owner.userId, realmURL);
      assert.strictEqual(deleted.status, 204, deleted.text);
      assert.deepEqual(
        await workspaceListOf(owner),
        [OTHER_WORKSPACE],
        'the deleted workspace is off the list, and the rest stays',
      );
    });

    test('creating a workspace that is already the caller’s puts it back on their list', async function (assert) {
      let owner = await registerListUser('list-relink');
      let endpoint = `relink-${uuidv4()}`;
      let created = await createRealm(context.request, owner.userId, endpoint);
      assert.strictEqual(created.status, 202, created.text);
      let realmURL = created.body.data.id as string;
      await setWorkspaceListOf(owner, []);

      let again = await createRealm(context.request, owner.userId, endpoint);
      assert.strictEqual(again.status, 400, again.text);
      assert.true(
        again.text.includes(`realm '${realmURL}' already exists`),
        'the answer still says the realm exists, as boxel-cli expects',
      );
      assert.deepEqual(await workspaceListOf(owner), [realmURL]);
    });

    test('a user with no Matrix account can still create and delete a workspace', async function (assert) {
      let user = `@no-account-${uuidv4()}:localhost`;
      let created = await createRealm(
        context.request,
        user,
        `unlisted-${uuidv4()}`,
      );
      assert.strictEqual(created.status, 202, created.text);
      let deleted = await deleteRealm(
        context.request,
        user,
        created.body.data.id,
      );
      assert.strictEqual(deleted.status, 204, deleted.text);
    });

    test('GET /_user-realms answers the caller’s own list', async function (assert) {
      let alice = await registerListUser('list-alice');
      let bob = await registerListUser('list-bob');
      await setWorkspaceListOf(alice, [OTHER_WORKSPACE]);
      await setWorkspaceListOf(bob, []);

      let response = await read(context.request, '/_user-realms', alice.userId);
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data, {
        type: 'user-realms',
        id: alice.userId,
        attributes: { realms: [OTHER_WORKSPACE] },
      });

      let bobs = await read(context.request, '/_user-realms', bob.userId);
      assert.deepEqual(
        bobs.body.data.attributes.realms,
        [],
        'bob sees his own',
      );
    });

    test('GET /_user-display-name answers the caller’s display name', async function (assert) {
      let user = await registerListUser('list-name');
      let response = await read(
        context.request,
        '/_user-display-name',
        user.userId,
      );
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data, {
        type: 'user-display-name',
        id: user.userId,
        attributes: { displayName: user.displayName },
      });
    });

    test('a user with no Matrix account has no list or display name here', async function (assert) {
      let user = `@no-account-${uuidv4()}:localhost`;
      for (let path of ['/_user-realms', '/_user-display-name'] as const) {
        let response = await read(context.request, path, user);
        assert.strictEqual(response.status, 404, `${path}: ${response.text}`);
      }
    });
  });

  // A server whose Synapse admin login fails: no list can be read or edited,
  // so a create or delete either completes with its list edit or not at all.
  module('when the workspace list can’t be edited', function (hooks) {
    let server: Server | undefined;
    let realmsRootPath: string;
    let dbAdapter: PgAdapter;

    async function start({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      realmsRootPath = join(dirSync().name, 'realm_server_workspace_list');
      let testRealmDir = join(realmsRootPath, 'test');
      ensureDirSync(testRealmDir);
      copySync(fixtureDir('blank'), testRealmDir);
      let { testRealmHttpServer } = await runTestRealmServer({
        virtualNetwork: createVirtualNetwork(),
        testRealmDir,
        realmsRootPath,
        realmURL: testRealmURL,
        permissions: { '*': ['read'] },
        dbAdapter,
        publisher,
        runner,
        matrixURL,
        // An admin the homeserver doesn't have, so every admin login fails.
        matrixAdmin: {
          username: `no-such-admin-${uuidv4().slice(0, 8)}`,
          password: 'password',
        },
      });
      return testRealmHttpServer;
    }

    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: `${import.meta.filename}#no-admin`,
      build: async (args) => {
        let built = await start(args);
        return () => closeServer(built);
      },
    });
    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (db, publisher, runner) => {
        dbAdapter = db;
        server = await start({ dbAdapter: db, publisher, runner });
      },
      afterEach: async () => {
        if (server) {
          await closeServer(server);
          server = undefined;
        }
      },
    });

    hooks.before(async function () {
      await ensureMatrixAdminUser();
    });

    test('a create whose list edit fails is undone', async function (assert) {
      let owner = await registerListUser('list-undone');
      await setWorkspaceListOf(owner, [OTHER_WORKSPACE]);
      let endpoint = `undone-${uuidv4()}`;
      let realmURL = realmURLFor(
        new URL(testRealmURL.origin),
        owner.userId,
        endpoint,
      );

      let response = await createRealm(
        supertest(server!),
        owner.userId,
        endpoint,
      );
      assert.strictEqual(response.status, 503, response.text);
      assert.false(
        await registryHas(dbAdapter, realmURL),
        'the realm is not registered',
      );
      assert.false(
        existsSync(
          join(realmsRootPath, getMatrixUsername(owner.userId), endpoint),
        ),
        'its files are gone',
      );
      assert.deepEqual(await workspaceListOf(owner), [OTHER_WORKSPACE]);
    });

    test('a delete whose list edit fails deletes nothing', async function (assert) {
      let request = supertest(server!);
      // A user of another homeserver has no list here, so their create needs
      // no list edit; the local administrator's delete does.
      let creator = `@remote-${uuidv4()}:elsewhere.example`;
      let created = await createRealm(request, creator, `kept-${uuidv4()}`);
      assert.strictEqual(created.status, 202, created.text);
      let realmURL = created.body.data.id as string;
      let administrator = await registerListUser('list-kept');
      await insertPermissions(dbAdapter, new URL(realmURL), {
        [administrator.userId]: ['read', 'write', 'realm-owner'],
      });

      let response = await deleteRealm(request, administrator.userId, realmURL);
      assert.strictEqual(response.status, 503, response.text);
      assert.true(
        await registryHas(dbAdapter, realmURL),
        'the realm is still there',
      );
    });

    test('GET /_user-realms answers 503, not an empty list', async function (assert) {
      let user = await registerListUser('list-unreadable');
      let response = await read(
        supertest(server!),
        '/_user-realms',
        user.userId,
      );
      assert.strictEqual(response.status, 503, response.text);
    });
  });
});
