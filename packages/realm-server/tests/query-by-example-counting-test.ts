import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  Product,
  ask,
  brandId,
  counts,
  setupShop,
} from './helpers/query-by-example.ts';

// COUNTING: what a query can say about everything it matched, beside the
// page of cards it returns: how many hold each value of a field, in what
// buckets, and with what totals and averages (docs/search.md, Facets). The
// counts come back in `meta.facets[by]` as { value, count } entries, most
// common first, and statistics in `meta.facetStats[by]`. Where the order is
// not the point, `counts(...)` shows a facet as { value: count }.

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

module(basename(import.meta.filename), function (hooks) {
  setupShop(hooks);

  // --- how many hold each value ---------------------------------------------

  test('counts the cards that hold each value of a field', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'kind' }],
    });
    // the kind column, counted
    assert.deepEqual(counts(meta.facets.kind), {
      lamp: 4,
      chair: 3,
      rug: 3,
      sofa: 1,
      blanket: 1,
    });
  });

  test('counts each value of a list field, and returns the most common few', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'tags', size: 4 }],
    });
    // a product counts once for each of its tags; dining and outdoor, with
    // one product each, fall outside the top four
    assert.deepEqual(meta.facets.tags, [
      { value: 'living', count: 5 },
      { value: 'bedroom', count: 4 },
      { value: 'gift', count: 3 },
      { value: 'office', count: 2 },
    ]);
  });

  test('counts by a field of the linked card', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'brand.name' }],
    });
    // the salt lamp has no brand, so it is in no count
    assert.deepEqual(counts(meta.facets['brand.name']), {
      Hearth: 3,
      Oakline: 3,
      Tidewater: 3,
      Lumen: 2,
    });
  });

  test("counts by a link, each value labeled with the linked card's title", async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'brand' }],
    });
    // the value is the brand card's id, and its title rides along as the
    // label
    let lumen = meta.facets.brand.find((f: any) => f.label === 'Lumen');
    assert.deepEqual(lumen, {
      value: brandId('Lumen'),
      label: 'Lumen',
      count: 2,
    });
  });

  test('counts only the values that start with some text', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'material', prefix: 'S' }],
    });
    // steel (a lamp and a chair) and salt start with "s", whatever the
    // case
    assert.deepEqual(meta.facets.material, [
      { value: 'steel', count: 2 },
      { value: 'salt', count: 1 },
    ]);
  });

  test('lists the values in their own order rather than by count', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'color', order: 'value' }],
    });
    // A to Z
    assert.deepEqual(meta.facets.color, [
      { value: 'blue', count: 3 },
      { value: 'brown', count: 1 },
      { value: 'gold', count: 1 },
      { value: 'orange', count: 1 },
      { value: 'red', count: 2 },
      { value: 'white', count: 2 },
    ]);
  });

  test('counts each color, ignoring the color already picked', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      filter: { eq: { color: 'red' } },
      facets: [{ by: 'color', own: 'ignore' }],
    });
    // the cards are the red ones, but the color list still offers every
    // color, so a shopper can pick another
    assert.deepEqual(names, ['Velvet Reading Chair', 'Wool Area Rug']);
    assert.deepEqual(counts(meta.facets.color), {
      blue: 3,
      red: 2,
      white: 2,
      brown: 1,
      gold: 1,
      orange: 1,
    });
  });

  test('says how many cards have no value', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'color', missing: true }],
    });
    // the two chairs with no color
    assert.strictEqual(meta.facetStats.color.missing, 2);
  });

  // --- numbers and dates ----------------------------------------------------

  test('counts the cards in each range of a number', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [
        {
          by: 'price',
          ranges: [
            { to: 50 },
            { from: 50, to: 200 },
            { from: 200, key: 'premium' },
          ],
        },
      ],
    });
    // under 50: 25, 35, 45. From 50 up to, not including, 200: six. The
    // rug at exactly 200 is premium, with the 300 and the 900. A range
    // with no key is labeled from-to, "*" for an open end
    assert.deepEqual(counts(meta.facets.price), {
      '*-50': 3,
      '50-200': 6,
      premium: 3,
    });
  });

  test('gives the statistics of a number', async function (assert) {
    let { meta } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      facets: [{ by: 'price', stats: true }],
    });
    // the lamps cost 80, 60, 35 and 25
    let { count, min, max, sum, avg } = meta.facetStats.price;
    assert.deepEqual(
      { count, min, max, sum, avg },
      { count: 4, min: 25, max: 80, sum: 200, avg: 50 },
    );
  });

  test('counts the cards in each month of a date', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'listed', interval: 'month' }],
    });
    // listed in January, February and March 2026; each month is labeled
    // by its first day. `week` and `year` read the same way
    assert.deepEqual(counts(meta.facets.listed), {
      '2026-01-01': 4,
      '2026-02-01': 5,
      '2026-03-01': 3,
    });
  });

  test('counts the cards on each day of a date', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'listed', interval: 'day' }],
    });
    // the listed column, counted
    assert.deepEqual(counts(meta.facets.listed), {
      '2026-01-05': 2,
      '2026-01-20': 2,
      '2026-02-03': 3,
      '2026-02-14': 2,
      '2026-03-09': 2,
      '2026-03-21': 1,
    });
  });

  // --- a number about each value --------------------------------------------

  test('gives the average of another field for each value', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'brand.name', measure: { avg: 'price' } }],
    });
    // Lumen (80 + 60) / 2, Oakline (150 + 300 + 900) / 3,
    // Hearth (200 + 90 + 55) / 3, Tidewater (35 + 45 + 100) / 3
    assert.deepEqual(
      Object.fromEntries(
        meta.facets['brand.name'].map((f: any) => [f.value, f.measure]),
      ),
      {
        Lumen: { avg: 70 },
        Oakline: { avg: 450 },
        Hearth: { avg: 115 },
        Tidewater: { avg: 60 },
      },
    );
  });

  test('gives the largest of another field for each value', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [{ by: 'brand.name', measure: { max: 'price' } }],
    });
    // each brand's dearest product; `min` and `sum` read the same way
    assert.deepEqual(
      Object.fromEntries(
        meta.facets['brand.name'].map((f: any) => [f.value, f.measure]),
      ),
      {
        Lumen: { max: 80 },
        Oakline: { max: 900 },
        Hearth: { max: 200 },
        Tidewater: { max: 100 },
      },
    );
  });

  test('lists the values by that number rather than by count', async function (assert) {
    let { meta } = await ask({
      type: Product,
      facets: [
        { by: 'brand.name', measure: { avg: 'price' }, order: 'measure' },
      ],
    });
    // average prices 450, 115, 70, 60: the largest first, as counts are
    // (docs/search.md does not say which way; this reads it as it reads
    // "most common first")
    assert.deepEqual(
      meta.facets['brand.name'].map((f: any) => f.value),
      ['Oakline', 'Hearth', 'Lumen', 'Tidewater'],
    );
  });

  // --- the numbers alone ----------------------------------------------------

  test('answers with the counts alone when the page has no rows', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      filter: { eq: { inStock: true } },
      facets: [{ by: 'kind' }],
      page: { size: 0 },
    });
    // eight products are in stock; none is returned, all are counted
    assert.deepEqual(names, []);
    assert.strictEqual(meta.page.total, 8);
    assert.deepEqual(counts(meta.facets.kind), {
      lamp: 3,
      chair: 2,
      rug: 1,
      sofa: 1,
      blanket: 1,
    });
  });
});
