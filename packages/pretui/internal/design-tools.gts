// Pretui — the shared math and gesture modifiers behind the design-tools components.
// Interaction design ported (not vendored) from figui3 v8.1.0 by Rogie King, MIT.
import { modifier } from 'ember-modifier';

// ═══════════════════════════════════════════════════════════════════════
// Pure math — no DOM, no component state. Unit-tested in design-tools.test.gts
// ═══════════════════════════════════════════════════════════════════════

/** The modifier keys a scrub/drag gesture reads. Kept as a plain shape so
 * the math functions can be called from a test with an object literal
 * instead of a synthesized PointerEvent. */
export interface DragModifiers {
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  ctrl?: boolean;
}

/** Coarse multiplier applied when Shift is held. */
export const COARSE = 10;
/** Fine multiplier applied when Alt (or ⌘) is held. */
export const FINE = 0.1;

/**
 * The step multiplier for a set of modifier keys.
 *
 * Shift coarsens by ×10, Alt/⌘ refines by ×0.1, and holding both cancels
 * out to ×1 rather than compounding — a design tool must never surprise the
 * hand that is already holding two keys.
 */
export function scrubMultiplier(keys: DragModifiers): number {
  let coarse = keys.shift ? COARSE : 1;
  let fine = keys.alt || keys.meta ? FINE : 1;
  return coarse * fine;
}

/**
 * The value delta for a horizontal pointer delta.
 *
 * @param dx           pointer movement in CSS pixels (signed, rightward +)
 * @param step         the control's step — one step per `pixelsPerStep` px
 * @param keys         modifier keys held during the move
 * @param pixelsPerStep how many pixels of travel buy one step (default 1,
 *                     which is figui3's rate; raise it for a slower scrub)
 */
export function scrubDelta(
  dx: number,
  step: number,
  keys: DragModifiers = {},
  pixelsPerStep = 1,
): number {
  let rate = pixelsPerStep > 0 ? pixelsPerStep : 1;
  return (dx / rate) * step * scrubMultiplier(keys);
}

/**
 * What a keyboard press means to a draggable thing.
 *
 * `dx`/`dy` are SCREEN-space (right is +x, **down** is +y) — the frame a 2D
 * surface, a reorder list or a grid tile thinks in. `delta` is VALUE-space
 * (Right *and* Up both increase) — the frame a spinbutton or a slider
 * thinks in. Keeping both on one intent is what stops the two conventions
 * being re-derived, and re-derived differently, per control.
 */
export interface NudgeIntent {
  /** false when the key was not one of ours — do not preventDefault */
  handled: boolean;
  dx: number;
  dy: number;
  delta: number;
  /** Home: jump to the low end of the range */
  toMin: boolean;
  /** End: jump to the high end of the range */
  toMax: boolean;
}

const NO_NUDGE: NudgeIntent = {
  handled: false,
  dx: 0,
  dy: 0,
  delta: 0,
  toMin: false,
  toMax: false,
};

/**
 * **The keyboard half of every drag in the kit.** Any control that moves
 * something with a pointer must accept the same key set, and this is the
 * single place that decides what those keys mean:
 *
 * | key                  | meaning                                    |
 * |----------------------|--------------------------------------------|
 * | ← → ↑ ↓              | one `step`, scaled by the modifier keys    |
 * | Shift + arrow        | ×10 (coarse)                               |
 * | Alt/⌘ + arrow        | ×0.1 (fine)                                |
 * | PageUp / PageDown    | ×10, regardless of modifiers               |
 * | Home / End           | jump to the range ends                     |
 *
 * Consume it from a `keydown` handler and `preventDefault()` when
 * `handled` is true. Exported for any other component adding a drag —
 * a reorder list, a resizable grid tile, a timeline scrubber — so the
 * keyboard contract is shared rather than reinvented.
 */
export function keyboardNudge(
  key: string,
  keys: DragModifiers = {},
  step = 1,
): NudgeIntent {
  let unit = step * scrubMultiplier(keys);
  let coarse = step * COARSE;
  switch (key) {
    case 'ArrowLeft':
      return { handled: true, dx: -unit, dy: 0, delta: -unit, toMin: false, toMax: false };
    case 'ArrowRight':
      return { handled: true, dx: unit, dy: 0, delta: unit, toMin: false, toMax: false };
    case 'ArrowUp':
      return { handled: true, dx: 0, dy: -unit, delta: unit, toMin: false, toMax: false };
    case 'ArrowDown':
      return { handled: true, dx: 0, dy: unit, delta: -unit, toMin: false, toMax: false };
    case 'PageUp':
      return { handled: true, dx: 0, dy: -coarse, delta: coarse, toMin: false, toMax: false };
    case 'PageDown':
      return { handled: true, dx: 0, dy: coarse, delta: -coarse, toMin: false, toMax: false };
    case 'Home':
      return { handled: true, dx: 0, dy: 0, delta: 0, toMin: true, toMax: false };
    case 'End':
      return { handled: true, dx: 0, dy: 0, delta: 0, toMin: false, toMax: true };
    default:
      return NO_NUDGE;
  }
}

/** Clamps to an optional range. `undefined` bounds are open. */
export function clampRange(
  value: number,
  min?: number,
  max?: number,
): number {
  let next = value;
  if (min !== undefined && Number.isFinite(min)) {
    next = Math.max(min, next);
  }
  if (max !== undefined && Number.isFinite(max)) {
    next = Math.min(max, next);
  }
  return next;
}

/** Moves a number's decimal point by `places`, via its exponent rather than
 * a multiply. `1.005 * 100` is `100.49999999999999`; `1.005e2` is `100.5`. */
function shiftPoint(value: number, places: number): number {
  let parts = String(value).split('e');
  let exponent = parts[1] ? Number(parts[1]) + places : places;
  return Number(parts[0] + 'e' + exponent);
}

/**
 * Rounds to `precision` decimal places, returning a NUMBER.
 *
 * Shifts the decimal exponent instead of multiplying by 10ⁿ. The multiply
 * form — which is what figui3's `#formatNumber` does — silently rounds
 * `1.005` at 2dp DOWN to `1`, because `1.005 * 100` is
 * `100.49999999999999` in binary floating point. On a control whose whole
 * job is exact numbers that is not an acceptable rounding error.
 */
export function roundTo(value: number, precision = 2): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  let places = Math.max(0, Math.min(20, Math.trunc(precision)));
  return shiftPoint(Math.round(shiftPoint(value, places)), -places);
}

/** Snaps to the nearest multiple of `step`, offset by `origin`. */
export function quantize(value: number, step: number, origin = 0): number {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return origin + Math.round((value - origin) / step) * step;
}

/**
 * The nearest member of `points` within `tolerance`, or `value` unchanged.
 * This is the origin-grid / gradient-stop snap: discrete anchors that pull
 * only when the pointer is already close, so free positioning still works.
 */
export function snapToPoints(
  value: number,
  points: readonly number[],
  tolerance: number,
): number {
  let best = value;
  let bestGap = tolerance;
  for (let point of points) {
    let gap = Math.abs(point - value);
    if (gap <= bestGap) {
      best = point;
      bestGap = gap;
    }
  }
  return best;
}

// ── Stepped scales ─────────────────────────────────────────────────────
// A property is often numeric WITHOUT being continuous. Photographic
// apertures run 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22 — an ordered list
// with non-uniform gaps, where the legal values are the whole domain and
// "f/5.6" is the value's name. `quantize` cannot express that (its grid is
// uniform) and `snapToPoints` only pulls when you are already close. A
// scale is therefore addressed by INDEX: a gesture moves n stops, and the
// value is whatever sits there.

/** One legal value on a stepped scale, with the name it goes by. */
export interface ScaleStop {
  value: number;
  /** what the user reads: 'f/5.6', 'ISO 400', '2×'. Falls back to the
   * formatted number. */
  label?: string;
}

/** A scale as a caller writes it: bare numbers when the number is its own
 * name, `{ value, label }` when it is not. Mixing the two is legal. */
export type ScaleStops = readonly (number | ScaleStop)[];

/**
 * Sorts a scale ascending, drops non-finite entries, and collapses exact
 * duplicates (first label wins).
 *
 * Sorting is not fussiness: every index operation below assumes monotonic
 * order, so a caller who lists apertures widest-first — which is how a lens
 * barrel is printed — would otherwise get an inverted scrub direction.
 */
export function normalizeStops(stops: ScaleStops | undefined): ScaleStop[] {
  if (!stops || stops.length === 0) {
    return [];
  }
  let mapped: ScaleStop[] = [];
  for (let stop of stops) {
    let entry: ScaleStop =
      typeof stop === 'number' ? { value: stop } : { ...stop };
    if (Number.isFinite(entry.value)) {
      mapped.push(entry);
    }
  }
  mapped.sort((a, b) => a.value - b.value);
  let out: ScaleStop[] = [];
  for (let entry of mapped) {
    let previous = out.length > 0 ? out[out.length - 1] : undefined;
    if (previous && previous.value === entry.value) {
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * The index of the stop nearest `value`, or −1 when there is nothing to
 * choose from (an empty scale, or a null/mixed value).
 *
 * Ties go to the LOWER stop, deliberately: typing "3" into an aperture
 * lands on f/2.8 rather than f/4, and opening up is the safer default when
 * a photographer is guessing.
 */
export function stopIndexFor(
  value: number | null | undefined,
  stops: readonly ScaleStop[],
): number {
  if (stops.length === 0 || value === null || value === undefined) {
    return -1;
  }
  if (!Number.isFinite(value)) {
    return -1;
  }
  let best = 0;
  let bestGap = Infinity;
  for (let index = 0; index < stops.length; index++) {
    let gap = Math.abs(stops[index].value - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
}

/** The stop at `index`, clamped into the scale. Clamping rather than
 * wrapping is what makes a long drag rest against the end of the barrel
 * instead of teleporting from f/22 back to f/0.95. */
export function stopAt(
  index: number,
  stops: readonly ScaleStop[],
): ScaleStop | undefined {
  if (stops.length === 0) {
    return undefined;
  }
  let clamped = Math.max(0, Math.min(stops.length - 1, Math.round(index)));
  return stops[clamped];
}

/**
 * How many stops a value-space `delta` should travel.
 *
 * A discrete scale has no half-stop, so a FINE modifier cannot subdivide
 * one — it slows the hand instead, and the guaranteed minimum of one stop
 * is what stops Alt+Arrow being a dead key. Coarse still multiplies, so
 * Shift+Arrow crosses ten stops exactly as it crosses ten pixels.
 */
export function stopStride(delta: number): number {
  if (!Number.isFinite(delta) || delta === 0) {
    return 0;
  }
  let magnitude = Math.max(1, Math.round(Math.abs(delta)));
  return delta < 0 ? -magnitude : magnitude;
}

/** The text a stop goes by — its label, or the formatted number. */
export function stopText(
  stop: ScaleStop | undefined,
  precision = 2,
  unit = '',
  unitPosition: 'prefix' | 'suffix' = 'suffix',
): string {
  if (!stop) {
    return '';
  }
  return (
    stop.label ?? formatMeasure(stop.value, precision, unit, unitPosition)
  );
}

// ── Token lists ────────────────────────────────────────────────────────
// The other shape a property takes: not one value but an open-ended SET of
// short ones — mood keywords, materials, props, powers. The list is not
// drawn from a fixed vocabulary, so it is not a multi-select; it is free
// text that accumulates. The arithmetic lives here so "what happens when
// you add a duplicate" is a unit test rather than a claim about a DOM.

/** The outcome of a list edit: the new list, and the sentence a screen
 * reader should hear. A rejected edit returns the list unchanged AND a
 * reason — silence is what makes a rejected add feel like a broken key. */
export interface TokenEdit {
  list: string[];
  status: string;
}

/**
 * Appends `raw` to `list`, trimmed, subject to a duplicate rule and a cap.
 *
 * Duplicates are compared case-insensitively and REJECTED by default,
 * because every one of these lists is a set in disguise — "Velvet" twice
 * is a typo, not an intention.
 */
export function addToken(
  list: readonly string[],
  raw: string,
  options: { allowDuplicates?: boolean; max?: number } = {},
): TokenEdit {
  let text = (raw ?? '').trim();
  let next = [...list];
  if (!text) {
    return { list: next, status: '' };
  }
  let max = options.max;
  if (max !== undefined && Number.isFinite(max) && max > 0 && list.length >= max) {
    return { list: next, status: 'List is full at ' + max + ' items' };
  }
  if (!options.allowDuplicates) {
    let lower = text.toLowerCase();
    if (list.some((item) => item.toLowerCase() === lower)) {
      return { list: next, status: text + ' is already in the list' };
    }
  }
  next.push(text);
  return { list: next, status: 'Added ' + text + ', ' + next.length + ' items' };
}

/** Removes the member at `index`. An out-of-range index is a no-op with an
 * empty status, never a hole in the array. */
export function removeTokenAt(
  list: readonly string[],
  index: number,
): TokenEdit {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return { list: [...list], status: '' };
  }
  let removed = list[index];
  let next = list.filter((_item, position) => position !== index);
  return { list: next, status: 'Removed ' + removed + ', ' + next.length + ' items' };
}

/** Splits pasted text on commas / newlines so a list pasted from a
 * spreadsheet arrives as members rather than as one long member. */
export function splitTokens(raw: string, separators?: readonly string[]): string[] {
  return (raw ?? '')
    .split(tokenBreaks(separators))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const REGEX_SPECIAL = new RegExp('[.*+?^$' + '{}()|[\\]\\\\]', 'g');

/** The characters that end a token: the separators (default a comma), plus
 * a newline or tab, so a list pasted from a spreadsheet splits too. */
export function tokenBreaks(separators?: readonly string[]): RegExp {
  let chars = (separators ?? [',']).filter((c) => c.length > 0).map((c) => c.replace(REGEX_SPECIAL, '\\$&'));
  return new RegExp('(?:' + [...chars, '\\n', '\\r', '\\t'].join('|') + ')+');
}

/** Normalizes degrees into [0, 360). */
export function wrapDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The SHORTEST signed rotation from `from` to `to`, in (-180, 180].
 *
 * This is what makes an angle dial wind past 360° instead of snapping
 * backwards: the accumulated value is the running sum of shortest deltas,
 * so dragging clockwise through 359°→1° adds +2, not −358.
 */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = wrapDegrees(to) - wrapDegrees(from);
  if (delta > 180) {
    delta -= 360;
  }
  if (delta <= -180) {
    delta += 360;
  }
  return delta;
}

/** Degrees of the vector from a centre to a point; 0° points right, and
 * angles increase clockwise (screen coordinates, y down). */
export function pointerDegrees(
  centreX: number,
  centreY: number,
  x: number,
  y: number,
): number {
  return wrapDegrees((Math.atan2(y - centreY, x - centreX) * 180) / Math.PI);
}

/** Cubic-Bézier ordinate for the canonical (0,0)→(1,1) easing curve, at
 * curve parameter `t` (NOT at x = t). Used to draw the curve. */
export function bezierAt(t: number, a: number, b: number): number {
  let u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

/**
 * The eased output `y` for an input progress `x` of a `cubic-bezier(x1, y1,
 * x2, y2)`. Solves x(t) = x for t by bisection — 24 halvings puts the error
 * under 1e-7, which is finer than a pixel on any curve editor, and unlike
 * Newton–Raphson it cannot diverge on the pathological control points a
 * user is free to drag to.
 */
export function bezierEase(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  let target = Math.min(1, Math.max(0, x));
  let low = 0;
  let high = 1;
  let t = target;
  for (let i = 0; i < 24; i++) {
    let guess = bezierAt(t, x1, x2);
    if (guess < target) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }
  return bezierAt(t, y1, y2);
}

/** Formats a numeric value for display: rounded, with an optional unit on
 * the requested side. Returns '' for a null/blank value. */
export function formatMeasure(
  value: number | null | undefined,
  precision = 2,
  unit = '',
  unitPosition: 'prefix' | 'suffix' = 'suffix',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  let text = String(roundTo(value, precision));
  if (!unit) {
    return text;
  }
  return unitPosition === 'prefix' ? unit + text : text + unit;
}

/**
 * Parses a measure the user typed. Tolerates a leading/trailing unit, a
 * leading `+`, thin/regular spaces, and a stray second decimal point (which
 * is what a fast typist actually produces). Returns null when nothing
 * numeric is present, so an emptied field can round-trip as "no value".
 */
export function parseMeasure(text: string): number | null {
  // Exponent letters are deliberately NOT in the keep-set: nobody types
  // `1e3` into an inspector, but everybody types `12.5deg` — and keeping
  // `e` turns that into `12.5e`, which is NaN. (figui3 keeps `e` and has
  // exactly this bug on `deg`, `rem` and `em`.)
  let cleaned = (text ?? '').replace(/[^\d.+-]/g, '');
  // Keep only the first decimal point: "1.2.3" reads as 1.23, never NaN.
  let dot = cleaned.indexOf('.');
  if (dot !== -1) {
    cleaned =
      cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  }
  // A single leading sign and one run of digits — a trailing sign or a
  // second number is dropped rather than poisoning the whole parse.
  let match = cleaned.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) {
    return null;
  }
  let value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

// ═══════════════════════════════════════════════════════════════════════
// Gestures — ember-modifiers that own their listeners and their capture
// ═══════════════════════════════════════════════════════════════════════

/** One frame of a horizontal scrub. */
export interface ScrubFrame {
  /** total signed travel in px since pointerdown */
  dx: number;
  /** signed travel in px since the previous frame */
  stepX: number;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
  /** `end` commits; `cancel` (Escape, `pointercancel`) puts the value back */
  phase: 'start' | 'move' | 'end' | 'cancel';
}

/**
 * Horizontal scrub-to-change, with pointer capture.
 *
 * `pointerdown` is bound inside the modifier rather than with `{{on}}` in a
 * template: the realm's remote lint forbids template `pointerdown` bindings,
 * and a captured gesture needs its `pointerup`/`pointercancel` teardown to
 * be owned by the same lifetime anyway.
 *
 * The gesture is cancelled — not committed — on Escape, which is the one
 * affordance every direct-manipulation tool needs and figui3 lacks.
 *
 * @param onFrame  called with every phase; the component decides what a
 *                 frame means. MUST be a stable reference (an arrow class
 *                 property), or the modifier re-installs every render.
 * @param disabled when true the gesture never starts.
 */
export const scrubs = modifier(
  (
    el: HTMLElement,
    [onFrame, disabled]: [
      (frame: ScrubFrame) => void,
      boolean | undefined,
    ],
  ) => {
    let pointerId: number | undefined;
    let originX = 0;
    let lastX = 0;
    let previousCursor = '';

    let release = (phase: 'end' | 'cancel' | undefined) => {
      if (pointerId === undefined) {
        return;
      }
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
      pointerId = undefined;
      document.body.style.cursor = previousCursor;
      el.removeAttribute('data-scrubbing');
      if (phase) {
        onFrame({
          dx: lastX - originX,
          stepX: 0,
          shift: false,
          alt: false,
          meta: false,
          ctrl: false,
          phase,
        });
      }
    };

    let down = (event: Event) => {
      let pointer = event as PointerEvent;
      if (disabled || pointer.button !== 0 || pointerId !== undefined) {
        return;
      }
      pointer.preventDefault();
      pointerId = pointer.pointerId;
      originX = pointer.clientX;
      lastX = pointer.clientX;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // a pointer released before this handler ran has no capture to take
      }
      previousCursor = document.body.style.cursor;
      document.body.style.cursor = 'ew-resize';
      el.setAttribute('data-scrubbing', 'true');
      onFrame({
        dx: 0,
        stepX: 0,
        shift: pointer.shiftKey,
        alt: pointer.altKey,
        meta: pointer.metaKey,
        ctrl: pointer.ctrlKey,
        phase: 'start',
      });
    };

    let move = (event: Event) => {
      let pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      let stepX = pointer.clientX - lastX;
      lastX = pointer.clientX;
      onFrame({
        dx: lastX - originX,
        stepX,
        shift: pointer.shiftKey,
        alt: pointer.altKey,
        meta: pointer.metaKey,
        ctrl: pointer.ctrlKey,
        phase: 'move',
      });
    };

    let up = (event: Event) => {
      let pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      release(event.type === 'pointercancel' ? 'cancel' : 'end');
    };

    // window capture runs before any overlay's document listener, so the
    // Escape that cancels a scrub doesn't also close the dialog around it
    let key = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape' && pointerId !== undefined) {
        event.preventDefault();
        event.stopImmediatePropagation();
        release('cancel');
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);

    return () => {
      release(undefined);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
    };
  },
);

/** One frame of a drag inside a 2D surface. */
export interface SurfaceFrame {
  /** pointer position normalized to the surface box, clamped to 0…1 */
  nx: number;
  ny: number;
  /** unclamped normalized position — a gradient stop dragged off the end
   * still needs to know how far off it went */
  rawX: number;
  rawY: number;
  width: number;
  height: number;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** the element the gesture STARTED on, held stable for the whole drag so
   * a multi-handle surface knows which handle it grabbed */
  origin: Element | null;
  phase: 'start' | 'move' | 'end';
}

/**
 * Drag (and click-to-jump) inside a 2D surface, with pointer capture.
 *
 * Installed on the SURFACE, not on the handles: one listener set for any
 * number of handles, click-anywhere-to-jump falls out for free, and a
 * handle dragged past the edge keeps tracking instead of losing the pointer.
 * The handle under the initial press arrives as `origin`.
 */
export const dragsSurface = modifier(
  (
    el: HTMLElement,
    [onFrame, disabled]: [
      (frame: SurfaceFrame) => void,
      boolean | undefined,
    ],
  ) => {
    let pointerId: number | undefined;
    let origin: Element | null = null;

    let frameFor = (
      pointer: PointerEvent,
      phase: SurfaceFrame['phase'],
    ): SurfaceFrame => {
      let rect = el.getBoundingClientRect();
      let width = Math.max(rect.width, 1);
      let height = Math.max(rect.height, 1);
      let rawX = (pointer.clientX - rect.left) / width;
      let rawY = (pointer.clientY - rect.top) / height;
      return {
        nx: Math.min(1, Math.max(0, rawX)),
        ny: Math.min(1, Math.max(0, rawY)),
        rawX,
        rawY,
        width,
        height,
        shift: pointer.shiftKey,
        alt: pointer.altKey,
        meta: pointer.metaKey,
        origin,
        phase,
      };
    };

    let release = (pointer: PointerEvent | undefined) => {
      if (pointerId === undefined) {
        return;
      }
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
      pointerId = undefined;
      el.removeAttribute('data-dragging');
      if (pointer) {
        onFrame(frameFor(pointer, 'end'));
      }
      origin = null;
    };

    let down = (event: Event) => {
      let pointer = event as PointerEvent;
      if (disabled || pointer.button !== 0 || pointerId !== undefined) {
        return;
      }
      pointer.preventDefault();
      pointerId = pointer.pointerId;
      origin = pointer.target instanceof Element ? pointer.target : null;
      el.setPointerCapture(pointerId);
      el.setAttribute('data-dragging', 'true');
      onFrame(frameFor(pointer, 'start'));
    };

    let move = (event: Event) => {
      let pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      onFrame(frameFor(pointer, 'move'));
    };

    let up = (event: Event) => {
      let pointer = event as PointerEvent;
      if (pointerId === undefined || pointer.pointerId !== pointerId) {
        return;
      }
      release(pointer);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    return () => {
      release(undefined);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  },
);
