import { module, test } from 'qunit';

import {
  blendedCostPerMillion,
  modelCostTier,
  modelCostTierLabel,
} from '@cardstack/host/utils/model-cost';

// Blended 3:1 $/M = ((3*prompt + completion) / 4) * 1_000_000, prices per token.
module('Unit | utils | model-cost', function () {
  module('blendedCostPerMillion', function () {
    test('applies the 3:1 input:output weighting', function (assert) {
      // gpt-4o: input $2.50/M, output $10/M => (3*2.5 + 10)/4 = 4.375/M
      let blended = blendedCostPerMillion('0.0000025', '0.00001');
      let isClose = blended !== undefined && Math.abs(blended - 4.375) < 1e-9;
      assert.ok(isClose, `blended ≈ 4.375 (got ${blended})`);
    });

    test('is undefined when both prices are absent', function (assert) {
      assert.strictEqual(
        blendedCostPerMillion(undefined, undefined),
        undefined,
      );
      assert.strictEqual(blendedCostPerMillion('', null), undefined);
    });

    test('treats an absent side as zero when the other is known', function (assert) {
      // prompt only: (3*1 + 0)/4 * 1e6 with prompt 0.000001 => 0.75/M
      assert.strictEqual(blendedCostPerMillion('0.000001', undefined), 0.75);
    });

    test('is undefined when either price is present but unparseable', function (assert) {
      assert.strictEqual(blendedCostPerMillion('n/a', '0.00001'), undefined);
      assert.strictEqual(blendedCostPerMillion('0.000003', 'n/a'), undefined);
      assert.strictEqual(blendedCostPerMillion('abc', 'abc'), undefined);
    });
  });

  module('modelCostTier', function () {
    test('returns Free for zero-priced models', function (assert) {
      assert.deepEqual(modelCostTier('0', '0'), { tier: 0, label: 'Free' });
    });

    test('is undefined when pricing is unknown', function (assert) {
      assert.strictEqual(modelCostTier(undefined, undefined), undefined);
    });

    test('is undefined when pricing is unparseable, never a wrong tier', function (assert) {
      assert.strictEqual(modelCostTierLabel('garbage', '0.00006'), undefined);
    });

    test('maps blended cost across the 1/5/20 tier bounds', function (assert) {
      // Encode a target blended $/M as a completion-only per-token price:
      // blended = (completion/4)*1e6 => completion = blended*4/1e6. Values are
      // kept off the exact bounds so floating-point wobble can't flip a tier.
      let byBlended = (blended: number) =>
        modelCostTierLabel('0', String((blended * 4) / 1_000_000));
      assert.strictEqual(byBlended(0.9), '$', 'just below $1/M');
      assert.strictEqual(byBlended(1.1), '$$', 'just above $1/M');
      assert.strictEqual(byBlended(4.9), '$$', 'just below $5/M');
      assert.strictEqual(byBlended(5.1), '$$$', 'just above $5/M');
      assert.strictEqual(byBlended(19), '$$$', 'just below $20/M');
      assert.strictEqual(byBlended(21), '$$$$', 'just above $20/M');
      assert.strictEqual(byBlended(200), '$$$$', 'well above $20/M');
    });

    test('bounds are inclusive: exactly 1/5/20 land in the lower tier', function (assert) {
      // Completion-only prices whose blended $/M is float-exact at each bound:
      // (completion/4)*1e6 with 0.000004 / 0.00002 / 0.00008 => 1 / 5 / 20.
      assert.strictEqual(modelCostTierLabel('0', '0.000004'), '$');
      assert.strictEqual(modelCostTierLabel('0', '0.00002'), '$$');
      assert.strictEqual(modelCostTierLabel('0', '0.00008'), '$$$');
    });

    test('classifies representative frontier models', function (assert) {
      // gpt-4o-mini: in $0.15/M out $0.60/M => blended 0.2625 => $
      assert.strictEqual(modelCostTierLabel('0.00000015', '0.0000006'), '$');
      // gpt-4o: blended 4.375 => $$
      assert.strictEqual(modelCostTierLabel('0.0000025', '0.00001'), '$$');
      // claude-sonnet-4.5: in $3/M out $15/M => blended 6 => $$$
      assert.strictEqual(modelCostTierLabel('0.000003', '0.000015'), '$$$');
      // o1: in $15/M out $60/M => blended 26.25 => $$$$
      assert.strictEqual(modelCostTierLabel('0.000015', '0.00006'), '$$$$');
    });
  });
});
