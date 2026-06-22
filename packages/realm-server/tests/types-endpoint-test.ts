import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import type { Realm } from '@cardstack/runtime-common';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  runTestRealmServer,
  logRealmIndexDiagnostics,
  setupDB,
  setupMatrixRoom,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  closeServer,
  type RealmRequest,
  withRealmPath,
} from './helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';

const testRealm2URL = new URL('http://127.0.0.1:4445/test/');

module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | GET _types', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;
    let serverRequest: SuperTest<Test>;
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
      serverRequest = args.request;
      request = withRealmPath(args.request, realmURL);
      dir = args.dir;
      dbAdapter = args.dbAdapter;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request,
        serverRequest,
        dir,
        dbAdapter,
      };
    }

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      permissions: {
        '*': ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
      },
      realmURL,
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
        copySync(fixtureDir('simple'), testRealmDir);
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
      let fileSettingsIconHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="icon icon-tabler icons-tabler-outline icon-tabler-file-settings" viewBox="0 0 24 24"><path stroke="none" d="M0 0h24v24H0z"></path><path d="M10 14a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 10.5V12M12 16v1.5M15.031 12.25l-1.299.75M10.268 15l-1.3.75M15 15.803l-1.285-.773M10.285 12.97 9 12.197M14 3v4a1 1 0 0 0 1 1h4"></path><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2"></path></svg>';
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
      let instanceEntries = [
        {
          type: 'card-type-summary',
          id: `${testRealm.url}chess-gallery/ChessGallery`,
          attributes: {
            displayName: 'Chess Gallery',
            total: 3,
            iconHTML: chessIconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}family_photo_card/FamilyPhotoCard`,
          attributes: {
            displayName: 'Family Photo Card',
            total: 2,
            iconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}friend/Friend`,
          // The fixture realm includes a Friend instance whose linksTo
          // target is broken; that instance now lands as type='instance'
          // (broken slot renders the placeholder) instead of being
          // demoted to instance-error, so it contributes to the
          // type-summary total alongside the two clean Friend instances.
          attributes: {
            displayName: 'Friend',
            total: 3,
            iconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: 'https://localhost:4202/node-test/friend-with-used-link/FriendWithUsedLink',
          attributes: {
            displayName: 'FriendWithUsedLink',
            total: 2,
            iconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}home/Home`,
          attributes: {
            displayName: 'Home',
            total: 1,
            iconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}person/Person`,
          attributes: {
            displayName: 'Person',
            total: 3,
            iconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}person-with-error/PersonCard`,
          attributes: {
            displayName: 'Person',
            total: 4,
            iconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: 'https://cardstack.com/base/realm-config/RealmConfig',
          attributes: {
            displayName: 'Realm Config',
            total: 1,
            iconHTML: fileSettingsIconHTML,
            kind: 'instance' as const,
          },
        },
        {
          type: 'card-type-summary',
          id: `${testRealm.url}timers-card/TimersCard`,
          attributes: {
            displayName: 'TimersCard',
            total: 1,
            iconHTML,
            kind: 'instance' as const,
          },
        },
      ];
      let actualInstances = response.body.data.filter(
        (entry: any) => entry.attributes.kind === 'instance',
      );
      if (actualInstances.length === 0) {
        // Read-time companion to the build-time diagnostic: an empty instance
        // set here means the realm served by this (cached-template-restored)
        // realm-server has no `realm_meta` instances. Dump the restored DB
        // state so the next failure shows whether the snapshot itself was
        // empty/degraded or a version mismatch surfaced on read.
        await logRealmIndexDiagnostics(
          dbAdapter,
          realmURL.href,
          'types-endpoint-read',
        );
      }
      assert.deepEqual(
        sortCardTypeSummaries(actualInstances),
        sortCardTypeSummaries(instanceEntries),
        'instance summaries match expected fixture',
      );
      assert.ok(
        response.body.data.every(
          (entry: any) =>
            entry.attributes.kind === 'instance' ||
            entry.attributes.kind === 'file',
        ),
        'every summary entry carries an instance/file kind',
      );
      // The realistic fixture seeds `.md` files (sample.md, card-refs.md),
      // so the response must include at least one `kind: 'file'` entry.
      // Anchoring the test here protects against a regression that drops
      // the `files` arm before `makeCardTypeSummaryDoc` emits the doc.
      let fileEntries = response.body.data.filter(
        (entry: any) => entry.attributes.kind === 'file',
      );
      assert.ok(
        fileEntries.length > 0,
        'response includes at least one kind: file entry from the indexed .md fixtures',
      );
    });
  });
});
