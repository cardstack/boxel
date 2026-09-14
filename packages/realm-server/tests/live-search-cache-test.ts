import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Query } from '@cardstack/runtime-common';
import {
  LiveSearchCache,
  type LiveSearchCacheSummary,
} from '../live-search-cache.ts';

function personQuery(name = 'Person'): Query {
  return {
    filter: { type: { module: 'http://example.com/person', name } },
  } as Query;
}

// A populate whose resolution the test controls, so concurrency windows are
// deterministic rather than raced against real work.
function deferredPopulate(body: string) {
  let resolve!: (value: string) => void;
  let reject!: (reason: unknown) => void;
  let calls = 0;
  let promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    populate: () => {
      calls++;
      return promise;
    },
    resolve: () => resolve(body),
    reject: (reason: unknown) => reject(reason),
    get calls() {
      return calls;
    },
  };
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

module(basename(import.meta.filename), function () {
  test('concurrent identical requests share one populate', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 60_000 });
    let deferred = deferredPopulate('{"data":[1]}');
    let realms = ['http://a/'];

    let first = cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: deferred.populate,
    });
    let second = cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: deferred.populate,
    });
    deferred.resolve();
    let [a, b] = await Promise.all([first, second]);

    assert.strictEqual(deferred.calls, 1, 'populate ran once');
    assert.strictEqual(a.outcome, 'miss');
    assert.strictEqual(b.outcome, 'join');
    assert.strictEqual(a.body, b.body, 'both callers share the body');
  });

  test('onOutcome fires when the cache decides, not when the body resolves', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 60_000 });
    let deferred = deferredPopulate('{"data":[1]}');
    let realms = ['http://a/'];
    let decided: string[] = [];
    let load = () =>
      cache.getOrPopulate({
        realms,
        query: personQuery(),
        opts: undefined,
        populate: deferred.populate,
        onOutcome: (outcome) => decided.push(outcome),
      });

    let first = load();
    assert.deepEqual(decided, ['miss'], 'the miss is announced as it starts');
    let second = load();
    assert.deepEqual(
      decided,
      ['miss', 'join'],
      'the join is announced before the joiner has anything to wait on',
    );
    assert.strictEqual(deferred.calls, 1, 'one populate');

    deferred.resolve();
    await Promise.all([first, second]);

    let third = load();
    assert.deepEqual(
      decided,
      ['miss', 'join', 'hit'],
      'a hit is announced synchronously on the call',
    );
    assert.strictEqual((await third).outcome, 'hit');
  });

  test('different queries do not coalesce', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 60_000 });
    let realms = ['http://a/'];
    let calls = 0;
    let populate = async () => {
      calls++;
      return `{"n":${calls}}`;
    };

    let [a, b] = await Promise.all([
      cache.getOrPopulate({
        realms,
        query: personQuery('Person'),
        opts: undefined,
        populate,
      }),
      cache.getOrPopulate({
        realms,
        query: personQuery('Pet'),
        opts: undefined,
        populate,
      }),
    ]);
    assert.strictEqual(calls, 2, 'each distinct query computes');
    assert.strictEqual(a.outcome, 'miss');
    assert.strictEqual(b.outcome, 'miss');
  });

  test('a body is served from cache within the TTL and recomputed after it', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 50 });
    let realms = ['http://a/'];
    let calls = 0;
    let populate = async () => {
      calls++;
      return `{"n":${calls}}`;
    };
    let args = () => ({
      realms,
      query: personQuery(),
      opts: undefined,
      populate,
    });

    let first = await cache.getOrPopulate(args());
    let second = await cache.getOrPopulate(args());
    assert.strictEqual(first.outcome, 'miss');
    assert.strictEqual(second.outcome, 'hit');
    assert.strictEqual(second.body, first.body);
    assert.strictEqual(calls, 1);

    await sleep(80);
    let third = await cache.getOrPopulate(args());
    assert.strictEqual(third.outcome, 'miss', 'expired entry recomputes');
    assert.strictEqual(calls, 2);
  });

  test('ttl 0 disables retention but still coalesces in-flight requests', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 0 });
    let realms = ['http://a/'];
    let deferred = deferredPopulate('{"data":[]}');

    let first = cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: deferred.populate,
    });
    let second = cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: deferred.populate,
    });
    deferred.resolve();
    let [a, b] = await Promise.all([first, second]);
    assert.strictEqual(a.outcome, 'miss');
    assert.strictEqual(b.outcome, 'join', 'coalescing still applies');

    let calls = 0;
    let third = await cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: async () => {
        calls++;
        return '{"data":[]}';
      },
    });
    assert.strictEqual(third.outcome, 'miss', 'nothing was retained');
    assert.strictEqual(calls, 1);
    assert.strictEqual(cache.stats.entryCount, 0);
  });

  test('changed realm generations in opts address a different entry', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 60_000 });
    let realms = ['http://a/'];
    let calls = 0;
    let populate = async () => {
      calls++;
      return `{"n":${calls}}`;
    };
    let argsAtGeneration = (index: number) => ({
      realms,
      query: personQuery(),
      opts: { generations: { 'http://a/': { index, html: 0 } } },
      populate,
    });

    let before = await cache.getOrPopulate(argsAtGeneration(1));
    let after = await cache.getOrPopulate(argsAtGeneration(2));
    assert.strictEqual(before.outcome, 'miss');
    assert.strictEqual(
      after.outcome,
      'miss',
      'a generation bump busts the entry',
    );
    assert.strictEqual(calls, 2);
    assert.notStrictEqual(after.body, before.body);
  });

  test('a rejected populate propagates to every waiter and is not retained', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 60_000 });
    let realms = ['http://a/'];
    let deferred = deferredPopulate('unused');

    let first = cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: deferred.populate,
    });
    let second = cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: deferred.populate,
    });
    deferred.reject(new Error('search blew up'));
    for (let promise of [first, second]) {
      try {
        await promise;
        assert.ok(false, 'should have rejected');
      } catch (e: unknown) {
        assert.strictEqual((e as Error).message, 'search blew up');
      }
    }

    let retry = await cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: async () => '{"data":[]}',
    });
    assert.strictEqual(
      retry.outcome,
      'miss',
      'the failed key recomputes rather than joining a dead promise',
    );
  });

  test('the byte cap evicts least-recently-used entries', async function (assert) {
    // Each body is 10 chars; cap of 25 holds two entries, not three.
    let cache = new LiveSearchCache({ ttlMs: 60_000, maxBytes: 25 });
    let realms = ['http://a/'];
    let body = '0123456789';
    let load = (name: string) =>
      cache.getOrPopulate({
        realms,
        query: personQuery(name),
        opts: undefined,
        populate: async () => body,
      });

    await load('A');
    await load('B');
    // Touch A so B is the least-recently-used entry when C arrives.
    let touched = await load('A');
    assert.strictEqual(touched.outcome, 'hit');

    await load('C');
    assert.strictEqual(cache.stats.entryCount, 2, 'cap held two entries');
    assert.strictEqual((await load('A')).outcome, 'hit', 'A survived');
    assert.strictEqual((await load('C')).outcome, 'hit', 'C survived');
    assert.strictEqual((await load('B')).outcome, 'miss', 'B was evicted');
  });

  test('a body larger than the whole cap is served but never retained', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 60_000, maxBytes: 5 });
    let realms = ['http://a/'];
    let result = await cache.getOrPopulate({
      realms,
      query: personQuery(),
      opts: undefined,
      populate: async () => 'a-body-larger-than-the-cap',
    });
    assert.strictEqual(result.outcome, 'miss');
    assert.strictEqual(result.body, 'a-body-larger-than-the-cap');
    assert.strictEqual(cache.stats.entryCount, 0);
    assert.strictEqual(cache.stats.sizeBytes, 0);
    assert.strictEqual(cache.stats.oversized, 1, 'the skip is counted');
  });

  test('lifecycle counters attribute expiry, eviction, and errors separately', async function (assert) {
    let cache = new LiveSearchCache({ ttlMs: 50, maxBytes: 25 });
    let realms = ['http://a/'];
    let load = (name: string) =>
      cache.getOrPopulate({
        realms,
        query: personQuery(name),
        opts: undefined,
        populate: async () => '0123456789',
      });

    // Three 10-char bodies against a 25-char cap: C's arrival evicts A (LRU).
    await load('A');
    await load('B');
    await load('C');
    assert.strictEqual(cache.stats.evicted, 1, 'cap displacement is evicted');
    assert.strictEqual(cache.stats.expired, 0);

    // Aging out and re-requesting counts as expired, not evicted.
    await sleep(80);
    await load('B');
    assert.ok(
      cache.stats.expired >= 1,
      `aged-out entries count as expired (saw ${cache.stats.expired})`,
    );
    assert.strictEqual(cache.stats.evicted, 1, 'evicted is unchanged');

    // A failed compute is one error, regardless of joiner count.
    let deferred = deferredPopulate('unused');
    let attempts = [
      cache.getOrPopulate({
        realms,
        query: personQuery('D'),
        opts: undefined,
        populate: deferred.populate,
      }),
      cache.getOrPopulate({
        realms,
        query: personQuery('D'),
        opts: undefined,
        populate: deferred.populate,
      }),
    ];
    deferred.reject(new Error('boom'));
    for (let attempt of attempts) {
      await attempt.catch(() => {});
    }
    assert.strictEqual(cache.stats.errors, 1, 'one error per failed compute');
  });

  test('telemetry summarizes window deltas once per interval', async function (assert) {
    let summaries: LiveSearchCacheSummary[] = [];
    let cache = new LiveSearchCache({
      ttlMs: 60_000,
      telemetryIntervalMs: 200,
      emitTelemetry: (summary) => summaries.push(summary),
    });
    let realms = ['http://a/'];
    let body = '{"data":[]}';
    let load = () =>
      cache.getOrPopulate({
        realms,
        query: personQuery(),
        opts: undefined,
        populate: async () => body,
      });

    await load(); // miss
    await load(); // hit — within the interval, so nothing emits yet
    assert.strictEqual(summaries.length, 0, 'the floor interval holds');

    await sleep(250);
    await load(); // hit — crosses the interval, emitting the whole window
    assert.strictEqual(summaries.length, 1, 'one summary per interval');
    let [summary] = summaries;
    assert.strictEqual(summary.event_type, 'summary');
    assert.strictEqual(summary.misses, 1);
    assert.strictEqual(summary.hits, 2);
    assert.strictEqual(summary.missBytes, body.length);
    assert.strictEqual(summary.hitBytes, body.length * 2);
    assert.ok(summary.windowMs >= 200, 'the window spans the interval');
    assert.strictEqual(summary.entryCount, 1);
    assert.strictEqual(summary.sizeBytes, body.length);
    assert.strictEqual(summary.ttlMs, 60_000, 'config echoes on the line');

    // The next window's deltas start from zero.
    await sleep(250);
    await load(); // hit
    assert.strictEqual(summaries.length, 2);
    assert.strictEqual(summaries[1].hits, 1, 'deltas reset per window');
    assert.strictEqual(summaries[1].misses, 0);
  });

  test('telemetry interval 0 disables emission', async function (assert) {
    let summaries: LiveSearchCacheSummary[] = [];
    let cache = new LiveSearchCache({
      ttlMs: 60_000,
      telemetryIntervalMs: 0,
      emitTelemetry: (summary) => summaries.push(summary),
    });
    await cache.getOrPopulate({
      realms: ['http://a/'],
      query: personQuery(),
      opts: undefined,
      populate: async () => '{"data":[]}',
    });
    await sleep(10);
    await cache.getOrPopulate({
      realms: ['http://a/'],
      query: personQuery(),
      opts: undefined,
      populate: async () => '{"data":[]}',
    });
    assert.strictEqual(summaries.length, 0, 'nothing emits');
  });
});
