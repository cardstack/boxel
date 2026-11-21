import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import shardTestModules from '../scripts/shard-test-modules.cjs';
import testSuites from '../scripts/test-suites.cjs';

const { collectTestModules, modulesForShard, testsDir } = shardTestModules;
const { SUITES, loadManifest, manifestProblems, modulesInSuite, suiteOf } =
  testSuites;

function manifestFile(contents: unknown): string {
  let dir = mkdtempSync(join(tmpdir(), 'test-suites-'));
  let file = join(dir, 'test-suites.json');
  writeFileSync(file, JSON.stringify(contents));
  return file;
}

module(basename(import.meta.filename), function () {
  let allModules = collectTestModules(testsDir, '').sort();

  test('the committed manifest names only test modules, each in one suite', function (assert) {
    assert.deepEqual(manifestProblems(allModules), []);
  });

  test('the suites partition the test modules', function (assert) {
    let bySuite = SUITES.map((suite: string) =>
      modulesInSuite(suite, allModules),
    );
    let union = bySuite.flat().sort();
    assert.deepEqual(union, allModules, 'every module is in some suite');
    assert.strictEqual(
      new Set(union).size,
      union.length,
      'no module is in two suites',
    );
  });

  test('a module named in no list is a platform module', function (assert) {
    let manifest = { engine: ['a-test.ts'], nightly: ['b-test.ts'] };
    assert.strictEqual(suiteOf('a-test.ts', manifest), 'engine');
    assert.strictEqual(suiteOf('b-test.ts', manifest), 'nightly');
    assert.strictEqual(suiteOf('c-test.ts', manifest), 'platform');
    assert.deepEqual(
      modulesInSuite(
        'platform',
        ['a-test.ts', 'b-test.ts', 'c-test.ts'],
        manifest,
      ),
      ['c-test.ts'],
    );
  });

  test('a stale or doubled name is reported', function (assert) {
    let manifest = {
      engine: ['a-test.ts', 'gone-test.ts'],
      nightly: ['a-test.ts'],
    };
    assert.deepEqual(manifestProblems(['a-test.ts'], manifest), [
      'engine lists gone-test.ts, which is not a test module',
      'a-test.ts is listed in both engine and nightly',
    ]);
  });

  test('an unknown suite in the manifest is refused', function (assert) {
    assert.throws(
      () => loadManifest(manifestFile({ engine: [], smoke: [] })),
      /unknown suite "smoke"/,
    );
    assert.throws(
      () => loadManifest(manifestFile({ platform: ['a-test.ts'] })),
      /unknown suite "platform"/,
      'platform is the default and is never listed',
    );
  });

  test('the pull-request shards cover exactly the platform suite', function (assert) {
    let platform = modulesInSuite('platform', allModules);
    let sharded = [1, 2, 3, 4, 5, 6]
      .flatMap((shard) => modulesForShard(shard, 6))
      .sort();
    assert.deepEqual(sharded, platform);
  });
});
