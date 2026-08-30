/**
 * The timeline, declared in the template. Each step renders a hidden marker
 * so the region can read the tree back in document order — nesting in the
 * markup IS the sequence/parallel nesting. Nothing here animates; the region
 * compiles these into cues when a render pass produces a changeset.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { type AnchorRef, at } from './anchors.ts';
import type { BeaconRef } from './beacons.ts';
import type { GestureRef } from './gesture.ts';
import type {
  Block,
  DeliveryBy,
  DeliveryOrder,
  DeriveContext,
  Easing,
  PropSource,
  PropValue,
  Query,
  Rect,
  SpringSpec,
  TimelineNode,
} from './types.ts';

interface Provider {
  node(): TimelineNode;
}

const providers = new WeakMap<Element, Provider>();

/** unnamed crossings still need a stable, unique inner anchor name */
let crossings = 0;

/** the steps directly inside an element, in document order; a nested <Choreo> is another region's */
export function collect(el: Element): TimelineNode[] {
  const out: TimelineNode[] = [];
  for (const child of Array.from(el.children)) {
    if (child.hasAttribute('data-choreo')) {
      continue;
    }
    const provider = providers.get(child);
    if (provider) {
      out.push(provider.node());
    } else {
      out.push(...collect(child));
    }
  }
  return out;
}

/**
 * args that are the step's own; every other named arg is a property to animate.
 * `rotate` is NOT here although Move has a `@rotate` arg: on a Tween or
 * Spring it is a property (Keynote's Spin), and Move never reads its props.
 */
const RESERVED = new Set([
  'align',
  'at',
  'by',
  'delay',
  'duration',
  'ease',
  'fill',
  'from',
  'name',
  'of',
  'order',
  'path',
  'read',
  'repeat',
  'repeatType',
  'rest',
  'shadow',
  'size',
  'space',
  'spring',
  'stagger',
  'swap',
  'to',
]);

/** the pre-seconds spellings, kept only to fail loudly with the new name */
const RENAMED: Record<string, string> = {
  crossfade: '@swap',
  ms: '@duration (in seconds)',
  overlap: '@stagger (in seconds)',
};

function propsOf(args: Record<string, unknown>): Record<string, PropSource> {
  const props: Record<string, PropSource> = {};
  for (const key of Object.keys(args)) {
    if (args[key] === undefined) {
      continue;
    }
    if (RENAMED[key]) {
      throw new Error(`choreo: @${key} was renamed — use ${RENAMED[key]}`);
    }
    if (!RESERVED.has(key)) {
      props[key] = args[key] as PropSource;
    }
  }
  return props;
}

/**
 * The template speaks seconds, as Motion does; the compiler's clock is ms.
 * A composite step writes node literals, which are BELOW that boundary —
 * so it converts its own seconds args here, and `undefined` stays
 * `undefined` so an unset arg still means "take the default".
 */
export function toMs<T extends number | undefined>(
  seconds: T,
): T extends number ? number : number | undefined {
  // the conditional return type is the whole point — a required `ms` field
  // takes toMs(x) without a null check when x is a number — and TypeScript
  // cannot verify a conditional return from inside, so the cast is the
  // price of stating it
  return (
    seconds === undefined ? undefined : seconds * 1000
  ) as T extends number ? number : number | undefined;
}

const msOf = toMs;

/** the args every step shares — a composite step extends this */
export interface StepArgsBase {
  [prop: string]: unknown;
  /** `{{at 'name' 0.4}}` / `{{after 'name' 0.2}}` — start against a named step */
  at?: AnchorRef;
  /** seconds before the step starts, inside its slot */
  delay?: number;
  /** a label other steps may anchor against */
  name?: string;
  /** seconds between one matched sprite and the next, in document order */
  stagger?: number;
}

/** …and the args of a step that names sprites */
export interface StepArgs extends StepArgsBase {
  of: Query | Query[];
}

/**
 * The base every step is built on, and the public seam for a COMPOSITE
 * step — a new word in the timeline that expands into the built-in
 * vocabulary. `c.Crossing` is one, and is written in nothing but this.
 *
 * Subclass it, implement `node()`, and render the component anywhere
 * inside a `<Choreo>`: the region reads the tree back in document order
 * and your node takes its place in it.
 *
 * ```gts
 * export class Reveal extends StepComponent<StepArgs & { rise?: number }> {
 *   node(): TimelineNode {
 *     const { of, name, rise = 12 } = this.args;
 *     return {
 *       at: this.args.at,
 *       children: [
 *         { kind: 'tween', generic: true, of, ms: 240, props: { opacity: [0, 1] } },
 *         { kind: 'tween', generic: true, of, ms: 240, props: { y: [rise, 0] } },
 *       ],
 *       kind: 'parallel',
 *       name,
 *     };
 *   }
 * }
 * ```
 *
 * **`node()` is called on every pass**, and its result is fingerprinted to
 * decide whether an edited timeline replays the run. So it must be pure
 * and cheap: no measurement, no DOM writes, no tracked writes (a tracked
 * write re-renders, which replays the pass, which calls `node()`). And
 * because functions in the tree are compared by identity, a `node()` that
 * allocates a fresh closure per call declares an edit on every pass —
 * hoist property functions to module scope.
 *
 * Two conventions worth keeping: mark children `generic: true` so a
 * sibling step can claim a sprite away from your defaults (the yield
 * rule, §4.7), and derive any inner `name` from your own `@name` so two
 * of your step in one timeline do not collide.
 */
export abstract class StepComponent<A extends StepArgsBase> extends Component<{
  Args: A;
}> {
  abstract node(): TimelineNode;
  mark = modifier((el: Element) => {
    providers.set(el, this);
    return () => providers.delete(el);
  });
  <template>
    <span hidden data-choreo-step {{this.mark}}></span>
  </template>
}

export class Tween extends StepComponent<
  StepArgs & {
    /** split a text sprite's delivery: by word, character, or paragraph */
    by?: DeliveryBy;
    /** seconds, as Motion counts them */
    duration: number;
    ease?: Easing;
    order?: DeliveryOrder;
    /** extra plays after the first; `Infinity` is an ambient loop whose phase rides the run clock */
    repeat?: number;
    repeatType?: 'loop' | 'mirror' | 'reverse';
  }
> {
  node(): TimelineNode {
    const { of, by, duration, ease, delay, order, repeat, repeatType } =
      this.args;
    return {
      at: this.args.at,
      by,
      delay: msOf(delay),
      ease,
      kind: 'tween',
      name: this.args.name,
      ms: duration * 1000,
      of,
      order,
      props: propsOf(this.args),
      repeat,
      repeatType,
      stagger: msOf(this.args.stagger),
    };
  }
}

export class Spring extends StepComponent<
  StepArgs & {
    by?: DeliveryBy;
    order?: DeliveryOrder;
    spring?: SpringSpec;
  }
> {
  node(): TimelineNode {
    const { of, by, spring, delay, order } = this.args;
    return {
      at: this.args.at,
      by,
      delay: msOf(delay),
      kind: 'spring',
      name: this.args.name,
      of,
      order,
      props: propsOf(this.args),
      spring,
      stagger: msOf(this.args.stagger),
    };
  }
}

export class Move extends StepComponent<
  StepArgs & {
    /** seconds; with @ease, the tween form of the flight */
    duration?: number;
    ease?: string | readonly number[];
    /** `{{c.beacon 'compose'}}` or `{{c.gesture}}` — fly in from that box */
    from?: BeaconRef | GestureRef;
    /** an SVG path for the journey, drawn from where the sprite stands */
    path?: string;
    /** 'auto' orients along the tangent; a number adds a constant offset */
    rotate?: 'auto' | number;
    size?: boolean | 'crop' | 'scale';
    /** measure the delta in 'page' (default) or the sprite's 'parent' space */
    space?: 'page' | 'parent';
    spring?: SpringSpec;
    /** counterpart skins: 'during' (default), 'settle', or 'none' */
    swap?: 'during' | 'none' | 'settle';
    /** `{{c.beacon 'trash'}}` — fly out to that box rather than to where the sprite landed */
    to?: BeaconRef;
  }
> {
  node(): TimelineNode {
    const {
      of,
      duration,
      ease,
      delay,
      path,
      rotate,
      space,
      spring,
      size,
      swap,
      from,
      to,
      stagger,
    } = this.args;
    propsOf(this.args); // no properties — evaluated for the renamed-arg errors
    return {
      at: this.args.at,
      delay: msOf(delay),
      ease,
      from,
      kind: 'move',
      name: this.args.name,
      ms: msOf(duration),
      of,
      path,
      rotate,
      size,
      space,
      spring,
      stagger: msOf(stagger),
      swap,
      to,
    };
  }
}

export class Hold extends StepComponent<
  StepArgs & { duration?: number; fill?: boolean }
> {
  node(): TimelineNode {
    const { of, duration, delay, fill, stagger } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      fill,
      kind: 'hold',
      name: this.args.name,
      ms: msOf(duration),
      of,
      props: propsOf(this.args),
      stagger: msOf(stagger),
    };
  }
}

/**
 * `<c.Wait />` — a hole in a sequence. It has no subject: `@of` is accepted
 * (a wait can be laddered across sprites with `@stagger`) but never needed.
 */
export class Wait extends StepComponent<
  StepArgsBase & { duration: number; of?: Query | Query[] }
> {
  node(): TimelineNode {
    const { of, duration, delay, stagger } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      kind: 'wait',
      name: this.args.name,
      ms: duration * 1000,
      of,
      stagger: msOf(stagger),
    };
  }
}

/**
 * `<c.Perform />` — a semantic command on the timeline (§C4). It occupies
 * an instant, positioned like any step (sequence order, `@at`, `@delay`),
 * and carries `@action` (required), `@target` and `@payload` to the
 * region's dispatcher (`<Choreo @onPerform>`). The fold's law: forward
 * playback dispatches it once as the clock crosses it; a seek past it
 * includes it; a seek before it resets the host and replays the remaining
 * prefix. Commands are idempotent statements of state — `lightbox.open`,
 * never `lightbox.toggle`.
 */
export class Perform extends StepComponent<
  StepArgsBase & { action: string; payload?: unknown; target?: string }
> {
  node(): TimelineNode {
    const { action, delay, payload, target } = this.args;
    return {
      action,
      at: this.args.at,
      delay: msOf(delay),
      kind: 'perform',
      name: this.args.name,
      payload,
      target,
    };
  }
}

/**
 * `<c.Scroll />` — animate the sprite's scroll container so the sprite lands
 * at `@align`; occupies the sequence like any step (§6.1).
 */
export class Scroll extends StepComponent<
  StepArgs & { align?: 'center' | 'end' | 'start'; duration?: number }
> {
  node(): TimelineNode {
    const { of, align, duration, delay, stagger } = this.args;
    return {
      align,
      at: this.args.at,
      delay: msOf(delay),
      kind: 'scroll',
      ms: msOf(duration),
      name: this.args.name,
      of,
      stagger: msOf(stagger),
    };
  }
}

/**
 * `<c.Raise />` — promote the sprites to the region's elevated layer for the
 * span of its block (or `@duration`): above every stacking context and clip
 * in the region, with measured continuity both ways. `@shadow` casts on the
 * layer below (§6.3).
 */
export class Raise extends StepComponent<
  StepArgs & { duration?: number; shadow?: boolean }
> {
  node(): TimelineNode {
    const { of, duration, delay, shadow, stagger } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      kind: 'raise',
      ms: msOf(duration),
      name: this.args.name,
      of,
      shadow,
      stagger: msOf(stagger),
    };
  }
}

/**
 * `<c.Camera />` — the region's frame as a step (§6.3): `@zoom` / `@x` /
 * `@y` animate the scene, `@origin` aims the zoom at a sprite, `@steady`
 * names sprites that keep their size against it (damped by default).
 * `@fit` is the other, more common shape — dive on this sprite and CENTRE
 * it, zoom and pan computed from rest-layout geometry (`@margin` sets the
 * share of the frame it fills); pass `null` to fit nothing: back to rest.
 */
export class Camera extends StepComponent<
  StepArgsBase & {
    duration?: number;
    ease?: Easing;
    fit?: Query | null;
    margin?: number;
    of?: Query | Query[];
    origin?: Query;
    spring?: SpringSpec;
    steady?: Query | Query[];
    x?: number;
    y?: number;
    zoom?: number;
  }
> {
  node(): TimelineNode {
    const { duration, ease, delay, fit, margin, origin, spring, steady } =
      this.args;
    const { x, y, zoom } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      ease,
      fit,
      kind: 'camera',
      margin,
      ms: msOf(duration),
      name: this.args.name,
      of: this.args.of ?? {},
      origin,
      spring,
      steady,
      x,
      y,
      zoom,
    };
  }
}

/**
 * `<c.Camera3D @yaw={{-24}} @pitch={{-6}} @dolly={{0.9}} />` — the shot,
 * for a scene Choreo is not the one drawing.
 *
 * `c.Camera` moves the region's own frame, which is a 2D transform on real
 * DOM. A 3D scene has no such frame: its camera belongs to whatever is
 * rendering it. So this step carries the POSE and nothing else — yaw and
 * pitch in degrees, dolly as a multiple of the host's own framing — and
 * the region hands it to `@onCamera3D` every frame it changes. The host
 * applies it to three.js, to a CSS 3D stage, to anything that takes three
 * numbers.
 *
 * What Choreo keeps is the part it is actually good at: the pose is a pure
 * function of the clock, so a scrub lands the shot exactly where playing
 * there would, and a preset expands into this one seekable cue rather than
 * a second scheduler.
 *
 * `@by` makes it relative — added to the pose in force when the cue
 * starts, the way `Pan` and `SlowZoom` are relative — so a drift composes
 * with whatever shot preceded it.
 */
export class Camera3D extends StepComponent<
  StepArgsBase & {
    by?: boolean;
    dolly?: number;
    duration?: number;
    ease?: Easing;
    of?: Query | Query[];
    pitch?: number;
    spring?: SpringSpec;
    yaw?: number;
  }
> {
  node(): TimelineNode {
    const { by, delay, dolly, duration, ease, pitch, spring, yaw } = this.args;
    return {
      at: this.args.at,
      by,
      delay: msOf(delay),
      dolly,
      ease,
      kind: 'camera3d',
      ms: msOf(duration),
      name: this.args.name,
      of: this.args.of ?? {},
      pitch,
      spring,
      yaw,
    };
  }
}

/* ---- the direction vocabulary (docs/choreo-composition.md C5) ----
   Presets expand into the SAME seekable camera cue — sugar, never a new
   runtime primitive. Frame and Aim are absolute (computed from measured
   geometry at compile); Pan and SlowZoom are RELATIVE, resolved against
   the pose in force when the cue starts, so they compose with whatever
   shot preceded them and reconstruct under random access like any cue. */

/**
 * `<c.Frame @of={{c.id 'hero'}} @padding={{0.8}} />` — fit-and-centre the
 * target: the fit camera under its editorial name. `@padding` is the
 * share of the frame the target fills on whichever axis fits first.
 */
export class Frame extends StepComponent<
  StepArgsBase & {
    duration?: number;
    ease?: Easing;
    of: Query | null;
    padding?: number;
    spring?: SpringSpec;
    steady?: Query | Query[];
  }
> {
  node(): TimelineNode {
    const { duration, ease, delay, of, padding, spring, steady } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      ease,
      fit: of,
      kind: 'camera',
      margin: padding,
      ms: msOf(duration),
      name: this.args.name,
      of: {},
      spring,
      steady,
    };
  }
}

/**
 * `<c.Aim @of={{c.id 'hero'}} />` — recentre the picture on the target
 * with the zoom HELD: the reframe that does not change magnification.
 */
export class Aim extends StepComponent<
  StepArgsBase & {
    duration?: number;
    ease?: Easing;
    of: Query;
    spring?: SpringSpec;
    steady?: Query | Query[];
  }
> {
  node(): TimelineNode {
    const { duration, ease, delay, of, spring, steady } = this.args;
    return {
      aim: of,
      at: this.args.at,
      delay: msOf(delay),
      ease,
      kind: 'camera',
      ms: msOf(duration),
      name: this.args.name,
      of: {},
      spring,
      steady,
    };
  }
}

/**
 * `<c.Pan @x={{40}} @y={{-20}} />` — shift the picture by exactly this
 * many pixels from wherever it stands. Relative on purpose: a pan after
 * any shot means "from here", not "to there".
 */
export class Pan extends StepComponent<
  StepArgsBase & {
    duration?: number;
    ease?: Easing;
    spring?: SpringSpec;
    steady?: Query | Query[];
    x?: number;
    y?: number;
  }
> {
  node(): TimelineNode {
    const { duration, ease, delay, spring, steady, x, y } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      ease,
      kind: 'camera',
      ms: msOf(duration),
      name: this.args.name,
      of: {},
      panBy: { x, y },
      spring,
      steady,
    };
  }
}

/**
 * `<c.SlowZoom @by={{1.05}} @duration={{2}} />` — multiply the zoom in
 * force: the push-in (or, below 1, the pull-back) that gives a hold its
 * life. The aim in force is kept, so it pushes toward what the previous
 * shot was looking at.
 */
export class SlowZoom extends StepComponent<
  StepArgsBase & {
    by: number;
    duration?: number;
    ease?: Easing;
    spring?: SpringSpec;
    steady?: Query | Query[];
  }
> {
  node(): TimelineNode {
    const { by, duration, ease, delay, spring, steady } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      ease,
      kind: 'camera',
      ms: msOf(duration),
      name: this.args.name,
      of: {},
      spring,
      steady,
      zoomBy: by,
    };
  }
}

/**
 * `<c.Tether />` — geometry continuously derived from sprites (§6.1):
 * `@path` receives both endpoints' region-relative boxes every frame and
 * returns the path data the wire draws.
 */
export class Tether extends StepComponent<
  StepArgsBase & {
    duration?: number;
    from: Query;
    of?: Query | Query[];
    path: (from: Rect, to: Rect) => string;
    to: Query;
  }
> {
  node(): TimelineNode {
    const { duration, delay, from, path, to } = this.args;
    return {
      at: this.args.at,
      delay: msOf(delay),
      from,
      kind: 'tether',
      ms: msOf(duration),
      name: this.args.name,
      of: this.args.of,
      path,
      to,
    };
  }
}

/**
 * `<c.Crossing />` — the canned scene crossing (§4.7): what only the old
 * scene had fades as the flight lifts off, everything paired flies (skins
 * swapping per `@swap`), and what only the new scene has fades in near the
 * settle. One step in the template; a whole overlapped score on the clock —
 * Keynote's Magic Move does not wait for the dissolve to finish before the
 * movers leave, and a crossing that does reads as three acts, not one.
 *
 * It is also the reference COMPOSITE step, and deliberately written in
 * nothing but the public seam (`StepComponent`, `toMs`, `at`, and node
 * literals): if this needed a privilege an author could not have, the
 * contract on `StepComponent` would be a lie.
 */
export class Crossing extends StepComponent<
  StepArgsBase & {
    /** seconds to fade what only the new scene has */
    arrive?: number;
    /** the tween form of the flight */
    duration?: number;
    ease?: Easing;
    /** seconds to fade what only the old scene had */
    leave?: number;
    /** arrivals start at this fraction of the flight — near the settle */
    overlap?: number;
    /**
     * The flight's size mode. Default `'crop'` — uniform scale from
     * width, tops pinned, extra height clipped. `'scale'` stretches
     * per-axis; `true` writes layout width/height (reflows a grid row).
     */
    size?: boolean | 'crop' | 'scale';
    spring?: SpringSpec;
    /** the counterpart-skin policy, forwarded to the flight */
    swap?: 'during' | 'none' | 'settle';
  }
> {
  /**
   * The flight is addressable from outside — `{{at 'page:flight' 0.5}}`
   * for a step that wants to ride the move itself. Derived from this
   * crossing's own `@name` rather than fixed, so two crossings in one
   * timeline do not collide over it; unnamed, it takes a per-instance
   * number, which is stable for the life of the component and so does not
   * disturb the tree fingerprint between passes.
   */
  private flightName = `${this.args.name ?? `crossing-${++crossings}`}:flight`;

  node(): TimelineNode {
    const {
      arrive = 0.22,
      duration,
      ease,
      leave = 0.18,
      overlap = 0.7,
      size = 'crop',
      spring,
      swap,
    } = this.args;
    const FLIGHT = this.flightName;
    return {
      at: this.args.at,
      delay: toMs(this.args.delay),
      name: this.args.name,
      children: [
        {
          generic: true,
          kind: 'tween',
          ms: toMs(leave),
          of: { onstage: true, type: 'departed' },
          props: { opacity: 0 },
        },
        {
          ease,
          generic: true,
          kind: 'move',
          ms: toMs(duration),
          name: FLIGHT,
          of: { type: 'received' },
          // iOS's rule: uniform scale matched by cover, the aspect mismatch
          // cropped by the interpolating window — never a stretch, and
          // never layout (a receiver animating real width/height reflows
          // its whole row for the flight). Overridable; the default stays
          // crop so a crossing in a grid cannot stretch the row.
          size,
          spring,
          swap,
        },
        {
          generic: true,
          kind: 'hold',
          of: { type: 'received' },
          props: { zIndex: 2 },
        },
        {
          at: at(FLIGHT, overlap),
          generic: true,
          kind: 'tween',
          ms: toMs(arrive),
          of: { onstage: true, type: 'inserted' },
          props: { opacity: [0, 1] },
        },
      ],
      kind: 'parallel',
    };
  }
}

/**
 * `<c.Follow />` — a value DERIVED from the scene rather than interpolated
 * between two keyframes (§4.10). `@to` names what to read; `@read` gets
 * the pass's measurements every frame — each source's resting boxes
 * (`from`, `to`) and its composed position this frame (`now`), plus the
 * follower's own `rest` — and returns the properties to write; `@rest`
 * says what those properties are when nothing is driving them, so a
 * measure pass can put the element back.
 *
 * ```gts
 * <c.Follow @of={{c.id 'badge'}} @to={{c.id 'card'}}
 *           @read={{corner}} @rest={{hash x=0 y=0}} />
 * ```
 *
 * `@read` never sees the live page. Everything it is handed was measured
 * by the pass or composed from the run's own values, so it cannot read
 * back what it wrote last frame and it cannot force a style recalculation
 * mid-move — pure by construction, and correct under interruption because
 * a replacement pass re-measures (docs/postmortem-follow.md).
 *
 * Three things it is not: it is not accelerated (a derived value is
 * computed on the main thread, every frame — the price, and the same one
 * `c.Tether` pays); it may not write layout, only transform, opacity and
 * filter; and `@read` must still be a pure function of its context,
 * because the run is scrubbable in both directions and a value with
 * memory could not be sought back to.
 */
export class Follow extends StepComponent<
  StepArgs & {
    duration?: number;
    read: (ctx: DeriveContext) => Record<string, PropValue>;
    rest: Record<string, PropValue>;
    to: Query | Query[];
  }
> {
  node(): TimelineNode {
    const { duration, of, read, rest, to } = this.args;
    return {
      at: this.args.at,
      delay: msOf(this.args.delay),
      kind: 'follow',
      ms: msOf(duration),
      name: this.args.name,
      of,
      read,
      rest,
      stagger: msOf(this.args.stagger),
      to,
    };
  }
}

/**
 * `<c.Gate />` — park the run until `c.advance()`; `@delay` opens it by
 * itself after that many seconds (§4.1). A gate is a pause, and a pause is
 * a total order: it may only stand in a sequence that no parallel contains.
 */
export class Gate extends Component<{
  Args: { delay?: number };
}> {
  node(): TimelineNode {
    return { kind: 'gate', ms: msOf(this.args.delay) };
  }
  mark = modifier((el: Element) => {
    providers.set(el, this);
    return () => providers.delete(el);
  });
  <template>
    <span hidden data-choreo-step {{this.mark}}></span>
  </template>
}

/**
 * A block is a step's equal to the anchor system: it takes `@name`, `@at`
 * and `@delay` on the same terms, so a composite step — a `node()` that
 * returns a block — is something the rest of the score can point at.
 */
abstract class BlockComponent extends Component<{
  Args: {
    /** `{{at 'name' 0.4}}` / `{{after 'name'}}` — start against a named step or block */
    at?: AnchorRef;
    /** seconds before the block's contents start, inside its slot */
    delay?: number;
    /** a label other steps may anchor against; the block's span is its contents */
    name?: string;
  };
  Blocks: { default: [] };
}> {
  abstract readonly kind: Block['kind'];
  private el?: Element;
  node(): Block {
    return {
      at: this.args.at,
      children: this.el ? collect(this.el) : [],
      delay: msOf(this.args.delay),
      kind: this.kind,
      name: this.args.name,
    };
  }
  mark = modifier((el: Element) => {
    this.el = el;
    providers.set(el, this);
    return () => {
      providers.delete(el);
      this.el = undefined;
    };
  });
  <template>
    <span hidden data-choreo-block {{this.mark}}>{{yield}}</span>
  </template>
}

export class Sequence extends BlockComponent {
  readonly kind = 'sequence';
}
export class Parallel extends BlockComponent {
  readonly kind = 'parallel';
}
