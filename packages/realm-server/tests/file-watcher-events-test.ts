import QUnit, { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import { removeSync, writeJSONSync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  setupMatrixRoom,
  matrixURL,
  waitForRealmEvent,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  RealmEvent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

QUnit.config.testTimeout = 30000;

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

    let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

    type FileChangeType = 'added' | 'updated' | 'removed';

    function matchesFileChange(
      event: RealmEvent,
      changeType: FileChangeType,
      fileName: string,
    ): boolean {
      if (event.content.eventName !== 'update') {
        return false;
      }

      let content = event.content as UpdateRealmEventContent;

      switch (changeType) {
        case 'added':
          return 'added' in content && content.added === fileName;
        case 'updated':
          return 'updated' in content && content.updated === fileName;
        case 'removed':
          return 'removed' in content && content.removed === fileName;
      }
    }

    async function waitForFileChange(
      changeType: FileChangeType,
      fileName: string,
    ): Promise<RealmEvent> {
      return waitForRealmEvent(getMessagesSince, realmEventTimestampStart, {
        predicate: (event) => matchesFileChange(event, changeType, fileName),
        timeout: 20000,
        timeoutMessage: `Waiting for ${changeType} event for ${fileName} exceeded timeout`,
      });
    }

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

      let updateEvent = await waitForFileChange('added', basename(newFilePath));

      assert.deepEqual(updateEvent.content, {
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

      let updateEvent = await waitForFileChange(
        'updated',
        basename(updatedFilePath),
      );

      assert.deepEqual(updateEvent.content, {
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

      let updateEvent = await waitForFileChange(
        'removed',
        basename(deletedFilePath),
      );

      assert.deepEqual(updateEvent.content, {
        eventName: 'update',
        removed: basename(deletedFilePath),
      });
    });
  });
});
