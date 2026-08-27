/**
 * The vocabulary of a choreography — boxel-motion's Sprite / Changeset /
 * AnimationDefinition, as this binding keeps them. See docs/choreography.md.
 */
import type { VisualElement } from 'motion-dom';

import type { AnchorRef } from './anchors.ts';
import type { BeaconRef } from './beacons.ts';
import type { GestureRef } from './gesture.ts';

export type SpriteType = 'inserted' | 'kept' | 'removed';

export interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** one measurement of a participant, in the three spaces a step may want it in */
export interface Bounds {
  /** relative to the <Choreo> box — where an orphan is locked */
  context: Rect;
  /** viewport coordinates */
  page: Rect;
  /**
   * The computed background the element wore when this box was taken —
   * captured with the geometry because a removed skin's element is detached
   * by the time a crossing wants to turn its alpha into an actual color
   * (§4.7), and a detached element's computed style is empty.
   */
  paint?: string;
  /** relative to the element's offset parent — where a kept sprite moves */
  parent: Rect;
  /**
   * The box of the element's declared subject ([data-choreo-substance]) at
   * measure time, in page space. A shape-matched flight (size='scale')
   * aligns the SUBSTANCE when either end declares one — Keynote matches
   * objects, not slide frames — deriving the undeclared end by fraction.
   */
  substance?: Rect;
}

/** what a choreography needs from one {{motion}} element */
export interface ChoreoNode {
  element?: Element;
  /** the Presence it lives under has let it go, and this run is done with it */
  exitComplete(): void;
  id: string | null;
  isPresent: boolean;
  /** stable identity for this node, for bookkeeping keyed per element */
  layoutKey: string;
  /** carries its own animate/exit/initial — a second scheduler (§5.3) */
  ownAnimation?: boolean;
  /** wrapped by a <Presence> that manages it — double retention (§5.3) */
  presenceManaged?: boolean;
  /** unmount a VisualElement whose teardown was deferred to the choreography */
  release(): void;
  role: string | null;
  visualElement?: VisualElement;
}

export interface Sprite {
  /** this removed sprite's identity was claimed by an arriving element as its counterpart */
  claimed?: boolean;
  /** the removed element an inserted id replaced in the same pass */
  counterpart?: Sprite;
  /** final − initial, parent-relative (kept sprites) */
  delta?: Rect;
  element: HTMLElement;
  /** measured after the render pass (kept, inserted) */
  final?: Bounds;
  id: string | null;
  /** measured before the render pass (kept, removed) */
  initial?: Bounds;
  node: ChoreoNode;
  role: string | null;
  /** far matching: this sprite's identity was received by another region, so its own region lets it go */
  sent?: boolean;
  type: SpriteType;
}

/**
 * boxel-motion's spritesFor criteria, plus the boundsDelta filter from its
 * motion-study and the two halves of a counterpart pair. `received` is a kept
 * sprite that arrived this pass carrying a counterpart — the receiving half of
 * counterpart or far matching; `counterpart` is the removed half it claimed.
 * Both exist so a step can address exactly the flight passes and none of the
 * ordinary ones: a kept query also matches a sprite whose bounds merely
 * changed, which is every resize the region ever sees.
 */
export interface Query {
  id?: string;
  /**
   * Keynote's slide rule (§4.7): only animate what a viewport can see.
   * A removed sprite is judged against where it stood when the old scene
   * was on screen (its initial box, measured before any crossing scroll);
   * everything else against where it will stand (its final box, measured
   * after). Sprites entirely outside the window are simply not selected —
   * a leaver nobody can watch drops without a frame, an arrival below the
   * fold just stands.
   */
  onstage?: boolean;
  role?: string;
  type?:
    | SpriteType
    | 'moved'
    | 'still'
    | 'received'
    | 'counterpart'
    /** removed and claimed by nobody: what only the old scene had */
    | 'departed';
}

export type PropValue = number | string;
/** a property target: one value, or a keyframe array (a round trip is an array that returns) */
export type PropTarget = PropValue | PropValue[];
/** a step property: a target, or a function of the sprite and the whole changeset */
export type PropSource =
  PropTarget | ((sprite: Sprite, changeset: ChangesetLike) => PropTarget);

export interface ChangesetLike {
  all: Sprite[];
  /** the box a `{{beacon}}` claimed this pass, or null */
  beacon(name: string): Bounds | null;
  /** something happened this pass a choreography could animate */
  dirty: boolean;
  /**
   * The region frame's own size in LOCAL pixels, from the same final
   * layout every sprite was measured in — the camera's centre reference.
   */
  frame?: { height: number; width: number };
  /**
   * The color the page actually shows behind this region — the nearest
   * ancestor with a real background. What a semi-transparent skin's alpha
   * is blended against when a crossing turns it into an actual color.
   */
  ground?: string;
  inserted: Sprite[];
  kept: Sprite[];
  /**
   * The camera zoom the world was measured under (§6.3): page-space boxes
   * carry the frame's transform, local inline values do not, and this is
   * the ratio between the two spaces. Absent means 1 — the frame at rest.
   */
  measureZoom?: number;
  removed: Sprite[];
  sprite(query: Query | Query[]): Sprite | null;
  sprites(query: Query | Query[]): Sprite[];
}

export interface SpringSpec {
  bounce?: number;
  damping?: number;
  mass?: number;
  /** how far from the target still counts as arrived (the legacy's restDisplacementThreshold) */
  restDelta?: number;
  /** how slow still counts as stopped (the legacy's restVelocityThreshold) */
  restSpeed?: number;
  stiffness?: number;
  /** present so the `spring` helper's output fits both `@spring=` and `transition=` */
  type?: 'spring';
  velocity?: number;
  visualDuration?: number;
}

interface StepBase {
  /** start against a named step instead of this step's place in its block */
  at?: AnchorRef;
  /**
   * Milliseconds before the step starts, inside its slot. The template speaks
   * seconds (`@delay={{0.2}}`, as Motion does); the step components convert at
   * the boundary, and everything from here down is one ms clock.
   */
  delay?: number;
  /**
   * The yield rule (§4.7): a generic step surrenders any sprite that a
   * specific (non-generic) step in the same timeline also names. That is
   * how "a special exit that is NOT just a dissolve" is said — write the
   * step, and the canned dissolve yields the sprite entirely.
   *
   * A COMPOSITE step should mark the children it generates generic. It is
   * what makes an opinionated default feel like a default rather than a
   * cage: whoever uses the composite can override one role by writing a
   * plain step beside it, and needs no exclusion syntax to do it. Steps
   * written directly in a template are never generic — saying it there
   * would mean "ignore me if anyone else asks".
   */
  generic?: boolean;
  /** a label other steps may anchor against (`@at={{at 'name'}}`) */
  name?: string;
  of: Query | Query[];
  /**
   * Milliseconds between one matched sprite and the next, in the order the
   * query returned them (seconds in the template). The step's own length grows
   * by the whole ladder, so a sequence still waits for the last sprite.
   */
  stagger?: number;
}

/** a named engine easing, a cubic-bezier as four numbers, or any function of 0..1 */
export type Easing = string | readonly number[] | ((t: number) => number);

/** Keynote's delivery panel: what the unit of delivery is, and in what order */
export type DeliveryBy = 'character' | 'item' | 'paragraph' | 'word';
export type DeliveryOrder = 'center' | 'forward' | 'random' | 'reverse';

export interface TweenStep extends StepBase {
  /** split a text sprite's delivery; 'item' (default) delivers whole sprites */
  by?: DeliveryBy;
  ease?: Easing;
  kind: 'tween';
  ms: number;
  order?: DeliveryOrder;
  props: Record<string, PropSource>;
  /** extra plays after the first; Infinity is an ambient loop, phase on the run clock */
  repeat?: number;
  repeatType?: 'loop' | 'mirror' | 'reverse';
}
export interface SpringStep extends StepBase {
  by?: DeliveryBy;
  kind: 'spring';
  order?: DeliveryOrder;
  props: Record<string, PropSource>;
  spring?: SpringSpec;
}
export interface MoveStep extends StepBase {
  ease?: Easing;
  /** borrow a beacon's box — or the live gesture — as the start of the move */
  from?: BeaconRef | GestureRef;
  kind: 'move';
  ms?: number;
  /**
   * An SVG path for the journey, drawn from where the sprite stands (§4.4).
   * The path is similarity-mapped so its start is the sprite's start and its
   * end is the measured landing — the path bends the journey, never the
   * destination.
   */
  path?: string;
  /** 'auto' orients along the tangent; a number adds a constant offset to it */
  rotate?: 'auto' | number;
  /** animate width/height as well as position (default true) */
  /**
   * `false` skips size; `'scale'` matches shape by TRANSFORM about the
   * centre instead of animating layout width/height — a flight that must
   * not reflow the scene around it (the crossing's receiver was
   * stretching its whole grid row). Content distorts through the flight
   * exactly as a Magic Move's does; the crossfade hides it. `'crop'` is
   * iOS's rule instead: UNIFORM scale, matched by cover, with the aspect
   * mismatch carried by an animated crop window — the old box at liftoff,
   * the element's own at landing — so nothing ever stretches.
   */
  size?: boolean | 'crop' | 'scale';
  /**
   * Which space the delta is measured in (§6.1). 'page' (default) is the
   * one space two regions agree on; 'parent' resolves the flight against
   * the sprite's own (possibly animating) container.
   */
  space?: 'page' | 'parent';
  spring?: SpringSpec;
  /** the counterpart-skin policy: cross mid-flight, carry to the landing, or neither (§6.3) */
  swap?: 'during' | 'none' | 'settle';
  /** borrow a beacon's box as the end of the move instead of where the sprite landed */
  to?: BeaconRef;
}
export interface HoldStep extends StepBase {
  /** keep the values after the window instead of releasing them */
  fill?: boolean;
  kind: 'hold';
  /** the window; without it, the enclosing block's span */
  ms?: number;
  props: Record<string, PropSource>;
}
/**
 * The steps that have no subject. A wait is a hole in a sequence and a
 * tether reads only its two ends — neither has anything to say about the
 * sprite `of` would name, and requiring one meant every author wrote
 * `@of={{c.all}}`: a query run on every pass to answer a question nothing
 * asks, and a lie about what the step reads. Absent, the step produces one
 * cue rather than one per sprite.
 */
interface SubjectlessBase extends Omit<StepBase, 'of'> {
  of?: Query | Query[];
}

export interface WaitStep extends SubjectlessBase {
  kind: 'wait';
  ms: number;
}

/**
 * A semantic command on the timeline (§C4): dispatched once as playback
 * crosses its time, included by a seek that lands past it, excluded — via
 * reset-and-replay — by a seek that lands before it. A command is an
 * idempotent statement of state (`lightbox.open`), never a time-sensitive
 * toggle: the fold re-derives the commanded state from the clock, so a
 * command may be dispatched again whenever the state is re-derived.
 */
export interface PerformStep extends SubjectlessBase {
  action: string;
  kind: 'perform';
  payload?: unknown;
  target?: string;
}

/** a `c.Perform` command as the run hands it to the host's dispatcher */
export interface PerformCommand {
  action: string;
  payload?: unknown;
  target?: string;
  /** the command's place on the run's clock, seconds at 1× */
  time: number;
}
/** scroll the sprite's container so the sprite lands at @align (§6.1) */
export interface ScrollStep extends StepBase {
  align?: 'center' | 'end' | 'start';
  kind: 'scroll';
  ms?: number;
}

/**
 * Promote the sprites to the region's elevated layer for the window (§6.3):
 * above every stacking context and overflow clip in the region. `z-index`
 * cannot say this; a real layer can.
 */
export interface RaiseStep extends StepBase {
  kind: 'raise';
  /** the window; without it, the enclosing block's span */
  ms?: number;
  /** cast on the layer below — the tray's shadow on the plane beneath */
  shadow?: boolean;
}

/**
 * The region's frame as a timeline step (§6.3): zoom and pan the scene,
 * `@origin` aiming at a sprite, `@steady` naming sprites that keep their
 * size (damped by default — the relative-scale research's curves, §6.4).
 */
export interface CameraStep extends StepBase {
  /**
   * Dive on this sprite and centre it: the library computes zoom AND pan
   * from the sprite's rest-layout box and the frame's own size — the same
   * measurement space FLIP uses, so it is correct even when the click
   * lands mid-flight on a different tile. `null` (as opposed to absent)
   * says "fit nothing": back to the resting identity. `@zoom` alongside
   * overrides the computed magnification but keeps the centring.
   */
  /** recentre on this sprite, zoom held — the Aim preset's field */
  aim?: Query;
  ease?: Easing;
  fit?: Query | null;
  kind: 'camera';
  /**
   * With `fit`: the fraction of the frame the sprite fills once centred,
   * on whichever axis fits first. Defaults to 0.72.
   */
  margin?: number;
  ms?: number;
  /** aim the zoom at this sprite's centre — held in place, not recentred */
  origin?: Query;
  /** shift the pose in force by this many px — the Pan preset's field */
  panBy?: { x?: number; y?: number };
  spring?: SpringSpec;
  /** sprites that hold their size against the zoom, damped */
  steady?: Query | Query[];
  x?: number;
  y?: number;
  zoom?: number;
  /** multiply the zoom in force by this factor — the SlowZoom preset */
  zoomBy?: number;
}

/**
 * Geometry continuously derived from sprites (§6.1): every frame of the run
 * (and every scrubbed still), `@path` receives both endpoints' boxes,
 * region-relative, and returns the path data the tether draws.
 */
export interface TetherStep extends SubjectlessBase {
  from: Query;
  kind: 'tether';
  /** the window; without it, the enclosing block's span */
  ms?: number;
  path: (from: Rect, to: Rect) => string;
  to: Query;
}

/**
 * One source of a derived value: the boxes the PASS measured, in region
 * space, named for which box each one is — because the distinction
 * between resting and live geometry is the whole correctness argument
 * (docs/postmortem-follow.md). `from` and `to` are resting layout, where
 * the stylesheet put the sprite on either side of this change; `now` is
 * `to` composed with the transform the run is driving this frame. None
 * of the three is read from the page while the run plays.
 */
export interface FollowSource {
  /** its resting box before this change (equal to `to` when it did not move) */
  from: Rect;
  /** where the run holds it THIS frame — arithmetic, not a measurement */
  now: Rect;
  /** its resting box after the change — where the run will land it */
  to: Rect;
}

/**
 * What a derived value is computed FROM, handed to `@read` every frame
 * and every scrubbed still. All geometry comes from the pass's own
 * measurements, region-relative, so a follower lands on its source at
 * any camera zoom — and never touches the page while it runs.
 */
export interface DeriveContext {
  /** where the region's frame stands this frame */
  camera: CameraState;
  /** 0..1 across this step's own window */
  p: number;
  /** the driven sprite's own RESTING box — it never contains what the follower writes */
  rest: Rect;
  /** the sprites named by `@to`, in the order the query returned them */
  sources: FollowSource[];
  /** seconds on the run's clock */
  t: number;
}

/**
 * A value derived from the scene rather than interpolated between two
 * keyframes (§4.10) — a badge that rides a flying card, a label held
 * upright under a rotating parent, a readout that tracks a box.
 *
 * `@read` is pure BY CONSTRUCTION: it is handed boxes the pass already
 * measured — never the live page — so there is no way for a follower to
 * read back what it just wrote, and nothing it does can force a style
 * recalculation mid-move. It must still be a pure function of its
 * context: the run is scrubbable in both directions, and a derived value
 * with memory would make a seek irreproducible. It is computed on the
 * main thread every frame — a follower can never be handed to the
 * compositor — and it may only write transform, opacity and filter
 * properties, because a derived write that changed layout would fail the
 * region's fast keep on every frame.
 */
export interface FollowStep extends StepBase {
  kind: 'follow';
  /** the window; without it, the enclosing block's span */
  ms?: number;
  read: (ctx: DeriveContext) => Record<string, PropValue>;
  /** what each written property is at rest, so a measure pass can undo it */
  rest: Record<string, PropValue>;
  /** what to read — one query, however many sprites it returns */
  to: Query | Query[];
}

export type Step =
  | CameraStep
  | FollowStep
  | HoldStep
  | MoveStep
  | PerformStep
  | RaiseStep
  | ScrollStep
  | SpringStep
  | TetherStep
  | TweenStep
  | WaitStep;

/** park the run until advance(); `ms` opens it by itself (§4.1) */
export interface GateNode {
  kind: 'gate';
  /** self-open delay, ms (template: `@delay` seconds) */
  ms?: number;
}

export interface Block {
  /**
   * Start against a named step or block instead of this block's place in
   * its own block's flow. An anchored block lifts out exactly as an
   * anchored step does (§4.2): it neither pushes a sequence forward nor
   * stretches its parent's span.
   */
  at?: AnchorRef;
  children: TimelineNode[];
  /**
   * Milliseconds before the block's contents start, inside its slot. The
   * template speaks seconds; the block component converts at the boundary.
   */
  delay?: number;
  kind: 'parallel' | 'sequence';
  /**
   * A label other steps may anchor against — the block's span is its
   * contents, so `{{after 'intro'}}` means after the LONGEST thing in it.
   * This is what makes a composite step (a `node()` that returns a block —
   * `c.Crossing`, and anything an author writes) something the rest of the
   * score can point at, rather than an opaque lump.
   */
  name?: string;
}
export type TimelineNode = Block | GateNode | Step;

/** a gate, placed on the run's clock */
export interface GateMark {
  at: number;
  /** self-open: resume this long after parking, unadvanced */
  auto?: number;
}

export interface Compiled {
  cues: Cue[];
  gates: GateMark[];
  /**
   * The score has no length of its own: every cue in it is an OPEN step
   * (a tether, hold, raise or follow without `@duration`) and there is no
   * enclosing span for them to borrow. Such a score is an annotation that
   * is simply on, and its run stands rather than ending — see Cue.standing.
   */
  open?: boolean;
}

/** where the region's frame stands — yielded, tracked, updated at step boundaries */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** a sampled flight path: points at even progress, in the sprite's own space */
export interface FlightPath {
  points: { x: number; y: number }[];
  /** what the element's x/y are at rest, to subtract for kept sprites */
  rest: { x: number; y: number };
  /** tangent-follow: degrees added on top when a number was given */
  rotate?: 'auto' | number;
}

/** one resolved thing to do to one sprite, in milliseconds from the run's start */
export interface Cue {
  /**
   * These values are BORROWED, not owned: the run removes them — motion
   * value and inline style both — when it ends or is released, so the
   * stylesheet's own declaration stands again. The crossing's color-carry
   * uses this: the solid it paints mid-flight is handed back to the real
   * alpha blend on landing.
   */
  borrow?: boolean;
  /** camera: drive the region's frame */
  camera?: {
    /** relative move: resolved against the pose in force at cue start */
    by?: { x?: number; y?: number; zoom?: number };
    /** the frame's centre in the same final layout `origin` was measured in */
    centre?: { x: number; y: number };
    origin?: { x: number; y: number };
    steady: Sprite[];
    to: { x?: number; y?: number; zoom?: number };
  };
  /** text delivery: the run splits the sprite and plays the slots inside `duration` */
  delivery?: { by: DeliveryBy; order: DeliveryOrder; stagger: number };
  /** follow: compute this sprite's values from the pass's measurements, every frame */
  derive?: {
    read: (ctx: DeriveContext) => Record<string, PropValue>;
    rest: Record<string, PropValue>;
    /** the follower's own resting box, region space, from the pass */
    restBox: Rect;
    /** each source's measured ends, with the sprite whose transform composes `now` */
    sources: { from: Rect; sprite: Sprite; to: Rect }[];
  };
  duration: number;
  /** move: travel along this sampled path instead of the straight line */
  flight?: FlightPath;
  /** hold: the values to set (and whether to keep them) */
  hold?: { fill: boolean; values: Record<string, PropValue> };
  kind: Step['kind'];
  /** an infinite-repeat tween: plays past the run's end, excluded from its length */
  loop?: boolean;
  /** perform: the semantic command the fold dispatches at this cue's time */
  perform?: { action: string; payload?: unknown; target?: string };
  /** raise: promote to the elevated layer for the window */
  raise?: { shadow: boolean };
  /** scroll: animate the sprite's scroll container to this alignment */
  scroll?: { align: 'center' | 'end' | 'start' };
  sprite: Sprite;
  /**
   * An open step in a score with no span to borrow: it holds from its start
   * until the run is cancelled or replaced, and its (infinite) duration is
   * excluded from the run's length. The standing wire, the standing raise —
   * an annotation whose lifetime is the scene's, not a step's.
   */
  standing?: boolean;
  start: number;
  /** tween / spring / move: the engine target… */
  target?: Record<string, unknown>;
  /** tether: draw between these two, every frame */
  tether?: {
    from: Sprite | null;
    /** the step's @name, forwarded so the path can be styled per wire */
    name?: string;
    path: (from: Rect, to: Rect) => string;
    to: Sprite | null;
  };
  /** …and its transition, without the delay the start supplies */
  transition?: Record<string, unknown>;
}
