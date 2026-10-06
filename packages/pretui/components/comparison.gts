// Pretui — Comparison: a before/after slider over two layers.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { clamp01to100, styleVar } from '../internal/structure-scenes';

// ── Comparison — TRANSCRIBED from wa-comparison + ImageComparison ────────
// Before/after split with a draggable seam. Layer mechanics follow both
// originals: the after layer sits absolutely over the before layer and is
// clipped to the left --split% via clip-path inset — before content sizes
// the host and shows right of the seam. Interaction follows
// wa-comparison: the seam handle is the focusable control (arrows move
// ±1, shift+arrows ±10, Home/End jump; value clamped 0–100), but with
// role='slider' semantics (wa ships role='scrollbar'; slider is the
// truthful role for a 0–100 value control). Dragging uses the
// pointer-capture modifier pattern from freestyle.gts Viewport — every
// pointer event stays on the handle, no document listeners. Skipped from
// the originals: motion-primitives' spring smoothing and hover-follow
// mode (the seam tracks the pointer directly — no animation, so there is
// no motion for reduced-motion to remove), wa's RTL mirroring, and the
// bubbling change Event (a typed @onValueChange callback instead).
// Controlled like the kit Slider: pass @value to own it, omit it for
// internal state; @onValueChange reports either way.

export interface ComparisonSignature {
  Args: {
    /** seam position 0–100 (percent from the left); omit for uncontrolled */
    value?: number;
    onValueChange?: (value: number) => void;
    /** accessible name for the seam slider — default 'Comparison position' */
    label?: string;
  };
  Blocks: {
    /** full-bleed "before" layer — sizes the host, shows right of seam */
    before: [];
    /** full-bleed "after" layer — clipped to the left of the seam */
    after: [];
  };
  Element: HTMLDivElement;
}

export class Comparison extends Component<ComparisonSignature> {
  @tracked internal = 50;
  @tracked dragging = false;
  get value(): number {
    return clamp01to100(this.args.value ?? this.internal);
  }
  get roundedValue(): number {
    return Math.round(this.value);
  }
  get splitStyle(): string {
    return styleVar('--split', `${this.value}%`);
  }
  setValue = (next: number) => {
    let v = Math.round(clamp01to100(next) * 10) / 10;
    if (v === this.value) {
      return;
    }
    if (this.args.value === undefined) {
      this.internal = v;
    }
    this.args.onValueChange?.(v);
  };
  setFromClientX = (host: HTMLElement | null, clientX: number) => {
    if (!host) {
      return;
    }
    let rect = host.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    this.setValue(((clientX - rect.left) / rect.width) * 100);
  };
  // Pointer capture keeps every event on the handle — no document
  // listeners (backdrop-close discipline, per the Viewport resizeHandle).
  seamDrag = modifier((handle: HTMLElement) => {
    let host = handle.closest('.pretui-comparison') as HTMLElement | null;
    let active = false;
    let down = (e: PointerEvent) => {
      active = true;
      this.dragging = true;
      handle.setPointerCapture(e.pointerId);
      this.setFromClientX(host, e.clientX);
    };
    let move = (e: PointerEvent) => {
      if (active) {
        this.setFromClientX(host, e.clientX);
      }
    };
    let up = () => {
      active = false;
      this.dragging = false;
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
  });
  handleKeyDown = (e: Event) => {
    let ev = e as KeyboardEvent;
    let step = ev.shiftKey ? 10 : 1;
    let next: number | undefined;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
      next = this.value - step;
    } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
      next = this.value + step;
    } else if (ev.key === 'Home') {
      next = 0;
    } else if (ev.key === 'End') {
      next = 100;
    }
    if (next !== undefined) {
      ev.preventDefault();
      this.setValue(next);
    }
  };
  <template>
    <div
      class='pretui-comparison'
      style={{this.splitStyle}}
      data-dragging={{if this.dragging 'true'}}
      data-test-pretui-comparison
      ...attributes
    >
      <div class='pretui-comparison-before'>{{yield to='before'}}</div>
      <div class='pretui-comparison-after'>{{yield to='after'}}</div>
      <div class='pretui-comparison-seam'>
        <div
          class='pretui-comparison-handle'
          role='slider'
          tabindex='0'
          aria-label={{if @label @label 'Comparison position'}}
          aria-valuemin='0'
          aria-valuemax='100'
          aria-valuenow={{this.roundedValue}}
          {{this.seamDrag}}
          {{on 'keydown' this.handleKeyDown}}
        >
          <svg
            class='pretui-comparison-grip'
            viewBox='0 0 24 24'
            role='presentation'
          >
            <path role='presentation' d='M9 6l-4 6 4 6M15 6l4 6-4 6' />
          </svg>
        </div>
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-comparison {
          position: relative;
          overflow: hidden;
          user-select: none;
          -webkit-user-select: none;
          border-radius: var(--radius-surface, 10px);
          box-shadow: 0 0 0 1px var(--border);
          --split: 50%;
        }
        .pretui-comparison-before {
          display: block;
        }
        .pretui-comparison-after {
          position: absolute;
          inset: 0;
          clip-path: inset(0 calc(100% - var(--split)) 0 0);
        }
        .pretui-comparison-seam {
          position: absolute;
          top: 0;
          bottom: 0;
          left: var(--split);
          width: var(--pretui-comparison-seam-w, 2px);
          transform: translateX(-50%);
          background: var(--card);
          box-shadow: 0 0 0 1px
            color-mix(in oklch, var(--foreground) 12%, transparent);
        }
        .pretui-comparison-handle {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: var(--pretui-comparison-handle-size, 28px);
          height: var(--pretui-comparison-handle-size, 28px);
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: var(--card);
          color: var(--muted-foreground);
          box-shadow:
            0 0 0 1px var(--border),
            var(--pretui-shadow-card, 0 1px 3px rgba(20, 18, 26, 0.12));
          cursor: ew-resize;
          touch-action: none;
        }
        .pretui-comparison-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-comparison[data-dragging='true'] .pretui-comparison-handle {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        }
        .pretui-comparison-grip {
          width: 60%;
          height: 60%;
          fill: none;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
      }
    </style>
  </template>
}
