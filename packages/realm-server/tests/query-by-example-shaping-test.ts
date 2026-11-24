import QUnit from 'qunit';
import { hasWarning } from '@cardstack/runtime-common';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  Product,
  ask,
  productId,
  setupShop,
  wishListId,
} from './helpers/query-by-example.ts';

// PAGING AND SHAPING THE ANSWER: what a query does with the cards once they
// are found and ordered. It can take them a page at a time, keep the best
// of each group, answer with a table of values instead of cards, explain a
// ranking, or re-order the top rows by a formula that compares each row with
// a set of others (docs/search.md: Pagination, `collapse`, `select`,
// `explain`, an expression sort entry's window (`top`), and Result kinds and
// `scope`).

// THE SHOP (defined once, in helpers/query-by-example.ts)
//
// Twelve products. A dash means the product has no value there.
//
// name                  kind     brand      price  rating  sold  inStock  color   material  tags             sku      listed  look
// --------------------  -------  ---------  -----  ------  ----  -------  ------  --------  ---------------  -------  ------  -------------
// Brass Desk Lamp       lamp     Lumen         80     4.5   120  yes      gold    brass     office, gift     LMP-100  Jan 5   warm
// Paper Floor Lamp      lamp     Lumen         60     4.0    90  yes      white   paper     living           LMP-200  Jan 20  neutral
// Clamp Reading Lamp    lamp     Tidewater     35     3.5   300  no       blue    steel     office, bedroom  LMP-300  Feb 3   cool
// Salt Rock Lamp        lamp     -             25     4.8    40  yes      orange  salt      gift             LMP-40X  Feb 14  [0.8, 0.6, 0]
// Oak Dining Chair      chair    Oakline      150     4.6    70  yes      -       oak       dining           CHR-100  Jan 5   [0.8, 0, 0.6]
// Velvet Reading Chair  chair    Oakline      300     4.9    30  no       red     velvet    living, bedroom  CHR-200  Mar 9   warm
// Steel Folding Chair   chair    Tidewater     45     3.0   500  yes      -       steel     -                CHR-300  Feb 3   neutral
// Wool Area Rug         rug      Hearth       200     4.2    60  yes      red     wool      living           RUG-100  Jan 20  [0.8, 0.6, 0]
// Jute Hallway Rug      rug      Hearth        90     3.8    80  -        brown   jute      living           RUG-200  Mar 21  [0.6, 0, 0.8]
// Striped Outdoor Rug   rug      Tidewater    100     4.1   150  no       blue    plastic   outdoor          RUG-12B  Feb 14  cool
// Linen Sleeper Sofa    sofa     Oakline      900     4.4    20  yes      white   linen     living, bedroom  SOF-100  Mar 9   -
// Wool Throw Blanket    blanket  Hearth        55     4.3   200  yes      blue    wool      gift, bedroom    BLK-100  Feb 3   [0.6, 0.8, 0]
//
// look       a vector of three numbers: warm colors are [1, 0, 0], cool colors
//            [0, 1, 0], neutral ones [0, 0, 1]; the rest lie between two of them.
// listed     a date in 2026.
// brand      a link to a Brand card: Oakline (founded 1975), Lumen (1998),
//            Hearth (2011), Tidewater (2019).
// restocked  Brass Desk Lamp 3 days ago, Wool Throw Blanket 10 days ago, Clamp
//            Reading Lamp 45 days ago; the rest never.
// reviews    Brass Desk Lamp: "Heavy base, never tips over." and "The switch is
//            stiff at first." Steel Folding Chair: "Wobbles on a tiled floor."
//
// Each product's text is its name and its blurb:
//   Brass Desk Lamp       A weighted brass lamp for late-night reading at a desk.
//   Paper Floor Lamp      A tall paper shade on a solid oak tripod.
//   Clamp Reading Lamp    Clamps to a shelf or a headboard.
//   Salt Rock Lamp        Carved from pink salt; glows a warm amber.
//   Oak Dining Chair      Oak, solid build, with a woven seat.
//   Velvet Reading Chair  A deep velvet armchair for long evenings with a book.
//   Steel Folding Chair   Folds flat; stacks six to a closet.
//   Wool Area Rug         Hand-tufted wool in a deep red; soft underfoot.
//   Jute Hallway Rug      Braided jute that hides hallway dirt.
//   Striped Outdoor Rug   Woven from recycled plastic; hose it clean.
//   Linen Sleeper Sofa    A linen sofa that unfolds into a guest bed.
//   Wool Throw Blanket    A woven wool throw for the sofa or the foot of a bed.
//
// Two wish lists link to products:
//   Ada's  Brass Desk Lamp, Salt Rock Lamp, Velvet Reading Chair, Wool Throw Blanket
//   Ben's  Clamp Reading Lamp, Wool Throw Blanket
// One file: wool-care.md, "How to wash wool: cold water, and dry it flat."
//
// ask(query) runs a query as the realm's search does and answers
// { names, rows, meta }: the names of the cards found, in the query's order,
// or A to Z when the query names no sort.

const sixPlaces = (n: number | undefined) => n?.toFixed(6);

module(basename(import.meta.filename), function (hooks) {
  setupShop(hooks);

  // --- a page at a time -----------------------------------------------------
  // By price the twelve products run: Salt Rock Lamp 25, Clamp Reading Lamp
  // 35, Steel Folding Chair 45, Wool Throw Blanket 55, Paper Floor Lamp 60,
  // Brass Desk Lamp 80, Jute Hallway Rug 90, Striped Outdoor Rug 100, Oak
  // Dining Chair 150, Wool Area Rug 200, Velvet Reading Chair 300, Linen
  // Sleeper Sofa 900.

  test('returns the first page, and says how many there are in all', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      sort: [{ by: 'price' }],
      page: { size: 3 },
    });
    // the three cheapest of twelve
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Steel Folding Chair',
    ]);
    assert.strictEqual(meta.page.total, 12);
    assert.true(meta.page.hasMore);
  });

  test('returns a later page', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      sort: [{ by: 'price' }],
      page: { size: 5, number: 2 },
    });
    // pages count from 0, so this is rows 11 and 12, and the last page
    assert.deepEqual(names, ['Velvet Reading Chair', 'Linen Sleeper Sofa']);
    assert.false(meta.page.hasMore);
  });

  test('counts every match when asked for an exact total', async function (assert) {
    let { meta } = await ask({
      type: Product,
      sort: [{ by: 'price' }],
      page: { size: 3, total: 'exact' },
    });
    assert.strictEqual(meta.page.total, 12);
    assert.notOk(hasWarning(meta, 'total-estimated'));
    assert.true(meta.page.hasMore);
  });

  test('counts up to a cap unless told otherwise', async function (assert) {
    let { meta } = await ask({
      type: Product,
      sort: [{ by: 'price' }],
      page: { size: 3, total: 'capped' },
    });
    // `capped` is the default. The count stops at 1,000; twelve is under
    // it, so the total is exact and not marked as an estimate
    assert.strictEqual(meta.page.total, 12);
    assert.notOk(hasWarning(meta, 'total-estimated'));
    assert.true(meta.page.hasMore);
  });

  test('skips the count, and still says whether there is more', async function (assert) {
    let { meta } = await ask({
      type: Product,
      sort: [{ by: 'price' }],
      page: { size: 3, total: 'none' },
    });
    // nothing is counted, so the total is only a lower bound, and marked
    // as one
    assert.true(meta.page.hasMore);
    assert.true(hasWarning(meta, 'total-estimated'));
    // decided: the total is the rows up to and on this page, the three on
    // it; hasMore says that more follow
    assert.strictEqual(meta.page.total, 3);
  });

  test('counts the last page exactly, whatever was asked', async function (assert) {
    let { meta } = await ask({
      type: Product,
      sort: [{ by: 'price' }],
      page: { size: 5, number: 2, total: 'none' },
    });
    // a page with no next page knows the total: ten before it, two on it
    assert.false(meta.page.hasMore);
    assert.strictEqual(meta.page.total, 12);
  });

  // --- the best of each group -----------------------------------------------

  test('keeps the best card of each group', async function (assert) {
    let { names, rows, meta } = await ask({
      type: Product,
      sort: [{ by: 'rating', direction: 'desc' }],
      collapse: 'kind',
    });
    // the top-rated chair (4.9), lamp (4.8), sofa (4.4), blanket (4.3) and
    // rug (4.2), each saying how many matches its kind holds
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Salt Rock Lamp',
      'Linen Sleeper Sofa',
      'Wool Throw Blanket',
      'Wool Area Rug',
    ]);
    assert.deepEqual(
      rows.map((row) => row._collapseSize),
      [3, 4, 1, 1, 3],
    );
    assert.strictEqual(meta.page.total, 5);
  });

  test('keeps the best few cards of each group', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { in: { kind: ['chair', 'rug'] } },
      sort: [{ by: 'rating', direction: 'desc' }],
      collapse: { by: 'kind', keep: 2 },
    });
    // two chairs (4.9, 4.6) and two rugs (4.2, 4.1); the third of each
    // kind is left out
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Oak Dining Chair',
      'Wool Area Rug',
      'Striped Outdoor Rug',
    ]);
  });

  test('treats a card with no value to group by as a group of its own', async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ by: 'rating', direction: 'desc' }],
      collapse: 'brand.name',
    });
    // the salt lamp has no brand; Lumen's best lamp stands for two;
    // Tidewater has one
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._collapseSize),
      [1, 2, 1],
    );
  });

  test('names the type to group by when the query names none', async function (assert) {
    let { names } = await ask({
      filter: { linkedFrom: { card: wishListId('ada'), field: 'items' } },
      sort: [{ by: 'rating', on: Product, direction: 'desc' }],
      collapse: { by: 'kind', on: Product },
    });
    // Ada's list holds two lamps, a chair and a blanket; the better-rated
    // lamp (4.8) stands for both
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Salt Rock Lamp',
      'Wool Throw Blanket',
    ]);
  });

  // --- a table instead of cards ---------------------------------------------

  test('answers with a table of values', async function (assert) {
    let { columns, table } = await ask({
      type: Product,
      filter: { eq: { kind: 'blanket' } },
      select: ['name', 'price', 'tags'],
    });
    // one row for the one blanket; the id always comes first, and a list
    // field reads as a list
    assert.deepEqual(columns, ['id', 'name', 'price', 'tags']);
    assert.deepEqual(table, [
      [productId('throw'), 'Wool Throw Blanket', 55, ['gift', 'bedroom']],
    ]);
  });

  test('renames a column, and reads it through a link', async function (assert) {
    let { columns, table } = await ask({
      type: Product,
      filter: { eq: { kind: 'rug' } },
      sort: [{ by: 'price' }],
      select: ['name', { maker: 'brand.name' }],
    });
    // the rugs by price, each with its brand's name under "maker"
    assert.deepEqual(columns, ['id', 'name', 'maker']);
    assert.deepEqual(
      table?.map((row) => row.slice(1)),
      [
        ['Jute Hallway Rug', 'Hearth'],
        ['Striped Outdoor Rug', 'Tidewater'],
        ['Wool Area Rug', 'Hearth'],
      ],
    );
  });

  test('puts a score the query computed in a column', async function (assert) {
    let { table } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ blend: [{ by: 'sold', weight: 1.5 }, { by: 'rating' }] }],
      select: ['name', '_blendScore'],
    });
    // the blend from the ordering file: second by units sold and second
    // by rating comes first
    assert.deepEqual(
      table?.map((row) => [row[1], sixPlaces(row[2] as number)]),
      [
        ['Brass Desk Lamp', sixPlaces(1.5 / 62 + 1 / 62)],
        ['Clamp Reading Lamp', sixPlaces(1.5 / 61 + 1 / 64)],
        ['Salt Rock Lamp', sixPlaces(1.5 / 64 + 1 / 61)],
        ['Paper Floor Lamp', sixPlaces(1.5 / 63 + 1 / 63)],
      ],
    );
  });

  // --- why a card ranks where it does ---------------------------------------

  test('explains each result by its rank and share in every signal', async function (assert) {
    let { rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ blend: [{ by: 'sold', weight: 1.5 }, { by: 'rating' }] }],
      explain: true,
    });
    // the brass lamp comes first: second by units sold, second by rating
    let { name, _explain: why } = rows[0];
    assert.strictEqual(name, 'Brass Desk Lamp');
    assert.deepEqual(
      why?.signals.map((s) => [s.signal, s.rank, sixPlaces(s.contribution)]),
      [
        ['sold', 2, sixPlaces(1.5 / 62)],
        ['rating', 2, sixPlaces(1 / 62)],
      ],
    );
    assert.strictEqual(why?.k, 60);
    assert.strictEqual(sixPlaces(why?.score), sixPlaces(1.5 / 62 + 1 / 62));
  });

  // --- re-ordering the top rows ---------------------------------------------

  test('re-orders the top rows by a formula', async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        { expression: 'sold', top: 3 },
        { by: 'rating', direction: 'desc' },
      ],
    });
    // the three best-rated lamps (salt, brass, paper) re-ordered by units
    // sold: 120, 90, 40. The fourth is past the window and keeps its place
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._window),
      [120, 90, 40, undefined],
    );
  });

  test("re-orders by a formula over the statistics of each row's group", async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { in: { kind: ['chair', 'rug'] } },
      sort: [
        { expression: 'price - stats.price.avg', compare: { by: 'kind' } },
        { by: 'name' },
      ],
    });
    // how far each is above the average of its own kind: chairs average
    // (150 + 300 + 45) / 3 = 165, rugs (200 + 90 + 100) / 3 = 130
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Wool Area Rug',
      'Oak Dining Chair',
      'Striped Outdoor Rug',
      'Jute Hallway Rug',
      'Steel Folding Chair',
    ]);
    assert.deepEqual(
      rows.map((row) => row._window),
      [135, 70, -15, -30, -40, -120],
    );
  });

  test("re-orders by a formula over the values of each row's group", async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          expression: 'PERCENTRANK_INC(peers.rating, rating)',
          compare: { by: 'kind' },
        },
        { by: 'name' },
      ],
    });
    // where each lamp's rating falls among the lamps' ratings (3.5, 4.0,
    // 4.5, 4.8): the best is at 1 and the worst at 0
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Clamp Reading Lamp',
    ]);
    assert.strictEqual(rows[0]._window, 1);
    assert.strictEqual(rows[3]._window, 0);
  });

  test('re-orders by a formula over a wider set than the query found', async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          expression: 'stats.price.max - price',
          // the comparison set names its own type: docs/search.md lists
          // the filter, the sorts and the collapse as inheriting `type`,
          // not this
          compare: { filter: { on: Product, eq: { inStock: true } } },
        },
        { by: 'name' },
      ],
    });
    // how far each lamp is below the dearest product in stock, the sofa
    // at 900, which is no lamp: 900 less 25, 35, 60 and 80
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
      'Brass Desk Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._window),
      [875, 865, 840, 820],
    );
  });

  test("re-orders by a formula over each row's look-alikes", async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          expression: 'stats.price.avg - price',
          compare: { near: 'look', k: 5, minSimilarity: 0.99 },
        },
        { by: 'name' },
      ],
    });
    // each lamp has one product with the very same look, anywhere in the
    // shop: brass the velvet chair (300), salt the wool rug (200), clamp
    // the striped rug (100), paper the folding chair (45). This is how
    // much cheaper each lamp is than its twin
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._window),
      [220, 175, 65, -15],
    );
  });

  // --- cards, files, or both ------------------------------------------------

  test('searches files instead of cards', async function (assert) {
    let { names } = await ask({
      filter: { matches: 'wool' },
      scope: 'files',
    });
    // the realm's one file is about washing wool. `scope: 'cards'` would
    // find the two wool products instead, and 'all', the default, all three
    assert.deepEqual(names, ['wool-care.md']);
  });
});
