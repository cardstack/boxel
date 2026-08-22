/**
 * Slow motion — a global divisor applied to every transition this binding
 * hands the engine.
 *
 * Not a Motion feature: Motion has no global time scale. Setting `speed` on a
 * running animation is not it either — an animation recomputes its own time
 * when its speed changes, so a spring mid-flight jumps rather than slows. What
 * works is scaling the *transition* before the engine ever sees it, so the
 * animation is simply born slower.
 *
 *   setMotionSpeed(5)   // transitions started from now on take five times as long
 *   setMotionSpeed(1)   // back to normal
 *
 * Applies to whatever starts after the change, not to what is already running.
 * Meant for looking at a transition closely.
 */
import type { Transition } from 'motion-dom';

/** how much longer than normal: 1 is normal, 5 is five times as slow */
let divisor = 1;
const listeners = new Set<(divisor: number) => void>();

export function motionSpeed(): number {
  return divisor;
}

export function setMotionSpeed(next: number) {
  const clean = Number.isFinite(next) && next > 0 ? next : 1;
  if (clean === divisor) {
    return;
  }
  divisor = clean;
  listeners.forEach((fn) => fn(clean));
}

export function onMotionSpeed(fn: (divisor: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** the time-valued options — everything here is simply multiplied */
const TIMES = ['duration', 'delay', 'visualDuration', 'repeatDelay'] as const;
/** the orchestration options, which are times too */
const STAGGERS = ['staggerChildren', 'delayChildren'] as const;
/** not a transition option: a per-value override sits under its value's name */
const NOT_A_VALUE = new Set<string>([
  ...TIMES,
  ...STAGGERS,
  'type',
  'ease',
  'times',
  'repeat',
  'repeatType',
  'bounce',
  'stiffness',
  'damping',
  'mass',
  'velocity',
  'restSpeed',
  'restDelta',
  'from',
  'elapsed',
  'driver',
  'onPlay',
  'onComplete',
  'onUpdate',
  'when',
  'staggerDirection',
]);

/**
 * A spring's period goes as sqrt(mass / stiffness), so `mass * k²` makes it k
 * times slower — and `damping * k` keeps the damping ratio, so it slows down
 * without changing shape.
 */
function scaleSpring(t: Record<string, unknown>, k: number) {
  if (t['stiffness'] !== undefined || t['damping'] !== undefined) {
    t['mass'] = ((t['mass'] as number) ?? 1) * k * k;
    if (t['damping'] !== undefined) {
      t['damping'] = (t['damping'] as number) * k;
    }
  }
}

/** the same transition, taking `k` times as long — per-value overrides included */
export function scaleTransition(
  transition: Transition | undefined,
  k: number,
): Transition | undefined {
  if (!transition || k === 1 || typeof transition !== 'object') {
    return transition;
  }
  const out: Record<string, unknown> = { ...transition };
  for (const key of TIMES) {
    if (typeof out[key] === 'number') {
      out[key] = (out[key] as number) * k;
    }
  }
  for (const key of STAGGERS) {
    if (typeof out[key] === 'number') {
      out[key] = (out[key] as number) * k;
    }
  }
  scaleSpring(out, k);
  // `transition: { opacity: {...}, default: {...} }` — recurse into each
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (
      !NOT_A_VALUE.has(key) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = scaleTransition(value as Transition, k);
    }
  }
  return out as Transition;
}

/** scale a transition by the divisor in force right now */
export const slowed = (transition: Transition | undefined) =>
  scaleTransition(transition, divisor);
