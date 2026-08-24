/**
 * A build order, and the timeline that falls out of it.
 *
 * Keynote's inspector is the reference, and it is worth saying why. Nobody
 * authoring a logo animation writes "the ring finishes at 880ms". They write
 * *the ring draws*, *the chevrons pop with it*, *the wordmark comes after*.
 * Every start time on this stage is a consequence of two words and a number —
 * `with` or `after`, plus a delay — resolved against the build above it:
 *
 *   at[0] = delay[0]
 *   at[i] = (with ? at[i-1] : end[i-1]) + delay[i]
 *
 * That is the whole scheduler. It is four lines because the relation is always
 * to the PREVIOUS build, which is Keynote's rule too, and which is what makes
 * a build order editable: move one build and everything downstream of it
 * follows, because nothing downstream was ever written as a timecode.
 *
 * The other half is that a build is a pure function of time. `poseAt(t, cue)`
 * asks one question and reads no DOM, no state and no history — so playing the
 * score and dragging a playhead through it are not two code paths that have to
 * be kept honest with each other, the way they are in the Playhead demo. They
 * are the same call with a different source of `t`. That is the payoff for
 * giving every build an end: an eased window can be asked about any instant in
 * any order, and a spring cannot be given a duration without lying about one
 * of the two.
 *
 * Which is also the constraint this file is honest about: there are no springs
 * here. A build has an end time, and a spring does not have one — it has a
 * settle. Every effect below is therefore an easing across a stated window,
 * and the overshoot in Pop is a curve rather than physics.
 */
import { easeInAndOut, easeOut } from 'glimmer-motion';

/* ── parts ───────────────────────────────────────────────────────────────── */

/**
 * What a part IS, which decides what can be done to it.
 *
 * Keynote does this too, and it is not fussiness: Line Draw is meaningless on
 * a paragraph and By Character is meaningless on a rectangle. The menu is
 * filtered by kind rather than the effect quietly doing nothing.
 */
export type PartKind = 'box' | 'shape' | 'stroke' | 'text';

export interface Part {
  kind: PartKind;
  label: string;
  /** matched to a `data-part` in the stage */
  name: string;
  /** text parts only: the string that gets split into glyphs */
  text?: string;
}

/**
 * The site's own logo, taken apart — see components/choreo-mark.gts for what
 * the comet C is. The demo animates the same geometry the top bar wears,
 * which is the point: a build order is how a logo animation is DESCRIBED,
 * and the description happens to be this library's feature list.
 */
export const PARTS: Part[] = [
  { kind: 'box', label: 'Plate', name: 'plate' },
  { kind: 'stroke', label: 'Tail', name: 'tail' },
  { kind: 'stroke', label: 'Head', name: 'head' },
  { kind: 'shape', label: 'Bead', name: 'bead' },
  { kind: 'text', label: 'Wordmark', name: 'word', text: 'CHOREO' },
  { kind: 'stroke', label: 'Rule', name: 'rule' },
  {
    kind: 'text',
    label: 'Tagline',
    name: 'tag',
    text: 'A TIMELINE FOR THE SCENE',
  },
];

export const partOf = (name: string): Part =>
  PARTS.find((part) => part.name === name)!;

/* ── poses ───────────────────────────────────────────────────────────────── */

/**
 * Every property any effect can touch, and what it is when nothing is touching
 * it.
 *
 * Effects return only what they change and the rest is filled in from here, so
 * switching a build from Spin to Wipe cannot leave a stale rotation behind:
 * there is no "previous effect" to clean up after, only a full pose recomputed
 * from scratch at every t.
 */
export interface Pose {
  /** px of gaussian blur; 0 means the element gets `filter: none` outright */
  blur: number;
  /** 0..1 of the element hidden from the right edge */
  clip: number;
  opacity: number;
  pathLength: number;
  rotate: number;
  scale: number;
  x: number;
  y: number;
}

export const NEUTRAL: Pose = {
  blur: 0,
  clip: 0,
  opacity: 1,
  pathLength: 1,
  rotate: 0,
  scale: 1,
  x: 0,
  y: 0,
};

/* ── effects ─────────────────────────────────────────────────────────────── */

export type EffectName =
  'dissolve' | 'draw' | 'drift' | 'move' | 'pop' | 'soften' | 'spin' | 'wipe';

export interface Effect {
  /** the pose at eased progress `p`, which Pop and Spin let exceed 1 */
  at: (p: number) => Partial<Pose>;
  ease: (p: number) => number;
  label: string;
  /** the kinds of part this effect is offered for */
  on: PartKind[];
}

const ALL: PartKind[] = ['box', 'shape', 'stroke', 'text'];

/**
 * Back-out: overshoot the target and settle onto it.
 *
 * This is the curve standing in for a spring, and the substitution is the
 * point rather than a shortcut — see the header. `s` is the classic 1.70158
 * pulled back a little, because a logo mark that wobbles reads as a bug.
 */
const s = 1.44;
const backOut = (p: number) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;

/** most effects want to be fully opaque well before they are fully arrived */
const early = (p: number, rate = 2.2) => Math.min(1, Math.max(0, p * rate));

export const EFFECTS: Record<EffectName, Effect> = {
  dissolve: {
    at: (p) => ({ opacity: p }),
    ease: easeOut,
    label: 'Dissolve',
    on: ALL,
  },
  draw: {
    // opacity stays at 1 throughout: what makes a line draw is that there is
    // less of it, not that it is fainter
    at: (p) => ({ pathLength: p }),
    ease: easeInAndOut,
    label: 'Line Draw',
    on: ['stroke'],
  },
  drift: {
    at: (p) => ({
      opacity: early(p, 1.7),
      scale: 0.78 + 0.22 * p,
      y: 18 * (1 - p),
    }),
    ease: easeOut,
    label: 'Drift and Scale',
    on: ALL,
  },
  move: {
    at: (p) => ({ opacity: early(p, 2.6), x: -38 * (1 - p) }),
    ease: easeOut,
    label: 'Move In',
    on: ['box', 'shape', 'text'],
  },
  pop: {
    at: (p) => ({ opacity: early(p, 3), scale: p }),
    ease: backOut,
    label: 'Pop',
    on: ['box', 'shape', 'text'],
  },
  soften: {
    at: (p) => ({
      blur: 10 * (1 - p),
      opacity: early(p, 1.5),
      scale: 1.06 - 0.06 * p,
    }),
    ease: easeOut,
    label: 'Soften',
    on: ALL,
  },
  spin: {
    at: (p) => ({
      opacity: early(p, 2.4),
      rotate: -150 * (1 - p),
      scale: 0.4 + 0.6 * p,
    }),
    ease: backOut,
    label: 'Spin',
    on: ['box', 'shape', 'text'],
  },
  wipe: {
    at: (p) => ({ clip: 1 - p }),
    ease: easeInAndOut,
    label: 'Wipe',
    on: ['box', 'text'],
  },
};

export const effectsFor = (kind: PartKind) =>
  (Object.keys(EFFECTS) as EffectName[]).filter((name) =>
    EFFECTS[name]!.on.includes(kind)
  );

/* ── delivery ────────────────────────────────────────────────────────────── */

/**
 * How a text build is handed out: all at once, or one cell at a time.
 *
 * This is a second timeline INSIDE a build — the same with/after arithmetic
 * one level down, and the reason the demo is about choreography rather than
 * about eight animations that happen to be numbered. The build still owns its
 * stated window; the cells divide it.
 */
export type Delivery = 'all' | 'character' | 'word';

/** how much of the build's window one cell gets when the cells are staggered */
const CELL = 0.55;

/** which cell a glyph belongs to, and how many cells there are in total */
export interface Slot {
  i: number;
  n: number;
}

/**
 * The window a cell runs in.
 *
 * The last cell must FINISH on the build's end, not start there — otherwise
 * "duration" would mean something different for a staggered build than for a
 * plain one, and the bar drawn on the timeline would be a lie. So the starts
 * are spread across `ms - cellMs` and every cell is the same length.
 */
export function windowOf(cue: Cue, slot: Slot): { at: number; ms: number } {
  if (slot.n <= 1 || cue.ms <= 0) {
    return { at: cue.at, ms: cue.ms };
  }
  const ms = cue.ms * CELL;
  return { at: cue.at + (slot.i * (cue.ms - ms)) / (slot.n - 1), ms };
}

export interface Glyph {
  ch: string;
  /** index among all characters of the part */
  char: number;
  /** index among the part's words */
  word: number;
}

/** a text part's words, each already split into indexed glyphs */
export function wordsOf(text: string): Glyph[][] {
  let char = 0;
  return text
    .split(' ')
    .map((run, word) => [...run].map((ch) => ({ ch, char: char++, word })));
}

export interface Totals {
  chars: number;
  words: number;
}

export function totalsOf(words: Glyph[][]): Totals {
  return {
    chars: words.reduce((sum, run) => sum + run.length, 0),
    words: words.length,
  };
}

/** which cell a glyph is in under each delivery — the inner timeline's index */
export function slotOf(glyph: Glyph, delivery: Delivery, totals: Totals): Slot {
  if (delivery === 'character') {
    return { i: glyph.char, n: totals.chars };
  }
  if (delivery === 'word') {
    return { i: glyph.word, n: totals.words };
  }
  return { i: 0, n: 1 };
}

/* ── the score ───────────────────────────────────────────────────────────── */

/** `with` starts alongside the previous build; `after` waits for it to end */
export type Relation = 'after' | 'with';

export interface Build {
  /** text parts only */
  by: Delivery;
  /** ms added to whichever moment `start` resolves to */
  delay: number;
  effect: EffectName;
  ms: number;
  part: string;
  start: Relation;
}

export interface Cue extends Build {
  at: number;
  end: number;
  /** 1-based, the number the inspector shows */
  no: number;
}

export function schedule(builds: Build[]): Cue[] {
  const cues: Cue[] = [];
  let prevAt = 0;
  let prevEnd = 0;
  builds.forEach((build, i) => {
    // build 1 has no build above it, so its Start is Keynote's "On Click" —
    // the run's own zero — whatever the relation field happens to say
    const base = i === 0 ? 0 : build.start === 'with' ? prevAt : prevEnd;
    const at = Math.max(0, base + build.delay);
    cues.push({ ...build, at, end: at + build.ms, no: i + 1 });
    prevAt = at;
    prevEnd = at + build.ms;
  });
  return cues;
}

/**
 * The last moment anything is still moving, plus a tail to rest on.
 *
 * `max`, not `last`: a `with` and a long delay can put build 3 past the end of
 * build 8, and a runtime taken from the bottom row would cut it off.
 */
export function runtimeOf(cues: Cue[], tail: number): number {
  return cues.reduce((most, cue) => Math.max(most, cue.end), 0) + tail;
}

/**
 * One cell of one build at t.
 *
 * No DOM, no state, no memory of the frame before — which is what lets the
 * playhead be dragged backwards. Progress is clamped before easing so a
 * back-out curve cannot overshoot at the ends of its own window.
 */
export function poseAt(t: number, cue: Cue, slot: Slot): Pose {
  const effect = EFFECTS[cue.effect]!;
  const span = windowOf(cue, slot);
  const raw = span.ms <= 0 ? (t >= span.at ? 1 : 0) : (t - span.at) / span.ms;
  const p = raw <= 0 ? 0 : raw >= 1 ? 1 : effect.ease(raw);
  return { ...NEUTRAL, ...effect.at(p) };
}
