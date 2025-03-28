import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import eventSource from 'eventsource';
import { copySync, ensureDirSync, writeJSONSync } from 'fs-extra';
import {
  baseRealm,
  RealmPermissions,
  type LooseSingleCardDocument,
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
  waitUntil,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;

module(basename(__filename), function () {
  module('Realm-specific Endpoints | card URLs', function (hooks) {
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let testRealmDir: string;
    let testRealmEventSource: eventSource;
    let realmEventTimestampStart: number;

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
      fileSystem?: Record<string, string | LooseSingleCardDocument>,
    ) {
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, publisher, runner) => {
          dir = dirSync();
          testRealmDir = join(dir.name, 'realm_server_1', 'test');
          ensureDirSync(testRealmDir);
          // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
          if (!fileSystem) {
            copySync(join(__dirname, 'cards'), testRealmDir);
          }

          let virtualNetwork = createVirtualNetwork();

          ({ testRealmHttpServer } = await runTestRealmServer({
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
            enableFileWatcher: true,
          }));

          testRealmEventSource = new eventSource(
            `${testRealmHref}_message?testFileWatcher=node`,
          );

          await new Promise<void>((resolve) => {
            testRealmEventSource.onopen = () => {
              resolve();
            };
          });

          request = supertest(testRealmHttpServer);
        },
      });
    }

    // FIXME this and others copied from card-endpoints-test, extract
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
      testRealmEventSource.close();
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealm(hooks, {
      '*': ['read'],
    });

    let { getMessagesSince } = setupMatrixRoom(hooks);

    test('file creation produces an update event', async function (assert) {
      realmEventTimestampStart = Date.now();

      let newFilePath = join(
        dir.name,
        'realm_server_1',
        'test',
        'new-file.json',
      );

      writeJSONSync(newFilePath, {
        data: {
          type: 'card',
          attributes: {
            title: 'Mango',
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: './sample-card',
              name: 'SampleCard',
            },
          },
        },
      });

      await waitForRealmEvent(getMessagesSince, realmEventTimestampStart);
      let messages = await getMessagesSince(realmEventTimestampStart);
      let updateEvent = findRealmEvent(messages, 'update', 'incremental');

      assert.deepEqual(updateEvent?.content, {
        eventName: 'update',
        added: basename(newFilePath),
      });
    });
  });
});

async function waitForRealmEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
) {
  await waitUntil(async () => {
    let matrixMessages = await getMessagesSince(since);
    return matrixMessages.length > 0;
  });
}

function findRealmEvent(
  events: MatrixEvent[],
  eventName: string,
  indexType: string,
): RealmEvent | undefined {
  return events.find(
    (m) =>
      m.type === APP_BOXEL_REALM_EVENT_TYPE &&
      m.content.eventName === eventName &&
      (realmEventIsIndex(m.content) ? m.content.indexType === indexType : true),
  ) as RealmEvent | undefined;
}

function realmEventIsIndex(
  event: RealmEventContent,
): event is IncrementalIndexEventContent {
  return event.eventName === 'index';
}
