import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { type Q, setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for near search. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}
module(basename(import.meta.filename), function (hooks) {
  const { fixture, run, close, rerankOf, table } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps now closed', function () {
    // Recorded: `_nearSimilarity` is null on every row once a window
    // (an expression sort entry with top) is present. docs/search.md: "A
    // re-ranked row keeps everything else the query computed for it: ...
    // `_nearSimilarity`".
    const NEAR = [127, 0];
    const VECTORS = { A: [127, 0], B: [96, 127] };
    const alike = fixture('alike', {
      Item: {
        A: { title: 'one', price: 10, vec: VECTORS.A },
        B: { title: 'two', price: 5, vec: VECTORS.B },
      },
    });
    const alikeQuery = {
      type: alike.Item,
      sort: [
        { expression: '100 - price', top: 100 },
        { by: 'vec', near: NEAR },
      ],
    };
    test('a re-ranked row keeps its near similarity', async function (assert) {
      let { names, rows } = await run(alike, alikeQuery);
      // 100 - 5 is above 100 - 10
      assert.deepEqual(names, ['B', 'A'], 'in the rerank order');
      assert.true(
        close(rows[0]._nearSimilarity, cosine(VECTORS.B, NEAR)),
        `B: ${rows[0]._nearSimilarity}`,
      );
      assert.true(
        close(rows[1]._nearSimilarity, cosine(VECTORS.A, NEAR)),
        `A: ${rows[1]._nearSimilarity}`,
      );
    });

    test('a re-ranked row keeps its near similarity as a select column', async function (assert) {
      let { columns, rows } = await table(alike, {
        ...alikeQuery,
        select: ['price', '_nearSimilarity', '_window'],
      });
      assert.deepEqual(columns, ['id', 'price', '_nearSimilarity', '_window']);
      assert.deepEqual(
        rows.map((r) => [r[0], r[1], r[3]]),
        [
          ['B', 5, 95],
          ['A', 10, 90],
        ],
        'the rows, their prices and rerank values',
      );
      assert.true(
        close(rows[0][2], cosine(VECTORS.B, NEAR)),
        `B: ${rows[0][2]}`,
      );
      assert.true(
        close(rows[1][2], cosine(VECTORS.A, NEAR)),
        `A: ${rows[1][2]}`,
      );
    });
  });

  // ==========================================================================
  module('focused cases', function () {
    const lookalikes = fixture('lookalikes', {
      Item: {
        A: { title: 'one', kind: 'k', vec: [127, 0] },
        B: { title: 'two', kind: 'k', vec: [127, 26] },
        // nearer to A than B is, and of another kind
        C: { title: 'three', kind: 'j', vec: [127, 18] },
      },
    });
    test("compare.near with a filter draws the look-alikes from the filter's rows only", async function (assert) {
      let ask = async (expression: string, filter?: Q) =>
        rerankOf(
          await run(lookalikes, {
            type: lookalikes.Item,
            filter: { eq: { title: 'one' } },
            sort: [
              {
                expression,
                compare: {
                  near: 'vec',
                  k: 5,
                  minSimilarity: 0.9,
                  ...(filter ? { filter } : {}),
                },
              },
            ],
          }),
        );
      let ofKind = { on: lookalikes.Item, eq: { kind: 'k' } };
      assert.deepEqual(
        await ask('COUNT(peers.similarity)'),
        { A: 2 },
        'with no filter, both other cards are look-alikes',
      );
      assert.deepEqual(
        await ask('COUNT(peers.similarity)', ofKind),
        { A: 1 },
        'with the filter, only the one of its kind',
      );
      let average = (await ask('AVERAGE(peers.similarity)', ofKind)).A;
      assert.true(
        close(average, cosine([127, 0], [127, 26])),
        `peers.similarity is the cosine to B: ${average}`,
      );
    });

    const pointed = fixture('pointed', {
      Item: {
        A: { title: 'one', kind: 'a', vec: [127, 0] },
        B: { title: 'two', kind: 'b', vec: [0, 127] },
      },
    });
    test('a one-card binding found by a near sort with no filter is the nearest card', async function (assert) {
      let answer = await run(pointed, {
        type: pointed.Item,
        let: {
          $best: {
            from: {
              type: pointed.Item,
              sort: [{ by: 'vec', near: [127, 0] }],
            },
            one: true,
          },
        },
        filter: { eq: { kind: '$best.kind' } },
      });
      assert.deepEqual(answer.names, ['A']);
      assert.deepEqual(answer.meta.lets, {
        $best: { strategy: 'card', found: true },
      });
    });
  });
});
