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
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { type PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealm2URL = new URL('http://127.0.0.1:4445/test/');
const distDir = resolve(join(__dirname, '..', '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

let createJWT = (
  realm: Realm,
  user: string,
  permissions: RealmPermissions['user'] = [],
) => {
  return realm.createJWT(
    {
      user,
      realm: realm.url,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
    },
    '7d',
  );
};

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | POST _lint', function (hooks) {
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
          let testRealmDir = join(dir.name, '..', 'realm_server_1', 'test');
          ensureDirSync(testRealmDir);
          // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
          if (!fileSystem) {
            copySync(join(__dirname, '..', 'cards'), testRealmDir);
          }

          let virtualNetwork = createVirtualNetwork();

          ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            realmsRootPath: join(dir.name, '..', 'realm_server_1'),
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
      copySync(join(__dirname, '..', 'cards'), dir.name);
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
        realmsRootPath: join(dir.name, '..', 'realm_server_2'),
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
        testRealmDir = join(dir.name, '..', 'realm_server_2', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, '..', 'cards'), testRealmDir);
        await startRealmServer(dbAdapter2, publisher, runner);
      },
      afterEach: async () => {
        if (seedRealm) {
          virtualNetwork.unmount(seedRealm.handle);
        }
        await closeServer(testRealmHttpServer2);
      },
    });

    module('linting endpoint', function () {
      setupPermissionedRealm(hooks, {
        john: ['read', 'write'],
      });

      test('401 with invalid JWT', async function (assert) {
        let response = await request
          .post('/_lint')
          .set('Authorization', `Bearer invalid-token`)
          .set('X-HTTP-Method-Override', 'QUERY')
          .send(`console.log('hi')`);

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('user can do a lint with fix', async function (assert) {
        let response = await request
          .post('/_lint')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
          )
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/json')
          .send(`console.log('hi')`);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(response.body, 'xxx');
      });
    });
  });
});
