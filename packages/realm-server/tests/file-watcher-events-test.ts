import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import { removeSync, writeJSONSync, writeFileSync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  setupMatrixRoom,
  matrixURL,
  waitForRealmEvent,
  waitUntil,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  RealmEvent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

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
      try {
        return await waitForRealmEvent(
          getMessagesSince,
          realmEventTimestampStart,
          {
            predicate: (event) =>
              matchesFileChange(event, changeType, fileName),
            timeout: 20000,
            timeoutMessage: `Waiting for ${changeType} event for ${fileName} exceeded timeout`,
          },
        );
      } catch (error) {
        // Log all received events to help debug failures
        let allMessages = await getMessagesSince(realmEventTimestampStart);
        console.log(
          `Failed waiting for ${changeType} event for ${fileName}. Received ${allMessages.length} messages:`,
        );
        allMessages.forEach((msg, index) => {
          console.log(`Message ${index + 1}:`, JSON.stringify(msg, null, 2));
        });
        throw error;
      }
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

    test('file watcher invalidates caches after external edits', async function (assert) {
      const personFilePath = join(
        dir.name,
        'realm_server_1',
        'test',
        'person.gts',
      );
      const louisFilePath = join(
        dir.name,
        'realm_server_1',
        'test',
        'louis.json',
      );

      testRealm.__testOnlyClearCaches();

      let initialSourceResponse = await request
        .get('/person.gts')
        .set('Accept', 'application/vnd.card+source');
      assert.strictEqual(
        initialSourceResponse.headers['x-boxel-cache'],
        'miss',
        'initial card-source response seeds the cache',
      );

      let cachedSourceResponse = await request
        .get('/person.gts')
        .set('Accept', 'application/vnd.card+source');
      assert.strictEqual(
        cachedSourceResponse.headers['x-boxel-cache'],
        'hit',
        'card source is cached',
      );
      let cachedSourceBody = cachedSourceResponse.text.trim();

      await request.get('/louis').set('Accept', 'application/vnd.card+json');

      realmEventTimestampStart = Date.now();

      let updatedPersonSource = `
import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
import StringField from "https://cardstack.com/base/string";

export class Person extends CardDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName/> <@fields.lastName/></h1>
    </template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      Embedded Card Person: <@fields.firstName/> <@fields.lastName/>
    </template>
  }
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      Fitted Card Person: <@fields.firstName/> <@fields.lastName/>
    </template>
  }
}
      `.trim();

      writeFileSync(personFilePath, `${updatedPersonSource}\n`);
      writeJSONSync(louisFilePath, {
        data: {
          attributes: {
            firstName: 'Louis',
            lastName: 'Riel',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
          },
        },
      });

      await waitForFileChange('updated', basename(personFilePath));
      await waitForFileChange('updated', basename(louisFilePath));
      await testRealm.flushUpdateEvents();

      let updatedSourceResponse = await request
        .get('/person.gts')
        .set('Accept', 'application/vnd.card+source');

      assert.strictEqual(
        updatedSourceResponse.text.trim(),
        updatedPersonSource,
        'module source reflects the external edit',
      );
      assert.notStrictEqual(
        updatedSourceResponse.text.trim(),
        cachedSourceBody,
        'stale cached source was not served after external edits',
      );

      let repopulatedSourceResponse = await request
        .get('/person.gts')
        .set('Accept', 'application/vnd.card+source');

      assert.strictEqual(
        repopulatedSourceResponse.headers['x-boxel-cache'],
        'hit',
        'updated source is cached again after invalidation',
      );
      assert.strictEqual(
        repopulatedSourceResponse.text.trim(),
        updatedPersonSource,
        'cached source reflects the updated module after invalidation',
      );

      let updatedCardResponse = await request
        .get('/louis')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(
        updatedCardResponse.status,
        200,
        'card request succeeds',
      );
      assert.strictEqual(
        updatedCardResponse.body.data.attributes.firstName,
        'Louis',
        'existing attributes remain intact',
      );
      assert.strictEqual(
        updatedCardResponse.body.data.attributes.lastName,
        'Riel',
        'module and definition caches are refreshed after external edits',
      );
    });
  });
});
