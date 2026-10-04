// Pretui — ZoomableFrame: pan and zoom over fixed content, driven by buttons, keys and pointer.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { cssStyleFrom } from '../pretui-css';
import { clamp } from '../internal/structure-scroll';

// ── ZoomableFrame ────────────────────────────────────────────────────────

interface FrameGesture {
  scale: number;
  x: number;
  y: number;
}

/**
 * Owns every pointer and wheel gesture for `ZoomableFrame`.
 *
 * Bound inside a modifier rather than with `{{on}}` for two separate
 * reasons, both realm facts: the remote lint forbids template `pointerdown`
 * bindings outright, and `wheel` must be registered `{ passive: false }` to
 * be allowed to `preventDefault` — which a template binding cannot express.
 *
 * Two-pointer pinch is handled in the same handler set rather than a
 * separate touch path, which is what makes the component work identically
 * with a trackpad, a pen and two thumbs.
 */
const framePointer = modifier(
  (
    element: HTMLElement,
    [read, write]: [() => FrameGesture, (next: FrameGesture, smooth: boolean) => void],
  ) => {
    let points = new Map<number, { x: number; y: number }>();
    let startGesture: FrameGesture | undefined;
    let startSpread = 0;
    let startMid = { x: 0, y: 0 };

    let spread = () => {
      let list = Array.from(points.values());
      let a = list[0];
      let b = list[1];
      if (!a || !b) {
        return 0;
      }
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    let midpoint = () => {
      let list = Array.from(points.values());
      let a = list[0];
      let b = list[1];
      if (!a) {
        return { x: 0, y: 0 };
      }
      if (!b) {
        return { x: a.x, y: a.y };
      }
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    let down = (event: PointerEvent) => {
      // Never swallow a click meant for the content: a press on a link or a
      // button inside the frame still belongs to that control.
      if (event.button !== 0) {
        return;
      }
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      element.setPointerCapture(event.pointerId);
      startGesture = read();
      startSpread = spread();
      startMid = midpoint();
      element.dataset['gesture'] = 'active';
    };

    let move = (event: PointerEvent) => {
      if (!points.has(event.pointerId) || !startGesture) {
        return;
      }
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      let mid = midpoint();
      let panX = startGesture.x + (mid.x - startMid.x);
      let panY = startGesture.y + (mid.y - startMid.y);
      let scale = startGesture.scale;
      if (points.size > 1 && startSpread > 0) {
        scale = startGesture.scale * (spread() / startSpread);
      }
      write({ scale, x: panX, y: panY }, false);
      event.preventDefault();
    };

    let up = (event: PointerEvent) => {
      points.delete(event.pointerId);
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      if (points.size === 0) {
        startGesture = undefined;
        element.dataset['gesture'] = 'idle';
      } else {
        // A finger lifted mid-pinch: re-baseline so the remaining one pans
        // from where it is rather than snapping.
        startGesture = read();
        startSpread = spread();
        startMid = midpoint();
      }
    };

    let wheel = (event: WheelEvent) => {
      // Trackpad pinch and ctrl+wheel both arrive as a ctrlKey wheel event.
      // A bare wheel is left alone so the page still scrolls past the frame.
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      let current = read();
      let factor = Math.exp(-event.deltaY / 320);
      write({ ...current, scale: current.scale * factor }, false);
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('wheel', wheel, { passive: false });
    element.dataset['gesture'] = 'idle';

    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('wheel', wheel);
    };
  },
);

/** The keyboard path, one key per pointer gesture. Bound in a modifier for
 * the same `no-invalid-interactive` reason as the carousel's. */
const frameKeys = modifier(
  (
    element: HTMLElement,
    [zoom, pan, reset]: [
      (factor: number) => void,
      (dx: number, dy: number) => void,
      () => void,
    ],
  ) => {
    let onKeydown = (event: KeyboardEvent) => {
      let step = event.shiftKey ? 96 : 24;
      let key = event.key;
      let handled = true;
      if (key === '+' || key === '=') {
        zoom(1.25);
      } else if (key === '-' || key === '_') {
        zoom(0.8);
      } else if (key === '0' || key === 'Home') {
        reset();
      } else if (key === 'ArrowLeft') {
        pan(step, 0);
      } else if (key === 'ArrowRight') {
        pan(-step, 0);
      } else if (key === 'ArrowUp') {
        pan(0, step);
      } else if (key === 'ArrowDown') {
        pan(0, -step);
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
      }
    };
    element.addEventListener('keydown', onKeydown);
    return () => element.removeEventListener('keydown', onKeydown);
  },
);

export interface ZoomableFrameSignature {
  Args: {
    /** Accessible name for the viewport. Required in practice: it is the
     * only thing a screen reader can say about a pannable box. */
    label?: string;
    /** Smallest scale. Default 0.25. */
    min?: number;
    /** Largest scale. Default 4. */
    max?: number;
    /** Multiplier per zoom step from a button or key. Default 1.25. */
    step?: number;
    /** Controlled scale. Omit for uncontrolled. */
    scale?: number;
    /** Fires with the next scale on every change. */
    onScaleChange?: (scale: number) => void;
    /** Hide the toolbar. The keyboard and pointer paths are unaffected — but
     * the readout goes with it, so only do this when the scale is displayed
     * somewhere else. */
    hideToolbar?: boolean;
  };
  Blocks: {
    /** The framed content. Laid out at its natural size and transformed as
     * a whole, so nothing inside needs to know it is being zoomed. */
    default: [];
  };
  Element: HTMLDivElement;
}

/**
 * A zoom-and-pan viewport around framed content.
 *
 * ```hbs
 * <ZoomableFrame @label='Warehouse floor plan'>
 *   <img src={{this.planUrl}} alt='' />
 * </ZoomableFrame>
 * ```
 *
 * Better than the inspiration (`wa-zoomable-frame`): upstream frames an
 * `<iframe>` and offers zoom only — no pan, no keyboard, no touch. Here the
 * content is ordinary DOM (so it can be a card, a chart or an image), every
 * pointer gesture has a keyboard twin (`+` `-` `0` and the arrows,
 * shift for a coarse step), pinch works on a trackpad, a pen and two thumbs
 * through one unified pointer path, and the scale is announced as a live
 * percentage rather than being visible only as a transform.
 */
export class ZoomableFrame extends Component<ZoomableFrameSignature> {
  @tracked private internalScale = 1;
  @tracked private panX = 0;
  @tracked private panY = 0;
  /** True when the change came from a discrete step (button or key), which
   * is the only case where a transition encodes anything (Law 5): during a
   * drag or a pinch, the pointer IS the animation. */
  @tracked private smooth = false;

  /** Per-instance, because two frames on one page would otherwise share an
   * id and `aria-describedby` would resolve to whichever rendered first. */
  private helpId = guidFor(this) + '-frame-help';

  get min(): number {
    return this.args.min ?? 0.25;
  }
  get max(): number {
    return this.args.max ?? 4;
  }
  get step(): number {
    return this.args.step ?? 1.25;
  }
  get scale(): number {
    return clamp(this.args.scale ?? this.internalScale, this.min, this.max);
  }

  /** The percentage a reader sees and a screen reader speaks. */
  get percent(): string {
    return Math.round(this.scale * 100) + '%';
  }

  get atMin(): boolean {
    return this.scale <= this.min + 0.001;
  }
  get atMax(): boolean {
    return this.scale >= this.max - 0.001;
  }
  get isReset(): boolean {
    return this.atOne && this.panX === 0 && this.panY === 0;
  }
  private get atOne(): boolean {
    return Math.abs(this.scale - 1) < 0.001;
  }

  /** Numbers only, so nothing a caller supplied can reach the declaration. */
  get contentStyle() {
    return cssStyleFrom([
      'transform: translate(' +
        this.panX.toFixed(2) +
        'px, ' +
        this.panY.toFixed(2) +
        'px) scale(' +
        this.scale.toFixed(4) +
        ')',
    ]);
  }

  readGesture = (): FrameGesture => ({
    scale: this.scale,
    x: this.panX,
    y: this.panY,
  });

  writeGesture = (next: FrameGesture, smooth: boolean) => {
    let scale = clamp(next.scale, this.min, this.max);
    // Read BEFORE writing: comparing against `this.scale` afterwards would
    // compare the new value with itself and the callback would never fire.
    let changed = Math.abs(scale - this.scale) > 0.0001;
    this.smooth = smooth;
    this.panX = next.x;
    this.panY = next.y;
    if (this.args.scale === undefined) {
      this.internalScale = scale;
    }
    if (changed) {
      this.args.onScaleChange?.(scale);
    }
  };

  zoomBy = (factor: number) => {
    let current = this.readGesture();
    this.writeGesture({ ...current, scale: current.scale * factor }, true);
  };

  panBy = (dx: number, dy: number) => {
    let current = this.readGesture();
    this.writeGesture({ ...current, x: current.x + dx, y: current.y + dy }, true);
  };

  // aria-disabled at the limits, not native disabled: the button that
  // reaches the limit keeps focus, and the press is ignored here instead
  zoomIn = () => {
    if (!this.atMax) this.zoomBy(this.step);
  };
  zoomOut = () => {
    if (!this.atMin) this.zoomBy(1 / this.step);
  };

  reset = () => {
    if (this.isReset) return;
    this.writeGesture({ scale: 1, x: 0, y: 0 }, true);
  };

  <template>
    <div class='pretui-frame' data-test-pretui-zoomable-frame ...attributes>
      <div
        class='pretui-frame-viewport'
        role='group'
        tabindex='0'
        aria-label={{@label}}
        aria-describedby={{this.helpId}}
        data-smooth={{if this.smooth 'true' 'false'}}
        data-test-pretui-frame-viewport
        {{framePointer this.readGesture this.writeGesture}}
        {{frameKeys this.zoomBy this.panBy this.reset}}
      >
        <div class='pretui-frame-content' style={{this.contentStyle}}>
          {{yield}}
        </div>
      </div>

      <p class='pretui-sr' id={{this.helpId}}>
        Zoom with plus and minus, pan with the arrow keys, and press zero to
        reset. Hold shift for a coarser pan step.
      </p>
      <p class='pretui-sr' role='status' data-test-pretui-frame-status>
        Zoom {{this.percent}}
      </p>

      {{#unless @hideToolbar}}
        <div class='pretui-frame-toolbar'>
          <button
            type='button'
            class='pretui-frame-button'
            aria-label='Zoom out'
            aria-disabled={{if this.atMin 'true'}}
            data-test-pretui-frame-out
            {{on 'click' this.zoomOut}}
          ><span class='pretui-frame-glyph' data-glyph='minus' aria-hidden='true'
            ></span></button>
          <span class='pretui-frame-readout' aria-hidden='true'
          >{{this.percent}}</span>
          <button
            type='button'
            class='pretui-frame-button'
            aria-label='Zoom in'
            aria-disabled={{if this.atMax 'true'}}
            data-test-pretui-frame-in
            {{on 'click' this.zoomIn}}
          ><span class='pretui-frame-glyph' data-glyph='plus' aria-hidden='true'
            ></span></button>
          <button
            type='button'
            class='pretui-frame-button'
            aria-label='Reset zoom and position'
            aria-disabled={{if this.isReset 'true'}}
            data-test-pretui-frame-reset
            {{on 'click' this.reset}}
          >Reset</button>
        </div>
      {{/unless}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-frame {
          position: relative;
          display: block;
          min-width: 0;
          container-type: inline-size;
          font-family: var(--font-sans);
          color: var(--foreground);
        }
        .pretui-frame-viewport {
          position: relative;
          overflow: hidden;
          block-size: var(--pretui-frame-height, 360px);
          border-radius: var(--radius-surface, 10px);
          background: var(--pretui-frame-ground, var(--muted));
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
          /* The browser must not claim the gesture before we do — without
             this, a pinch scrolls the page on touch instead of zooming. */
          touch-action: none;
          cursor: grab;
        }
        .pretui-frame-viewport[data-gesture='active'] {
          cursor: grabbing;
        }
        .pretui-frame-viewport:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-frame-content {
          transform-origin: center center;
          inline-size: 100%;
          block-size: 100%;
          display: grid;
          place-items: center;
        }
        /* Only a discrete step animates. A drag is already continuous — a
           transition there would lag the pointer, which is the classic
           zoom-viewer bug. */
        .pretui-frame-viewport[data-smooth='true'] .pretui-frame-content {
          transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .pretui-frame-toolbar {
          position: absolute;
          inset-block-end: var(--space-3, 8px);
          inset-inline-end: var(--space-3, 8px);
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          border-radius: 999px;
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border),
            0 2px 10px rgb(0 0 0 / 0.22)
          );
        }
        .pretui-frame-button {
          min-inline-size: 30px;
          block-size: 30px;
          padding-inline: 8px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          cursor: pointer;
        }
        @media (any-pointer: coarse) {
          .pretui-frame-button {
            min-inline-size: 44px;
            block-size: 44px;
          }
        }
        .pretui-frame-button:hover:not([aria-disabled='true']) {
          background: color-mix(
            in oklch,
            var(--foreground) 6%,
            transparent
          );
        }
        .pretui-frame-button[aria-disabled='true'] {
          opacity: 0.35;
          cursor: default;
        }
        .pretui-frame-button:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        /* CSS glyphs, not svg: lint's require-presentational-children rejects
           any <svg> inside a button subtree. */
        .pretui-frame-glyph {
          position: relative;
          inline-size: 11px;
          block-size: 11px;
        }
        .pretui-frame-glyph::before,
        .pretui-frame-glyph::after {
          content: '';
          position: absolute;
          background: currentColor;
          inset-block-start: 50%;
          inset-inline-start: 0;
          inline-size: 11px;
          block-size: 1.5px;
          transform: translateY(-50%);
        }
        .pretui-frame-glyph[data-glyph='plus']::after {
          transform: translateY(-50%) rotate(90deg);
        }
        .pretui-frame-glyph[data-glyph='minus']::after {
          display: none;
        }
        .pretui-frame-readout {
          min-inline-size: 44px;
          text-align: center;
          font-variant-numeric: tabular-nums;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          margin: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-frame-viewport[data-smooth='true'] .pretui-frame-content {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
