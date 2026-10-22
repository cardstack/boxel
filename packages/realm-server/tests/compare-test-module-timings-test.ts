import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { compareTimings } from '../scripts/compare-test-module-timings.mjs';

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
});
