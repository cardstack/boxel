// Pretui — the focus / keyboard / owned-timer foundation.
//
// Appendix L names "Focus & keyboard" as a foundation that was *duplicated*
// rather than shared: `structure-data.gts` and `reading-extras.gts` each kept
// a private copy of `focusWhen` + `rovingTabindex`. This module is the single
// home. Both re-export from here so no caller breaks.
//
// It also owns the two things the menu work needed and nobody had:
//
//  1. **Owned timers.** The realm law forbids *unowned* timers — handles that
//     outlive the element that scheduled them. Chris's 2026-08-13 ruling (and
//     its Appendix N.6 extension) permits a `setTimeout` when an
//     `ember-modifier` owns it and clears it in the destructor. `OwnedTimers`
//     makes that ownership structural rather than a promise: nothing can be
//     scheduled until `adopt()` has run, and `release()` clears every handle.
//     `ownsTimers` is the modifier that calls both. A component that forgets
//     to install the modifier does not leak — it simply never schedules, and
//     every consumer here degrades to a working, timer-free behaviour.
//
//  2. **The safe triangle** (`inSafeTriangle`) — the diagonal-travel fix Ben
//     Kamens described in "Breaking down Amazon's mega dropdown". Kept as
//     PURE GEOMETRY, deliberately: it takes numbers and returns a boolean, so
//     it is unit-testable without a DOM (see menu.test.gts) and reusable by
//     anything else that opens a panel beside a hovered row.
//
// Nothing here reads `Date.now()` or `Math.random()` — those stay forbidden
// for a different reason (indexing determinism), which the timer ruling does
// not touch.
import { modifier } from 'ember-modifier';

// ── Roving focus ─────────────────────────────────────────────────────────

/** Focuses the element only on the render where it BECAME the keyboard
 * target — never steals focus on a plain re-render. */
export const focusWhen = modifier((el: HTMLElement, [should]: [boolean]) => {
  if (should) {
    el.focus();
  }
});

/** Roving tabindex, set as a property rather than an attribute: exactly one
 * member of a composite is in the tab sequence, the rest are -1. Set as a
 * property because the no-positive-tabindex lint rule cannot statically
 * verify a dynamic template attribute. */
export const rovingTabindex = modifier(
  (el: HTMLElement, [active]: [boolean]) => {
    el.tabIndex = active ? 0 : -1;
  },
);

/** One delegated listener on a composite root, removed on cleanup. This is
 * how a `role='tree'` / `role='menu'` container gets its keyboard without
 * `{{on}}` on a non-interactive element (lint: no-invalid-interactive) and
 * without one listener per node. */
export const listen = modifier(
  (el: HTMLElement, [type, handler]: [string, (event: Event) => void]) => {
    el.addEventListener(type, handler);
    return () => el.removeEventListener(type, handler);
  },
);

/** A document-level listener whose lifetime is an element's lifetime. Used
 * for outside-pointer dismissal and for the Alt/Option watch — both of which
 * must hear events that never reach the overlay. Passive by default; pass
 * `capture` for dismissal so a stopPropagation inside the page cannot
 * strand an open overlay. */
export const listenDocument = modifier(
  (
    _el: HTMLElement,
    [type, handler, capture]: [
      string,
      (event: Event) => void,
      boolean | undefined,
    ],
  ) => {
    let options: AddEventListenerOptions = {
      capture: capture ?? false,
      passive: true,
    };
    document.addEventListener(type, handler, options);
    return () => document.removeEventListener(type, handler, options);
  },
);

/**
 * A document-level listener in the CAPTURE phase, non-passive so the handler
 * may `preventDefault`.
 *
 * This is how an open overlay takes ownership of a key before anything else
 * sees it. The boxel-catalog `46f065-popover` fork found the failure it
 * prevents: a host grid that listens for Escape in the capture phase gets the
 * key first and clears its own state, so Escape inside the overlay does two
 * things at once. Capture + `stopPropagation` makes Escape mean exactly one
 * thing — close THIS surface.
 */
export const listenDocumentCapture = modifier(
  (_el: HTMLElement, [type, handler]: [string, (event: Event) => void]) => {
    document.addEventListener(type, handler, true);
    return () => document.removeEventListener(type, handler, true);
  },
);

// ── Owned timers ─────────────────────────────────────────────────────────

/**
 * A set of `setTimeout` handles whose owner is an `ember-modifier`.
 *
 * `after()` is inert until `adopt()` has been called and inert again after
 * `release()`, so a handle can never outlive the element that owns it — the
 * exact property the realm's no-unowned-timers law protects. Install
 * `{{ownsTimers this.timers}}` on the element whose life the timers should
 * share.
 */
export class OwnedTimers {
  private handles = new Set<ReturnType<typeof setTimeout>>();
  private owned = false;

  /** Called by `ownsTimers`. */
  adopt() {
    this.owned = true;
  }

  /** Called by `ownsTimers`' destructor: clears every outstanding handle. */
  release() {
    this.owned = false;
    this.clear();
  }

  /** True once a modifier has taken ownership — consumers branch on this to
   * pick their timer-free degradation. */
  get active(): boolean {
    return this.owned;
  }

  /** Schedules `run` in `ms`. Returns a handle for `cancel`, or undefined
   * when unowned (in which case nothing was scheduled). */
  after(
    ms: number,
    run: () => void,
  ): ReturnType<typeof setTimeout> | undefined {
    if (!this.owned) {
      return undefined;
    }
    let handle = setTimeout(() => {
      this.handles.delete(handle);
      run();
    }, ms);
    this.handles.add(handle);
    return handle;
  }

  cancel(handle: ReturnType<typeof setTimeout> | undefined) {
    if (handle !== undefined) {
      clearTimeout(handle);
      this.handles.delete(handle);
    }
  }

  /** Clears every outstanding handle without giving up ownership. */
  clear() {
    for (let handle of this.handles) {
      clearTimeout(handle);
    }
    this.handles.clear();
  }
}

/** Ties an `OwnedTimers` set to the lifetime of the element it is installed
 * on. This modifier IS the ownership the ruling requires. */
export const ownsTimers = modifier(
  (_el: HTMLElement, [timers]: [OwnedTimers]) => {
    timers.adopt();
    return () => timers.release();
  },
);

// ── Type-ahead ───────────────────────────────────────────────────────────

/**
 * The multi-character type-ahead buffer the APG asks for: letters accumulate,
 * and the buffer resets after `window` ms of no typing.
 *
 * Degradation is the point of the design. With owned timers the buffer is a
 * real multi-character prefix ("pr" jumps to "Preferences"); without them it
 * collapses to single-character cycling — which is what `Tree` shipped when
 * timers were categorically forbidden, and is still a usable behaviour rather
 * than a broken one.
 */
export class TypeaheadBuffer {
  private text = '';
  private handle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private timers: OwnedTimers,
    /** ms of silence after which the buffer resets */
    private window = 700,
  ) {}

  /** Adds a character and returns the prefix to search for. */
  push(character: string): string {
    if (!this.timers.active) {
      this.text = character;
      return this.text;
    }
    this.timers.cancel(this.handle);
    this.text += character;
    this.handle = this.timers.after(this.window, () => {
      this.text = '';
      this.handle = undefined;
    });
    return this.text;
  }

  /** True when the buffer is one character repeated — the APG's signal to
   * CYCLE through matches on that character rather than narrow. */
  get isCycling(): boolean {
    return this.text.length > 1 && new Set(this.text).size === 1;
  }

  get value(): string {
    return this.text;
  }

  reset() {
    this.timers.cancel(this.handle);
    this.handle = undefined;
    this.text = '';
  }
}

/**
 * The index of the next item matching a type-ahead prefix, searching forward
 * from `from` and wrapping. Returns -1 when nothing matches.
 *
 * `cycling` implements the APG rule: when the buffer is one repeated
 * character, match on that single character and step to the NEXT match rather
 * than staying on the current one.
 */
export function typeaheadIndex(
  labels: string[],
  prefix: string,
  from: number,
  cycling = false,
): number {
  let needle = (cycling ? prefix.slice(0, 1) : prefix).toLowerCase();
  if (!needle) {
    return -1;
  }
  // A narrowing (non-cycling) buffer may still match where it already is —
  // "pr" after "p" must not skip past Preferences.
  let start = cycling || prefix.length > 1 ? 0 : 1;
  for (let step = start; step <= labels.length; step++) {
    let index = (from + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(needle)) {
      return index;
    }
  }
  return -1;
}

// ── The safe triangle ────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** The near vertical edge of an open submenu: the base of the safe triangle. */
export interface SafeEdge {
  x: number;
  top: number;
  bottom: number;
}

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The base of the safe triangle for a submenu occupying `rect`, opened on
 * `side` of its parent item. The near edge is the one facing the pointer:
 * a submenu opened to the RIGHT is approached across its LEFT edge.
 *
 * `tolerance` grows the edge vertically so a pointer aiming a few pixels
 * above or below the panel still counts as travelling toward it.
 */
export function safeEdgeFor(
  rect: RectLike,
  side: 'right' | 'left',
  tolerance = 10,
): SafeEdge {
  return {
    x: side === 'right' ? rect.left : rect.right,
    top: rect.top - tolerance,
    bottom: rect.bottom + tolerance,
  };
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Inclusive point-in-triangle by consistent sign of the three edge crosses. */
export function pointInTriangle(
  p: Point,
  a: Point,
  b: Point,
  c: Point,
): boolean {
  let d1 = cross(p.x - a.x, p.y - a.y, b.x - a.x, b.y - a.y);
  let d2 = cross(p.x - b.x, p.y - b.y, c.x - b.x, c.y - b.y);
  let d3 = cross(p.x - c.x, p.y - c.y, a.x - c.x, a.y - c.y);
  let hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  let hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * **The Amazon mega-dropdown rule.** True when the pointer's travel from
 * `from` to `to` is aimed at the open submenu — i.e. `to` lies inside the
 * triangle whose apex is `from` and whose base is the submenu's near `edge`.
 *
 * While this is true, a sibling item the pointer happens to cross must NOT
 * take over the hover: the reader is travelling to the submenu, not choosing
 * the row under the cursor. That diagonal is the single most common menu
 * defect on the web, and the naive `mouseenter`-wins implementation makes the
 * submenu flicker away exactly as it is reached for.
 *
 * A pointer that has not moved (`from` equals `to`) is not travelling
 * anywhere: it returns false, which is what stops a stationary cursor from
 * deferring the sibling forever.
 */
export function inSafeTriangle(
  from: Point,
  to: Point,
  edge: SafeEdge,
): boolean {
  if (from.x === to.x && from.y === to.y) {
    return false;
  }
  // Travelling AWAY from the submenu (past its near edge, on the wrong side)
  // is never a safe-triangle case.
  let towardRight = edge.x >= from.x;
  if (towardRight ? to.x > edge.x : to.x < edge.x) {
    return false;
  }
  return pointInTriangle(
    to,
    from,
    { x: edge.x, y: edge.top },
    { x: edge.x, y: edge.bottom },
  );
}

/**
 * Pointer position tracking for the safe triangle, plus the submenu edge it
 * is measured against. The component holds one of these; `tracksPointer`
 * gives it its listener and its lifetime.
 */
export class PointerTrack {
  private previous: Point | undefined;
  private current: Point | undefined;
  private moves = 0;
  /** The open submenu's near edge, set when the submenu opens/resizes. */
  edge: SafeEdge | undefined;

  /** Increments on every pointer move. A consumer that defers on the strength
   * of `travellingToSubmenu` must record this stamp and refuse to defer twice
   * on the SAME move — otherwise a pointer that stops inside the triangle
   * defers forever, which is both a stuck menu and a timer that re-arms
   * without end (Kamens guards the same case with `lastDelayLoc`). */
  get stamp(): number {
    return this.moves;
  }

  record(x: number, y: number) {
    this.previous = this.current;
    this.current = { x, y };
    this.moves++;
  }

  /** True while the pointer is travelling toward the open submenu. */
  get travellingToSubmenu(): boolean {
    if (!this.edge || !this.previous || !this.current) {
      return false;
    }
    return inSafeTriangle(this.previous, this.current, this.edge);
  }

  clear() {
    this.previous = undefined;
    this.current = undefined;
    this.edge = undefined;
  }
}

/**
 * Owns the `pointermove` listener feeding a `PointerTrack`, and removes it on
 * teardown. `pointermove` rather than `mousemove` so pens and touch report
 * too; passive because the handler only reads coordinates. Listening on
 * `document` (not the panel) keeps the track continuous across the gap
 * between a menu and its submenu.
 */
export const tracksPointer = modifier(
  (_el: HTMLElement, [track]: [PointerTrack]) => {
    let onMove = (event: Event) => {
      let pointer = event as PointerEvent;
      track.record(pointer.clientX, pointer.clientY);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      track.clear();
    };
  },
);
