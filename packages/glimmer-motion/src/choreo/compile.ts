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

interface Resolved {
  cues: Omit<Cue, 'start'>[];
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
): { longest: number; target: Record<string, unknown> } | null {
  if (!sprite.initial || !sprite.final) {
    return null;
  }
  const from = sprite.initial.parent;
  const to = sprite.final.parent;
  const target: Record<string, unknown> = {};
  const pairs: [number, number][] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0) {
    target['x'] = [-dx, 0];
    pairs.push([-dx, 0]);
  }
  if (dy !== 0) {
    target['y'] = [-dy, 0];
    pairs.push([-dy, 0]);
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
  const cues: Omit<Cue, 'start'>[] = [];
  let longest = 0;
  let open = false;
  for (const sprite of sprites) {
    switch (step.kind) {
      case 'tween': {
        const { target } = resolveTarget(step, sprite, cs);
        if (Object.keys(target).length) {
          cues.push({
            duration: step.ms,
            kind: 'tween',
            sprite,
            target,
            transition: tweenTransition(step, step.ms),
          });
          longest = Math.max(longest, step.ms);
        }
        break;
      }
      case 'spring': {
        const { target, longest: d } = resolveTarget(step, sprite, cs);
        if (Object.keys(target).length) {
          cues.push({
            duration: d,
            kind: 'spring',
            sprite,
            target,
            transition: springTransition(step.spring),
          });
          longest = Math.max(longest, d);
        }
        break;
      }
      case 'move': {
        const r = resolveMove(step, sprite);
        if (r) {
          cues.push({
            duration: r.longest,
            kind: 'move',
            sprite,
            target: r.target,
            transition:
              step.ms === undefined
                ? springTransition(step.spring)
                : tweenTransition(step, step.ms),
          });
          longest = Math.max(longest, r.longest);
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
          sprite,
        });
        if (step.ms === undefined) {
          open = true;
        } else {
          longest = Math.max(longest, step.ms);
        }
        break;
      }
      case 'wait':
        cues.push({ duration: step.ms, kind: 'wait', sprite });
        longest = Math.max(longest, step.ms);
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
        out.push({
          ...cue,
          duration:
            r.open && cue.kind === 'hold'
              ? Math.max(0, span - delay)
              : cue.duration,
          start: start + delay,
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
