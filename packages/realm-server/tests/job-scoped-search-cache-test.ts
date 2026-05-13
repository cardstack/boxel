import { module, test } from 'qunit';
import { basename } from 'path';
import type {
  LinkableCollectionDocument,
  Query,
} from '@cardstack/runtime-common';
import { JobScopedSearchCache } from '../job-scoped-search-cache';

const realmA = 'http://localhost:4201/test/';
const realmB = 'http://localhost:4201/other/';

function makeQuery(firstName = 'Mango'): Query {
  return {
    filter: {
      eq: { firstName },
    },
  };
}

function makeDoc(label: string): LinkableCollectionDocument {
  return {
    data: [{ type: 'card', id: `${realmA}${label}` }],
    meta: { page: { total: 1, realmVersion: 1 } },
  } as unknown as LinkableCollectionDocument;
}

module(basename(__filename), function () {
  module('JobScopedSearchCache', function () {
    test('cache hit when (jobId, query, opts) match', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc('first');
      };

      let a = await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let b = await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(calls, 1, 'populate ran exactly once');
      assert.strictEqual(a, b, 'second caller got the cached doc');
      assert.strictEqual(cache.size(), 1, 'one entry stored');
    });

    test('cache miss when jobId differs', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '43.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(calls, 2, 'each job ran its own populate');
      assert.deepEqual(
        cache.jobIds().sort(),
        ['42.1', '43.1'],
        'cache is partitioned by jobId',
      );
    });

    test('cache miss when query differs (same jobId)', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('Mango'),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('Vango'),
        opts: undefined,
        populate,
      });

      assert.strictEqual(
        calls,
        2,
        'different filters fired distinct populates',
      );
      assert.strictEqual(cache.size(), 2, 'two entries under the same job');
    });

    test('sequential callers after first populate see the cached doc', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      let a = await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let b = await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let c = await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(
        calls,
        1,
        'only the first sequential caller ran populate',
      );
      assert.strictEqual(a, b, 'b returned the cached doc');
      assert.strictEqual(b, c, 'c returned the cached doc');
    });

    test('concurrent identical callers each run their own populate (intentional)', async function (assert) {
      // The cache stores resolved values, not promises. Concurrent
      // same-key callers each run their own populate so a slow first
      // call can't tail-latency-block peers past their render-timeout
      // window. Phase 1's inner in-flight dedup (in
      // RealmIndexQueryEngine.searchCards) absorbs the duplicate inner
      // SQL+loadLinks work; this cache only optimises *sequential*
      // repeats. Last-write-wins on the cache entry.
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let release!: () => void;
      let gate = new Promise<void>((r) => {
        release = r;
      });
      let populate = async () => {
        let myCall = ++calls;
        await gate;
        return makeDoc(`call-${myCall}`);
      };

      let aP = cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let bP = cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await new Promise((r) => setTimeout(r, 0));
      release();
      let [a, b] = await Promise.all([aP, bP]);

      assert.strictEqual(
        calls,
        2,
        'both concurrent callers ran their own populate',
      );
      assert.ok(a, 'a resolved');
      assert.ok(b, 'b resolved');
      // A subsequent sequential caller observes whichever doc landed
      // last in the cache. (Last-write-wins; either is valid.)
      let c = await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      assert.strictEqual(
        calls,
        2,
        'sequential c hit the cache (no new populate)',
      );
      let cIsOneOfCached = c === a || c === b;
      assert.true(cIsOneOfCached, 'c returned one of the cached docs');
    });

    test('clearJob drops every entry for that job and leaves peers untouched', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('A'),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('B'),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '43.1',
        query: makeQuery('A'),
        opts: undefined,
        populate,
      });

      cache.clearJob('42.1');

      assert.deepEqual(cache.jobIds(), ['43.1'], 'job 42 dropped');
      assert.strictEqual(cache.size(), 1, 'only job 43 entry survives');
    });

    test('TTL evicts entries after the configured window', async function (assert) {
      let cache = new JobScopedSearchCache({ ttlMs: 10 });
      let populate = async () => makeDoc('x');

      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      assert.strictEqual(cache.size(), 1, 'entry stored');

      await new Promise((r) => setTimeout(r, 25));
      assert.strictEqual(cache.size(), 0, 'entry evicted after TTL');
    });

    test('maxEntries cap FIFO-evicts oldest when full', async function (assert) {
      let cache = new JobScopedSearchCache({ maxEntries: 3 });
      let populate = async (label: string) => makeDoc(label);

      // Fill exactly to capacity.
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('A'),
        opts: undefined,
        populate: () => populate('A'),
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('B'),
        opts: undefined,
        populate: () => populate('B'),
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('C'),
        opts: undefined,
        populate: () => populate('C'),
      });
      assert.strictEqual(cache.size(), 3, 'at-capacity entry count');

      // One more triggers FIFO eviction of the oldest (A).
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('D'),
        opts: undefined,
        populate: () => populate('D'),
      });
      assert.strictEqual(cache.size(), 3, 'still at cap after overflow');

      // Re-requesting A re-populates (cache miss); B and C remain hits.
      let aCalls = 0;
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('A'),
        opts: undefined,
        populate: async () => {
          aCalls++;
          return populate('A');
        },
      });
      assert.strictEqual(aCalls, 1, 'A was re-populated (it was evicted)');

      let bCalls = 0;
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery('B'),
        opts: undefined,
        populate: async () => {
          bCalls++;
          return populate('B');
        },
      });
      assert.strictEqual(bCalls, 0, 'B was a cache hit (not evicted)');
    });

    test('opts variance produces distinct entries', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        query: makeQuery(),
        opts: { loadLinks: true },
        populate,
      });

      assert.strictEqual(calls, 2, 'different opts shapes did not coalesce');
    });

    // Cross-realm-bypass is enforced by handle-search, not by the cache
    // class itself — the cache stays oblivious to realm topology. Here
    // we just verify the cache stores whatever (jobId, query, opts)
    // tuple a caller passes, regardless of what realm the query
    // mentions internally. End-to-end coverage of the
    // `realms === [consumingRealm]` HTTP-layer gate is TODO — a
    // `realm-endpoints/search-test.ts` case is the right home for it.
    test('cache is realm-agnostic — the gate lives in handle-search', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc('cross');
      };

      // Two queries that both happen to mention realmB via a contained
      // filter still get coalesced if their (jobId, normalized query,
      // opts) match. The gate that prevents cross-realm caching is
      // applied BEFORE getOrPopulate at the handler layer.
      await cache.getOrPopulate({
        jobId: '42.1',
        query: { filter: { eq: { realm: realmB } } } as Query,
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        query: { filter: { eq: { realm: realmB } } } as Query,
        opts: undefined,
        populate,
      });

      assert.strictEqual(calls, 1, 'second call hit the cache');
    });
  });
});
