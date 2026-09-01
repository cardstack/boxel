import { strict as assert } from 'assert';
import { test } from 'node:test';
import { join } from 'path';
import {
  assignSpecFiles,
  discoverSpecFiles,
  loadSpecTimings,
  parseShardCoordinates,
  specFileMatchers,
} from './shard-spec-files.ts';

const testDir = join(import.meta.dirname, '..', 'tests');
const timingsPath = join(testDir, 'spec-timings.json');

function assignAll(
  specFiles: string[],
  shardCount: number,
  timings: Record<string, number>,
) {
  return Array.from({ length: shardCount }, (_unused, i) =>
    assignSpecFiles(specFiles, i + 1, shardCount, timings),
  );
}

test('the shards partition the spec files', () => {
  let specFiles = discoverSpecFiles(testDir);
  let timings = loadSpecTimings(timingsPath);
  for (let shardCount of [1, 2, 3, 4, 7, 30]) {
    let shards = assignAll(specFiles, shardCount, timings);
    let assigned = shards.flat();
    assert.equal(
      assigned.length,
      new Set(assigned).size,
      `shardCount=${shardCount}: a spec file was assigned to more than one shard`,
    );
    assert.deepEqual(
      assigned.sort(),
      [...specFiles].sort(),
      `shardCount=${shardCount}: the shards do not cover every spec file`,
    );
  }
});

test('spec files with no recorded timing are still assigned', () => {
  let specFiles = ['known.spec.ts', 'brand-new.spec.ts'];
  let shards = assignAll(specFiles, 2, { 'known.spec.ts': 30 });
  assert.deepEqual(shards.flat().sort(), [...specFiles].sort());
});

test('the heaviest spec files land on different shards', () => {
  let shards = assignAll(
    ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts'],
    2,
    {
      'a.spec.ts': 100,
      'b.spec.ts': 90,
      'c.spec.ts': 10,
      'd.spec.ts': 5,
    },
  );
  assert.deepEqual(shards, [
    ['a.spec.ts', 'd.spec.ts'],
    ['b.spec.ts', 'c.spec.ts'],
  ]);
});

test('zero-weight spec files are spread rather than collected', () => {
  let specFiles = ['w.spec.ts', 'x.spec.ts', 'y.spec.ts', 'z.spec.ts'];
  let shards = assignAll(specFiles, 2, {
    'w.spec.ts': 0,
    'x.spec.ts': 0,
    'y.spec.ts': 0,
    'z.spec.ts': 0,
  });
  assert.deepEqual(
    shards.map((files) => files.length),
    [2, 2],
  );
});

test('assignment is independent of the order files are discovered in', () => {
  let specFiles = discoverSpecFiles(testDir);
  let timings = loadSpecTimings(timingsPath);
  assert.deepEqual(
    assignAll([...specFiles].reverse(), 3, timings),
    assignAll(specFiles, 3, timings),
  );
});

test('a matcher selects its own spec file and no other', () => {
  let [matcher] = specFileMatchers(testDir, ['login.spec.ts']);
  assert.ok(matcher.test(join(testDir, 'login.spec.ts')));
  assert.ok(!matcher.test(join(testDir, 'login-using-email.spec.ts')));
  assert.ok(!matcher.test(join(testDir, 'nested', 'login.spec.ts')));
});

test('the timings file names only spec files that exist', () => {
  let specFiles = new Set(discoverSpecFiles(testDir));
  let stale = Object.keys(loadSpecTimings(timingsPath)).filter(
    (file) => !specFiles.has(file),
  );
  assert.deepEqual(stale, []);
});

test('shard coordinates are parsed, and nonsense is rejected', () => {
  assert.equal(parseShardCoordinates(undefined), undefined);
  assert.equal(parseShardCoordinates(''), undefined);
  assert.deepEqual(parseShardCoordinates('2/3'), { index: 2, total: 3 });
  assert.throws(() => parseShardCoordinates('4/3'));
  assert.throws(() => parseShardCoordinates('0/3'));
  assert.throws(() => parseShardCoordinates('two of three'));
});
