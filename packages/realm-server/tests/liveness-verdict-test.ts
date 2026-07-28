import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { judgeLiveness } from '../liveness/liveness-verdict.ts';

const WEDGE_MS = 30_000;
// An arbitrary monotonic reading to measure ages back from. Large enough that
// the "never written" case (beat 0) is unambiguous.
const NOW_NS = 4_000_000_000_000n;
const MS = 1_000_000n;

module(basename(import.meta.filename), function () {
  test('a loop that beat just now is alive', function (assert) {
    let verdict = judgeLiveness({
      nowNs: NOW_NS,
      beatNs: NOW_NS - 120n * MS,
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
      nowNs: NOW_NS,
      beatNs: NOW_NS - 4_000n * MS,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, 4_000);
  });

  test('a loop that stopped turning is not alive', function (assert) {
    let verdict = judgeLiveness({
      nowNs: NOW_NS,
      beatNs: NOW_NS - (BigInt(WEDGE_MS) + 1n) * MS,
      wedgeMs: WEDGE_MS,
    });
    assert.false(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, WEDGE_MS + 1);
  });

  test('an age exactly at the threshold is still alive', function (assert) {
    let verdict = judgeLiveness({
      nowNs: NOW_NS,
      beatNs: NOW_NS - BigInt(WEDGE_MS) * MS,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, WEDGE_MS);
  });

  test('a buffer nobody has beaten into is not alive', function (assert) {
    let verdict = judgeLiveness({
      nowNs: NOW_NS,
      beatNs: 0n,
      wedgeMs: WEDGE_MS,
    });
    assert.false(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, Number(NOW_NS / MS));
  });

  test('the age is elapsed time, immune to a wall-clock step', function (assert) {
    // The readings are monotonic nanoseconds off one process-wide base, so
    // nothing an NTP or hypervisor adjustment does to the wall clock can age a
    // beat that was just written — which, once a container health check reads
    // this, would otherwise replace a perfectly healthy task.
    let realNow = process.hrtime.bigint();
    let verdict = judgeLiveness({
      nowNs: realNow,
      beatNs: realNow - 50n * MS,
      wedgeMs: WEDGE_MS,
    });
    assert.true(verdict.alive);
    assert.strictEqual(verdict.heartbeatAgeMs, 50);
  });
});
