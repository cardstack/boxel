import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { Product, WARM, ask, setupShop } from './helpers/query-by-example.ts';

// ORDERING: the ways a query puts what it found in order: by a field, by a
// formula, by how well the text or a vector matches, or by several such
// signals fused into one score (docs/search.md, from Sort Order to
// Relevance). Most examples order the four lamps, so every answer can be
// checked against the table by eye.
//
// A blend scores each card as the sum, over its signals, of
// weight / (k + rank), where rank is the card's place in that signal alone
// (1 is best) and k is 60 unless the query says otherwise. The expected
// scores below are written as that sum.

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

  // --- by a field -----------------------------------------------------------

  test('orders by a field, lowest first', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ by: 'price' }],
    });
    // 25, 35, 60, 80
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
      'Brass Desk Lamp',
    ]);
  });

  test('orders by a field, highest first', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ by: 'rating', direction: 'desc' }],
    });
    // 4.8, 4.5, 4.0, 3.5
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Clamp Reading Lamp',
    ]);
  });

  test('orders by one field, then by another where the first ties', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { in: { kind: ['chair', 'sofa'] } },
      sort: [{ by: 'kind' }, { by: 'price', direction: 'desc' }],
    });
    // the chairs before the sofa; among the chairs 300, 150, 45
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Oak Dining Chair',
      'Steel Folding Chair',
      'Linen Sleeper Sofa',
    ]);
  });

  test('puts cards with no value first when asked', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'chair' } },
      sort: [{ by: 'color', missing: 'first' }, { by: 'price' }],
    });
    // the two chairs with no color (at 45 and 150), then the red one;
    // without `missing: 'first'` they would come last
    assert.deepEqual(names, [
      'Steel Folding Chair',
      'Oak Dining Chair',
      'Velvet Reading Chair',
    ]);
  });

  // --- by a formula ---------------------------------------------------------

  test('orders by a formula over the fields, highest first', async function (assert) {
    let { names, rows, meta } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ expression: 'sold * price' }],
    });
    // takings: 300 x 35, 120 x 80, 90 x 60, 40 x 25
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._expression),
      [10500, 9600, 5400, 1000],
    );
    // plain arithmetic runs in the database, over every match
    assert.strictEqual(meta.window, undefined);
  });

  test('refuses a formula the database cannot compute, such as a text function', async function (assert) {
    // every formula runs in the database: LEN is a text function, which
    // its formulas do not have, so the query is refused rather than run
    // anywhere else
    let refused = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ expression: 'LEN(name)' }],
    }).then(
      () => undefined,
      (e) => e,
    );
    let code = refused?.queryCode ?? refused?.code;
    assert.strictEqual(code, 'expression-unsupported');
  });

  test('re-orders only the top rows when asked to, with top', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ expression: 'sold * price', top: 2 }, { by: 'name' }],
    });
    // the first two by name (brass, clamp) re-ordered by takings (9600,
    // 10500), then paper and salt by name
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
    ]);
    assert.strictEqual(meta.window.rows, 2);
  });

  // --- by how well it matches -----------------------------------------------

  test('orders by how well the text matches', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'sofa' },
      sort: [{ by: 'textRelevance' }],
    });
    // "sofa" is in the sofa's name, and only in the blanket's blurb; a
    // word in a title outranks the same word in body text
    assert.deepEqual(names, ['Linen Sleeper Sofa', 'Wool Throw Blanket']);
  });

  test('orders by likeness to a vector, most alike first', async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { in: { kind: ['chair', 'sofa'] } },
      sort: [{ by: 'look', near: WARM }],
    });
    // warm, mostly warm, neutral, and last the sofa, which has no look
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Oak Dining Chair',
      'Steel Folding Chair',
      'Linen Sleeper Sofa',
    ]);
    assert.deepEqual(
      rows.map((row) => row._nearSimilarity?.toFixed(2)),
      ['1.00', '0.80', '0.00', undefined],
    );
  });

  test('orders by likeness to a vector, least alike first', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { in: { kind: ['chair', 'sofa'] } },
      sort: [{ by: 'look', near: WARM, direction: 'asc' }],
    });
    // similarity 0, 0.8, 1; a card with no vector still comes last
    assert.deepEqual(names, [
      'Steel Folding Chair',
      'Oak Dining Chair',
      'Velvet Reading Chair',
      'Linen Sleeper Sofa',
    ]);
  });

  // --- by several signals fused ---------------------------------------------

  test('orders by several signals fused into one score', async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ blend: [{ by: 'sold', weight: 1.5 }, { by: 'rating' }] }],
    });
    // by units sold the lamps rank clamp, brass, paper, salt; by rating
    // salt, brass, paper, clamp. Second in both beats first in one
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Salt Rock Lamp',
      'Paper Floor Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => sixPlaces(row._blendScore)),
      [
        sixPlaces(1.5 / 62 + 1 / 62),
        sixPlaces(1.5 / 61 + 1 / 64),
        sixPlaces(1.5 / 64 + 1 / 61),
        sixPlaces(1.5 / 63 + 1 / 63),
      ],
    );
  });

  test('names the fusion method', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          blend: [{ by: 'sold', weight: 1.5 }, { by: 'rating' }],
          method: 'rrf',
        },
      ],
    });
    // reciprocal rank fusion is the one method, so the order is the same
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Salt Rock Lamp',
      'Paper Floor Lamp',
    ]);
  });

  test('makes a top rank count for more with a smaller k', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ blend: [{ by: 'sold', weight: 1.5 }, { by: 'rating' }], k: 1 }],
    });
    // clamp 1.5/2 + 1/5 = 0.95, brass 1.5/3 + 1/3 = 0.83,
    // salt 1.5/5 + 1/2 = 0.8, paper 1.5/4 + 1/4 = 0.63: being first by
    // units sold now beats being second in both
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Brass Desk Lamp',
      'Salt Rock Lamp',
      'Paper Floor Lamp',
    ]);
  });

  test('turns a signal around with a negative weight', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ blend: [{ by: 'sold', weight: -1 }] }],
    });
    // the least sold first: 40, 90, 120, 300
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Paper Floor Lamp',
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
    ]);
  });

  test('ranks a signal lowest first', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ blend: [{ by: 'price', direction: 'asc' }] }],
    });
    // the cheapest ranks best: 25, 35, 60, 80
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
      'Brass Desk Lamp',
    ]);
  });

  test('uses a formula as one of the signals', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          blend: [{ expression: 'sold * price', weight: 2 }, { by: 'rating' }],
        },
      ],
    });
    // by takings clamp, brass, paper, salt; by rating salt, brass, paper,
    // clamp. clamp 2/61 + 1/64, brass 2/62 + 1/62, salt 2/64 + 1/61,
    // paper 2/63 + 1/63
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Brass Desk Lamp',
      'Salt Rock Lamp',
      'Paper Floor Lamp',
    ]);
  });

  test('lifts the cards that pass a test, without dropping the rest', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          blend: [
            { by: 'rating' },
            { boost: { eq: { 'brand.name': 'Lumen' } }, weight: 2 },
          ],
        },
      ],
    });
    // by rating alone: salt, brass, paper, clamp. The two Lumen lamps
    // each gain 2/61, which carries both past the salt lamp
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
    ]);
  });

  test('pushes down the cards that pass a test', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          blend: [
            { by: 'sold' },
            { boost: { eq: { inStock: false } }, weight: -1 },
          ],
        },
      ],
    });
    // by units sold alone the clamp lamp leads. It is out of stock, so
    // with a negative weight the other three each gain 1/61 and pass it
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
    ]);
  });

  // --- by the shop's own idea of relevance ----------------------------------

  test("orders by relevance: the text match and the type's declared signals", async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      filter: { matches: 'sofa' },
      sort: [{ relevance: true }],
    });
    // Product declares units sold as its popularity. Text (weight 1)
    // ranks the sofa first; popularity (weight 0.5) ranks the blanket
    // first, 200 sold against 20. The text wins
    assert.deepEqual(names, ['Linen Sleeper Sofa', 'Wool Throw Blanket']);
    assert.deepEqual(
      rows.map((row) => sixPlaces(row._blendScore)),
      [sixPlaces(1 / 61 + 0.5 / 62), sixPlaces(1 / 62 + 0.5 / 61)],
    );
  });

  test('re-weights a relevance signal by name', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'sofa' },
      sort: [{ relevance: { popularity: 2 } }],
    });
    // now popularity outweighs the text: blanket 1/62 + 2/61, sofa
    // 1/61 + 2/62
    assert.deepEqual(names, ['Wool Throw Blanket', 'Linen Sleeper Sofa']);
  });

  test('adds likeness to a vector to relevance, as its meaning signal', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { eq: { kind: 'chair' } },
      sort: [{ relevance: true, near: WARM }],
    });
    // meaning (weight 1) ranks velvet, oak, folding; popularity (0.5)
    // ranks them the other way. velvet 1/61 + 0.5/63, oak 1/62 + 0.5/62,
    // folding 1/63 + 0.5/61
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Oak Dining Chair',
      'Steel Folding Chair',
    ]);
  });
});
