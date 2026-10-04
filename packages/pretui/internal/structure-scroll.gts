// Pretui — structure/scroll: the viewport family.
//
// Three components, in dependency order:
//
//   Scroller       a scroll container that TELLS you it is clipped
//   Carousel       a scroll-snap track with keyboard, dots and a status
//                  line — composed ON Scroller, not beside it
//   ZoomableFrame  a zoom-and-pan viewport around framed content
//
// `Scroller` is deliberately first and deliberately small: "content
// continues past this edge" is a fact half the kit's collections need, and
// before this it was re-solved (or skipped) per component. `Carousel`
// consumes it rather than reimplementing edge detection: the primitive is
// built before its consumers.
//
// ── The realm's timer law, and how the whole file obeys it ───────────────
//
// No `setTimeout`, no `setInterval`, no rAF loop, no `Date.now()`, no
// `Math.random()`. Everything reactive here is either an EVENT LISTENER or
// an OBSERVER, every one owned by an `ember-modifier` that removes or
// disconnects it in the destructor:
//
//   scroll / pointer* / wheel / keydown   listeners  (removed on teardown)
//   ResizeObserver                        overflow + geometry (disconnected)
//   IntersectionObserver                  which slide is showing (disconnected)
//
// The one place a timer would be idiomatic — carousel auto-advance — is
// therefore NOT SHIPPED, and that is a deliberate, stated decision rather
// than an omission: a re-arming timer blocks `await settled()` and hangs the
// test suite for every agent working in this realm. The accessibility
// guidance ("must not auto-advance without consent, and `prefers-
// reduced-motion` suppresses it entirely") is satisfied by construction, and
// `@onIndexChange` is the seam a host outside the realm can drive.
//
// Pretui — shared helpers for Scroller, Carousel and ZoomableFrame: reduced motion, scroll behaviour, clamp.

// ── Shared helpers ───────────────────────────────────────────────────────

/** True when the reader has asked the platform for less motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Reduced motion lands on the END STATE — an instant jump, never a frozen
 * midpoint (Law 5). */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The nearest ancestor that scrolls, or null for the viewport — what a
 * pane-local observer or sticky element measures against. */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    let style = getComputedStyle(node);
    if (SCROLLS.test(style.overflowY + ' ' + style.overflowX)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

const SCROLLS = /(auto|scroll|overlay)/;
