import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { join, resolve, basename } from 'path';
import type { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync, existsSync, readJSONSync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import {
  baseRealm,
  SupportedMimeType,
  type LooseSingleCardDocument,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createRealm,
  realmServerTestMatrix,
  realmServerSecretSeed,
  realmSecretSeed,
  grafanaSecret,
  createVirtualNetwork,
  matrixURL,
  closeServer,
  getFastbootState,
  matrixRegistrationSecret,
  testRealmInfo,
  waitUntil,
  testRealmHref,
  testRealmURL,
  createJWT,
  cardInfo,
} from './helpers';
import { expectIncrementalIndexEvent } from './helpers/indexing';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { RealmServer } from '../server';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { PgAdapter } from '@cardstack/postgres';

import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

const testRealm2URL = new URL('http://127.0.0.1:4445/test/');

module(basename(__filename), function () {
  module('Realm-specific Endpoints', function (hooks) {
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

    setupPermissionedRealm(hooks, {
      permissions: {
        '*': ['read', 'write'],
        user: ['read', 'write', 'realm-owner'],
        carol: ['read', 'write'],
      },
      onRealmSetup,
    });

    let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);
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

    test('can set response ETag and Cache-Control headers for module request', async function (assert) {
      let response = await request
        .get(`/person`)
        .set('Accept', SupportedMimeType.All)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.ok(response.headers['etag'], 'ETag header is present');
      assert.strictEqual(
        response.headers['cache-control'],
        'public, max-age=0',
        'cache control header is set correctly',
      );
    });

    test('can set response Cache-Control header for card source request', async function (assert) {
      let response = await request
        .get(`/person.gts`)
        .set('Accept', SupportedMimeType.CardSource)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.ok(response.headers['etag'], 'ETag header is present');
      assert.strictEqual(
        response.headers['cache-control'],
        'public, max-age=0',
        'cache control header is set correctly',
      );
    });

    test('can set response Cache-Control header for card json request', async function (assert) {
      let response = await request
        .get(`/hassan`)
        .set('Accept', SupportedMimeType.CardJson)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.strictEqual(
        response.headers['cache-control'],
        'no-store, no-cache, must-revalidate',
        'cache control header is set correctly',
      );
    });

    test('can set response Cache-Control header for json api request', async function (assert) {
      let response = await request
        .get(`/_info`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.strictEqual(
        response.headers['cache-control'],
        'no-store, no-cache, must-revalidate',
        'cache control header is set correctly',
      );
    });

    module('realm config patch', function (hooks) {
      let realmConfigPath: string;
      let initialConfig: any;

      hooks.beforeEach(function () {
        realmConfigPath = join(
          dir.name,
          'realm_server_1',
          'test',
          '.realm.json',
        );
        initialConfig = existsSync(realmConfigPath)
          ? readJSONSync(realmConfigPath)
          : undefined;
      });

      test('non-owner cannot patch realm config', async function (assert) {
        let response = await request
          .patch('/_info')
          .set('Accept', SupportedMimeType.RealmInfo)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'carol', ['read', 'write'])}`,
          )
          .send({
            data: {
              type: 'realm-info',
              attributes: { property: 'publishable', value: true },
            },
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
        if (initialConfig) {
          assert.deepEqual(
            readJSONSync(realmConfigPath),
            initialConfig,
            '.realm.json was not modified',
          );
        }
      });

      test('realm-owner can patch realm config property', async function (assert) {
        let response = await request
          .patch('/_info')
          .set('Accept', SupportedMimeType.RealmInfo)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'user', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              type: 'realm-info',
              attributes: { property: 'publishable', value: true },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body,
          {
            data: {
              id: testRealmHref,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
                realmUserId: '@node-test_realm:localhost',
                publishable: true,
              },
            },
          },
          'response includes updated realm info',
        );
        assert.deepEqual(
          readJSONSync(realmConfigPath),
          { ...(initialConfig ?? {}), publishable: true },
          '.realm.json contains the updated property',
        );
      });

      test('invalid property returns bad request', async function (assert) {
        let response = await request
          .patch('/_info')
          .set('Accept', SupportedMimeType.RealmInfo)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'user', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              type: 'realm-info',
              attributes: { property: 'realmUserId', value: 'someone' },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        if (initialConfig) {
          assert.deepEqual(
            readJSONSync(realmConfigPath),
            initialConfig,
            '.realm.json remains unchanged',
          );
        }
      });
    });

    test('serves module requests through read-through cache', async function (assert) {
      let modulePath = 'module-cache-test.js';
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(modulePath, `export const value = 1;`);

      let firstResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(firstResponse.status, 200, 'initial request succeeds');
      assert.true(
        /value\s*=\s*1/.test(firstResponse.text),
        'initial payload reflects written module',
      );
      assert.ok(
        ['hit', 'miss'].includes(firstResponse.headers['x-boxel-cache']),
        'initial response indicates cache status',
      );

      let cachedResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(
        cachedResponse.headers['x-boxel-cache'],
        'hit',
        'subsequent request served from cache',
      );

      await testRealm.write(modulePath, `export const value = 2;`);

      let afterWriteResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(
        afterWriteResponse.headers['x-boxel-cache'],
        'miss',
        'cache repopulated after module write',
      );
      assert.true(
        /value\s*=\s*2/.test(afterWriteResponse.text),
        'module response reflects updated content',
      );

      let repopulatedResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(
        repopulatedResponse.headers['x-boxel-cache'],
        'hit',
        'cache hit after repopulation',
      );
      assert.true(
        /value\s*=\s*2/.test(repopulatedResponse.text),
        'cached response preserves updated content',
      );
    });

    const transpileTestCardSource = `
      import {
        linksToMany,
        field,
        Component,
        FieldDef,
      } from 'https://cardstack.com/base/card-api';
      import { Country } from './country';

      export class TranspileTestField extends FieldDef {
        static displayName = 'Trips';
        @field countriesVisited = linksToMany(Country);

        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <address data-test-trips-card>
              <@fields.countriesVisited />
            </address>
          </template>
        };
      }
    `;

    test('serves transpiled .gts modules when Accept is */*', async function (assert) {
      let modulePath = 'transpile-test.gts';
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(modulePath, transpileTestCardSource);

      let response = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(response.status, 200, 'module request succeeds');
      assert.strictEqual(
        response.headers['content-type'],
        'text/javascript',
        'transpiled module advertises javascript content type',
      );
      assert.ok(
        response.text.includes('setComponentTemplate'),
        'compiled output contains compiled template invocation',
      );
      assert.notOk(
        response.text.includes('<template'),
        'raw template markup is not present in compiled output',
      );
    });

    test('module and source variants emit distinct ETags', async function (assert) {
      let modulePath = 'transpile-etag-test.gts';
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(modulePath, transpileTestCardSource);

      let sourceResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', authHeader);

      assert.strictEqual(sourceResponse.status, 200, 'source request succeeds');
      let sourceEtag = sourceResponse.headers['etag'];
      assert.ok(sourceEtag, 'source variant exposes an ETag');

      let moduleResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(moduleResponse.status, 200, 'module request succeeds');
      let moduleEtag = moduleResponse.headers['etag'];
      assert.ok(moduleEtag, 'module variant exposes an ETag');
      assert.notStrictEqual(
        moduleEtag,
        sourceEtag,
        'ETags differ between source and module variants',
      );
      assert.ok(
        moduleResponse.text.includes('setComponentTemplate'),
        'response body is transpiled output',
      );

      let moduleResponseIgnoringSourceEtag = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader)
        .set('If-None-Match', sourceEtag);

      assert.strictEqual(
        moduleResponseIgnoringSourceEtag.status,
        200,
        'module variant ignores ETag from source response',
      );
      assert.strictEqual(
        moduleResponseIgnoringSourceEtag.headers['etag'],
        moduleEtag,
        'module variant reuses its own ETag when revalidated',
      );

      let notModifiedModuleResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader)
        .set('If-None-Match', moduleEtag);

      assert.strictEqual(
        notModifiedModuleResponse.status,
        304,
        'module variant responds with 304 when If-None-Match matches module ETag',
      );
      assert.strictEqual(
        notModifiedModuleResponse.headers['etag'],
        moduleEtag,
        '304 response echoes module variant ETag',
      );
    });

    test('returns 304 for module requests with matching ETag', async function (assert) {
      let modulePath = 'module-cache-not-modified.js';
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(modulePath, `export const flag = true;`);

      let initialResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      let etag = initialResponse.headers['etag'];
      assert.ok(etag, 'initial response includes etag');

      let conditionalResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader)
        .set('If-None-Match', etag!);

      assert.strictEqual(
        conditionalResponse.status,
        304,
        'returns not modified',
      );
      assert.strictEqual(
        conditionalResponse.headers['x-boxel-cache'],
        'hit',
        '304 response served from cache',
      );
    });

    test('invalidating dependencies clears module cache', async function (assert) {
      let depPath = 'module-cache-dep.js';
      let consumerPath = 'module-cache-consumer.js';
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(depPath, `export const value = 'one';`);
      await testRealm.write(
        consumerPath,
        `import { value } from './${depPath}';\nexport default value;`,
      );

      // prime cache
      await request
        .get(`/${consumerPath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      let cachedResponse = await request
        .get(`/${consumerPath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(
        cachedResponse.headers['x-boxel-cache'],
        'hit',
        'consumer module served from cache',
      );

      await testRealm.write(depPath, `export const value = 'two';`);

      let postInvalidationResponse = await request
        .get(`/${consumerPath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(
        postInvalidationResponse.headers['x-boxel-cache'],
        'miss',
        'dependency change invalidates cached consumer module',
      );

      let finalResponse = await request
        .get(`/${consumerPath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(
        finalResponse.headers['x-boxel-cache'],
        'hit',
        'consumer module cache restored after invalidation miss',
      );
    });

    test('module compilation errors return JSON:API response', async function (assert) {
      let modulePath = 'module-cache-error.js';
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(modulePath, 'export default ;');

      let response = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.All)
        .set('Authorization', authHeader);

      assert.strictEqual(response.status, 406, 'returns HTTP 406');
      assert.strictEqual(
        response.headers['content-type'],
        SupportedMimeType.JSONAPI,
        'error response is JSON:API',
      );
      let payload = JSON.parse(response.text);
      assert.true(Array.isArray(payload.errors), 'errors array present');
      assert.strictEqual(
        payload.errors[0]?.status,
        406,
        'error payload encodes 406 status',
      );
    });

    test('can load a module when "last_modified" field in index is null', async function (assert) {
      await dbAdapter.execute('update boxel_index set last_modified = null');
      let response = await request
        .get(`/person`)
        .set('Accept', '*/*')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
    });

    test('can index a newly added file', async function (assert) {
      let realmEventTimestampStart = Date.now();

      let postResponse = await request
        .post('/')
        .set('Accept', 'application/vnd.card+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        )
        .send(
          JSON.stringify({
            data: {
              attributes: {
                firstName: 'Mango',
              },
              meta: {
                adoptsFrom: {
                  module: '/person',
                  name: 'Person',
                },
              },
            },
          }),
        );

      let newCardId = postResponse.body.data.id;
      let newCardPath = new URL(newCardId).pathname;

      assert.ok(
        postResponse.body.data.meta.resourceCreatedAt,
        'created date should be set for new JSON file',
      );
      assert.ok(
        postResponse.headers['x-created'],
        'x-created header should be set for new JSON file',
      );

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);

      let incrementalIndexInitiationEvent = findRealmEvent(
        messages,
        'index',
        'incremental-index-initiation',
      );
      let incrementalEvent = findRealmEvent(messages, 'index', 'incremental');

      assert.deepEqual(incrementalIndexInitiationEvent?.content, {
        eventName: 'index',
        indexType: 'incremental-index-initiation',
        updatedFile: `${newCardId}.json`,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [newCardId],
        clientRequestId: null,
      });

      {
        let response = await request
          .get(newCardPath)
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.ok(json.data.meta.lastModified, 'lastModified exists');
        delete json.data.meta.lastModified;
        delete json.data.meta.resourceCreatedAt;
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          testRealmHref,
          'realm url header is correct',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-public-readable'),
          'true',
          'realm is public readable',
        );
        assert.deepEqual(json, {
          data: {
            id: newCardId,
            type: 'card',
            attributes: {
              title: 'Mango',
              firstName: 'Mango',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            meta: {
              adoptsFrom: {
                module: '/person',
                name: 'Person',
              },
              realmInfo: {
                ...testRealmInfo,
                realmUserId: '@node-test_realm:localhost',
              },
              realmURL: testRealmHref,
            },
            links: {
              self: newCardId,
            },
            relationships: {
              'cardInfo.theme': {
                links: {
                  self: null,
                },
              },
            },
          },
        });
      }
    });

    test('can index a changed file', async function (assert) {
      let realmEventTimestampStart = Date.now();

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let json = response.body as LooseSingleCardDocument;
        assert.strictEqual(
          json.data.attributes?.firstName,
          'Mango',
          'initial firstName value is correct',
        );
      }

      await request
        .patch('/person-1')
        .set('Accept', 'application/vnd.card+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        )
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                firstName: 'Van Gogh',
              },
              meta: {
                adoptsFrom: {
                  module: './person.gts',
                  name: 'Person',
                },
              },
            },
          }),
        );

      await expectIncrementalIndexEvent(
        `${testRealmHref}person-1.json`,
        realmEventTimestampStart,
        {
          assert,
          getMessagesSince,
          realm: testRealmHref,
        },
      );

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let json = response.body as LooseSingleCardDocument;
        assert.strictEqual(
          json.data.attributes?.firstName,
          'Van Gogh',
          'updated firstName value is correct',
        );
      }
    });

    test('can index deleted file', async function (assert) {
      let realmEventTimestampStart = Date.now();

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      await request
        .delete('/person-1')
        .set('Accept', 'application/vnd.card+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);

      let incrementalIndexInitiationEvent = findRealmEvent(
        messages,
        'index',
        'incremental-index-initiation',
      );

      let incrementalEvent = findRealmEvent(messages, 'index', 'incremental');

      assert.deepEqual(incrementalIndexInitiationEvent?.content, {
        eventName: 'index',
        indexType: 'incremental-index-initiation',
        updatedFile: `${testRealmHref}person-1.json`,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmHref}person-1`],
      });

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      }
    });

    test('can make HEAD request to get realmURL and isPublicReadable status', async function (assert) {
      let response = await request
        .head('/person-1')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.headers['x-boxel-realm-url'], testRealmHref);
      assert.strictEqual(
        response.headers['x-boxel-realm-public-readable'],
        'true',
      );
    });
  });

  module('Realm server with realm mounted at the origin', function (hooks) {
    let testRealmServer: Server;

    let request: SuperTest<Test>;

    let dir: DirResult;

    setupBaseRealmServer(hooks, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        let testRealmDir = join(dir.name, 'realm_server_3', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_3'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    test('serves an origin realm directory GET request', async function (assert) {
      let response = await request
        .get('/')
        .set('Accept', 'application/vnd.api+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let json = response.body;
      for (let relationship of Object.values(json.data.relationships)) {
        delete (relationship as any).meta.lastModified;
        delete (relationship as any).meta.resourceCreatedAt;
      }
      assert.deepEqual(
        json,
        {
          data: {
            id: testRealmHref,
            type: 'directory',
            relationships: {
              '%F0%9F%98%80.gts': {
                links: {
                  related: 'http://127.0.0.1:4444/%F0%9F%98%80.gts',
                },
                meta: {
                  kind: 'file',
                },
              },
              'a.js': {
                links: {
                  related: `${testRealmHref}a.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'b.js': {
                links: {
                  related: `${testRealmHref}b.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'c.js': {
                links: {
                  related: `${testRealmHref}c.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'chess-gallery.gts': {
                links: {
                  related: `${testRealmHref}chess-gallery.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'ChessGallery/': {
                links: {
                  related: `${testRealmHref}ChessGallery/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'code-ref-test.gts': {
                links: {
                  related: `${testRealmHref}code-ref-test.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'cycle-one.js': {
                links: {
                  related: `${testRealmHref}cycle-one.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'cycle-two.js': {
                links: {
                  related: `${testRealmHref}cycle-two.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'd.js': {
                links: {
                  related: `${testRealmHref}d.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'deadlock/': {
                links: {
                  related: `${testRealmHref}deadlock/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'dir/': {
                links: {
                  related: `${testRealmHref}dir/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'e.js': {
                links: {
                  related: `${testRealmHref}e.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'f.js': {
                links: {
                  related: `${testRealmHref}f.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'family_photo_card.gts': {
                links: {
                  related: `${testRealmHref}family_photo_card.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'FamilyPhotoCard/': {
                links: {
                  related: `${testRealmHref}FamilyPhotoCard/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'friend-with-used-link.gts': {
                links: {
                  related: `${testRealmHref}friend-with-used-link.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'friend.gts': {
                links: {
                  related: `${testRealmHref}friend.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'g.js': {
                links: {
                  related: `${testRealmHref}g.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'hassan-x.json': {
                links: {
                  related: `${testRealmHref}hassan-x.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'hassan.json': {
                links: {
                  related: `${testRealmHref}hassan.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'home.gts': {
                links: {
                  related: `${testRealmHref}home.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'index.json': {
                links: {
                  related: `${testRealmHref}index.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'jade-x.json': {
                links: {
                  related: `${testRealmHref}jade-x.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'jade.json': {
                links: {
                  related: `${testRealmHref}jade.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'missing-link.json': {
                links: {
                  related: `${testRealmHref}missing-link.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'multiple-default-exports-card.gts': {
                links: {
                  related: `${testRealmHref}multiple-default-exports-card.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'multiple-default-exports-card.json': {
                links: {
                  related: `${testRealmHref}multiple-default-exports-card.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'multiple-default-exports.gts': {
                links: {
                  related: `${testRealmHref}multiple-default-exports.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person-1.json': {
                links: {
                  related: `${testRealmHref}person-1.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person-2.json': {
                links: {
                  related: `${testRealmHref}person-2.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person-with-error.gts': {
                links: {
                  related: `${testRealmHref}person-with-error.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person.gts': {
                links: {
                  related: `${testRealmHref}person.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person.json': {
                links: {
                  related: `${testRealmHref}person.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'PersonCard/': {
                links: {
                  related: `${testRealmHref}PersonCard/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'query-test-cards.gts': {
                links: {
                  related: `${testRealmHref}query-test-cards.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'timers-card.gts': {
                links: {
                  related: `${testRealmHref}timers-card.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'timers-card.json': {
                links: {
                  related: `${testRealmHref}timers-card.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'unused-card.gts': {
                links: {
                  related: `${testRealmHref}unused-card.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
            },
          },
        },
        'the directory response is correct',
      );
    });
  });

  module('Realm server serving multiple realms', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let base: Realm;
    let testRealm: Realm;

    let virtualNetwork = createVirtualNetwork();
    const basePath = resolve(join(__dirname, '..', '..', 'base'));

    hooks.beforeEach(async function () {
      dir = dirSync();
      ensureDirSync(join(dir.name, 'demo'));
      copySync(join(__dirname, 'cards'), join(dir.name, 'demo'));
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        let localBaseRealmURL = new URL('http://127.0.0.1:4446/base/');
        virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

        ({ realm: base } = await createRealm({
          withWorker: true,
          dir: basePath,
          realmURL: baseRealm.url,
          virtualNetwork,
          publisher,
          runner,
          dbAdapter,
          deferStartUp: true,
        }));
        virtualNetwork.mount(base.handle);

        ({ realm: testRealm } = await createRealm({
          withWorker: true,
          dir: join(dir.name, 'demo'),
          virtualNetwork,
          realmURL: 'http://127.0.0.1:4446/demo/',
          publisher,
          runner,
          dbAdapter,
          deferStartUp: true,
        }));
        virtualNetwork.mount(testRealm.handle);

        let matrixClient = new MatrixClient({
          matrixURL: realmServerTestMatrix.url,
          username: realmServerTestMatrix.username,
          seed: realmSecretSeed,
        });
        let getIndexHTML = (await getFastbootState()).getIndexHTML;
        testRealmServer = new RealmServer({
          realms: [base, testRealm],
          virtualNetwork,
          matrixClient,
          realmServerSecretSeed,
          realmSecretSeed,
          grafanaSecret,
          matrixRegistrationSecret,
          realmsRootPath: dir.name,
          dbAdapter,
          queue: publisher,
          getIndexHTML,
          serverURL: new URL('http://127.0.0.1:4446'),
          assetsURL: new URL(`http://example.com/notional-assets-host/`),
        }).listen(parseInt(localBaseRealmURL.port));
        await base.start();
        await testRealm.start();

        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    test(`Can perform full indexing multiple times on a server that runs multiple realms`, async function (assert) {
      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      await base.reindex();
      await testRealm.reindex();

      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      await base.reindex();
      await testRealm.reindex();

      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }
    });
  });

  module('Realm Server serving from a subdirectory', function (hooks) {
    let testRealmServer: Server;

    let request: SuperTest<Test>;

    let dir: DirResult;

    setupBaseRealmServer(hooks, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        dir = dirSync();
        let testRealmDir = join(dir.name, 'realm_server_4', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_4'),
            realmURL: new URL('http://127.0.0.1:4446/demo/'),
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    test('serves a subdirectory GET request that results in redirect', async function (assert) {
      let response = await request.get('/demo');

      assert.strictEqual(response.status, 302, 'HTTP 302 status');
      assert.strictEqual(
        response.headers['location'],
        'http://127.0.0.1:4446/demo/',
      );
    });

    test('redirection keeps query params intact', async function (assert) {
      let response = await request.get(
        '/demo?operatorModeEnabled=true&operatorModeState=%7B%22stacks%22%3A%5B%7B%22items%22%3A%5B%7B%22card%22%3A%7B%22id%22%3A%22http%3A%2F%2Flocalhost%3A4204%2Findex%22%7D%2C%22format%22%3A%22isolated%22%7D%5D%7D%5D%7D',
      );

      assert.strictEqual(response.status, 302, 'HTTP 302 status');
      assert.strictEqual(
        response.headers['location'],
        'http://127.0.0.1:4446/demo/?operatorModeEnabled=true&operatorModeState=%7B%22stacks%22%3A%5B%7B%22items%22%3A%5B%7B%22card%22%3A%7B%22id%22%3A%22http%3A%2F%2Flocalhost%3A4204%2Findex%22%7D%2C%22format%22%3A%22isolated%22%7D%5D%7D%5D%7D',
      );
    });
  });
});

async function waitForIncrementalIndexEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
) {
  try {
    await waitUntil(async () => {
      let matrixMessages = await getMessagesSince(since);

      return matrixMessages.some(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === 'incremental',
      );
    });
  } catch (e) {
    let matrixMessages = await getMessagesSince(since);

    console.log('waitForIncrementalIndexEvent failed, no event found. Events:');
    console.log(JSON.stringify(matrixMessages, null, 2));
    throw e;
  }
}

function findRealmEvent(
  events: MatrixEvent[],
  eventName: string,
  indexType: string,
): RealmEvent | undefined {
  return events.find(
    (m) =>
      m.type === APP_BOXEL_REALM_EVENT_TYPE &&
      m.content.eventName === eventName &&
      (realmEventIsIndex(m.content) ? m.content.indexType === indexType : true),
  ) as RealmEvent | undefined;
}

function realmEventIsIndex(
  event: RealmEventContent,
): event is IncrementalIndexEventContent {
  return event.eventName === 'index';
}
