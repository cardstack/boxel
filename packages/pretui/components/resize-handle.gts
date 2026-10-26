// Pretui — ResizeHandle: a focusable separator that drags a neighbouring pane's width or height, in px.
//
// ── Realm laws in force ─────────────────────────────────────────────────
// No timers, no `Date.now()`, no `Math.random()`. Every listener is owned by
// an `ember-modifier` that removes it. No `!important`, no `:deep()`, no
// `:global()`, no dark branches.
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

// ── ResizeHandle ─────────────────────────────────────────────────────────
//
// SplitPanes already resizes, but it shares out a whole group in percent
// through boxel-ui's engine, so it can't size one pane in absolute units
// beside content that keeps its own layout (a rail beside a grid, an
// inspector beside a canvas). This is that piece on its own: the caller owns
// the pane and its size, and the handle turns a drag or a key press into
// the next size.
//
// The handle is controlled. `@size` is the pane's size in px and
// `@onSizeChange` reports the next one; nothing moves until the caller
// writes it back. An unset `@size` reads as `@defaultSize`, so a caller can
// leave its CSS default in charge until the first resize.

/** Placement of the handle on its pane. `start`/`end` are logical, so in a
 * right-to-left context `end` is the left edge. `left`/`right` are physical
 * and ignore the writing direction. `top`/`bottom` name the block axis,
 * which the writing direction doesn't flip. */
export type ResizeHandlePlacement = 'start' | 'end';
export type ResizeHandlePlacementAlias =
  | ResizeHandlePlacement
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

const PLACEMENTS: Record<string, ResizeHandlePlacement> = {
  start: 'start',
  left: 'start',
  top: 'start',
  end: 'end',
  right: 'end',
  bottom: 'end',
};

/** A px number, or a `px` / `rem` length string. */
export type ResizeHandleLength = number | string;

const LENGTH = /^\s*(\d*\.?\d+)\s*(px|rem)?\s*$/;

/** Resolves a px number or a `px` / `rem` string to px. Anything else is
 * undefined, so a bad bound reads as "no bound" rather than as zero. */
export function resolveLength(
  raw: ResizeHandleLength | undefined,
): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  let match = raw === undefined ? null : LENGTH.exec(raw);
  if (!match) {
    return undefined;
  }
  let value = parseFloat(match[1]!);
  if (match[2] !== 'rem') {
    return value;
  }
  let root =
    typeof document === 'undefined'
      ? NaN
      : parseFloat(getComputedStyle(document.documentElement).fontSize);
  return value * (Number.isFinite(root) ? root : 16);
}

export interface ResizeHandleSignature {
  Args: {
    /** The pane's current size in px. Unset reads as `@defaultSize`. */
    size?: number;
    /** Reports the next size in px, already clamped and rounded. */
    onSizeChange: (size: number) => void;
    /** Smallest size. Default `0`. */
    min?: ResizeHandleLength;
    /** Largest size. Default unbounded. */
    max?: ResizeHandleLength;
    /** The size a double-click restores. With none, double-click does
     * nothing. */
    defaultSize?: ResizeHandleLength;
    /** The separator's own orientation. `vertical` (default) is a line
     * between side-by-side panes and resizes the pane's width; `horizontal`
     * resizes its height. */
    orientation?: 'vertical' | 'horizontal';
    /** Which edge of the pane the handle sits on. `end` (default) means
     * dragging toward the end grows the pane. */
    placement?: ResizeHandlePlacementAlias;
    /** px per arrow key press. Shift moves four steps. Default `16`. */
    step?: number;
    /** Accessible name. Default `'Resize'`. Name the pane: "Resize
     * sidebar". */
    label?: string;
    /** The id of the pane this handle resizes, for `aria-controls`. */
    controls?: string;
  };
  Element: HTMLDivElement;
}

export class ResizeHandle extends Component<ResizeHandleSignature> {
  @tracked private dragging = false;

  get orientation(): 'vertical' | 'horizontal' {
    return this.args.orientation === 'horizontal' ? 'horizontal' : 'vertical';
  }
  get placement(): ResizeHandlePlacement {
    let raw = this.args.placement;
    return (raw === undefined ? undefined : PLACEMENTS[raw]) ?? 'end';
  }
  // Cached: a rem bound reads the root font size, and a drag reads the
  // bounds on every pointer move.
  @cached
  get min(): number {
    return resolveLength(this.args.min) ?? 0;
  }
  @cached
  get max(): number | undefined {
    let max = resolveLength(this.args.max);
    return max === undefined ? undefined : Math.max(max, this.min);
  }
  @cached
  get defaultSize(): number | undefined {
    let size = resolveLength(this.args.defaultSize);
    return size === undefined ? undefined : this.clamp(size);
  }
  get size(): number {
    return this.clamp(this.args.size ?? this.defaultSize ?? this.min);
  }
  get valueMin(): number {
    return Math.round(this.min);
  }
  get valueNow(): number {
    return Math.round(this.size);
  }
  get valueMax(): number | undefined {
    return this.max === undefined ? undefined : Math.round(this.max);
  }
  get label(): string {
    return this.args.label ?? 'Resize';
  }

  private clamp(size: number): number {
    let max = this.max ?? Infinity;
    return Math.min(max, Math.max(this.min, size));
  }

  private report(next: number) {
    let size = Math.round(this.clamp(next));
    if (size !== this.valueNow) {
      this.args.onSizeChange(size);
    }
  }

  // +1 when a move toward larger screen coordinates (right, down) grows the
  // pane. Read at the start of each gesture so a `dir` change is honoured.
  private growthSign(el: HTMLElement): 1 | -1 {
    let towardEnd = this.placement === 'end';
    let physical =
      this.args.placement === 'left' || this.args.placement === 'right';
    if (
      this.orientation === 'vertical' &&
      !physical &&
      getComputedStyle(el).direction === 'rtl'
    ) {
      towardEnd = !towardEnd;
    }
    return towardEnd ? 1 : -1;
  }

  // Screen px per layout px along the drag axis, so the edge keeps up with
  // the pointer when an ancestor is scaled (a zoomed canvas, a scaled
  // preview). The layout size comes from computed style rather than
  // offsetWidth, which rounds to whole px and would skew the scale for a
  // fractional strip. An element that isn't laid out reads as unscaled.
  private screenScale(el: HTMLElement): number {
    let rect = el.getBoundingClientRect();
    let style = getComputedStyle(el);
    let px = (value: string) => parseFloat(value) || 0;
    let [screen, size, edges] =
      this.orientation === 'vertical'
        ? [
            rect.width,
            style.width,
            [
              style.paddingLeft,
              style.paddingRight,
              style.borderLeftWidth,
              style.borderRightWidth,
            ],
          ]
        : [
            rect.height,
            style.height,
            [
              style.paddingTop,
              style.paddingBottom,
              style.borderTopWidth,
              style.borderBottomWidth,
            ],
          ];
    let layout =
      px(size) +
      (style.boxSizing === 'border-box'
        ? 0
        : edges.reduce((sum, edge) => sum + px(edge), 0));
    return screen > 0 && layout > 0 ? screen / layout : 1;
  }

  // Pointer capture keeps every event of the gesture on the handle, so it
  // needs no document listeners and survives the pointer leaving the strip.
  // Each move applies the total travel from the origin, never a per-frame
  // delta, so rounding can't drift over a long drag. One pointer owns the
  // gesture: a second finger neither restarts nor steers it.
  dragResize = modifier((handle: HTMLElement) => {
    // `factor` turns screen travel into a size change: the growth direction
    // over the screen scale.
    let origin:
      | { pointerId: number; coord: number; size: number; factor: number }
      | undefined;
    let coordOf = (e: PointerEvent) =>
      this.orientation === 'vertical' ? e.clientX : e.clientY;
    let down = (e: PointerEvent) => {
      if (e.button !== 0 || origin) {
        return;
      }
      // Stops the drag selecting the page's text; focus is moved by hand
      // since the default action that would have moved it is cancelled.
      e.preventDefault();
      handle.focus({ preventScroll: true });
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Only synthetic events reach this: a real pointer is always active
        // during its own pointerdown. A synthetic pointerId has no active
        // pointer, so capture throws, and the gesture stays armed for the
        // pointermove/pointerup the same caller dispatches on this element.
      }
      origin = {
        pointerId: e.pointerId,
        coord: coordOf(e),
        size: this.size,
        factor: this.growthSign(handle) / this.screenScale(handle),
      };
      this.dragging = true;
    };
    let move = (e: PointerEvent) => {
      if (origin?.pointerId === e.pointerId) {
        this.report(origin.size + (coordOf(e) - origin.coord) * origin.factor);
      }
    };
    // Also runs on lostpointercapture, so a gesture whose pointerup never
    // reaches the handle (it went inert, or capture was taken away) still
    // ends instead of resizing on later hovers.
    let up = (e: PointerEvent) => {
      if (origin?.pointerId === e.pointerId) {
        origin = undefined;
        this.dragging = false;
      }
    };
    let reset = () => {
      if (this.defaultSize !== undefined) {
        this.report(this.defaultSize);
      }
    };
    let key = (e: KeyboardEvent) => {
      // Alt/Ctrl/Meta chords are the browser's and the platform's (Alt+Left
      // is Back).
      if (e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }
      let step = (this.args.step ?? 16) * (e.shiftKey ? 4 : 1);
      let [less, more] =
        this.orientation === 'vertical'
          ? ['ArrowLeft', 'ArrowRight']
          : ['ArrowUp', 'ArrowDown'];
      let next: number | undefined;
      if (e.key === less || e.key === more) {
        let travel = e.key === more ? step : -step;
        next = this.size + travel * this.growthSign(handle);
      } else if (e.key === 'Home') {
        next = this.min;
      } else if (e.key === 'End' && this.max !== undefined) {
        next = this.max;
      }
      if (next !== undefined) {
        e.preventDefault();
        this.report(next);
      }
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    handle.addEventListener('lostpointercapture', up);
    handle.addEventListener('dblclick', reset);
    handle.addEventListener('keydown', key);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.removeEventListener('lostpointercapture', up);
      handle.removeEventListener('dblclick', reset);
      handle.removeEventListener('keydown', key);
    };
  });

  <template>
    {{! A focusable separator is an interactive widget (WAI-ARIA window
        splitter), so it takes a tab stop and reports its position. The
        listeners live in the modifier: no-invalid-interactive rejects a
        template listener on a role it does not know is interactive. }}
    <div
      class='pretui-resize-handle'
      role='separator'
      tabindex='0'
      aria-orientation={{this.orientation}}
      aria-label={{this.label}}
      aria-controls={{@controls}}
      aria-valuemin={{this.valueMin}}
      aria-valuemax={{this.valueMax}}
      aria-valuenow={{this.valueNow}}
      data-orientation={{this.orientation}}
      data-placement={{this.placement}}
      data-dragging={{if this.dragging 'true'}}
      data-test-pretui-resize-handle
      {{this.dragResize}}
      ...attributes
    ><span class='pretui-resize-handle-line' aria-hidden='true'></span></div>
    <style scoped>
      @layer PretComponent {
        /* A hit strip wider than the painted line, which only shows while
           the handle is pointed at, dragged or focused. The caller places
           the strip on the pane's edge. */
        .pretui-resize-handle {
          --pretui-resize-handle-size: 0.5rem;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .pretui-resize-handle[data-orientation='vertical'] {
          inline-size: var(--pretui-resize-handle-size);
          block-size: 100%;
          cursor: col-resize;
        }
        .pretui-resize-handle[data-orientation='horizontal'] {
          inline-size: 100%;
          block-size: var(--pretui-resize-handle-size);
          cursor: row-resize;
        }
        .pretui-resize-handle-line {
          border-radius: 2px;
          background: transparent;
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        [data-orientation='vertical'] > .pretui-resize-handle-line {
          inline-size: 2px;
          block-size: 100%;
        }
        [data-orientation='horizontal'] > .pretui-resize-handle-line {
          inline-size: 100%;
          block-size: 2px;
        }
        .pretui-resize-handle:hover > .pretui-resize-handle-line,
        .pretui-resize-handle[data-dragging='true']
          > .pretui-resize-handle-line {
          background: var(--primary);
        }
        .pretui-resize-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          border-radius: var(--radius-chip, 6px);
        }
        /* Coarse pointers get a target a finger can find. */
        @media (any-pointer: coarse) {
          .pretui-resize-handle {
            --pretui-resize-handle-size: 1rem;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-resize-handle-line {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
