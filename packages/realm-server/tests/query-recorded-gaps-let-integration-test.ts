import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  type Q,
  RRF_K,
  idOf,
  setupRecordedGaps,
} from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for let bindings. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, link, brand, nameOf, run, outcome, isCodedRefusal, close } =
    setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: an `expression` sort that names a one-card binding is
    // accepted and every row scores blank (today the binding reads as 0, so
    // each row carries a wrong number). docs/search.md: an expression reads
    // a one-card binding as `$name.path`, so it either reads it or says it
    // cannot.
    const anchored = fixture('anchored', {
      Item: {
        R: { title: 'reference', price: 100 },
        A: { title: 'first', price: 40 },
        B: { title: 'second', price: 70 },
      },
    });
    test('an expression sort that names a one-card binding reads it, or is refused', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(anchored, {
          type: anchored.Item,
          let: {
            $ref: {
              from: {
                type: anchored.Item,
                filter: { eq: { id: anchored.id('Item', 'R') } },
              },
              one: true,
            },
          },
          sort: [{ expression: '$ref.price - price' }],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /ref|binding/, 'the expression sort');
      } else {
        // 100 - 40, 100 - 70, 100 - 100, highest first
        assert.deepEqual(
          answer!.names,
          ['A', 'B', 'R'],
          'ordered by the value',
        );
        assert.deepEqual(
          answer!.rows.map((r) =>
            r._expression == null ? null : Number(r._expression),
          ),
          [60, 30, 0],
          'each row carries the value',
        );
      }
    });
  });

  // ==========================================================================
  module('focused cases', function () {
    const coded = fixture('coded', {
      Item: {
        A: { title: 'one', sku: 'FG-0346-X', vec: [127, 0] },
        // cosine to A: 127 / sqrt(127² + 60²) = 0.904
        B: { title: 'two', sku: 'ZZ-1', vec: [127, 60] },
        C: { title: 'three', sku: 'ZZ-2', vec: [0, 127] },
      },
    });
    test('a pattern anchors a one-card binding, and the same glob admits and boosts', async function (assert) {
      let glob = { pattern: { sku: 'fg-0346*' } };
      let answer = await run(coded, {
        type: coded.Item,
        let: {
          $typed: { from: { type: coded.Item, filter: glob }, one: true },
        },
        filter: {
          any: [
            glob,
            {
              near: {
                vec: {
                  to: '$typed.vec',
                  minSimilarity: 0.8,
                },
              },
            },
          ],
        },
        sort: [{ blend: [{ boost: glob }] }],
      });
      assert.deepEqual(answer.meta.lets, {
        $typed: { strategy: 'card', found: true },
      });
      // A by the glob (and its own vector), B by its vector; the boost lifts
      // only A
      assert.deepEqual(answer.names, ['A', 'B']);
      assert.true(close(answer.rows[0]._blendScore, 1 / (RRF_K + 1)), 'A');
      assert.true(close(answer.rows[1]._blendScore, 0), 'B');
    });

    const bounded = fixture('bounded', {
      Item: {
        R: { title: 'reference', price: 50 },
        A: { title: 'one', price: 40 },
        B: { title: 'two', price: 60 },
      },
    });
    test('a boost reads a one-card binding in a range bound and in an eq', async function (assert) {
      let ref = {
        from: {
          type: bounded.Item,
          filter: { eq: { id: bounded.id('Item', 'R') } },
        },
        one: true,
      };
      let scores = async (boost: Q, weight: number) =>
        Object.fromEntries(
          (
            await run(bounded, {
              type: bounded.Item,
              let: { $ref: ref },
              sort: [{ blend: [{ boost, weight }] }],
            })
          ).rows.map((r) => [nameOf(r.url), Number(r._blendScore)]),
        );
      // only A costs less than the reference
      let under = await scores({ range: { price: { lt: '$ref.price' } } }, 1);
      assert.true(close(under.A, 1 / (RRF_K + 1)), `A: ${under.A}`);
      assert.true(close(under.B, 0), `B gains nothing: ${under.B}`);
      assert.true(close(under.R, 0), `R gains nothing: ${under.R}`);
      let same = await scores({ eq: { id: '$ref.id' } }, 5);
      assert.true(close(same.R, 5 / (RRF_K + 1)), `R: ${same.R}`);
      assert.true(close(same.A, 0), `A gains nothing: ${same.A}`);
      assert.true(close(same.B, 0), `B gains nothing: ${same.B}`);
    });

    // ---- bindings ---------------------------------------------------------
    const sized = fixture('sized', {
      Item: {
        A: { title: 'one' },
        B: { title: 'two' },
        C: { title: 'three' },
      },
      Variant: {
        a7: { parent: link('sized', 'Item', 'A'), size: '7' },
        a9: { parent: link('sized', 'Item', 'A'), size: '9' },
        b9: { parent: link('sized', 'Item', 'B'), size: '9' },
      },
    });
    test('a list binding from another type joins through a link id, both ways', async function (assert) {
      let items = await run(sized, {
        type: sized.Item,
        let: {
          $fit: {
            from: { type: sized.Variant, filter: { eq: { size: '7' } } },
            select: 'parent.id',
          },
        },
        filter: { in: { id: '$fit' } },
      });
      assert.deepEqual(items.names, ['A'], 'the item with a size 7 variant');
      assert.deepEqual(items.meta.lets, {
        $fit: { strategy: 'list', values: 1 },
      });

      let variants = await run(sized, {
        type: sized.Variant,
        let: {
          $some: {
            from: { type: sized.Item, filter: { eq: { title: 'two' } } },
            select: 'id',
          },
        },
        filter: { in: { 'parent.id': '$some' } },
      });
      assert.deepEqual(variants.names, ['b9'], "that item's variants");
      assert.deepEqual(variants.meta.lets, {
        $some: { strategy: 'list', values: 1 },
      });
    });

    test('"has the wanted variant, or has none": in one list, or not in another', async function (assert) {
      let { names } = await run(sized, {
        type: sized.Item,
        let: {
          $withAny: { from: { type: sized.Variant }, select: 'parent.id' },
          $withSeven: {
            from: { type: sized.Variant, filter: { eq: { size: '7' } } },
            select: 'parent.id',
          },
        },
        filter: {
          any: [
            { in: { id: '$withSeven' } },
            { not: { in: { id: '$withAny' } } },
          ],
        },
      });
      // A has a 7; B has variants but no 7; C has no variant
      assert.deepEqual(names.sort(), ['A', 'C']);
    });

    const saved = fixture('saved', {
      Item: {
        A: { title: 'one', kind: 'sofa', price: 20 },
        B: { title: 'two', kind: 'lamp', price: 80 },
        C: { title: 'three', kind: 'sofa', price: 50 },
        D: { title: 'four', kind: 'rug', price: 10 },
        E: { title: 'five', kind: 'bed', price: 90 },
      },
      List: {
        L: { items: [link('saved', 'Item', 'A'), link('saved', 'Item', 'B')] },
      },
    });
    const onList = {
      linkedFrom: { card: idOf('saved', 'List', 'L'), field: 'items' },
    };
    test("a binding's query can read a saved list, as a list of values and as one card", async function (assert) {
      let more = await run(saved, {
        type: saved.Item,
        let: {
          $kinds: {
            from: { type: saved.Item, filter: onList },
            select: 'kind',
          },
        },
        filter: {
          every: [{ in: { kind: '$kinds' } }, { not: onList }],
        },
      });
      // the list holds a sofa and a lamp; C is the only other sofa or lamp
      assert.deepEqual(more.names, ['C']);
      assert.deepEqual(more.meta.lets, {
        $kinds: { strategy: 'list', values: 2 },
      });

      let one = await run(saved, {
        type: saved.Item,
        let: {
          $pick: {
            from: {
              type: saved.Item,
              filter: { every: [onList, { eq: { kind: 'sofa' } }] },
            },
            one: true,
          },
        },
        filter: { eq: { id: '$pick.id' } },
      });
      assert.deepEqual(one.names, ['A'], 'the sofa on the list');
      assert.deepEqual(one.meta.lets, {
        $pick: { strategy: 'card', found: true },
      });
    });

    test('two one-card bindings, each the first of an opposite sort, bound a range', async function (assert) {
      let first = (direction: string) => ({
        from: {
          type: saved.Item,
          filter: onList,
          sort: [{ by: 'price', direction }],
        },
        one: true,
      });
      let { names } = await run(saved, {
        type: saved.Item,
        let: { $low: first('asc'), $high: first('desc') },
        filter: {
          range: {
            price: {
              gte: '$low.price',
              lte: '$high.price',
            },
          },
        },
        sort: [{ by: 'price' }],
      });
      // the list's prices are 20 and 80; 10 and 90 fall outside
      assert.deepEqual(names, ['A', 'C', 'B']);
    });

    const branded = fixture('branded', {
      Brand: { x: { name: 'Xeno' }, y: { name: 'Yarrow' } },
      Item: {
        R: { title: 'reference', brand: brand('branded', 'Xeno') },
        A: { title: 'one', brand: brand('branded', 'Xeno') },
        B: { title: 'two', brand: brand('branded', 'Yarrow') },
        C: { title: 'three' },
      },
    });
    for (let [how, none] of [
      ['missing', { missing: 'brand.name' }],
      ['eq null', { eq: { 'brand.name': null } }],
    ] as [string, Q][]) {
      test(`"a different brand" keeps the cards with no brand (${how})`, async function (assert) {
        let { names } = await run(branded, {
          type: branded.Item,
          let: {
            $ref: {
              from: {
                type: branded.Item,
                filter: { eq: { id: branded.id('Item', 'R') } },
              },
              one: true,
            },
          },
          filter: {
            any: [
              none,
              {
                not: {
                  eq: { 'brand.name': '$ref.brand.name' },
                },
              },
            ],
          },
        });
        // not Xeno: B by its brand, C by having none
        assert.deepEqual(names.sort(), ['B', 'C']);
      });
    }
  });
});
