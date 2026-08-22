/**
 * The timeline, declared in the template. Each step renders a hidden marker
 * so the region can read the tree back in document order — nesting in the
 * markup IS the sequence/parallel nesting. Nothing here animates; the region
 * compiles these into cues when a render pass produces a changeset.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type {
  Block,
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
  'delay',
  'ease',
  'fill',
  'from',
  'ms',
  'of',
  'size',
  'spring',
]);

function propsOf(args: Record<string, unknown>): Record<string, PropSource> {
  const props: Record<string, PropSource> = {};
  for (const key of Object.keys(args)) {
    if (!RESERVED.has(key) && args[key] !== undefined) {
      props[key] = args[key] as PropSource;
    }
  }
  return props;
}

interface StepArgs {
  [prop: string]: unknown;
  delay?: number;
  of: Query | Query[];
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
    ease?: string | number[];
    from?: Record<string, PropSource>;
    ms: number;
  }
> {
  node(): TimelineNode {
    const { of, ms, ease, delay, from } = this.args;
    return {
      delay,
      ease,
      from,
      kind: 'tween',
      ms,
      of,
      props: propsOf(this.args),
    };
  }
}

export class Spring extends StepComponent<
  StepArgs & { from?: Record<string, PropSource>; spring?: SpringSpec }
> {
  node(): TimelineNode {
    const { of, spring, delay, from } = this.args;
    return {
      delay,
      from,
      kind: 'spring',
      of,
      props: propsOf(this.args),
      spring,
    };
  }
}

export class Move extends StepComponent<
  StepArgs & {
    ease?: string | number[];
    ms?: number;
    size?: boolean;
    spring?: SpringSpec;
  }
> {
  node(): TimelineNode {
    const { of, ms, ease, delay, spring, size } = this.args;
    return { delay, ease, kind: 'move', ms, of, size, spring };
  }
}

export class Hold extends StepComponent<
  StepArgs & { fill?: boolean; ms?: number }
> {
  node(): TimelineNode {
    const { of, ms, delay, fill } = this.args;
    return { delay, fill, kind: 'hold', ms, of, props: propsOf(this.args) };
  }
}

export class Wait extends StepComponent<StepArgs & { ms: number }> {
  node(): TimelineNode {
    const { of, ms, delay } = this.args;
    return { delay, kind: 'wait', ms, of };
  }
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
