import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { type Q, setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for comparison sets. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, brand, run, outcome, isCodedRefusal, close, rerankOf } =
    setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: arithmetic over a `peers.` list inside an aggregate scores
    // no row, with no warning. docs/search.md: `peers.<field>` is "the set's
    // values as a list ... for any Excel function".
    const ratios = fixture('ratios', {
      Item: {
        A: { title: 'one', kind: 'k', a: 2, b: 1 },
        B: { title: 'two', kind: 'k', a: 4, b: 2 },
        C: { title: 'three', kind: 'k', a: 6, b: 2 },
      },
    });
    for (let [expression, expected, how] of [
      // the ratios are 2, 2 and 3
      ['MEDIAN(peers.a / peers.b)', 2, 'a list divided by a list'],
      [
        'AVERAGE(LN(peers.a + 1))',
        (Math.log(3) + Math.log(5) + Math.log(7)) / 3,
        'a function of a list plus a number',
      ],
    ] as [string, number, string][]) {
      test(`list arithmetic over peers gives a number or a refusal: ${how}`, async function (assert) {
        let { answer, refused } = await outcome(() =>
          run(ratios, {
            type: ratios.Item,
            sort: [{ expression, compare: { by: 'kind' } }, { by: 'a' }],
          }),
        );
        if (refused) {
          isCodedRefusal(assert, refused, /peers|list/, expression);
        } else {
          let values = rerankOf(answer!);
          for (let name of ['A', 'B', 'C']) {
            assert.true(
              close(values[name], expected),
              `${name}: ${values[name]} is ${expected}`,
            );
          }
          assert.strictEqual(
            answer!.meta.window?.scored,
            3,
            'three rows scored',
          );
        }
      });
    }

    // Recorded: COUNTIFS over peers lists scores almost no row.
    test('COUNTIFS over two peers lists counts the peers meeting both', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(ratios, {
          type: ratios.Item,
          sort: [
            {
              expression: 'COUNTIFS(peers.a, ">=4", peers.b, ">=2")',
              compare: { by: 'kind' },
            },
            { by: 'a' },
          ],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /COUNTIFS|peers/, 'COUNTIFS');
      } else {
        // B (4, 2) and C (6, 2) meet both; A (2, 1) meets neither
        assert.deepEqual(rerankOf(answer!), { A: 2, B: 2, C: 2 });
      }
    });

    // Decided (2026-11-10): COUNTIF over a text field counts text equality,
    // ignoring case, as Excel does; a text criterion has no wildcards, and a
    // field's text is never read as an operator.
    const kinds = fixture('kinds', {
      Item: {
        A: { title: 'one', kind: 'k', price: 1 },
        B: { title: 'two', kind: 'K', price: 2 },
        C: { title: 'three', kind: 'j', price: 3 },
      },
    });
    for (let [expression, expected, why] of [
      [
        'COUNTIF(peers.kind, kind)',
        { A: 2, B: 2, C: 1 },
        "each row's own kind: k and K are one kind, j is alone",
      ],
      [
        'COUNTIF(peers.kind, "K")',
        { A: 2, B: 2, C: 2 },
        'a text literal, any case',
      ],
      ['COUNTIF(peers.kind, "<>k")', { A: 1, B: 1, C: 1 }, 'not equal to k'],
      ['COUNTIF(peers.kind, "k*")', { A: 0, B: 0, C: 0 }, 'no wildcards'],
    ] as const) {
      test(`COUNTIF over a text field: ${expression}, ${why}`, async function (assert) {
        let answer = await run(kinds, {
          type: kinds.Item,
          sort: [{ expression, top: 100 }, { by: 'price' }],
        });
        assert.deepEqual(rerankOf(answer), expected);
        assert.strictEqual(answer.meta.window?.scored, 3, 'every row scored');
      });
    }
  });

  // ==========================================================================
  module('recorded gaps now closed', function () {
    // Recorded beside COUNTIFS: SUMPRODUCT over peers lists scored almost no
    // row. Every expression now runs in SQL, whose score profile has no
    // SUMPRODUCT: it is refused before anything runs, rather than scoring
    // nothing.
    const products = fixture('products', {
      Item: {
        A: { title: 'one', a: 2, b: 1 },
        B: { title: 'two', a: 4, b: 2 },
        C: { title: 'three', a: 6, b: 2 },
      },
    });
    test('SUMPRODUCT over two peers lists is refused: SQL cannot run it', async function (assert) {
      let { refused } = await outcome(() =>
        run(products, {
          type: products.Item,
          sort: [
            { expression: 'SUMPRODUCT(peers.a, peers.b)', top: 100 },
            { by: 'a' },
          ],
        }),
      );
      isCodedRefusal(
        assert,
        refused!,
        /SUMPRODUCT/,
        'SUMPRODUCT',
        'expression-unsupported',
      );
    });
  });

  // ==========================================================================
  module('focused cases', function () {
    // ---- rerank -----------------------------------------------------------
    const rated = fixture('rated', {
      Brand: { x: { name: 'Xeno' } },
      Item: {
        A: { title: 'one', rating: 3, brand: brand('rated', 'Xeno') },
        B: { title: 'two', rating: 4, brand: brand('rated', 'Xeno') },
        C: { title: 'three', rating: 5, brand: brand('rated', 'Xeno') },
      },
    });
    test('COUNTIF over peers with a built criterion counts the peers above the row', async function (assert) {
      let answer = await run(rated, {
        type: rated.Item,
        sort: [
          {
            expression: 'COUNTIF(peers.rating, ">" & rating)',
            compare: { by: 'brand.name' },
            direction: 'asc',
          },
          { by: 'rating' },
        ],
      });
      assert.deepEqual(rerankOf(answer), { A: 2, B: 1, C: 0 });
      assert.deepEqual(answer.names, ['C', 'B', 'A'], 'fewest above first');
    });

    const priced = fixture('priced', {
      Item: {
        K10: { title: 'one', kind: 'k', price: 10, rating: 5 },
        K20: { title: 'two', kind: 'k', price: 20, rating: 3 },
        K30: { title: 'three', kind: 'k', price: 30, rating: 3 },
        J100: { title: 'four', kind: 'j', price: 100, rating: 5 },
      },
    });
    test("compare.by with compare.filter: the set is the filter's rows of the row's group, not the query's matches", async function (assert) {
      let ask = (compare: Q) =>
        run(priced, {
          type: priced.Item,
          filter: { range: { rating: { gte: 5 } } },
          sort: [
            { expression: 'price / stats.price.median', compare },
            { by: 'price' },
          ],
        });
      // against every card of its kind: 10 over the median of 10, 20, 30
      assert.deepEqual(
        rerankOf(await ask({ by: 'kind', filter: { type: priced.Item } })),
        { K10: 0.5, J100: 1 },
        'the set is every card of the kind',
      );
      // against the query's matches of its kind: itself
      assert.deepEqual(
        rerankOf(await ask({ by: 'kind' })),
        { K10: 1, J100: 1 },
        'the set is the matches of the kind',
      );
    });
  });

  // ==========================================================================
  // What the engine does today where docs/search.md does not give the rule.
  module('pinned, rule not yet decided', function () {
    const peers = fixture('peers', {
      Item: {
        K10: { title: 'one', kind: 'k', price: 10, rating: 5 },
        K20: { title: 'two', kind: 'k', price: 20, rating: 3 },
        K30: { title: 'three', kind: 'k', price: 30, rating: 3 },
      },
    });
    // docs/search.md lists the filter, every sort entry and the collapse as
    // inheriting the query's `type`. It does not say whether a window's
    // comparison filter does.
    test("a window's comparison filter inherits the query's type, as every clause does", async function (assert) {
      // decided (DO5): a top-level `type` anchors every clause, the
      // comparison set's filter included
      let ask = (filter: Q) =>
        outcome(() =>
          run(peers, {
            type: peers.Item,
            filter: { range: { rating: { gte: 5 } } },
            sort: [
              { expression: 'price / stats.price.median', compare: { filter } },
            ],
          }),
        );
      let bare = await ask({ eq: { kind: 'k' } });
      let anchored = await ask({ on: peers.Item, eq: { kind: 'k' } });
      // 10 over the median of 10, 20 and 30
      assert.deepEqual(rerankOf(anchored.answer!), { K10: 0.5 }, 'with `on`');
      assert.deepEqual(
        bare.answer ? rerankOf(bare.answer) : bare.refused,
        rerankOf(anchored.answer!),
        'with no anchor, the same as with `on`',
      );
    });
  });
});
