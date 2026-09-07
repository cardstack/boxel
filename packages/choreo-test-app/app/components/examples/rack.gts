import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoRun, Sprite } from 'glimmer-motion';
import { afterSettle, Choreo, motion } from 'glimmer-motion';
import { tuneSeconds } from 'test-app/lib/demo-tuning';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * The four arrangements. The index IS the slider's whole number.
 *
 * 0 `alpha`   A to Z, reading order
 * 1 `groups`  the five vowels lifted out of the twenty-one consonants
 * 2 `bag`     stacked by how many of that tile a Scrabble set contains
 * 3 `points`  stacked by what the tile is worth
 * 4 `plot`    frequency against points, with axes
 * 5 `game`    the whole set played out on a board
 *
 * `points` and `plot` share an x axis on purpose, so the last leg is a purely
 * vertical spread out of the stacks. `bag` comes before them rather than
 * after for the same reason: it has an x axis of its own, and putting it
 * between the two would break the one they share.
 */
const STOPS = ['A–Z', 'Vowels', 'Bag', 'Points', 'Plot', 'Game'];
const LAST = STOPS.length - 1;

/**
 * ONE SCORE, NOT THREE.
 *
 * A changeset has exactly two ends, so a journey through four poses looks at
 * first like three scores with the host swapping between them at each notch.
 * That is how the first two versions of this demo worked and it is a bad
 * trade: every swap needs a render round-trip, the swap happens at a notch
 * while the outgoing run is still holding its sprites, and a gesture can
 * outrun the whole arrangement.
 *
 * None of it is necessary, because a keyframe array is the from-and-to AND
 * ANY WAYPOINTS in one value. Four stops per property is one score for the
 * whole journey. The DOM never changes: no pose classes, no re-render, no
 * changeset to depend on — the region compiles once on mount and the slider
 * scrubs its clock from end to end.
 *
 * The prices are worth naming. The poses have to be arithmetic rather than
 * stylesheet, since nothing can be measured out of a layout that is never
 * rendered. And with the tiles' geometry stated rather than measured, the
 * whole "positioned against its own size" family cannot arise: every tile is
 * the same 28px square in all four arrangements and only its transform moves.
 */
const SPAN = 1.8;
const LINEAR = 'linear' as const;
const HOME = { damping: 24, stiffness: 240 } as const;

/** relative frequency of each letter in English text, in percent */
const FREQ: Record<string, number> = {
  a: 8.17,
  b: 1.29,
  c: 2.78,
  d: 4.25,
  e: 12.7,
  f: 2.23,
  g: 2.02,
  h: 6.09,
  i: 6.97,
  j: 0.15,
  k: 0.77,
  l: 4.03,
  m: 2.41,
  n: 6.75,
  o: 7.51,
  p: 1.93,
  q: 0.1,
  r: 5.99,
  s: 6.33,
  t: 9.06,
  u: 2.76,
  v: 0.98,
  w: 2.36,
  x: 0.15,
  y: 1.97,
  z: 0.07,
};

/** what the tile is worth in Scrabble */
const POINTS: Record<string, number> = {
  a: 1,
  b: 3,
  c: 3,
  d: 2,
  e: 1,
  f: 4,
  g: 2,
  h: 4,
  i: 1,
  j: 8,
  k: 5,
  l: 1,
  m: 3,
  n: 1,
  o: 1,
  p: 3,
  q: 10,
  r: 1,
  s: 1,
  t: 1,
  u: 1,
  v: 4,
  w: 4,
  x: 8,
  y: 4,
  z: 10,
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * The blank.
 *
 * A set holds two, but one on the board says the same thing and a pair of
 * identical featureless tiles reads as a mistake rather than as a fact. It is
 * worth nothing and stands for anything. They belong in three of the five
 * arrangements and genuinely do not belong in the fourth: a blank has no
 * letter, so it has no letter frequency, and putting it anywhere on that
 * chart would be inventing a number.
 *
 * So it leaves. Its opacity keyframes run 1,1,1,1,0 and it fades out over the
 * final leg while everything else spreads — which says what the footnote
 * under a chart would have had to say, without a footnote.
 */
const BLANKS = ['blank'];

/** how many of each tile a Scrabble set contains */
const BAG: Record<string, number> = {
  a: 9,
  b: 2,
  c: 2,
  d: 4,
  e: 12,
  f: 2,
  g: 3,
  h: 2,
  i: 9,
  j: 1,
  k: 1,
  l: 4,
  m: 2,
  n: 6,
  o: 8,
  p: 2,
  q: 1,
  r: 6,
  s: 4,
  t: 6,
  u: 4,
  v: 2,
  w: 2,
  x: 1,
  y: 2,
  z: 1,
};

/**
 * CWM FJORD BANK GLYPHS VEXT QUIZ.
 *
 * A perfect pangram: six words, twenty-six letters, not one of them twice.
 * (A cwm is a steep hollow on a hillside; vext is the archaic spelling of
 * vexed. Both are good in Scrabble.) Nothing crosses — they are laid out as
 * separate blocks — which is what makes it placeable at all: an interlocking
 * version of the same idea is not, and I have the exhaustive search to prove
 * it. Every letter has to be used exactly once, so VET and BAN would each
 * need BOTH their repeated letters already adjacent on the board, and no
 * arrangement of those words provides it.
 *
 * The two blanks are not played. They sit in the corner, which is the honest
 * place for a tile nobody needed.
 */
const GAME: [string, number, number][] = [
  // word, column, row — staggered, because a board someone has played on is
  // not six centred rows. Centring them was worse than it sounds: an
  // even-length word cannot be centred on an odd grid without sitting half a
  // square off, so four of the six looked misaligned rather than placed.
  ['CWM', 1, 0],
  ['FJORD', 5, 2],
  ['BANK', 0, 4],
  ['GLYPHS', 4, 6],
  ['VEXT', 1, 8],
  ['QUIZ', 6, 10],
];
const GRID = 11;

/* ── the layouts, arithmetic rather than stylesheet ─────────────────────── */

const TILE = 22;
const STEP = 27;
const COLS = 7;
const BOARD = { h: 292, w: 340 };
/** the board's own pitch — one square per cell, a tile centred in each */
const CELL = 22;
const BOARD_X = Math.round((BOARD.w - GRID * CELL) / 2);
const BOARD_Y = 8;
const square = (col: number, row: number) => ({
  x: BOARD_X + col * CELL + (CELL - TILE) / 2,
  y: BOARD_Y + row * CELL + (CELL - TILE) / 2,
});
const GRID_X = Math.round((BOARD.w - (COLS - 1) * STEP - TILE) / 2);

const alphabet = Object.keys(FREQ);
/** the full set: twenty-six letters and a blank */
const bagful = [...alphabet, ...BLANKS];
const isBlank = (ch: string) => ch.startsWith('blank');
const topFreq = Math.max(...Object.values(FREQ));
for (const b of BLANKS) {
  POINTS[b] = 0;
  BAG[b] = 2;
}
/**
 * Both axes run the WHOLE range, including the values nothing has.
 *
 * Listing only the values that occur — 1, 2, 3, 4, 6, 8, 9, 12 — spaces them
 * evenly and quietly lies: it makes the step from 4 to 6 look like the step
 * from 1 to 2, and hides that there is no letter you hold six of. An ordinal
 * axis with empty columns says the true shape, and the gaps are part of it.
 */
const range = (lo: number, hi: number) =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
/** points start at ZERO, because the blanks are worth nothing and are real */
const values = range(0, Math.max(...Object.values(POINTS)));
const counts = range(1, Math.max(...Object.values(BAG)));

const cell = (n: number, x0: number, y0: number) => ({
  x: x0 + (n % COLS) * STEP,
  y: y0 + Math.floor(n / COLS) * STEP,
});

/**
 * Two arrangements share one x axis, and that is the point.
 *
 * `points` stacks the tiles into a column per value — a distribution you can
 * read at a glance: ten letters are worth 1, two are worth 10. `plot` keeps
 * every tile in the same column and lets it find its true height. So the last
 * leg of the journey is a purely VERTICAL spread out of the stacks, which is
 * the clearest way to show what the chart is actually claiming: how often a
 * letter turns up, against what it is worth.
 */
const PLOT = { bottom: 256, left: 16, right: 332, top: 14 };

/** every letter of a given value, most frequent first */
const strip = (value: number) =>
  bagful
    .filter((c) => POINTS[c] === value)
    .sort((a, b) => (FREQ[b] ?? -1) - (FREQ[a] ?? -1));

/**
 * The points axis gives each column the width its CROWD needs.
 *
 * A tile can be worth 1, 2, 3, 4, 5, 8 or 10, and the letters are not spread
 * evenly across those: ten are worth 1, and only one is worth 5. Spaced
 * evenly, ten tiles fight over a seventh of the board while a single K gets
 * the same room — and no amount of lane-shuffling fixes it, because ten 28px
 * tiles do not fit in 35px however they are arranged. A log axis was the
 * first attempt and it made the far end worse: it squeezed 8 and 10 to 25px
 * apart, and J and X, which have exactly the same frequency, had nowhere to
 * stand but on top of each other.
 *
 * So the axis is ordinal and each value's slot is proportional to how many
 * letters it holds, with a floor so a lone K still gets a place to stand.
 * The ticks are labelled, so the axis stays readable without being linear.
 */
const SPAN_X = PLOT.right - PLOT.left;

/**
 * Columns are EVENLY spaced, and the crowding is absorbed by depth instead.
 *
 * Widths proportional to population were tried and read as a broken ruler:
 * the gap from 1 to 2 was four times the gap from 8 to 10, so the axis
 * implied a scale it did not have. An even axis is honest and legible, and
 * where a column holds more than it can stack the pile simply wraps into a
 * second file — the crowd shows as depth rather than as width.
 */
function lanesOf(n: number) {
  const width = SPAN_X / n;
  return {
    centres: Array.from({ length: n }, (_, i) => PLOT.left + (i + 0.5) * width),
    width,
  };
}

const PTS_LANES = lanesOf(values.length);
const COLUMN = (value: number) =>
  PTS_LANES.centres[values.indexOf(value)]! - TILE / 2;

/**
 * A stack's row pitch, which CLEARS the tile.
 *
 * Overlapping piles were tried and read as a mess rather than as a stack: a
 * tile half-covering the one below hides the value in its corner, which is
 * the number the arrangement is about. Nothing overlaps now, which sets the
 * board's height rather than the other way round — eleven tiles is the
 * deepest column there is, and the board is tall enough for eleven.
 */
const STACK = TILE + 3;

/** where the k-th tile of a pile sits, counting up from the baseline */
const pile = (x0: number, k: number) => ({
  x: x0,
  y: PLOT.bottom - TILE - k * STACK,
});

const stacked = new Map<string, { x: number; y: number }>();
const bagged = new Map<string, { x: number; y: number }>();
const BAG_LANES = lanesOf(counts.length);
for (const count of counts) {
  const x = BAG_LANES.centres[counts.indexOf(count)]! - TILE / 2;
  const members = bagful.filter((c) => BAG[c] === count);
  members.forEach((ch, k) => {
    bagged.set(ch, pile(x, k));
  });
}
const plotted = new Map<string, { x: number; y: number }>();

/**
 * The frequency axis runs DOWNWARD — the most common letters lie along the
 * bottom, the rare ones climb away from it — and it is a SQUARE-ROOT scale.
 *
 * English is lopsided: E alone is 12.7% and half the alphabet is under 2%, so
 * on a linear axis twenty letters pile into one eighth of the board. Rooting
 * the ratio pulls that crowd apart without reordering anybody.
 *
 * Collisions are then resolved by SEARCH rather than by a fixed set of lanes,
 * because the crowding is not uniform: one column needs three lanes and the
 * next needs none. Each tile takes its true height and the first free spot
 * near it, preferring sideways movement — height is the variable being read,
 * so it is the one that must stay honest — and giving ground vertically only
 * when a column has no width left. J and X, which have identical frequency,
 * are the case that forces the last resort to exist.
 */
const placed: { x: number; y: number }[] = [];
const clear = (x: number, y: number) =>
  placed.every(
    (q) => Math.abs(q.x - x) >= TILE - 2 || Math.abs(q.y - y) >= TILE - 2
  );

for (const value of values) {
  const x0 = COLUMN(value);
  const members = strip(value);
  // stacked: most frequent on the bottom row, matching where the plot will
  // put it, so nothing has to cross on the way out
  members.forEach((ch, k) => {
    stacked.set(ch, pile(x0, k));
  });

  for (const ch of members) {
    // A BLANK IS THE OUTLIER, not an omission.
    //
    // It has no letter, so it has no letter frequency — but it can stand for
    // any letter, which means it plays as often as the commonest one does.
    // Worth nothing and worth everything: zero points, and as useful as E.
    // Dropping it off the chart would have been the tidier lie.
    const y0 = isBlank(ch)
      ? PLOT.top + (PLOT.bottom - PLOT.top) - TILE / 2
      : PLOT.top +
        Math.sqrt(FREQ[ch]! / topFreq) * (PLOT.bottom - PLOT.top) -
        TILE / 2;
    // Widen the search until something is clear.
    //
    // Sideways first and as far as a whole tile, because height is the
    // variable being read and must stay honest for as long as possible; then,
    // and only then, small vertical give. A column is narrower than a tile
    // here, so a fan that stayed inside its own column could not separate
    // anybody — the collision test is what keeps neighbours apart, not the
    // column's width.
    let spot = { x: x0, y: y0 };
    search: for (const dy of [0, -9, 9, -18, 18, -27, 27]) {
      for (const dx of [0, -0.45, 0.45, -0.9, 0.9, -1.35, 1.35]) {
        const x = x0 + dx * TILE;
        if (x >= PLOT.left - TILE && x <= PLOT.right && clear(x, y0 + dy)) {
          spot = { x, y: y0 + dy };
          break search;
        }
      }
    }
    placed.push(spot);
    plotted.set(ch, spot);
  }
}

/** every letter's square, worked out from the six words */
const played = new Map<string, { x: number; y: number }>();
for (const [word, col, row] of GAME) {
  [...word].forEach((ch, j) => {
    played.set(ch.toLowerCase(), square(col + j, row));
  });
}
// the tile nobody played, in the corner
BLANKS.forEach((b, k) => played.set(b, square(GRID - 1 - k, GRID - 1)));

/**
 * The top row of the `groups` arrangement: the vowels, and then the blanks.
 *
 * A blank is neither a vowel nor a consonant, and giving it a line of its own
 * under the consonant block put it where nothing else was — which read as a
 * mistake and, worse, put the two of them on the same square. They belong at
 * the END of the vowels: the tiles that can be any vowel you like, after the
 * five that are.
 */
const TOP_ROW = [...alphabet.filter((c) => VOWELS.has(c)), ...BLANKS];

/** centre a row of `n` tiles on the board */
const row = (rank: number, n: number, y: number) => ({
  x: Math.round((BOARD.w - (n - 1) * STEP - TILE) / 2) + rank * STEP,
  y,
});

const letters = bagful.map((ch, i) => {
  const blank = isBlank(ch);
  const vowel = VOWELS.has(ch);
  const top = TOP_ROW.indexOf(ch);
  const rank =
    top >= 0 ? top : bagful.filter((c) => TOP_ROW.indexOf(c) < 0).indexOf(ch);
  const sack = bagged.get(ch)!;
  const pile = stacked.get(ch)!;
  const spot = plotted.get(ch)!;
  return {
    blank,
    ch: blank ? '' : ch,
    key: ch,
    share: FREQ[ch] ?? 0,
    vowel,
    worth: POINTS[ch]!,
    /** the tile's seat in each of the five arrangements, in order */
    seats: [
      cell(i, GRID_X, 40),
      top >= 0 ? row(rank, TOP_ROW.length, 26) : cell(rank, GRID_X, 96),
      sack,
      pile,
      spot,
      played.get(ch)!,
    ],
  };
});

const seats = new Map(letters.map((l) => [l.key, l.seats]));

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * A detent under the finger: the playhead is drawn toward whichever stop it
 * is nearest, hardest when it is nearly there.
 *
 * Not a snap — the drag stays continuous and every value in between is still
 * reachable — but a stop becomes slightly sticky, so letting go anywhere near
 * one leaves the arrangement dead centre rather than a few percent past it. A
 * rack with notches in it should feel like it has notches in it.
 */
const detent = (p: number) => {
  const near = Math.round(p);
  const off = p - near;
  // pull only inside a quarter of a stop, and taper to nothing at the edge
  const reach = 0.25;
  if (Math.abs(off) >= reach) {
    return p;
  }
  const pull = 1 - Math.abs(off) / reach;
  return p - off * pull * 0.55;
};

/** easeInOutQuint — still, then quick, then a long settle */
const quint = (t: number) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

/**
 * A slider IS a playhead, so this one drives a score directly.
 *
 * `/sheet` is the other half of the idea. There, `drag="y"` owns the sheet's
 * position while the finger is down and the tiles do not move at all until
 * release, when a class change and `layout=true` spring them into shape.
 * Measure it mid-drag and the tile is the same width the whole way. That is
 * not a bug: `layout=true` is measure-and-fire, and there is nowhere to hand
 * it a progress. A Choreo run has one, because a run is a value with a clock
 * on it.
 *
 * WHY LETTERS. A morph is only worth scrubbing if the eye can follow it, and
 * that needs the things being moved to be individually nameable. Twenty-six
 * identical cards flying between a list and a grid is noise however exact the
 * arithmetic — every item crosses every other and none of them is anyone in
 * particular. Twenty-six lettered tiles crossing is a sort you can read: E
 * leaves the middle of the alphabet, keeps its seat when the vowels gather,
 * and ends up alone at the top of the plot, and you can watch it go.
 */
export class Rack extends Component {
  /**
   * THE PARKED OPENING.
   *
   * A region compiles a score from a PASS, and a pass is a render that
   * changes something inside it. This demo's DOM never changes — that is the
   * whole point of putting the journey in keyframes — so left alone the
   * region has nothing to react to and no run is ever built. One bump of a
   * counter after mount is enough: it changes nothing anyone can see, the
   * region measures a changeset, the score compiles, and the gate parks it at
   * zero before a frame of it can play. From then on the slider owns the
   * clock and nothing renders again.
   */
  @tracked private take = 0;

  /** the region's context. Not tracked — read from pointer handlers */
  private c?: { run: ChoreoRun | null };
  /** the slider, in notches */
  private p = 0;
  /** the stop the control is heading for — what a repeated key steps from */
  private goal = 0;
  private rail?: HTMLElement;
  private thumb?: HTMLElement;
  private dragging = false;
  private raf = 0;
  private v = 0;

  private get run() {
    return this.c?.run ?? null;
  }

  /**
   * Park the clock where the slider says.
   *
   * The clamp at the top is not cosmetic. A run allowed to reach its own
   * duration is FINISHED, and a finished run replays itself on any later
   * render — so a scrubbable run is parked a hair short of the end and never
   * allowed to retire.
   */
  private draw() {
    this.paint();
    const run = this.run;
    if (!run) {
      return;
    }
    // the head gate held the clock at zero; open it once, or every seek
    // parks right back on it
    if (run.parked) {
      run.advance();
    }
    run.pause();
    run.time = (this.p / LAST) * Math.max(0, run.duration - 0.001);
  }

  /**
   * The thumb, the filled track and the active label — all written straight
   * from the playhead, none of them measured, none of them tracked.
   *
   * Marking the nearest stop is the sort of thing that wants a `@tracked`
   * index, and it must not have one: the rail lives outside the region but
   * the component does not, so a re-render would reach the <Choreo> block and
   * a render inside a region is a PASS. A class toggle costs nothing and
   * cannot recompile a score.
   */
  private paint() {
    const f = this.p / LAST;
    // a fraction, not a percentage: the stylesheet turns it into a position
    // inside the track's span rather than the rack's
    this.thumb?.style.setProperty('--f', `${f}`);
    this.rail?.style.setProperty('--at', `${f * 100}%`);
    const near = Math.round(this.p);
    if (near !== this.lit) {
      this.lit = near;
      this.rail
        ?.querySelectorAll<HTMLElement>('.rk-notch')
        .forEach((el, i) => el.classList.toggle('is-on', i === near));
    }
  }

  /** which stop is currently marked, so the class is only rewritten on change */
  private lit = -1;

  /**
   * Hold the run the moment it exists — which is later than you would think.
   *
   * Modifiers on the region's CHILDREN run before the region's own update, so
   * when this fires `c.run` is still the previous pass's run. `afterSettle`
   * is the engine's post-render microtask: after the score exists, still
   * before paint.
   */
  wire = modifier((_el: Element, [c]: [{ run: ChoreoRun | null }]) => {
    this.c = c;
    this.draw();
    afterSettle(() => this.draw());
  });

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Where a pointer at `clientX` puts the playhead.
   *
   * Measured against the TRACK, not the rack around it. The rack is padded,
   * so a fraction of its width lands short at one end and past the other —
   * which is exactly how the marker ended up sitting off the end of the wood
   * at the last stop.
   */
  private at(clientX: number) {
    const track = this.rail?.querySelector('.rk-track');
    if (!track) {
      return this.p;
    }
    const box = track.getBoundingClientRect();
    return clamp(((clientX - box.x) / box.width) * LAST, 0, LAST);
  }

  grab = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    // A STOP IS NOT THE TRACK.
    //
    // The labels are children of the rack, so a press on one arrives here
    // first and would seize the playhead to wherever that label sits — the
    // ride is then over before `pick` gets to ask for it, and what you see is
    // a jump with an ease politely appended. A press on a stop belongs to the
    // stop; the rack only owns presses on itself.
    if ((event.target as Element | null)?.closest('.rk-notch')) {
      return;
    }
    this.stop();
    this.v = 0;
    this.dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.p = this.at(event.clientX);
    this.draw();
  };

  move = (event: PointerEvent) => {
    if (!this.dragging) {
      return;
    }
    const next = detent(this.at(event.clientX));
    this.v = (next - this.p) * 60;
    this.p = next;
    this.draw();
  };

  /**
   * The thumb lets go, and a spring takes the clock.
   *
   * `/sheet` hands a POSITION to a spring on release, and picks its detent
   * from where the throw was going rather than where the finger stopped. Same
   * rule; the value the spring settles is the playhead, and a notch is a
   * whole number on it.
   */
  land = (event: PointerEvent) => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    const landing = Math.round(clamp(this.p + this.v * 0.12, 0, LAST));
    this.goal = landing;
    this.springTo(landing);
  };

  /**
   * Aim at a stop.
   *
   * From REST it is an eased ride: a tap or a key press has no momentum to
   * spend, so it gets a curve instead. Mid-RIDE it hands over to the spring
   * with whatever speed it already had — pressing an arrow twice quickly
   * should read as one longer journey, and restarting the ease each time
   * made it stutter, decelerating into a stop it never reached before
   * setting off again.
   */
  private aim(target: number) {
    if (this.raf) {
      this.goal = target;
      this.springTo(target);
      return;
    }
    this.easeTo(target);
  }

  /**
   * A stop, tapped: an eased ride rather than a spring.
   *
   * A throw has momentum and a spring is the honest way to spend it. A tap
   * has none — there is nothing to carry — so it gets a curve instead, and
   * quint is the one that reads as deliberate at this distance: a still
   * start, a quick middle, a long settle. The knob is not animated
   * separately; it is drawn from the playhead every frame, so it rides the
   * same curve as the tiles by construction.
   */
  private easeTo(target: number) {
    this.stop();
    this.goal = target;
    const from = this.p;
    const span = Math.abs(target - from);
    if (span < 0.001) {
      return;
    }
    // longer for a longer journey, but not proportionally — crossing four
    // stops should not take four times as long as crossing one
    const ms = 380 + Math.sqrt(span) * 300;
    const started = performance.now();
    let last = started;
    let lastP = from;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      this.p = from + (target - from) * quint(t);
      // keep a real velocity: an ease that reports zero has nothing to hand
      // over, and a second key press mid-ride then restarts from a dead stop
      const dt = Math.max(1, now - last) / 1000;
      this.v = (this.p - lastP) / dt;
      last = now;
      lastP = this.p;
      this.draw();
      if (t >= 1) {
        this.p = target;
        this.v = 0;
        this.draw();
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** carry the slider to a stop on a spring, carrying the throw's momentum */
  private springTo(target: number) {
    this.stop();
    this.goal = target;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const a = HOME.stiffness * (target - this.p) - HOME.damping * this.v;
      this.v += a * dt;
      this.p = clamp(this.p + this.v * dt, 0, LAST);
      this.draw();
      if (Math.abs(target - this.p) < 0.002 && Math.abs(this.v) < 0.04) {
        this.p = target;
        this.v = 0;
        this.draw();
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * Arrow keys walk the stops, Home and End jump to the ends.
   *
   * The same eased ride a tap gets, for the same reason: a key press has no
   * momentum to spend. A rack that can be dragged but not tabbed to is a
   * control only half of the people who need it can use.
   */
  key = (event: KeyboardEvent) => {
    // Walk from the GOAL, not from where the playhead happens to be.
    //
    // Deriving the next stop from `Math.round(this.p)` looks equivalent and
    // is not: a held key repeats while the previous ride is still in the air,
    // the playhead is still rounding to the stop it left, and every repeat
    // re-targets the same destination. The rack stalls one stop short and
    // then completes when you let go, which is exactly backwards.
    const step: Record<string, number> = {
      ArrowDown: this.goal - 1,
      ArrowLeft: this.goal - 1,
      ArrowRight: this.goal + 1,
      ArrowUp: this.goal + 1,
      End: LAST,
      Home: 0,
    };
    const target = step[event.key];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    this.aim(clamp(target, 0, LAST));
  };

  /** a notch, clicked: the same spring, a stated target */
  pick = (event: MouseEvent) => {
    const notch = Number(
      (event.currentTarget as HTMLElement).dataset['notch'] ?? 0
    );
    this.aim(clamp(notch, 0, LAST));
  };

  /**
   * Clicking anywhere in the demo hands the keyboard to the rack.
   *
   * The rack is the slider and holds the focus, but nobody clicks a rack to
   * start using arrow keys — they click the thing they are looking at, which
   * is the tiles. Focusing on any pointerdown in the card means the arrows
   * work the moment you have touched it at all. `preventScroll`, because
   * focusing something should never move the page under you.
   */
  claim = () => {
    this.rail?.focus({ preventScroll: true });
  };

  railed = modifier((el: HTMLElement) => {
    this.rail = el;
    // the first stop is where the playhead already is, so it has to read as
    // selected before anyone touches anything — `paint` only writes the class
    // on a change, and until the rack exists there is nothing to write to
    this.lit = -1;
    this.paint();
    return () => {
      this.rail = undefined;
    };
  });

  thumbed = modifier((el: HTMLElement) => {
    this.thumb = el;
    this.paint();
    return () => {
      this.thumb = undefined;
    };
  });

  mount = modifier((el: HTMLElement) => {
    (el as HTMLElement & { rack?: Rack }).rack = this;
    const id = requestAnimationFrame(() => {
      this.take = 1;
    });
    return () => {
      cancelAnimationFrame(id);
      this.stop();
    };
  });

  /* ── the score's keyframes: one array per property, four stops long ──── */

  /** every seat's x, in order — the tile's whole journey in one value */
  xs = (sprite: Sprite) => (seats.get(sprite.id ?? '') ?? []).map((s) => s.x);

  ys = (sprite: Sprite) => (seats.get(sprite.id ?? '') ?? []).map((s) => s.y);

  /**
   * The axes arrive in two stages, because they mean two different things.
   *
   * The value axis is already true at `points` — the stacks stand on it — so
   * it draws in over the third leg and stays. The frequency axis is only
   * true once the tiles have left their stacks, so it waits for the fourth.
   */
  /**
   * Each piece of furniture fades in only where it is TRUE.
   *
   * A legend that is always on screen is decoration; one that arrives exactly
   * when the arrangement starts making its claim is part of the claim. Every
   * array below is one number per stop, so the whole schedule of what is
   * being asserted is readable in five columns.
   *
   *                       A–Z  Vowels  Bag  Points  Plot  Game
   */
  fadeVowels = [0, 1, 0, 0, 0, 0];
  fadeBag = [0, 0, 1, 0, 0, 0];
  fadePoints = [0, 0, 0, 1, 1, 0];
  fadePlot = [0, 0, 0, 0, 1, 0];
  fadeGame = [0, 0, 0, 0, 0, 1];
  /**
   * The blanks are part of the SET, not of the last two claims.
   *
   * They belong in A–Z, in the vowel split and in both distributions,
   * because a set contains them. They have no letter frequency to plot and
   * no part in a pangram that uses every letter exactly once, so they leave
   * before those two rather than stand around implying otherwise.
   */
  fadeBlank = [1, 1, 1, 1, 0, 0];

  /** test-support: what the slider and the score are doing */
  get debug() {
    const run = this.run;
    return {
      duration: run?.duration ?? null,
      p: this.p,
      time: run?.time ?? null,
    };
  }

  /** test-support: put the slider somewhere, as the thumb would */
  seek(p: number) {
    this.stop();
    this.p = clamp(p, 0, LAST);
    this.goal = Math.round(this.p);
    this.draw();
  }

  letters = letters;
  values = values;
  counts = counts;

  <template>
    <div
      class="ex no-select"
      {{on "selectstart" preventSelect}}
      {{on "pointerdown" this.claim}}
      {{this.mount}}
    >
      <div class="rk-fit-box"><div class="rk-fit">
          {{! the region is the stage; the tiles are children ON it }}
          <Choreo class="rk-stage" as |c|>
            <span
              class="rk-wire"
              data-take={{this.take}}
              {{this.wire c}}
            ></span>

            {{! Every piece of furniture belongs to ONE arrangement and fades in
            where it becomes true — see the fade arrays above. Nothing is ever
            added or removed: a changeset that gains a participant mid-gesture
            is a different kind of pass. }}
            <span class="rk-key is-v" {{motion id="key-v" role="vowels"}}>
              Vowels
            </span>
            <span class="rk-key is-c" {{motion id="key-c" role="vowels"}}>
              Consonants
            </span>

            <span
              class="rk-axis is-x"
              {{motion id="axis-bag" role="bag"}}
            ></span>
            <span class="rk-alab is-x" {{motion id="lab-bag" role="bag"}}>
              Tiles in the bag
            </span>
            {{#each this.counts as |count|}}
              <span
                class="rk-tick"
                style={{tickAt count this.counts}}
                {{motion id=(tickId "bag" count) role="bag"}}
              >{{count}}</span>
            {{/each}}

            <span
              class="rk-axis is-x"
              {{motion id="axis-x" role="points"}}
            ></span>
            <span class="rk-alab is-x" {{motion id="lab-x" role="points"}}>
              Scrabble points
            </span>
            {{#each this.values as |value|}}
              <span
                class="rk-tick"
                style={{tickAt value this.values}}
                {{motion id=(tickId "pts" value) role="points"}}
              >{{value}}</span>
            {{/each}}

            {{! the board, which is only true at the last stop }}
            <span class="rk-grid" {{motion id="grid" role="game"}}></span>
            <span class="rk-alab is-game" {{motion id="lab-game" role="game"}}>
              Cwm fjord bank glyphs vext quiz · 26 tiles, no letter twice
            </span>

            <span
              class="rk-axis is-y"
              {{motion id="axis-y" role="plot"}}
            ></span>
            <span class="rk-alab is-yt" {{motion id="lab-yt" role="plot"}}>
              ↑ Rarer
            </span>
            <span class="rk-alab is-yb" {{motion id="lab-yb" role="plot"}}>
              ↓ Commoner
            </span>

            {{#each this.letters as |l|}}
              <span
                class="rk-l {{if l.vowel 'is-vowel'}} {{if l.blank 'is-blank'}}"
                {{motion id=l.key role=(if l.blank "blank" "tile")}}
              >
                <b>{{l.ch}}</b>
                {{#unless l.blank}}<i>{{l.worth}}</i>{{/unless}}
              </span>
            {{/each}}

            <c.Sequence>
              {{! the gate is what keeps the score still until the slider asks }}
              <c.Gate />
              <c.Parallel>
                {{! Four stops, evenly spaced along one clock. Linear, because
                under a finger there is no time to have an opinion about —
                the hand is already the curve. }}
                {{! A role is a single value, not a list, so the blanks cannot be
                both "tile" and "blank". `@of` takes an ARRAY of queries, which
                is the honest way to say "everything that moves": the letters
                and the blanks travel together, and only the blanks also
                fade. }}
                <c.Tween
                  @of={{array (c.role "tile") (c.role "blank")}}
                  @x={{this.xs}}
                  @y={{this.ys}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
                <c.Tween
                  @of={{c.role "vowels"}}
                  @opacity={{this.fadeVowels}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
                <c.Tween
                  @of={{c.role "bag"}}
                  @opacity={{this.fadeBag}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
                <c.Tween
                  @of={{c.role "points"}}
                  @opacity={{this.fadePoints}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
                <c.Tween
                  @of={{c.role "plot"}}
                  @opacity={{this.fadePlot}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
                <c.Tween
                  @of={{c.role "blank"}}
                  @opacity={{this.fadeBlank}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
                <c.Tween
                  @of={{c.role "game"}}
                  @opacity={{this.fadeGame}}
                  @duration={{tuneSeconds "rack" SPAN "SPAN duration"}}
                  @ease={{LINEAR}}
                />
              </c.Parallel>
            </c.Sequence>
          </Choreo>

          <div
            class="rk-rail"
            role="slider"
            tabindex="0"
            aria-label="Arrangement"
            aria-valuemin="0"
            aria-valuemax={{LAST}}
            {{this.railed}}
            {{on "keydown" this.key}}
            {{on "pointerdown" this.grab}}
            {{on "pointermove" this.move}}
            {{on "pointerup" this.land}}
            {{on "pointercancel" this.land}}
          >
            <span class="rk-track"></span>
            {{#each STOPS as |stop i|}}
              <button
                type="button"
                class="rk-notch"
                data-notch={{i}}
                style={{notch i}}
                {{on "click" this.pick}}
              ><span>{{stop}}</span></button>
            {{/each}}
            <span class="rk-thumb" {{this.thumbed}}></span>
          </div>

        </div></div>
    </div>
  </template>
}

/**
 * A tick sits under the middle of the column its value owns.
 *
 * The bag's counts are evenly spaced and the points are logarithmic, so the
 * two axes are not the same ruler — which is exactly why they fade in and out
 * with their own arrangements rather than sharing one row of labels.
 */
function tickAt(value: number, scale: number[]) {
  const lanes = scale === values ? PTS_LANES : BAG_LANES;
  return htmlSafe(`left: ${lanes.centres[scale.indexOf(value)]!}px`);
}

function tickId(axis: string, value: number) {
  return `tick-${axis}-${value}`;
}

function notch(i: number) {
  return htmlSafe(`--f: ${i / LAST}`);
}
