import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import { removeSync, writeJSONSync } from 'fs-extra';
import {
  APP_BOXEL_REALM_EVENT_TYPE,
  type Realm,
} from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  setupMatrixRoom,
  matrixURL,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';

module(basename(__filename), function () {
  module('file watcher realm events', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let realmEventTimestampStart: number;

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

    let { waitForMatchingMessages } = setupMatrixRoom(hooks, getRealmSetup);

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

      let updateEvents = await waitForMatchingMessages(
        (m) =>
          m.origin_server_ts > realmEventTimestampStart &&
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'update' &&
          m.content.added === basename(newFilePath),
      );
      assert.ok(updateEvents);
      assert.strictEqual(updateEvents!.length, 1);

      assert.deepEqual(updateEvents![0].content, {
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

      let updateEvents = await waitForMatchingMessages(
        (m) =>
          m.origin_server_ts > realmEventTimestampStart &&
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'update' &&
          m.content.updated === basename(updatedFilePath),
      );
      assert.ok(updateEvents);
      assert.strictEqual(updateEvents!.length, 1);

      assert.deepEqual(updateEvents![0].content, {
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

      let updateEvents = await waitForMatchingMessages(
        (m) =>
          m.origin_server_ts > realmEventTimestampStart &&
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'update' &&
          m.content.removed === basename(deletedFilePath),
      );
      assert.ok(updateEvents);
      assert.strictEqual(updateEvents!.length, 1);

      assert.deepEqual(updateEvents![0].content, {
        eventName: 'update',
        removed: basename(deletedFilePath),
      });
    });
  });
});
