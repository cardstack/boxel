/**
 * The timeline, declared in the template. Each step renders a hidden marker
 * so the region can read the tree back in document order — nesting in the
 * markup IS the sequence/parallel nesting. Nothing here animates; the region
 * compiles these into cues when a render pass produces a changeset.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type { AnchorRef } from './anchors.ts';
import type { BeaconRef } from './beacons.ts';
import type { GestureRef } from './gesture.ts';
import type {
  Block,
  DeliveryBy,
  DeliveryOrder,
  Easing,
  PropSource,
  Query,
  Rect,
  SpringSpec,
  TimelineNode,
} from './types.ts';

interface Provider {
  node(): TimelineNode;
}

const providers = new WeakMap<Element, Provider>();

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
  'repeat',
  'repeatType',
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

/** the template speaks seconds, as Motion does; the compiler's clock is ms */
const msOf = (seconds: number | undefined): number | undefined =>
  seconds === undefined ? undefined : seconds * 1000;

interface StepArgsBase {
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

interface StepArgs extends StepArgsBase {
  of: Query | Query[];
}

abstract class StepComponent<A extends StepArgsBase> extends Component<{
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

export class Wait extends StepComponent<StepArgs & { duration: number }> {
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
      of: this.args.of ?? {},
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
    spring?: SpringSpec;
    /** the counterpart-skin policy, forwarded to the flight */
    swap?: 'during' | 'none' | 'settle';
  }
> {
  node(): TimelineNode {
    const {
      arrive = 0.22,
      duration,
      ease,
      leave = 0.18,
      overlap = 0.7,
      spring,
      swap,
    } = this.args;
    const FLIGHT = '__crossing-flight';
    return {
      children: [
        {
          generic: true,
          kind: 'tween',
          ms: leave * 1000,
          of: { onstage: true, type: 'departed' },
          props: { opacity: 0 },
        },
        {
          ease,
          generic: true,
          kind: 'move',
          ms: duration === undefined ? undefined : duration * 1000,
          name: FLIGHT,
          of: { type: 'received' },
          // iOS's rule: uniform scale matched by cover, the aspect mismatch
          // cropped by the interpolating window — never a stretch, and
          // never layout (a receiver animating real width/height reflows
          // its whole row for the flight)
          size: 'crop',
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
          at: { anchor: FLIGHT, edge: 'start', progress: overlap },
          generic: true,
          kind: 'tween',
          ms: arrive * 1000,
          of: { onstage: true, type: 'inserted' },
          props: { opacity: [0, 1] },
        },
      ],
      kind: 'parallel',
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

abstract class BlockComponent extends Component<{
  Blocks: { default: [] };
}> {
  abstract readonly kind: Block['kind'];
  private el?: Element;
  node(): Block {
    return { children: this.el ? collect(this.el) : [], kind: this.kind };
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
