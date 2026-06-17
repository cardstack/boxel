import { module, test } from 'qunit';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import type {
  LooseSingleCardDocument,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  baseCardRef,
  buildQueryParamValue,
  rri,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import {
  closeServer,
  createVirtualNetwork,
  setupDB,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import type { RealmHttpServer as Server } from '../../server.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function (_hooks) {
  module(
    'Realm Server Endpoints | /_federated-search-prerendered',
    function (hooks) {
      let testRealm: Realm;
      let secondaryRealm: Realm;
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;
      let testRealmHttpServer: Server;

      let ownerUserId = '@mango:localhost';

      let realmFileSystem: Record<string, LooseSingleCardDocument> = {
        'test-card.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: {
                name: 'Shared Card',
              },
            },
            meta: {
              adoptsFrom: {
                module: rri('https://cardstack.com/base/card-api'),
                name: 'CardDef',
              },
            },
          },
        },
        'other-card.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: {
                name: 'Other Card',
              },
            },
            meta: {
              adoptsFrom: {
                module: rri('https://cardstack.com/base/card-api'),
                name: 'CardDef',
              },
            },
          },
        },
      };

      async function startSearchRealmServer({
        dbAdapter,
        publisher,
        runner,
      }: {
        dbAdapter: PgAdapter;
        publisher: QueuePublisher;
        runner: QueueRunner;
      }) {
        let virtualNetwork = createVirtualNetwork();
        let dir = dirSync();
        let testRealmURL = new URL('http://127.0.0.1:4444/test/');
        let secondaryRealmURL = new URL('http://127.0.0.1:4444/secondary/');
        let result = await runTestRealmServerWithRealms({
          virtualNetwork,
          realmsRootPath: join(dir.name, 'realm_server_1'),
          realms: [
            {
              realmURL: testRealmURL,
              fileSystem: realmFileSystem,
              permissions: {
                [ownerUserId]: ['read', 'write', 'realm-owner'],
              },
            },
            {
              realmURL: secondaryRealmURL,
              fileSystem: realmFileSystem,
              permissions: {
                [ownerUserId]: ['read', 'write', 'realm-owner'],
              },
            },
          ],
          dbAdapter,
          publisher,
          runner,
          matrixURL,
        });

        testRealmHttpServer = result.testRealmHttpServer;
        request = supertest(result.testRealmHttpServer);
        testRealm = result.realms.find(
          (realm) => realm.url === testRealmURL.href,
        )!;
        secondaryRealm = result.realms.find(
          (realm) => realm.url === secondaryRealmURL.href,
        )!;
      }

      async function stopSearchRealmServer() {
        testRealm.unsubscribe();
        secondaryRealm.unsubscribe();
        await closeServer(testRealmHttpServer);
        resetCatalogRealms();
      }

      setupDB(hooks, {
        beforeEach: async (_dbAdapter, publisher, runner) => {
          dbAdapter = _dbAdapter;
          await startSearchRealmServer({
            dbAdapter,
            publisher,
            runner,
          });
        },
        afterEach: async () => {
          await stopSearchRealmServer();
        },
      });

      test('QUERY /_federated-search-prerendered federates results across realms', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: {
            on: baseCardRef,
            eq: {
              cardTitle: 'Shared Card',
            },
          },
        };

        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let searchResponse = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .send({
            ...query,
            realms: [testRealm.url, secondaryRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(searchResponse.status, 200, 'HTTP 200 status');
        let results = searchResponse.body;
        assert.strictEqual(
          results.data.length,
          2,
          'returns results from both realms',
        );
        assert.strictEqual(
          results.meta.page.total,
          2,
          'meta total is combined',
        );
        let ids: string[] = results.data.map(
          (entry: { id: string }) => entry.id,
        );
        assert.ok(
          ids[0]?.startsWith(testRealm.url),
          'results are ordered deterministically (primary realm first)',
        );
        assert.ok(
          ids[1]?.startsWith(secondaryRealm.url),
          'results are ordered deterministically (secondary realm second)',
        );
        assert.true(
          ids.every((id) => id.includes('test-card')),
          'results exclude non-matching cards',
        );
      });

      // Verifies the shared `JobScopedSearchCache` hits at the
      // `_federated-search-prerendered` handler boundary too. Counts
      // populates by spying on each realm's `searchPrerendered` method
      // — a cache hit short-circuits before `searchPrerenderedRealms`
      // reaches the realm, so spy invocations are the unambiguous
      // tell.
      test('QUERY /_federated-search-prerendered caches reads under one jobId and bypasses other jobs', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let primaryCalls = 0;
        let secondaryCalls = 0;
        let primaryProto = testRealm.searchPrerendered;
        let secondaryProto = secondaryRealm.searchPrerendered;
        (
          testRealm as unknown as {
            searchPrerendered: typeof testRealm.searchPrerendered;
          }
        ).searchPrerendered = function (
          this: typeof testRealm,
          ...args: Parameters<typeof testRealm.searchPrerendered>
        ) {
          primaryCalls++;
          return primaryProto.apply(this, args);
        };
        (
          secondaryRealm as unknown as {
            searchPrerendered: typeof secondaryRealm.searchPrerendered;
          }
        ).searchPrerendered = function (
          this: typeof secondaryRealm,
          ...args: Parameters<typeof secondaryRealm.searchPrerendered>
        ) {
          secondaryCalls++;
          return secondaryProto.apply(this, args);
        };

        try {
          let query: Query = {
            filter: {
              on: baseCardRef,
              eq: { cardTitle: 'Shared Card' },
            },
          };
          let searchURL = new URL(
            '/_federated-search-prerendered',
            testRealm.url,
          );
          let post = (jobId: string) =>
            request
              .post(`${searchURL.pathname}${searchURL.search}`)
              .set('Accept', 'application/vnd.card+json')
              .set('Content-Type', 'application/json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Authorization', `Bearer ${realmServerToken}`)
              .set('x-boxel-job-id', jobId)
              .set('x-boxel-consuming-realm', testRealm.url)
              .send({
                ...query,
                realms: [testRealm.url, secondaryRealm.url],
                prerenderedHtmlFormat: 'embedded',
              });

          let first = await post('42.1');
          assert.strictEqual(first.status, 200, 'first request: HTTP 200');
          assert.strictEqual(
            first.body.data.length,
            2,
            'first request returns both realms’ results',
          );
          assert.strictEqual(
            primaryCalls,
            1,
            'first request hit testRealm exactly once',
          );
          assert.strictEqual(
            secondaryCalls,
            1,
            'first request hit secondaryRealm exactly once',
          );

          let second = await post('42.1');
          assert.strictEqual(second.status, 200, 'second request: HTTP 200');
          assert.strictEqual(
            second.body.data.length,
            2,
            'second request returns the cached result',
          );
          assert.strictEqual(
            primaryCalls,
            1,
            'second request was a cache hit (testRealm not re-queried)',
          );
          assert.strictEqual(
            secondaryCalls,
            1,
            'second request was a cache hit (secondaryRealm not re-queried)',
          );

          // A different jobId is a different batch — fresh populate.
          let third = await post('43.1');
          assert.strictEqual(third.status, 200, 'third request: HTTP 200');
          assert.strictEqual(
            primaryCalls,
            2,
            'different jobId re-queried testRealm',
          );
          assert.strictEqual(
            secondaryCalls,
            2,
            'different jobId re-queried secondaryRealm',
          );
        } finally {
          delete (testRealm as unknown as { searchPrerendered?: unknown })
            .searchPrerendered;
          delete (secondaryRealm as unknown as { searchPrerendered?: unknown })
            .searchPrerendered;
        }
      });

      // Cache key reflects the endpoint-specific request shape. Changing
      // any of `prerenderedHtmlFormat`, `cardUrls`, or `renderType` under
      // an otherwise identical (jobId, realms, query) tuple must miss
      // the cache and fire a fresh populate.
      test('QUERY /_federated-search-prerendered cache key segregates entries by htmlFormat / cardUrls / renderType', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let primaryCalls = 0;
        let primaryProto = testRealm.searchPrerendered;
        (
          testRealm as unknown as {
            searchPrerendered: typeof testRealm.searchPrerendered;
          }
        ).searchPrerendered = function (
          this: typeof testRealm,
          ...args: Parameters<typeof testRealm.searchPrerendered>
        ) {
          primaryCalls++;
          return primaryProto.apply(this, args);
        };

        try {
          let query: Query = {
            filter: {
              on: baseCardRef,
              eq: { cardTitle: 'Shared Card' },
            },
          };
          let searchURL = new URL(
            '/_federated-search-prerendered',
            testRealm.url,
          );
          let post = (body: Record<string, unknown>) =>
            request
              .post(`${searchURL.pathname}${searchURL.search}`)
              .set('Accept', 'application/vnd.card+json')
              .set('Content-Type', 'application/json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Authorization', `Bearer ${realmServerToken}`)
              .set('x-boxel-job-id', '42.1')
              .set('x-boxel-consuming-realm', testRealm.url)
              .send({
                ...query,
                realms: [testRealm.url],
                ...body,
              });

          let first = await post({ prerenderedHtmlFormat: 'embedded' });
          assert.strictEqual(first.status, 200, 'first request: HTTP 200');
          assert.strictEqual(primaryCalls, 1, 'first request populated');

          // Same jobId, same query, same realms — but htmlFormat differs.
          // Must miss the cache.
          let second = await post({ prerenderedHtmlFormat: 'fitted' });
          assert.strictEqual(second.status, 200, 'second request: HTTP 200');
          assert.strictEqual(
            primaryCalls,
            2,
            'different htmlFormat fired a fresh populate',
          );

          // Identical to `second` — must hit the cache.
          let third = await post({ prerenderedHtmlFormat: 'fitted' });
          assert.strictEqual(third.status, 200, 'third request: HTTP 200');
          assert.strictEqual(
            primaryCalls,
            2,
            'repeat of `second` was a cache hit',
          );

          // Adding a `cardUrls` filter changes the response → miss.
          let fourth = await post({
            prerenderedHtmlFormat: 'fitted',
            cardUrls: [`${testRealm.url}test-card`],
          });
          assert.strictEqual(fourth.status, 200, 'fourth request: HTTP 200');
          assert.strictEqual(
            primaryCalls,
            3,
            'different cardUrls fired a fresh populate',
          );
        } finally {
          delete (testRealm as unknown as { searchPrerendered?: unknown })
            .searchPrerendered;
        }
      });

      // Without both the job-id and consuming-realm headers a request
      // is treated as user-facing traffic and bypasses the cache.
      test('QUERY /_federated-search-prerendered bypasses cache when either prerender-context header is absent', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let primaryCalls = 0;
        let primaryProto = testRealm.searchPrerendered;
        (
          testRealm as unknown as {
            searchPrerendered: typeof testRealm.searchPrerendered;
          }
        ).searchPrerendered = function (
          this: typeof testRealm,
          ...args: Parameters<typeof testRealm.searchPrerendered>
        ) {
          primaryCalls++;
          return primaryProto.apply(this, args);
        };

        try {
          let query: Query = {
            filter: {
              on: baseCardRef,
              eq: { cardTitle: 'Shared Card' },
            },
          };
          let searchURL = new URL(
            '/_federated-search-prerendered',
            testRealm.url,
          );

          // No prerender-context headers — every request must re-populate.
          let plain = () =>
            request
              .post(`${searchURL.pathname}${searchURL.search}`)
              .set('Accept', 'application/vnd.card+json')
              .set('Content-Type', 'application/json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Authorization', `Bearer ${realmServerToken}`)
              .send({
                ...query,
                realms: [testRealm.url],
                prerenderedHtmlFormat: 'embedded',
              });

          let first = await plain();
          assert.strictEqual(first.status, 200, 'first request: HTTP 200');
          assert.strictEqual(primaryCalls, 1, 'first request populated');

          let second = await plain();
          assert.strictEqual(second.status, 200, 'second request: HTTP 200');
          assert.strictEqual(
            primaryCalls,
            2,
            'no headers → cache bypassed, populate ran again',
          );

          // jobId present, but consumingRealm missing → bypass.
          let jobIdOnly = await request
            .post(`${searchURL.pathname}${searchURL.search}`)
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${realmServerToken}`)
            .set('x-boxel-job-id', '42.1')
            .send({
              ...query,
              realms: [testRealm.url],
              prerenderedHtmlFormat: 'embedded',
            });
          assert.strictEqual(jobIdOnly.status, 200, 'job-id only: HTTP 200');
          assert.strictEqual(
            primaryCalls,
            3,
            'job-id without consuming-realm → cache bypassed',
          );

          // consumingRealm present, but jobId missing → bypass.
          let consumingOnly = await request
            .post(`${searchURL.pathname}${searchURL.search}`)
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${realmServerToken}`)
            .set('x-boxel-consuming-realm', testRealm.url)
            .send({
              ...query,
              realms: [testRealm.url],
              prerenderedHtmlFormat: 'embedded',
            });
          assert.strictEqual(
            consumingOnly.status,
            200,
            'consuming-realm only: HTTP 200',
          );
          assert.strictEqual(
            primaryCalls,
            4,
            'consuming-realm without job-id → cache bypassed',
          );
        } finally {
          delete (testRealm as unknown as { searchPrerendered?: unknown })
            .searchPrerendered;
        }
      });

      test('QUERY /_federated-search-prerendered emits an ETag on cacheable responses', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
        };
        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let response = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .set('x-boxel-job-id', '42.1')
          .set('x-boxel-consuming-realm', testRealm.url)
          .send({
            ...query,
            realms: [testRealm.url, secondaryRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let etag = response.headers['etag'];
        assert.ok(etag, 'ETag header is present on cacheable responses');
        assert.ok(
          /^W\/"42\.1-[0-9a-f]+"$/.test(etag),
          `ETag is weak-form quoted "<jobId>-<digest>": ${etag}`,
        );
      });

      test('QUERY /_federated-search-prerendered does not emit ETag on non-cacheable requests', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
        };
        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let response = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.notOk(
          response.headers['etag'],
          'non-indexer callers do not see an ETag header',
        );
      });

      test('QUERY /_federated-search-prerendered returns 304 when If-None-Match matches and cache is warm', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
        };
        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );
        let post = (opts: { ifNoneMatch?: string } = {}) => {
          let r = request
            .post(`${searchURL.pathname}${searchURL.search}`)
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${realmServerToken}`)
            .set('x-boxel-job-id', '42.1')
            .set('x-boxel-consuming-realm', testRealm.url);
          if (opts.ifNoneMatch) {
            r = r.set('If-None-Match', opts.ifNoneMatch);
          }
          return r.send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });
        };

        let primer = await post();
        assert.strictEqual(primer.status, 200, 'primer: HTTP 200');
        let etag = primer.headers['etag'];
        assert.ok(etag, 'primer carries an ETag');

        let revalidation = await post({ ifNoneMatch: etag });
        assert.strictEqual(
          revalidation.status,
          304,
          'matching If-None-Match returns 304 Not Modified',
        );
        assert.strictEqual(revalidation.text, '', '304 response has no body');
        assert.strictEqual(
          revalidation.headers['etag'],
          etag,
          '304 echoes the same ETag header',
        );
      });

      test('QUERY /_federated-search-prerendered returns 200 fresh when If-None-Match is from a previous jobId', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
        };
        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let priorBatch = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .set('x-boxel-job-id', '42.1')
          .set('x-boxel-consuming-realm', testRealm.url)
          .send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });
        let staleEtag = priorBatch.headers['etag'];
        assert.ok(staleEtag, 'prior batch carries an ETag');

        let nextBatch = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .set('x-boxel-job-id', '43.1')
          .set('x-boxel-consuming-realm', testRealm.url)
          .set('If-None-Match', staleEtag)
          .send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(
          nextBatch.status,
          200,
          'stale ETag does not match → fresh body',
        );
        assert.notStrictEqual(
          nextBatch.headers['etag'],
          staleEtag,
          'fresh ETag for the new jobId',
        );
        assert.ok(nextBatch.body.data, 'body carries fresh search results');
      });

      test('QUERY /_federated-search-prerendered ignores If-None-Match without job headers', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
        };
        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let response = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .set('If-None-Match', 'W/"anything-goes"')
          .send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(
          response.status,
          200,
          'user-facing caller is served fresh, never 304',
        );
        assert.notOk(
          response.headers['etag'],
          'no ETag emitted to non-indexer callers',
        );
        assert.ok(response.body.data, 'response carries the body');
      });

      test('GET /_federated-search-prerendered returns 400 for unsupported method', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: {
            on: baseCardRef,
            eq: {
              cardTitle: 'Shared Card',
            },
          },
        };

        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );
        searchURL.searchParams.append('realms', testRealm.url);
        searchURL.searchParams.set('query', buildQueryParamValue(query));
        searchURL.searchParams.set('prerenderedHtmlFormat', 'embedded');

        let response = await request
          .get(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', `Bearer ${realmServerToken}`);

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        assert.ok(
          response.body.errors?.[0]?.includes('method must be QUERY'),
          'response explains unsupported method',
        );
      });

      test('QUERY /_federated-search-prerendered returns 403 when user lacks read access', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: '@rando:localhost', sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let query: Query = {
          filter: {
            on: baseCardRef,
            eq: {
              cardTitle: 'Test Card',
            },
          },
        };

        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let response = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
        assert.ok(
          response.body.errors?.[0]?.includes(testRealm.url),
          'response lists realms without access',
        );
      });

      test('QUERY /_federated-search-prerendered returns 401 when unauthenticated user requests non-public realm', async function (assert) {
        let query: Query = {
          filter: {
            on: baseCardRef,
            eq: {
              cardTitle: 'Test Card',
            },
          },
        };

        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let response = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .send({
            ...query,
            realms: [testRealm.url],
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        assert.ok(
          response.body.errors?.[0]?.includes(testRealm.url),
          'response lists realms requiring auth',
        );
      });

      test('QUERY /_federated-search-prerendered returns 400 for invalid query', async function (assert) {
        let realmServerToken = createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        );

        let searchURL = new URL(
          '/_federated-search-prerendered',
          testRealm.url,
        );

        let response = await request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .send({
            realms: [testRealm.url],
            invalid: 'query structure',
            prerenderedHtmlFormat: 'embedded',
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('QUERY /_federated-search-prerendered returns 400 when realms param is missing', async function (assert) {
        let query: Query = {
          filter: {
            on: baseCardRef,
            eq: {
              cardTitle: 'Test Card',
            },
          },
        };

        let response = await request
          .post('/_federated-search-prerendered')
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .send({ ...query, prerenderedHtmlFormat: 'embedded' });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        assert.ok(
          response.body.errors?.[0]?.includes(
            'realms must be supplied in request body',
          ),
          'response explains missing realms in request body',
        );
      });
    },
  );
});
