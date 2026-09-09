import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Query } from '@cardstack/runtime-common';
import { LiveSearchCache } from '../live-search-cache.ts';

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
  });
});
