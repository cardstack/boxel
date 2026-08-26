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

import type { AnchorRef } from './anchors.ts';
import { gestureBounds, gestureVelocity, isGestureRef } from './gesture.ts';
import type {
  Block,
  Bounds,
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
  Rect,
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

/**
 * What `c.Follow` is allowed to drive: paint, never layout. See the throw
 * in the 'follow' case for why the line is drawn exactly here.
 */
const DERIVABLE = new Set([
  'filter',
  'opacity',
  'rotate',
  'rotateX',
  'rotateY',
  'rotateZ',
  'scale',
  'scaleX',
  'scaleY',
  'skewX',
  'skewY',
  'x',
  'y',
  'z',
]);

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

/**
 * The two boxes a shape-matched flight aligns: the declared subjects
 * ([data-choreo-substance]) when either end has one — Keynote matches
 * OBJECTS, not slide frames — with the undeclared end derived by fraction
 * (content laid out proportionally keeps one fraction at both scales; the
 * return trip's card, whose demo has not boarded yet, has nothing to
 * measure). Neither end declared: the frames themselves.
 */
function matchBoxes(
  initial: Bounds,
  final: Bounds,
  from: Rect,
  to: Rect,
  z: number,
): { from: Rect; to: Rect } {
  const subI = initial.substance && descale(initial.substance, z);
  const subF = final.substance && descale(final.substance, z);
  if (!subI && !subF) {
    return { from, to };
  }
  const map = (s: Rect, a: Rect, b: Rect): Rect => ({
    height: (s.height / (a.height || 1)) * b.height,
    width: (s.width / (a.width || 1)) * b.width,
    x: b.x + ((s.x - a.x) / (a.width || 1)) * b.width,
    y: b.y + ((s.y - a.y) / (a.height || 1)) * b.height,
  });
  return {
    from: subI ?? map(subF!, to, from),
    to: subF ?? map(subI!, from, to),
  };
}

const centreOf = (r: Rect) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/** a page-space box, divided back into local space by the measure-time zoom */
function descale(r: Rect, z: number): Rect {
  return z === 1
    ? r
    : { height: r.height / z, width: r.width / z, x: r.x / z, y: r.y / z };
}

function resolveMove(
  step: MoveStep,
  sprite: Sprite,
  cs: ChangesetLike,
): {
  flight?: FlightPath;
  longest: number;
  target: Record<string, unknown>;
  velocity?: { x: number; y: number };
} | null {
  // A beacon — or the live gesture — rewrites one end of the flight. `@from`
  // gives an inserted sprite a start it never had (out of the compose button,
  // or from wherever the finger let go); `@to` gives a removed one an end it
  // never reaches. Everything after this is the ordinary FLIP — rewriting the
  // bounds IS the whole implementation. A name nothing claimed leaves that
  // end alone.
  const size = (sprite.final ?? sprite.initial)?.page ?? {
    height: 0,
    width: 0,
    x: 0,
    y: 0,
  };
  const hot = step.from && isGestureRef(step.from);
  const borrowedFrom = step.from
    ? hot
      ? gestureBounds(size)
      : cs.beacon((step.from as { beacon: string }).beacon)
    : null;
  const borrowedTo = step.to ? cs.beacon(step.to.beacon) : null;
  const initial = borrowedFrom ?? sprite.initial;
  const final = borrowedTo ?? sprite.final;
  if (!initial || !final) {
    return null;
  }
  // Page space by default: the one space two regions agree on, and the region
  // itself can move in the very pass that moves its children. 'parent'
  // resolves against the sprite's own container instead (§6.1). Either way,
  // the measurement was taken through the camera's transform and the values
  // will be written as local inline pixels — so both boxes are divided back
  // by the zoom the world was measured under (§6.3).
  const z = cs.measureZoom ?? 1;
  const parentSpace = step.space === 'parent' && !borrowedFrom && !borrowedTo;
  const from = descale(parentSpace ? initial.parent : initial.page, z);
  const to = descale(parentSpace ? final.parent : final.page, z);
  const target: Record<string, unknown> = {};
  const pairs: [number, number][] = [];
  // 'scale' matches shape by transform (MoveStep.size): position runs
  // centre-to-centre over the MATCH boxes — the declared subjects when
  // either end has one, the frames otherwise. Layout modes run
  // corner-to-corner with the real size animating alongside.
  const scaleMode = step.size === 'scale' || step.size === 'crop';
  const cropMode = step.size === 'crop';
  const m = scaleMode ? matchBoxes(initial, final, from, to, z) : null;
  const dx = m ? centreOf(m.to).x - centreOf(m.from).x : to.x - from.x;
  // 'crop' pins the TOPS of the two subjects, not their centres — the
  // matching-snapshot rule (§4.7): the entering subject stands with its
  // top on the exiting subject's top, and overflow pays at the BOTTOM
  const dy = m
    ? cropMode
      ? m.to.y - m.from.y
      : centreOf(m.to).y - centreOf(m.from).y
    : to.y - from.y;
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
  } else if (m) {
    // The transform scales about the element's own centre, so an
    // off-centre match box needs a correction on the translate: the
    // flight pins the MATCH box — the subject — through the move, and
    // the frame simply comes along. With frame-matching the correction
    // is zero and this is the plain centre-to-centre leg.
    //
    // 'crop' (the matching-snapshot rule, §4.7): the scale is UNIFORM
    // and derived from WIDTH alone — the entering subject is stretched
    // or shrunk to the exiting subject's width, filling it, never
    // matched by cover — with the tops pinned and any vertical overflow
    // carried by an animated crop window that pays at the BOTTOM only.
    // Nothing ever stretches; 'scale' stretches per axis instead, and
    // the crossfade hides it.
    const crop = cropMode;
    const rx = m.from.width / (m.to.width || 1) || 1;
    const ry = m.from.height / (m.to.height || 1) || 1;
    const su = rx;
    const sx = crop ? su : rx;
    const sy = crop ? su : ry;
    const fx = holdsStart ? 1 / sx : sx;
    const fy = holdsStart ? 1 / sy : sy;
    const anchor = centreOf(holdsStart ? from : to);
    const matched = holdsStart ? m.from : m.to;
    // the pinned point: top-centre under 'crop', centre under 'scale'
    // (an exact per-axis map makes the two identical there)
    const pinned = crop
      ? { x: centreOf(matched).x, y: matched.y }
      : centreOf(matched);
    const cx = (1 - fx) * (pinned.x - anchor.x);
    const cy = (1 - fy) * (pinned.y - anchor.y);
    const x = holdsStart ? dx + cx : -dx + cx;
    const y = holdsStart ? dy + cy : -dy + cy;
    if (x !== 0) {
      target['x'] = holdsStart ? [0, x] : [x, 0];
      pairs.push(holdsStart ? [0, x] : [x, 0]);
    }
    if (y !== 0) {
      target['y'] = holdsStart ? [0, y] : [y, 0];
      pairs.push(holdsStart ? [0, y] : [y, 0]);
    }
    if (crop) {
      if (fx !== 1) {
        target['scale'] = holdsStart ? [1, fx] : [fx, 1];
      }
      // the crop window at the FAR pose: the other end's SUBJECT sets
      // the floor — anything of this element that runs past that
      // subject's bottom is cropped, and nothing else is. Pulled back
      // through the transform into this element's own space.
      const frame = holdsStart ? from : to;
      const window = holdsStart ? m.to : m.from;
      const f = holdsStart ? fx : sx;
      const d = { x, y };
      const pre = (edge: number) => anchor.y + (edge - anchor.y - d.y) / f;
      const clamp = (v: number) => Math.max(0, v);
      const b = clamp(frame.y + frame.height - pre(window.y + window.height));
      if (b > 0.5) {
        const far = `inset(0px 0px ${b.toFixed(2)}px 0px)`;
        const rest = 'inset(0px 0px 0px 0px)';
        target['clipPath'] = holdsStart ? [rest, far] : [far, rest];
      }
    } else {
      if (fx !== 1) {
        target['scaleX'] = holdsStart ? [1, fx] : [fx, 1];
      }
      if (fy !== 1) {
        target['scaleY'] = holdsStart ? [1, fy] : [fy, 1];
      }
    }
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
  if (scaleMode) {
    // handled above: the match block owns both translation and scale
  } else if (step.size !== false) {
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
  return {
    flight,
    longest,
    target,
    // a hot start leaves at the speed it was thrown (§6.1)
    velocity: hot ? gestureVelocity() : undefined,
  };
}

/** parse a computed rgb()/rgba() color into channels, or null */
function rgbOf(
  css: string | undefined,
): { a: number; b: number; g: number; r: number } | null {
  if (!css) {
    return null;
  }
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(
    css,
  );
  if (!m) {
    return null;
  }
  return {
    a: m[4] === undefined ? 1 : parseFloat(m[4]),
    b: parseFloat(m[3]!),
    g: parseFloat(m[2]!),
    r: parseFloat(m[1]!),
  };
}

/**
 * A skin's EFFECTIVE color: its background alpha-blended against the ground
 * it stood on — opacity turned into an actual color (§4.7). Null when the
 * skin has no visible background (type over transparency crossfades as
 * opacity, there is nothing to solidify) or wears a color this parser does
 * not speak, in which case the crossfade stays a plain dissolve.
 */
function effective(
  paint: string | undefined,
  ground: string | undefined,
): string | null {
  const src = rgbOf(paint);
  if (!src || src.a === 0) {
    return null;
  }
  if (src.a === 1) {
    return `rgb(${src.r}, ${src.g}, ${src.b})`;
  }
  const dst = rgbOf(ground);
  if (!dst) {
    return null;
  }
  const mix = (s: number, d: number) => Math.round(s * src.a + d * (1 - src.a));
  return `rgb(${mix(src.r, dst.r)}, ${mix(src.g, dst.g)}, ${mix(src.b, dst.b)})`;
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

function resolveStep(
  step: Step,
  cs: ChangesetLike,
  exclude?: ReadonlySet<Sprite>,
): Resolved {
  // a step with no `of` (a wait, a tether) still needs A sprite to hang its
  // cue on — the run keys its bookkeeping by sprite — so it takes the
  // first the changeset offers and produces exactly one cue
  const sprites = cs
    .sprites(step.of ?? {})
    .filter((s) => !exclude || !exclude.has(s));
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
    // a camera or tether is a statement about the scene, not a sprite:
    // one cue regardless of what `of` matched — as is any step that named
    // no subject at all
    if (
      (step.kind === 'camera' ||
        step.kind === 'tether' ||
        step.of === undefined) &&
      index > 0
    ) {
      break;
    }
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
            delivery: splitting ? { by: step.by!, order, stagger } : undefined,
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
            delivery: splitting ? { by: step.by!, order, stagger } : undefined,
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
          const transition: Record<string, unknown> =
            step.ms === undefined
              ? springTransition(step.spring)
              : tweenTransition(step, step.ms);
          if (r.velocity && step.ms === undefined) {
            // the engine reads transition[key] in preference to the whole
            if (r.target['x']) {
              transition['x'] = { ...transition, velocity: r.velocity.x };
            }
            if (r.target['y']) {
              transition['y'] = { ...transition, velocity: r.velocity.y };
            }
          }
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
            const cpz = cs.measureZoom ?? 1;
            const from = descale(cp.initial.page, cpz);
            const to = descale(sprite.final.page, cpz);
            const cpTarget: Record<string, unknown> = {};
            if (step.size === 'scale' || step.size === 'crop') {
              // the old skin rides the same match-box flight as its
              // receiver, mirrored: identity at its own seat, landing with
              // its SUBJECT on the receiver's — transform only, layout
              // untouched, and the same off-centre correction (see the
              // receiver's match block). Under 'crop' the scale is
              // uniform and its own crop window closes to the receiver's
              // frame as it lands.
              const crop = step.size === 'crop';
              const cpm = matchBoxes(cp.initial, sprite.final, from, to, cpz);
              const mf = centreOf(cpm.from);
              const mt = centreOf(cpm.to);
              const anchor = centreOf(from);
              const rx = cpm.to.width / (cpm.from.width || 1) || 1;
              const ry = cpm.to.height / (cpm.from.height || 1) || 1;
              // width-derived and top-pinned under 'crop', as on the
              // receiver: the exiting subject lands at the ENTERING
              // subject's width, tops together (the rule is symmetric)
              const eu = rx;
              const ex = crop ? eu : rx;
              const ey = crop ? eu : ry;
              const dxe = mt.x - anchor.x - ex * (mf.x - anchor.x);
              const dye = crop
                ? cpm.to.y - anchor.y - ey * (cpm.from.y - anchor.y)
                : mt.y - anchor.y - ey * (mf.y - anchor.y);
              if (dxe !== 0) {
                cpTarget['x'] = [0, dxe];
              }
              if (dye !== 0) {
                cpTarget['y'] = [0, dye];
              }
              if (crop) {
                if (ex !== 1) {
                  cpTarget['scale'] = [1, ex];
                }
                // the receiver's SUBJECT sets the floor here too
                const pre = (edge: number) =>
                  anchor.y + (edge - anchor.y - dye) / ex;
                const clamp = (v: number) => Math.max(0, v);
                const cb = clamp(
                  from.y + from.height - pre(cpm.to.y + cpm.to.height),
                );
                if (cb > 0.5) {
                  cpTarget['clipPath'] = [
                    'inset(0px 0px 0px 0px)',
                    `inset(0px 0px ${cb.toFixed(2)}px 0px)`,
                  ];
                }
              } else {
                if (ex !== 1) {
                  cpTarget['scaleX'] = [1, ex];
                }
                if (ey !== 1) {
                  cpTarget['scaleY'] = [1, ey];
                }
              }
            } else {
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
              // Both skins cross over the one flying box. A symmetric
              // opacity crossfade composites each against whatever stands
              // behind it, and mid-fade the pair sums short of solid — the
              // ground leaks through and the box visibly dips. So when both
              // skins wore a real background, alpha is turned into an
              // actual color (§4.7): the receiver holds opacity 1 wearing a
              // SOLID that tweens between the two skins' effective colors,
              // the old skin dissolves ABOVE it, and on landing the solid
              // is handed back to the stylesheet's own alpha (Cue.borrow).
              const oldSkin = effective(cp.initial?.paint, cs.ground);
              const newSkin = effective(sprite.final?.paint, cs.ground);
              const fade = {
                duration: r.longest / 1000,
                ease: 'easeInOut',
              };
              if (oldSkin && newSkin) {
                cues.push({
                  borrow: true,
                  duration: r.longest,
                  kind: 'tween',
                  offset,
                  sprite,
                  target: { backgroundColor: [oldSkin, newSkin] },
                  transition: fade,
                });
                cues.push({
                  duration: r.longest,
                  hold: { fill: false, values: { zIndex: 3 } },
                  kind: 'hold',
                  offset,
                  sprite: cp,
                });
              } else {
                cues.push({
                  duration: r.longest,
                  kind: 'tween',
                  offset,
                  sprite,
                  target: { opacity: [0, 1] },
                  transition: fade,
                });
              }
              cues.push({
                duration: r.longest,
                kind: 'tween',
                offset,
                sprite: cp,
                target: { opacity: [1, 0] },
                transition: fade,
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
      case 'camera': {
        const ms = step.ms ?? 600;
        // fit mode is DECLARED, not inferred: `fit: null` (fit nothing)
        // still means the step owns the whole pose and returns it to rest
        const fitting = step.fit !== undefined;
        const aimQuery = fitting ? step.fit : step.origin;
        const originSprite = aimQuery ? cs.sprite(aimQuery) : null;
        const box =
          originSprite?.final?.context ?? originSprite?.initial?.context;
        // context space carries the frame's transform (context = zoom ×
        // local), and transform-origin is written in LOCAL pixels — divide
        // back by the zoom the world was measured under (§6.3)
        const oz = cs.measureZoom ?? 1;
        const origin = box
          ? {
              x: (box.x + box.width / 2) / oz,
              y: (box.y + box.height / 2) / oz,
            }
          : undefined;
        let to = { x: step.x, y: step.y, zoom: step.zoom };
        if (fitting) {
          if (box && origin && cs.frame) {
            // Fit-and-centre, from the same rest-layout measurement FLIP
            // uses — never the painted box, so a click that lands mid-zoom
            // on a DIFFERENT tile still computes against rest geometry.
            // The margin is the sprite's share of the frame on whichever
            // axis fits first; the pan solves x + P = centre, since the
            // applied transform holds the aim point P at x + P (§6.3).
            const zoom =
              step.zoom ??
              (step.margin ?? 0.72) *
                Math.min(
                  (cs.frame.width * oz) / box.width,
                  (cs.frame.height * oz) / box.height,
                );
            to = {
              x: cs.frame.width / 2 - origin.x,
              y: cs.frame.height / 2 - origin.y,
              zoom,
            };
          } else {
            // fit nothing (null, or the sprite has left): the resting frame
            to = { x: 0, y: 0, zoom: 1 };
          }
        }
        cues.push({
          camera: {
            // centre and origin from the SAME final layout: the aim term
            // (origin − centre) is frozen numbers the run lerps — a board
            // that reflows mid-cue cannot move the camera
            centre: cs.frame
              ? { x: cs.frame.width / 2, y: cs.frame.height / 2 }
              : undefined,
            origin,
            steady: step.steady ? cs.sprites(step.steady) : [],
            to,
          },
          duration: ms,
          kind: 'camera',
          offset,
          sprite,
          transition: step.spring
            ? springTransition(step.spring)
            : { duration: ms / 1000, ease: step.ease ?? 'easeInOut' },
        });
        longest = Math.max(longest, offset + ms);
        break;
      }
      case 'tether': {
        cues.push({
          duration: step.ms ?? 0,
          kind: 'tether',
          offset,
          sprite,
          tether: {
            from: cs.sprites(step.from)[0] ?? null,
            name: step.name,
            path: step.path,
            to: cs.sprites(step.to)[0] ?? null,
          },
        });
        if (step.ms === undefined) {
          open = true;
        } else {
          longest = Math.max(longest, offset + step.ms);
        }
        break;
      }
      case 'follow': {
        // A derived write may only touch what the compositor treats as
        // paint, never layout: the region's fast keep declines a pass by
        // fingerprinting every participant's offsetLeft/Top/Width/Height,
        // so a follower writing real width would fail that fingerprint on
        // every frame and put the whole region back into release-and-
        // reassert once per frame — the jitter the fast keep exists to
        // prevent. Caught here, where the author can still read the name.
        for (const key of Object.keys(step.rest)) {
          if (!DERIVABLE.has(key)) {
            throw new Error(
              `choreo: c.Follow cannot drive '${key}' — a derived value is ` +
                'computed every frame, so it may only write transform, ' +
                'opacity and filter properties, never layout',
            );
          }
        }
        // The geometry a follower computes from is the PASS's, not the
        // page's: resting boxes measured while every moved value stood
        // released (releaseForMeasure), taken here into region space. The
        // run never measures for a follower again — see drive(). A sprite
        // the pass could not measure simply compiles no follow.
        const fz = cs.measureZoom ?? 1;
        const inZ = (r: Rect): Rect => ({
          height: r.height / fz,
          width: r.width / fz,
          x: r.x / fz,
          y: r.y / fz,
        });
        const restBounds = sprite.final ?? sprite.initial;
        if (!restBounds) {
          break;
        }
        const followed: { from: Rect; sprite: Sprite; to: Rect }[] = [];
        for (const source of cs.sprites(step.to)) {
          const toB = source.final ?? source.initial;
          const fromB = source.initial ?? source.final;
          if (toB && fromB) {
            followed.push({
              from: inZ(fromB.context),
              sprite: source,
              to: inZ(toB.context),
            });
          }
        }
        const ms = step.ms;
        cues.push({
          derive: {
            read: step.read,
            rest: step.rest,
            restBox: inZ(restBounds.context),
            sources: followed,
          },
          duration: ms ?? 0,
          kind: 'follow',
          offset,
          sprite,
        });
        if (ms === undefined) {
          open = true;
        } else {
          longest = Math.max(longest, offset + ms);
        }
        break;
      }
      case 'scroll': {
        const ms = step.ms ?? 420;
        cues.push({
          duration: ms,
          kind: 'scroll',
          offset,
          scroll: { align: step.align ?? 'center' },
          sprite,
        });
        longest = Math.max(longest, offset + ms);
        break;
      }
      case 'raise': {
        cues.push({
          duration: step.ms ?? 0,
          kind: 'raise',
          offset,
          raise: { shadow: step.shadow ?? false },
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
  // The yield rule (§4.7): a sprite a SPECIFIC step names belongs to that
  // step — the canned crossing's generic children surrender it, so "a
  // special exit that is not just a dissolve" is one sibling step, not a
  // query-exclusion syntax. Only property steps with a selective query
  // claim: a camera or a scroll is a statement about the scene, and an
  // unqualified `of` (match everything) is not a choice of sprite.
  const explicit = new Set<Sprite>();
  const claim = (node: TimelineNode) => {
    if (isGate(node)) {
      return;
    }
    if (isBlock(node)) {
      node.children.forEach(claim);
      return;
    }
    if (
      node.generic ||
      (node.kind !== 'tween' &&
        node.kind !== 'spring' &&
        node.kind !== 'move' &&
        node.kind !== 'hold')
    ) {
      return;
    }
    const q = node.of;
    const selective = Array.isArray(q)
      ? q.length > 0
      : q.id !== undefined || q.role !== undefined || q.type !== undefined;
    if (!selective) {
      return;
    }
    for (const s of cs.sprites(q)) {
      explicit.add(s);
    }
  };
  tree.forEach(claim);

  const resolved = new Map<Step, Resolved>();
  const of = (step: Step) => {
    let r = resolved.get(step);
    if (!r) {
      r = resolveStep(step, cs, step.generic ? explicit : undefined);
      resolved.set(step, r);
    }
    return r;
  };
  /**
   * A node's own length, anchoring aside — for a block, the span its
   * children occupy, which is what a `@name` on it promises to anyone who
   * anchors against it.
   */
  const extent = (node: TimelineNode): number => {
    if (isGate(node)) {
      return 0;
    }
    if (!isBlock(node)) {
      return of(node).duration;
    }
    return node.kind === 'sequence'
      ? node.children.reduce((sum, c) => sum + measure(c), 0)
      : node.children.reduce((max, c) => Math.max(max, measure(c)), 0);
  };
  /** what a node contributes to its parent's flow */
  const measure = (node: TimelineNode): number => {
    if (isGate(node)) {
      return 0;
    }
    // an anchored step or BLOCK is lifted out of its parent's flow: it
    // neither pushes a sequence forward nor stretches a block's span (§4.2)
    if (node.at) {
      return 0;
    }
    // a step's own duration already counts its delay; a block's does not,
    // because the delay is spent before its children begin
    return isBlock(node) ? (node.delay ?? 0) + extent(node) : of(node).duration;
  };
  const out: Cue[] = [];
  // duplicate names are an authoring error, caught before anything is placed
  const seen = new Set<string>();
  const checkNames = (node: TimelineNode) => {
    if (isGate(node)) {
      return;
    }
    // one namespace: a block and a step cannot share a name, or `@at` would
    // have two answers
    if (node.name) {
      if (seen.has(node.name)) {
        throw new Error(`choreo: two steps named '${node.name}'`);
      }
      seen.add(node.name);
    }
    if (isBlock(node)) {
      node.children.forEach(checkNames);
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
  /**
   * The whole score's span — computed BEFORE anything is placed, because an
   * open step's window depends on it.
   *
   * A score of nothing but open steps measures zero, and an open step's
   * window is "the enclosing block's span" — so the annotation the author
   * asked to be simply ON compiled to a zero-length run that ended on the
   * frame it was born. That is not a short wire, it is no wire; the app
   * that hit it wrote `ms: 3_600_000` to get an hour of clock out of a
   * step whose real lifetime is the scene's. So a score with no length of
   * its own does not borrow zero: its open cues STAND (§4.6), and the run
   * holds them until it is cancelled or replaced.
   */
  const root = measure({ children: tree, kind: 'parallel' });
  const standingScore = root === 0;
  /** did any cue actually take the standing window? */
  let stood = false;
  /** span: the time a hold without @duration is allowed to last from `start` */
  const place = (node: TimelineNode, start: number, span: number) => {
    if (isGate(node)) {
      gates.push({ at: start, auto: node.ms });
      return;
    }
    /** where an anchored node begins — the same arithmetic for a step and a block */
    const anchored = (ref: AnchorRef) => {
      const target = names.get(ref.anchor);
      if (!target) {
        throw new Error(
          `choreo: @at names '${ref.anchor}', which is not a step ` +
            'above this one — anchors point up the score',
        );
      }
      return ref.edge === 'end'
        ? target.start + target.duration + (ref.delay ?? 0) * 1000
        : target.start + (ref.progress ?? 0) * target.duration;
    };
    if (!isBlock(node)) {
      const r = of(node);
      const delay = node.delay ?? 0;
      let base = start;
      if (node.at) {
        if (r.open) {
          throw new Error(
            'choreo: an anchored hold needs its own @duration — lifted out ' +
              'of its block, it has no span to borrow',
          );
        }
        base = anchored(node.at);
      }
      if (node.name) {
        names.set(node.name, {
          duration: Math.max(0, r.duration - delay),
          start: base + delay,
        });
      }
      for (const cue of r.cues) {
        const { offset, ...rest } = cue;
        // `follow` belongs in this list for the same reason the other three
        // do — FollowStep.ms is documented as "the window; without it, the
        // enclosing block's span" — and was simply missed.
        const borrows =
          r.open &&
          (cue.kind === 'hold' ||
            cue.kind === 'raise' ||
            cue.kind === 'tether' ||
            cue.kind === 'follow');
        if (borrows && standingScore) {
          stood = true;
        }
        out.push({
          ...rest,
          duration: borrows
            ? standingScore
              ? Infinity
              : Math.max(0, span - delay - offset)
            : cue.duration,
          standing: borrows && standingScore ? true : undefined,
          start: base + delay + offset,
        });
      }
      return;
    }
    // a block answers to the anchor system on a step's terms: it can be
    // pointed at (`@name`), it can point (`@at`), and its delay is spent
    // inside its own slot before its children begin
    const total = extent(node);
    const from = (node.at ? anchored(node.at) : start) + (node.delay ?? 0);
    if (node.name) {
      // recorded BEFORE the children are placed, so a child may anchor
      // against the block it is in — `@at={{at 'intro' 0.5}}` reads the
      // same from inside as from outside
      names.set(node.name, { duration: total, start: from });
    }
    if (node.kind === 'sequence') {
      let offset = 0;
      for (const child of node.children) {
        place(child, from + offset, total - offset);
        offset += measure(child);
      }
      return;
    }
    // a parallel: every child at once — and no gate anywhere under it
    node.children.forEach(forbidGates);
    for (const child of node.children) {
      place(child, from, total);
    }
  };
  if (tree.length > 1) {
    tree.forEach(forbidGates);
  }
  for (const node of tree) {
    place(node, 0, root);
  }
  gates.sort((a, b) => a.at - b.at);
  const derived = out.filter((cue) => cue.derive);
  if (!derived.length) {
    return { cues: out, gates, open: stood };
  }
  // A follower's `now` is composed from whatever is driving its source
  // THIS frame, so it has to be evaluated after that driver has written
  // its frame. Cues are walked in order, so derived ones sort last —
  // stably, which keeps two followers in the order they were written.
  const nameOf = (sprite: Sprite) => sprite.id ?? sprite.role ?? 'a sprite';
  const drivenBy = new Map<Sprite, Cue>();
  for (const cue of derived) {
    drivenBy.set(cue.sprite, cue);
  }
  for (const cue of derived) {
    for (const source of cue.derive!.sources) {
      if (drivenBy.has(source.sprite)) {
        // Chains are resolvable in principle — a topological sort would do
        // it — but they are refused for now rather than half-supported: a
        // cycle inside one would be a frame loop with no honest answer,
        // and nothing yet needs the depth.
        throw new Error(
          `choreo: c.Follow on '${nameOf(cue.sprite)}' reads ` +
            `'${nameOf(source.sprite)}', which is itself derived — a follower may ` +
            'not follow a follower',
        );
      }
    }
  }
  return {
    cues: [...out.filter((cue) => !cue.derive), ...derived],
    gates,
    open: stood,
  };
}

/**
 * A replacement pass's continuity cue (§3.1): the prior run was driving
 * this sprite through space and the new score does not name it. Unnamed
 * it would be released to its rest in one frame — the whole-bay snap —
 * so the region completes the score: one shape-matched move from the
 * painted box (which is what a mid-flight sprite's `initial` IS, by
 * design) to its rest. Transform-only, so a continuation can never
 * reflow the scene it is tidying; on the interrupted cue's own spring
 * when it had one, so the carry-on keeps the flight's character.
 */
export function continuation(
  sprite: Sprite,
  cs: ChangesetLike,
  inherited?: Record<string, unknown>,
): Cue | null {
  const step: MoveStep = { kind: 'move', of: {}, size: 'scale' };
  const r = resolveMove(step, sprite, cs);
  if (!r) {
    return null;
  }
  // inherit only a spring's character: a tween's fixed duration was cut
  // for a different distance and would land wrong on this one
  const springy =
    inherited &&
    (inherited['type'] === 'spring' ||
      'stiffness' in inherited ||
      'visualDuration' in inherited ||
      'bounce' in inherited);
  return {
    duration: r.longest,
    flight: r.flight,
    kind: 'move',
    sprite,
    start: 0,
    target: r.target,
    transition: springy ? inherited : springTransition(undefined),
  };
}

/* ---- score identity: is this compile the one already in flight? ---- */

/**
 * Whether two compiled scores are the SAME statement — used by the region
 * to keep an in-flight run when an unrelated render replays the pass (the
 * render detector is volatile by design, so on a busy page every region
 * re-passes on every app render; a neighbouring demo writing tracked state
 * per frame must not restart this region's clock).
 *
 * The comparison is deliberately conservative. A FLIGHT is measured off the
 * page and is not comparable by value: any cue carrying one makes the scores
 * different, and the pass replays exactly as it always did. Values that ARE
 * comparable (targets, transitions, delivery plans, holds, camera aims)
 * compare structurally, so an edit that retimes or re-aims anything replays.
 *
 * Tethers, raises and scrolls used to be lumped in with flights, and that was
 * wrong in a way that only showed up on standing annotations: a wire that is
 * simply ON was recompiled to the identical statement on every pass and, being
 * declared different every time, had its run torn down and rebuilt — the path
 * element removed from the layer and a new one appended, sixty times a second
 * on a busy page. None of the three carries measured geometry in its cue: a
 * tether is two sprites and a function, a raise is a sprite and a flag, a
 * scroll is a sprite and an alignment. They compare by IDENTITY, which is
 * exactly what "the same statement" means for them — and it matters most for
 * the scroll, where replacing the cue is a visible restart of the scroll.
 */
export function sameScore(a: Cue[], b: Cue[]): boolean {
  return a.length === b.length && a.every((cue, i) => sameCue(cue, b[i]!));
}

function sameCue(a: Cue, b: Cue): boolean {
  if (
    a.kind !== b.kind ||
    a.sprite.node !== b.sprite.node ||
    a.start !== b.start ||
    a.duration !== b.duration ||
    (a.loop ?? false) !== (b.loop ?? false)
  ) {
    return false;
  }
  if (a.flight || b.flight) {
    return false;
  }
  if (a.tether || b.tether) {
    // the same two ends, drawn by the same function, under the same name
    if (
      !a.tether ||
      !b.tether ||
      a.tether.from?.node !== b.tether.from?.node ||
      a.tether.to?.node !== b.tether.to?.node ||
      a.tether.path !== b.tether.path ||
      a.tether.name !== b.tether.name
    ) {
      return false;
    }
  }
  if (a.raise || b.raise) {
    if (!a.raise || !b.raise || a.raise.shadow !== b.raise.shadow) {
      return false;
    }
  }
  if (a.scroll || b.scroll) {
    if (!a.scroll || !b.scroll || a.scroll.align !== b.scroll.align) {
      return false;
    }
  }
  const plain = (v: unknown) => JSON.stringify(v ?? null);
  // steady rides Sprite objects (cyclic); its cast size stands in for it
  const cam = (c: Cue['camera']) =>
    c
      ? {
          centre: c.centre ?? null,
          origin: c.origin ?? null,
          steady: c.steady.length,
          to: c.to,
        }
      : null;
  return (
    plain(a.target) === plain(b.target) &&
    plain(a.transition) === plain(b.transition) &&
    plain(a.delivery) === plain(b.delivery) &&
    plain(a.hold) === plain(b.hold) &&
    plain(cam(a.camera)) === plain(cam(b.camera))
  );
}
