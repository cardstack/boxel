import { basename } from 'node:path';
import QUnit from 'qunit';
import { LatticeCommitTick } from '@cardstack/runtime-common/lattice-commit-tick';

const { module, test } = QUnit;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

module(basename(import.meta.filename), function () {
  test('the oldest completed owner triggers a tick without waiting for wave end', async function (assert) {
    const groups: number[][] = [];
    const tick = new LatticeCommitTick<number>(async (items) => {
      groups.push(items);
    }, 10);
    tick.add(1);
    await sleep(30);
    assert.deepEqual(groups, [[1]]);
    tick.add(2);
    await tick.finish();
    assert.deepEqual(
      groups,
      [[1], [2]],
      'wave end drains without another timer',
    );
  });

  test('size bounds flushes and slow commits never overlap', async function (assert) {
    const groups: number[][] = [];
    let active = 0;
    let maximum = 0;
    const tick = new LatticeCommitTick<number>(
      async (items) => {
        maximum = Math.max(maximum, ++active);
        await sleep(5);
        groups.push(items);
        active--;
      },
      4000,
      8,
    );
    for (let n = 0; n < 19; n++) tick.add(n);
    await tick.finish();
    assert.deepEqual(
      groups.map((items) => items.length),
      [8, 8, 3],
    );
    assert.strictEqual(maximum, 1);
    assert.deepEqual(
      groups.flat(),
      Array.from({ length: 19 }, (_, n) => n),
    );
    assert.throws(() => tick.add(20), /closed/);
  });

  test('timer failures surface at wave end and stop subsequent publication', async function (assert) {
    let calls = 0;
    const tick = new LatticeCommitTick<number>(async () => {
      calls++;
      throw new Error('commit failed');
    }, 1);
    tick.add(1);
    await sleep(10);
    assert.throws(() => tick.add(2), /commit failed/);
    await assert.rejects(tick.finish(), /commit failed/);
    assert.strictEqual(calls, 1);
  });

  test('a wave ending in catch-up flushes immediately despite its four-second tick', async function (assert) {
    let done = false;
    const tick = new LatticeCommitTick<number>(async () => {
      done = true;
    }, 4000);
    tick.add(1);
    await tick.finish();
    assert.true(done);
  });
});
