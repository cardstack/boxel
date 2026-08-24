/**
 * The vocabulary of a choreography — boxel-motion's Sprite / Changeset /
 * AnimationDefinition, as this binding keeps them. See docs/choreography.md.
 */
import type { VisualElement } from 'motion-dom';

import type { BeaconRef } from './beacons.ts';

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
  /** relative to the element's offset parent — where a kept sprite moves */
  parent: Rect;
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
  role?: string;
  type?: SpriteType | 'moved' | 'still' | 'received' | 'counterpart';
}

export type PropValue = number | string;
/** a step property: a value, or a function of the sprite and the whole changeset */
export type PropSource =
  PropValue | ((sprite: Sprite, changeset: ChangesetLike) => PropValue);

export interface ChangesetLike {
  all: Sprite[];
  /** the box a `{{beacon}}` claimed this pass, or null */
  beacon(name: string): Bounds | null;
  /** something happened this pass a choreography could animate */
  dirty: boolean;
  inserted: Sprite[];
  kept: Sprite[];
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
  /** milliseconds before the step starts, inside its slot */
  delay?: number;
  of: Query | Query[];
  /**
   * Milliseconds between one matched sprite and the next, in the order the
   * query returned them. The step's own length grows by the whole ladder, so a
   * sequence still waits for the last sprite to finish.
   */
  stagger?: number;
}

/** a named engine easing, a cubic-bezier as four numbers, or any function of 0..1 */
export type Easing = string | number[] | ((t: number) => number);

export interface TweenStep extends StepBase {
  ease?: Easing;
  from?: Record<string, PropSource>;
  kind: 'tween';
  ms: number;
  props: Record<string, PropSource>;
}
export interface SpringStep extends StepBase {
  from?: Record<string, PropSource>;
  kind: 'spring';
  props: Record<string, PropSource>;
  spring?: SpringSpec;
}
export interface MoveStep extends StepBase {
  ease?: Easing;
  /** borrow a beacon's box as the start of the move instead of where the sprite was */
  from?: BeaconRef;
  kind: 'move';
  ms?: number;
  /** animate width/height as well as position (default true) */
  size?: boolean;
  spring?: SpringSpec;
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
export interface WaitStep extends StepBase {
  kind: 'wait';
  ms: number;
}
export type Step = HoldStep | MoveStep | SpringStep | TweenStep | WaitStep;

export interface Block {
  children: TimelineNode[];
  kind: 'parallel' | 'sequence';
}
export type TimelineNode = Block | Step;

/** one resolved thing to do to one sprite, in milliseconds from the run's start */
export interface Cue {
  duration: number;
  /** hold: the values to set (and whether to keep them) */
  hold?: { fill: boolean; values: Record<string, PropValue> };
  kind: Step['kind'];
  sprite: Sprite;
  start: number;
  /** tween / spring / move: the engine target… */
  target?: Record<string, unknown>;
  /** …and its transition, without the delay the start supplies */
  transition?: Record<string, unknown>;
}
