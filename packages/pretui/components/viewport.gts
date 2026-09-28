// Pretui — Viewport: the artboard every usage example renders in.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { SegmentedControl } from './segmented-control';
import { Select } from './select';
import { Slider } from './slider';
import { Switch } from './switch';

function htmlWidth(w: string) {
  return `width: ${w}`;
}
function isInline(mode: string) {
  return mode === 'inline';
}
function isBp(mode: string) {
  return mode === 'bp';
}

// ── Viewport — the artboard ──────────────────────────────────────────────
// Built against the artboard contract (Appendix H): true widths that pan
// rather than clamp, a neutral stage with explicit surface/gutter settings,
// named breakpoints + a 3-up mode, honest live captions, a drag handle
// (pointer capture, no document listeners), and reflected data-* state.
const VIEWPORT_MODES = [
  { value: 'fill', label: 'Fill' },
  { value: 'phone', label: 'Phone' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'bp', label: '3-up' },
  { value: 'inline', label: 'Inline' },
  { value: 'grid', label: 'Grid' },
];
const PRESET_WIDTHS: Record<string, number> = {
  phone: 375,
  tablet: 768,
  desktop: 1120,
};
const BREAKPOINTS = [
  { bp: 'phone', caption: 'Phone · 375px' },
  { bp: 'tablet', caption: 'Tablet · 768px' },
  { bp: 'desktop', caption: 'Desktop · 1120px' },
];
const SURFACES = [
  { value: 'background', label: 'Background' },
  { value: 'card', label: 'Card' },
  { value: 'inset', label: 'Inset' },
];
// pre-artboard mode names still referenced by older pages
const LEGACY_MODES: Record<string, string> = {
  narrow: 'phone',
  wide: 'desktop',
};
const GRID_CELLS = [1, 2, 3, 4, 5, 6];

export interface ViewportSignature {
  Args: {
    defaultMode?:
      | 'fill'
      | 'phone'
      | 'tablet'
      | 'desktop'
      | 'bp'
      | 'inline'
      | 'grid'
      | 'narrow'
      | 'wide';
    // artboard caption, e.g. the component name — renders "Name · <width>"
    label?: string;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export class Viewport extends Component<ViewportSignature> {
  @tracked mode: string =
    LEGACY_MODES[this.args.defaultMode ?? ''] ?? this.args.defaultMode ?? 'fill';
  @tracked customWidth = 0;
  @tracked surface = 'background';
  @tracked gutter = true;
  cells = GRID_CELLS;
  breakpoints = BREAKPOINTS;
  surfaces = SURFACES;
  setMode = (v: string) => {
    this.mode = v;
    this.customWidth = 0;
  };
  setWidth = (v: number) => {
    this.customWidth = Math.round(Math.min(1600, Math.max(240, v)));
    if (!this.isFramed) {
      this.mode = 'fill';
    }
  };
  setSurface = (v: string) => (this.surface = v);
  setGutter = (v: boolean) => (this.gutter = v);
  get isFramed() {
    return this.mode === 'fill' || this.mode in PRESET_WIDTHS;
  }
  get artboardWidth(): number {
    return this.customWidth || PRESET_WIDTHS[this.mode] || 0;
  }
  get widthLabel() {
    return this.artboardWidth ? `${this.artboardWidth}px` : 'fill';
  }
  get frameStyleWidth() {
    return this.artboardWidth ? `${this.artboardWidth}px` : '100%';
  }
  get frameCaption() {
    return `${this.args.label ?? 'Specimen'} · ${this.widthLabel}`;
  }
  // Drag-to-resize on the artboard edge. Pointer capture keeps every event
  // on the handle — no document listeners (backdrop-close discipline).
  resizeHandle = modifier((handle: HTMLElement) => {
    let artboard = handle.closest('.pretui-artboard') as HTMLElement | null;
    // The flag lives on the viewport root, not documentElement: scoped CSS
    // can only match elements this component renders, and the root is the
    // ancestor of everything a drag could otherwise select.
    let root = handle.closest('.pretui-viewport') as HTMLElement | null;
    let startX = 0;
    let startW = 0;
    let active = false;
    // Pointer capture keeps the events coming to the handle, but it does NOT
    // stop the browser from extending a text selection across the page while
    // the button is held. preventDefault on pointerdown suppresses the
    // selection gesture at its source, and the data-resizing flag pins
    // user-select: none for the duration in case a selection was already
    // under way when the drag started.
    let down = (e: PointerEvent) => {
      active = true;
      startX = e.clientX;
      startW = artboard?.getBoundingClientRect().width ?? 0;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
      root?.setAttribute('data-resizing', 'true');
    };
    let move = (e: PointerEvent) => {
      if (active) {
        this.setWidth(startW + (e.clientX - startX));
      }
    };
    let up = () => {
      active = false;
      root?.removeAttribute('data-resizing');
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
      // Never leave the page unselectable if the handle unmounts mid-drag.
      root?.removeAttribute('data-resizing');
    };
  });
  <template>
    <div class='pretui-viewport' data-test-pretui-viewport ...attributes>
      <div class='pretui-viewport-bar'>
        <SegmentedControl
          @options={{VIEWPORT_MODES}}
          @value={{this.mode}}
          @onValueChange={{this.setMode}}
        />
        <div class='pretui-viewport-settings'>
          <div class='pretui-viewport-surface'>
            <Select
              @options={{this.surfaces}}
              @value={{this.surface}}
              @onValueChange={{this.setSurface}}
            />
          </div>
          <label class='pretui-viewport-gutter'>
            <Switch
              @checked={{this.gutter}}
              @onCheckedChange={{this.setGutter}}
            />
            <span>Gutter</span>
          </label>
        </div>
        <div class='pretui-viewport-width'>
          <Slider
            @value={{this.artboardWidth}}
            @min={{240}}
            @max={{1600}}
            @step={{5}}
            @label='Artboard width'
            @onValueChange={{this.setWidth}}
          />
          <span class='pretui-viewport-readout'>{{this.widthLabel}}</span>
        </div>
      </div>
      <div
        class='pretui-viewport-canvas'
        data-mode={{this.mode}}
        data-width={{this.widthLabel}}
      >
        {{#if this.isFramed}}
          <div
            class='pretui-artboard'
            data-label={{this.frameCaption}}
            data-width={{this.widthLabel}}
            style={{htmlWidth this.frameStyleWidth}}
          >
            <div
              class='pretui-artboard-body'
              data-surface={{this.surface}}
              data-gutter={{if this.gutter 'true' 'false'}}
            >
              {{yield}}
            </div>
            <span
              class='pretui-artboard-handle'
              aria-hidden='true'
              title='Drag to resize — or use the width slider'
              {{this.resizeHandle}}
            ></span>
          </div>
        {{else if (isBp this.mode)}}
          <div class='pretui-bp-row'>
            {{#each this.breakpoints as |b|}}
              <div
                class='pretui-artboard'
                data-bp={{b.bp}}
                data-label={{b.caption}}
              >
                <div
                  class='pretui-artboard-body'
                  data-surface={{this.surface}}
                  data-gutter={{if this.gutter 'true' 'false'}}
                >
                  {{yield}}
                </div>
              </div>
            {{/each}}
          </div>
        {{else if (isInline this.mode)}}
          <p class='pretui-viewport-prose'>The order ledger closes at noon, and
            {{yield}}
            sits inline with the running text — cap-line trim and optical
            spacing judged mid-paragraph, exactly where machine values live.</p>
        {{else}}
          <div class='pretui-viewport-grid'>
            {{#each this.cells}}
              <div
                class='pretui-viewport-cell'
                data-surface={{this.surface}}
              >{{yield}}</div>
            {{/each}}
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-viewport {
        display: grid;
        min-width: 0;
      }
      /* While the width handle is being dragged, nothing in the viewport is
         selectable — otherwise the drag paints a text selection across the
         artboard and its captions. Set by the resizeHandle modifier and
         cleared on pointerup, pointercancel, and teardown. */
      .pretui-viewport[data-resizing='true'] {
        user-select: none;
        -webkit-user-select: none;
        cursor: ew-resize;
      }
      .pretui-viewport-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4, 11px);
        flex-wrap: wrap;
        min-height: 36px;
        padding: 6px var(--space-4, 11px);
        box-shadow: inset 0 -1px 0 var(--border);
      }
      .pretui-viewport-width {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 160px;
        max-width: 300px;
      }
      .pretui-viewport-width > :first-child {
        flex: 1;
      }
      .pretui-viewport-readout {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        min-width: 48px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .pretui-viewport-settings {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
      }
      .pretui-viewport-surface {
        width: 130px;
        font-size: var(--text-ui, 12px);
      }
      .pretui-viewport-gutter {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-ui, 12px);
        font-weight: 500;
        color: var(--muted-foreground);
        white-space: nowrap;
        cursor: pointer;
      }
      .pretui-viewport-canvas {
        /* the canvas floor: dot grid on the inset surface (Figma idiom).
           R1: true widths — wide artboards pan, they are never clamped */
        background-color: var(--inset, var(--boxel-100));
        background-image: radial-gradient(
          circle,
          var(
              --pretui-canvas-dot,
              color-mix(in oklch, var(--foreground) 13%, transparent)
            )
            1px,
          transparent 1px
        );
        background-size: 20px 20px;
        min-height: 220px;
        max-height: 60vh;
        padding: 34px var(--space-6, 19px) var(--space-6, 19px);
        overflow: auto;
        min-width: 0;
      }
      .pretui-artboard {
        /* exact width from inline style or data-bp; centered while it fits,
           panned once it doesn't */
        position: relative;
        margin-inline: auto;
        min-height: 72px;
      }
      .pretui-artboard[data-label]::before {
        content: attr(data-label);
        position: absolute;
        top: -21px;
        left: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: 0.02em;
        /* luminance clamp: a season's accent can be too light for small
           text on the floor — always mix toward ink */
        color: color-mix(
          in oklch,
          var(--pretui-accent, var(--primary)) 55%,
          var(--foreground)
        );
        white-space: nowrap;
      }
      .pretui-artboard:hover {
        outline: 1px solid
          color-mix(
            in oklch,
            var(--pretui-accent, var(--primary)) 45%,
            transparent
          );
        outline-offset: 8px;
      }
      .pretui-artboard-body {
        /* R2: a neutral stage — normal block flow, no centering opinion */
        min-height: 72px;
        border-radius: 8px;
        box-shadow: 0 0 0 1px var(--border);
      }
      .pretui-artboard-body[data-gutter='true'] {
        padding: var(--space-5, 14px);
      }
      .pretui-artboard-body[data-surface='background'] {
        /* the specimen sits directly on the dot floor — no extra box */
        background: transparent;
        box-shadow: none;
        border-radius: 0;
      }
      .pretui-artboard-body[data-surface='card'] {
        background: var(--card);
        box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border), 0 1px 3px var(--shadow-ink-soft, rgb(16 24 40 / 0.06)));
      }
      .pretui-artboard-body[data-surface='inset'] {
        background: var(--inset, var(--boxel-100));
        box-shadow: inset 0 0 0 1px var(--border);
      }
      .pretui-artboard-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        right: -18px;
        width: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ew-resize;
        touch-action: none;
      }
      .pretui-artboard-handle::after {
        content: '';
        width: 4px;
        height: 30px;
        border-radius: 4px;
        background: var(--line-strong, var(--boxel-400));
      }
      .pretui-artboard-handle:hover::after {
        background: var(--pretui-accent, var(--primary));
      }
      .pretui-bp-row {
        /* R3: the same specimen at every breakpoint, side by side */
        display: flex;
        gap: 34px;
        align-items: flex-start;
        width: max-content;
        margin-inline: auto;
      }
      .pretui-bp-row .pretui-artboard[data-bp='phone'] {
        width: 375px;
      }
      .pretui-bp-row .pretui-artboard[data-bp='tablet'] {
        width: 768px;
      }
      .pretui-bp-row .pretui-artboard[data-bp='desktop'] {
        width: 1120px;
      }
      .pretui-viewport-prose {
        margin: 0;
        max-width: 62ch;
        font-size: var(--text-body, 15px);
        line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
        color: var(--foreground);
      }
      .pretui-viewport-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--space-4, 11px);
      }
      .pretui-viewport-cell {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-3, 8px);
        flex-wrap: wrap;
        background: var(--background);
        border-radius: 8px;
        box-shadow: 0 0 0 1px var(--border);
        padding: var(--space-4, 11px);
        min-height: 64px;
      }
    </style>
  </template>
}
