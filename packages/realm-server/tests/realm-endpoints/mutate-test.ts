import QUnit from 'qunit';
const { module, test } = QUnit;
import { join, basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { existsSync, readJSONSync } = fsExtra;
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../../server.ts';
import {
  setupPermissionedRealmCached,
  closeServer,
  type RealmRequest,
  withRealmPath,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm-specific Endpoints | POST /_mutate', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;
    let dir: DirResult;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = withRealmPath(args.request, realmURL);
      dir = args.dir;
    }

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('public writable realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'realistic',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('applies a BXL mutation as an alternative to PATCH', async function (assert) {
        let response = await request
          .post('/_mutate')
          .send({
            href: '/person-1',
            source: '.firstName = "Van Gogh";',
            syntax: 'solidified',
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 204, `HTTP 204: ${response.text}`);
        assert.ok(
          response.get('x-created'),
          'created header is set for the updated card',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          testRealmHref,
          'realm url header is correct',
        );

        assert.ok(
          response.get('last-modified'),
          'lastModified is returned for the durable source write',
        );

        let cardFile = join(
          dir.name,
          'realm_server_1',
          'test',
          'person-1.json',
        );
        assert.ok(existsSync(cardFile), 'card json exists');
        let card = readJSONSync(cardFile);
        assert.deepEqual(
          card,
          {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Van Gogh',
              },
              meta: {
                adoptsFrom: {
                  module: rri(`./person`),
                  name: 'Person',
                },
              },
            },
          },
          'file contents are the mutated source, not a reprinted PATCH document',
        );
      });

      test('rejects invalid mutation BXL without writing the file', async function (assert) {
        let cardFile = join(
          dir.name,
          'realm_server_1',
          'test',
          'person-1.json',
        );
        let before = readJSONSync(cardFile);

        let response = await request
          .post('/_mutate')
          .send({
            href: '/person-1',
            source: '.firstName =',
            syntax: 'solidified',
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 400, `HTTP 400: ${response.text}`);
        assert.deepEqual(
          readJSONSync(cardFile),
          before,
          'invalid BXL leaves the stored file unchanged',
        );
      });

      test('returns 404 when the target instance is missing', async function (assert) {
        let response = await request
          .post('/_mutate')
          .send({
            href: '/does-not-exist',
            source: '.firstName = "Nope";',
            syntax: 'solidified',
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 404, `HTTP 404: ${response.text}`);
      });

      test('appends a linksToMany relationship without reprinting the card', async function (assert) {
        let writeFriend = async (id: string, firstName: string) => {
          await testRealm.write(
            `Friend/${id}.json`,
            JSON.stringify({
              data: {
                type: 'card',
                attributes: { firstName },
                meta: {
                  adoptsFrom: {
                    module: '../friend',
                    name: 'Friend',
                  },
                },
              },
            }),
          );
        };
        await writeFriend('bxl-owner', 'Ada');
        await writeFriend('bxl-peer', 'Grace');

        let ownerPath = '/Friend/bxl-owner';
        let peerURL = `${testRealmHref}Friend/bxl-peer`;

        let response = await request
          .post('/_mutate')
          .send({
            href: ownerPath,
            source: `append(.friends; card("${peerURL}"));`,
            syntax: 'solidified',
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 204, `HTTP 204: ${response.text}`);

        let ownerFile = join(
          dir.name,
          'realm_server_1',
          'test',
          'Friend',
          'bxl-owner.json',
        );
        let stored = readJSONSync(ownerFile);
        assert.strictEqual(
          stored.data.attributes?.firstName,
          'Ada',
          'untouched fields remain as stored',
        );
        assert.strictEqual(
          stored.data.relationships?.['friends.0']?.links?.self,
          './bxl-peer',
          'the mutated relationship is written to disk',
        );
        assert.deepEqual(
          stored.data.meta,
          {
            adoptsFrom: {
              module: '../friend',
              name: 'Friend',
            },
          },
          'adoptsFrom is unchanged',
        );
      });
    });
  });
});
