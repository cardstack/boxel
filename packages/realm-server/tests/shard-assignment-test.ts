import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import shardTestModules from '../scripts/shard-test-modules.cjs';
import {
  createResolver,
  discoverTestFiles,
  testsDir,
} from '../scripts/test-module-names.mjs';

const {
  DEFAULT_WEIGHT,
  MIN_WEIGHT,
  assignByWeight,
  assignRoundRobin,
  loadTimings,
  slowestShardSeconds,
  weightFor,
} = shardTestModules;

// Every shard in a run computes the assignment for all shards from the same
// inputs and keeps its own bucket, so nothing checks at runtime that the
// buckets agree. `index % totalShards` was self-evidently a partition; a
// bin-pack recomputed independently on six machines is not, and the cost of
// it being wrong is a test file that runs twice or not at all.
const SHARD_COUNTS = [1, 2, 3, 4, 6, 7, 30];

function assignAll(
  files: string[],
  timings: Record<string, number>,
  shardCount: number,
) {
  return Array.from({ length: shardCount }, (_unused, i) =>
    assignByWeight(files, timings, i + 1, shardCount),
  );
}

// The static half of the module-title convention. The generator resolves suite
// names at runtime from a junit report; this reads the same names out of the
// sources so the convention can be checked without a CI run. Anything outside
// these shapes fails rather than being skipped — an unrecognised title is
// exactly the drift this test exists to catch.
function declaredModuleTitles(source: string, file: string): string[] {
  const base = basename(file);
  const calls = [
    ...source.matchAll(/^module\(\s*([\s\S]*?),\s*(?:async\s*)?function/gm),
  ];
  return calls.map(([, raw]) => {
    const expression = raw.trim();
    const plain =
      /^(?:path\.)?basename\((?:import\.meta\.filename|__filename)\)$/;
    if (plain.test(expression)) {
      return base;
    }
    const templated =
      /^`([^`$]*)\$\{(?:path\.)?basename\((?:import\.meta\.filename|__filename)\)\}([^`$]*)`$/;
    const parts = templated.exec(expression);
    if (parts) {
      return `${parts[1]}${base}${parts[2]}`;
    }
    const literal = /^'([^']*)'$/.exec(expression);
    if (literal) {
      return literal[1];
    }
    throw new Error(
      `${file}: could not read the top-level module title from ${JSON.stringify(
        expression,
      )}. Name it after the file — basename(import.meta.filename), or ` +
        '`dir/${basename(import.meta.filename)}` when nested — so the weights ' +
        'generator can attribute the file’s runtime to it.',
    );
  });
}

module(basename(import.meta.filename), function () {
  // The invariant both scripts/junit-reporter.cjs and
  // scripts/generate-test-module-timings.mjs assert in prose, and the one that
  // makes a junit suite name resolvable to a file at all. It drifts on its own:
  // four files had free-form titles when weighting was introduced, and the only
  // signal was a console.warn in a manual run.
  test('every top-level module is named after the file it is declared in', function (assert) {
    const files = discoverTestFiles();
    const resolveFile = createResolver(files);
    assert.true(files.length > 0, 'found test files to check');

    for (const file of files) {
      const source = readFileSync(join(testsDir, file), 'utf8');
      const titles = declaredModuleTitles(source, file);
      assert.true(
        titles.length > 0,
        `${file}: declares no top-level module — its tests would report under a name no file can claim`,
      );
      for (const title of titles) {
        assert.strictEqual(
          resolveFile(title),
          file,
          `${file}: the module title ${JSON.stringify(title)} resolves to ${JSON.stringify(
            resolveFile(title),
          )}`,
        );
      }
    }
  });

  test('the shards partition the test files', function (assert) {
    const files = discoverTestFiles();
    const timings = loadTimings();
    assert.notStrictEqual(timings, null, 'the committed weights are readable');

    for (const shardCount of SHARD_COUNTS) {
      const assigned = assignAll(files, timings, shardCount).flat();
      assert.strictEqual(
        assigned.length,
        new Set(assigned).size,
        `shardCount=${shardCount}: a file was assigned to more than one shard`,
      );
      assert.deepEqual(
        [...assigned].sort(),
        [...files].sort(),
        `shardCount=${shardCount}: the shards do not cover every file`,
      );
    }
  });

  test('round-robin, the bootstrap split, partitions them too', function (assert) {
    const files = discoverTestFiles();
    for (const shardCount of SHARD_COUNTS) {
      const assigned = Array.from({ length: shardCount }, (_unused, i) =>
        assignRoundRobin(files, i + 1, shardCount),
      ).flat();
      assert.deepEqual(
        [...assigned].sort(),
        [...files].sort(),
        `shardCount=${shardCount}: the round-robin split lost or duplicated a file`,
      );
    }
  });

  test('the assignment is reproducible from the same inputs', function (assert) {
    const files = discoverTestFiles();
    const timings = loadTimings();
    for (const shardCount of [6, 7]) {
      assert.deepEqual(
        assignAll(files, timings, shardCount),
        assignAll([...files].reverse(), timings, shardCount),
        `shardCount=${shardCount}: the packing depends on the order files were discovered in`,
      );
    }
  });

  test('the heaviest files land on different shards', function (assert) {
    const shards = Array.from({ length: 2 }, (_unused, i) =>
      assignByWeight(
        ['a-test.ts', 'b-test.ts', 'c-test.ts', 'd-test.ts'],
        {
          'a-test.ts': 100,
          'b-test.ts': 90,
          'c-test.ts': 10,
          'd-test.ts': 5,
        },
        i + 1,
        2,
      ),
    );
    assert.notStrictEqual(
      shards.findIndex((s) => s.includes('a-test.ts')),
      shards.findIndex((s) => s.includes('b-test.ts')),
      'the two heaviest files were packed onto the same shard',
    );
  });

  // The drift gate in scripts/generate-test-module-timings.mjs decides whether
  // fresh measurements are worth a commit by asking what the committed packing
  // costs at the fresh weights. Packing and costing use different weights, and
  // the test pins which is which: cost both with the stale weights and every
  // regeneration looks pointless.
  test('the drift prediction costs a stale packing at the fresh weights', function (assert) {
    const files = ['a-test.ts', 'b-test.ts', 'c-test.ts', 'd-test.ts'];
    const stale = {
      'a-test.ts': 10,
      'b-test.ts': 10,
      'c-test.ts': 10,
      'd-test.ts': 10,
    };
    // a has grown tenfold since the weights were written.
    const fresh = { ...stale, 'a-test.ts': 100 };

    assert.strictEqual(
      slowestShardSeconds(files, stale, fresh, 2),
      110,
      'packed as four equal files, a shares a shard with one other and now costs 110',
    );
    assert.strictEqual(
      slowestShardSeconds(files, fresh, fresh, 2),
      100,
      'packed by the fresh weights, a sits alone',
    );
    assert.strictEqual(
      slowestShardSeconds(files, stale, fresh, 1),
      130,
      'one shard costs the whole suite',
    );
    assert.strictEqual(
      slowestShardSeconds(['new-test.ts'], {}, {}, 1),
      DEFAULT_WEIGHT,
      'an unmeasured file is costed as the splitter packs it',
    );
  });

  // A measured 0 means "under the resolution of the clock that recorded it",
  // not "free", and an absent measurement means "unknown". Charging both
  // DEFAULT_WEIGHT put 270s of load that does not exist onto today's pack.
  test('a measured zero is floored, and only an unmeasured file takes the default', function (assert) {
    assert.strictEqual(
      weightFor('measured-test.ts', { 'measured-test.ts': 0 }),
      MIN_WEIGHT,
    );
    assert.strictEqual(
      weightFor('measured-test.ts', { 'measured-test.ts': 0.2 }),
      MIN_WEIGHT,
    );
    assert.strictEqual(
      weightFor('measured-test.ts', { 'measured-test.ts': 42 }),
      42,
    );
    assert.strictEqual(weightFor('new-test.ts', {}), DEFAULT_WEIGHT);
    assert.strictEqual(
      weightFor('bad-test.ts', { 'bad-test.ts': 'quick' }),
      DEFAULT_WEIGHT,
      'a non-numeric weight is no measurement at all',
    );
  });

  // The weights file is committed and generated, which is exactly the shape of
  // thing a merge resolves badly. Falling back to round-robin over a corrupted
  // one would put CI back to a 5x spread behind a green tick.
  test('an absent weights file bootstraps, an unparseable one fails', function (assert) {
    const dir = mkdtempSync(join(tmpdir(), 'shard-weights-'));
    assert.strictEqual(loadTimings(dir), null, 'absent means bootstrap');

    writeFileSync(join(dir, 'test-module-timings.json'), '{"a-test.ts": 1.5}');
    assert.deepEqual(loadTimings(dir), { 'a-test.ts': 1.5 });

    writeFileSync(join(dir, 'test-module-timings.json'), '{"a-test.ts": 1.5');
    assert.throws(
      () => loadTimings(dir),
      /JSON/,
      'a truncated weights file throws instead of reverting to round-robin',
    );

    writeFileSync(join(dir, 'test-module-timings.json'), '[]');
    assert.throws(
      () => loadTimings(dir),
      /does not contain a JSON object/,
      'a parseable non-object throws too',
    );
  });
});
