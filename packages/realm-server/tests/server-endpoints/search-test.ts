import QUnit from 'qunit';
const { module, test } = QUnit;
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
  archiveRealm,
  baseCardRef,
  rri,
  query,
  param,
  setSearchBoundsForTests,
  resetSearchBoundsForTests,
  setSearchShapeSink,
  type Expression,
  type SearchShapeEvent,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import { LIVE_SEARCH_CACHE_HEADER } from '../../handlers/handle-search.ts';
import { LiveSearchCache } from '../../live-search-cache.ts';
import { getSearchInFlight } from '../../search-inflight.ts';
import {
  closeServer,
  createVirtualNetwork,
  setupDB,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { settlePrerenderHtmlJobs } from '../helpers/indexing.ts';
import type { RealmHttpServer as Server } from '../../server.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_federated-search', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';
    // A second principal with read access to both realms. Used to prove the
    // live-search cache serves a body computed for one authorized caller to a
    // different authorized caller — the sharing is keyed on the realm list, not
    // the user.
    let readerUserId = '@reader:localhost';

    // Two Person instances per realm: per-realm css dedup is exercised
    // within each realm (two renderings share one stylesheet), and the
    // federated merge dedups the per-realm css/html/item resources by
    // `(type, id)` across the combined `included`.
    let realmFileSystem: Record<string, LooseSingleCardDocument | string> = {
      'person.gts': `
        import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringField);
          static fitted = class Fitted extends Component<typeof this> {
            <template>
              Fitted Card Person: <@fields.firstName/>

              <style scoped>
                .border {
                  border: 1px solid red;
                }
              </style>
            </template>
          }
        }
      `,
      'john.json': {
        data: {
          type: 'card',
          attributes: { firstName: 'John' },
          meta: {
            adoptsFrom: { module: rri('./person'), name: 'Person' },
          },
        },
      },
      'jane.json': {
        data: {
          type: 'card',
          attributes: { firstName: 'Jane' },
          meta: {
            adoptsFrom: { module: rri('./person'), name: 'Person' },
          },
        },
      },
    };

    async function startSearchRealmServer({
      dbAdapter,
      publisher,
      runner,
      liveSearchCache,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
      liveSearchCache?: LiveSearchCache;
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
              [readerUserId]: ['read'],
            },
          },
          {
            realmURL: secondaryRealmURL,
            fileSystem: realmFileSystem,
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
              [readerUserId]: ['read'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
        liveSearchCache,
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
      beforeEach: async (_dbAdapter, _publisher, _runner) => {
        dbAdapter = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        await startSearchRealmServer({
          dbAdapter,
          publisher,
          runner,
        });
        // The entries' html relationships read prerendered_html, which the
        // fire-and-forget prerender_html jobs populate after the index
        // passes complete — settle both realms' HTML channels first.
        await settlePrerenderHtmlJobs(dbAdapter, testRealm.url);
        await settlePrerenderHtmlJobs(dbAdapter, secondaryRealm.url);
      },
      afterEach: async () => {
        await stopSearchRealmServer();
      },
    });

    function tokenFor(userId: string) {
      return createRealmServerJWT(
        { user: userId, sessionRoom: `session-room-${userId}` },
        realmSecretSeed,
      );
    }

    function ownerToken() {
      return tokenFor(ownerUserId);
    }

    // Anchor on the base CardDef ref: each realm's Person adopts from its
    // own realm's module, so a realm-specific anchor would only match that
    // realm's instances.
    function personFilter() {
      return {
        'item.on': baseCardRef,
      };
    }

    function postSearchAs(token: string, body: Record<string, unknown>) {
      let searchURL = new URL('/_federated-search', testRealm.url);
      return request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function postSearch(body: Record<string, unknown>) {
      return postSearchAs(ownerToken(), body);
    }

    // Poll for a condition that a request in flight will bring about, failing
    // rather than hanging if it never does.
    async function waitUntil(condition: () => boolean, what: string) {
      let deadline = Date.now() + 5_000;
      while (!condition()) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    test('QUERY /_federated-search federates entry results across realms', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      });
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let json = response.body;
      assert.strictEqual(json.meta.page.total, 4, 'meta total is combined');
      assert.deepEqual(
        json.meta.htmlQuery,
        { eq: { format: 'fitted' } },
        'the applied default htmlQuery is echoed once on the combined doc',
      );
      let ids: string[] = json.data.map((entry: { id: string }) => entry.id);
      assert.deepEqual(
        ids,
        [
          `${testRealm.url}jane`,
          `${testRealm.url}john`,
          `${secondaryRealm.url}jane`,
          `${secondaryRealm.url}john`,
        ],
        'entries from both realms in realm order',
      );
      for (let entry of json.data) {
        assert.strictEqual(
          entry.relationships.html.data.length,
          1,
          `${entry.id} carries its fitted rendering`,
        );
      }
      // included is deduped by (type, id): each realm's two renderings share
      // one css resource, and nothing appears twice in the combined doc
      let identities = json.included.map(
        (r: { type: string; id: string }) => `${r.type}|${r.id}`,
      );
      assert.deepEqual(
        identities,
        [...new Set(identities)],
        'no duplicate (type, id) in the merged included',
      );
      // a rendering's deps carry the full transitive scoped-CSS set, so
      // assert the sharing property rather than a count: two same-realm
      // renderings of the same type reference identical stylesheets, all of
      // which travel in included
      let htmlOf = (id: string) =>
        json.included.find(
          (r: { type: string; id: string }) => r.type === 'html' && r.id === id,
        );
      let janeHtml = htmlOf(json.data[0].relationships.html.data[0].id);
      let johnHtml = htmlOf(json.data[1].relationships.html.data[0].id);
      assert.deepEqual(
        janeHtml.relationships.styles.data,
        johnHtml.relationships.styles.data,
        'same-realm renderings of the same type share their stylesheets',
      );
      assert.true(janeHtml.relationships.styles.data.length > 0);
      let cssIds = new Set(
        json.included
          .filter((r: { type: string }) => r.type === 'css')
          .map((r: { id: string }) => r.id),
      );
      for (let { id } of janeHtml.relationships.styles.data) {
        assert.true(cssIds.has(id), `referenced stylesheet ${id} is included`);
      }
    });

    // A federated search payload that names an archived realm must not
    // return hits. The mechanism is the enumeration filter in
    // fetchUserPermissions: once a realm is archived, the requester has
    // no permission for it per the filtered enumeration, so the
    // multi-realm-authorization middleware short-circuits the request
    // with 403 before handle-search runs. The handler itself does no
    // extra work; this test pins the contract end-to-end so a refactor
    // of the enumeration layer can't silently weaken it.
    test('archived realms in a federated search payload are refused at the auth boundary', async function (assert) {
      await archiveRealm(dbAdapter, new URL(secondaryRealm.url));

      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      });
      assert.strictEqual(
        response.status,
        403,
        'a request including an archived realm is forbidden',
      );
      assert.ok(
        String(response.body?.errors?.[0] ?? response.text).includes(
          secondaryRealm.url,
        ),
        'the forbidden response names the archived realm',
      );

      let activeOnly = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url],
      });
      assert.strictEqual(
        activeOnly.status,
        200,
        'the same request restricted to the active realm succeeds',
      );
      assert.strictEqual(
        activeOnly.body.meta.page.total,
        2,
        'active realms continue to search normally',
      );
    });

    test('cardUrls narrows results across the federation', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
        cardUrls: [`${testRealm.url}john.json`],
      });
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        response.body.data.map((entry: { id: string }) => entry.id),
        [`${testRealm.url}john`],
        'only the requested card across both realms',
      );
    });

    test('cache/ETag segregates by query, fields, and htmlQuery', async function (assert) {
      let post = (body: Record<string, unknown>) =>
        postSearch(body)
          .set('x-boxel-job-id', '42.1')
          .set('x-boxel-consuming-realm', testRealm.url);
      let baseBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      let first = await post(baseBody);
      assert.strictEqual(first.status, 200);
      let baseEtag = first.headers['etag'];
      assert.true(Boolean(baseEtag), 'cacheable request carries an ETag');

      let repeat = await post(baseBody);
      assert.strictEqual(
        repeat.headers['etag'],
        baseEtag,
        'identical request → identical ETag',
      );

      let revalidated = await post(baseBody).set('If-None-Match', baseEtag);
      assert.strictEqual(
        revalidated.status,
        304,
        'If-None-Match on a cached entry → 304',
      );

      let differentFields = await post({
        ...baseBody,
        fields: { entry: ['item'] },
      });
      assert.notStrictEqual(
        differentFields.headers['etag'],
        baseEtag,
        'a different fieldset → a different ETag',
      );

      let differentHtmlQuery = await post({
        ...baseBody,
        filter: {
          ...personFilter(),
          eq: { htmlQuery: { eq: { format: 'embedded' } } },
        },
      });
      assert.notStrictEqual(
        differentHtmlQuery.headers['etag'],
        baseEtag,
        'a different htmlQuery → a different ETag',
      );

      // an inert htmlQuery (fieldset without html) does not key the cache:
      // equivalent bodies share one entry + ETag
      let itemFields = { entry: ['item'] };
      let inertA = await post({ ...baseBody, fields: itemFields });
      let inertB = await post({
        ...baseBody,
        filter: {
          ...personFilter(),
          eq: { htmlQuery: { eq: { format: 'embedded' } } },
        },
        fields: itemFields,
      });
      assert.strictEqual(
        inertB.headers['etag'],
        inertA.headers['etag'],
        'an inert htmlQuery does not split equivalent responses',
      );

      let uncached = await postSearch(baseBody);
      assert.strictEqual(
        uncached.headers['etag'],
        undefined,
        'non-indexer traffic carries no ETag',
      );
    });

    test('entries and html renderings carry meta.generation on the wire', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url],
      });
      assert.strictEqual(response.status, 200);
      let json = response.body;
      for (let entry of json.data) {
        let generation = entry.meta?.generation;
        assert.strictEqual(
          typeof generation,
          'number',
          `${entry.id} carries meta.generation`,
        );
        assert.ok(generation > 0, `${entry.id} generation is positive`);
      }
      let htmlResources = (json.included ?? []).filter(
        (resource: { type: string }) => resource.type === 'html',
      );
      assert.ok(htmlResources.length > 0, 'the default fieldset returns html');
      for (let html of htmlResources) {
        let generation = html.meta?.generation;
        assert.strictEqual(
          typeof generation,
          'number',
          `${html.id} carries meta.generation`,
        );
        assert.ok(generation > 0, `${html.id} generation is positive`);
      }
    });

    test('the _search ETag advances when either the index or the prerendered-HTML channel does', async function (assert) {
      let cacheable = (body: Record<string, unknown>) =>
        postSearch(body)
          .set('x-boxel-job-id', '77.1')
          .set('x-boxel-consuming-realm', testRealm.url);
      let body = { filter: personFilter(), realms: [testRealm.url] };
      let realmURL = new URL(testRealm.url).href;

      let base = (await cacheable(body)).headers['etag'];
      assert.true(Boolean(base), 'cacheable request carries an ETag');

      // Publish HTML at a higher generation than any existing row: the realm's
      // prerendered-HTML channel advances, so a cached 304 must not pin the
      // older result.
      await query(dbAdapter, [
        `INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation) VALUES (`,
        param(`${testRealm.url}__gen_probe__`),
        `,`,
        param(`${testRealm.url}__gen_probe__`),
        `,`,
        param(realmURL),
        `,`,
        param('instance'),
        `,`,
        param(999999),
        `)`,
      ] as Expression);
      let afterHtml = (await cacheable(body)).headers['etag'];
      assert.notStrictEqual(
        afterHtml,
        base,
        'a newer prerendered-HTML generation → a new ETag',
      );

      // Advance the index channel: the realm's authoritative current generation.
      await query(dbAdapter, [
        `UPDATE realm_generations SET current_generation = 999999 WHERE realm_url =`,
        param(realmURL),
      ] as Expression);
      let afterIndex = (await cacheable(body)).headers['etag'];
      assert.notStrictEqual(
        afterIndex,
        afterHtml,
        'a newer index generation → a new ETag',
      );
    });

    test('the item-leg page size is bounded server-side; realms fan-out is not', async function (assert) {
      // The server bounds the live item leg for every caller, as a pair: a
      // request naming no page is clamped to the default, and one naming a size
      // is honored up to the absolute maximum and clamped to it above. The
      // realms fan-out cap is a separate client-side limit on the card
      // `@context` surface, so the server accepts a wide federated request.
      setSearchBoundsForTests({
        serverMaxPageSize: 2,
        serverAbsoluteMaxPageSize: 3,
      });
      try {
        // Naming a size above the default is the opt-in: honored, not clamped
        // back to the default. This is what lets a query-backed field declare
        // the page it needs.
        let optedIn = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          realms: [testRealm.url, secondaryRealm.url],
          page: { size: 3 },
        });
        assert.strictEqual(
          optedIn.status,
          200,
          'a page above the default but within the maximum is honored',
        );

        // Above the absolute maximum it is clamped rather than rejected, so
        // every leg that applies this bound agrees on the page — a rejection on
        // one and a clamp on another is how a query-backed field comes to
        // resolve from its seed and then fail on its next refresh.
        let over = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          realms: [testRealm.url, secondaryRealm.url],
          page: { size: 9 },
        });
        assert.strictEqual(
          over.status,
          200,
          'an over-maximum item-leg page is clamped, not rejected',
        );
        assert.strictEqual(
          over.body.meta.page.total,
          4,
          'and the true match count is still reported beside the clamped page',
        );

        // Naming no page at all still gets mandatory pagination.
        let unpaged = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          realms: [testRealm.url, secondaryRealm.url],
        });
        assert.strictEqual(
          unpaged.status,
          200,
          'a request naming no page is clamped to the default, not rejected',
        );

        // A multi-realm request within the ceiling is accepted — the realms
        // fan-out is not capped server-side — and both realms are searched.
        let wide = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          realms: [testRealm.url, secondaryRealm.url],
          page: { size: 2 },
        });
        assert.strictEqual(
          wide.status,
          200,
          'a multi-realm request within the page ceiling is accepted',
        );
        assert.strictEqual(
          wide.body.meta.page.total,
          4,
          'both realms are searched',
        );
      } finally {
        resetSearchBoundsForTests();
      }
    });

    test('identical live searches within the TTL share one cached body', async function (assert) {
      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      let first = await postSearch(searchBody);
      assert.strictEqual(first.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        first.headers[LIVE_SEARCH_CACHE_HEADER],
        'miss',
        'the first request computes',
      );

      let second = await postSearch(searchBody);
      assert.strictEqual(second.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        second.headers[LIVE_SEARCH_CACHE_HEADER],
        'hit',
        'an identical follow-up is served from the live cache',
      );
      // `.text` is the raw response string, so this is the byte comparison the
      // message claims (`.body` is supertest's re-parsed JSON). A `hit` returns
      // the first request's cached string, so equality here is expected.
      assert.strictEqual(
        second.text,
        first.text,
        'the cached body is byte-identical',
      );

      // A request differing in any body member addresses a different entry.
      let differentRealms = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url],
      });
      assert.strictEqual(
        differentRealms.headers[LIVE_SEARCH_CACHE_HEADER],
        'miss',
        'a different realm list is a different cache identity',
      );
    });

    test('a body computed for one caller is served to a different authorized caller', async function (assert) {
      // Pins that cross-user *sharing happens*: a body one user populated is
      // served to the next authorized user off the TTL window. This alone does
      // not prove the body is user-independent — the reader's `hit` returns the
      // owner's cached string, so the two are equal by construction whether or
      // not the compute is pure. The purity guard is the separate `ttlMs: 0`
      // test below, where both callers compute.
      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      let owner = await postSearchAs(ownerToken(), searchBody);
      assert.strictEqual(owner.status, 200, 'the owner request succeeds');
      assert.strictEqual(
        owner.headers[LIVE_SEARCH_CACHE_HEADER],
        'miss',
        'the first caller computes the body',
      );

      let reader = await postSearchAs(tokenFor(readerUserId), searchBody);
      assert.strictEqual(reader.status, 200, 'the reader request succeeds');
      assert.strictEqual(
        reader.headers[LIVE_SEARCH_CACHE_HEADER],
        'hit',
        'a different authorized caller is served the cached body',
      );
      assert.strictEqual(
        reader.text,
        owner.text,
        'the reader is served the exact string the owner populated',
      );
    });

    test('two authorized callers each compute a byte-identical body (cross-user purity)', async function (assert) {
      // The purity guard the sharing test above can't provide. With retention
      // off (`ttlMs: 0`) — coalescing stays on, but two sequential requests
      // never coalesce — each caller runs its own compute and the second is a
      // `miss`, not a `hit`. Comparing those two INDEPENDENTLY computed bodies
      // is what pins the invariant the whole safety argument rests on: the body
      // is a pure function of the realm list, not the requesting user. A change
      // that folded a caller-derived value into the body would diverge here and
      // trip this assertion — where the sharing test, comparing the one cached
      // string to itself, would still pass.
      await stopSearchRealmServer();
      await startSearchRealmServer({
        dbAdapter,
        publisher,
        runner,
        liveSearchCache: new LiveSearchCache({
          ttlMs: 0,
          telemetryIntervalMs: 0,
        }),
      });
      await settlePrerenderHtmlJobs(dbAdapter, testRealm.url);
      await settlePrerenderHtmlJobs(dbAdapter, secondaryRealm.url);

      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      let owner = await postSearchAs(ownerToken(), searchBody);
      assert.strictEqual(owner.status, 200, 'the owner request succeeds');
      assert.strictEqual(
        owner.headers[LIVE_SEARCH_CACHE_HEADER],
        'miss',
        'the owner computes (retention is off)',
      );

      let reader = await postSearchAs(tokenFor(readerUserId), searchBody);
      assert.strictEqual(reader.status, 200, 'the reader request succeeds');
      assert.strictEqual(
        reader.headers[LIVE_SEARCH_CACHE_HEADER],
        'miss',
        'the reader independently computes rather than being served a cached body',
      );
      assert.strictEqual(
        reader.text,
        owner.text,
        'two independent computes produce a byte-identical body',
      );
    });

    test('a coalesced live search releases its admission slot while the compute is still running', async function (assert) {
      // A cache whose next compute waits on the test, so a second identical
      // request is guaranteed to arrive while the first is still computing.
      class HoldableLiveSearchCache extends LiveSearchCache {
        hold: Promise<void> | undefined;
        onComputeStarted: (() => void) | undefined;
        override getOrPopulate(
          args: Parameters<LiveSearchCache['getOrPopulate']>[0],
        ) {
          let { hold, onComputeStarted } = this;
          return super.getOrPopulate({
            ...args,
            populate: async () => {
              onComputeStarted?.();
              if (hold) {
                await hold;
              }
              return args.populate();
            },
          });
        }
      }
      let cache = new HoldableLiveSearchCache({
        ttlMs: 60_000,
        telemetryIntervalMs: 0,
      });
      await stopSearchRealmServer();
      await startSearchRealmServer({
        dbAdapter,
        publisher,
        runner,
        liveSearchCache: cache,
      });
      await settlePrerenderHtmlJobs(dbAdapter, testRealm.url);
      await settlePrerenderHtmlJobs(dbAdapter, secondaryRealm.url);

      let releaseCompute!: () => void;
      cache.hold = new Promise<void>((resolve) => (releaseCompute = resolve));
      let computeStarted = new Promise<void>(
        (resolve) => (cache.onComputeStarted = resolve),
      );
      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      // supertest sends lazily; `.then` starts each request now.
      let first = postSearch(searchBody).then((response) => response);
      await computeStarted;
      assert.strictEqual(
        getSearchInFlight(),
        1,
        'the computing request holds a slot',
      );

      let second = postSearch(searchBody).then((response) => response);
      await waitUntil(
        () => cache.stats.joins === 1,
        'the second request joins',
      );
      assert.strictEqual(
        getSearchInFlight(),
        1,
        'the joiner handed its slot back while the compute is still running',
      );

      releaseCompute();
      let [a, b] = await Promise.all([first, second]);
      assert.strictEqual(a.status, 200);
      assert.strictEqual(b.status, 200);
      assert.strictEqual(a.headers[LIVE_SEARCH_CACHE_HEADER], 'miss');
      assert.strictEqual(b.headers[LIVE_SEARCH_CACHE_HEADER], 'join');
      assert.strictEqual(b.text, a.text, 'the joiner got the shared body');
      assert.strictEqual(
        getSearchInFlight(),
        0,
        'the computing request released on completion, and only once',
      );

      let third = await postSearch(searchBody);
      assert.strictEqual(third.headers[LIVE_SEARCH_CACHE_HEADER], 'hit');
      assert.strictEqual(getSearchInFlight(), 0, 'a hit holds no slot after');
    });

    test('a write to a searched realm invalidates the live search cache', async function (assert) {
      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      let first = await postSearch(searchBody);
      assert.strictEqual(first.status, 200, 'HTTP 200 status');
      assert.strictEqual(first.body.meta.page.total, 4, 'four people');
      let primed = await postSearch(searchBody);
      assert.strictEqual(
        primed.headers[LIVE_SEARCH_CACHE_HEADER],
        'hit',
        'the entry is cached before the write',
      );

      // The default write waits for the incremental index, which advances the
      // realm's generation — the device the cache key folds in for freshness.
      await testRealm.write(
        'mark.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { firstName: 'Mark' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        }),
      );

      let afterWrite = await postSearch(searchBody);
      assert.strictEqual(
        afterWrite.headers[LIVE_SEARCH_CACHE_HEADER],
        'miss',
        'the generation bump addresses a fresh entry',
      );
      assert.strictEqual(
        afterWrite.body.meta.page.total,
        5,
        'the new instance is in the fresh result',
      );
    });

    // Capture the query-shape lines a block of requests emits. The sink is
    // process-global, so anything else the process searches inside the block
    // lands in the same array — an in-render search from a background
    // prerender job would. Each request below therefore carries its own
    // correlation id and the assertions read only the lines stamped with it,
    // which is also what makes "one line per search" an assertion about that
    // request rather than about the process being quiet.
    async function captureSearchShapes(
      run: () => Promise<void>,
    ): Promise<SearchShapeEvent[]> {
      let events: SearchShapeEvent[] = [];
      setSearchShapeSink((event) => events.push(event));
      try {
        await run();
      } finally {
        setSearchShapeSink(undefined);
      }
      return events;
    }

    function shapesFor(events: SearchShapeEvent[], correlationId: string) {
      return events.filter((event) => event.correlationId === correlationId);
    }

    // A search the emitted line can be attributed to. The correlation id is
    // deliberately out of both cache keys, so two requests differing only in
    // it still share a cached body — which is what lets the cache-outcome
    // assertions below tell two otherwise identical requests apart.
    function postSearchCorrelated(
      correlationId: string,
      body: Record<string, unknown>,
    ) {
      return postSearch(body).set(
        'x-boxel-logging-correlation-id',
        correlationId,
      );
    }

    test('a federated search emits one query-shape line describing what it asked for', async function (assert) {
      let events = await captureSearchShapes(async () => {
        let response = await postSearchCorrelated('shape-basic', {
          filter: personFilter(),
          realms: [testRealm.url, secondaryRealm.url],
          sort: [{ by: 'item.createdAt', direction: 'desc' }],
          page: { size: 10 },
        });
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      });
      let lines = shapesFor(events, 'shape-basic');
      assert.strictEqual(lines.length, 1, 'exactly one line for this search');
      let [event] = lines;
      assert.strictEqual(
        event.filter,
        `type(${baseCardRef.module}/${baseCardRef.name})`,
        'a filter carrying only the type anchor is a pure card-type filter',
      );
      assert.strictEqual(
        event.sort,
        'createdAt:desc',
        'the sort renders its field and direction',
      );
      assert.strictEqual(event.pageSize, 10);
      assert.strictEqual(
        event.realms,
        `${testRealm.url},${secondaryRealm.url}`,
        'the realms the request named',
      );
      assert.strictEqual(event.realmCount, 2);
      assert.strictEqual(
        event.linkMode,
        'full',
        'live traffic assembles the whole link closure',
      );
      assert.true(
        event.itemAsFallback,
        'naming no fieldset selects the default resolution policy',
      );
      assert.false(event.truncated, 'nothing here approaches the member cap');
      assert.strictEqual(event.results, 4, 'the entries the response carried');
      assert.strictEqual(event.total, 4, 'the entries the query matched');
      assert.false(event.incomplete, 'both realms answered');
      assert.strictEqual(event.status, 200);
      assert.strictEqual(event.cache, 'miss', 'this request did the computing');
      assert.true(event.totalMs >= 0, 'the request is timed');
      assert.true(event.shapeHash.length > 0, 'the shape is hashed');
    });

    test('the query-shape line carries no filter value', async function (assert) {
      let events = await captureSearchShapes(async () => {
        let response = await postSearchCorrelated('shape-elision', {
          filter: {
            'item.on': baseCardRef,
            every: [
              { eq: { 'item.cardTitle': 'Jane' } },
              { contains: { 'item.cardDescription': 'a private substring' } },
            ],
          },
          realms: [testRealm.url],
        });
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      });
      let lines = shapesFor(events, 'shape-elision');
      assert.strictEqual(lines.length, 1, 'exactly one line for this search');
      let [event] = lines;
      assert.strictEqual(
        event.filter,
        `on(${baseCardRef.module}/${baseCardRef.name}):every(contains(cardDescription),eq(cardTitle))`,
        'the operators and the field paths they address, and nothing else',
      );
      let line = JSON.stringify(event);
      assert.false(line.includes('Jane'), 'no eq value reaches the line');
      assert.false(
        line.includes('a private substring'),
        'no contains value reaches the line',
      );
    });

    test('a live-cache hit reports the outcome and claims no counts', async function (assert) {
      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };
      let events = await captureSearchShapes(async () => {
        await postSearchCorrelated('shape-live-miss', searchBody);
        let second = await postSearchCorrelated('shape-live-hit', searchBody);
        assert.strictEqual(
          second.headers[LIVE_SEARCH_CACHE_HEADER],
          'hit',
          'the follow-up is served from the live cache',
        );
      });
      let [first] = shapesFor(events, 'shape-live-miss');
      let [second] = shapesFor(events, 'shape-live-hit');
      assert.strictEqual(first.cache, 'miss');
      assert.strictEqual(first.results, 4, 'the computing request counted');
      assert.strictEqual(second.cache, 'hit');
      assert.strictEqual(
        second.results,
        null,
        'a hit answers from a body it never built, so it counts nothing',
      );
      assert.strictEqual(second.total, null);
      assert.strictEqual(second.incomplete, null);
      assert.strictEqual(
        first.shapeHash,
        second.shapeHash,
        'the same query hashes the same however it was answered',
      );
    });

    test('the job-scoped cache reports populate, hit and revalidation separately', async function (assert) {
      // The indexer's protocol: the job headers make a request cacheable, and
      // an If-None-Match against the entry it populated revalidates into a 304.
      let searchBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };
      let asJob = (correlationId: string) =>
        postSearchCorrelated(correlationId, searchBody)
          .set('x-boxel-job-id', '42.1')
          .set('x-boxel-consuming-realm', testRealm.url);

      let etag: string | undefined;
      let events = await captureSearchShapes(async () => {
        let populated = await asJob('shape-job-miss');
        assert.strictEqual(populated.status, 200);
        etag = populated.headers['etag'];
        assert.true(Boolean(etag), 'a cacheable request carries an ETag');

        let repeated = await asJob('shape-job-hit');
        assert.strictEqual(repeated.status, 200);

        let revalidated = await asJob('shape-job-304').set(
          'If-None-Match',
          etag!,
        );
        assert.strictEqual(revalidated.status, 304);
      });

      let [populate] = shapesFor(events, 'shape-job-miss');
      let [hit] = shapesFor(events, 'shape-job-hit');
      let [notModified] = shapesFor(events, 'shape-job-304');
      assert.strictEqual(
        populate.cache,
        'job-miss',
        'the request that computed reports the populate',
      );
      assert.strictEqual(populate.results, 4);
      assert.strictEqual(hit.cache, 'job-hit', 'the repeat reports the hit');
      assert.strictEqual(
        hit.results,
        null,
        'a job-cache hit builds no document of its own',
      );
      assert.strictEqual(notModified.cache, 'not-modified');
      assert.strictEqual(
        notModified.status,
        304,
        'the revalidated status is reported',
      );
      assert.strictEqual(
        populate.shapeHash,
        hit.shapeHash,
        'one query, one shape, across all three outcomes',
      );
      assert.strictEqual(populate.shapeHash, notModified.shapeHash);
    });

    test('a search cut off by the time budget reports its 408', async function (assert) {
      // The 408 and the 500 override are the only two paths whose reported
      // status does not come from `ctxt.status`. The 408 is drivable here by
      // collapsing the budget on an item-leg search; an escaping throw is not
      // drivable from this suite without stubbing the search itself, so that
      // one path's status override is covered by inspection only.
      setSearchBoundsForTests({ timeBudgetMs: 0 });
      try {
        let events = await captureSearchShapes(async () => {
          let response = await postSearchCorrelated('shape-budget', {
            filter: personFilter(),
            fields: { entry: ['item'] },
            realms: [testRealm.url, secondaryRealm.url],
          });
          assert.strictEqual(
            response.status,
            408,
            'the over-budget item-leg search is cut off',
          );
        });
        let lines = shapesFor(events, 'shape-budget');
        assert.strictEqual(lines.length, 1, 'the cutoff still emits one line');
        let [event] = lines;
        assert.strictEqual(event.status, 408, 'the cutoff status is reported');
        assert.strictEqual(
          event.results,
          null,
          'a search that never finished counts nothing',
        );
        assert.strictEqual(
          event.cache,
          'miss',
          'the cache reported its decision before the populate was cut off',
        );
      } finally {
        resetSearchBoundsForTests();
      }
    });

    test('searches of the same shape share a hash across realms and pages', async function (assert) {
      let events = await captureSearchShapes(async () => {
        await postSearchCorrelated('shape-a', {
          filter: personFilter(),
          realms: [testRealm.url],
          page: { size: 10 },
        });
        await postSearchCorrelated('shape-b', {
          filter: personFilter(),
          realms: [secondaryRealm.url],
          page: { number: 1, size: 10 },
        });
        await postSearchCorrelated('shape-c', {
          filter: personFilter(),
          realms: [testRealm.url],
          page: { size: 3 },
        });
      });
      let [a] = shapesFor(events, 'shape-a');
      let [b] = shapesFor(events, 'shape-b');
      let [c] = shapesFor(events, 'shape-c');
      assert.strictEqual(
        a.shapeHash,
        b.shapeHash,
        'a different realm and page number is the same shape',
      );
      assert.notStrictEqual(
        a.shapeHash,
        c.shapeHash,
        'a different page size is a different shape',
      );
    });

    test('a rejected query emits no query-shape line', async function (assert) {
      let events = await captureSearchShapes(async () => {
        let response = await postSearchCorrelated('shape-rejected', {
          filter: { eq: { title: 'Jane' } },
          realms: [testRealm.url],
        });
        assert.strictEqual(
          response.status,
          400,
          'a field path not addressed through item. is rejected',
        );
      });
      assert.deepEqual(
        shapesFor(events, 'shape-rejected'),
        [],
        'a request that never parsed has no shape to report',
      );
    });
  });
});
