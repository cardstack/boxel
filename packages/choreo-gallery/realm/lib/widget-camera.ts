import type { Camera3DState, Camera3DWaypoint } from '@cardstack/choreo';
import { animate } from 'glimmer-motion';

/** the controls a camera move hands back: a clock to seek, pause or stop */
export type CameraRun = ReturnType<typeof animate>;

/**
 * One cardinal-spline component: Hermite through p1 and p2, tangents off p0
 * and p3 scaled by `k = (1 - tension) / 2` — the curve `c.Camera3D @through`
 * samples, so a room path and a film path bend the same way.
 */
function crVal(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number,
  k: number,
) {
  const m1 = k * (p2 - p0);
  const m2 = k * (p3 - p1);
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p1 +
    (u3 - 2 * u2 + u) * m1 +
    (-2 * u3 + 3 * u2) * p2 +
    (u3 - u2) * m2
  );
}

/** the path's control points: the starting pose, then each waypoint filled in */
function controlPoints(
  from: Camera3DState,
  through: Camera3DWaypoint[],
): Camera3DState[] {
  const aimed = !!from.look || through.some((w) => w.look);
  const seed: Camera3DState = {
    ...from,
    look: aimed ? (from.look ?? { x: 0, y: 0, z: 0 }) : undefined,
  };
  const pts = [seed];
  let prev = seed;
  for (const w of through) {
    const p: Camera3DState = {
      dolly: w.dolly ?? prev.dolly,
      look: aimed ? (w.look ?? prev.look) : undefined,
      pitch: w.pitch ?? prev.pitch,
      x: w.x ?? prev.x,
      y: w.y ?? prev.y,
      yaw: w.yaw ?? prev.yaw,
    };
    pts.push(p);
    prev = p;
  }
  return pts;
}

/**
 * The pose at progress p ∈ [0, 1] along a path through the waypoints, one
 * uniform segment per waypoint, its ends clamped. A pure function of
 * progress, so seeking the clock lands exactly where playing there would.
 */
function sample(
  pts: Camera3DState[],
  progress: number,
  tension: number,
): Camera3DState {
  const k = (1 - tension) / 2;
  const segs = pts.length - 1;
  const s = Math.min(segs - 1e-9, Math.max(0, progress * segs));
  const i = Math.floor(s);
  const u = s - i;
  const P = (j: number) => pts[Math.max(0, Math.min(segs, j))]!;
  const p0 = P(i - 1);
  const p1 = P(i);
  const p2 = P(i + 1);
  const p3 = P(i + 2);
  const v = (key: 'dolly' | 'pitch' | 'x' | 'y' | 'yaw') =>
    crVal(p0[key], p1[key], p2[key], p3[key], u, k);
  const out: Camera3DState = {
    dolly: v('dolly'),
    pitch: v('pitch'),
    x: v('x'),
    y: v('y'),
    yaw: v('yaw'),
  };
  const l1 = p1.look;
  const l2 = p2.look;
  if (l1 && l2) {
    const l0 = p0.look ?? l1;
    const l3 = p3.look ?? l2;
    const l = (a: 'x' | 'y' | 'z') => crVal(l0[a], l1[a], l2[a], l3[a], u, k);
    out.look = { x: l('x'), y: l('y'), z: l('z') };
  }
  return out;
}

/**
 * A SETTLE: the pose is a Hann-weighted average of the same spline sampled
 * around the current progress. Averaging a curve smooths the curvature step
 * at each waypoint without lag or memory, so it is still a pure function of
 * progress. The window tapers to nothing at either end, so the path still
 * starts and lands exactly on its end points. `width` is in progress.
 */
function settle(
  pts: Camera3DState[],
  progress: number,
  tension: number,
  width: number,
  taps = 15,
): Camera3DState {
  const p = Math.min(1, Math.max(0, progress));
  const room = Math.min(p, 1 - p);
  const w = width > 0 ? width * Math.tanh((2 * room) / width) : 0;
  if (!(w > 1e-6)) {
    return sample(pts, p, tension);
  }
  const aimed = !!pts[0]?.look;
  let sum = 0;
  const acc = { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0, lx: 0, ly: 0, lz: 0 };
  for (let i = 0; i < taps; i += 1) {
    const f = (i + 1) / (taps + 1);
    const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * f);
    const q = sample(pts, p + (f - 0.5) * w, tension);
    sum += weight;
    acc.dolly += weight * q.dolly;
    acc.pitch += weight * q.pitch;
    acc.x += weight * q.x;
    acc.y += weight * q.y;
    acc.yaw += weight * q.yaw;
    if (aimed && q.look) {
      acc.lx += weight * q.look.x;
      acc.ly += weight * q.look.y;
      acc.lz += weight * q.look.z;
    }
  }
  const out: Camera3DState = {
    dolly: acc.dolly / sum,
    pitch: acc.pitch / sum,
    x: acc.x / sum,
    y: acc.y / sum,
    yaw: acc.yaw / sum,
  };
  if (aimed) {
    out.look = { x: acc.lx / sum, y: acc.ly / sum, z: acc.lz / sum };
  }
  return out;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** the straight move from one pose to another, at eased progress t */
function between(
  from: Camera3DState,
  to: Camera3DState,
  t: number,
): Camera3DState {
  const out: Camera3DState = {
    dolly: mix(from.dolly, to.dolly, t),
    pitch: mix(from.pitch, to.pitch, t),
    x: mix(from.x, to.x, t),
    y: mix(from.y, to.y, t),
    yaw: mix(from.yaw, to.yaw, t),
  };
  const a = from.look ?? to.look;
  const b = to.look ?? from.look;
  if (a && b) {
    out.look = {
      x: mix(a.x, b.x, t),
      y: mix(a.y, b.y, t),
      z: mix(a.z, b.z, t),
    };
  }
  return out;
}

/**
 * Move the room's camera from one pose to another, handing every frame's
 * pose to `update`. With `through`, the camera rides a spline through those
 * waypoints at a constant rate with a 0.3s settle; without, it eases
 * straight to `to`. The returned controls are the move's clock: the quick
 * tour seeks it (`time`) against its narration.
 *
 * Under reduced motion a short move is a cut, and a path holds its first
 * pose: the tour steps the camera itself.
 */
export function moveRoomCamera(
  from: Camera3DState,
  to: Camera3DState,
  update: (pose: Camera3DState) => void,
  durationMs = 1450,
  through?: Camera3DWaypoint[],
): CameraRun {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seconds = (reduced && durationMs < 5000 ? 1 : durationMs) / 1000;
  const pts = through && !reduced ? controlPoints(from, through) : undefined;
  const width = pts ? 0.3 / seconds : 0;
  const target = reduced && through ? from : to;
  return animate(0, 1, {
    duration: seconds,
    ease: pts ? 'linear' : [0.4, 0, 0.2, 1],
    onUpdate: (t: number) =>
      update(pts ? settle(pts, t, 0.6, width) : between(from, target, t)),
  });
}
