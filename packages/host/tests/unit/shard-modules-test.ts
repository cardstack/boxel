import { module, test } from 'qunit';

import { selectShardModules } from '../helpers/shard-modules';

module('Unit | shard-modules', function () {
  test('shards partition the module list exactly', function (assert) {
    let moduleIds = Array.from({ length: 23 }, (_, i) => `./m${i}-test.ts`);
    let timings = Object.fromEntries(moduleIds.map((id, i) => [id, i + 1]));

    let shardCount = 4;
    let seen: string[] = [];
    for (let shard = 1; shard <= shardCount; shard++) {
      seen.push(...selectShardModules(moduleIds, shard, shardCount, timings));
    }

    assert.strictEqual(seen.length, moduleIds.length, 'no module is repeated');
    assert.deepEqual(
      seen.sort(),
      [...moduleIds].sort(),
      'every module is assigned to a shard',
    );
  });

  test('assignment is deterministic regardless of input order', function (assert) {
    let moduleIds = [
      './a-test.ts',
      './b-test.ts',
      './c-test.ts',
      './d-test.ts',
    ];
    let timings = { './a-test.ts': 10, './b-test.ts': 1, './c-test.ts': 5 };

    let forward = selectShardModules(moduleIds, 1, 2, timings);
    let reversed = selectShardModules([...moduleIds].reverse(), 1, 2, timings);

    assert.deepEqual(forward, reversed);
  });

  test('heavy modules are spread across shards', function (assert) {
    let timings: Record<string, number> = {
      './heavy1-test.ts': 100,
      './heavy2-test.ts': 100,
      './light1-test.ts': 1,
      './light2-test.ts': 1,
    };
    let moduleIds = Object.keys(timings);

    let shard1 = selectShardModules(moduleIds, 1, 2, timings);
    let shard2 = selectShardModules(moduleIds, 2, 2, timings);

    assert.strictEqual(
      shard1.filter((id) => id.startsWith('./heavy')).length,
      1,
      'each shard gets one heavy module',
    );
    assert.strictEqual(
      shard2.filter((id) => id.startsWith('./heavy')).length,
      1,
      'each shard gets one heavy module',
    );
  });

  test('modules without timing data still run on exactly one shard', function (assert) {
    let moduleIds = ['./known-test.ts', './unknown-test.ts'];
    let timings = { './known-test.ts': 5 };

    let assignments = [1, 2].map((shard) =>
      selectShardModules(moduleIds, shard, 2, timings),
    );

    let unknownShards = assignments.filter((ids) =>
      ids.includes('./unknown-test.ts'),
    );
    assert.strictEqual(unknownShards.length, 1);
  });

  test('rejects out-of-range shard coordinates', function (assert) {
    assert.throws(() => selectShardModules([], 0, 2, {}));
    assert.throws(() => selectShardModules([], 3, 2, {}));
    assert.throws(() => selectShardModules([], 1.5, 2, {}));
  });
});
