/**
 * A build order — the score's rows, and nothing else.
 *
 * There used to be a scheduler here: `schedule()` resolved with/after into
 * start times, `windowOf`/`slotOf` divided a text build among its glyphs, and
 * `poseAt` sampled the whole scene at t. All of it is the library's language
 * now. A row's two words and a number become a step's anchor — `with` is
 * `{{at 'b3'}}`, `after` is `{{after 'b3'}}` — delivery is `@by`, and the
 * playhead is `c.run.time`. What remains in this file is what the library
 * cannot know: which parts the logo has, and which effects the inspector
 * offers for each kind of part.
 *
 * The effects themselves live in the demo's template, as keyframe values on
 * a `<c.Tween>`: Pop is `@scale={{array 0 1}} @ease='backOut'`. This table
 * only names them and says what they may be applied to — Line Draw is
 * meaningless on a paragraph and By Character is meaningless on a rectangle,
 * so the menu is filtered by kind rather than the effect quietly doing
 * nothing. Keynote's inspector works the same way, for the same reason.
 */

/* ── parts ───────────────────────────────────────────────────────────────── */

export type PartKind = 'box' | 'shape' | 'stroke' | 'text';

export interface Part {
  kind: PartKind;
  label: string;
  /** matched to a `{{motion id=…}}` in the stage */
  name: string;
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
  { kind: 'stroke', label: 'Orbit', name: 'orbit' },
  { kind: 'shape', label: 'Bead', name: 'bead' },
  { kind: 'stroke', label: 'Tip', name: 'tip' },
  { kind: 'text', label: 'Wordmark', name: 'word' },
  { kind: 'stroke', label: 'Rule', name: 'rule' },
  { kind: 'text', label: 'Tagline', name: 'tag' },
];

export const partOf = (name: string): Part =>
  PARTS.find((part) => part.name === name)!;

/* ── effects ─────────────────────────────────────────────────────────────── */

export type EffectName =
  'dissolve' | 'draw' | 'drift' | 'move' | 'pop' | 'soften' | 'spin' | 'wipe';

export interface Effect {
  label: string;
  /** the kinds of part this effect is offered for */
  on: PartKind[];
}

const ALL: PartKind[] = ['box', 'shape', 'stroke', 'text'];

export const EFFECTS: Record<EffectName, Effect> = {
  dissolve: { label: 'Dissolve', on: ALL },
  draw: { label: 'Line Draw', on: ['stroke'] },
  drift: { label: 'Drift and Scale', on: ALL },
  move: { label: 'Move In', on: ['box', 'shape', 'text'] },
  pop: { label: 'Pop', on: ['box', 'shape', 'text'] },
  soften: { label: 'Soften', on: ALL },
  spin: { label: 'Spin', on: ['box', 'shape', 'text'] },
  wipe: { label: 'Wipe', on: ['box', 'text'] },
};

export const effectsFor = (kind: PartKind) =>
  (Object.keys(EFFECTS) as EffectName[]).filter((name) =>
    EFFECTS[name]!.on.includes(kind)
  );

/* ── the score ───────────────────────────────────────────────────────────── */

/** `with` starts alongside the previous build; `after` waits for it to end */
export type Relation = 'after' | 'with';

/** how a text build is handed out — `@by` wears the same words */
export type Delivery = 'all' | 'character' | 'word';

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
