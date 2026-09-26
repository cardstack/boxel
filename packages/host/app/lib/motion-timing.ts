import { registerDestructor } from '@ember/destroyable';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { cubicBezier } from 'motion-utils';

// One curve for every host motion: an ease-out that leaves at once (the
// click has already waited for capture) and lands softly, never
// overshooting. Live Choreo geometry, bitmap crossings and sampled
// keyframes all use it, so motions that play together arrive together.
export const motionEase: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
export const motionEaseAt = cubicBezier(...motionEase);

// Seconds. Motions that play together share a duration: a card opening
// into a new stack (boundary) runs alongside the stacks reflowing (card).
export const motionDurations = {
  card: 0.32,
  exit: 0.18,
  sheet: 0.24,
  crossing: 0.32,
  boundary: 0.32,
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
