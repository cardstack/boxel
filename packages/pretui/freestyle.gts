// Pretui — ember-freestyle, ported (verbatim-reuse directive) and dogfooded:
// same invocation surface as addon/components/freestyle/usage (<:example>,
// <:api as |Args|> with Args.String/Bool/Number/Array/Object/Component/
// Action/Yield/Base, <:cssVars as |Css|>), but the machinery wears the kit —
// Select/Input/Switch/Slider as knob controls, Table for the API docs, and
// the Viewport frame around every example. Layout evolution (Chris): the
// interactive knobs render as a right-hand PROPERTY LIST while the API table
// below documents types/descriptions/defaults — the same <:api> block is
// yielded twice through two lenses (prop / doc), so usage pages stay
// verbatim-freestyle. Deliberate deltas: no ember-freestyle service, plain
// <pre> for @source, labeled controls.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint can't see
// it here (accepted parse baseline, same as overlay.gts / reading-extras.gts)
import { modifier } from 'ember-modifier';
import { Table } from './reading';
import { Select, Input, Switch, Slider, SegmentedControl } from './controls';
import { CopyButton } from './controls-extras';
import { JsonTree } from './json-tree';

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}
function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}
function readOnlyText(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (v === '') return '""';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
  return String(v);
}
function htmlWidth(w: string) {
  return `width: ${w}`;
}
function isInline(mode: string) {
  return mode === 'inline';
}
function isBp(mode: string) {
  return mode === 'bp';
}

type ArgsMode = 'doc' | 'prop';

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

// ── Property-list row (the prop lens) ────────────────────────────────────
interface PropRowSignature {
  Args: { label?: string; required?: boolean };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

const PropRow: TemplateOnlyComponent<PropRowSignature> = <template>
  <div class='proprow' ...attributes>
    <span class='proprow-label'>
      {{@label}}
      {{#if @required}}<span class='proprow-req'>*</span>{{/if}}
    </span>
    <span class='proprow-control'>{{yield}}</span>
  </div>
  <style scoped>
    /* workbench inspector row: label rail left, control right */
    .proprow {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 4px 0;
    }
    .proprow-label {
      font-family: var(--font-mono);
      font-size: var(--text-ui, 12px);
      color: var(--muted-foreground);
      overflow-wrap: anywhere;
    }
    .proprow-req {
      color: var(--pretui-destructive-ink, var(--boxel-danger));
    }
    .proprow-control {
      min-width: 0;
    }
  </style>
</template>;

interface PropReadOnlySignature {
  Args: { value?: string };
  Element: HTMLSpanElement;
}

const PropReadOnly: TemplateOnlyComponent<PropReadOnlySignature> = <template>
  <span class='proprow-readonly' data-test-pretui-prop-readonly>{{@value}}</span>
  <style scoped>
    .proprow-readonly {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--muted-foreground);
      font-family: var(--font-mono);
      font-size: var(--text-ui-sm, 11.5px);
      line-height: 1.4;
    }
  </style>
</template>;

// ── Freestyle::Usage::Argument (doc lens: table row; prop lens: nothing) ──
export interface UsageArgumentSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    type?: string;
    typeLabel?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export class UsageArgument extends Component<UsageArgumentSignature> {
  get isDoc() {
    return (this.args.mode ?? 'doc') === 'doc';
  }
  get typeLabel() {
    return this.args.typeLabel || this.args.type;
  }
  get shouldRenderDefaultValue() {
    return isPresent(this.args.defaultValue);
  }
  get defaultText() {
    return String(this.args.defaultValue);
  }
  // yields print as {{name}}, css vars bare (names carry --), args as @name
  get sigilPre() {
    if (this.args.type === 'Yield') return '{{';
    if (this.args.type === 'CSS' || this.args.typeLabel === 'CSS') return '';
    return '@';
  }
  get sigilPost() {
    return this.args.type === 'Yield' ? '}}' : '';
  }
  <template>
    {{#if this.isDoc}}
      <tr class='FreestyleUsageArgument'>
        <td class='FreestyleUsageArgument-name'>
          <span class='u-sig'>{{this.sigilPre}}</span>{{#if @name}}{{@name}}{{/if}}<span
            class='u-sig'
          >{{this.sigilPost}}</span>
          {{#if @required}}<span class='u-req' title='Required'>*</span>{{/if}}
        </td>
        <td class='FreestyleUsageArgument-type'>{{this.typeLabel}}</td>
        <td class='FreestyleUsageArgument-description'>{{@description}}</td>
        <td class='FreestyleUsageArgument-default'>
          {{#if this.shouldRenderDefaultValue}}
            {{this.defaultText}}
          {{else}}
            <span class='u-none'>—</span>
          {{/if}}
        </td>
      </tr>
    {{/if}}
    <style scoped>
      .FreestyleUsageArgument-name {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        white-space: nowrap;
        width: 1%;
      }
      .u-sig {
        color: var(--ink-3, var(--boxel-400));
      }
      .u-req {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .FreestyleUsageArgument-type {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        white-space: nowrap;
        width: 1%;
        text-transform: lowercase;
      }
      .FreestyleUsageArgument-description {
        color: var(--foreground);
        max-width: 520px;
      }
      .FreestyleUsageArgument-default {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        text-align: right;
        white-space: nowrap;
        width: 1%;
      }
      .u-none {
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}

// ── Freestyle::Usage::String ─────────────────────────────────────────────
export interface UsageStringSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: string | null;
    options?: string[];
    onInput?: (value: string) => void;
  };
  Element: HTMLElement;
}

export class UsageString extends Component<UsageStringSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get selectOptions() {
    return (this.args.options ?? []).map((v) => ({ value: v, label: v }));
  }
  get valueStr() {
    return this.args.value ?? undefined;
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  callOnInput = (v: string) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            {{#if @options}}
              <Select
                @options={{this.selectOptions}}
                @value={{this.valueStr}}
                @onValueChange={{this.callOnInput}}
              />
            {{else}}
              <Input
                @value={{this.valueStr}}
                @onInput={{this.callOnInput}}
                aria-label={{@name}}
              />
            {{/if}}
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='String'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}

// ── Freestyle::Usage::Bool ───────────────────────────────────────────────
export interface UsageBoolSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: boolean;
    onInput?: (value: boolean) => void;
  };
  Element: HTMLElement;
}

export class UsageBool extends Component<UsageBoolSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  callOnInput = (v: boolean) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            <Switch
              @checked={{@value}}
              @onCheckedChange={{this.callOnInput}}
              aria-label={{@name}}
            />
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Bool'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}

// ── Freestyle::Usage::Number ─────────────────────────────────────────────
export interface UsageNumberSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: number | null;
    min?: number;
    max?: number;
    step?: number;
    onInput?: (value: number | null) => void;
  };
  Element: HTMLElement;
}

export class UsageNumber extends Component<UsageNumberSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get shouldRenderRangeInput() {
    return isPresent(this.args.min) && isPresent(this.args.max);
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  get numValue() {
    return this.args.value ?? undefined;
  }
  get textValue() {
    return this.args.value == null ? undefined : String(this.args.value);
  }
  onSlide = (v: number) => {
    this.args.onInput?.(v);
  };
  onText = (v: string) => {
    this.args.onInput?.(v ? parseFloat(v) : null);
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            {{#if this.shouldRenderRangeInput}}
              <span class='numrange'>
                <Slider
                  @value={{this.numValue}}
                  @min={{@min}}
                  @max={{@max}}
                  @step={{@step}}
                  @label={{@name}}
                  @onValueChange={{this.onSlide}}
                />
                <span class='numrange-readout'>{{@value}}</span>
              </span>
            {{else}}
              <Input
                @type='number'
                @value={{this.textValue}}
                @onInput={{this.onText}}
                aria-label={{@name}}
              />
            {{/if}}
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Number'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
    <style scoped>
      .numrange {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .numrange > :first-child {
        flex: 1;
      }
      .numrange-readout {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        min-width: 30px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

// ── Freestyle::Usage::Array ──────────────────────────────────────────────
export interface UsageArraySignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: string[];
    onInput?: (value: string[]) => void;
  };
  Element: HTMLElement;
}

export class UsageArray extends Component<UsageArraySignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get text() {
    return (this.args.value ?? []).join(', ');
  }
  get hasControl() {
    return typeof this.args.onInput === 'function';
  }
  get readOnlyValue() {
    return readOnlyText(this.args.value ?? this.args.defaultValue);
  }
  callOnInput = (raw: string) => {
    this.args.onInput?.(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  };
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{#if this.hasControl}}
            <Input
              @value={{this.text}}
              @onInput={{this.callOnInput}}
              aria-label={{@name}}
            />
          {{else}}
            <PropReadOnly @value={{this.readOnlyValue}} />
          {{/if}}
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Array'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}

// ── Freestyle::Usage::Object (read-only) ─────────────────────────────────
export interface UsageObjectSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
    value?: unknown;
  };
  Element: HTMLElement;
}

export class UsageObject extends Component<UsageObjectSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get json() {
    return stringify(this.args.value);
  }
  <template>
    {{#if this.isProp}}
      {{#unless @hideControls}}
        <PropRow @label={{@name}} @required={{@required}}>
          {{!-- Adopted 2026-08-13: this was a plain <pre> of the stringified
                value. JsonTree gives every Args.Object knob in the gallery
                collapsible nodes, type badges, copy-path and keyboard
                navigation — and an empty state instead of the literal text
                "undefined" for the call sites that pass no @value.
                The json getter is kept: it is the only caller of stringify.
                NOTE the long-form comment delimiters. A short {{! }} comment
                ends at its first closing pair, so a mustache inside one
                escapes into the template and orphans the next closing tag —
                local parse accepts it; the realm transpiler does not. --}}
          <JsonTree
            @value={{@value}}
            @label={{@name}}
            @hideToolbar={{true}}
            @pageSize={{25}}
            class='jsonviewer'
          />
        </PropRow>
      {{/unless}}
    {{else}}
      <UsageArgument
        @type='Object'
        @name={{@name}}
        @description={{@description}}
        @required={{@required}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
    <style scoped>
      /* JsonTree brings its own surface; the knob channel is all that is
         needed here. */
      .jsonviewer {
        --pretui-json-max-height: 120px;
        --pretui-json-indent: 12px;
        --pretui-json-row-height: 20px;
      }
    </style>
  </template>
}

// ── Action / Yield / Component presets (doc-only rows) ───────────────────
export interface UsagePresetSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export const UsageAction: TemplateOnlyComponent<UsagePresetSignature> =
  <template>
    <UsageArgument
      @mode={{@mode}}
      @type='Action'
      @name={{@name}}
      @description={{@description}}
      @required={{@required}}
      @defaultValue={{@defaultValue}}
    />
  </template>;

export const UsageYield: TemplateOnlyComponent<UsagePresetSignature> =
  <template>
    <UsageArgument
      @mode={{@mode}}
      @type='Yield'
      @name={{@name}}
      @description={{@description}}
      @required={{@required}}
      @defaultValue={{@defaultValue}}
    />
  </template>;

export const UsageComponentArg: TemplateOnlyComponent<UsagePresetSignature> =
  <template>
    <UsageArgument
      @mode={{@mode}}
      @type='Component'
      @name={{@name}}
      @description={{@description}}
      @required={{@required}}
      @defaultValue={{@defaultValue}}
    />
  </template>;

// ── Freestyle::Usage::BasicCssVariable ───────────────────────────────────
export interface UsageCssVariableSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    description?: string;
    defaultValue?: unknown;
    value?: string | null;
    onInput?: (value: string) => void;
  };
  Element: HTMLElement;
}

export class UsageCssVariable extends Component<UsageCssVariableSignature> {
  get isProp() {
    return this.args.mode === 'prop';
  }
  get valueStr() {
    return this.args.value ?? undefined;
  }
  get hasControl() {
    return this.args.onInput !== undefined;
  }
  callOnInput = (v: string) => {
    this.args.onInput?.(v);
  };
  <template>
    {{#if this.isProp}}
      {{#if this.hasControl}}
        <PropRow @label={{@name}}>
          <Input
            @value={{this.valueStr}}
            @onInput={{this.callOnInput}}
            aria-label={{@name}}
          />
        </PropRow>
      {{/if}}
    {{else}}
      <UsageArgument
        @typeLabel='CSS'
        @name={{@name}}
        @description={{@description}}
        @defaultValue={{@defaultValue}}
      />
    {{/if}}
  </template>
}

// ── FreestyleUsage (the page) ────────────────────────────────────────────
export interface FreestyleUsageSignature {
  Args: {
    name?: string;
    description?: string;
    slug?: string;
    source?: string;
    viewportMode?: 'fill' | 'narrow' | 'wide' | 'inline' | 'grid';
  };
  Blocks: {
    description: [];
    example: [];
    /* eslint-disable @typescript-eslint/no-explicit-any -- the yielded Args
       hash is any-typed exactly as in ember-freestyle's own signature */
    api: [
      {
        Action: any;
        Array: any;
        Base: any;
        Bool: any;
        Component: any;
        Number: any;
        Object: any;
        String: any;
        Yield: any;
      },
    ];
    cssVars: [{ Basic: any }];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
  Element: HTMLDivElement;
}

export const FreestyleUsage: TemplateOnlyComponent<FreestyleUsageSignature> =
  <template>
    <div class='FreestyleUsage' ...attributes>
      {{! identity lives in the page header (breadcrumb) — no h2 here; one
          compact description line, then straight to the artboard }}
      {{#if (has-block 'description')}}
        <p class='FreestyleUsage-description'>{{yield to='description'}}</p>
      {{else if @description}}
        <p class='FreestyleUsage-description'>{{@description}}</p>
      {{/if}}

      <div class='FreestyleUsage-stage'>
        <div class='FreestyleUsage-previewCol'>
          <div class='wb-panel'>
            <Viewport @defaultMode={{@viewportMode}} @label={{@name}}>
              {{yield to='example'}}
            </Viewport>
            {{#if @source}}
              <div class='wb-codestrip'>
                <code class='wb-code'>{{@source}}</code>
                <CopyButton
                  @text={{@source}}
                  @label='Copy usage'
                  @variant='ghost'
                />
              </div>
            {{/if}}
          </div>
        </div>
        {{#if (has-block 'api')}}
          <aside class='FreestyleUsage-props'>
            <h3 class='FreestyleUsage-sectionTitle'>Properties</h3>
            {{yield
              (hash
                Action=(component UsageAction mode='prop')
                Array=(component UsageArray mode='prop')
                Base=(component UsageArgument mode='prop')
                Bool=(component UsageBool mode='prop')
                Component=(component UsageComponentArg mode='prop')
                Number=(component UsageNumber mode='prop')
                Object=(component UsageObject mode='prop')
                String=(component UsageString mode='prop')
                Yield=(component UsageYield mode='prop')
              )
              to='api'
            }}
            {{#if (has-block 'cssVars')}}
              {{yield
                (hash Basic=(component UsageCssVariable mode='prop'))
                to='cssVars'
              }}
            {{/if}}
          </aside>
        {{/if}}
      </div>

      {{#if (has-block 'api')}}
        <div class='FreestyleUsage-api wb-panel'>
          <div class='wb-panel-h'>
            <h3 class='FreestyleUsage-sectionTitle wb-cap'>API</h3>
          </div>
          <Table>
            <:head>
              <tr>
                <th>Argument</th>
                <th>Type</th>
                <th>Description</th>
                <th class='wb-th-right'>Default</th>
              </tr>
            </:head>
            <:body>
              {{yield
                (hash
                  Action=(component UsageAction mode='doc')
                  Array=(component UsageArray mode='doc')
                  Base=(component UsageArgument mode='doc')
                  Bool=(component UsageBool mode='doc')
                  Component=(component UsageComponentArg mode='doc')
                  Number=(component UsageNumber mode='doc')
                  Object=(component UsageObject mode='doc')
                  String=(component UsageString mode='doc')
                  Yield=(component UsageYield mode='doc')
                )
                to='api'
              }}
            </:body>
          </Table>
        </div>
      {{/if}}

      {{#if (has-block 'cssVars')}}
        <div class='FreestyleUsage-api wb-panel'>
          <div class='wb-panel-h'>
            <h3 class='FreestyleUsage-sectionTitle wb-cap'>CSS Variables</h3>
          </div>
          <Table>
            <:head>
              <tr>
                <th>Variable</th>
                <th>Type</th>
                <th>Description</th>
                <th class='wb-th-right'>Default</th>
              </tr>
            </:head>
            <:body>
              {{yield
                (hash Basic=(component UsageCssVariable mode='doc'))
                to='cssVars'
              }}
            </:body>
          </Table>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .FreestyleUsage {
        display: grid;
        gap: var(--space-3, 8px);
        align-content: start;
        min-width: 0;
        max-width: 100%;
      }
      .FreestyleUsage-description {
        margin: 0;
        max-width: 78ch;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
        line-height: 1.5;
      }
      .FreestyleUsage-stage {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: var(--space-5, 14px);
        align-items: start;
      }
      @media (max-width: 900px) {
        .FreestyleUsage-stage {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .FreestyleUsage-previewCol {
        display: grid;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      /* workbench panel chrome: bordered card, header row, clipped body */
      .wb-panel {
        background: var(--card);
        border-radius: 6px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        overflow: hidden;
        min-width: 0;
      }
      .wb-panel-h {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 36px;
        padding: 8px var(--space-4, 11px);
        box-shadow: inset 0 -1px 0 var(--border);
      }
      h3.wb-cap {
        margin: 0;
      }
      .wb-th-right {
        text-align: right;
      }
      .wb-codestrip {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
        padding: 6px var(--space-4, 11px);
        box-shadow: inset 0 1px 0 var(--border);
        background: var(--card);
        overflow-x: auto;
      }
      .wb-code {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        white-space: pre;
        flex: 1;
      }
      .wb-codestrip > :last-child {
        flex: none;
        margin-left: auto;
      }
      .FreestyleUsage-props {
        background: var(--card);
        border-radius: 6px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        padding: var(--space-4, 11px) var(--space-5, 14px) var(--space-5, 14px);
        min-width: 0;
        align-self: start;
        position: sticky;
        top: 52px;
      }
      /* THE caps treatment — panel and group headers only */
      .FreestyleUsage-sectionTitle {
        margin: 0 0 var(--space-3, 8px);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .FreestyleUsage-api {
        min-width: 0;
      }
      .FreestyleUsage-source {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        background: var(--inset, var(--boxel-100));
        border-radius: var(--radius);
        box-shadow: inset 0 0 0 1px var(--border);
        padding: var(--space-4, 11px);
        overflow-x: auto;
      }
    </style>
  </template>;

export { ThemeFrame } from './components/theme-frame';
export type { ThemeFrameSignature } from './components/theme-frame';
