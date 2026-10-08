// Pretui — Viewport: the artboard every usage example renders in.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { SegmentedControl } from './segmented-control';
import { Select } from './select';
import { Slider } from './slider';
import { Switch } from './switch';

function htmlWidth(w: string) {
  return htmlSafe(`width: ${w}`);
}
function isInline(mode: string) {
  return mode === 'inline';
}
function isBp(mode: string) {
  return mode === 'bp';
}

// ── Viewport — the artboard ──────────────────────────────────────────────
// Built against the artboard contract: true widths that pan
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
  phone: 320,
  tablet: 600,
  desktop: 1120,
};
const BREAKPOINTS = Object.entries(PRESET_WIDTHS).map(([bp, px]) => ({
  bp,
  width: `${px}px`,
  caption: `${VIEWPORT_MODES.find((m) => m.value === bp)?.label} · ${px}px`,
}));
const SURFACES = [
  { value: 'background', label: 'Background' },
  { value: 'card', label: 'Card' },
  { value: 'inset', label: 'Inset' },
  { value: 'sidebar', label: 'Sidebar' },
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
    // the specimen's name, e.g. the component name: the caption of a
    // dragged width ("Name · <width>"); presets are captioned by mode
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
  // A free width belongs to Fill, so every preset click afterwards is a real
  // change that resets it; snapped to the slider's 5px step so the slider
  // can land on a dragged width.
  setWidth = (v: number) => {
    this.customWidth = Math.round(Math.min(1600, Math.max(240, v)) / 5) * 5;
    this.mode = 'fill';
  };
  formatWidth = (v: number) => `${v} pixels`;
  setSurface = (v: string) => (this.surface = v);
  setGutter = (v: boolean) => (this.gutter = v);
  get isFramed() {
    return this.mode === 'fill' || this.mode in PRESET_WIDTHS;
  }
  get artboardWidth(): number {
    return this.customWidth || PRESET_WIDTHS[this.mode] || 0;
  }
  get widthLabel() {
    return this.artboardWidth ? `${this.artboardWidth}px` : '100%';
  }
  // a preset (Fill or a device) is named by its mode, like the 3-up
  // captions; a dragged width names the specimen
  get frameCaption() {
    let device = this.customWidth
      ? undefined
      : VIEWPORT_MODES.find((m) => m.value === this.mode)?.label;
    return `${device ?? this.args.label ?? 'Specimen'} · ${this.widthLabel}`;
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
      if (e.button !== 0) return;
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
    <div class='pretui-viewport' ...attributes data-test-pretui-viewport>
      <div class='pretui-viewport-bar'>
        <SegmentedControl
          class='pretui-viewport-modes'
          @label='Viewport mode'
          @options={{VIEWPORT_MODES}}
          @value={{this.mode}}
          @onValueChange={{this.setMode}}
        />
        <div class='pretui-viewport-settings'>
          <div class='pretui-viewport-surface'>
            <Select
              @label='Stage surface'
              @options={{this.surfaces}}
              @value={{this.surface}}
              @onValueChange={{this.setSurface}}
              @disabled={{isInline this.mode}}
            />
          </div>
          <label class='pretui-viewport-gutter'>
            <Switch
              @checked={{this.gutter}}
              @onCheckedChange={{this.setGutter}}
              @disabled={{isInline this.mode}}
              data-test-pretui-viewport-gutter
            />
            <span>Padding</span>
          </label>
        </div>
        <div class='pretui-viewport-width'>
          <Slider
            @value={{this.artboardWidth}}
            @min={{240}}
            @max={{1600}}
            @step={{5}}
            @label='Artboard width'
            @formatValue={{this.formatWidth}}
            @onValueChange={{this.setWidth}}
          />
          <span class='pretui-viewport-readout'>{{this.widthLabel}}</span>
        </div>
      </div>
      {{! wide artboards pan inside the canvas, so it takes a tab stop and a
          name for keyboard users }}
      <div
        class='pretui-viewport-canvas'
        tabindex='0'
        role='region'
        aria-label='Artboard canvas'
        data-mode={{this.mode}}
        data-width={{this.widthLabel}}
      >
        {{#if this.isFramed}}
          <div
            class='pretui-artboard'
            data-label={{this.frameCaption}}
            data-width={{this.widthLabel}}
            style={{htmlWidth this.widthLabel}}
            data-test-pretui-artboard
          >
            <div
              class='pretui-artboard-body'
              data-surface={{this.surface}}
              data-gutter={{if this.gutter 'true' 'false'}}
              data-test-pretui-artboard-body
              data-test-pretui-viewport-specimen
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
                style={{htmlWidth b.width}}
                data-test-pretui-artboard
              >
                <div
                  class='pretui-artboard-body'
                  data-surface={{this.surface}}
                  data-gutter={{if this.gutter 'true' 'false'}}
                  data-test-pretui-artboard-body
                  data-test-pretui-viewport-specimen
                >
                  {{yield}}
                </div>
              </div>
            {{/each}}
          </div>
        {{else if (isInline this.mode)}}
          {{! a div, not a p: the specimen may be block-level markup }}
          <div class='pretui-viewport-prose'>The order ledger closes at noon,
            and
            <div
              class='pretui-viewport-inline'
              data-test-pretui-viewport-specimen
            >{{yield}}</div>
            sits inline with the running text — cap-line trim and optical
            spacing judged mid-paragraph, exactly where machine values live.</div>
        {{else}}
          <div class='pretui-viewport-grid'>
            {{#each this.cells}}
              <div
                class='pretui-viewport-cell'
                data-surface={{this.surface}}
                data-gutter={{if this.gutter 'true' 'false'}}
                data-test-pretui-viewport-specimen
              >{{yield}}</div>
            {{/each}}
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-viewport {
          --pretui-viewport-bar-min-h: 2.25rem;
          --pretui-viewport-width-min-w: 10rem;
          --pretui-viewport-width-max-w: 18.75rem;
          --pretui-viewport-readout-min-w: 3rem;
          --pretui-viewport-surface-w: 8.125rem;
          --pretui-viewport-canvas-min-h: 13.75rem;
          --pretui-viewport-canvas-max-h: 34rem;
          --pretui-viewport-dot-gap: 1.25rem;
          /* a translucent --background follows the theme in light and dark,
             which the fixed --boxel-light-* overlays don't */
          --pretui-viewport-veil: color-mix(
            in oklch,
            var(--background) 70%,
            transparent
          );
          --pretui-artboard-min-h: 4.5rem;
          --pretui-artboard-handle-w: 1rem;
          --pretui-artboard-grip-w: 0.25rem;
          --pretui-artboard-grip-h: 1.875rem;
          --pretui-viewport-tile-min-w: 12.5rem;
          --pretui-viewport-cell-min-h: 4rem;

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
          gap: var(--boxel-sp-sm);
          flex-wrap: wrap;
          min-height: var(--pretui-viewport-bar-min-h);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
          box-shadow: inset 0 -1px 0 var(--border);
        }
        /* seven segments outgrow a phone-width panel; the control scrolls on
           its own rather than pushing the page sideways */
        .pretui-viewport-modes {
          max-width: 100%;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .pretui-viewport-width {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex: 1;
          min-width: var(--pretui-viewport-width-min-w);
          max-width: var(--pretui-viewport-width-max-w);
        }
        .pretui-viewport-width > :first-child {
          flex: 1;
        }
        .pretui-viewport-readout {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          min-width: var(--pretui-viewport-readout-min-w);
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .pretui-viewport-settings {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .pretui-viewport-surface {
          width: var(--pretui-viewport-surface-w);
        }
        .pretui-viewport-gutter {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-2xs);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          line-height: var(--boxel-ui-label-line-height);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
          color: var(--muted-foreground);
          white-space: nowrap;
          cursor: pointer;
        }
        .pretui-viewport-canvas {
          /* the canvas floor: dot grid on the inset surface (Figma idiom).
             R1: true widths — wide artboards pan, they are never clamped */
          background-color: var(--inset);
          color: var(--foreground);
          background-image: radial-gradient(
            circle,
            var(--border) 1px,
            transparent 1px
          );
          background-size: var(--pretui-viewport-dot-gap)
            var(--pretui-viewport-dot-gap);
          min-height: var(--pretui-viewport-canvas-min-h);
          max-height: var(--pretui-viewport-canvas-max-h);
          padding: var(--boxel-sp-2xl) var(--boxel-sp-lg) var(--boxel-sp-lg);
          overflow: auto;
          min-width: 0;
        }
        .pretui-artboard {
          /* exact width from its inline style; centered while it fits, panned
             once it doesn't. The preset widths stay in px: they stand in for
             device widths in CSS pixels. */
          position: relative;
          margin-inline: auto;
          min-height: var(--pretui-artboard-min-h);
        }
        .pretui-artboard[data-label]::before {
          content: attr(data-label);
          position: absolute;
          top: calc(-1 * var(--boxel-sp-lg));
          inset-inline-start: 0;
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-2xs);
          letter-spacing: var(--boxel-lsp-sm);
          color: var(--primary-ink);
          white-space: nowrap;
        }
        /* a neutral stage, normal block flow with no centering opinion; grid
           cells share its surfaces */
        .pretui-artboard-body,
        .pretui-viewport-cell {
          min-height: var(--pretui-artboard-min-h);
          border-radius: var(--boxel-border-radius-sm);
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-artboard-body[data-gutter='true'] {
          padding: var(--boxel-sp);
        }
        .pretui-artboard-body[data-surface='background'],
        .pretui-viewport-cell[data-surface='background'] {
          /* a veil of the page color over the dot floor, so the stage reads as
             an area while the specimen still sits on the page background */
          background-color: var(--pretui-viewport-veil);
        }
        .pretui-artboard-body[data-surface='card'],
        .pretui-viewport-cell[data-surface='card'] {
          background-color: var(--card);
          color: var(--card-foreground);
          box-shadow:
            0 0 0 1px var(--border),
            var(--shadow-sm);
        }
        .pretui-artboard-body[data-surface='sidebar'],
        .pretui-viewport-cell[data-surface='sidebar'] {
          background-color: var(--sidebar);
          color: var(--sidebar-foreground);
          box-shadow: 0 0 0 1px var(--sidebar-border);
        }
        .pretui-artboard-body[data-surface='inset'],
        .pretui-viewport-cell[data-surface='inset'] {
          background-color: var(--inset);
          box-shadow: inset 0 0 0 1px var(--border);
        }
        .pretui-artboard-handle {
          position: absolute;
          top: 0;
          bottom: 0;
          right: calc(-1 * var(--pretui-artboard-handle-w) - var(--boxel-sp-6xs));
          width: var(--pretui-artboard-handle-w);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: ew-resize;
          touch-action: none;
        }
        .pretui-artboard-handle::after {
          content: '';
          width: var(--pretui-artboard-grip-w);
          height: var(--pretui-artboard-grip-h);
          border-radius: var(--boxel-border-radius-xs);
          background-color: var(--border-strong);
        }
        .pretui-artboard-handle:hover::after {
          background-color: var(--primary-ink);
        }
        .pretui-bp-row {
          /* R3: the same specimen at every breakpoint, side by side */
          display: flex;
          gap: var(--boxel-sp-2xl);
          align-items: flex-start;
          width: max-content;
          margin-inline: auto;
        }
        .pretui-viewport-prose {
          max-width: 62ch;
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
        }
        /* a block specimen (a toast, a segmented control) still sits on the
           line instead of breaking the paragraph */
        .pretui-viewport-inline {
          display: inline-block;
          max-width: 100%;
          vertical-align: middle;
        }
        .pretui-viewport-grid {
          display: grid;
          grid-template-columns: repeat(
            auto-fill,
            minmax(var(--pretui-viewport-tile-min-w), 1fr)
          );
          gap: var(--boxel-sp-sm);
        }
        .pretui-viewport-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
          min-height: var(--pretui-viewport-cell-min-h);
        }
        .pretui-viewport-cell[data-gutter='true'] {
          padding: var(--boxel-sp-sm);
        }
      }
    </style>
  </template>
}
