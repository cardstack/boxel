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
  param,
  query,
  SupportedMimeType,
  type QueuePublisher,
  type QueueRunner,
  type RealmPermissions,
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
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
} from '../helpers/oauth-provider.ts';
import {
  boxelApiToken,
  registerListUser,
  setWorkspaceListOf,
  workspaceListOf,
} from '../helpers/workspace-list.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmURLFor } from '../../handlers/create-realm.ts';
import { oauthIssuer } from '../../lib/oauth-provider/registry.ts';
import type { RealmHttpServer as Server } from '../../server.ts';
import { testRealmURL } from './helpers.ts';

const { copySync, ensureDirSync, existsSync } = fsExtra;

// The Boxel API's resource on the test server: the issuer, its own origin.
const BOXEL_API = oauthIssuer(testRealmURL.origin);

// A workspace that isn't on this server, so a list that names it shows the
// server's edits keep what they didn't make.
const OTHER_WORKSPACE = 'https://elsewhere.example/someone/other/';

function sessionToken(user: string) {
  return createRealmServerJWT(
    { user, sessionRoom: 'session-room-test' },
    realmSecretSeed,
  );
}

function createRealm(server: Server, token: string, endpoint: string) {
  return supertest(server)
    .post('/_create-realm')
    .set('Accept', SupportedMimeType.JSONAPI)
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${token}`)
    .send(
      JSON.stringify({
        data: { type: 'realm', attributes: { name: 'Listed', endpoint } },
      }),
    );
}

function deleteRealm(server: Server, token: string, realmURL: string) {
  return supertest(server)
    .delete('/_delete-realm')
    .set('Accept', SupportedMimeType.JSONAPI)
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${token}`)
    .send(JSON.stringify({ data: { type: 'realm', id: realmURL } }));
}

function read(
  server: Server,
  path: '/_user-realms' | '/_user-display-name',
  token: string,
) {
  return supertest(server)
    .get(path)
    .set('Accept', SupportedMimeType.JSONAPI)
    .set('Authorization', `Bearer ${token}`);
}

async function registryHas(dbAdapter: PgAdapter, realmURL: string) {
  let rows = (await dbAdapter.execute(
    `SELECT url FROM realm_registry WHERE url = $1`,
    { bind: [realmURL] },
  )) as { url: string }[];
  return rows.length > 0;
}

// A realm server with the OAuth provider on, at the test realm's URL, so a
// realm it creates can be indexed. `matrixAdmin` replaces its Synapse admin.
function setupServer(
  hooks: NestedHooks,
  key: string,
  matrixAdmin?: { username: string; password: string },
) {
  let context = {} as {
    server: Server;
    dbAdapter: PgAdapter;
    realmsRootPath: string;
  };

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let realmsRootPath = join(dirSync().name, 'realm_server_workspace_list');
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
      secureOriginURL: testOAuthSecureOriginURL,
      clientAddress: { trustedProxyHops: 0, infraAddresses: [] },
      oauthProvider: testOAuthProviderConfig(),
      ...(matrixAdmin ? { matrixAdmin } : {}),
    });
    return { server: testRealmHttpServer, realmsRootPath };
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key,
    build: async (args) => {
      let built = await start(args);
      return () => closeServer(built.server);
    },
  });
  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      let started = await start({ dbAdapter, publisher, runner });
      context.server = started.server;
      context.realmsRootPath = started.realmsRootPath;
      context.dbAdapter = dbAdapter;
    },
    afterEach: async () => {
      await closeServer(context.server);
    },
  });
  hooks.before(async function () {
    await ensureMatrixAdminUser();
  });
  return context;
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('a user’s workspace list', function (hooks) {
    let context = setupServer(hooks, `${import.meta.filename}#admin`);

    test('creating a workspace with an OAuth token adds it to its owner’s list, and deleting it takes it off', async function (assert) {
      let owner = await registerListUser('list-owner');
      await setWorkspaceListOf(owner, [OTHER_WORKSPACE]);
      let token = await boxelApiToken(
        context.dbAdapter,
        owner.userId,
        BOXEL_API,
      );

      let created = await createRealm(
        context.server,
        token,
        `listed-${uuidv4()}`,
      );
      assert.strictEqual(created.status, 202, created.text);
      let realmURL = created.body.data.id as string;
      assert.deepEqual(
        await workspaceListOf(owner),
        [OTHER_WORKSPACE, realmURL],
        'the new workspace is on the list once it is created',
      );

      let deleted = await deleteRealm(context.server, token, realmURL);
      assert.strictEqual(deleted.status, 204, deleted.text);
      assert.deepEqual(
        await workspaceListOf(owner),
        [OTHER_WORKSPACE],
        'the deleted workspace is off the list, and the rest stays',
      );
    });

    test('creating and deleting a workspace with a session token leave the list to the caller', async function (assert) {
      let owner = await registerListUser('list-session');
      await setWorkspaceListOf(owner, [OTHER_WORKSPACE]);
      let token = sessionToken(owner.userId);

      let created = await createRealm(
        context.server,
        token,
        `session-${uuidv4()}`,
      );
      assert.strictEqual(created.status, 202, created.text);
      assert.deepEqual(await workspaceListOf(owner), [OTHER_WORKSPACE]);

      let realmURL = created.body.data.id as string;
      await setWorkspaceListOf(owner, [OTHER_WORKSPACE, realmURL]);
      let deleted = await deleteRealm(context.server, token, realmURL);
      assert.strictEqual(deleted.status, 204, deleted.text);
      assert.deepEqual(
        await workspaceListOf(owner),
        [OTHER_WORKSPACE, realmURL],
        'the caller still finds the entry to remove itself',
      );
    });

    test('creating a workspace that is already the caller’s puts it back on their list', async function (assert) {
      let owner = await registerListUser('list-relink');
      let token = await boxelApiToken(
        context.dbAdapter,
        owner.userId,
        BOXEL_API,
      );
      let endpoint = `relink-${uuidv4()}`;
      let created = await createRealm(context.server, token, endpoint);
      assert.strictEqual(created.status, 202, created.text);
      let realmURL = created.body.data.id as string;
      await setWorkspaceListOf(owner, []);

      let again = await createRealm(context.server, token, endpoint);
      assert.strictEqual(again.status, 400, again.text);
      assert.true(
        again.text.includes(`realm '${realmURL}' already exists`),
        'the answer still says the realm exists, as boxel-cli expects',
      );
      assert.deepEqual(await workspaceListOf(owner), [realmURL]);
    });

    test('a user with no Matrix account can still create and delete a workspace', async function (assert) {
      let user = `@no-account-${uuidv4()}:localhost`;
      let token = await boxelApiToken(context.dbAdapter, user, BOXEL_API);
      let created = await createRealm(
        context.server,
        token,
        `unlisted-${uuidv4()}`,
      );
      assert.strictEqual(created.status, 202, created.text);
      let deleted = await deleteRealm(
        context.server,
        token,
        created.body.data.id,
      );
      assert.strictEqual(deleted.status, 204, deleted.text);
    });

    test('GET /_user-realms answers the caller’s own list', async function (assert) {
      let first = await registerListUser('list-first');
      let second = await registerListUser('list-second');
      await setWorkspaceListOf(first, [OTHER_WORKSPACE]);
      await setWorkspaceListOf(second, []);

      let response = await read(
        context.server,
        '/_user-realms',
        sessionToken(first.userId),
      );
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data, {
        type: 'user-realms',
        id: first.userId,
        attributes: { realms: [OTHER_WORKSPACE], reachableRealms: [] },
      });

      let seconds = await read(
        context.server,
        '/_user-realms',
        sessionToken(second.userId),
      );
      assert.deepEqual(
        seconds.body.data.attributes.realms,
        [],
        'the second user sees their own list',
      );
    });

    test('GET /_user-realms marks the realms on the list the caller can still reach', async function (assert) {
      let user = await registerListUser('list-reach');
      let owner = `@someone-else-${uuidv4()}:localhost`;
      let base = `${testRealmURL.origin}/reach-${uuidv4()}`;
      let realm = (name: string) => `${base}/${name}/`;
      let grant = (name: string, permissions: RealmPermissions) =>
        insertPermissions(context.dbAdapter, new URL(realm(name)), {
          [owner]: ['read', 'write', 'realm-owner'],
          ...permissions,
        });
      let archive = (name: string) =>
        query(context.dbAdapter, [
          'INSERT INTO realm_metadata (url, archived_at) VALUES (',
          param(realm(name)),
          ', NOW())',
        ]);

      await grant('own', { [user.userId]: ['read', 'write', 'realm-owner'] });
      await grant('shared', { [user.userId]: ['read'] });
      await grant('public', { '*': ['read'] });
      // Open to every signed-in user of this server, which the caller is:
      // the Boxel API token gave them an account here.
      await grant('signed-in', { users: ['read'] });
      // A published copy: its own permissions don't make it a workspace.
      await grant('published', { [user.userId]: ['read'] });
      await query(context.dbAdapter, [
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username, source_url) VALUES (`,
        param(realm('published')),
        `, 'published',`,
        param(`published-${uuidv4()}`),
        `,`,
        param(owner),
        `,`,
        param(realm('own')),
        `)`,
      ]);
      // Revoked: the owner's row is all that is left.
      await grant('revoked', {});
      // Deleted: no rows at all, as deleting a realm leaves none.
      await grant('archived-own', { [user.userId]: ['read', 'write'] });
      await archive('archived-own');
      await grant('archived-shared', { [user.userId]: ['read'] });
      await archive('archived-shared');

      let stored = [
        realm('shared'),
        // Without its trailing slash, and twice.
        realm('own').replace(/\/$/, ''),
        realm('revoked'),
        realm('deleted'),
        realm('public'),
        realm('signed-in'),
        realm('published'),
        realm('archived-own'),
        realm('archived-shared'),
        realm('own'),
        OTHER_WORKSPACE,
      ];
      await setWorkspaceListOf(user, stored);

      let token = await boxelApiToken(
        context.dbAdapter,
        user.userId,
        BOXEL_API,
      );
      let response = await read(context.server, '/_user-realms', token);
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(
        response.body.data.attributes.realms,
        stored,
        'the list is answered as the account stores it',
      );
      assert.deepEqual(
        response.body.data.attributes.reachableRealms,
        [
          { url: realm('shared'), archived: false },
          { url: realm('own'), archived: false },
          { url: realm('public'), archived: false },
          { url: realm('signed-in'), archived: false },
          { url: realm('archived-own'), archived: true },
        ],
        'only the realms the caller can open, in list order, archived ones only for a caller who can write them',
      );
    });

    test('GET /_user-display-name answers the caller’s display name', async function (assert) {
      let user = await registerListUser('list-name');
      let response = await read(
        context.server,
        '/_user-display-name',
        sessionToken(user.userId),
      );
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data, {
        type: 'user-display-name',
        id: user.userId,
        attributes: { displayName: user.displayName },
      });
    });

    test('a user with no Matrix account has no list or display name here', async function (assert) {
      let token = sessionToken(`@no-account-${uuidv4()}:localhost`);
      for (let path of ['/_user-realms', '/_user-display-name'] as const) {
        let response = await read(context.server, path, token);
        assert.strictEqual(response.status, 404, `${path}: ${response.text}`);
      }
    });
  });

  // A server whose Synapse admin login fails: no list can be read or edited,
  // so an OAuth create or delete either completes with its list edit or not
  // at all.
  module('when the workspace list can’t be edited', function (hooks) {
    let context = setupServer(hooks, `${import.meta.filename}#no-admin`, {
      // An admin the homeserver doesn't have, so every admin login fails.
      username: `no-such-admin-${uuidv4().slice(0, 8)}`,
      password: 'password',
    });

    test('a create whose list edit fails is undone', async function (assert) {
      let owner = await registerListUser('list-undone');
      await setWorkspaceListOf(owner, [OTHER_WORKSPACE]);
      let token = await boxelApiToken(
        context.dbAdapter,
        owner.userId,
        BOXEL_API,
      );
      let endpoint = `undone-${uuidv4()}`;
      let realmURL = realmURLFor(
        new URL(testRealmURL.origin),
        owner.userId,
        endpoint,
      );

      let response = await createRealm(context.server, token, endpoint);
      assert.strictEqual(response.status, 503, response.text);
      assert.true(
        response.text.includes('The workspace was not created'),
        response.text,
      );
      assert.false(
        await registryHas(context.dbAdapter, realmURL),
        'the realm is not registered',
      );
      assert.false(
        existsSync(
          join(
            context.realmsRootPath,
            getMatrixUsername(owner.userId),
            endpoint,
          ),
        ),
        'its files are gone',
      );
      assert.deepEqual(await workspaceListOf(owner), [OTHER_WORKSPACE]);
    });

    test('a delete whose list edit fails deletes nothing', async function (assert) {
      let owner = await registerListUser('list-kept');
      // A session-token create keeps no list, so it needs no admin.
      let created = await createRealm(
        context.server,
        sessionToken(owner.userId),
        `kept-${uuidv4()}`,
      );
      assert.strictEqual(created.status, 202, created.text);
      let realmURL = created.body.data.id as string;
      let token = await boxelApiToken(
        context.dbAdapter,
        owner.userId,
        BOXEL_API,
      );

      let response = await deleteRealm(context.server, token, realmURL);
      assert.strictEqual(response.status, 503, response.text);
      assert.true(
        await registryHas(context.dbAdapter, realmURL),
        'the realm is still there',
      );
    });

    test('GET /_user-realms answers 503, not an empty list', async function (assert) {
      let user = await registerListUser('list-unreadable');
      let response = await read(
        context.server,
        '/_user-realms',
        sessionToken(user.userId),
      );
      assert.strictEqual(response.status, 503, response.text);
    });
  });
});
