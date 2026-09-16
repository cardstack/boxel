import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { captureLatticeComputeTurn } from '@cardstack/host/lib/lattice-compute-turn';

import {
  setupBaseRealm,
  CardDef,
  contains,
  field,
  NumberField,
  searchDocFromFields,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | Lattice compute turn', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('a search walk shares synchronous computed inputs only within each card identity and turn', async function (assert) {
    let api = await getService('card-service').getAPI();
    let calls = 0;
    class Totals extends CardDef {
      @field amount = contains(NumberField);
      @field doubled = contains(NumberField, {
        computeVia: function (this: Totals) {
          calls++;
          return this.amount * 2;
        },
      });
      @field combined = contains(NumberField, {
        computeVia: function (this: Totals) {
          return this.doubled + this.doubled;
        },
      });
    }
    let first = new Totals({ amount: 3 });
    let second = new Totals({ amount: 5 });
    let capture = captureLatticeComputeTurn(api, () =>
      Promise.all([searchDocFromFields(first), searchDocFromFields(second)]),
    );
    let [firstDoc, secondDoc] = await capture.value;
    assert.strictEqual(firstDoc.combined, 12);
    assert.strictEqual(secondDoc.combined, 20);
    assert.strictEqual(
      calls,
      2,
      'each identity computes its shared input once',
    );
    assert.true((capture.metrics?.cacheHits ?? 0) >= 4);

    first.amount = 4;
    let next = captureLatticeComputeTurn(api, () => searchDocFromFields(first));
    assert.strictEqual(
      (await next.value).combined,
      16,
      'next pass sees changed input',
    );
    assert.strictEqual(calls, 3);
  });

  test('a pending walk releases its memo before asynchronous continuation and source changes', async function (assert) {
    let api = await getService('card-service').getAPI();
    let calls = 0;
    class Count extends CardDef {
      @field amount = contains(NumberField);
      @field total = contains(NumberField, {
        computeVia: function (this: Count) {
          calls++;
          return this.amount + 1;
        },
      });
    }
    let count = new Count({ amount: 5 });
    let resume!: () => void;
    let gate = new Promise<void>((resolve) => (resume = resolve));
    let capture = captureLatticeComputeTurn(api, async () => {
      assert.strictEqual(count.total, 6);
      assert.strictEqual(count.total, 6);
      await gate;
      return count.total;
    });
    assert.strictEqual(calls, 1);
    count.amount = 8;
    assert.strictEqual(
      count.total,
      9,
      'ordinary reads while the walk waits are fresh',
    );
    resume();
    assert.strictEqual(
      await capture.value,
      9,
      'continuation consumes the changed input',
    );
    assert.strictEqual(calls, 3, 'no memo survives the asynchronous boundary');
  });

  test('a synchronous failure cannot retain computed values into later reads', async function (assert) {
    let api = await getService('card-service').getAPI();
    class Count extends CardDef {
      @field amount = contains(NumberField);
      @field total = contains(NumberField, {
        computeVia: function (this: Count) {
          return this.amount + 1;
        },
      });
    }
    let count = new Count({ amount: 2 });
    assert.throws(
      () =>
        captureLatticeComputeTurn(api, () => {
          assert.strictEqual(count.total, 3);
          throw new Error('failed synchronous walk');
        }),
      /failed synchronous walk/,
    );
    count.amount = 7;
    assert.strictEqual(count.total, 8);
  });

  test('an older card API without compute-pass support remains usable', function (assert) {
    let capture = captureLatticeComputeTurn({}, () => 7);
    assert.strictEqual(capture.value, 7);
    assert.strictEqual(capture.metrics, undefined);
  });
});
