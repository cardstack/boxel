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
import type {
  Block,
  DeliveryBy,
  DeliveryOrder,
  Easing,
  PropSource,
  Query,
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

/** args that are the step's own; every other named arg is a property to animate */
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
  'rotate',
  'shadow',
  'size',
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

interface StepArgs {
  [prop: string]: unknown;
  /** `{{at 'name' 0.4}}` / `{{after 'name' 0.2}}` — start against a named step */
  at?: AnchorRef;
  /** seconds before the step starts, inside its slot */
  delay?: number;
  /** a label other steps may anchor against */
  name?: string;
  of: Query | Query[];
  /** seconds between one matched sprite and the next, in document order */
  stagger?: number;
}

abstract class StepComponent<A extends StepArgs> extends Component<{
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
    ease?: string | number[];
    /** `{{c.beacon 'compose'}}` — fly in from that box rather than from where the sprite was */
    from?: BeaconRef;
    size?: boolean;
    spring?: SpringSpec;
    /** `{{c.beacon 'trash'}}` — fly out to that box rather than to where the sprite landed */
    to?: BeaconRef;
  }
> {
  node(): TimelineNode {
    const { of, duration, ease, delay, spring, size, from, to, stagger } =
      this.args;
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
      size,
      spring,
      stagger: msOf(stagger),
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
