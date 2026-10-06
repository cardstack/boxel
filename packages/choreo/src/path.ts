/**
 * THE CAMERA'S PATH — the arithmetic behind `c.Camera3D @through`, and
 * the only place in Choreo that owns a curve rather than a tween.
 *
 * Everything here is a pure function of PROGRESS. That is the whole
 * point: a seek must land the shot exactly where playing there would, so
 * nothing in this file may remember a previous frame. A spline that is
 * sampled rather than integrated can be scrubbed, rendered a frame at a
 * time, and played, and all three agree by construction.
 */
import type { Camera3DState, Camera3DWaypoint } from './types.ts';

/**
 * One cardinal-spline component: Hermite through p1 and p2, tangents off
 * p0 and p3 scaled by `k = (1 - tension) / 2`. Tension 0 is the classic
 * Catmull-Rom — lively, and loose enough to overshoot between waypoints
 * that change direction; 1 collapses the tangents and the path goes
 * piecewise-linear. The default (0.5) is the steady hand: it still crosses
 * every waypoint with continuous velocity, but it does not sway on the way.
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

/**
 * Resolve a `@through` path's control points: the pose in force first, then
 * each waypoint with its omissions carried forward. If ANY point carries a
 * look, every point gets one (the origin, when unstated), so the aim is
 * splined by the same arithmetic as the pose.
 */
function resolveThrough(
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

/** the shot a slot position falls in — points [a, e), window [w0, w1) */
interface Shot {
  /** first point of the shot */
  a: number;
  /** one past its last point */
  e: number;
  /** the shot's window, in slot units */
  w0: number;
  w1: number;
}

/**
 * WHICH SHOT A SLOT POSITION IS IN. A waypoint marked `cut` opens a new
 * one, and the two facts a caller needs about it are the points it may
 * reach for and the slice of the clock it owns — the second so that
 * nothing (a sample, a settle) ever reads across a seam.
 */
function shotAt(
  through: Camera3DWaypoint[],
  points: number,
  segs: number,
  s: number,
): Shot {
  /* the seams, in point indices (+1: the seed sits at 0) */
  let seams: number[] | undefined;
  for (const [n, w] of through.entries()) {
    if (w.cut) {
      (seams ??= []).push(n + 1);
    }
  }
  let a = 0;
  let e = points;
  let w0 = 0;
  let w1 = segs;
  if (seams) {
    if (seams[0] === 1) {
      /* a leading cut: the seed never plays */
      a = 1;
      seams = seams.slice(1);
    }
    for (const seam of seams) {
      if (s < seam) {
        e = seam;
        w1 = seam;
        break;
      }
      a = seam;
      w0 = seam;
    }
  }
  return { a, e, w0, w1 };
}

/**
 * Sample the spline at overall progress p ∈ [0, 1] (uniform segments).
 *
 * SPLICES (docs/choreo-splices.md): a waypoint marked `cut` starts a new
 * SHOT. Each shot is a clamped spline of its own points — endpoint
 * tangents one-sided, so no shot's velocity crosses a seam — and each
 * shot's window runs from its first slot to the next seam, its points
 * spread uniformly across it. The outgoing shot therefore plays through
 * the seam instant (its motion stretches by one slot rather than
 * parking), the incoming one begins exactly on it, and the sampled pose
 * is a step function at the seam. Waypoints keep their uniform slots, so
 * cues anchored to waypoint moments keep their clock. A cut on the first
 * waypoint drops the pose-in-force seed: the score opens inside its
 * first shot.
 */
export function sampleThrough(
  from: Camera3DState,
  through: Camera3DWaypoint[],
  progress: number,
  tension?: number,
): Camera3DState {
  const k = (1 - (tension ?? 0.5)) / 2;
  const pts = resolveThrough(from, through);
  const segs = pts.length - 1;
  const s = Math.min(segs - 1e-9, Math.max(0, progress * segs));
  const { a, e, w0, w1 } = shotAt(through, pts.length, segs, s);
  const m = e - a;
  const lam =
    m === 1 ? 0 : Math.max(0, Math.min(1 - 1e-9, (s - w0) / (w1 - w0)));
  const ss = lam * (m - 1);
  const i = a + Math.floor(ss);
  const u = m === 1 ? 0 : ss - Math.floor(ss);
  /* clamped to the SHOT: the far side of a seam does not exist here */
  const P = (j: number) => pts[Math.max(a, Math.min(e - 1, j))]!;
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
  if (p1.look && p2.look) {
    const l = (a: 'x' | 'y' | 'z') =>
      crVal(
        (p0.look ?? p1.look)![a],
        p1.look![a],
        p2.look![a],
        (p3.look ?? p2.look)![a],
        u,
        k,
      );
    out.look = { x: l('x'), y: l('y'), z: l('z') };
  }
  return out;
}
/**
 * A SETTLE — the operator's second hand, written as a function of time.
 *
 * A cardinal spline crosses its waypoints with continuous velocity but
 * not continuous acceleration: at every control point the curvature
 * steps, and the eye reads that step as a tick. The usual cure is a
 * spring chasing the pose, which works and costs the two things a
 * seekable engine cannot pay — it remembers the last frame, so a scrub
 * lands somewhere a play would not, and it lags, so the camera is always
 * behind the score by however much smoothing it was given.
 *
 * This is the same cure without either cost: the reported pose is a
 * Hann-weighted average of the SAME spline sampled around the current
 * progress. Averaging a curve is a low-pass filter, and a Hann window
 * kills the acceleration steps outright, so the result is a hand rather
 * than a mechanism. Being centred, it has no lag — it reads slightly
 * ahead of the score exactly as much as it reads behind. Being an
 * average of one pure function, it is still a pure function: play,
 * scrub and frame-by-frame render all report the same pose.
 *
 * TWO EDGES IT MUST NOT CROSS. A cut is a step in the pose on purpose,
 * and an average that straddled it would smear the cut into a very fast
 * pan. The window is therefore TAPERED to the shot the progress is in:
 * near either edge the kernel shrinks to the room it has, reaching zero
 * at the edge itself. So a cut stays a cut, a path still lands exactly
 * on its last waypoint, and the pose handed forward to the next cue is
 * the waypoint rather than an average of one — the filter is an identity
 * at every boundary and a smoother everywhere else.
 *
 * The taper is `tanh`, not a `min`, and the difference is the whole
 * reason it works. A hard `min(width, 2 × room)` has a corner in it
 * where the two branches meet, and a filter whose width has a corner
 * puts one back into what it filters: measured against a path with two
 * right-angle corners in it, the hard taper LOST ground as the window
 * widened (worst jerk 8.7e-4 at a window of 0.175, 2.5e-3 at 0.3) while
 * the smooth one held 8.0e-4 at every width against 4.2e-3 unfiltered.
 * `tanh(x) ≤ x` everywhere, which is what keeps the taps inside the
 * shot; it is smooth, which is what keeps the tick out.
 *
 * `width` is in progress, not seconds: the kinks being filtered are at
 * the waypoints, which are spread uniformly across the clock, so a
 * window measured against the clock is a window measured against the
 * spacing of the things it exists to smooth. The caller converts.
 */
export function settleThrough(
  from: Camera3DState,
  through: Camera3DWaypoint[],
  progress: number,
  tension: number | undefined,
  width: number,
  taps = 15,
): Camera3DState {
  const pts = resolveThrough(from, through);
  const segs = pts.length - 1;
  const s = Math.min(segs - 1e-9, Math.max(0, progress * segs));
  const { w0, w1 } = shotAt(through, pts.length, segs, s);
  const lo = w0 / segs;
  const hi = w1 / segs;
  const p = Math.min(hi, Math.max(lo, progress));
  /* tapered: the kernel never reaches past the shot it is in */
  const room = Math.min(p - lo, hi - p);
  const w = width > 0 ? width * Math.tanh((2 * room) / width) : 0;
  if (!(w > 1e-6) || taps < 3) {
    return sampleThrough(from, through, progress, tension);
  }
  const aimed = !!from.look || through.some((t) => t.look);
  let sum = 0;
  let dolly = 0;
  let pitch = 0;
  let x = 0;
  let y = 0;
  let yaw = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  for (let i = 0; i < taps; i += 1) {
    /* the tap fractions avoid 0 and 1, where a Hann window is zero and
       the sample would be carried for nothing */
    const f = (i + 1) / (taps + 1);
    const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * f);
    const at = p + (f - 0.5) * w;
    const q = sampleThrough(from, through, at, tension);
    sum += weight;
    dolly += weight * q.dolly;
    pitch += weight * q.pitch;
    x += weight * q.x;
    y += weight * q.y;
    /* yaw is averaged as a NUMBER, not as an angle, because the spline
       under it interpolates yaw as a number too — a score unwraps its
       own turns (`Camera3DStep.through`) and the filter must agree with
       the curve it is filtering rather than second-guess it */
    yaw += weight * q.yaw;
    if (aimed && q.look) {
      lx += weight * q.look.x;
      ly += weight * q.look.y;
      lz += weight * q.look.z;
    }
  }
  const out: Camera3DState = {
    dolly: dolly / sum,
    pitch: pitch / sum,
    x: x / sum,
    y: y / sum,
    yaw: yaw / sum,
  };
  if (aimed) {
    out.look = { x: lx / sum, y: ly / sum, z: lz / sum };
  }
  return out;
}
