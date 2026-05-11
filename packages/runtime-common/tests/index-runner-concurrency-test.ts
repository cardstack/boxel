import type { SharedTests } from '../helpers';
import {
  computeIndexVisitConcurrency,
  runWithBoundedConcurrency,
} from '../index-runner';

const ORIGINAL_TAB_MAX = process.env.PRERENDER_AFFINITY_TAB_MAX;
const ORIGINAL_HARD_CAP = process.env.INDEX_RUNNER_MAX_CONCURRENCY;

function setEnv(
  key: 'PRERENDER_AFFINITY_TAB_MAX' | 'INDEX_RUNNER_MAX_CONCURRENCY',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function restoreEnv(): void {
  setEnv('PRERENDER_AFFINITY_TAB_MAX', ORIGINAL_TAB_MAX);
  setEnv('INDEX_RUNNER_MAX_CONCURRENCY', ORIGINAL_HARD_CAP);
}

const tests = Object.freeze({
  'computeIndexVisitConcurrency: tiny batches stay serial': async (assert) => {
    try {
      setEnv('PRERENDER_AFFINITY_TAB_MAX', '5');
      setEnv('INDEX_RUNNER_MAX_CONCURRENCY', '4');
      // Below the size threshold the cold-tab tax exceeds parallelism
      // payoff, so the formula falls back to serial regardless of how
      // wide the dep graph happens to be.
      assert.strictEqual(computeIndexVisitConcurrency(0, 0), 1);
      assert.strictEqual(computeIndexVisitConcurrency(1, 1), 1);
      assert.strictEqual(computeIndexVisitConcurrency(9, 9), 1);
    } finally {
      restoreEnv();
    }
  },

  'computeIndexVisitConcurrency: linear chains stay serial': async (assert) => {
    try {
      setEnv('PRERENDER_AFFINITY_TAB_MAX', '5');
      setEnv('INDEX_RUNNER_MAX_CONCURRENCY', '4');
      // A 100-file batch with max-layer-width 1 (or 2) is a near-
      // linear topo chain; spawning extra workers just wastes them on
      // the head of the chain.
      assert.strictEqual(computeIndexVisitConcurrency(100, 1), 1);
      assert.strictEqual(computeIndexVisitConcurrency(100, 2), 1);
    } finally {
      restoreEnv();
    }
  },

  'computeIndexVisitConcurrency: wide batches respect the layer width': async (
    assert,
  ) => {
    try {
      setEnv('PRERENDER_AFFINITY_TAB_MAX', '5');
      setEnv('INDEX_RUNNER_MAX_CONCURRENCY', '8');
      // With envelope=4 (tabMax 5 - 1) and hardCap=8, a layer width
      // of 3 caps concurrency to 3 — there is no useful work for a
      // 4th in-flight visit.
      assert.strictEqual(computeIndexVisitConcurrency(100, 3), 3);
    } finally {
      restoreEnv();
    }
  },

  'computeIndexVisitConcurrency: hard cap wins over generous envelopes': async (
    assert,
  ) => {
    try {
      setEnv('PRERENDER_AFFINITY_TAB_MAX', '10');
      setEnv('INDEX_RUNNER_MAX_CONCURRENCY', '3');
      // Layer width and the affinity envelope both permit higher
      // concurrency, but the explicit cap throttles to 3 — the knob
      // an operator would reach for to protect prerender capacity
      // shared across the fleet.
      assert.strictEqual(computeIndexVisitConcurrency(100, 20), 3);
    } finally {
      restoreEnv();
    }
  },

  'computeIndexVisitConcurrency: envelope wins when it is the tightest cap':
    async (assert) => {
      try {
        setEnv('PRERENDER_AFFINITY_TAB_MAX', '3');
        setEnv('INDEX_RUNNER_MAX_CONCURRENCY', '10');
        // Envelope = tabMax - 1 = 2 (one tab reserved for module
        // sub-prerenders). Even with a hard cap of 10 and a wide
        // layer, the envelope is the binding constraint.
        assert.strictEqual(computeIndexVisitConcurrency(100, 20), 2);
      } finally {
        restoreEnv();
      }
    },

  'computeIndexVisitConcurrency: malformed env vars fall back to defaults':
    async (assert) => {
      try {
        setEnv('PRERENDER_AFFINITY_TAB_MAX', 'oops');
        setEnv('INDEX_RUNNER_MAX_CONCURRENCY', 'oops');
        // Fallback envelope = 5 - 1 = 4. Default hard cap = 4. With a
        // wide layer (20), concurrency is min(4, 20, 4) = 4.
        assert.strictEqual(computeIndexVisitConcurrency(100, 20), 4);
      } finally {
        restoreEnv();
      }
    },

  'runWithBoundedConcurrency: empty input': async (assert) => {
    let results = await runWithBoundedConcurrency([], 4, async () => 1);
    assert.deepEqual(results, []);
  },

  'runWithBoundedConcurrency: collects fulfilled and rejected results in order':
    async (assert) => {
      let results = await runWithBoundedConcurrency(
        [1, 2, 3, 4, 5],
        2,
        async (item) => {
          if (item === 3) {
            throw new Error(`boom-${item}`);
          }
          return item * 10;
        },
      );
      assert.strictEqual(results.length, 5);
      assert.strictEqual(results[0]!.status, 'fulfilled');
      assert.strictEqual(
        (results[0] as PromiseFulfilledResult<number>).value,
        10,
      );
      assert.strictEqual(results[1]!.status, 'fulfilled');
      assert.strictEqual(
        (results[1] as PromiseFulfilledResult<number>).value,
        20,
      );
      assert.strictEqual(results[2]!.status, 'rejected');
      assert.strictEqual(
        ((results[2] as PromiseRejectedResult).reason as Error).message,
        'boom-3',
      );
      assert.strictEqual(results[3]!.status, 'fulfilled');
      assert.strictEqual(
        (results[3] as PromiseFulfilledResult<number>).value,
        40,
      );
      assert.strictEqual(results[4]!.status, 'fulfilled');
      assert.strictEqual(
        (results[4] as PromiseFulfilledResult<number>).value,
        50,
      );
    },

  'runWithBoundedConcurrency: never exceeds the concurrency cap': async (
    assert,
  ) => {
    let inFlight = 0;
    let peakInFlight = 0;
    let items = Array.from({ length: 20 }, (_, i) => i);
    await runWithBoundedConcurrency(items, 3, async () => {
      inFlight++;
      if (inFlight > peakInFlight) {
        peakInFlight = inFlight;
      }
      // Yield a few times to give the scheduler real opportunities to
      // overshoot if the queue logic is wrong.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
    });
    assert.ok(
      peakInFlight <= 3,
      `expected peak in-flight ≤ 3, got ${peakInFlight}`,
    );
    assert.ok(
      peakInFlight >= 2,
      `expected peak in-flight ≥ 2 to confirm real parallelism, got ${peakInFlight}`,
    );
  },

  'runWithBoundedConcurrency: concurrency=1 is sequential': async (assert) => {
    let inFlight = 0;
    let peakInFlight = 0;
    let items = Array.from({ length: 8 }, (_, i) => i);
    await runWithBoundedConcurrency(items, 1, async () => {
      inFlight++;
      if (inFlight > peakInFlight) {
        peakInFlight = inFlight;
      }
      await Promise.resolve();
      inFlight--;
    });
    assert.strictEqual(peakInFlight, 1);
  },

  'runWithBoundedConcurrency: continues past rejections, finishes every item':
    async (assert) => {
      let visited = new Set<number>();
      let items = Array.from({ length: 10 }, (_, i) => i);
      let results = await runWithBoundedConcurrency(items, 3, async (item) => {
        visited.add(item);
        if (item % 3 === 0) {
          throw new Error(`fail-${item}`);
        }
        return item;
      });
      assert.deepEqual(
        [...visited].sort((a, b) => a - b),
        items,
        'every input was visited even though several rejected',
      );
      let rejectedCount = results.filter((r) => r.status === 'rejected').length;
      assert.strictEqual(rejectedCount, 4); // 0, 3, 6, 9
    },
} as SharedTests<unknown>);

export default tests;
