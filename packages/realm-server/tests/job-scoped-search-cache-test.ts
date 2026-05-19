import { module, test } from 'qunit';
import { basename } from 'path';
import type { Query } from '@cardstack/runtime-common';
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

// Cache stores serialized response bytes, not parsed docs. Tests
// model that by returning JSON strings directly. The shape matches
// what a real `searchRealms` populate thunk would produce after
// `JSON.stringify(..., null, 2)`.
function makeDoc(label: string): string {
  return JSON.stringify(
    {
      data: [{ type: 'card', id: `${realmA}${label}` }],
      meta: { page: { total: 1, realmVersion: 1 } },
    },
    null,
    2,
  );
}

module(basename(__filename), function () {
  module('JobScopedSearchCache', function () {
    test('cache hit when (jobId, realms, query, opts) match', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc('first');
      };

      let a = await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let b = await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(calls, 1, 'populate ran exactly once');
      assert.strictEqual(a, b, 'second caller got the cached doc');
      assert.strictEqual(cache.size(), 1, 'one entry stored');
    });

    test('cache returns the originally-serialized bytes on hit (no re-stringify)', async function (assert) {
      // The whole point of storing strings is to ship the cached bytes
      // directly. A populate that mutates its output on every call
      // makes this observable: if the cache ever re-ran populate or
      // re-serialized, the second hit would surface the newer bytes.
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      let firstHit = await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let secondHit = await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(calls, 1, 'populate only ran on the first miss');
      assert.strictEqual(
        secondHit,
        firstHit,
        'hit byte-equals the originally-cached body',
      );
      assert.ok(
        firstHit.includes('call-1'),
        'cached bytes are from the first populate, not a re-stringify',
      );
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
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '43.1',
        realms: [realmA],
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
        realms: [realmA],
        query: makeQuery('Mango'),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
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
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let b = await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let c = await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
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
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      let bP = cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
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
        realms: [realmA],
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
        realms: [realmA],
        query: makeQuery('A'),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('B'),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '43.1',
        realms: [realmA],
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
        realms: [realmA],
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

      // Fill exactly to capacity. Insertion order: A (seq 0), B (1),
      // C (2). All three under jobId 42.1.
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('A'),
        opts: undefined,
        populate: () => populate('A'),
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('B'),
        opts: undefined,
        populate: () => populate('B'),
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('C'),
        opts: undefined,
        populate: () => populate('C'),
      });
      assert.strictEqual(cache.size(), 3, 'at-capacity entry count');

      // One more insert triggers FIFO eviction of the oldest (A, seq 0).
      // Map now holds B, C, D (seqs 1, 2, 3).
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('D'),
        opts: undefined,
        populate: () => populate('D'),
      });
      assert.strictEqual(cache.size(), 3, 'still at cap after overflow');

      // Re-requesting A misses (evicted); the new A insert (seq 4)
      // pushes the now-oldest (B, seq 1) out. Map now holds C, D, A.
      let aCalls = 0;
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('A'),
        opts: undefined,
        populate: async () => {
          aCalls++;
          return populate('A');
        },
      });
      assert.strictEqual(aCalls, 1, 'A was re-populated (it was evicted)');
      assert.strictEqual(cache.size(), 3, 'still at cap after re-insert');

      // D was inserted just before A and is the youngest survivor —
      // verify it's still a hit. (Strict-FIFO: any of {C, D} could
      // remain depending on cap math; pick the most-recently-inserted
      // non-A entry so the assertion is stable under future cap
      // changes.)
      let dCalls = 0;
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('D'),
        opts: undefined,
        populate: async () => {
          dCalls++;
          return populate('D');
        },
      });
      assert.strictEqual(dCalls, 0, 'D was a cache hit (younger than B)');

      // B is the entry FIFO evicted by the A re-insert — verify it
      // misses, confirming "oldest non-active entry leaves first" is
      // what the cap enforces.
      let bCalls = 0;
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('B'),
        opts: undefined,
        populate: async () => {
          bCalls++;
          return populate('B');
        },
      });
      assert.strictEqual(bCalls, 1, 'B was evicted by the A re-insert');
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
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: { loadLinks: true },
        populate,
      });

      assert.strictEqual(calls, 2, 'different opts shapes did not coalesce');
    });

    test('cross-realm: same realm set coalesces, different set does not', async function (assert) {
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      // Two identical cross-realm calls — same (jobId, realms, query,
      // opts) — coalesce. This is the win the cross-realm expansion
      // exists for: a cohort card that fires the same broad search
      // multiple times during a single batch pays for the populate
      // exactly once.
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA, realmB],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA, realmB],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      assert.strictEqual(calls, 1, 'identical cross-realm sets coalesce');

      // A query against a different realm set under the same job
      // produces a distinct entry.
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      assert.strictEqual(calls, 2, 'different realm sets do not coalesce');
      assert.strictEqual(cache.size(), 2, 'two entries under the same job');
    });

    test('cross-realm: realm order is part of the key (not normalized)', async function (assert) {
      // `_federated-search` is order-preserving — `searchRealms`
      // queries each realm in the input order and `combineSearchResults`
      // concatenates `data` (and first-occurrence `included`) in that
      // same order. So `[A, B]` and `[B, A]` are *different* responses,
      // and the cache must not coalesce them.
      let cache = new JobScopedSearchCache();
      let calls = 0;
      let populate = async () => {
        calls++;
        return makeDoc(`call-${calls}`);
      };

      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA, realmB],
        query: makeQuery(),
        opts: undefined,
        populate,
      });
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmB, realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(
        calls,
        2,
        'reordered realm arrays produce distinct cache entries',
      );
      assert.strictEqual(cache.size(), 2, 'one entry per ordering');
    });
  });
});
