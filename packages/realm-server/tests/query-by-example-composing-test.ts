import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  Brand,
  Product,
  WishList,
  ask,
  setupShop,
  wishListId,
} from './helpers/query-by-example.ts';

// COMPOSING: a query can compute something first and use it in the rest:
// one card whose values stand in wherever a value goes, or a list of values
// for an `in` (docs/search.md, `let`). The file ends with a second card type
// as the subject, and with the older spelling that saved queries use.
//
// Three parts of the language are left to their own files: searching a log
// (log-query-integration-test.ts), searching several realms at once
// (federated-merge-test.ts, cross-realm-search-cases-test.ts) and what a
// realm policy does to a search (policy-query-scope-test.ts,
// realm-policy-search-scope-test.ts).

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

  // --- one card, computed first ---------------------------------------------

  test("compares with one card's value", async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      let: {
        $ref: {
          from: { type: Product, filter: { eq: { sku: 'LMP-200' } } },
          one: true,
        },
      },
      filter: { range: { price: { lt: '$ref.price' } } },
    });
    // LMP-200 is the paper lamp, at 60; four products cost less
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Salt Rock Lamp',
      'Steel Folding Chair',
      'Wool Throw Blanket',
    ]);
    assert.deepEqual(meta.lets.$ref, { strategy: 'card', found: true });
  });

  test("orders by likeness to one card's vector", async function (assert) {
    let { names } = await ask({
      type: Product,
      let: {
        $ref: {
          from: { type: Product, filter: { eq: { sku: 'LMP-100' } } },
          one: true,
        },
      },
      filter: { eq: { kind: 'chair' } },
      sort: [{ by: 'look', near: '$ref.look' }],
    });
    // LMP-100 is the brass lamp, whose look is warm: the chairs most like
    // it are the warm one, the mostly warm one, then the neutral one
    assert.deepEqual(names, [
      'Velvet Reading Chair',
      'Oak Dining Chair',
      'Steel Folding Chair',
    ]);
  });

  test("uses one card's values in a re-ranking formula", async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      let: {
        $ref: {
          from: { type: Product, filter: { eq: { sku: 'LMP-200' } } },
          one: true,
        },
      },
      filter: { eq: { kind: 'lamp' } },
      sort: [{ expression: '$ref.price - price', top: 100 }, { by: 'name' }],
    });
    // how much each lamp saves against the paper lamp's 60
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
      'Brass Desk Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._window),
      [35, 25, 0, -20],
    );
  });

  test('takes the first card of a sort as the one card', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: {
        $top: {
          from: {
            type: Product,
            sort: [{ by: 'sold', direction: 'desc' }],
          },
          one: true,
        },
      },
      filter: { eq: { kind: '$top.kind' } },
    });
    // the best seller is the folding chair (500 sold), so: every chair
    assert.deepEqual(names, [
      'Oak Dining Chair',
      'Steel Folding Chair',
      'Velvet Reading Chair',
    ]);
  });

  // --- a list, computed first -----------------------------------------------

  test('keeps cards whose field is in a list computed first', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      let: {
        $loved: {
          from: {
            type: Product,
            filter: { range: { rating: { gte: 4.9 } } },
          },
          select: 'brand.name',
        },
      },
      filter: { in: { 'brand.name': '$loved' } },
    });
    // only the velvet chair is rated 4.9, and it is by Oakline: so,
    // everything by Oakline
    assert.deepEqual(names, [
      'Linen Sleeper Sofa',
      'Oak Dining Chair',
      'Velvet Reading Chair',
    ]);
    assert.deepEqual(meta.lets.$loved, { strategy: 'list', values: 1 });
  });

  test('computes the list from cards of another type', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      let: {
        $bens: {
          from: { type: WishList, filter: { eq: { owner: 'Ben' } } },
          select: 'items.id',
        },
      },
      filter: { in: { id: '$bens' } },
    });
    // the ids on Ben's wish list
    assert.deepEqual(names, ['Clamp Reading Lamp', 'Wool Throw Blanket']);
    assert.deepEqual(meta.lets.$bens, { strategy: 'list', values: 2 });
  });

  test("reads one card's links in the same statement", async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      let: {
        $saved: {
          from: {
            type: WishList,
            filter: { eq: { id: wishListId('ada') } },
          },
          select: 'items.id',
        },
      },
      filter: { in: { id: '$saved' } },
    });
    // a list card named by its id, read for its links: the same answer as
    // `linkedFrom`, and the engine joins rather than fetching a list
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Salt Rock Lamp',
      'Velvet Reading Chair',
      'Wool Throw Blanket',
    ]);
    assert.deepEqual(meta.lets.$saved, { strategy: 'join' });
  });

  test('computes the list from the first few rows of a sort', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      let: {
        $dearest: {
          from: {
            type: Product,
            sort: [{ by: 'price', direction: 'desc' }],
            page: { size: 2 },
          },
          select: 'color',
        },
      },
      filter: { in: { color: '$dearest' } },
    });
    // the two dearest products are white (the sofa) and red (the velvet
    // chair): so, everything white or red
    assert.deepEqual(names, [
      'Linen Sleeper Sofa',
      'Paper Floor Lamp',
      'Velvet Reading Chair',
      'Wool Area Rug',
    ]);
    assert.deepEqual(meta.lets.$dearest, { strategy: 'list', values: 2 });
  });

  test('lifts the cards in a list computed first', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: {
        $bens: {
          from: { type: WishList, filter: { eq: { owner: 'Ben' } } },
          select: 'items.id',
        },
      },
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          blend: [
            { by: 'rating' },
            { boost: { in: { id: '$bens' } }, weight: 2 },
          ],
        },
      ],
    });
    // by rating the clamp lamp is last of the four; it is on Ben's list,
    // and the lift (2/61) carries it to the top
    assert.deepEqual(names, [
      'Clamp Reading Lamp',
      'Salt Rock Lamp',
      'Brass Desk Lamp',
      'Paper Floor Lamp',
    ]);
  });

  test('compares each row with the cards in a list computed first', async function (assert) {
    let { names, rows } = await ask({
      type: Product,
      let: {
        $adas: {
          from: { type: WishList, filter: { eq: { owner: 'Ada' } } },
          select: 'items.id',
        },
      },
      filter: { eq: { kind: 'lamp' } },
      sort: [
        {
          expression: 'stats.price.max - price',
          compare: { filter: { in: { id: '$adas' } } },
        },
        { by: 'name' },
      ],
    });
    // the dearest thing on Ada's list is the velvet chair at 300; each
    // lamp by how far below that it is
    assert.deepEqual(names, [
      'Salt Rock Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
      'Brass Desk Lamp',
    ]);
    assert.deepEqual(
      rows.map((row) => row._window),
      [275, 265, 240, 220],
    );
  });

  // --- one binding syntax: "$name" strings, $literal --------------------------

  // A binding is declared with its $ and read as a string: a reference only
  // when its name is declared, so any other "$…" text is text. Each test
  // keeps the four lamps unless the string is read as a reference.
  let lamps = [
    'Brass Desk Lamp',
    'Clamp Reading Lamp',
    'Paper Floor Lamp',
    'Salt Rock Lamp',
  ];
  let paperLamp = {
    $ref: {
      from: { type: Product, filter: { eq: { sku: 'LMP-200' } } },
      one: true,
    },
  };

  test('a declared "$name.path" reads the binding', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: paperLamp,
      filter: {
        every: [{ eq: { kind: 'lamp' } }, { not: { eq: { sku: '$ref.sku' } } }],
      },
    });
    assert.deepEqual(
      names,
      lamps.filter((n) => n !== 'Paper Floor Lamp'),
      'every lamp but the paper one, whose sku the binding read',
    );
  });

  test('a "$name.path" whose name no binding declares is text', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: paperLamp,
      filter: {
        every: [{ eq: { kind: 'lamp' } }, { not: { eq: { sku: '$x.sku' } } }],
      },
    });
    assert.deepEqual(names, lamps, 'no sku is the text "$x.sku"');
  });

  test('"$100" is text', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: paperLamp,
      filter: {
        every: [{ eq: { kind: 'lamp' } }, { not: { eq: { sku: '$100' } } }],
      },
    });
    assert.deepEqual(names, lamps);
  });

  test('$literal is the text as written, even when it names a binding', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: paperLamp,
      filter: {
        every: [
          { eq: { kind: 'lamp' } },
          { not: { eq: { sku: { $literal: '$ref.sku' } } } },
        ],
      },
    });
    assert.deepEqual(names, lamps, "not read as the paper lamp's sku");
    let older = await ask({
      let: paperLamp,
      filter: {
        on: Product,
        every: [
          { eq: { kind: 'lamp' } },
          { not: { eq: { sku: { $literal: '$ref.sku' } } } },
        ],
      },
    });
    assert.deepEqual(older.names, lamps, 'and in the older spelling');
  });

  test('a one-card binding that finds no card matches nothing, as $this does', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: {
        $ref: {
          from: { type: Product, filter: { eq: { sku: 'NO-SUCH' } } },
          one: true,
        },
      },
      // were the missing value null, `eq` would find the chairs with no color
      filter: { eq: { color: '$ref.color' } },
    });
    assert.deepEqual(names, []);
  });

  test("a one-card binding's null under eq finds the cards with no value", async function (assert) {
    let { names } = await ask({
      type: Product,
      let: {
        // the oak chair has no color
        $ref: {
          from: { type: Product, filter: { eq: { sku: 'CHR-100' } } },
          one: true,
        },
      },
      filter: { eq: { color: '$ref.color' } },
    });
    assert.deepEqual(names, ['Oak Dining Chair', 'Steel Folding Chair']);
  });

  test('an expression reads a one-card binding as $name.path', async function (assert) {
    let { names } = await ask({
      type: Product,
      let: paperLamp,
      filter: { eq: { kind: 'lamp' } },
      sort: [{ expression: 'ABS($ref.price - price)', direction: 'asc' }],
    });
    // 60 against 80, 35, 25 and itself
    assert.deepEqual(names, [
      'Paper Floor Lamp',
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Salt Rock Lamp',
    ]);
  });

  // --- another type, and the older spelling ---------------------------------

  test('searches any card type the same way', async function (assert) {
    let { names } = await ask({
      type: Brand,
      sort: [{ by: 'founded' }],
    });
    // 1975, 1998, 2011, 2019
    assert.deepEqual(names, ['Oakline', 'Lumen', 'Hearth', 'Tidewater']);
  });

  test('reads the older spelling, with a type in every clause, the same way', async function (assert) {
    // The spelling older saved queries use: no top-level `type`; the
    // filter and each sort entry name the type themselves with `on`.
    let older = await ask({
      filter: { on: Product, eq: { kind: 'rug' } },
      sort: [{ by: 'price', on: Product }],
    });
    let newer = await ask({
      type: Product,
      filter: { eq: { kind: 'rug' } },
      sort: [{ by: 'price' }],
    });
    // the rugs by price: 90, 100, 200
    assert.deepEqual(older.names, [
      'Jute Hallway Rug',
      'Striped Outdoor Rug',
      'Wool Area Rug',
    ]);
    assert.deepEqual(newer.names, older.names);
  });
});
