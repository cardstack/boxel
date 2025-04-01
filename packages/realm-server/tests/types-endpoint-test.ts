import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import {
  baseRealm,
  Realm,
  RealmPermissions,
  type LooseSingleCardDocument,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  realmServerTestMatrix,
  realmSecretSeed,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { type PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealm2URL = new URL('http://127.0.0.1:4445/test/');
const distDir = resolve(join(__dirname, '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

module(basename(__filename), function () {
  module('Realm-specific Endpoints | GET _types', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let testRealmHttpServer2: Server;
    let testRealm2: Realm;
    let dbAdapter2: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let testRealmDir: string;
    let seedRealm: Realm | undefined;

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
      fileSystem?: Record<string, string | LooseSingleCardDocument>,
    ) {
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, publisher, runner) => {
          dir = dirSync();
          let testRealmDir = join(dir.name, 'realm_server_1', 'test');
          ensureDirSync(testRealmDir);
          // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
          if (!fileSystem) {
            copySync(join(__dirname, 'cards'), testRealmDir);
          }

          let virtualNetwork = createVirtualNetwork();

          ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_1'),
            realmURL: testRealmURL,
            permissions,
            dbAdapter: _dbAdapter,
            runner,
            publisher,
            matrixURL,
            fileSystem,
          }));

          request = supertest(testRealmHttpServer);
        },
      });
    }

    function setupMatrixRoom(hooks: NestedHooks) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        // it's a little awkward that we are hijacking a realm user to pretend to
        // act like a normal user, but that's what's happening here
        username: 'node-test_realm',
        seed: realmSecretSeed,
      });

      let testAuthRoomId: string | undefined;

      hooks.beforeEach(async function () {
        await matrixClient.login();
        let userId = matrixClient.getUserId()!;

        let response = await request
          .post('/_server-session')
          .send(JSON.stringify({ user: userId }))
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json');

        let json = response.body;

        let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

        if (!rooms.includes(json.room)) {
          await matrixClient.joinRoom(json.room);
        }

        await matrixClient.sendEvent(json.room, 'm.room.message', {
          body: `auth-response: ${json.challenge}`,
          msgtype: 'm.text',
        });

        response = await request
          .post('/_server-session')
          .send(JSON.stringify({ user: userId, challenge: json.challenge }))
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json');

        testAuthRoomId = json.room;

        await matrixClient.setAccountData('boxel.session-rooms', {
          [userId]: json.room,
        });
      });

      return {
        matrixClient,
        getMessagesSince: async function (since: number) {
          let allMessages = await matrixClient.roomMessages(testAuthRoomId!);
          let messagesAfterSentinel = allMessages.filter(
            (m) => m.origin_server_ts > since,
          );

          return messagesAfterSentinel;
        },
      };
    }

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, 'cards'), dir.name);
    });

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealm(hooks, {
      '*': ['read', 'write'],
    });

    setupMatrixRoom(hooks);

    async function startRealmServer(
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) {
      if (testRealm2) {
        virtualNetwork.unmount(testRealm2.handle);
      }
      ({
        seedRealm,
        testRealm: testRealm2,
        testRealmHttpServer: testRealmHttpServer2,
      } = await runTestRealmServer({
        virtualNetwork,
        testRealmDir,
        realmsRootPath: join(dir.name, 'realm_server_2'),
        realmURL: testRealm2URL,
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      }));

      await testRealm.logInToMatrix();
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, _publisher, _runner) => {
        dbAdapter2 = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        testRealmDir = join(dir.name, 'realm_server_2', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        await startRealmServer(dbAdapter2, publisher, runner);
      },
      afterEach: async () => {
        if (seedRealm) {
          virtualNetwork.unmount(seedRealm.handle);
        }
        await closeServer(testRealmHttpServer2);
      },
    });

    test('can fetch card type summary', async function (assert) {
      let response = await request
        .get('/_types')
        .set('Accept', 'application/json');
      let iconHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-captions" viewbox="0 0 24 24"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"></rect><path d="M7 15h4m4 0h2M7 11h2m4 0h4"></path></svg>';
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, {
        data: [
          {
            type: 'card-type-summary',
            id: `${testRealm.url}friend/Friend`,
            attributes: {
              displayName: 'Friend',
              total: 2,
              iconHTML,
            },
          },
          {
            type: 'card-type-summary',
            id: `${testRealm.url}home/Home`,
            attributes: {
              displayName: 'Home',
              total: 1,
              iconHTML,
            },
          },
          {
            type: 'card-type-summary',
            id: `${testRealm.url}person/Person`,
            attributes: {
              displayName: 'Person',
              total: 3,
              iconHTML,
            },
          },
        ],
      });
    });
  });
});
