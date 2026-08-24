/**
 * Template helpers — Motion's meanings, written the way a `.gts` file writes
 * things.
 *
 *   import { motion, to, spring } from 'glimmer-motion';
 *
 *   <div
 *     {{motion
 *       initial=(to opacity=0 y=20)
 *       animate=(to opacity=1 y=0)
 *       exit=(to opacity=0 scale=0.9)
 *       transition=(spring stiffness=300 damping=30)
 *     }}
 *   ></div>
 *
 * These are plain functions, used as helpers with no registration and no
 * `helper()` wrapper: Glimmer hands a plain function its positional arguments,
 * and its named arguments as one trailing object — which is exactly the shape
 * `spring({ stiffness: 300 })` already wanted.
 *
 * `(hash …)` still works and always will; it is not what the docs teach,
 * because it is untyped in the way that matters. `(hash opacty=1)` is a
 * perfectly good hash. `(to opacty=1)` is a Glint error, because `to` returns
 * Motion's `TargetAndTransition` and the compiler knows what lives in one.
 *
 * Naming: `to` rather than `animate`, even though `animate` is the prop it most
 * often feeds. It reads correctly in all four slots — `initial=(to …)`,
 * `exit=(to …)`, `whileHover=(to …)` — where `animate=(animate …)` does not,
 * and it leaves the name `animate` free for Motion's imperative function.
 */
import type { MotionValue, TargetAndTransition, Transition } from 'motion-dom';

/** motion-dom's own stagger(), which is already a plain function: `delayChildren=(stagger 0.05)` */
export { stagger } from 'motion-dom';

/**
 * The values to animate to. `(to x=0 opacity=1)` is the object `{ x: 0,
 * opacity: 1 }` — the helper exists for its type, not its arithmetic. That type
 * is Motion's own `TargetAndTransition`, so a target built here goes anywhere a
 * target goes, `transition` and `transitionEnd` included.
 */
export function to(values: TargetAndTransition = {}): TargetAndTransition {
  return values;
}

/**
 * CSS for a motion element: `style=(styles x=this.x y=this.y)`.
 *
 * Not a target — these are not animated to, they are what the element IS, and
 * a MotionValue handed in here is bound rather than tweened. It is a separate
 * helper for that reason, and because `style` is the one prop you must not
 * pass as an attribute (Glimmer would rewrite the whole declaration and wipe
 * the transform Motion just rendered).
 */
export function styles(
  values: Record<string, MotionValue<never> | number | string> = {},
): Record<string, unknown> {
  return values;
}

/**
 * The starting values for a <Choreo> step: `@from={{start opacity=0}}`.
 *
 * A map of property to value, not a target and not a transition — each entry
 * may also be a function of the sprite and the changeset, which is how one
 * element starts from another's measurement.
 *
 * Named `start` rather than `from`, which is what it fills in. A helper called
 * `from` cannot be resolved by Glimmer's strict-mode scope pass — the template
 * compiler rejects it — and it reads as an import statement everywhere it
 * appears. Glint is happy with it, so the only signal is the dev server
 * refusing to build.
 */
export function start<T>(values: Record<string, T> = {}): Record<string, T> {
  return values;
}

/**
 * A transition per animated value: `transition=(perValue opacity=(tween
 * duration=0.16) y=(spring bounce=0.38))`.
 *
 * Motion reads `transition[key]` in preference to the transition itself, so
 * this is how one element's opacity gets a short tween while its position gets
 * a spring. `default` covers everything not named.
 */
export function perValue(values: Record<string, Transition> = {}): Transition {
  return values as Transition;
}

export interface SpringArgs {
  bounce?: number;
  damping?: number;
  delay?: number;
  mass?: number;
  /** how far from the target still counts as arrived */
  restDelta?: number;
  /** how slow still counts as stopped */
  restSpeed?: number;
  stiffness?: number;
  /** the perceived duration, from which stiffness and damping are derived */
  visualDuration?: number;
}

/**
 * `transition=(spring stiffness=300 damping=30)`, and `@spring={{spring …}}`
 * on a <Choreo> step — the return type satisfies both, which is why it is not
 * simply `Transition`.
 */
export function spring(options: SpringArgs = {}): SpringArgs & {
  type: 'spring';
} {
  return { type: 'spring', ...options };
}

export interface TweenArgs {
  delay?: number;
  duration?: number;
  ease?: Transition['ease'];
  repeat?: number;
  repeatDelay?: number;
  repeatType?: 'loop' | 'mirror' | 'reverse';
  times?: number[];
}

/** `transition=(tween duration=0.4 ease="backOut")` — seconds, as Motion counts them */
export function tween(options: TweenArgs = {}): TweenArgs & { type: 'tween' } {
  return { type: 'tween', ...options };
}

export interface InertiaArgs {
  bounceDamping?: number;
  bounceStiffness?: number;
  max?: number;
  min?: number;
  modifyTarget?: (v: number) => number;
  power?: number;
  restDelta?: number;
  timeConstant?: number;
  velocity?: number;
}

/** `dragTransition=(inertia power=0.28)` — the throw after a drag ends */
export function inertia(options: InertiaArgs = {}): InertiaArgs & {
  type: 'inertia';
} {
  return { type: 'inertia', ...options };
}

/**
 * A cubic bezier as four numbers: `ease=(ease 0.4 0 0.1 1)`.
 *
 * Motion's named easings (`'easeInOut'`, `'backOut'`, `'circIn'`…) are plain
 * strings and need no helper — write them as strings.
 */
export function ease(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [number, number, number, number] {
  return [x1, y1, x2, y2];
}
