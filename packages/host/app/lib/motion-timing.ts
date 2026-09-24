import { registerDestructor } from '@ember/destroyable';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { spring } from 'motion-dom';

export const motionEase: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
// Bake a critically damped response into the native easing at capture time.
// Normalize its visual interval so geometry reaches exactly 1 at our deadline,
// rather than keeping a long physical spring tail (and its layers) alive.
const boundaryResponse = spring({
  keyframes: [0, 1],
  visualDuration: 1,
  bounce: 0,
});
const boundaryTarget = boundaryResponse.next(1000).value;
export const boundaryEase = (progress: number) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return boundaryResponse.next(progress * 1000).value / boundaryTarget;
};
// Reverse the geometry, but retain a responsive departure and gentle landing.
export const boundaryReturnEase = boundaryEase;

export const motionDurations = {
  card: 0.28,
  exit: 0.18,
  sheet: 0.24,
  crossing: 0.32,
  boundary: 0.36,
  boundaryReturn: 0.26,
  workspace: 0.4,
};

function readInspectionSpeed() {
  let value = Number(new URLSearchParams(location.search).get('motionSpeed'));
  return value > 0 ? Math.min(2, Math.max(0.1, value)) : 1;
}

// Route serialization drops unrecognized query parameters. Keep the review
// speed for this page session so the first navigation cannot turn it off.
const pageInspectionSpeed = readInspectionSpeed();
export function inspectionSpeed() {
  return pageInspectionSpeed;
}

export default class MotionTiming {
  @tracked private reducedMotion: boolean;

  constructor(owner: object) {
    let preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = preference.matches;
    let update = () => (this.reducedMotion = preference.matches);
    preference.addEventListener('change', update);
    registerDestructor(owner, () =>
      preference.removeEventListener('change', update),
    );
  }

  duration(override?: number, fallback = motionDurations.card) {
    return this.reducedMotion
      ? 0
      : (override ?? (isTesting() ? 0 : fallback)) / inspectionSpeed();
  }
}
