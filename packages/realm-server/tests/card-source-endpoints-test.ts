import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync } = fsExtra;
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import {
  RealmPaths,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  createJWT,
  cardInfo,
  fixtureDir,
  type RealmRequest,
  withRealmPath,
} from './helpers/index.ts';
import { query, param } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  expectIncrementalIndexEvent,
  maxPrerenderHtmlJobId,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import stripScopedCSSGlimmerAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-glimmer-attributes';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { MatrixEvent } from '@cardstack/base/matrix-event';
import { isEqual } from 'lodash-es';

module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | card source requests', function () {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealmURL = realmURL;
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;
    let serverRequest: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
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

    module('card source GET request', function (_hooks) {
      module('public readable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('serves the request', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
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
          let result = response.text.trim();
          assert.strictEqual(result, cardSrc, 'the card source is correct');
          assert.ok(
            response.headers['last-modified'],
            'last-modified header exists',
          );
        });

        test('caches responses and invalidates on write', async function (assert) {
          let cacheTestPath = 'cache-test.gts';
          let initialContent = '// initial cache test content';

          await testRealm.write(cacheTestPath, initialContent);

          let firstResponse = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            firstResponse.status,
            200,
            'initial request succeeds',
          );
          assert.strictEqual(
            firstResponse.text,
            initialContent,
            'initial response body matches',
          );
          let cachedResponse = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            cachedResponse.status,
            200,
            'second request succeeds',
          );
          assert.strictEqual(
            cachedResponse.headers['x-boxel-cache'],
            'hit',
            'second request served from cache',
          );
          assert.strictEqual(
            cachedResponse.text,
            initialContent,
            'cached response matches original content',
          );

          let updatedContent = `${initialContent}\n// updated by test`;
          await testRealm.write(cacheTestPath, updatedContent);

          let afterWriteResponse = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            afterWriteResponse.status,
            200,
            'request after write succeeds',
          );
          assert.strictEqual(
            afterWriteResponse.text,
            updatedContent,
            'response reflects updated content',
          );

          let repopulatedResponse = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            repopulatedResponse.status,
            200,
            'subsequent request succeeds',
          );
          assert.strictEqual(
            repopulatedResponse.headers['x-boxel-cache'],
            'hit',
            'cache repopulated after miss',
          );
          assert.strictEqual(
            repopulatedResponse.text,
            updatedContent,
            'cached response returns updated content',
          );
        });

        test('supports noCache query param to bypass cache', async function (assert) {
          let cacheTestPath = 'cache-test-nocache.gts';
          let initialContent = '// initial cache test content';

          // Each write's index pass fires a fire-and-forget `prerender_html`
          // job whose worker re-reads this module with the card+source Accept
          // header — a read that repopulates #sourceCache. write() returns
          // without awaiting that job, so its seed can land at any later
          // moment, including between the noCache request below (which drops
          // the entry) and the follow-up read that asserts a miss, turning the
          // expected miss into a spurious hit. Settle the prerender-html
          // channel after every write, keyed off a pre-write baseline so the
          // fire-and-forget enqueue can't be missed, leaving no such job in
          // flight during the assertions.
          let beforeInitial = await maxPrerenderHtmlJobId(
            dbAdapter,
            testRealm.url,
          );
          await testRealm.write(cacheTestPath, initialContent);
          await settlePrerenderHtmlJobs(dbAdapter, testRealm.url, {
            afterJobId: beforeInitial,
          });

          await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');

          let updatedContent = `${initialContent}\n// updated by test`;
          let beforeUpdate = await maxPrerenderHtmlJobId(
            dbAdapter,
            testRealm.url,
          );
          await testRealm.write(cacheTestPath, updatedContent);
          await settlePrerenderHtmlJobs(dbAdapter, testRealm.url, {
            afterJobId: beforeUpdate,
          });

          let noCacheResponse = await request
            .get(`/${cacheTestPath}?noCache=true`)
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            noCacheResponse.status,
            200,
            'noCache request succeeds',
          );
          assert.strictEqual(
            noCacheResponse.headers['x-boxel-cache'],
            'miss',
            'noCache request reported cache miss',
          );
          assert.strictEqual(
            noCacheResponse.text,
            updatedContent,
            'noCache request sees updated content',
          );

          let cachedResponse = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            cachedResponse.headers['x-boxel-cache'],
            'miss',
            `subsequent request fetches from disk because noCache call did not seed cache (got x-boxel-cache=${cachedResponse.headers['x-boxel-cache']}, body=${JSON.stringify(cachedResponse.text)}) — a hit here means something re-seeded #sourceCache after the noCache drop, e.g. a prerender_html job that outlived the settle`,
          );
          assert.strictEqual(
            cachedResponse.text,
            updatedContent,
            'cache serves updated content after miss repopulates cache',
          );
        });

        // CS-11043. clearLocalSourceCaches() is the public surface the
        // publish-realm handler invokes after the FS swap so that the
        // pre-swap bytes living in #sourceCache / #transpiledModuleCache don't get
        // served to the reindex job (which would then write stale
        // isolated_html into boxel_index). Functionally equivalent to
        // __testOnlyClearCaches minus the test-only transpile-counter
        // reset.
        test('clearLocalSourceCaches drops cached source bytes', async function (assert) {
          let cacheTestPath = 'clear-local-caches.gts';
          // Settle the fire-and-forget prerender_html job the write spawns
          // before we clear the cache: that job re-reads the module with the
          // card+source Accept header and reseeds #sourceCache, so if it lands
          // after clearLocalSourceCaches() the afterClear fetch would be a
          // spurious hit rather than the miss this test asserts. The baseline
          // keys the settle to the job this write spawns so the fire-and-forget
          // enqueue can't be missed.
          let beforeWrite = await maxPrerenderHtmlJobId(
            dbAdapter,
            testRealm.url,
          );
          await testRealm.write(
            cacheTestPath,
            '// clear-local-caches initial content',
          );
          await settlePrerenderHtmlJobs(dbAdapter, testRealm.url, {
            afterJobId: beforeWrite,
          });

          await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');
          let warmed = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');
          assert.strictEqual(
            warmed.headers['x-boxel-cache'],
            'hit',
            'precondition: second fetch hits the source cache',
          );

          testRealm.clearLocalSourceCaches();

          let afterClear = await request
            .get(`/${cacheTestPath}`)
            .set('Accept', 'application/vnd.card+source');
          assert.strictEqual(
            afterClear.headers['x-boxel-cache'],
            'miss',
            `fetch after clearLocalSourceCaches is a miss — the #sourceCache entry was dropped (got x-boxel-cache=${afterClear.headers['x-boxel-cache']})`,
          );
        });

        test('serves a card-source GET request that results in redirect', async function (assert) {
          let response = await request
            .get('/person')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(
            response.headers['location'],
            new URL('person.gts', realmURL).pathname,
          );
        });

        test('serves a card instance GET request with card-source accept header that results in redirect', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(
            response.headers['location'],
            new URL('person-1.json', realmURL).pathname,
          );
        });

        test('serves source of a card module that is in error state', async function (assert) {
          let response = await request
            .get('/person-with-error.gts')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(
            response.headers['content-type'],
            'text/typescript+glimmer',
            'content type is correct for .gts source',
          );
          assert.strictEqual(
            readFileSync(
              join(fixtureDir('realistic'), 'person-with-error.gts'),
              {
                encoding: 'utf8',
              },
            ),
            response.text,
            'the card source is correct',
          );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });

        test('serves a card instance GET request with a .json extension and json accept header that results in redirect', async function (assert) {
          let response = await request
            .get('/person.json')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(
            response.headers['location'],
            new URL('person', realmURL).pathname,
          );
        });

        test('serves a module GET request', async function (assert) {
          let response = await request.get('/person');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm URL header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let body = response.text.trim();

          // Remove platform-dependent id, from https://github.com/emberjs/babel-plugin-ember-template-compilation/blob/d67cca121cfb3bbf5327682b17ed3f2d5a5af528/__tests__/tests.ts#LL1430C1-L1431C1
          body = stripScopedCSSGlimmerAttributes(
            body.replace(/"id":\s"[^"]+"/, '"id": "<id>"'),
          );

          assert.codeEqual(
            body,
            compiledCard('"<id>"', '/person.gts'),
            'module JS is correct',
          );
        });

        test('resolves dotted filenames without extension (e.g., hello.test -> hello.test.gts)', async function (assert) {
          // Filenames with dots like "hello.test.gts" must be resolvable
          // when requested without the .gts extension. The realm server must
          // not treat ".test" as a file extension and skip the .gts fallback.
          let response = await request.get('/hello.test');
          assert.strictEqual(
            response.status,
            200,
            'dotted filename resolves: GET /hello.test finds hello.test.gts',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });
    });

    module('card source HEAD request', function (_hooks) {
      module('public readable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('serves the request', async function (assert) {
          let response = await request
            .head('/person.gts')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
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
          assert.notOk(response.text, 'no body in HEAD response');
        });

        test('serves a card-source HEAD request that results in redirect', async function (assert) {
          let response = await request
            .head('/person')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(
            response.headers['location'],
            new URL('person.gts', realmURL).pathname,
          );
        });

        test('serves a card-source HEAD request for a regular file without redirect', async function (assert) {
          await testRealm.write('notes.md', '# Notes\n');

          let response = await request
            .head('/notes.md')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
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
          assert.notOk(response.headers['location'], 'no redirect location');
        });
      });
    });

    module('card-source DELETE request', function (_hooks) {
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

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        test('serves the request', async function (assert) {
          let entry = 'unused-card.gts';

          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
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
          let cardFile = join(dir.name, entry);
          assert.false(existsSync(cardFile), 'card module does not exist');
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source');

          await expectIncrementalIndexEvent(
            `${testRealmURL}unused-card.gts`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
            },
          );
        });

        test('serves a card-source DELETE request for a card instance', async function (assert) {
          let entry = 'person-1';
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
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
          let cardFile = join(dir.name, entry);
          assert.false(existsSync(cardFile), 'card instance does not exist');
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'realistic',
          realmURL,
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission', async function (assert) {
          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        });
      });
    });

    module('card-source POST request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        test('serves a card-source POST request', async function (assert) {
          let entry = 'unused-card.gts';
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`);

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.ok(
            response.headers['x-created'],
            'created date should be set for new GTS file',
          );
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

          let srcFile = join(dir.name, 'realm_server_1', 'test', entry);
          assert.ok(existsSync(srcFile), 'card src exists');
          let src = readFileSync(srcFile, { encoding: 'utf8' });
          assert.codeEqual(
            src,
            `//TEST UPDATE
          ${cardSrc}`,
          );
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`);

          await expectIncrementalIndexEvent(
            `${testRealmURL}unused-card.gts`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
            },
          );
        });

        test('serves a card-source POST request for a .txt file', async function (assert) {
          let response = await request
            .post('/hello-world.txt')
            .set('Accept', 'application/vnd.card+source')
            .send(`Hello World`);

          assert.strictEqual(response.status, 204, 'HTTP 204 status');

          let fileResponse = await request
            .get('/hello-world.txt')
            .set('Accept', 'application/vnd.card+source');
          assert.ok(
            fileResponse.headers['x-created'],
            'created date should be set for new TXT file',
          );

          let txtFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'hello-world.txt',
          );
          assert.ok(existsSync(txtFile), 'file exists');
          let src = readFileSync(txtFile, { encoding: 'utf8' });
          assert.strictEqual(src, 'Hello World');
        });

        test('removes file meta on delete', async function (assert) {
          // ensure an existing file (write like hello-world first)
          let reqPath = '/hello-world.txt';
          let dbPath = 'hello-world.txt';
          let post = await request
            .post(reqPath)
            .set('Accept', 'application/vnd.card+source')
            .send('hello-world');
          assert.strictEqual(post.status, 204, 'HTTP 204 status');
          assert.ok(
            post.headers['x-created'],
            'created header present on POST',
          );

          // row exists in realm_file_meta
          let rowsBefore = await query(dbAdapter, [
            'SELECT created_at FROM realm_file_meta WHERE realm_url =',
            param(testRealmHref),
            'AND file_path =',
            param(dbPath),
          ]);
          assert.strictEqual(
            rowsBefore.length,
            1,
            'meta row exists after POST',
          );

          // delete the file
          let del = await request
            .delete(reqPath)
            .set('Accept', 'application/vnd.card+source');
          assert.strictEqual(del.status, 204, 'HTTP 204 status');

          // row removed from realm_file_meta
          let rowsAfter = await query(dbAdapter, [
            'SELECT 1 FROM realm_file_meta WHERE realm_url =',
            param(testRealmHref),
            'AND file_path =',
            param(dbPath),
          ]);
          assert.strictEqual(
            rowsAfter.length,
            0,
            'meta row removed after DELETE',
          );
        });

        test('can serialize a card instance correctly after card definition is changed', async function (assert) {
          let realmEventTimestampStart = Date.now();

          // create a card def
          {
            let response = await request
              .post('/test-card.gts')
              .set('Accept', 'application/vnd.card+source').send(`
                import { contains, field, CardDef } from '@cardstack/base/card-api';
                import StringField from '@cardstack/base/string';

                export class TestCard extends CardDef {
                  @field field1 = contains(StringField);
                  @field field2 = contains(StringField);
                }
              `);

            assert.strictEqual(response.status, 204, 'HTTP 204 status');
          }

          // make an instance of the card def
          let maybeId: string | undefined;
          {
            let response = await request
              .post('/')
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    field1: 'a',
                    field2: 'b',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${testRealmURL}test-card`,
                      name: 'TestCard',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            maybeId = response.body.data.id;
          }
          if (!maybeId) {
            assert.ok(false, 'new card identifier was undefined');
            // eslint-disable-next-line qunit/no-early-return
            return;
          }
          let id = maybeId;

          // modify field
          {
            let response = await request
              .post('/test-card.gts')
              .set('Accept', 'application/vnd.card+source').send(`
                import { contains, field, CardDef } from '@cardstack/base/card-api';
                import StringField from '@cardstack/base/string';

                export class TestCard extends CardDef {
                  @field field1 = contains(StringField);
                  @field field2a = contains(StringField); // rename field2 -> field2a
                }
              `);

            assert.strictEqual(response.status, 204, 'HTTP 204 status');
          }

          // verify serialization matches new card def
          {
            let response = await request
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.deepEqual(json.data.attributes, {
              field1: 'a',
              field2a: null,
              cardTitle: 'Untitled Card',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            });
          }

          // set value on renamed field
          {
            let response = await request
              .patch(new URL(id).pathname)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    field2a: 'c',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${testRealmURL}test-card`,
                      name: 'TestCard',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
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

            let json = response.body;
            assert.deepEqual(json.data.attributes, {
              field1: 'a',
              field2a: 'c',
              cardTitle: 'Untitled Card',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            });
          }

          // verify file serialization is correct
          {
            let localPath = new RealmPaths(testRealmURL).local(new URL(id));
            let jsonFile = `${join(
              dir.name,
              'realm_server_1',
              'test',
              localPath,
            )}.json`;
            let doc = JSON.parse(
              readFileSync(jsonFile, { encoding: 'utf8' }),
            ) as LooseSingleCardDocument;
            assert.deepEqual(
              doc,
              {
                data: {
                  type: 'card',
                  attributes: {
                    field1: 'a',
                    field2a: 'c',
                    cardInfo,
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('../test-card'),
                      name: 'TestCard',
                    },
                  },
                },
              },
              'instance serialized to filesystem correctly',
            );
          }

          // verify instance GET is correct
          {
            let response = await request
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.deepEqual(json.data.attributes, {
              field1: 'a',
              field2a: 'c',
              cardTitle: 'Untitled Card',
              cardDescription: null,
              cardThumbnailURL: null,
              cardInfo,
            });
          }

          let messages = await getMessagesSince(realmEventTimestampStart);

          let expected = [
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental-index-initiation',
                updatedFile: `${testRealmURL}test-card.gts`,
                realmURL: testRealmURL.href,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental',
                invalidations: [`${testRealmURL}test-card.gts`],
                clientRequestId: null,
                realmURL: testRealmURL.href,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental-index-initiation',
                updatedFile: `${testRealmURL}test-card.gts`,
                realmURL: testRealmURL.href,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental',
                invalidations: [`${testRealmURL}test-card.gts`, id],
                clientRequestId: null,
                realmURL: testRealmURL.href,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental-index-initiation',
                updatedFile: `${id}.json`,
                realmURL: testRealmURL.href,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental',
                invalidations: [id],
                clientRequestId: null,
                realmURL: testRealmURL.href,
              },
            },
          ];

          for (let expectedEvent of expected) {
            // FIXME is there a better way?
            let actualEvent = matchRealmEvent(messages, expectedEvent);

            let generation = (actualEvent?.content as any)?.generation;
            if (generation !== undefined) {
              let hasPositiveGeneration =
                typeof generation === 'number' && generation > 0;
              assert.true(
                hasPositiveGeneration,
                `incremental event carries a positive generation: ${generation}`,
              );
            }
            assert.deepEqual(
              withoutGeneration(actualEvent?.content),
              expectedEvent.content,
              'expected event was broadcast',
            );
          }
        });
      });

      module('public writable realm with size limit', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          fileSizeLimitBytes: 512,
          onRealmSetup,
        });

        test('returns 413 when source payload exceeds size limit', async function (assert) {
          let oversized = 'a'.repeat(2048);
          let response = await request
            .post('/too-large.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(oversized);

          assert.strictEqual(response.status, 413, 'HTTP 413 status');
          assert.strictEqual(
            response.body.errors[0].title,
            'Payload Too Large',
            'error title is correct',
          );
          assert.strictEqual(
            response.body.errors[0].status,
            413,
            'error status is correct',
          );
          assert.ok(
            response.body.errors[0].message.includes('File size'),
            'error message mentions file size',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`)
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`)
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        });

        test('image GET on a non-public realm uses private Cache-Control', async function (assert) {
          let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
          let jwt = createJWT(testRealm, 'john', ['read', 'write']);

          await request
            .post('/private-icon.png')
            .set('Content-Type', 'application/octet-stream')
            .set('Authorization', `Bearer ${jwt}`)
            .send(Buffer.from(bytes));

          let response = await request
            .get('/private-icon.png')
            .set('Accept', 'image/*')
            .set('Authorization', `Bearer ${jwt}`);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['cache-control'],
            'private, max-age=60, must-revalidate',
            'auth-gated image uses private Cache-Control so shared caches cannot serve it to other users',
          );
        });
      });
    });

    module('binary file POST request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        test('serves a binary file POST request', async function (assert) {
          let bytes = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe,
          ]);
          let response = await request
            .post('/test-image.png')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.ok(
            response.headers['x-created'],
            'created date should be set for new binary file',
          );

          let filePath = join(
            dir.name,
            'realm_server_1',
            'test',
            'test-image.png',
          );
          assert.ok(existsSync(filePath), 'binary file exists on disk');
          let fileBytes = readFileSync(filePath);
          assert.deepEqual(
            new Uint8Array(fileBytes),
            bytes,
            'file bytes match uploaded bytes',
          );
        });

        test('card source GET returns correct content-type for image files', async function (assert) {
          let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
          await request
            .post('/photo.png')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/photo.png')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['content-type'],
            'image/png',
            'content-type is image/png for .png files',
          );
        });

        test('image GET returns explicit Cache-Control for browser image requests', async function (assert) {
          let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
          await request
            .post('/icon.png')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/icon.png')
            .set('Accept', 'image/*');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['content-type'],
            'image/png',
            'content-type is image/png for .png files',
          );
          assert.strictEqual(
            response.headers['cache-control'],
            'public, max-age=60, must-revalidate',
            'image responses set an explicit Cache-Control instead of relying on Last-Modified heuristics',
          );
          assert.ok(
            response.headers['etag'],
            'ETag header is present so browsers can revalidate when the image changes',
          );
        });

        test('image GET returns the same Cache-Control when requested via card+source Accept', async function (assert) {
          let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
          await request
            .post('/bg.png')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/bg.png')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['cache-control'],
            'public, max-age=60, must-revalidate',
            'image Cache-Control applies regardless of Accept header',
          );
        });

        test('image 304 response carries Cache-Control, ETag, and Last-Modified', async function (assert) {
          let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
          await request
            .post('/revalidate.png')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let first = await request
            .get('/revalidate.png')
            .set('Accept', 'image/*');
          let etag = first.headers['etag'];
          assert.ok(etag, 'first response has ETag');

          let second = await request
            .get('/revalidate.png')
            .set('Accept', 'image/*')
            .set('If-None-Match', etag);

          assert.strictEqual(second.status, 304, 'HTTP 304 status');
          assert.strictEqual(
            second.headers['cache-control'],
            'public, max-age=60, must-revalidate',
            '304 responses include Cache-Control so browsers can refresh their cached directive',
          );
          assert.strictEqual(
            second.headers['etag'],
            etag,
            '304 echoes the matched ETag (RFC 9110)',
          );
          assert.ok(
            second.headers['last-modified'],
            '304 includes Last-Modified so caches can update stored metadata',
          );
        });

        test('non-image file GET keeps max-age=0 Cache-Control', async function (assert) {
          let bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
          await request
            .post('/doc.pdf')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/doc.pdf')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['cache-control'],
            'public, max-age=0',
            'non-image files keep the default revalidate-always Cache-Control',
          );
        });

        test('card source GET returns correct content-type for PDF files', async function (assert) {
          let bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
          await request
            .post('/report.pdf')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/report.pdf')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['content-type'],
            'application/pdf',
            'content-type is application/pdf for .pdf files',
          );
        });

        test('card source GET returns correct content-type for audio files', async function (assert) {
          let bytes = new Uint8Array([0x49, 0x44, 0x33]); // ID3
          await request
            .post('/clip.mp3')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/clip.mp3')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['content-type'],
            'audio/mpeg',
            'content-type is audio/mpeg for .mp3 files',
          );
        });

        test('card source GET returns correct content-type for video files', async function (assert) {
          let bytes = new Uint8Array([0x00, 0x00, 0x00, 0x1c]);
          await request
            .post('/demo.mp4')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let response = await request
            .get('/demo.mp4')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.headers['content-type'],
            'video/mp4',
            'content-type is video/mp4 for .mp4 files',
          );
        });

        test('creates file metadata for binary upload', async function (assert) {
          let bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
          await request
            .post('/meta-test.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes));

          let rows = await query(dbAdapter, [
            'SELECT content_hash FROM realm_file_meta WHERE realm_url =',
            param(testRealmHref),
            'AND file_path =',
            param('meta-test.bin'),
          ]);
          assert.strictEqual(rows.length, 1, 'file meta row exists');
          assert.ok(rows[0].content_hash, 'content hash is set');
        });

        test('overwrites existing binary file', async function (assert) {
          let bytes1 = new Uint8Array([0x01, 0x02, 0x03]);
          let bytes2 = new Uint8Array([0x04, 0x05, 0x06]);

          let response1 = await request
            .post('/overwrite-test.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes1));
          assert.strictEqual(response1.status, 204, 'first upload returns 204');

          let response2 = await request
            .post('/overwrite-test.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(bytes2));
          assert.strictEqual(
            response2.status,
            204,
            'second upload returns 204',
          );

          let filePath = join(
            dir.name,
            'realm_server_1',
            'test',
            'overwrite-test.bin',
          );
          let fileBytes = readFileSync(filePath);
          assert.deepEqual(
            new Uint8Array(fileBytes),
            bytes2,
            'file contains second upload bytes',
          );
        });

        test('broadcasts realm events for binary upload', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .post('/event-test.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(new Uint8Array([0xca, 0xfe])));

          await expectIncrementalIndexEvent(
            `${testRealmURL}event-test.bin`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
            },
          );
        });
      });

      module(
        'public writable realm with size limit for binary',
        function (hooks) {
          setupPermissionedRealmCached(hooks, {
            fixture: 'simple',
            realmURL,
            permissions: {
              '*': ['read', 'write'],
              '@node-test_realm:localhost': ['read', 'realm-owner'],
            },
            fileSizeLimitBytes: 512,
            onRealmSetup,
          });

          test('returns 413 when binary payload exceeds size limit', async function (assert) {
            let oversized = new Uint8Array(2048).fill(0xff);
            let response = await request
              .post('/too-large.bin')
              .set('Content-Type', 'application/octet-stream')
              .send(Buffer.from(oversized));

            assert.strictEqual(response.status, 413, 'HTTP 413 status');
            assert.strictEqual(
              response.body.errors[0].title,
              'Payload Too Large',
              'error title is correct',
            );
          });
        },
      );

      module('permissioned realm for binary', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          realmURL,
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          onRealmSetup,
        });

        test('401 without a JWT for binary upload', async function (assert) {
          let response = await request
            .post('/secret.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(new Uint8Array([0x01])));

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission for binary upload', async function (assert) {
          let response = await request
            .post('/secret.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(new Uint8Array([0x01])))
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission for binary upload', async function (assert) {
          let response = await request
            .post('/secret.bin')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from(new Uint8Array([0x01])))
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        });
      });
    });
  });
});

function matchRealmEvent(events: MatrixEvent[], event: any) {
  return events.find(
    (m) =>
      m.type === event.type &&
      isEqual(event.content, withoutGeneration(m.content)),
  );
}

// Incremental index events carry the committed realm generation, whose
// value varies with the fixture's indexing history — matching and content
// comparison ignore it; its shape is asserted separately.
function withoutGeneration(content: any) {
  if (
    content &&
    typeof content === 'object' &&
    content.generation !== undefined
  ) {
    let { generation: _generation, ...rest } = content;
    return rest;
  }
  return content;
}
