/**
 * `c.gesture` — the live drag as a first-class geometry source (§6.1, §6.4).
 *
 * A document-level pointer tracker (listeners, not timers) keeps the last
 * pointer position and a short velocity window. A Move that borrows
 * `{{c.gesture}}` as its `@from` starts from wherever the finger let go —
 * sized as the sprite, centred on the pointer — and any spring that flies
 * it inherits the pointer's velocity, so a toss leaves at the speed it was
 * thrown.
 */
import type { Bounds, Rect } from './types.ts';

export interface GestureRef {
  gesture: true;
}

export const GESTURE: GestureRef = { gesture: true };

export function isGestureRef(v: unknown): v is GestureRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { gesture?: unknown }).gesture === true
  );
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

let samples: Sample[] = [];
let tracking = false;

function record(event: PointerEvent) {
  const now = performance.now();
  samples.push({ t: now, x: event.clientX, y: event.clientY });
  if (samples.length > 8) {
    samples.shift();
  }
}

/** idempotent; the first <Choreo> turns it on */
export function trackGestures() {
  if (tracking || typeof window === 'undefined') {
    return;
  }
  tracking = true;
  window.addEventListener('pointerdown', record, {
    capture: true,
    passive: true,
  });
  window.addEventListener('pointermove', record, {
    capture: true,
    passive: true,
  });
  window.addEventListener('pointerup', record, {
    capture: true,
    passive: true,
  });
}

/** the pointer's page position now, or null before any pointer event */
export function gesturePoint(): { x: number; y: number } | null {
  const last = samples[samples.length - 1];
  return last ? { x: last.x, y: last.y } : null;
}

/** units per second over the recent window — what a spring inherits */
export function gestureVelocity(): { x: number; y: number } {
  if (samples.length < 2) {
    return { x: 0, y: 0 };
  }
  const now = performance.now();
  const recent = samples.filter((s) => now - s.t < 120);
  const a = recent[0] ?? samples[samples.length - 2]!;
  const b = samples[samples.length - 1]!;
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) {
    return { x: 0, y: 0 };
  }
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

/** the gesture as a box: the sprite\'s own size, centred on the pointer */
export function gestureBounds(size: Rect): Bounds | null {
  const point = gesturePoint();
  if (!point) {
    return null;
  }
  const page: Rect = {
    height: size.height,
    width: size.width,
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
  };
  return { context: page, page, parent: page };
}

/** test-support: forget everything between tests */
export function resetGestures() {
  samples = [];
}
