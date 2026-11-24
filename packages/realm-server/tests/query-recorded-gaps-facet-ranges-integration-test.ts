import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  type Answer,
  type Q,
  setupRecordedGaps,
} from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for facet ranges and measures. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, brand, run, outcome, isCodedRefusal, facetOf, table } =
    setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: a label in a facet `measure` is accepted and the measure is
    // missing from every entry. docs/search.md: a field "may be written as
    // ... a label in any case and spacing".
    const labeled = fixture('labeled', {
      Brand: { x: { name: 'Xeno' }, y: { name: 'Yarrow' } },
      Item: {
        A: { title: 'one', price: 10, brand: brand('labeled', 'Xeno') },
        B: { title: 'two', price: 30, brand: brand('labeled', 'Xeno') },
        C: { title: 'three', price: 50, brand: brand('labeled', 'Yarrow') },
      },
    });
    // Xeno's cards cost 10 and 30, Yarrow's 50
    const AVERAGES = { Xeno: 20, Yarrow: 50 };
    const measuresOf = (answer: Answer, by: string) =>
      Object.fromEntries(
        (answer.meta.facets?.[by] ?? []).map((e: any) => [
          String(e.value),
          e.measure?.avg ?? null,
        ]),
      );
    test('a label in a facet measure resolves, or is refused by name', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(labeled, {
          type: labeled.Item,
          facets: [{ by: 'brand.name', measure: { avg: 'Price' } }],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /Price/, 'the label Price');
      } else {
        assert.deepEqual(measuresOf(answer!, 'brand.name'), AVERAGES);
      }
    });

    // Found while reproducing the one above: the same happens to a measure
    // on a name the type does not have. docs/search.md: "a field the type
    // does not have" is `unknown-field`.
    test('a facet measure on a field the type does not have is refused', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(labeled, {
          type: labeled.Item,
          facets: [{ by: 'brand.name', measure: { avg: 'cost' } }],
        }),
      );
      isCodedRefusal(
        assert,
        refused,
        /cost/,
        `a measure on "cost" (answered ${JSON.stringify(answer?.meta.facets)})`,
        'unknown-field',
      );
    });

    // Recorded: a quoted label through a link, "Brand.Name", resolves to a
    // field that does not exist (`brandName`), which then counts nothing.
    // docs/search.md: `Brand.Name` resolves to `brand.name`.
    test('a quoted label through a link resolves to the linked field, or is refused', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(labeled, {
          type: labeled.Item,
          facets: [{ by: '"Brand.Name"' }],
        }),
      );
      if (refused) {
        isCodedRefusal(
          assert,
          refused,
          /Brand\.Name|brandName/,
          'the quoted label',
          'unknown-field',
        );
      } else {
        assert.deepEqual(
          answer!.meta.facets,
          {
            'brand.name': [
              { value: 'Xeno', count: 2 },
              { value: 'Yarrow', count: 1 },
            ],
          },
          'counted under brand.name',
        );
      }
    });
  });

  // ==========================================================================
  module('focused cases', function () {
    // ---- labels -----------------------------------------------------------
    const named = fixture('named', {
      Brand: { x: { name: 'Xeno' } },
      Item: {
        A: {
          title: 'one',
          kind: 'lamp',
          price: 10,
          reviewCount: 7,
          brand: brand('named', 'Xeno'),
        },
        B: {
          title: 'two',
          kind: 'lamp',
          price: 30,
          reviewCount: 2,
          brand: brand('named', 'Xeno'),
        },
        C: { title: 'three', kind: 'rug', price: 20, reviewCount: 5 },
      },
    });
    test('a label in eq, range, sort and collapse gives the rows its path gives', async function (assert) {
      let both = async (
        labeledForm: Q,
        pathForm: Q,
        expected: string[],
        what: string,
      ) => {
        for (let [form, q] of [
          ['label', labeledForm],
          ['path', pathForm],
        ] as [string, Q][]) {
          assert.deepEqual(
            (await run(named, { type: named.Item, ...q })).names,
            expected,
            `${what} (${form})`,
          );
        }
      };
      let byPrice = [{ by: 'price' }];
      await both(
        { filter: { eq: { Kind: 'lamp' } }, sort: byPrice },
        { filter: { eq: { kind: 'lamp' } }, sort: byPrice },
        ['A', 'B'],
        'eq',
      );
      await both(
        { filter: { range: { Price: { gte: 20 } } }, sort: byPrice },
        { filter: { range: { price: { gte: 20 } } }, sort: byPrice },
        ['C', 'B'],
        'range',
      );
      await both(
        { sort: [{ by: 'Review Count' }] },
        { sort: [{ by: 'reviewCount' }] },
        ['B', 'C', 'A'],
        'sort, lowest first',
      );
      // the cheapest of each kind
      await both(
        { sort: byPrice, collapse: 'Kind' },
        { sort: byPrice, collapse: 'kind' },
        ['A', 'C'],
        'collapse',
      );
    });

    test('a label through a link names the facet by its path', async function (assert) {
      let answer = await run(named, {
        type: named.Item,
        facets: [{ by: 'Brand.Name' }],
      });
      assert.deepEqual(answer.meta.facets, {
        'brand.name': [{ value: 'Xeno', count: 2 }],
      });
    });

    // Recorded: quoted, "Brand.Name" read as one field, `brandName`, which
    // the type does not have.
    test('a quoted label through a link names the facet by its path', async function (assert) {
      let answer = await run(named, {
        type: named.Item,
        facets: [{ by: '"Brand.Name"' }],
      });
      assert.deepEqual(answer.meta.facets, {
        'brand.name': [{ value: 'Xeno', count: 2 }],
      });
    });

    // Recorded: a label in a facet measure was not resolved. docs/search.md:
    // a field "may be written as ... a label in any case and spacing", and a
    // measure names a field as the facet's `by` does: a label with a space is
    // quoted there (unquoted, both are refused as not a path).
    test('a label in a facet measure resolves as it does elsewhere', async function (assert) {
      let measures = async (field: string) =>
        Object.fromEntries(
          (
            await run(named, {
              type: named.Item,
              facets: [{ by: 'kind', measure: { avg: field } }],
            })
          ).meta.facets.kind.map((e: any) => [e.value, e.measure?.avg]),
        );
      let byPath = await measures('reviewCount');
      assert.deepEqual(byPath, { lamp: 4.5, rug: 5 }, 'the path');
      assert.deepEqual(await measures('"Review Count"'), byPath, 'quoted');
      assert.deepEqual(await measures('ReviewCount'), byPath, 'capitalized');
      let { refused } = await outcome(() =>
        run(named, {
          type: named.Item,
          facets: [{ by: 'kind', measure: { avg: 'ReviewTotal' } }],
        }),
      );
      isCodedRefusal(
        assert,
        refused,
        /ReviewTotal/,
        'a label the type does not have',
        'unknown-field',
      );
    });

    test('a label in select reads the column, or is refused by name', async function (assert) {
      let { answer, refused } = await outcome(() =>
        table(named, {
          type: named.Item,
          sort: [{ by: 'price' }],
          select: ['Price'],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /Price/, 'the label Price');
      } else {
        assert.deepEqual(answer!.rows, [
          ['A', 10],
          ['C', 20],
          ['B', 30],
        ]);
      }
    });

    // ---- facets -----------------------------------------------------------
    const tiers = fixture('tiers', {
      Item: {
        A: { title: 'one', price: 5 },
        B: { title: 'two', price: 15 },
        C: { title: 'three', price: 25 },
      },
    });
    test('statistics and range buckets on the same field both come back', async function (assert) {
      let { meta } = await run(tiers, {
        type: tiers.Item,
        facets: [
          { by: 'price', stats: true },
          { by: 'price', ranges: [{ to: 10 }, { from: 10 }] },
        ],
      });
      let stats = meta.facetStats?.price ?? {};
      assert.deepEqual(
        { min: stats.min, max: stats.max, avg: stats.avg, count: stats.count },
        { min: 5, max: 25, avg: 15, count: 3 },
        'the statistics',
      );
      assert.deepEqual(
        meta.facets?.price,
        [
          { value: '*-10', count: 1 },
          { value: '10-*', count: 2 },
        ],
        'the buckets',
      );
    });

    const shelves = fixture('shelves', {
      Item: {
        Da1: { title: 'one', dept: 'D', cat: 'a', price: 10 },
        Da2: { title: 'two', dept: 'D', cat: 'a', price: 15 },
        Db: { title: 'three', dept: 'D', cat: 'b', price: 30 },
        Ea: { title: 'four', dept: 'E', cat: 'a', price: 12 },
      },
    });
    test("own: 'ignore' lifts only the facet's own clause: a range", async function (assert) {
      let answer = await run(shelves, {
        type: shelves.Item,
        filter: {
          every: [{ eq: { dept: 'D' } }, { range: { price: { lt: 20 } } }],
        },
        facets: [
          {
            by: 'price',
            own: 'ignore',
            ranges: [
              { to: 20, key: 'low' },
              { from: 20, key: 'high' },
            ],
          },
        ],
      });
      assert.deepEqual(answer.names.sort(), ['Da1', 'Da2'], 'the rows');
      // department D without the price cap: the bucket above it is counted
      assert.deepEqual(facetOf(answer, 'price'), { low: 2, high: 1 });
    });

    const dated = fixture('dated', {
      Item: {
        A: { title: 'one', listedAt: '2024-12-31T23:59:00.000Z' },
        B: { title: 'two', listedAt: '2025-01-01T00:00:00.000Z' },
        C: { title: 'three', listedAt: '2025-06-01T00:00:00.000Z' },
      },
    });
    test("interval: 'year' buckets by UTC year", async function (assert) {
      let answer = await run(dated, {
        type: dated.Item,
        facets: [{ by: 'listedAt', interval: 'year' }],
      });
      let byYear = Object.fromEntries(
        (answer.meta.facets?.listedAt ?? []).map((e: any) => [
          String(e.value).slice(0, 4),
          Number(e.count),
        ]),
      );
      assert.deepEqual(byYear, { '2024': 1, '2025': 2 });
    });

    const sizes = fixture('sizes', {
      Item: {
        L1: { title: 'one', size: 'L', price: 20 },
        L2: { title: 'two', size: 'L', price: 30 },
        S1: { title: 'three', size: 'S', price: 50 },
      },
    });
    test("a facet measure of min, with order: 'value'", async function (assert) {
      let { meta } = await run(sizes, {
        type: sizes.Item,
        facets: [{ by: 'size', measure: { min: 'price' }, order: 'value' }],
      });
      assert.deepEqual(meta.facets?.size, [
        { value: 'L', count: 2, measure: { min: 20 } },
        { value: 'S', count: 1, measure: { min: 50 } },
      ]);
    });

    const paths = fixture('paths', {
      Item: {
        A: { title: 'one', path: 'F / L / Sofas', price: 10 },
        B: { title: 'two', path: 'F / L / Sofas', price: 30 },
        C: { title: 'three', path: 'F / L / Chairs', price: 20 },
        D: { title: 'four', path: 'K / Pans', price: 99 },
      },
    });
    test('a prefix facet keeps the measure of the values it keeps', async function (assert) {
      let { meta } = await run(paths, {
        type: paths.Item,
        facets: [{ by: 'path', prefix: 'F / L', measure: { avg: 'price' } }],
      });
      assert.deepEqual(meta.facets?.path, [
        { value: 'F / L / Sofas', count: 2, measure: { avg: 20 } },
        { value: 'F / L / Chairs', count: 1, measure: { avg: 20 } },
      ]);
    });
  });

  // ==========================================================================
  // What the engine does today where docs/search.md does not give the rule.
  module('pinned, rule not yet decided', function () {
    const measured = fixture('measured', {
      Item: {
        L1: { title: 'one', size: 'L', price: 20 },
        L2: { title: 'two', size: 'L', price: 30 },
        S1: { title: 'three', size: 'S', price: 50 },
      },
    });
    // docs/search.md gives `order: 'measure'` and no direction for it.
    test("order: 'measure' lists the largest measure first", async function (assert) {
      // pins current behavior; rule not yet decided
      let { meta } = await run(measured, {
        type: measured.Item,
        facets: [{ by: 'size', measure: { min: 'price' }, order: 'measure' }],
      });
      // by count or by value L would come first
      assert.deepEqual(
        (meta.facets?.size ?? []).map((e: any) => [e.value, e.measure?.min]),
        [
          ['S', 50],
          ['L', 20],
        ],
      );
    });
  });

  // ==========================================================================
  module('refusals', function () {
    const shop = fixture('shop', {
      Item: { A: { title: 'one', kind: 'k', price: 10, reviewCount: 1 } },
    });
    const byKind = { by: 'kind' };
    // [what is refused, the query, its code, what the message names]
    const REFUSED: [string, Q, string, RegExp][] = [
      [
        'a direction on a facet',
        {
          facets: [
            {
              ...byKind,
              measure: { avg: 'price' },
              order: 'measure',
              direction: 'asc',
            },
          ],
        },
        'unknown-key',
        /"direction"/,
      ],
      [
        'a facet inside a facet',
        { facets: [{ ...byKind, facets: [{ by: 'color' }] }] },
        'unknown-key',
        /"facets"/,
      ],
      [
        'levels on a facet',
        { facets: [{ by: 'path', levels: 2 }] },
        'unknown-key',
        /"levels"/,
      ],
      [
        'an expression as a filter',
        {
          filter: {
            every: [{ eq: { kind: 'k' } }, { expression: 'price > 5' }],
          },
        },
        'unknown-key',
        /"expression"/,
      ],
      [
        'a distinct-count facet measure',
        { facets: [{ ...byKind, measure: { distinct: 'color' } }] },
        'invalid-value',
        /measure/,
      ],
      [
        'a label with a space in a facet measure',
        { facets: [{ ...byKind, measure: { avg: 'Review Count' } }] },
        'invalid-value',
        /measure: "Review Count" is not a field path/,
      ],
      [
        'a label with a space in select',
        { select: ['Review Count'] },
        'invalid-value',
        /"Review Count"/,
      ],
    ];
    for (let [what, query, code, names] of REFUSED) {
      test(`${what} is ${code}`, async function (assert) {
        let { refused } = await outcome(() =>
          run(shop, { type: shop.Item, ...query }),
        );
        isCodedRefusal(assert, refused, names, what, code);
      });
    }
  });
});
