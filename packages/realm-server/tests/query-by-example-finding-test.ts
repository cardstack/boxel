import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  Product,
  WARM,
  ask,
  productId,
  setupShop,
  wishListId,
} from './helpers/query-by-example.ts';

// FINDING: the ways a query finds cards by what they say, what they are
// called, what they look like and what links to them. Each test is one
// ability of the query language (docs/search.md, Filters), as one query and
// the cards it finds. Narrowing by exact values is the next file; checks of
// every combination and edge live in the integration tests, not here.

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

  // --- by the words on the card ---------------------------------------------

  test('finds cards that have a word anywhere in their text', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'reading' },
    });
    // two have "Reading" in the name; the brass lamp's blurb says
    // "late-night reading"
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Velvet Reading Chair',
    ]);
  });

  test('finds cards that have either of two words', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'rug or blanket' },
    });
    // the three rugs, and the one blanket
    assert.deepEqual(names, [
      'Jute Hallway Rug',
      'Striped Outdoor Rug',
      'Wool Area Rug',
      'Wool Throw Blanket',
    ]);
  });

  test('finds cards that have an exact phrase', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: '"solid oak"' },
    });
    // the paper lamp stands "on a solid oak tripod"; the oak chair says
    // "Oak, solid build", the same two words the other way around
    assert.deepEqual(names, ['Paper Floor Lamp']);
  });

  test('leaves out cards that have an excluded word', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'lamp -reading' },
    });
    // four lamps; the clamp lamp's name and the brass lamp's blurb say
    // "reading"
    assert.deepEqual(names, ['Paper Floor Lamp', 'Salt Rock Lamp']);
  });

  test('finds cards whose title has a word', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'reading', scope: 'title' },
    });
    // the brass lamp says "reading" only in its blurb
    assert.deepEqual(names, ['Clamp Reading Lamp', 'Velvet Reading Chair']);
  });

  test('finds cards that have a word in the fields named', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'oak', fields: ['material'] },
    });
    // the paper lamp mentions oak in its blurb, but its material is paper
    assert.deepEqual(names, ['Oak Dining Chair']);
  });

  test('finds cards despite a misspelled word', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'velvit', typos: true },
    });
    // "velvit" is one letter from "velvet", a word of a product's name
    assert.deepEqual(names, ['Velvet Reading Chair']);
  });

  test('finds cards while the last word is still being typed', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { matches: 'wool thr', prefix: true },
    });
    // "wool" matches whole and "thr" starts "throw"; the wool rug has no
    // word that starts with "thr"
    assert.deepEqual(names, ['Wool Throw Blanket']);
  });

  test('finds cards by a passage of theirs, and says which passage', async function (assert) {
    let { names, meta } = await ask({
      type: Product,
      filter: { matches: 'switch', within: 'reviews' },
    });
    // the brass lamp's second review: "The switch is stiff at first."
    assert.deepEqual(names, ['Brass Desk Lamp']);
    let passages = meta.passages[productId('brass')];
    assert.deepEqual(
      passages.map((p: any) => [p.field, p.ordinal]),
      [['reviews', 1]],
    );
  });

  // --- by the name, as someone types it -------------------------------------

  test('suggests titles from the first letters of their words, in any order', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { prefix: true, scope: 'title', matches: 'lam bra' },
    });
    // four names have a word starting "lam"; only one also has "bra"
    assert.deepEqual(names, ['Brass Desk Lamp']);
  });

  test('suggests titles despite a misspelled word', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: {
        prefix: true,
        scope: 'title',
        matches: 'velvit rea',
        typos: true,
      },
    });
    // "velvit" is corrected to "velvet"; "rea" still starts "Reading"
    assert.deepEqual(names, ['Velvet Reading Chair']);
  });

  // --- by part of a value, or its shape -------------------------------------

  test('finds cards whose field contains some text', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { contains: { name: 'oor' } },
    });
    // Fl-oor, Outd-oor: inside a word, where a word search does not look
    assert.deepEqual(names, ['Paper Floor Lamp', 'Striped Outdoor Rug']);
  });

  test('finds cards whose code fits a wildcard pattern', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { pattern: { sku: 'lmp-?00' } },
    });
    // LMP-100, LMP-200 and LMP-300, whatever the case; "?" is one
    // character, so LMP-40X does not fit
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Paper Floor Lamp',
    ]);
  });

  test('finds cards whose code fits a regular expression', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { regex: { sku: '^RUG-[0-9]+$' } },
    });
    // RUG-100 and RUG-200; RUG-12B ends in a letter
    assert.deepEqual(names, ['Jute Hallway Rug', 'Wool Area Rug']);
  });

  // --- by likeness ----------------------------------------------------------

  test('finds cards whose vector is close to a target', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { near: { look: { to: WARM, minSimilarity: 0.9 } } },
    });
    // the two whose look is exactly warm (similarity 1); the next closest
    // are at 0.8
    assert.deepEqual(names, ['Brass Desk Lamp', 'Velvet Reading Chair']);
  });

  test('finds every card that has a vector at all', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { near: { look: { to: WARM } } },
    });
    // with no minSimilarity: all but the sofa, which has no look
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Clamp Reading Lamp',
      'Jute Hallway Rug',
      'Oak Dining Chair',
      'Paper Floor Lamp',
      'Salt Rock Lamp',
      'Steel Folding Chair',
      'Striped Outdoor Rug',
      'Velvet Reading Chair',
      'Wool Area Rug',
      'Wool Throw Blanket',
    ]);
  });

  // --- by what links to them ------------------------------------------------

  test('finds the cards another card links to', async function (assert) {
    let { names } = await ask({
      type: Product,
      filter: { linkedFrom: { card: wishListId('ada'), field: 'items' } },
    });
    // the four products on Ada's wish list
    assert.deepEqual(names, [
      'Brass Desk Lamp',
      'Salt Rock Lamp',
      'Velvet Reading Chair',
      'Wool Throw Blanket',
    ]);
  });
});
