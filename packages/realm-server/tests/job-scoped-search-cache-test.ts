import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  query,
  param,
  type Query,
  type Expression,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import { JobScopedSearchCache } from '../job-scoped-search-cache.ts';

const realmA = 'http://localhost:4201/test/';
const realmB = 'http://localhost:4201/other/';

function makeQuery(firstName = 'Mango'): Query {
  return {
    filter: {
      eq: { firstName },
    },
  };
}

// The cache stores serialized response bytes, not parsed docs. Tests model that
// by returning JSON strings directly — the shape a real `searchRealms` populate
// thunk produces after `JSON.stringify(..., null, 2)`.
function makeDoc(label: string): string {
  return JSON.stringify(
    {
      data: [{ type: 'card', id: `${realmA}${label}` }],
      meta: { page: { total: 1, generation: 1 } },
    },
    null,
    2,
  );
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  module('JobScopedSearchCache (DB-backed)', function () {
    test('cache hit when (jobId, realms, query, opts) match', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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
      assert.strictEqual(await cache.size(), 1, 'one entry stored');
    });

    test('cache returns the originally-stored bytes on hit (no re-populate)', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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
      assert.strictEqual(secondHit, firstHit, 'hit equals the stored body');
      assert.ok(
        firstHit.includes('call-1'),
        'cached bytes are from the first populate',
      );
    });

    test('cache miss when jobId differs', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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
        (await cache.jobIds()).sort(),
        ['42.1', '43.1'],
        'cache is partitioned by jobId',
      );
    });

    test('cache miss when query differs (same jobId)', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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
      assert.strictEqual(
        await cache.size(),
        2,
        'two entries under the same job',
      );
    });

    test('opts variance produces distinct entries', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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

    test('cross-realm: realm order is part of the key (not normalized)', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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
      assert.strictEqual(await cache.size(), 2, 'one entry per ordering');
    });

    test('clearJob drops every entry for that job and leaves peers untouched', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
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

      await cache.clearJob('42.1');

      assert.deepEqual(await cache.jobIds(), ['43.1'], 'job 42 dropped');
      assert.strictEqual(await cache.size(), 1, 'only job 43 entry survives');
    });

    test('getCached: returns the cached body for a known key, undefined otherwise', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
      let populate = async () => makeDoc('peeked');

      assert.strictEqual(
        await cache.getCached({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery(),
          opts: undefined,
        }),
        undefined,
        'cold cache returns undefined',
      );

      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate,
      });

      assert.strictEqual(
        await cache.getCached({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery(),
          opts: undefined,
        }),
        makeDoc('peeked'),
        'warm cache returns the cached body',
      );
      assert.strictEqual(
        await cache.getCached({
          jobId: '99.9',
          realms: [realmA],
          query: makeQuery(),
          opts: undefined,
        }),
        undefined,
        'a different jobId is not visible to getCached',
      );
    });

    test('cross-replica: a second instance over the same DB sees the entry', async function (assert) {
      let replicaA = new JobScopedSearchCache(dbAdapter);
      let replicaB = new JobScopedSearchCache(dbAdapter);

      await replicaA.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate: async () => makeDoc('shared'),
      });

      let bPopulates = 0;
      let fromB = await replicaB.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate: async () => {
          bPopulates++;
          return makeDoc('B-should-not-run');
        },
      });

      assert.strictEqual(bPopulates, 0, 'replica B hit the shared entry');
      assert.strictEqual(
        fromB,
        makeDoc('shared'),
        "replica B returned replica A's cached bytes",
      );
      assert.strictEqual(
        await replicaB.getCached({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery(),
          opts: undefined,
        }),
        makeDoc('shared'),
        'replica B can read the shared entry',
      );
    });

    test('cross-replica: clearJob on one instance evicts for all', async function (assert) {
      let replicaA = new JobScopedSearchCache(dbAdapter);
      let replicaB = new JobScopedSearchCache(dbAdapter);

      await replicaA.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate: async () => makeDoc('shared'),
      });

      await replicaB.clearJob('42.1');

      assert.strictEqual(
        await replicaA.getCached({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery(),
          opts: undefined,
        }),
        undefined,
        "replica B's clearJob removed the row replica A populated",
      );
    });

    test('janitor sweeps entries older than the TTL, keeps fresh ones', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter, { ttlMs: 60_000 });

      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('old'),
        opts: undefined,
        populate: async () => makeDoc('old'),
      });
      // Age every existing row past the 60s TTL.
      await query(dbAdapter, [
        `UPDATE job_scoped_search_cache SET created_at = NOW() - INTERVAL '2 minutes'`,
      ] as Expression);
      // A fresh entry created now (well within the TTL).
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('fresh'),
        opts: undefined,
        populate: async () => makeDoc('fresh'),
      });
      assert.strictEqual(
        await cache.size(),
        2,
        'both entries present pre-sweep',
      );

      await cache.sweepExpired();

      assert.strictEqual(await cache.size(), 1, 'the aged entry was swept');
      assert.strictEqual(
        await cache.getCached({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery('fresh'),
          opts: undefined,
        }),
        makeDoc('fresh'),
        'the fresh entry survived',
      );
      assert.strictEqual(
        await cache.getCached({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery('old'),
          opts: undefined,
        }),
        undefined,
        'the aged entry is gone',
      );
    });

    test('janitor flushes stale local stats even when clearJob never ran for the job', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter, { ttlMs: 20 });

      // A miss records a per-process #stats entry for this job.
      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate: async () => makeDoc('first'),
      });
      assert.strictEqual(
        cache.trackedStatJobCount,
        1,
        'a miss records a local stats entry',
      );

      // The shared rows vanish without this process running clearJob — a peer
      // replica cleared them first, or the janitor reclaimed them on a missed
      // NOTIFY. The local #stats entry would otherwise linger forever.
      await query(dbAdapter, [
        `DELETE FROM job_scoped_search_cache`,
      ] as Expression);

      await new Promise((r) => setTimeout(r, 40)); // age the stat past the 20ms TTL
      await cache.sweepExpired();

      assert.strictEqual(
        cache.trackedStatJobCount,
        0,
        'the orphaned stats entry was flushed rather than retained indefinitely',
      );
    });

    test('janitor keeps local stats for a job still within the TTL', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter, { ttlMs: 60_000 });

      await cache.getOrPopulate({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
        populate: async () => makeDoc('first'),
      });

      await cache.sweepExpired();

      assert.strictEqual(
        cache.trackedStatJobCount,
        1,
        'a fresh stats entry survives the sweep',
      );
    });

    test('computeETag: stable across calls with identical inputs', function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
      let a = cache.computeETag({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
      });
      let b = cache.computeETag({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
      });
      assert.strictEqual(a, b, 'same inputs produce the same ETag');
      assert.ok(
        /^W\/"42\.1-[0-9a-f]+"$/.test(a),
        `ETag is weak-form quoted "<jobId>-<digest>": ${a}`,
      );
    });

    test('computeETag: changes when jobId changes', function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
      let a = cache.computeETag({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
      });
      let b = cache.computeETag({
        jobId: '43.1',
        realms: [realmA],
        query: makeQuery(),
        opts: undefined,
      });
      assert.notStrictEqual(
        a,
        b,
        'a stale ETag from a prior batch cannot match a fresh entry',
      );
    });

    test('computeETag: changes when query, realms, or opts change', function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
      let base = cache.computeETag({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('Mango'),
        opts: undefined,
      });
      let diffQuery = cache.computeETag({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('Vango'),
        opts: undefined,
      });
      let diffRealms = cache.computeETag({
        jobId: '42.1',
        realms: [realmA, realmB],
        query: makeQuery('Mango'),
        opts: undefined,
      });
      let diffRealmOrder = cache.computeETag({
        jobId: '42.1',
        realms: [realmB, realmA],
        query: makeQuery('Mango'),
        opts: undefined,
      });
      let diffOpts = cache.computeETag({
        jobId: '42.1',
        realms: [realmA],
        query: makeQuery('Mango'),
        opts: { htmlFormat: 'embedded' },
      });
      assert.notStrictEqual(base, diffQuery, 'query change → new ETag');
      assert.notStrictEqual(base, diffRealms, 'realm set change → new ETag');
      assert.notStrictEqual(
        base,
        diffRealmOrder,
        'realm order is part of the key',
      );
      assert.notStrictEqual(base, diffOpts, 'opts change → new ETag');
    });

    test('realmGenerations reads index + prerendered-HTML state per realm', async function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
      let seedGeneration = async (realm: string, generation: number) => {
        await query(dbAdapter, [
          `INSERT INTO realm_generations (realm_url, current_generation) VALUES (`,
          param(realm),
          `,`,
          param(generation),
          `)`,
        ] as Expression);
      };
      let seedPrerendered = async (
        realm: string,
        url: string,
        generation: number,
      ) => {
        await query(dbAdapter, [
          `INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation) VALUES (`,
          param(url),
          `,`,
          param(url),
          `,`,
          param(realm),
          `,`,
          param('instance'),
          `,`,
          param(generation),
          `)`,
        ] as Expression);
      };

      // realmA: index at generation 5, HTML published across generations 3 & 4.
      await seedGeneration(realmA, 5);
      await seedPrerendered(realmA, `${realmA}A/1`, 3);
      await seedPrerendered(realmA, `${realmA}A/2`, 4);
      // realmB: index at generation 2, no prerendered HTML yet.
      await seedGeneration(realmB, 2);

      let gens = await cache.realmGenerations([realmA, realmB]);
      assert.deepEqual(
        gens[realmA],
        { index: 5, html: 4 },
        'index = current_generation; html = MAX(prerendered_html.generation)',
      );
      assert.deepEqual(
        gens[realmB],
        { index: 2, html: 0 },
        'a realm with no prerendered rows reads html = 0',
      );

      // A realm absent from realm_generations reads as a stable zero.
      let unknown = 'http://localhost:4201/nope/';
      let missing = await cache.realmGenerations([unknown]);
      assert.deepEqual(missing[unknown], { index: 0, html: 0 });
    });

    test('computeETag: changes when either the index or the prerendered-HTML generation advances', function (assert) {
      let cache = new JobScopedSearchCache(dbAdapter);
      // Mirror the handler: the per-realm generation fingerprint is folded into
      // the cache-key opts, so the ETag advances when either channel does.
      let etag = (generations: unknown) =>
        cache.computeETag({
          jobId: '42.1',
          realms: [realmA],
          query: makeQuery(),
          opts: { generations },
        });

      let base = etag({ [realmA]: { index: 5, html: 4 } });
      let indexAdvanced = etag({ [realmA]: { index: 6, html: 4 } });
      let htmlAdvanced = etag({ [realmA]: { index: 5, html: 5 } });

      assert.notStrictEqual(
        base,
        indexAdvanced,
        'index generation advance → new ETag',
      );
      assert.notStrictEqual(
        base,
        htmlAdvanced,
        'prerendered-HTML generation advance → new ETag (no stale 304)',
      );
      assert.strictEqual(
        base,
        etag({ [realmA]: { index: 5, html: 4 } }),
        'identical generation state → stable ETag',
      );
    });
  });
});
