import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { RealmHttpServer as Server } from '../../server.ts';
import { rri } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  assertRealmInfoExtras,
  closeServer,
  testRealmInfo,
  createJWT,
  realmInfoExtraKeys,
  testRealmURLFor,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm-specific Endpoints | QUERY _info', function (hooks) {
    let realmURL = testRealmURLFor('test/');
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
    }

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('public readable realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'realistic',
        permissions: {
          '*': ['read'],
        },
        realmURL,
        onRealmSetup,
      });

      test('serves the request', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          realmURL.href,
          'realm url header is correct',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-public-readable'),
          'true',
          'realm is public readable',
        );
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              id: realmURL.href,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
              },
            },
          },
          '/_info response is correct',
        );
      });
    });

    module('permissioned realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'realistic',
        permissions: {
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        realmURL,
        onRealmSetup,
      });

      test('401 with invalid JWT', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('401 without a JWT', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json'); // no Authorization header

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('403 without permission', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-a-user')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('200 with permission', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, '@node-test_realm:localhost', ['read', 'realm-owner'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              id: realmURL.href,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
                visibility: 'private',
              },
            },
          },
          '/_info response is correct',
        );
      });
    });

    module(
      'shared realm because there is `users` permission',
      function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          permissions: {
            users: ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          realmURL,
          onRealmSetup,
        });

        test('200 with permission', async function (assert) {
          let infoPath = new URL('_info', realmURL).pathname;
          let response = await request
            .post(infoPath)
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', 'application/vnd.api+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'users', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              data: {
                id: realmURL.href,
                type: 'realm-info',
                attributes: {
                  ...testRealmInfo,
                  visibility: 'shared',
                },
              },
            },
            '/_info response is correct',
          );
        });
      },
    );

    // The counts feed the workspace-chooser favorite tiles' Cards / Files /
    // Definitions row. Asserted as deltas around a write rather than against
    // absolute numbers, so the realm's own scaffolding (index card, realm.json,
    // …) doesn't have to be enumerated here — what matters is that each kind of
    // file lands in exactly one bucket.
    module('index counts', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        permissions: {
          '*': ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        realmURL,
        onRealmSetup,
        fileSystem: {
          'person.gts': `
            import { contains, field, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";
            export class Person extends CardDef {
              @field firstName = contains(StringField);
            }
          `,
          'mango.json': {
            data: {
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
              },
            },
          },
          'notes.txt': 'plain text, not a card and not a definition',
        },
      });

      // Read the counts off the realm directly rather than through `/_info`:
      // that route deliberately serves the plain RealmInfo (see
      // `Realm#realmInfo`), and the detailed variant reaches the UI via the
      // realm server's `/_federated-info` — covered in
      // `server-endpoints/info-test.ts`.
      async function fetchCounts(): Promise<{
        cardCount: number;
        fileCount: number;
        definitionCount: number;
      }> {
        let { cardCount, fileCount, definitionCount } =
          await testRealm.getDetailedRealmInfo();
        return {
          cardCount: cardCount!,
          fileCount: fileCount!,
          definitionCount: definitionCount!,
        };
      }

      test('counts each indexed file as exactly one of cards / files / definitions', async function (assert) {
        let before = await fetchCounts();

        assert.ok(
          before.cardCount >= 1,
          `the seeded instance is counted as a card, got ${before.cardCount}`,
        );
        assert.ok(
          before.definitionCount >= 1,
          `person.gts is counted as a definition, got ${before.definitionCount}`,
        );
        assert.ok(
          before.fileCount >= 1,
          `notes.txt is counted as a file, got ${before.fileCount}`,
        );

        await testRealm.write(
          'vanGogh.json',
          JSON.stringify({
            data: {
              attributes: { firstName: 'Van Gogh' },
              meta: {
                adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
              },
            },
          }),
        );
        let afterInstance = await fetchCounts();
        assert.strictEqual(
          afterInstance.cardCount,
          before.cardCount + 1,
          'writing an instance increments cardCount',
        );
        assert.strictEqual(
          afterInstance.definitionCount,
          before.definitionCount,
          'writing an instance leaves definitionCount alone',
        );
        // An instance is indexed as both an `instance` row and a `file` row at
        // the same url; only the card count may move.
        assert.strictEqual(
          afterInstance.fileCount,
          before.fileCount,
          'writing an instance leaves fileCount alone — its .json is not counted a second time as a file',
        );

        await testRealm.write(
          'pet.gts',
          `
            import { contains, field, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";
            export class Pet extends CardDef {
              @field name = contains(StringField);
            }
          `,
        );
        let afterModule = await fetchCounts();
        assert.strictEqual(
          afterModule.definitionCount,
          afterInstance.definitionCount + 1,
          'writing a .gts module increments definitionCount',
        );
        assert.strictEqual(
          afterModule.cardCount,
          afterInstance.cardCount,
          'writing a .gts module leaves cardCount alone',
        );

        // Deliberately .txt rather than .md: markdown files carry
        // skill-specific indexing behavior, and this assertion is about plain
        // non-module files.
        await testRealm.write('more-notes.txt', 'another plain file');
        let afterFile = await fetchCounts();
        assert.strictEqual(
          afterFile.fileCount,
          afterModule.fileCount + 1,
          'writing a non-module file increments fileCount',
        );
        assert.strictEqual(
          afterFile.definitionCount,
          afterModule.definitionCount,
          'writing a non-module file leaves definitionCount alone',
        );
        assert.strictEqual(
          afterFile.cardCount,
          afterModule.cardCount,
          'writing a non-module file leaves cardCount alone',
        );
      });

      test('createdAt and updatedAt come from the realm registry', async function (assert) {
        let info = await testRealm.getDetailedRealmInfo();
        assertRealmInfoExtras(assert, info as Record<string, unknown>);
      });

      test('the plain /_info route omits the detailed extras', async function (assert) {
        // Guards the fan-out contract above: `/_catalog-realms` issues one
        // `_info` per publicly-readable realm, so this route must stay cheap.
        let response = await request
          .post(new URL('_info', realmURL).pathname)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        for (let key of realmInfoExtraKeys) {
          assert.notOk(
            key in response.body.data.attributes,
            `/_info omits ${key}`,
          );
        }
      });
    });

    module('shared realm because there are multiple users', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'realistic',
        permissions: {
          bob: ['read'],
          jane: ['read'],
          john: ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        realmURL,
        onRealmSetup,
      });

      test('200 with permission', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              id: realmURL.href,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
                visibility: 'shared',
              },
            },
          },
          '/_info response is correct',
        );
      });
    });
  });
});
