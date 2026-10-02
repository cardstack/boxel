// Pretui — Handle: a drag grip with a real hit area.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { keyboardNudge } from '../internal/design-tools';
import type { DragModifiers } from '../internal/design-tools';

// ═══════════════════════════════════════════════════════════════════════
// Handle — the drag grip with a real hit area (fig-handle)
// ═══════════════════════════════════════════════════════════════════════

export interface HandleSignature {
  Args: {
    /** position within the parent surface, 0–100 (percentages) */
    x?: number;
    y?: number;
    /** 'point' (default) is the round dot; 'bar' is the vertical stop
     * marker a gradient bar uses; 'square' is a resize grip */
    shape?: 'point' | 'bar' | 'square';
    /** index a parent uses to identify which handle a drag grabbed —
     * surfaces read it off `SurfaceFrame.origin` */
    index?: number;
    /** percent moved by one arrow press before modifiers (default 1) */
    step?: number;
    selected?: boolean;
    disabled?: boolean;
    /** REQUIRED accessible name — "Start point", "Stop 2", "Origin" */
    label?: string;
    /** extra invisible hit area in px on every side (default 6). This is
     * figui3's `hit-area`, simplified to one number. */
    hitArea?: number;
    /** current value announced to a screen reader ("32%, 60%") */
    valueText?: string;
    /** arrow-key movement. dx/dy are in PERCENT of the surface, already
     * multiplied by the modifier keys held. */
    onNudge?: (dx: number, dy: number, keys: DragModifiers) => void;
    /** Enter/Space, and a plain click that did not become a drag */
    onActivate?: () => void;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement;
}

/**
 * A draggable handle on a 2D surface.
 *
 * It is a real `<button>` — focusable, named, and activatable — because
 * that is the only element whose keyboard and accessibility behaviour is
 * already right for a grip. It does NOT own the drag: the surface does
 * (see `dragsSurface`), which is what lets a surface with six stops keep
 * one listener set and lets a handle dragged past the edge keep tracking.
 *
 * ARIA has no two-dimensional slider, so the keyboard contract is arrows
 * (with the same Shift/Alt multipliers as everything else in this module)
 * plus an announced `aria-valuetext`, and every 2D control in this
 * territory ALSO exposes paired `ScrubInput` spinbuttons for the exact
 * numbers. A pointer-only handle would be incomplete; a handle that
 * pretends to be a slider would be a lie.
 *
 * `hitArea` is the fix for the thing that makes most web handles miserable:
 * a 10px dot is a 10px target. The visible dot stays 10px; an invisible
 * inset-negative pseudo-element gives it a ~22px target, and 44px on a
 * coarse pointer.
 */
export class Handle extends Component<HandleSignature> {
  get index(): number {
    return this.args.index ?? 0;
  }
  /** ARIA has no `aria-valuetext` for a button, so the current position is
   * folded into the accessible name: "Stop 2, 40%". */
  get accessibleName(): string {
    let name = this.args.label ?? 'Handle';
    return this.args.valueText ? name + ', ' + this.args.valueText : name;
  }
  get style() {
    // Every number is clamped through Math before it reaches CSS: a caller
    // string can never become a declaration here.
    let x = Math.max(-1000, Math.min(1000, Number(this.args.x ?? 50) || 0));
    let y = Math.max(-1000, Math.min(1000, Number(this.args.y ?? 50) || 0));
    let hit = Math.max(0, Math.min(64, Number(this.args.hitArea ?? 6) || 0));
    return htmlSafe(
      'left:' +
        x +
        '%;top:' +
        y +
        '%;--pretui-handle-hit:' +
        hit +
        'px',
    );
  }
  handleKeyDown = (event: Event) => {
    if (this.args.disabled) {
      return;
    }
    let key = event as KeyboardEvent;
    let keys: DragModifiers = {
      shift: key.shiftKey,
      alt: key.altKey,
      meta: key.metaKey,
    };
    let intent = keyboardNudge(key.key, keys, this.args.step ?? 1);
    if (!intent.handled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Home/End travel to the ends of the horizontal range; ±Infinity is the
    // agreed sentinel so a surface can clamp with its own bounds.
    let dx = intent.toMin ? -Infinity : intent.toMax ? Infinity : intent.dx;
    this.args.onNudge?.(dx, intent.dy, keys);
  };
  handleClick = (event: Event) => {
    // A click that followed a drag has already moved the handle; only a
    // stationary press is an activation.
    void event;
    if (!this.args.disabled) {
      this.args.onActivate?.();
    }
  };
  <template>
    <button
      type='button'
      class='pretui-handle'
      data-shape={{if @shape @shape 'point'}}
      data-handle={{this.index}}
      data-selected={{if @selected 'true'}}
      aria-pressed={{if @selected 'true'}}
      aria-label={{this.accessibleName}}
      aria-disabled={{if @disabled 'true'}}
      style={{this.style}}
      {{on 'keydown' this.handleKeyDown}}
      {{on 'click' this.handleClick}}
      data-test-pretui-handle
      ...attributes
    >{{yield}}</button>
    <style scoped>
      @layer PretComponent {
        .pretui-handle {
          position: absolute;
          translate: -50% -50%;
          display: block;
          width: 11px;
          height: 11px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: var(--card);
          box-shadow: 0 0 0 1.5px var(--primary),
            0 1px 3px var(--shadow-ink-mid, rgb(0 0 0 / 0.22));
          cursor: grab;
          touch-action: none;
          z-index: 2;
        }
        /* The hit area: invisible, centred, and never smaller than the dot. */
        .pretui-handle::before {
          content: '';
          position: absolute;
          inset: calc(-1 * var(--pretui-handle-hit, 6px));
          border-radius: inherit;
        }
        .pretui-handle[data-shape='bar'] {
          width: 10px;
          height: 18px;
          border-radius: var(--radius-sm, 4px);
        }
        .pretui-handle[data-shape='square'] {
          border-radius: 2px;
        }
        .pretui-handle[data-selected='true'] {
          background: var(--primary);
          box-shadow: 0 0 0 1.5px var(--card),
            0 0 0 3px var(--primary);
          z-index: 3;
        }
        .pretui-handle[aria-disabled='true'] {
          cursor: default;
          opacity: 0.5;
        }
        .pretui-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          z-index: 4;
        }
        @media (pointer: coarse) {
          .pretui-handle::before {
            inset: -16px;
          }
        }
      }
    </style>
  </template>
}
