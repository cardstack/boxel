import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { join, resolve, basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import { dirSync, type DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync, readFileSync, readJSONSync } = fsExtra;
import { utimesSync } from 'fs';
import type { Realm } from '@cardstack/runtime-common';
import {
  baseRealm,
  baseRealmRRI,
  baseRRI,
  CachingDefinitionLookup,
  SupportedMimeType,
  type LooseSingleCardDocument,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import {
  acquireBaseRealmTemplate,
  withIndexProgressHeartbeat,
  setupPermissionedRealmCached,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createRealm,
  fixtureDir,
  realmServerTestMatrix,
  realmServerSecretSeed,
  realmSecretSeed,
  grafanaSecret,
  createVirtualNetwork,
  matrixURL,
  closeServer,
  getIndexHTML,
  makeTestReconciler,
  matrixRegistrationSecret,
  testRealmInfo,
  testRealmHref,
  createJWT,
  cardInfo,
  getTestPrerenderer,
  testCreatePrerenderAuth,
  type RealmRequest,
  withRealmPath,
} from './helpers/index.ts';
import {
  expectIncrementalIndexEvent,
  waitForIncrementalIndexEvent,
} from './helpers/indexing.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { RealmServer } from '../server.ts';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { PgAdapter } from '@cardstack/postgres';

import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

const testRealm2URL = new URL('http://127.0.0.1:4445/test/');

module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealmURL = realmURL;
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let testRealmPath: string;
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
      testRealmPath: string;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      testRealmPath = args.testRealmPath;
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
        user: ['read', 'write', 'realm-owner'],
        carol: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      realmURL,
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
        copySync(fixtureDir('simple'), testRealmDir);
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
      // Card+json is now ETag-cacheable (CS-11010): the realm advertises
      // public/private + max-age=0 + must-revalidate so browsers always
      // revalidate, but a matching If-None-Match short-circuits to 304.
      assert.strictEqual(
        response.headers['cache-control'],
        'public, max-age=0, must-revalidate',
        'cache control header is set correctly',
      );
      assert.ok(response.headers['etag'], 'ETag header is present');
    });

    test('serves file meta with dedicated accept header', async function (assert) {
      let response = await request
        .get(`/person.gts`)
        .set('Accept', SupportedMimeType.FileMeta)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(
        response.headers['content-type']?.startsWith(
          SupportedMimeType.FileMeta,
        ),
        'content-type uses file meta mime type',
      );
      let json = response.body as LooseSingleCardDocument;
      assert.strictEqual(json.data.type, 'file-meta');
      assert.strictEqual(json.data.attributes?.name, 'person.gts');
      assert.deepEqual(json.data.meta?.adoptsFrom, {
        module: baseRRI('gts-file-def'),
        name: 'GtsFileDef',
      });
    });

    test('serves markdown file meta subclass for noCache requests', async function (assert) {
      await testRealm.write(
        'guide.md',
        '# Guide\n\nThis markdown file should resolve to MarkdownDef.',
      );

      let response = await request
        .get(`/guide.md?noCache=true`)
        .set('Accept', SupportedMimeType.FileMeta)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(
        response.headers['content-type']?.startsWith(
          SupportedMimeType.FileMeta,
        ),
        'content-type uses file meta mime type',
      );
      let json = response.body as LooseSingleCardDocument;
      assert.strictEqual(json.data.type, 'file-meta');
      assert.strictEqual(json.data.attributes?.name, 'guide.md');
      assert.deepEqual(json.data.meta?.adoptsFrom, {
        module: baseRRI('markdown-file-def'),
        name: 'MarkdownDef',
      });
    });

    test('file meta for markdown with card references stores cardReferenceUrls', async function (assert) {
      let response = await request
        .get(`/card-refs.md`)
        .set('Accept', SupportedMimeType.FileMeta)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      let json = response.body;
      assert.strictEqual(json.data.type, 'file-meta');
      assert.deepEqual(json.data.meta?.adoptsFrom, {
        module: `${baseRealmRRI}markdown-file-def`,
        name: 'MarkdownDef',
      });

      let cardReferenceUrls = json.data.attributes?.cardReferenceUrls;
      assert.ok(
        Array.isArray(cardReferenceUrls),
        'cardReferenceUrls attribute is present',
      );
      assert.true(
        cardReferenceUrls.some((url: string) => url.includes('hassan')),
        'cardReferenceUrls includes hassan',
      );
      assert.true(
        cardReferenceUrls.some((url: string) => url.includes('jade')),
        'cardReferenceUrls includes jade',
      );
    });

    test('sets canonical path header for nested module requests', async function (assert) {
      let response = await request
        .get(`/nested/example`)
        .set('Accept', SupportedMimeType.All)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );

      assert.strictEqual(
        response.status,
        200,
        'module request succeeds for nested module',
      );
      assert.strictEqual(
        response.headers['x-boxel-canonical-path'],
        `${testRealmURL}nested/example.js`,
        'canonical path header includes full nested path with realm origin',
      );
    });

    test('can set response Cache-Control header for json api request', async function (assert) {
      let response = await request
        .post(`/_info`)
        .set('X-HTTP-Method-Override', 'QUERY')
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

    // Regression test for the flaky `atomic-endpoints-test > can update an
    // existing instance` failure. The bug: source ETags were keyed by
    // `lastModified` in whole unix seconds, so two writes landing in the
    // same second produced identical ETags — `cachedFetch` then returned
    // a 304-cached stale body. Force the same on-disk mtime across two
    // different writes and assert the source ETag is content-derived.
    test('source ETag distinguishes content even when on-disk lastModified collides', async function (assert) {
      let modulePath = 'etag-collision-test.json';
      let initial = JSON.stringify({ value: 'initial' });
      let updated = JSON.stringify({ value: 'updated' });
      // Both writes are pinned to the same wall-clock second below.
      let collidingMtime = new Date('2026-01-01T00:00:00Z');
      let absolutePath = join(testRealmPath, modulePath);
      let authHeader = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;

      await testRealm.write(modulePath, initial);
      utimesSync(absolutePath, collidingMtime, collidingMtime);

      let firstResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', authHeader);
      assert.strictEqual(firstResponse.status, 200, 'first request succeeds');
      let firstEtag = firstResponse.headers['etag'];
      assert.ok(firstEtag, 'first response carries an ETag');

      await testRealm.write(modulePath, updated);
      utimesSync(absolutePath, collidingMtime, collidingMtime);

      let secondResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', authHeader);
      assert.strictEqual(secondResponse.status, 200, 'second request succeeds');
      let secondEtag = secondResponse.headers['etag'];
      assert.ok(secondEtag, 'second response carries an ETag');

      assert.notStrictEqual(
        firstEtag,
        secondEtag,
        'distinct content yields distinct ETags despite identical lastModified',
      );

      let conditionalResponse = await request
        .get(`/${modulePath}`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', authHeader)
        .set('If-None-Match', firstEtag);
      assert.strictEqual(
        conditionalResponse.status,
        200,
        'conditional GET with the prior ETag must not return 304',
      );
      assert.strictEqual(
        conditionalResponse.text.trim(),
        updated,
        'conditional GET serves the updated body, not the cached prior body',
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
        .send({
          data: {
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: '../person.gts',
                name: 'Person',
              },
            },
          },
        });

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
        realmURL: testRealmHref,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [newCardId],
        clientRequestId: null,
        realmURL: testRealmHref,
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
              cardTitle: 'Mango',
              firstName: 'Mango',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
              realmInfo: testRealmInfo,
              realmURL: testRealmHref,
            },
            links: {
              self: newCardId,
            },
            relationships: {
              'cardInfo.cardThumbnail': {
                links: {
                  self: null,
                },
              },
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
        realmURL: testRealmHref,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmHref}person-1`],
        realmURL: testRealmHref,
      });

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      }
    });

    test('emits update event with added when creating a file via API', async function (assert) {
      let realmEventTimestampStart = Date.now();

      await request
        .post('/')
        .set('Accept', 'application/vnd.card+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        )
        .send({
          data: {
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: '../person.gts',
                name: 'Person',
              },
            },
          },
        });

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);
      let updateEvent = messages.find(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'update' &&
          'added' in m.content,
      ) as RealmEvent | undefined;

      assert.ok(updateEvent, 'update event with added was emitted');
      let content = updateEvent!.content as UpdateRealmEventContent;
      assert.strictEqual(content.eventName, 'update');
      assert.true('added' in content, 'event has added field');
      if ('added' in content) {
        assert.strictEqual(content.added!.length, 1, 'one file was added');
        assert.ok(
          content.added![0].endsWith('.json'),
          'added field contains the new file path',
        );
      }
      assert.strictEqual(
        content.realmURL,
        testRealmHref,
        'realmURL is correct',
      );
    });

    test('emits update event with updated when patching a file via API', async function (assert) {
      let realmEventTimestampStart = Date.now();

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

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);
      let updateEvent = messages.find(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'update' &&
          'updated' in m.content,
      ) as RealmEvent | undefined;

      assert.ok(updateEvent, 'update event with updated was emitted');
      let content = updateEvent!.content as UpdateRealmEventContent;
      assert.strictEqual(content.eventName, 'update');
      assert.true('updated' in content, 'event has updated field');
      if ('updated' in content) {
        assert.deepEqual(
          content.updated,
          ['person-1.json'],
          'updated field contains the changed file path',
        );
      }
      assert.strictEqual(
        content.realmURL,
        testRealmHref,
        'realmURL is correct',
      );
    });

    test('emits update event with removed when deleting a file via API', async function (assert) {
      let realmEventTimestampStart = Date.now();

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
      let updateEvent = messages.find(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'update' &&
          'removed' in m.content,
      ) as RealmEvent | undefined;

      assert.ok(updateEvent, 'update event with removed was emitted');
      let content = updateEvent!.content as UpdateRealmEventContent;
      assert.strictEqual(content.eventName, 'update');
      assert.true('removed' in content, 'event has removed field');
      if ('removed' in content) {
        assert.deepEqual(
          content.removed,
          ['person-1.json'],
          'removed field contains the deleted file path',
        );
      }
      assert.strictEqual(
        content.realmURL,
        testRealmHref,
        'realmURL is correct',
      );
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
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      permissions: { '*': ['read'] },
      onRealmSetup(args) {
        request = args.request;
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
              'card-refs.md': {
                links: {
                  related: `${testRealmHref}card-refs.md`,
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
              'hello.test.gts': {
                links: {
                  related: `${testRealmHref}hello.test.gts`,
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
              'nested/': {
                links: {
                  related: `${testRealmHref}nested/`,
                },
                meta: {
                  kind: 'directory',
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
              'realm.json': {
                links: {
                  related: `${testRealmHref}realm.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'sample.md': {
                links: {
                  related: `${testRealmHref}sample.md`,
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
    const basePath = resolve(join(import.meta.dirname, '..', '..', 'base'));
    const demoFileSystem: Record<string, string | LooseSingleCardDocument> = {
      'realm.json': readJSONSync(join(fixtureDir('realistic'), 'realm.json')),
      'person.gts': readFileSync(
        join(fixtureDir('realistic'), 'person.gts'),
        'utf8',
      ),
      'person-1.json': readJSONSync(
        join(fixtureDir('realistic'), 'person-1.json'),
      ),
    };

    let dbAdapter: PgAdapter;
    let baseRealmTemplateDatabase: string | undefined;
    let savedTestTimeout: number | null | undefined;

    // Build a base-realm-indexed template database once, up front, and clone
    // it per test (see `templateDatabase` below). Cold-indexing the whole base
    // realm through the single-tab in-process prerenderer takes tens of
    // seconds; doing it inline in each test's `beforeEach` rode the per-phase
    // `QUnit.config.testTimeout` and timed out under CI load — and the killed
    // `beforeEach` left `request` undefined, surfacing as a downstream
    // TypeError in the test body. With base pre-indexed, `base.start()` is a
    // no-op (`isNewIndex()` is false), so the cold index leaves the per-test
    // path entirely.
    //
    // The test body still fully re-indexes the realms several times, which is
    // the behavior under test; a from-scratch index clears the realm's
    // definition cache on completion, so each `reindex()` legitimately
    // re-renders base. That work, plus the one-time build, needs more than the
    // default per-phase timeout, so raise it for this module and restore it
    // afterwards. The `withIndexProgressHeartbeat` wrappers keep a stalled or
    // unexpectedly slow index diagnosable instead of an opaque phase timeout.
    hooks.before(function () {
      savedTestTimeout = QUnit.config.testTimeout;
      QUnit.config.testTimeout = 240_000;
    });
    hooks.before(async function () {
      baseRealmTemplateDatabase = await acquireBaseRealmTemplate(
        basePath,
        await getTestPrerenderer(),
      );
    });
    hooks.after(function () {
      QUnit.config.testTimeout = savedTestTimeout;
    });

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      templateDatabase: () => baseRealmTemplateDatabase,
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        let localBaseRealmURL = new URL('http://127.0.0.1:4446/base/');
        let prerenderer = await getTestPrerenderer();
        let definitionLookup = new CachingDefinitionLookup(
          dbAdapter,
          prerenderer,
          virtualNetwork,
          testCreatePrerenderAuth,
        );
        virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);
        virtualNetwork.addRealmMapping(
          '@cardstack/base/',
          localBaseRealmURL.href,
        );

        ({ realm: base } = await createRealm({
          definitionLookup,
          withWorker: true,
          prerenderer,
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
          definitionLookup,
          withWorker: true,
          prerenderer,
          dir: join(dir.name, 'demo'),
          fileSystem: demoFileSystem,
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
        testRealmServer = new RealmServer({
          realms: [base, testRealm],
          reconciler: makeTestReconciler(dbAdapter, [base, testRealm]),
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
          definitionLookup,
          prerenderer,
        }).listen(parseInt(localBaseRealmURL.port));
        // base.start() is a no-op now that the cloned template already holds
        // base's index; demo is the only realm cold-indexed here. The
        // heartbeat keeps a future regression (base no longer skipping, an
        // index wedging) diagnosable instead of an opaque phase timeout.
        await withIndexProgressHeartbeat(
          'multiple realms beforeEach (base + demo start)',
          dbAdapter,
          async () => {
            await base.start();
            await testRealm.start();
          },
        );

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

      await withIndexProgressHeartbeat(
        'multiple realms reindex (base + demo)',
        dbAdapter,
        async () => {
          await base.reindex();
          await testRealm.reindex();
        },
      );

      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      await withIndexProgressHeartbeat(
        'multiple realms reindex (base + demo)',
        dbAdapter,
        async () => {
          await base.reindex();
          await testRealm.reindex();
        },
      );

      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }
    });
  });

  module('Realm Server serving from a subdirectory', function (hooks) {
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'simple',
      permissions: { '*': ['read'] },
      realmURL: new URL('http://127.0.0.1:4446/demo/'),
      onRealmSetup(args) {
        request = args.request;
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
