import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { judgeLiveness } from '../liveness/liveness-verdict.ts';

const WEDGE_MS = 30_000;
const NOW = 1_800_000_000_000;

module(basename(import.meta.filename), function () {
  test('a loop that beat just now is alive', function (assert) {
    let verdict = judgeLiveness({
      nowMs: NOW,
      beatMs: NOW - 120,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, 120);
    assert.strictEqual(verdict.wedgeMs, WEDGE_MS);
  });

  test('a loop turning late but still turning is alive', function (assert) {
    // The case the whole signal exists to protect: seconds of event-loop lag
    // under load. Restarting here throws away a warm cache and lands the
    // replacement in the same load.
    let verdict = judgeLiveness({
      nowMs: NOW,
      beatMs: NOW - 4_000,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, 4_000);
  });

  test('a loop that stopped turning is not alive', function (assert) {
    let verdict = judgeLiveness({
      nowMs: NOW,
      beatMs: NOW - (WEDGE_MS + 1),
      wedgeMs: WEDGE_MS,
    });
    assert.false(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, WEDGE_MS + 1);
  });

  test('an age exactly at the threshold is still alive', function (assert) {
    let verdict = judgeLiveness({
      nowMs: NOW,
      beatMs: NOW - WEDGE_MS,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
  });

  test('a buffer nobody has beaten into is not alive', function (assert) {
    let verdict = judgeLiveness({ nowMs: NOW, beatMs: 0, wedgeMs: WEDGE_MS });
    assert.false(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, NOW);
  });

  test('a backwards clock step reads as a zero-age beat, not a negative one', function (assert) {
    // A negative age would compare as under any threshold and pass for the
    // wrong reason; clamping keeps the reported value a duration.
    let verdict = judgeLiveness({
      nowMs: NOW,
      beatMs: NOW + 5_000,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, 0);
  });
});
