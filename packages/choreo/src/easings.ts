/**
 * The cosine easings, recovered from boxel-motion (`easings/cosine.ts` at
 * `cardstack/boxel@394503e3b7^`) — the ones its own flagship transition used.
 *
 * `easeInAndOut` is the interesting one: a raised cosine has zero slope at both
 * ends, so an animation interrupted at t=0 inherits none of its own curve and
 * all of whatever it is replacing. That is the property Ember Animated leans on
 * to make a summed corrective curve continuous; here the same shape is simply
 * available as an `@ease`.
 *
 *   <c.Tween @of={{c.kept 'card'}} @opacity={{1}} @ms={{300}} @ease={{easeIn}} />
 *
 * `@ease` also takes an engine easing name or a cubic-bezier as four numbers;
 * these exist because a bezier cannot express a raised cosine exactly.
 */

/** a raised cosine: zero slope at both ends */
export function easeInAndOut(t: number): number {
  return 0.5 - Math.cos(t * Math.PI) / 2;
}

/**
 * Cosine in, then straight. Switching naively from cosine to linear at the
 * halfway point would finish early, so the curve is rescaled to stay inside
 * the 0..1 window.
 */
const adjust = 1 / 2 + 1 / Math.PI;
const cutover = 1 / (2 * adjust);
const intercept = (2 - Math.PI) / 4;
const slope = (Math.PI / 2) * adjust;

export function easeIn(t: number): number {
  return t < cutover ? easeInAndOut(t * adjust) : slope * t + intercept;
}

export function easeOut(t: number): number {
  return 1 - easeIn(1 - t);
}
