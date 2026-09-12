import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  CardDocumentCache,
  type CardDocumentCacheSummary,
  type CardJsonAssembly,
} from '@cardstack/runtime-common';

function documentAssembly(
  body: string,
  etag = '"1:card-rri"',
): CardJsonAssembly {
  return {
    kind: 'document',
    body,
    etag,
    etagSuppressed: false,
    lastModified: 1,
    created: 1,
  };
}

// A populate whose resolution the test controls, so concurrency windows are
// deterministic rather than raced against real work.
function deferredPopulate(assembly: CardJsonAssembly) {
  let resolve!: (value: CardJsonAssembly) => void;
  let calls = 0;
  let promise = new Promise<CardJsonAssembly>((res) => {
    resolve = res;
  });
  return {
    populate: () => {
      calls++;
      return promise;
    },
    resolve: () => resolve(assembly),
    get calls() {
      return calls;
    },
  };
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

const card = 'http://localhost:4202/test/person-1';

module(basename(import.meta.filename), function () {
  module('CardDocumentCache', function () {
    test('a second request within the TTL reads the first request’s bytes', async function (assert) {
      let cache = new CardDocumentCache({ telemetryIntervalMs: 0 });
      let assembled = 0;
      let populate = async () => {
        assembled++;
        return documentAssembly('first');
      };

      let first = await cache.getOrPopulate({
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate,
      });
      let second = await cache.getOrPopulate({
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate,
      });

      assert.strictEqual(first.outcome, 'miss', 'the first request assembles');
      assert.strictEqual(second.outcome, 'hit', 'the second reads the entry');
      assert.strictEqual(assembled, 1, 'only one assembly ran');
      assert.deepEqual(second.assembly, first.assembly, 'identical bytes');
    });

    test('concurrent requests for one card share a single assembly', async function (assert) {
      let cache = new CardDocumentCache({ telemetryIntervalMs: 0 });
      let deferred = deferredPopulate(documentAssembly('shared'));

      let args = {
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate: deferred.populate,
      };
      let first = cache.getOrPopulate(args);
      let second = cache.getOrPopulate(args);
      let third = cache.getOrPopulate(args);
      // Let all three reach the cache before the computation resolves.
      await sleep(0);
      deferred.resolve();
      let results = await Promise.all([first, second, third]);

      assert.strictEqual(deferred.calls, 1, 'one assembly for three requests');
      assert.deepEqual(
        results.map((r) => r.outcome),
        ['miss', 'join', 'join'],
        'the later two join the computation the first started',
      );
      for (let result of results) {
        assert.strictEqual(
          (result.assembly as { body: string }).body,
          'shared',
          'every request receives the same bytes',
        );
      }
    });

    // The freshness device: a re-indexed card carries a different validator,
    // which is a different key, so the entry assembled at the old validator
    // is unreachable rather than stale. Nothing evicts it.
    test('a rotated validator makes the previous entry unreachable', async function (assert) {
      let cache = new CardDocumentCache({ telemetryIntervalMs: 0 });
      let stale = await cache.getOrPopulate({
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate: async () => documentAssembly('before the write'),
      });
      let fresh = await cache.getOrPopulate({
        url: card,
        etag: '"200:card-rri"',
        skipQueryBackedExpansion: false,
        populate: async () => documentAssembly('after the write'),
      });

      assert.strictEqual(stale.outcome, 'miss');
      assert.strictEqual(
        fresh.outcome,
        'miss',
        'the request at the new validator recomputes',
      );
      assert.strictEqual(
        (fresh.assembly as { body: string }).body,
        'after the write',
        'and receives the bytes assembled at that validator',
      );
    });

    test('two cards, and one card’s two render audiences, hold separate entries', async function (assert) {
      let cache = new CardDocumentCache({ telemetryIntervalMs: 0 });
      let base = {
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate: async () => documentAssembly('body'),
      };

      let first = await cache.getOrPopulate({ ...base, url: card });
      let otherCard = await cache.getOrPopulate({
        ...base,
        url: 'http://localhost:4202/test/person-2',
      });
      let prerender = await cache.getOrPopulate({
        ...base,
        url: card,
        skipQueryBackedExpansion: true,
      });

      assert.strictEqual(first.outcome, 'miss');
      assert.strictEqual(
        otherCard.outcome,
        'miss',
        'a different card is a different entry',
      );
      assert.strictEqual(
        prerender.outcome,
        'miss',
        'a prerender read, whose body omits query-backed expansion, is a different entry',
      );
      assert.strictEqual(cache.stats.entryCount, 3, 'three entries retained');
    });

    // A redirect / missing row / error document is shared with whoever joined
    // the computation that produced it and then dropped, so the next request
    // consults the index again instead of a remembered failure.
    test('a non-document outcome is never retained', async function (assert) {
      let cache = new CardDocumentCache({ telemetryIntervalMs: 0 });
      let assembled = 0;
      let populate = async (): Promise<CardJsonAssembly> => {
        assembled++;
        return {
          kind: 'respond',
          respond: async () => new Response('nope', { status: 404 }),
        };
      };
      let args = {
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate,
      };

      let first = await cache.getOrPopulate(args);
      let second = await cache.getOrPopulate(args);

      assert.strictEqual(first.outcome, 'miss');
      assert.strictEqual(second.outcome, 'miss', 'the second request retries');
      assert.strictEqual(assembled, 2, 'and assembles again');
      assert.strictEqual(cache.stats.entryCount, 0, 'nothing was retained');
    });

    // The foreign-realm suppression: cross-realm invalidation doesn't cascade
    // `indexed_at`, so an assembly that discovers a foreign dependency emits
    // no validator — and a body with no validator has no key that would make
    // a superseded entry unreachable.
    test('an assembly whose validator was suppressed is not retained', async function (assert) {
      let cache = new CardDocumentCache({ telemetryIntervalMs: 0 });
      let args = {
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate: async (): Promise<CardJsonAssembly> => ({
          kind: 'document',
          body: 'body',
          etag: undefined,
          etagSuppressed: true,
          lastModified: 1,
          created: 1,
        }),
      };

      await cache.getOrPopulate(args);
      let second = await cache.getOrPopulate(args);

      assert.strictEqual(
        second.outcome,
        'miss',
        'the second request recomputes',
      );
      assert.strictEqual(cache.stats.entryCount, 0, 'nothing was retained');
    });

    test('the byte cap displaces the least recently used entry', async function (assert) {
      let body = 'x'.repeat(100);
      let cache = new CardDocumentCache({
        maxBytes: 250,
        telemetryIntervalMs: 0,
      });
      let put = (name: string) =>
        cache.getOrPopulate({
          url: `http://localhost:4202/test/${name}`,
          etag: '"100:card-rri"',
          skipQueryBackedExpansion: false,
          populate: async () => documentAssembly(body),
        });

      await put('a');
      await put('b');
      // Touch `a` so `b` becomes the least recently used entry.
      await put('a');
      await put('c');

      assert.strictEqual(
        cache.stats.entryCount,
        2,
        'the cap holds two entries',
      );
      assert.strictEqual(cache.stats.evicted, 1, 'one entry was displaced');
      assert.strictEqual(
        (await put('a')).outcome,
        'hit',
        'the recently used entry survived',
      );
      assert.strictEqual(
        (await put('b')).outcome,
        'miss',
        'the displaced entry recomputes',
      );
    });

    test('the telemetry summary reports the window’s outcomes', async function (assert) {
      let summaries: CardDocumentCacheSummary[] = [];
      let cache = new CardDocumentCache({
        telemetryIntervalMs: 1,
        emitTelemetry: (summary) => summaries.push(summary),
      });
      let args = {
        url: card,
        etag: '"100:card-rri"',
        skipQueryBackedExpansion: false,
        populate: async () => documentAssembly('body'),
      };

      await cache.getOrPopulate(args);
      await sleep(5);
      await cache.getOrPopulate(args);

      assert.ok(summaries.length > 0, 'a summary was emitted');
      let totals = summaries.reduce(
        (acc, s) => ({
          hits: acc.hits + s.hits,
          misses: acc.misses + s.misses,
        }),
        { hits: 0, misses: 0 },
      );
      assert.strictEqual(totals.misses, 1, 'one assembly is reported');
      assert.strictEqual(
        cache.stats.hits,
        1,
        'and the second request is reported as a hit',
      );
      assert.ok(
        totals.hits <= cache.stats.hits,
        'the emitted deltas never exceed the cumulative counters',
      );
    });
  });
});
