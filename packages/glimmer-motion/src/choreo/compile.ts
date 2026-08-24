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
  Compiled,
  Cue,
  DeliveryOrder,
  FlightPath,
  GateMark,
  HoldStep,
  MoveStep,
  PropSource,
  PropTarget,
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
const isGate = (node: TimelineNode): node is import('./types.ts').GateNode =>
  node.kind === 'gate';

const DEFAULT_SPRING: SpringSpec = { damping: 30, stiffness: 300 };

/** the shared offstage <svg> that path geometry is sampled inside */
let pathHost: SVGSVGElement | undefined;
function samplePath(d: string, samples = 64): { x: number; y: number }[] {
  if (!pathHost) {
    pathHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pathHost.setAttribute('aria-hidden', 'true');
    pathHost.style.cssText =
      'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(pathHost);
  }
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  el.setAttribute('d', d);
  pathHost.appendChild(el);
  try {
    const length = el.getTotalLength();
    return Array.from({ length: samples + 1 }, (_, i) => {
      const pt = el.getPointAtLength((length * i) / samples);
      return { x: pt.x, y: pt.y };
    });
  } finally {
    el.remove();
  }
}

/**
 * Similarity-map a drawn path so its start is the sprite's start and its end
 * is the measured landing (§4.4): the path bends the journey, never the
 * destination. Complex multiplication: m = D / v rotates and scales the
 * author's stroke onto the real displacement.
 */
function mapFlight(
  raw: { x: number; y: number }[],
  dx: number,
  dy: number,
): { x: number; y: number }[] {
  const s0 = raw[0]!;
  const e = raw[raw.length - 1]!;
  const vx = e.x - s0.x;
  const vy = e.y - s0.y;
  const mag = vx * vx + vy * vy;
  if (mag < 1e-6) {
    // a degenerate stroke: fall back to the straight line
    return raw.map((_, i) => ({
      x: (dx * i) / (raw.length - 1),
      y: (dy * i) / (raw.length - 1),
    }));
  }
  // m = (dx + i·dy) / (vx + i·vy)
  const mr = (dx * vx + dy * vy) / mag;
  const mi = (dy * vx - dx * vy) / mag;
  return raw.map((pt) => {
    const px = pt.x - s0.x;
    const py = pt.y - s0.y;
    return { x: px * mr - py * mi, y: px * mi + py * mr };
  });
}

const resolve = (
  v: PropSource,
  sprite: Sprite,
  cs: ChangesetLike,
): PropTarget => (typeof v === 'function' ? v(sprite, cs) : v);

const single = (v: PropTarget): PropValue => (Array.isArray(v) ? v[0]! : v);

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

/**
 * The rung each index takes on the stagger ladder, under a delivery order.
 * 'center' delivers from the middle outward; 'random' shuffles per run —
 * seeded input is the native driver's requirement, not this one's.
 */
export function ladder(n: number, order: DeliveryOrder): number[] {
  const ranks = Array.from({ length: n }, (_, i) => i);
  switch (order) {
    case 'reverse':
      return ranks.map((i) => n - 1 - i);
    case 'center': {
      const mid = (n - 1) / 2;
      const byDistance = [...ranks].sort(
        (a, b) => Math.abs(a - mid) - Math.abs(b - mid),
      );
      const out = new Array<number>(n);
      byDistance.forEach((index, rank) => (out[index] = rank));
      return out;
    }
    case 'random': {
      const shuffled = [...ranks];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const out = new Array<number>(n);
      shuffled.forEach((index, rank) => (out[index] = rank));
      return out;
    }
    default:
      return ranks;
  }
}

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
    // A keyframe array is the from-and-to (and any waypoints) in one value —
    // `@opacity={{array 0 1}}` — which is why there is no property-hash @from.
    if (Array.isArray(to)) {
      if (step.kind === 'spring' && to.length > 2) {
        throw new Error(
          'choreo: a spring animates between two keyframes; ' +
            `\`${key}\` was given ${to.length}`,
        );
      }
      target[key] = to;
      if (step.kind === 'spring') {
        longest = Math.max(
          longest,
          springDuration(
            num(to[0]),
            num(to[to.length - 1]),
            step.spring ?? DEFAULT_SPRING,
          ),
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
): {
  flight?: FlightPath;
  longest: number;
  target: Record<string, unknown>;
} | null {
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
  let flight: FlightPath | undefined;
  if (step.path && (dx !== 0 || dy !== 0)) {
    // the path owns position; FLIP still owns size
    flight = {
      points: mapFlight(samplePath(step.path), dx, dy),
      rest: holdsStart ? { x: 0, y: 0 } : { x: dx, y: dy },
      rotate: step.rotate,
    };
    pairs.push(leg(Math.hypot(dx, dy)));
  } else {
    if (dx !== 0) {
      target['x'] = leg(dx);
      pairs.push(leg(dx));
    }
    if (dy !== 0) {
      target['y'] = leg(dy);
      pairs.push(leg(dy));
    }
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
  return { flight, longest, target };
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
  /** text delivery: the sprite is split and the ladder happens INSIDE the
   *  step's span, so the sprites themselves are not laddered */
  const splitting =
    (step.kind === 'tween' || step.kind === 'spring') &&
    step.by !== undefined &&
    step.by !== 'item';
  const order =
    step.kind === 'tween' || step.kind === 'spring'
      ? (step.order ?? 'forward')
      : 'forward';
  const ranks = splitting ? [] : ladder(sprites.length, order);
  let longest = 0;
  let open = false;
  for (const [index, sprite] of sprites.entries()) {
    // each sprite starts one rung later than the one before it — in the
    // order the query returned them (document order), reordered by @order
    const offset = splitting ? 0 : stagger * (ranks[index] ?? index);
    switch (step.kind) {
      case 'tween': {
        const { target } = resolveTarget(step, sprite, cs);
        if (Object.keys(target).length) {
          // an infinite repeat is an ambient loop: it occupies one cycle of
          // the schedule and keeps playing past the run's end
          const loop = step.repeat === Infinity;
          const plays = loop ? 1 : 1 + (step.repeat ?? 0);
          const length = step.ms * plays;
          const transition: Record<string, unknown> = tweenTransition(
            step,
            step.ms,
          );
          if (step.repeat) {
            transition['repeat'] = step.repeat;
            transition['repeatType'] = step.repeatType ?? 'loop';
          }
          cues.push({
            delivery: splitting
              ? { by: step.by!, order, stagger }
              : undefined,
            duration: length,
            kind: 'tween',
            loop: loop || undefined,
            offset,
            sprite,
            target,
            transition,
          });
          longest = Math.max(longest, offset + (loop ? step.ms : length));
        }
        break;
      }
      case 'spring': {
        const { target, longest: d } = resolveTarget(step, sprite, cs);
        if (Object.keys(target).length) {
          cues.push({
            delivery: splitting
              ? { by: step.by!, order, stagger }
              : undefined,
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
          const transition =
            step.ms === undefined
              ? springTransition(step.spring)
              : tweenTransition(step, step.ms);
          cues.push({
            duration: r.longest,
            flight: r.flight,
            kind: 'move',
            offset,
            sprite,
            target: r.target,
            transition,
          });
          longest = Math.max(longest, offset + r.longest);
          // the counterpart-skin policy (§6.3): the claimed leaver rides the
          // same flight, and the two skins swap during it or at its landing
          const cp = sprite.counterpart;
          const swap = step.swap ?? 'during';
          // a far match's sender is released to its own region, not carried
          // here — there is no second skin to fly (§3.2)
          if (cp && !cp.sent && swap !== 'none' && sprite.final && cp.initial) {
            const from = cp.initial.page;
            const to = sprite.final.page;
            const cpTarget: Record<string, unknown> = {};
            if (to.x !== from.x) {
              cpTarget['x'] = [0, to.x - from.x];
            }
            if (to.y !== from.y) {
              cpTarget['y'] = [0, to.y - from.y];
            }
            if (step.size !== false) {
              if (from.width !== to.width) {
                cpTarget['width'] = [from.width, to.width];
              }
              if (from.height !== to.height) {
                cpTarget['height'] = [from.height, to.height];
              }
            }
            if (Object.keys(cpTarget).length) {
              cues.push({
                duration: r.longest,
                kind: 'move',
                offset,
                sprite: cp,
                target: cpTarget,
                transition,
              });
            }
            if (swap === 'during') {
              // both skins cross over the one flying box
              cues.push({
                duration: r.longest,
                kind: 'tween',
                offset,
                sprite,
                target: { opacity: [0, 1] },
                transition: { duration: r.longest / 1000, ease: 'easeInOut' },
              });
              cues.push({
                duration: r.longest,
                kind: 'tween',
                offset,
                sprite: cp,
                target: { opacity: [1, 0] },
                transition: { duration: r.longest / 1000, ease: 'easeInOut' },
              });
            } else {
              // 'settle': the old rendering is carried whole; the swap is
              // the landing itself — the receiver hides for the flight and
              // the released hold reveals it as the leaver is dropped
              cues.push({
                duration: r.longest,
                hold: { fill: false, values: { opacity: 0 } },
                kind: 'hold',
                offset,
                sprite,
              });
            }
          }
        }
        break;
      }
      case 'hold': {
        const values: Record<string, PropValue> = {};
        for (const key in (step as HoldStep).props) {
          values[key] = single(resolve(step.props[key]!, sprite, cs));
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
): Compiled {
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
    if (isGate(node)) {
      return 0;
    }
    if (!isBlock(node)) {
      // an anchored step is lifted out of its block's flow: it neither pushes
      // a sequence forward nor stretches a block's span (§4.2)
      return node.at ? 0 : of(node).duration;
    }
    if (node.kind === 'sequence') {
      return node.children.reduce((sum, c) => sum + measure(c), 0);
    }
    return node.children.reduce((max, c) => Math.max(max, measure(c)), 0);
  };
  const out: Cue[] = [];
  // duplicate names are an authoring error, caught before anything is placed
  const seen = new Set<string>();
  const checkNames = (node: TimelineNode) => {
    if (isGate(node)) {
      return;
    }
    if (isBlock(node)) {
      node.children.forEach(checkNames);
    } else if (node.name) {
      if (seen.has(node.name)) {
        throw new Error(`choreo: two steps named '${node.name}'`);
      }
      seen.add(node.name);
    }
  };
  tree.forEach(checkNames);
  /** where each named step landed: when it starts (delay spent) and how long it plays */
  const names = new Map<string, { duration: number; start: number }>();
  const gates: GateMark[] = [];
  /**
   * A pause is a total order (§4.1): a gate may only stand in a sequence
   * that no parallel contains — including the implicit parallel that is the
   * region's root when it has more than one top-level node.
   */
  const forbidGates = (node: TimelineNode) => {
    if (isGate(node)) {
      throw new Error(
        'choreo: a gate inside a parallel has no meaning — a pause is a ' +
          'total order; only an uncontained sequence can hold one',
      );
    }
    if (isBlock(node)) {
      node.children.forEach(forbidGates);
    }
  };
  /** span: the time a hold without @duration is allowed to last from `start` */
  const place = (node: TimelineNode, start: number, span: number) => {
    if (isGate(node)) {
      gates.push({ at: start, auto: node.ms });
      return;
    }
    if (!isBlock(node)) {
      const r = of(node);
      const delay = node.delay ?? 0;
      let base = start;
      if (node.at) {
        const target = names.get(node.at.anchor);
        if (!target) {
          throw new Error(
            `choreo: @at names '${node.at.anchor}', which is not a step ` +
              'above this one — anchors point up the score',
          );
        }
        if (r.open) {
          throw new Error(
            'choreo: an anchored hold needs its own @duration — lifted out ' +
              "of its block, it has no span to borrow",
          );
        }
        base =
          node.at.edge === 'end'
            ? target.start + target.duration + (node.at.delay ?? 0) * 1000
            : target.start + (node.at.progress ?? 0) * target.duration;
      }
      if (node.name) {
        names.set(node.name, {
          duration: Math.max(0, r.duration - delay),
          start: base + delay,
        });
      }
      for (const cue of r.cues) {
        const { offset, ...rest } = cue;
        out.push({
          ...rest,
          duration:
            r.open && cue.kind === 'hold'
              ? Math.max(0, span - delay - offset)
              : cue.duration,
          start: base + delay + offset,
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
    // a parallel: every child at once — and no gate anywhere under it
    node.children.forEach(forbidGates);
    const total = measure(node);
    for (const child of node.children) {
      place(child, start, total);
    }
  };
  const root = measure({ children: tree, kind: 'parallel' });
  if (tree.length > 1) {
    tree.forEach(forbidGates);
  }
  for (const node of tree) {
    place(node, 0, root);
  }
  gates.sort((a, b) => a.at - b.at);
  return { cues: out, gates };
}
