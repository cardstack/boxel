import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import eventSource from 'eventsource';
import { copySync, ensureDirSync, removeSync, writeJSONSync } from 'fs-extra';
import {
  baseRealm,
  RealmPermissions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  findRealmEvent,
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
  waitForRealmEvent,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;

module(basename(__filename), function () {
  module('file watcher realm events', function (hooks) {
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let testRealmDir: string;
    let testRealmEventSource: eventSource;
    let realmEventTimestampStart: number;

    function setTestRequest(newRequest: SuperTest<Test>) {
      request = newRequest;
    }

    function getTestRequest() {
      return request;
    }

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
      setTestRequest: (newRequest: SuperTest<Test>) => void,
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

          setTestRequest(supertest(testRealmHttpServer));
        },
      });
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

    setupPermissionedRealm(
      hooks,
      {
        '*': ['read'],
      },
      setTestRequest,
      {
        'person.gts': `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1><@fields.firstName/></h1>
            </template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              Embedded Card Person: <@fields.firstName/>
            </template>
          }
          static fitted = class Fitted extends Component<typeof this> {
            <template>
              Fitted Card Person: <@fields.firstName/>
            </template>
          }
        }
      `,
        'louis.json': {
          data: {
            attributes: {
              firstName: 'Louis',
            },
            meta: {
              adoptsFrom: {
                module: './person',
                name: 'Person',
              },
            },
          },
        },
      },
    );

    let { getMessagesSince } = setupMatrixRoom(hooks, getTestRequest);

    test('file creation produces an added event', async function (assert) {
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

    test('file updating produces an updated event', async function (assert) {
      realmEventTimestampStart = Date.now();

      let updatedFilePath = join(
        dir.name,
        'realm_server_1',
        'test',
        'louis.json',
      );

      writeJSONSync(updatedFilePath, {
        data: {
          attributes: {
            firstName: 'Louis.',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
          },
        },
      });

      await waitForRealmEvent(getMessagesSince, realmEventTimestampStart);
      let messages = await getMessagesSince(realmEventTimestampStart);
      let updateEvent = findRealmEvent(messages, 'update', 'incremental');

      assert.deepEqual(updateEvent?.content, {
        eventName: 'update',
        updated: basename(updatedFilePath),
      });
    });

    test('file deletion produces a removed event', async function (assert) {
      realmEventTimestampStart = Date.now();

      let deletedFilePath = join(
        dir.name,
        'realm_server_1',
        'test',
        'louis.json',
      );

      removeSync(deletedFilePath);

      await waitForRealmEvent(getMessagesSince, realmEventTimestampStart);
      let messages = await getMessagesSince(realmEventTimestampStart);
      let updateEvent = findRealmEvent(messages, 'update', 'incremental');

      assert.deepEqual(updateEvent?.content, {
        eventName: 'update',
        removed: basename(deletedFilePath),
      });
    });
  });
});
