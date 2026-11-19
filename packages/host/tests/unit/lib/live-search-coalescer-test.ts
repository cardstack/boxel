import { module, test } from 'qunit';

import {
  LIVE_SEARCH_REUSE_TTL_MS,
  LiveSearchCoalescer,
} from '@cardstack/host/lib/live-search-coalescer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  let promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

module('Unit | lib | live search coalescer', function () {
  test('identical requests in flight share one fetch', async function (assert) {
    let coalescer = new LiveSearchCoalescer<string>();
    let fetches = 0;
    let pending = deferred<string>();
    let fetch = () => {
      fetches++;
      return pending.promise;
    };

    let first = coalescer.run('q', 'f', fetch);
    let second = coalescer.run('q', 'f', fetch);
    pending.resolve('doc');

    assert.strictEqual(await first, 'doc');
    assert.strictEqual(await second, 'doc');
    assert.strictEqual(fetches, 1, 'the second request joined the first');
  });

  test('a settled answer satisfies a later identical request within the TTL', async function (assert) {
    let now = 1000;
    let coalescer = new LiveSearchCoalescer<string>({ now: () => now });
    let fetches = 0;
    let fetch = async () => `doc-${++fetches}`;

    assert.strictEqual(await coalescer.run('q', 'f', fetch), 'doc-1');
    now += LIVE_SEARCH_REUSE_TTL_MS;
    assert.strictEqual(
      await coalescer.run('q', 'f', fetch),
      'doc-1',
      'reused at the edge of the TTL',
    );
    now += 1;
    assert.strictEqual(
      await coalescer.run('q', 'f', fetch),
      'doc-2',
      'past the TTL the request is sent again',
    );
  });

  test('a request in flight longer than the TTL is not joined', async function (assert) {
    let now = 1000;
    let coalescer = new LiveSearchCoalescer<string>({ now: () => now });
    let fetches = 0;
    let stalled = deferred<string>();
    let fetch = () => {
      fetches++;
      return fetches === 1 ? stalled.promise : Promise.resolve('fresh');
    };

    let first = coalescer.run('q', 'f', fetch);
    now += LIVE_SEARCH_REUSE_TTL_MS + 1;
    assert.strictEqual(
      await coalescer.run('q', 'f', fetch),
      'fresh',
      'a later request is sent rather than waiting on the stalled one',
    );
    stalled.resolve('late');
    assert.strictEqual(await first, 'late', 'the stalled caller keeps its own');
  });

  test('the reuse window runs from when the request was sent', async function (assert) {
    let now = 1000;
    let coalescer = new LiveSearchCoalescer<string>({ now: () => now });
    let fetches = 0;
    let slow = deferred<string>();
    let fetch = () => {
      fetches++;
      return fetches === 1 ? slow.promise : Promise.resolve('doc-2');
    };

    let first = coalescer.run('q', 'f', fetch);
    now += LIVE_SEARCH_REUSE_TTL_MS - 1;
    slow.resolve('doc-1');
    await first;
    now += 2;
    assert.strictEqual(
      await coalescer.run('q', 'f', fetch),
      'doc-2',
      'an answer that settled late is not reused past its send time + TTL',
    );
  });

  test('a changed fingerprint is never served the earlier answer', async function (assert) {
    let coalescer = new LiveSearchCoalescer<string>();
    let fetches = 0;
    let pending = deferred<string>();
    let fetch = () => {
      fetches++;
      return fetches === 1 ? pending.promise : Promise.resolve('fresh');
    };

    let before = coalescer.run('q', 'events:1', fetch);
    let after = coalescer.run('q', 'events:2', fetch);
    assert.strictEqual(
      coalescer.peek('q', 'events:1'),
      undefined,
      'the newer request replaced the older one as the shared answer',
    );
    pending.resolve('stale');

    assert.strictEqual(await before, 'stale', 'the first caller keeps its own');
    assert.strictEqual(await after, 'fresh');
    assert.strictEqual(fetches, 2);
    assert.strictEqual(
      await coalescer.run('q', 'events:2', fetch),
      'fresh',
      'the newer answer is the one shared',
    );
  });

  test('different keys never share', async function (assert) {
    let coalescer = new LiveSearchCoalescer<string>();
    let fetches = 0;
    let fetch = async () => `doc-${++fetches}`;

    assert.strictEqual(await coalescer.run('a', 'f', fetch), 'doc-1');
    assert.strictEqual(await coalescer.run('b', 'f', fetch), 'doc-2');
  });

  test('a failed request is not shared past its own waiters', async function (assert) {
    let coalescer = new LiveSearchCoalescer<string>();
    let fetches = 0;
    let pending = deferred<string>();
    let fetch = () => {
      fetches++;
      return fetches === 1 ? pending.promise : Promise.resolve('retry');
    };

    let first = coalescer.run('q', 'f', fetch);
    let joined = coalescer.run('q', 'f', fetch);
    pending.reject(new Error('boom'));

    await assert.rejects(first, /boom/);
    await assert.rejects(joined, /boom/, 'a waiter shares the failure');
    assert.strictEqual(coalescer.peek('q', 'f'), undefined);
    assert.strictEqual(
      await coalescer.run('q', 'f', fetch),
      'retry',
      'the next request is sent again',
    );
  });

  test('clear drops every shared answer', async function (assert) {
    let coalescer = new LiveSearchCoalescer<string>();
    let fetches = 0;
    let fetch = async () => `doc-${++fetches}`;

    await coalescer.run('q', 'f', fetch);
    coalescer.clear();
    assert.strictEqual(await coalescer.run('q', 'f', fetch), 'doc-2');
  });
});
