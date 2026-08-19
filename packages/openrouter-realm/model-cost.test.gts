import { module, test } from 'qunit';

import { setupBaseRealm } from '@cardstack/host/tests/helpers/base-realm';
import { setupRenderingTest } from '@cardstack/host/tests/helpers/setup';

import {
  blendedCostPerMillion,
  modelCostTier,
  modelCostTierLabel,
} from './model-cost';
import { OpenRouterModel, OpenRouterPricing } from './openrouter-model';

// Live test for the cost-tier math co-located with the OpenRouterModel card.
// Discovered from the openrouter realm's `_mtimes` and run by the host
// live-test harness (packages/host/tests/live-test.js). Blended 3:1 $/M =
// ((3*prompt + completion) / 4) * 1_000_000, with prices given per token.
export function runTests() {
  module('Live | openrouter | model-cost | banding math', function () {
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

      test('rejects numeric-prefixed and negative prices as unparseable', function (assert) {
        // `parseFloat` would accept the numeric prefix / sign here and produce a
        // wrong tier; `Number` + the `>= 0` guard treat all of these as unknown.
        assert.strictEqual(
          blendedCostPerMillion('0.000003 USD', '0'),
          undefined,
          'trailing units',
        );
        assert.strictEqual(
          blendedCostPerMillion('1x', '0'),
          undefined,
          'suffix',
        );
        assert.strictEqual(
          blendedCostPerMillion('-0.001', '0'),
          undefined,
          'negative price is not Free',
        );
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
        // A numeric-prefixed price must not slip through as a real (wrong) tier.
        assert.strictEqual(modelCostTierLabel('0.000003 USD', '0'), undefined);
      });

      test('maps blended cost across the 1/5/15 tier bounds', function (assert) {
        // Encode a target blended $/M as a completion-only per-token price:
        // blended = (completion/4)*1e6 => completion = blended*4/1e6. Values are
        // kept off the exact bounds so floating-point wobble can't flip a tier.
        let byBlended = (blended: number) =>
          modelCostTierLabel('0', String((blended * 4) / 1_000_000));
        assert.strictEqual(byBlended(0.9), '$', 'just below $1/M');
        assert.strictEqual(byBlended(1.1), '$$', 'just above $1/M');
        assert.strictEqual(byBlended(4.9), '$$', 'just below $5/M');
        assert.strictEqual(byBlended(5.1), '$$$', 'just above $5/M');
        assert.strictEqual(byBlended(14), '$$$', 'just below $15/M');
        assert.strictEqual(byBlended(16), '$$$$', 'just above $15/M');
        assert.strictEqual(byBlended(200), '$$$$', 'well above $15/M');
      });

      test('bounds are inclusive: exactly 1/5/15 land in the lower tier', function (assert) {
        // Completion-only prices whose blended $/M is float-exact at each bound:
        // (completion/4)*1e6 with 0.000004 / 0.00002 / 0.00006 => 1 / 5 / 15.
        assert.strictEqual(modelCostTierLabel('0', '0.000004'), '$');
        assert.strictEqual(modelCostTierLabel('0', '0.00002'), '$$');
        assert.strictEqual(modelCostTierLabel('0', '0.00006'), '$$$');
      });

      test('float noise cannot tip an exact-bound price into the tier above', function (assert) {
        // gpt-4-turbo: in $10/M out $30/M => blended exactly 15, but the raw
        // float math yields 15.000000000000002. The blend rounds that noise
        // away, so the price lands on the inclusive bound and stays $$$.
        assert.strictEqual(modelCostTierLabel('0.00001', '0.00003'), '$$$');
      });

      test('classifies representative frontier models (tier + label)', function (assert) {
        // gpt-4o-mini: in $0.15/M out $0.60/M => blended 0.2625 => $
        assert.deepEqual(modelCostTier('0.00000015', '0.0000006'), {
          tier: 1,
          label: '$',
        });
        // gpt-4o: blended 4.375 => $$
        assert.deepEqual(modelCostTier('0.0000025', '0.00001'), {
          tier: 2,
          label: '$$',
        });
        // claude-sonnet-4.5: in $3/M out $15/M => blended 6 => $$$
        assert.deepEqual(modelCostTier('0.000003', '0.000015'), {
          tier: 3,
          label: '$$$',
        });
        // claude-fable-5: in $10/M out $50/M => blended 20 => $$$$
        assert.deepEqual(modelCostTier('0.00001', '0.00005'), {
          tier: 4,
          label: '$$$$',
        });
        // o1: in $15/M out $60/M => blended 26.25 => $$$$
        assert.deepEqual(modelCostTier('0.000015', '0.00006'), {
          tier: 4,
          label: '$$$$',
        });
      });
    });
  });

  // Proves the card's `costTier` / `costTierLabel` computeVia fields are wired to
  // the math above — reading the model's own pricing. (The picker integration
  // test asserts field -> badge with plain values; this closes the seam that
  // pricing actually flows into the computed field.)
  module(
    'Live | openrouter | model-cost | card computeVia wiring',
    function (hooks) {
      setupRenderingTest(hooks);
      setupBaseRealm(hooks);

      test('costTier / costTierLabel compute from the card’s own pricing', function (assert) {
        let paid = new OpenRouterModel({
          pricing: new OpenRouterPricing({
            prompt: '0.000003',
            completion: '0.000015',
          }),
        });
        assert.strictEqual(paid.costTierLabel, '$$$', 'blended $6/M => $$$');
        assert.strictEqual(paid.costTier, 3, 'the sortable rank is 3');
      });

      test('a zero-priced model computes as Free', function (assert) {
        let free = new OpenRouterModel({
          pricing: new OpenRouterPricing({ prompt: '0', completion: '0' }),
        });
        assert.strictEqual(free.costTierLabel, 'Free');
        assert.strictEqual(free.costTier, 0);
      });

      test('a model with no pricing has no tier', function (assert) {
        let unknown = new OpenRouterModel({ modelId: 'vendor/mystery-model' });
        assert.strictEqual(
          unknown.costTierLabel,
          undefined,
          'no badge text when pricing is unknown',
        );
        assert.strictEqual(unknown.costTier, undefined);
      });
    },
  );
}
