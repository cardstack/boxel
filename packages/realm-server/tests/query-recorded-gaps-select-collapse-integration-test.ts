import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { RRF_K, setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for select and collapse. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, brand, run, close, rerankOf, table } =
    setupRecordedGaps(hooks);

  // ==========================================================================
  module('focused cases', function () {
    const grouped = fixture('grouped', {
      Brand: { x: { name: 'Xeno' }, y: { name: 'Yarrow' } },
      Item: {
        // nearest first to [127, 0]: X10, X20, Y5
        X10: {
          title: 'one',
          price: 10,
          vec: [127, 0],
          brand: brand('grouped', 'Xeno'),
        },
        X20: {
          title: 'two',
          price: 20,
          vec: [127, 40],
          brand: brand('grouped', 'Xeno'),
        },
        Y5: {
          title: 'three',
          price: 5,
          vec: [127, 90],
          brand: brand('grouped', 'Yarrow'),
        },
      },
    });
    test('collapse, then the window: it sees the kept row of each group, and the group size survives', async function (assert) {
      let answer = await run(grouped, {
        type: grouped.Item,
        sort: [
          { expression: '100 - price', top: 100 },
          { by: 'vec', near: [127, 0] },
        ],
        collapse: 'brand.name',
      });
      // X10 is the nearest Xeno card; 100 - 5 is above 100 - 10
      assert.deepEqual(answer.names, ['Y5', 'X10']);
      assert.deepEqual(rerankOf(answer), { Y5: 95, X10: 90 });
      assert.deepEqual(
        answer.rows.map((r) => Number(r._collapseSize)),
        [1, 2],
        'each row says how many matches its group holds',
      );
    });

    // ---- select -----------------------------------------------------------
    const scored = fixture('scored', {
      Item: {
        P: { title: 'one', kind: 'k', price: 30, rating: 3 },
        Q: { title: 'two', kind: 'k', price: 20, rating: 5 },
        R: { title: 'three', kind: 'j', price: 10, rating: 4 },
      },
    });
    test("select returns the query's scores as columns", async function (assert) {
      // price ranks P, Q, R and rating ranks Q, R, P, highest first
      let rrf = (a: number, b: number) => 1 / (RRF_K + a) + 1 / (RRF_K + b);
      let fused = await table(scored, {
        type: scored.Item,
        sort: [{ blend: [{ by: 'price' }, { by: 'rating' }] }],
        select: ['_blendScore'],
      });
      assert.deepEqual(
        fused.rows.map((r) => r[0]),
        ['Q', 'P', 'R'],
        'in fused order',
      );
      [rrf(2, 1), rrf(1, 3), rrf(3, 2)].forEach((expected, i) =>
        assert.true(
          close(fused.rows[i][1], expected),
          `${fused.rows[i][0]}: ${fused.rows[i][1]} is ${expected}`,
        ),
      );

      let collapsed = await table(scored, {
        type: scored.Item,
        sort: [{ by: 'price', direction: 'desc' }],
        collapse: 'kind',
        select: ['_collapseSize'],
      });
      assert.deepEqual(
        collapsed.rows.map((r) => [r[0], Number(r[1])]),
        [
          ['P', 2],
          ['R', 1],
        ],
        'the dearest of each kind, with its group size',
      );

      let reranked = await table(scored, {
        type: scored.Item,
        sort: [{ expression: 'price', top: 100 }, { by: 'rating' }],
        select: [{ saving: '_window' }],
      });
      assert.deepEqual(reranked.columns, ['id', 'saving'], 'a renamed score');
      assert.deepEqual(
        reranked.rows.map((r) => [r[0], Number(r[1])]),
        [
          ['P', 30],
          ['Q', 20],
          ['R', 10],
        ],
      );
    });
  });
});
