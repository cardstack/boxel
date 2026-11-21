import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  Product,
  WARM,
  WishList,
  ask,
  productId,
  setupShop,
  wishListId,
} from './helpers/query-by-example.ts';

// NARROWING: the ways a query keeps only the cards with certain values:
// equal to, one of, between, present or absent, and the `every`, `any` and
// `not` that combine them (docs/search.md, Filters). One rule to remember
// while reading: a card with no value in a field is found by neither a test
// of that field nor its `not`; ask for it with `missing` or `eq: null`.

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

  // --- one value ------------------------------------------------------------

  test('keeps cards whose field equals a value', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'rug' } },
    });
    // the three rugs
    assert.deepEqual(names, [
      'Jute Hallway Rug',
      'Striped Outdoor Rug',
      'Wool Area Rug',
    ]);
  });

  test('keeps cards whose yes-or-no field says no', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { inStock: false } },
    });
    // the three marked out of stock; the jute rug says neither yes nor no
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Striped Outdoor Rug',
      'Velvet Reading Chair',
    ]);
  });

  test('keeps cards by a field of the card they link to', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { 'brand.name': 'Lumen' } },
    });
    // the two products whose brand is the card named Lumen
    assert.deepEqual(names, ['Brass Desk Lamp', 'Paper Floor Lamp']);
  });

  test('keeps cards whose field is one of a list of values', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { in: { kind: ['sofa', 'blanket'] } },
    });
    // the one sofa and the one blanket
    assert.deepEqual(names, ['Linen Sleeper Sofa', 'Wool Throw Blanket']);
  });

  test('accepts a field written as its label', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { 'Brand.Name': 'Lumen' } },
    });
    // Brand.Name is read as brand.name
    assert.deepEqual(names, ['Brass Desk Lamp', 'Paper Floor Lamp']);
  });

  // --- a range --------------------------------------------------------------

  test('keeps cards between two bounds, the bounds included', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { range: { price: { gte: 60, lte: 90 } } },
    });
    // priced 80, 90 and 60; the next prices out are 55 and 100
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Jute Hallway Rug',
      'Paper Floor Lamp',
    ]);
  });

  test('keeps cards strictly between two bounds', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { range: { price: { gt: 60, lt: 90 } } },
    });
    // 80 only: the 60 and the 90 sit on the bounds
    assert.deepEqual(names, ['Brass Desk Lamp']);
  });

  test('keeps cards inside the ranges of two fields at once', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { range: { price: { lte: 60 }, rating: { gte: 4.3 } } },
    });
    // five cost 60 or less; of those only these two are rated 4.3 or more
    // (4.8 and 4.3)
    assert.deepEqual(names, ['Salt Rock Lamp', 'Wool Throw Blanket']);
  });

  test('keeps cards dated since a moment relative to now', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { range: { restocked: { gte: 'now-30d/d' } } },
    });
    // restocked 3 and 10 days ago; the clamp lamp was 45 days ago
    assert.deepEqual(names, ['Brass Desk Lamp', 'Wool Throw Blanket']);
  });

  // --- a value, or none -----------------------------------------------------

  test('keeps cards that have a value in a field', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { exists: 'restocked' },
    });
    // the three that were ever restocked
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Wool Throw Blanket',
    ]);
  });

  test('keeps cards that have no value in a field', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { missing: 'color' },
    });
    // the two chairs with no color
    assert.deepEqual(names, ['Oak Dining Chair', 'Steel Folding Chair']);
  });

  test('keeps cards whose field equals nothing', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { 'brand.name': null } },
    });
    // the one product that links to no brand
    assert.deepEqual(names, ['Salt Rock Lamp']);
  });

  // --- combining ------------------------------------------------------------

  test('keeps cards that pass every one of several tests', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: {
        every: [{ eq: { kind: 'rug' } }, { range: { price: { lte: 100 } } }],
      },
    });
    // the rugs at 90 and 100; the wool rug costs 200
    assert.deepEqual(names, ['Jute Hallway Rug', 'Striped Outdoor Rug']);
  });

  test('keeps cards that pass any one of several tests', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: {
        any: [{ eq: { kind: 'sofa' } }, { matches: 'sofa' }],
      },
    });
    // the sofa by its kind; the blanket because its blurb says "for the
    // sofa"
    assert.deepEqual(names, ['Linen Sleeper Sofa', 'Wool Throw Blanket']);
  });

  test('keeps cards that fail a test', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { not: { eq: { color: 'blue' } } },
    });
    // every product with a color other than blue. The two chairs with no
    // color are not here: a card with no value passes neither a test nor
    // its `not`
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Jute Hallway Rug',
      'Linen Sleeper Sofa',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
      'Velvet Reading Chair',
      'Wool Area Rug',
    ]);
  });

  test('keeps cards whose field is none of a list of values', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { not: { in: { kind: ['lamp', 'chair', 'rug'] } } },
    });
    // what is left: the sofa and the blanket
    assert.deepEqual(names, ['Linen Sleeper Sofa', 'Wool Throw Blanket']);
  });

  test('keeps cards another card does not link to', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: {
        every: [
          { eq: { kind: 'lamp' } },
          { not: { linkedFrom: { card: wishListId('ada'), field: 'items' } } },
        ],
      },
    });
    // four lamps; the brass and salt lamps are on Ada's wish list
    assert.deepEqual(names, ['Clamp Reading Lamp', 'Paper Floor Lamp']);
  });

  test('keeps cards whose vector is not close to a target', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { not: { near: { look: { to: WARM, minSimilarity: 0.5 } } } },
    });
    // the cool and neutral looks (similarity 0 to warm), and the sofa,
    // which has no look and so is not close to anything. Everything else
    // is at 0.6 or more
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Linen Sleeper Sofa',
      'Paper Floor Lamp',
      'Steel Folding Chair',
      'Striped Outdoor Rug',
    ]);
  });

  // --- a field that holds a list --------------------------------------------

  test('keeps cards whose list holds a value', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { tags: 'gift' } },
    });
    // the three tagged gift, whatever else they are tagged
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Salt Rock Lamp',
      'Wool Throw Blanket',
    ]);
  });

  test('keeps cards whose list does not hold a value', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { not: { eq: { tags: 'living' } } },
    });
    // the seven with no living tag, the folding chair with no tags at all
    // among them
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Oak Dining Chair',
      'Salt Rock Lamp',
      'Steel Folding Chair',
      'Striped Outdoor Rug',
      'Wool Throw Blanket',
    ]);
  });

  test('keeps cards whose list holds both of two values', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: {
        every: [{ eq: { tags: 'gift' } }, { eq: { tags: 'bedroom' } }],
      },
    });
    // three are tagged gift and four bedroom; one is tagged both
    assert.deepEqual(names, ['Wool Throw Blanket']);
  });

  test('keeps the cards that link to a given card', async function (assert) {
    let { names } = await ask({
      type: WishList,
      filter: { eq: { 'items.id': productId('throw') } },
    });
    // the reverse of a link is a query: both wish lists hold the blanket
    assert.deepEqual(names, ["Ada's wish list", "Ben's wish list"]);
  });
});
