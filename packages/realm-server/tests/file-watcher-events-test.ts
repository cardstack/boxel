import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import { Server } from 'http';
import { type DirResult } from 'tmp';
import { removeSync, writeJSONSync } from 'fs-extra';
import { baseRealm, Realm } from '@cardstack/runtime-common';
import {
  findRealmEvent,
  setupCardLogs,
  setupBaseRealmServer,
  setupPermissionedRealm,
  setupMatrixRoom,
  createVirtualNetworkAndLoader,
  matrixURL,
  waitForRealmEvent,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(basename(__filename), function () {
  module('file watcher realm events', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let realmEventTimestampStart: number;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
      dir = args.dir;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request,
        dir,
      };
    }
    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    setupPermissionedRealm(hooks, {
      permissions: {
        '*': ['read'],
      },
      subscribeToRealmEvents: true,
      onRealmSetup,
      fileSystem: {
        'person.gts': `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringField);
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
    });

    let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

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
