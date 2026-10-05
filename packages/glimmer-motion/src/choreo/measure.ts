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
import { defineParticipantArg } from '../participant.ts';
import type { Bounds, Rect } from './types.ts';

// `pack`'s type is declared in registry.ts, which the published declarations reach
defineParticipantArg('pack', (el, pack) => {
  if (pack === 'content') {
    el.setAttribute('data-choreo-pack', 'content');
  } else {
    el.removeAttribute('data-choreo-pack');
  }
});

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
  /** the computed background at measure time — see Bounds.paint */
  paint?: string;
  parent: DOMRect;
  /** the declared subject's box at measure time — see Bounds.substance */
  substance?: DOMRect;
}

/**
 * The shrink-wrap of `el`'s contents — the ink — not the stretched layout
 * box. A full-bleed title (`left:0; right:0; width:auto`) still has a
 * word-sized range; Crossing crop must match THAT, or the type explodes
 * into a viewport strip. Empty / collapsed → undefined, so the frame wins.
 */
export const inkBox = (el: Element): DOMRect | undefined => {
  const doc = el.ownerDocument;
  if (!doc) {
    return undefined;
  }
  const range = doc.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  if (r.width < 0.5 && r.height < 0.5) {
    return undefined;
  }
  return r;
};

const substanceOf = (el: Element): DOMRect | undefined => {
  const marked = el
    .querySelector('[data-choreo-substance]')
    ?.getBoundingClientRect();
  if (marked) {
    return marked;
  }
  if (el.getAttribute('data-choreo-pack') === 'content') {
    return inkBox(el);
  }
  return undefined;
};

/** the containing block a `position: absolute` child would be placed against */
export const offsetBox = (el: Element): DOMRect =>
  (
    (el as HTMLElement).offsetParent ??
    el.parentElement ??
    el
  ).getBoundingClientRect();

export const measure = (el: Element): Snapshot => ({
  el: el.getBoundingClientRect(),
  // read with the geometry, while the element is still attached: a removed
  // skin is detached DOM by the time a crossing asks what color it wore
  paint: getComputedStyle(el).backgroundColor,
  parent: offsetBox(el),
  // Keynote matches OBJECTS, not slide frames: an element may declare its
  // visible subject with [data-choreo-substance], or pack="content" (the
  // shrink-wrap / ink, no extra node). Captured with the geometry for
  // the same reason paint is.
  substance: substanceOf(el),
});

/** the three spaces, from a snapshot and the region's own box */
export const boundsOf = (snap: Snapshot, root: DOMRect): Bounds => ({
  context: minus(snap.el, root),
  page: rect(snap.el),
  paint: snap.paint,
  parent: minus(snap.el, snap.parent),
  substance: snap.substance && rect(snap.substance),
});

/** measure an element straight into bounds — what a beacon needs */
export const measureBounds = (el: Element, root: DOMRect): Bounds =>
  boundsOf(measure(el), root);
