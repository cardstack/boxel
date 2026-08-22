/**
 * The vocabulary of a choreography — boxel-motion's Sprite / Changeset /
 * AnimationDefinition, as this binding keeps them. See docs/choreography.md.
 */
import type { VisualElement } from 'motion-dom';

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
  type: SpriteType;
}

/** boxel-motion's spritesFor criteria, plus the boundsDelta filter from its motion-study */
export interface Query {
  id?: string;
  role?: string;
  type?: SpriteType | 'moved' | 'still';
}

export type PropValue = number | string;
/** a step property: a value, or a function of the sprite and the whole changeset */
export type PropSource =
  PropValue | ((sprite: Sprite, changeset: ChangesetLike) => PropValue);

export interface ChangesetLike {
  all: Sprite[];
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
  stiffness?: number;
  velocity?: number;
  visualDuration?: number;
}

interface StepBase {
  /** milliseconds before the step starts, inside its slot */
  delay?: number;
  of: Query | Query[];
}

export interface TweenStep extends StepBase {
  ease?: string | number[];
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
  ease?: string | number[];
  kind: 'move';
  ms?: number;
  /** animate width/height as well as position (default true) */
  size?: boolean;
  spring?: SpringSpec;
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
