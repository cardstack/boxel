import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createVirtualNetwork,
  matrixURL,
  closeServer,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';

const testRealm2URL = new URL('http://127.0.0.1:4445/test/');

module(basename(__filename), function () {
  module('Realm-specific Endpoints | GET _types', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer2: Server;
    let testRealm2: Realm;
    let dbAdapter2: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let testRealmDir: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
      dir = args.dir;
      dbAdapter = args.dbAdapter;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request,
        dir,
        dbAdapter,
      };
    }
    setupBaseRealmServer(hooks, matrixURL);

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealm(hooks, {
      permissions: {
        '*': ['read', 'write'],
      },
      onRealmSetup,
    });

    setupMatrixRoom(hooks, getRealmSetup);
    let virtualNetwork = createVirtualNetwork();

    async function startRealmServer(
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) {
      if (testRealm2) {
        virtualNetwork.unmount(testRealm2.handle);
      }
      ({ testRealm: testRealm2, testRealmHttpServer: testRealmHttpServer2 } =
        await runTestRealmServer({
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
        await closeServer(testRealmHttpServer2);
      },
    });

    test('can fetch card type summary', async function (assert) {
      let response = await request
        .get('/_types')
        .set('Accept', 'application/json');
      let iconHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-captions" viewBox="0 0 24 24"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"></rect><path d="M7 15h4m4 0h2M7 11h2m4 0h4"></path></svg>';
      let chessIconHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-rectangle-ellipsis" viewBox="0 0 24 24"><rect width="20" height="12" x="2" y="6" rx="2"></rect><path d="M12 12h.01M17 12h.01M7 12h.01"></path></svg>';
      let sortCardTypeSummaries = (summaries: any[]) =>
        [...summaries].sort((a, b) => {
          let aName = a.attributes.displayName;
          let bName = b.attributes.displayName;
          if (aName === bName) {
            return a.id.localeCompare(b.id);
          }
          return aName.localeCompare(bName);
        });
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let expectedData = [
        {
          type: 'card-type-summary',
          id: `${testRealm.url}chess-gallery/ChessGallery`,
          attributes: {
            displayName: 'Chess Gallery',
            total: 3,
            iconHTML: chessIconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: 'http://127.0.0.1:4444/family_photo_card/FamilyPhotoCard',
          attributes: {
            displayName: 'Family Photo Card',
            total: 2,
            iconHTML,
          },
        },
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
          id: `${testRealm.url}friend-with-used-link/FriendWithUsedLink`,
          attributes: {
            displayName: 'FriendWithUsedLink',
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
        {
          type: 'card-type-summary',
          id: 'http://127.0.0.1:4444/person-with-error/PersonCard',
          attributes: {
            displayName: 'Person',
            total: 4,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}timers-card/TimersCard`,
          attributes: {
            displayName: 'TimersCard',
            total: 1,
            iconHTML,
          },
        },
      ];
      assert.deepEqual(
        sortCardTypeSummaries(response.body.data),
        sortCardTypeSummaries(expectedData),
      );
    });
  });
});
