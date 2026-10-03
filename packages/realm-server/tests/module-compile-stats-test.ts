import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  recordModuleCompile,
  takeModuleCompileStats,
} from '@cardstack/runtime-common';

module(basename(import.meta.filename), function (hooks) {
  hooks.beforeEach(function () {
    // Start each test from a clean window, whatever ran before it.
    takeModuleCompileStats();
  });

  test('reports the compiles since the last take, then starts again from zero', function (assert) {
    recordModuleCompile(120);
    recordModuleCompile(4500);
    recordModuleCompile(30);

    assert.deepEqual(takeModuleCompileStats(), {
      count: 3,
      totalMs: 4650,
      maxMs: 4500,
    });
    assert.deepEqual(
      takeModuleCompileStats(),
      { count: 0, totalMs: 0, maxMs: 0 },
      'a second take reports an empty window',
    );
  });

  test('ignores durations that are not real measurements', function (assert) {
    recordModuleCompile(Number.NaN);
    recordModuleCompile(-5);
    recordModuleCompile(Number.POSITIVE_INFINITY);

    assert.deepEqual(takeModuleCompileStats(), {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    });
  });
});
