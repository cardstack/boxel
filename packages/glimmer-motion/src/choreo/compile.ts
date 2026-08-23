/**
 * boxel-motion's OrchestrationMatrix, as a cue list: the timeline tree becomes
 * one (sprite, start, duration) per step per sprite. Sequences add, parallels
 * overlay; a spring's length is computed with the engine's own generator so a
 * sequence can follow one — the thing the legacy could not do.
 */
import {
  calcGeneratorDuration,
  maxGeneratorDuration,
  spring,
} from 'motion-dom';

import type {
  Block,
  ChangesetLike,
  Cue,
  HoldStep,
  MoveStep,
  PropSource,
  PropValue,
  SpringSpec,
  SpringStep,
  Sprite,
  Step,
  TimelineNode,
  TweenStep,
} from './types.ts';

const isBlock = (node: TimelineNode): node is Block =>
  node.kind === 'sequence' || node.kind === 'parallel';

const DEFAULT_SPRING: SpringSpec = { damping: 30, stiffness: 300 };

const resolve = (
  v: PropSource,
  sprite: Sprite,
  cs: ChangesetLike,
): PropValue => (typeof v === 'function' ? v(sprite, cs) : v);

const num = (v: unknown): number => {
  if (typeof v === 'number') {
    return v;
  }
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
};

/** the value a spring starts from when the step does not say: the engine's, else the computed style's */
function currentValue(sprite: Sprite, key: string): number {
  const ve = sprite.node.visualElement;
  if (ve?.hasValue(key)) {
    return num(ve.getValue(key)!.get());
  }
  const latest = (ve?.latestValues as Record<string, unknown> | undefined)?.[
    key
  ];
  if (latest !== undefined) {
    return num(latest);
  }
  const computed = getComputedStyle(sprite.element).getPropertyValue(
    key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()),
  );
  return num(computed);
}

function springDuration(from: number, to: number, spec: SpringSpec): number {
  if (from === to) {
    return 0;
  }
  const generator = spring({ keyframes: [from, to], ...spec });
  return Math.min(calcGeneratorDuration(generator), maxGeneratorDuration);
}

/** a cue before it is placed on the run's clock; `offset` is its rung of the stagger ladder */
type Unplaced = Omit<Cue, 'start'> & { offset: number };

interface Resolved {
  cues: Unplaced[];
  /** the step's own length, delay included */
  duration: number;
  /** a hold without @ms: its window is its block's span */
  open: boolean;
}

function resolveTarget(
  step: SpringStep | TweenStep,
  sprite: Sprite,
  cs: ChangesetLike,
): { longest: number; target: Record<string, unknown> } {
  const target: Record<string, unknown> = {};
  let longest = 0;
  for (const key in step.props) {
    const to = resolve(step.props[key]!, sprite, cs);
    const fromSource = step.from?.[key];
    if (fromSource !== undefined) {
      const from = resolve(fromSource, sprite, cs);
      target[key] = [from, to];
      if (step.kind === 'spring') {
        longest = Math.max(
          longest,
          springDuration(num(from), num(to), step.spring ?? DEFAULT_SPRING),
        );
      }
    } else {
      target[key] = to;
      if (step.kind === 'spring') {
        longest = Math.max(
          longest,
          springDuration(
            currentValue(sprite, key),
            num(to),
            step.spring ?? DEFAULT_SPRING,
          ),
        );
      }
    }
  }
  return { longest, target };
}

function resolveMove(
  step: MoveStep,
  sprite: Sprite,
  cs: ChangesetLike,
): { longest: number; target: Record<string, unknown> } | null {
  // A beacon rewrites one end of the flight. `@from` gives an inserted sprite
  // a start it never had (it flies out of the compose button); `@to` gives a
  // removed one an end it never reaches (it flies into the bin). Everything
  // after this is the ordinary FLIP — rewriting the bounds IS the whole
  // implementation. A name nothing claimed leaves that end alone.
  const borrowedFrom = step.from ? cs.beacon(step.from.beacon) : null;
  const borrowedTo = step.to ? cs.beacon(step.to.beacon) : null;
  const initial = borrowedFrom ?? sprite.initial;
  const final = borrowedTo ?? sprite.final;
  if (!initial || !final) {
    return null;
  }
  // Page space, not parent space: the region itself can move and resize in the
  // very pass that moves its children (a centred grid that grows re-centres),
  // and a delta measured against a parent that moved by the same amount is
  // zero — that element alone would sit still while its siblings flew.
  const from = initial.page;
  const to = final.page;
  const target: Record<string, unknown> = {};
  const pairs: [number, number][] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  /**
   * Which end the element is actually sitting on decides the sign.
   *
   * The usual FLIP case is a kept sprite: the pass has already put it at its
   * destination, so it is pulled back by the delta and animated to zero. A
   * REMOVED sprite is the other way round — the region has locked it in the
   * orphan layer at the place it was, so it starts at zero and travels the
   * delta. That is the only case that can have a `final` at all, and it only
   * has one because a beacon lent it one.
   */
  const holdsStart = sprite.type === 'removed';
  const leg = (d: number): [number, number] => (holdsStart ? [0, d] : [-d, 0]);
  if (dx !== 0) {
    target['x'] = leg(dx);
    pairs.push(leg(dx));
  }
  if (dy !== 0) {
    target['y'] = leg(dy);
    pairs.push(leg(dy));
  }
  if (step.size !== false) {
    if (from.width !== to.width) {
      target['width'] = [from.width, to.width];
      pairs.push([from.width, to.width]);
    }
    if (from.height !== to.height) {
      target['height'] = [from.height, to.height];
      pairs.push([from.height, to.height]);
    }
  }
  if (!pairs.length) {
    return null;
  }
  let longest = step.ms ?? 0;
  if (step.ms === undefined) {
    const spec = step.spring ?? DEFAULT_SPRING;
    for (const [a, b] of pairs) {
      longest = Math.max(longest, springDuration(a, b, spec));
    }
  }
  return { longest, target };
}

const tweenTransition = (step: MoveStep | TweenStep, ms: number) => ({
  duration: ms / 1000,
  ease: step.ease ?? 'easeInOut',
  type: 'tween',
});
const springTransition = (spec: SpringSpec | undefined) => ({
  ...(spec ?? DEFAULT_SPRING),
  type: 'spring',
});

function resolveStep(step: Step, cs: ChangesetLike): Resolved {
  const sprites = cs.sprites(step.of);
  const delay = step.delay ?? 0;
  const cues: Unplaced[] = [];
  const stagger = step.stagger ?? 0;
  let longest = 0;
  let open = false;
  for (const [index, sprite] of sprites.entries()) {
    // each sprite starts one rung later than the one before it, in the order
    // the query returned them — which is document order
    const offset = stagger * index;
    switch (step.kind) {
      case 'tween': {
        const { target } = resolveTarget(step, sprite, cs);
        if (Object.keys(target).length) {
          cues.push({
            duration: step.ms,
            kind: 'tween',
            offset,
            sprite,
            target,
            transition: tweenTransition(step, step.ms),
          });
          longest = Math.max(longest, offset + step.ms);
        }
        break;
      }
      case 'spring': {
        const { target, longest: d } = resolveTarget(step, sprite, cs);
        if (Object.keys(target).length) {
          cues.push({
            duration: d,
            kind: 'spring',
            offset,
            sprite,
            target,
            transition: springTransition(step.spring),
          });
          longest = Math.max(longest, offset + d);
        }
        break;
      }
      case 'move': {
        const r = resolveMove(step, sprite, cs);
        if (r) {
          cues.push({
            duration: r.longest,
            kind: 'move',
            offset,
            sprite,
            target: r.target,
            transition:
              step.ms === undefined
                ? springTransition(step.spring)
                : tweenTransition(step, step.ms),
          });
          longest = Math.max(longest, offset + r.longest);
        }
        break;
      }
      case 'hold': {
        const values: Record<string, PropValue> = {};
        for (const key in (step as HoldStep).props) {
          values[key] = resolve(step.props[key]!, sprite, cs);
        }
        cues.push({
          duration: step.ms ?? 0,
          hold: { fill: step.fill ?? false, values },
          kind: 'hold',
          offset,
          sprite,
        });
        if (step.ms === undefined) {
          open = true;
        } else {
          longest = Math.max(longest, offset + step.ms);
        }
        break;
      }
      case 'wait':
        cues.push({ duration: step.ms, kind: 'wait', offset, sprite });
        longest = Math.max(longest, offset + step.ms);
        break;
    }
  }
  return { cues, duration: cues.length ? delay + longest : 0, open };
}

export default function compile(
  tree: TimelineNode[],
  cs: ChangesetLike,
): Cue[] {
  const resolved = new Map<Step, Resolved>();
  const of = (step: Step) => {
    let r = resolved.get(step);
    if (!r) {
      r = resolveStep(step, cs);
      resolved.set(step, r);
    }
    return r;
  };
  const measure = (node: TimelineNode): number => {
    if (!isBlock(node)) {
      return of(node).duration;
    }
    if (node.kind === 'sequence') {
      return node.children.reduce((sum, c) => sum + measure(c), 0);
    }
    return node.children.reduce((max, c) => Math.max(max, measure(c)), 0);
  };
  const out: Cue[] = [];
  /** span: the time a hold without @ms is allowed to last from `start` */
  const place = (node: TimelineNode, start: number, span: number) => {
    if (!isBlock(node)) {
      const r = of(node);
      const delay = node.delay ?? 0;
      for (const cue of r.cues) {
        const { offset, ...rest } = cue;
        out.push({
          ...rest,
          duration:
            r.open && cue.kind === 'hold'
              ? Math.max(0, span - delay - offset)
              : cue.duration,
          start: start + delay + offset,
        });
      }
      return;
    }
    if (node.kind === 'sequence') {
      const total = measure(node);
      let offset = 0;
      for (const child of node.children) {
        place(child, start + offset, total - offset);
        offset += measure(child);
      }
      return;
    }
    const total = measure(node);
    for (const child of node.children) {
      place(child, start, total);
    }
  };
  const root = measure({ children: tree, kind: 'parallel' });
  for (const node of tree) {
    place(node, 0, root);
  }
  return out;
}
