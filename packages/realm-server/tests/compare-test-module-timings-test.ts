import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  compareTimings,
  slowestShard,
} from '../scripts/compare-test-module-timings.mjs';

module(basename(import.meta.filename), function () {
  test('totals and file counts cover each end on its own', function (assert) {
    let result = compareTimings(
      { 'a-test.ts': 10, 'b-test.ts': 20.25 },
      { 'a-test.ts': 12, 'c-test.ts': 30 },
    );
    assert.deepEqual(result.before, { total: 30.3, files: 2 });
    assert.deepEqual(result.after, { total: 42, files: 2 });
    assert.strictEqual(result.added, 1);
  });

  test('a new file counts as grown by its whole time, ahead of smaller growth', function (assert) {
    let result = compareTimings(
      { 'a-test.ts': 10, 'b-test.ts': 5 },
      { 'a-test.ts': 14, 'b-test.ts': 5, 'c-test.ts': 30 },
      { 'a-test.ts': 4, 'c-test.ts': 3 },
    );
    assert.deepEqual(
      result.grown.map((r) => [r.file, r.status, r.delta, r.secondsPerTest]),
      [
        ['c-test.ts', 'new', 30, 10],
        ['a-test.ts', 'kept', 4, 3.5],
      ],
      'an unchanged file is neither grown nor shrunk',
    );
    assert.deepEqual(result.shrunk, []);
  });

  test('shrunk and removed files list the largest drop first', function (assert) {
    let result = compareTimings(
      { 'a-test.ts': 10, 'b-test.ts': 50, 'c-test.ts': 3, 'd-test.ts': 8 },
      { 'a-test.ts': 9, 'b-test.ts': 20 },
    );
    assert.deepEqual(
      result.shrunk.map((r) => [r.file, r.delta]),
      [
        ['b-test.ts', -30],
        ['a-test.ts', -1],
      ],
    );
    assert.deepEqual(
      result.removed.map((r) => [r.file, r.delta]),
      [
        ['d-test.ts', -8],
        ['c-test.ts', -3],
      ],
    );
  });

  test('a file with no counted tests has no per-test cost', function (assert) {
    let [row] = compareTimings(
      {},
      { 'a-test.ts': 12 },
      { 'a-test.ts': 0 },
    ).grown;
    assert.strictEqual(row.tests, 0);
    assert.strictEqual(row.secondsPerTest, undefined);
  });

  test('a new file measured at 0s is still listed', function (assert) {
    let result = compareTimings(
      { 'a-test.ts': 10 },
      { 'a-test.ts': 10, 'b-test.ts': 0 },
    );
    assert.deepEqual(
      result.grown.map((r) => [r.file, r.status]),
      [['b-test.ts', 'new']],
    );
  });

  test('test files on disk with no timing are listed as unmeasured', function (assert) {
    let result = compareTimings({}, { 'a-test.ts': 10 }, {}, [
      'nested/c-test.ts',
      'a-test.ts',
      'b-test.ts',
    ]);
    assert.deepEqual(result.unmeasured, ['b-test.ts', 'nested/c-test.ts']);
  });

  test('the slowest shard is the heaviest packed bin, not the mean', function (assert) {
    // Packed into 2 shards: [a] = 60s and [b, c] = 10s + 5s (c is unmeasured
    // and charged DEFAULT_WEIGHT). The mean would be 37.5s.
    assert.strictEqual(
      slowestShard(
        ['a-test.ts', 'b-test.ts', 'c-test.ts'],
        {
          'a-test.ts': 60,
          'b-test.ts': 10,
        },
        2,
      ),
      60,
    );
    // A measured 0 still costs MIN_WEIGHT, so three of them on one shard
    // weigh 3s.
    assert.strictEqual(
      slowestShard(
        ['a-test.ts', 'b-test.ts', 'c-test.ts'],
        {
          'a-test.ts': 0,
          'b-test.ts': 0,
          'c-test.ts': 0,
        },
        1,
      ),
      3,
    );
  });
});
