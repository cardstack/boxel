import { module, test } from 'qunit';

// Kept at this path rather than renamed to follow `render-diagnostics.ts`:
// CI packs test files into shards by their recorded duration, and a path
// absent from `test-module-timings.json` is weighted at the median instead
// of its measured cost — so renaming a file silently repacks every shard.
// A cosmetic rename is not worth redistributing the suite.

import {
  DIAGNOSTIC_TIMING_FLOOR_MS,
  DIAGNOSTIC_TIMING_MAX_ENTRIES,
  newHistoryEntries,
  newLoadEntries,
  pruneTimingEntries,
  pruneTimingPaths,
} from '@cardstack/host/utils/render-diagnostics';

// The store's completed-load histories and the Loader's module-evaluation
// history are bounded top-N lists that persist across renders on a warm tab;
// `newLoadEntries` extracts just the entries one render produced by
// multiset-diffing snapshots taken around it.
module('Unit | render diagnostics | newLoadEntries', function () {
  const A = { url: 'https://realm.example/a', ms: 12 };
  const B = { url: 'https://realm.example/b', ms: 340 };
  const C = { url: 'https://realm.example/c', ms: 5 };

  test('returns entries present only in the after snapshot', function (assert) {
    assert.deepEqual(newLoadEntries([A], [A, B]), [B]);
  });

  test('returns everything when the before snapshot is empty', function (assert) {
    assert.deepEqual(newLoadEntries([], [A, B]), [A, B]);
  });

  test('multiset semantics: a repeated (url, ms) pair only reports the excess occurrences', function (assert) {
    assert.deepEqual(newLoadEntries([A, A], [A, A, A, B]), [A, B]);
  });

  test('an entry evicted from the bounded history produces nothing', function (assert) {
    assert.deepEqual(newLoadEntries([A, C], [A, B]), [B]);
  });

  test('same url with a different ms is a distinct load', function (assert) {
    let rerun = { url: A.url, ms: 99 };
    assert.deepEqual(newLoadEntries([A], [A, rerun]), [rerun]);
  });
});

module('Unit | render diagnostics | newHistoryEntries', function () {
  // The store's query-load history carries a meta object rather than a URL,
  // so it diffs on a caller-supplied key. The key must fold in the duration
  // for the same reason `newLoadEntries` does: two resolutions of the same
  // query field are two entries.
  const keyOf = ({ source, ms }: { source: string; ms: number }) =>
    `${source}|${ms}`;

  test('diffs on the supplied key', function (assert) {
    let first = { source: 'query-field', ms: 10 };
    let second = { source: 'search', ms: 4 };
    assert.deepEqual(newHistoryEntries([first], [first, second], keyOf), [
      second,
    ]);
  });

  test('two entries sharing a key are distinguished by multiplicity', function (assert) {
    let load = { source: 'query-field', ms: 10 };
    assert.deepEqual(newHistoryEntries([load], [load, load], keyOf), [load]);
  });
});

module('Unit | render diagnostics | pruning', function () {
  test('pruneTimingPaths drops entries under the floor and rounds what it keeps', function (assert) {
    assert.deepEqual(
      pruneTimingPaths({ hot: 12.3456, cold: DIAGNOSTIC_TIMING_FLOOR_MS / 2 }),
      { hot: 12.35 },
      'sub-floor path dropped, kept path rounded to 2dp',
    );
  });

  test('pruneTimingPaths returns undefined when nothing clears the floor', function (assert) {
    // The common case: a cheap card records no breakdown at all rather than
    // a blob of near-zero entries.
    assert.strictEqual(pruneTimingPaths({ a: 0, b: 0.4 }), undefined);
  });

  test('pruneTimingPaths keeps only the slowest N', function (assert) {
    let paths: Record<string, number> = {};
    for (let i = 0; i < DIAGNOSTIC_TIMING_MAX_ENTRIES + 5; i++) {
      paths[`field${i}`] = i + DIAGNOSTIC_TIMING_FLOOR_MS;
    }
    let kept = pruneTimingPaths(paths)!;
    assert.strictEqual(
      Object.keys(kept).length,
      DIAGNOSTIC_TIMING_MAX_ENTRIES,
      'capped at the max entry count',
    );
    // The five cheapest are the ones dropped, so the slowest N kept start at
    // the 6th-cheapest value — the cap ranks, it doesn't take an arbitrary
    // slice.
    assert.strictEqual(
      Math.min(...Object.values(kept)),
      5 + DIAGNOSTIC_TIMING_FLOOR_MS,
      'the entries kept are the slowest N',
    );
  });

  test('pruneTimingEntries sorts slowest-first, rounds, and preserves sibling keys', function (assert) {
    assert.deepEqual(
      pruneTimingEntries([
        { kind: 'card', target: 'slow', ms: 4.005 },
        { kind: 'query', target: 'fast', ms: 2 },
        { kind: 'card', target: 'resident', ms: 0.01 },
      ]),
      [
        { kind: 'card', target: 'slow', ms: 4.01 },
        { kind: 'query', target: 'fast', ms: 2 },
      ],
    );
  });

  test('pruneTimingEntries returns undefined when every entry is under the floor', function (assert) {
    assert.strictEqual(
      pruneTimingEntries([{ url: 'https://realm.example/a.gts', ms: 0.2 }]),
      undefined,
    );
  });
});
