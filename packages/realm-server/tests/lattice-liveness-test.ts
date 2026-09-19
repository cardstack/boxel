import QUnit from 'qunit';
import { basename } from 'node:path';
import {
  latticeLiveness,
  latticeEarlyRefreshDue,
  assertLatticeLivenessTier,
  type LatticeLivenessOwner,
} from '@cardstack/runtime-common/lattice-liveness';
import {
  recordLatticeWaveService,
  type LatticeServiceState,
} from '@cardstack/runtime-common/lattice-stride';
const { module, test } = QUnit;
const boards: LatticeLivenessOwner[] = Array.from({ length: 9 }, (_, i) => ({
  ownerURL: `https://example/Board/${i}`,
  livenessTier: 'visible',
  visible: true,
  publishedAt: 0,
  dirty: false,
}));
module(basename(import.meta.filename), function () {
  test('headroom removes early refresh before saturation; clean viewed cards still cost liveness', (assert) => {
    const slow = latticeLiveness(boards, () => 300, 0, undefined, 1000, 2);
    assert.strictEqual(slow.factors.visible, 1);
    assert.strictEqual(slow.commitTickMs, 400);
    const burst = [
      ...boards,
      ...Array.from({ length: 1000 }, (_, i) => ({
        ownerURL: `https://example/Game/${i}`,
        livenessTier: 'progress' as const,
      })),
    ];
    const loaded = latticeLiveness(
      burst,
      (o) => (o.livenessTier === 'progress' ? 100 : 300),
      0,
      slow,
      2000,
      2,
    );
    assert.strictEqual(loaded.factors.visible, 0);
    assert.strictEqual(loaded.refreshShare, 0);
    assert.strictEqual(loaded.commitTickMs, 4000);
    assert.false(latticeEarlyRefreshDue(boards[0], loaded, 100_000));
    assert.ok(loaded.demand > loaded.capacity);
  });
  test('visible tier consumes spare budget before background; hidden boards get none', (assert) => {
    const owners = [
      ...boards,
      {
        ownerURL: 'https://example/Player/1',
        livenessTier: 'background' as const,
        dirty: false,
      },
    ];
    const result = latticeLiveness(owners, () => 300, 0, undefined, 1000, 1);
    assert.ok(result.factors.visible > 0);
    assert.ok(result.factors.visible < 1);
    assert.strictEqual(result.factors.background, 0);
    assert.false(
      latticeEarlyRefreshDue({ ...boards[0], visible: false }, result, 100_000),
    );
    assert.false(
      latticeEarlyRefreshDue(
        { ownerURL: 'game', livenessTier: 'progress' },
        result,
        100_000,
      ),
    );
    assert.false(latticeEarlyRefreshDue(boards[0], result, 2000));
    assert.true(latticeEarlyRefreshDue(boards[0], result, 4000));
  });
  test('a ramp shuts refresh down quickly and recovers gradually without alternating modes', (assert) => {
    let state = latticeLiveness(boards, () => 300, 0, undefined, 0, 2);
    let service = 0;
    const costs = () => 300;
    const factors: number[] = [];
    for (let second = 1; second <= 6; second++) {
      service += 2000;
      state = latticeLiveness(boards, costs, service, state, second * 1000, 2);
      factors.push(state.factors.visible);
    }
    assert.ok(
      factors.at(-1)! < 0.15,
      'settling demand consumes the spare budget',
    );
    const recovery: number[] = [];
    for (let second = 7; second <= 30; second++) {
      state = latticeLiveness(boards, costs, service, state, second * 1000, 2);
      recovery.push(state.factors.visible);
    }
    assert.ok(
      recovery.every((f, i) => i === 0 || f >= recovery[i - 1]),
      'recovery is monotone at a steady low pace',
    );
    assert.ok(recovery[0] < 0.2, 'no instant swing back to full liveness');
    assert.ok(recovery.at(-1)! > 0.75, 'idle budget recovers');
    assert.ok(state.refreshShare <= 0.8);
  });
  test('concurrent owner samples charge one occupied wave, including setup and swap', (assert) => {
    const state: LatticeServiceState = { version: 1, pools: {} };
    recordLatticeWaveService(
      state,
      [
        { ownerURL: 'https://example/Game/1', elapsedMs: 200, refresh: false },
        { ownerURL: 'https://example/Board/1', elapsedMs: 200, refresh: true },
      ],
      600,
    );
    assert.strictEqual(state.settlingServiceMs, 300);
    assert.strictEqual(state.costByType!['https://example/Game'], 300);
    assert.strictEqual(state.costByType!['https://example/Board'], 300);
    assert.throws(() => assertLatticeLivenessTier('typo'), /Invalid/);
    assert.throws(
      () => latticeLiveness([], () => 0, 0, undefined, 0, 0),
      /capacity/,
    );
  });
});
