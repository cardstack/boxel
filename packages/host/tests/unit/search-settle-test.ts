import { restartableTask, timeout } from 'ember-concurrency';
import { module, test } from 'qunit';

import { SearchSettle } from '@cardstack/host/lib/search-settle';

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => (now += ms),
  };
}

function settleWith(
  clock: ReturnType<typeof fakeClock>,
  options: { isIndexRender?: () => boolean } = {},
) {
  return new SearchSettle({
    now: clock.now,
    timing: () => ({ settleMs: 150, maxWaitMs: 400 }),
    isIndexRender: options.isIndexRender ?? (() => false),
  });
}

// Mirrors how the live search resources wire the settle: each query change
// asks for its delay, then performs a restartable task that waits that long
// (a cancellation point) before it fetches.
class Harness {
  fetches: { query: string; at: number }[] = [];
  #settle: SearchSettle;
  #started = performance.now();

  constructor(settle: SearchSettle) {
    this.#settle = settle;
  }

  change(query: string) {
    return this.run.perform(query, this.#settle.delayForChange());
  }

  run = restartableTask(async (query: string, settleMs: number) => {
    await Promise.resolve();
    if (settleMs > 0) {
      await timeout(settleMs);
    }
    this.#settle.fetchStarted();
    this.fetches.push({ query, at: performance.now() - this.#started });
  });
}

module('Unit | search settle', function () {
  test('the first query fetches with no delay', function (assert) {
    let settle = settleWith(fakeClock());
    assert.strictEqual(settle.delayForChange(), 0);
  });

  test('a change after idle fetches immediately', function (assert) {
    let clock = fakeClock();
    let settle = settleWith(clock);
    settle.delayForChange();
    settle.fetchStarted();
    clock.advance(150);
    assert.strictEqual(settle.delayForChange(), 0, 'exactly one window later');
    clock.advance(5000);
    assert.strictEqual(settle.delayForChange(), 0, 'long after');
  });

  test('a change within the window waits for the input to settle', function (assert) {
    let clock = fakeClock();
    let settle = settleWith(clock);
    settle.delayForChange();
    settle.fetchStarted();
    clock.advance(16);
    assert.strictEqual(settle.delayForChange(), 150);
    clock.advance(16);
    assert.strictEqual(settle.delayForChange(), 150, 'each change re-arms');
  });

  test('a continuous drag still fetches at the throttle ceiling', function (assert) {
    let clock = fakeClock();
    let settle = settleWith(clock);
    settle.delayForChange();
    settle.fetchStarted();
    let delays: number[] = [];
    // A change every 50 ms; none of the waiting runs gets to fetch until the
    // ceiling, since each newer change cancels the previous one.
    for (let i = 0; i < 8; i++) {
      clock.advance(50);
      delays.push(settle.delayForChange());
    }
    assert.deepEqual(delays, [150, 150, 150, 150, 150, 100, 50, 0]);
    settle.fetchStarted();
    clock.advance(50);
    assert.strictEqual(settle.delayForChange(), 150, 'the ceiling restarts');
  });

  test('a non-live search and an index render never wait', function (assert) {
    let clock = fakeClock();
    let rendering = true;
    let settle = settleWith(clock, { isIndexRender: () => rendering });
    for (let i = 0; i < 5; i++) {
      clock.advance(10);
      assert.strictEqual(settle.delayForChange(), 0, `index render ${i}`);
    }
    rendering = false;
    let live = settleWith(clock);
    for (let i = 0; i < 5; i++) {
      clock.advance(10);
      assert.strictEqual(
        live.delayForChange({ live: false }),
        0,
        `non-live ${i}`,
      );
    }
  });

  test('a burst of changes yields the first fetch and one trailing fetch with the final query', async function (assert) {
    let harness = new Harness(
      new SearchSettle({
        timing: () => ({ settleMs: 40, maxWaitMs: 10_000 }),
        isIndexRender: () => false,
      }),
    );
    let last: Promise<void> | undefined;
    for (let i = 1; i <= 10; i++) {
      last = harness.change(`q${i}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await last;
    assert.deepEqual(
      harness.fetches.map((f) => f.query),
      ['q1', 'q10'],
      'only the leading and the trailing query fetched',
    );
    assert.ok(harness.fetches[0]!.at < 20, 'the first fetch was immediate');
  });

  test('during an index render a burst fetches every change at once', async function (assert) {
    let harness = new Harness(
      new SearchSettle({
        timing: () => ({ settleMs: 1000, maxWaitMs: 1000 }),
        isIndexRender: () => true,
      }),
    );
    let started = performance.now();
    await harness.change('q1');
    await harness.change('q2');
    assert.deepEqual(
      harness.fetches.map((f) => f.query),
      ['q1', 'q2'],
    );
    assert.ok(performance.now() - started < 200, 'no settle wait');
  });
});
