/**
 * One measurement layer, for everything that measures.
 *
 * The region and the beacon registry both turn a DOMRect into the three spaces
 * a step can ask for — page, region-relative, offset-parent-relative — and they
 * have to agree exactly, because a Move routinely reads one sprite's `page` and
 * another's. Ember Animated learned the same thing the hard way and ended up
 * with a single bounds module; two copies of `minus` that drift by a scroll
 * offset produce a flight that lands next to its target, which is the kind of
 * bug that looks like a spring problem for a day.
 */
import type { Bounds, Rect } from './types.ts';

/** a box in page space */
export const rect = (r: DOMRect): Rect => ({
  height: r.height,
  width: r.width,
  x: r.left,
  y: r.top,
});

/** `a` expressed relative to `b`'s top-left, keeping a's size */
export const minus = (a: DOMRect, b: DOMRect): Rect => ({
  height: a.height,
  width: a.width,
  x: a.left - b.left,
  y: a.top - b.top,
});

/** an element's box together with the box it is positioned inside */
export interface Snapshot {
  el: DOMRect;
  parent: DOMRect;
}

/** the containing block a `position: absolute` child would be placed against */
export const offsetBox = (el: Element): DOMRect =>
  (
    (el as HTMLElement).offsetParent ??
    el.parentElement ??
    el
  ).getBoundingClientRect();

export const measure = (el: Element): Snapshot => ({
  el: el.getBoundingClientRect(),
  parent: offsetBox(el),
});

/** the three spaces, from a snapshot and the region's own box */
export const boundsOf = (snap: Snapshot, root: DOMRect): Bounds => ({
  context: minus(snap.el, root),
  page: rect(snap.el),
  parent: minus(snap.el, snap.parent),
});

/** measure an element straight into bounds — what a beacon needs */
export const measureBounds = (el: Element, root: DOMRect): Bounds =>
  boundsOf(measure(el), root);
