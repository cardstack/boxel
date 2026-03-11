import { basename, join } from 'path';
import { removeSync, writeFileSync, writeJSONSync } from 'fs-extra';
import { describe, expect } from 'vitest';
import { SupportedMimeType } from '@cardstack/runtime-common';
import type {
  RealmEvent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import {
  createExperimentalPermissionedRealmTest,
  createMatrixRoomSession,
  waitForRealmEvent,
  type ExperimentalPermissionedRealmFixture,
} from '../helpers';

type ExperimentalRealmTest = {
  concurrent: (
    name: string,
    fn: (context: {
      realm: ExperimentalPermissionedRealmFixture;
    }) => Promise<void>,
  ) => void;
};

type FileChangeType = 'added' | 'updated' | 'removed';

const realmURL = new URL('http://test-realm/test/');
const test = createExperimentalPermissionedRealmTest({
  realmURL,
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read'],
    '@node-test_realm:localhost': ['read', 'realm-owner'],
  },
  subscribeToRealmEvents: true,
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
}) as ExperimentalRealmTest;

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
  getMessagesSince: (since: number) => Promise<RealmEvent[]>,
  since: number,
  changeType: FileChangeType,
  fileName: string,
): Promise<RealmEvent> {
  try {
    return await waitForRealmEvent(getMessagesSince, since, {
      predicate: (event) => matchesFileChange(event, changeType, fileName),
      timeout: 20000,
      timeoutMessage: `Waiting for ${changeType} event for ${fileName} exceeded timeout`,
    });
  } catch (error) {
    let allMessages = await getMessagesSince(since);
    console.log(
      `Failed waiting for ${changeType} event for ${fileName}. Received ${allMessages.length} messages:`,
    );
    allMessages.forEach((msg, index) => {
      console.log(`Message ${index + 1}:`, JSON.stringify(msg, null, 2));
    });
    throw error;
  }
}

describe('file-watcher-events-test.ts', function () {
  describe('file watcher realm events', function () {
    test.concurrent(
      'file creation produces an added event',
      async ({ realm }) => {
        let { getMessagesSince } = await createMatrixRoomSession(realm);
        let realmEventTimestampStart = Date.now();
        let newFilePath = join(realm.testRealmPath, 'new-file.json');

        writeJSONSync(newFilePath, {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Mango',
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

        let updateEvent = await waitForFileChange(
          getMessagesSince,
          realmEventTimestampStart,
          'added',
          basename(newFilePath),
        );

        expect(updateEvent.content).toEqual({
          eventName: 'update',
          added: basename(newFilePath),
          realmURL: realm.realmURL.href,
        });
      },
    );

    test.concurrent(
      'file updating produces an updated event',
      async ({ realm }) => {
        let { getMessagesSince } = await createMatrixRoomSession(realm);
        let realmEventTimestampStart = Date.now();
        let updatedFilePath = join(realm.testRealmPath, 'louis.json');

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
          getMessagesSince,
          realmEventTimestampStart,
          'updated',
          basename(updatedFilePath),
        );

        expect(updateEvent.content).toEqual({
          eventName: 'update',
          updated: basename(updatedFilePath),
          realmURL: realm.realmURL.href,
        });
      },
    );

    test.concurrent(
      'file deletion produces a removed event',
      async ({ realm }) => {
        let { getMessagesSince } = await createMatrixRoomSession(realm);
        let realmEventTimestampStart = Date.now();
        let deletedFilePath = join(realm.testRealmPath, 'louis.json');

        removeSync(deletedFilePath);

        let updateEvent = await waitForFileChange(
          getMessagesSince,
          realmEventTimestampStart,
          'removed',
          basename(deletedFilePath),
        );

        expect(updateEvent.content).toEqual({
          eventName: 'update',
          removed: basename(deletedFilePath),
          realmURL: realm.realmURL.href,
        });
      },
    );

    test.concurrent(
      'file watcher invalidates caches after external edits',
      async ({ realm }) => {
        let { getMessagesSince } = await createMatrixRoomSession(realm);
        let personFilePath = join(realm.testRealmPath, 'person.gts');
        let louisFilePath = join(realm.testRealmPath, 'louis.json');

        realm.testRealm.__testOnlyClearCaches();
        let initialSourceResponse = await realm.request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.CardSource);
        expect(initialSourceResponse.headers['x-boxel-cache']).toBe('miss');

        let cachedSourceResponse = await realm.request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.CardSource);
        expect(cachedSourceResponse.headers['x-boxel-cache']).toBe('hit');
        let cachedSourceBody = cachedSourceResponse.text.trim();

        await realm.request
          .get('/louis')
          .set('Accept', SupportedMimeType.CardJson);

        let realmEventTimestampStart = Date.now();
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

        await waitForFileChange(
          getMessagesSince,
          realmEventTimestampStart,
          'updated',
          basename(personFilePath),
        );
        await waitForFileChange(
          getMessagesSince,
          realmEventTimestampStart,
          'updated',
          basename(louisFilePath),
        );
        await realm.testRealm.flushUpdateEvents();

        let updatedSourceResponse = await realm.request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.CardSource);
        expect(updatedSourceResponse.text.trim()).toBe(updatedPersonSource);
        expect(updatedSourceResponse.text.trim()).not.toBe(cachedSourceBody);

        let repopulatedSourceResponse = await realm.request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.CardSource);
        expect(repopulatedSourceResponse.headers['x-boxel-cache']).toBe('hit');
        expect(repopulatedSourceResponse.text.trim()).toBe(updatedPersonSource);

        let updatedCardResponse = await realm.request
          .get('/louis')
          .set('Accept', SupportedMimeType.CardJson);
        expect(updatedCardResponse.status).toBe(200);
        expect(updatedCardResponse.body.data.attributes.firstName).toBe(
          'Louis',
        );
        expect(updatedCardResponse.body.data.attributes.lastName).toBe('Riel');
      },
    );
  });
});
