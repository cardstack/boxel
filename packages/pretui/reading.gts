// Pretui — reading territory: data display.
// Translated from pretui-design-system (components/reading + css/structure.css).
// Realm adaptation: StreamingText is timer-free — words reveal via CSS
// animation-delay stagger (the prerenderer blocks timers; reduced-motion
// snaps to the end state). The sr-only mirror carries the full text. Stat's
// headline number is likewise timer-free: it delegates to Odometer
// (reading-format), whose roll is one CSS animation keyed off the digit's
// from>to pair.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Delta } from './ink';
import { Odometer, formatNumber, toNumber } from './reading-format';
import type { FormatOptionBag } from './reading-format';

export interface ColumnSpec {
  key: string;
  label: string;
  num?: boolean;
  mono?: boolean;
  align?: 'left' | 'right';
  sortable?: boolean;
}
export type Row = Record<string, any>;
export interface SortSpec {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataGridSignature {
  Args: {
    columns: ColumnSpec[];
    rows: Row[];
    rowKey?: string;
    selectable?: boolean;
    defaultSort?: SortSpec;
    onSortChange?: (s: SortSpec | null) => void;
    onSelectedChange?: (keys: unknown[]) => void;
  };
  Blocks: { cell: [row: Row, column: ColumnSpec] };
  Element: HTMLDivElement;
}

// THE records table: mono eyebrow headers, zebra stripe, hover, selection.
export class DataGrid extends Component<DataGridSignature> {
  @tracked sort: SortSpec | null = this.args.defaultSort ?? null;
  @tracked selected: unknown[] = [];

  get rowKey() {
    return this.args.rowKey ?? 'id';
  }
  get selectedInRows(): unknown[] {
    let keys = new Set(this.args.rows.map((row) => row[this.rowKey]));
    return this.selected.filter((key) => keys.has(key));
  }
  get sorted(): Row[] {
    let s = this.sort;
    if (!s) {
      return this.args.rows;
    }
    let dir = s.dir === 'desc' ? -1 : 1;
    return [...this.args.rows].sort((a, b) => {
      let av = a[s.key];
      let bv = b[s.key];
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }
  get allOn() {
    return this.args.rows.length > 0 && this.selectedInRows.length === this.args.rows.length;
  }
  clickSort = (c: ColumnSpec) => {
    if (c.sortable === false) {
      return;
    }
    let s = this.sort;
    this.sort = !s || s.key !== c.key
      ? { key: c.key, dir: 'asc' }
      : s.dir === 'asc'
        ? { key: c.key, dir: 'desc' }
        : null;
    this.args.onSortChange?.(this.sort);
  };
  toggle = (key: unknown) => {
    let current = this.selectedInRows;
    this.selected = current.includes(key)
      ? current.filter((x) => x !== key)
      : [...current, key];
    this.args.onSelectedChange?.(this.selected);
  };
  toggleAll = () => {
    this.selected = this.allOn ? [] : this.args.rows.map((r) => r[this.rowKey]);
    this.args.onSelectedChange?.(this.selected);
  };
  sortMark = (c: ColumnSpec) => {
    let s = this.sort;
    if (!s || s.key !== c.key) {
      return '';
    }
    return s.dir === 'asc' ? ' ↑' : ' ↓';
  };
  sortState = (c: ColumnSpec) => {
    let s = this.sort;
    return s && s.key === c.key ? s.dir : undefined;
  };
  isSelected = (row: Row) => this.selectedInRows.includes(row[this.rowKey]);
  cellValue = (row: Row, c: ColumnSpec) => row[c.key];
  keyFor = (row: Row) => row[this.rowKey];

  <template>
    <div class='pretui-gridwrap' data-test-pretui-datagrid ...attributes>
      <table class='pretui-datagrid'>
        <thead>
          <tr>
            {{#if @selectable}}
              <th class='pretui-selcol'>
                <input
                  type='checkbox'
                  class='pretui-checkbox'
                  checked={{this.allOn}}
                  aria-label='Select all'
                  {{on 'change' this.toggleAll}}
                />
              </th>
            {{/if}}
            {{#each @columns as |c|}}
              <th
                data-sort={{this.sortState c}}
                data-align={{if c.align c.align 'left'}}
              >
                <button
                  type='button'
                  class='pretui-th-btn'
                  {{on 'click' (fn this.clickSort c)}}
                >{{c.label}}{{this.sortMark c}}</button>
              </th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each this.sorted key='@index' as |row|}}
            <tr data-state={{if (this.isSelected row) 'selected'}}>
              {{#if @selectable}}
                <td>
                  <input
                    type='checkbox'
                    class='pretui-checkbox'
                    checked={{this.isSelected row}}
                    aria-label='Select row'
                    {{on 'change' (fn this.toggle (this.keyFor row))}}
                  />
                </td>
              {{/if}}
              {{#each @columns as |c|}}
                <td
                  class='{{if c.num "pretui-num"}} {{if c.mono "pretui-mono"}}'
                  data-align={{if c.align c.align 'left'}}
                >
                  {{#if (has-block 'cell')}}
                    {{yield row c to='cell'}}
                  {{else}}
                    {{this.cellValue row c}}
                  {{/if}}
                </td>
              {{/each}}
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
    <style scoped>
      .pretui-gridwrap {
        overflow: auto;
        border-radius: inherit;
      }
      .pretui-datagrid {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--text-ui-md, 12.5px);
        background: var(--card);
      }
      .pretui-datagrid th {
        position: sticky;
        top: 0;
        z-index: 2;
        height: 30px;
        padding: 0 10px;
        text-align: left;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
        background: var(--inset, var(--boxel-100));
        box-shadow: inset 0 -1px 0 var(--line-strong, var(--boxel-400));
        white-space: nowrap;
        cursor: pointer;
        user-select: none;
      }
      .pretui-datagrid th[data-sort] {
        color: var(--foreground);
      }
      .pretui-th-btn {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
        color: inherit;
        cursor: pointer;
        white-space: inherit;
      }
      .pretui-datagrid td {
        height: 32px;
        padding: 0 10px;
        box-shadow: inset 0 -1px 0 var(--border);
        white-space: nowrap;
      }
      .pretui-datagrid th[data-align='right'],
      .pretui-datagrid td[data-align='right'] {
        text-align: right;
      }
      .pretui-datagrid tbody tr:nth-child(even) td {
        background: var(--stripe, var(--boxel-100));
      }
      .pretui-datagrid tbody tr:hover td {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-datagrid tbody tr[data-state='selected'] td {
        background: var(--pretui-selected, var(--boxel-100));
      }
      .pretui-num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .pretui-mono {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
      }
      .pretui-selcol {
        width: 32px;
      }
      .pretui-checkbox {
        appearance: none;
        width: 15px;
        height: 15px;
        margin: 0;
        border-radius: 5px;
        background: var(--pretui-control-rest, var(--field, var(--boxel-light)));
        box-shadow: 0 0 0 1px var(--pretui-control-border, var(--input));
        cursor: pointer;
        display: inline-grid;
        place-content: center;
      }
      .pretui-checkbox:checked {
        background: var(--primary);
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--primary) 70%, var(--border)),
          var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
      }
      .pretui-checkbox:checked::before {
        content: '';
        width: 9px;
        height: 9px;
        background: var(--primary-foreground);
        clip-path: polygon(14% 47%, 38% 70%, 86% 18%, 96% 30%, 39% 89%, 4% 58%);
      }
    </style>
  </template>
}

export interface KeyValueItem {
  key: string;
  value: string;
}
export interface KeyValueSignature {
  Args: { items: KeyValueItem[] };
  Blocks: { value: [item: KeyValueItem] };
  Element: HTMLDListElement;
}

export const KeyValue: TemplateOnlyComponent<KeyValueSignature> = <template>
  <dl class='pretui-kv' data-test-pretui-kv ...attributes>
    {{#each @items as |item|}}
      <dt>{{item.key}}</dt>
      <dd>{{#if (has-block 'value')}}{{yield item to='value'}}{{else}}{{item.value}}{{/if}}</dd>
    {{/each}}
  </dl>
  <style scoped>
    .pretui-kv {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: var(--space-6, 19px);
      row-gap: 7px;
      font-size: var(--text-ui-md, 12.5px);
      align-content: start;
      align-items: center;
      margin: 0;
    }
    .pretui-kv dt {
      color: var(--muted-foreground);
      font-size: var(--text-ui, 12px);
      line-height: 18px;
    }
    .pretui-kv dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</template>;

export interface StatSignature {
  Args: {
    /** the eyebrow above the number — a short noun phrase, set mono and uppercase */
    label: string;
    /**
     * The headline value. A number is formatted through Intl using the format
     * knobs below; a string is used verbatim, so a pre-formatted value
     * ('61%', '9 d', '$12,480') renders exactly as written and still rolls.
     */
    value: number | string;
    /** signed change since the comparison period, rendered as a `Delta` */
    delta?: number;
    /** custom text for the delta — passed straight to `Delta`'s own `@format` */
    deltaFormat?: (n: number) => string;
    /** small print beside the delta naming the comparison window ('vs spring') */
    hint?: string;
    /**
     * Roll the headline digits when the value changes (default true). Set
     * false for a value that is really a word, or for a headline that must
     * wrap — the digit track is an inline-flex row and does not break lines.
     */
    roll?: boolean;
    /** BCP-47 locale tag for number formatting; ignored when `@value` is a string */
    locale?: string;
    /** 'decimal' (default), 'currency', 'percent' or 'unit' */
    style?: 'decimal' | 'currency' | 'percent' | 'unit';
    /** ISO 4217 code for style='currency'; without it the style degrades to decimal */
    currency?: string;
    /** floor on fraction digits */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits */
    maximumFractionDigits?: number;
    /** grouping separators (default: the locale's own choice) */
    useGrouping?: boolean | 'always' | 'auto' | 'min2';
    /** any Intl.NumberFormat option not named above; named knobs win over it */
    options?: FormatOptionBag;
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
    /**
     * Live-region politeness for the value a screen reader actually reads.
     * 'off' (default) because a KPI that rolls on every tick would otherwise
     * spam; 'polite' only where the value settles at human pace.
     */
    announce?: 'off' | 'polite' | 'assertive';
    /** roll duration in seconds (default 0.5) */
    duration?: number;
    /** CSS timing function for the roll (default a sprung cubic-bezier) */
    ease?: string;
    /** seconds of delay per digit so the carry cascades (default 0.03; 0 rolls together) */
    stagger?: number;
    /** which end the stagger counts from: 'right' (default, like a carry) or 'left' */
    staggerFrom?: 'right' | 'left';
    /**
     * Reserve this many digit columns of width up front. Nothing inside the
     * block moves when a value grows a column, but the block itself widens —
     * which shifts the next KPI in a row. Set it to the widest value the
     * metric can reach ('999' → '1,000' wants 5) and the row stops reflowing.
     * Unset (default) the box is content-sized.
     */
    minDigits?: number;
  };
  Element: HTMLDivElement;
}

// ── Stat — the KPI headline ──────────────────────────────────────────────
// Ported from the Tremor KPI card (big number, delta chip, comparison hint).
// Composes two kit primitives rather than re-cutting either: `Delta` (ink)
// for the signed change, and `Odometer` (reading-format) for the headline
// number — Law 5's canonical numeric mechanism, where each digit is a window
// over a 0–9 ring and takes the shortest path around it.
//
// Better than the inspiration:
//   - Tremor's KPI number is a static string; a metric that ticks swaps in
//     place and the reader has to diff two frames from memory. Here the
//     digits ROLL, which is exactly the state transition Law 5 says motion is
//     for. It costs nothing at rest: the first paint is identical to plain
//     text (Odometer has no previous value to travel from), and a value that
//     never changes never animates.
//   - The upstream takes a pre-formatted string only, so every caller writes
//     its own `Intl` call. `@value` here also accepts a raw number and the
//     format knobs ride through to Odometer, so the formatting lives in ONE
//     place for the whole kit. A string is still used verbatim, so '61%' and
//     '9 d' read exactly as written — and still roll, since Odometer rolls
//     the digit positions of any string.
//   - The label sits at the inline start of its own grid row, so a value that
//     grows a column ('999' → '1,000') extends to the inline END and nothing
//     inside the block shifts. What CAN shift is the block's own width, and
//     with it a sibling KPI in a row — `@minDigits` reserves the columns up
//     front so the row never reflows.
//
// Dropped from the Odometer surface deliberately: `@cellHeight`. Stat derives
// it from its own headline line-height (`--pretui-stat-line`) so the digit
// cells and the text line box are the same height; letting a caller set them
// apart is the one knob that CAN move the label.
export class Stat extends Component<StatSignature> {
  get hasDelta() {
    return this.args.delta !== undefined;
  }
  get deltaValue() {
    return this.args.delta ?? 0;
  }
  /** rolling is the default; @roll={{false}} falls back to plain text */
  get rolling() {
    return this.args.roll ?? true;
  }
  // One digit cell === one headline line box. Expressed against the same
  // custom property the CSS line-height reads, so a consumer that restyles
  // `--pretui-stat-line` moves both together and the baseline stays put.
  cellHeight = 'calc(var(--pretui-stat-line, 1.2) * 1em)';

  get valueStyle(): ReturnType<typeof htmlSafe> | undefined {
    let digits = this.args.minDigits;
    return digits && digits > 0
      ? htmlSafe(`--pretui-stat-min-digits: ${Math.trunc(digits)}`)
      : undefined;
  }

  // The non-rolling branch. Same `formatNumber` the Odometer path runs
  // through — the formatting is reused, not re-implemented, so the two
  // branches cannot print a value differently.
  get text(): string {
    let raw = this.args.value;
    if (typeof raw === 'string' && raw !== '') {
      return raw;
    }
    let n = toNumber(raw);
    if (n === undefined) {
      return this.args.placeholder ?? '—';
    }
    let a = this.args;
    return formatNumber(n, a.locale, {
      ...(a.options ?? {}),
      style: a.style,
      currency: a.currency,
      minimumFractionDigits: a.minimumFractionDigits,
      maximumFractionDigits: a.maximumFractionDigits,
      useGrouping: a.useGrouping,
    });
  }
  <template>
    <div class='pretui-stat' data-test-pretui-stat ...attributes>
      <span class='pretui-stat-label'>{{@label}}</span>
      <span
        class='pretui-stat-value'
        style={{this.valueStyle}}
      >{{#if this.rolling}}<Odometer
            @value={{@value}}
            @locale={{@locale}}
            @style={{@style}}
            @currency={{@currency}}
            @minimumFractionDigits={{@minimumFractionDigits}}
            @maximumFractionDigits={{@maximumFractionDigits}}
            @useGrouping={{@useGrouping}}
            @options={{@options}}
            @placeholder={{@placeholder}}
            @announce={{@announce}}
            @duration={{@duration}}
            @ease={{@ease}}
            @stagger={{@stagger}}
            @staggerFrom={{@staggerFrom}}
            @cellHeight={{this.cellHeight}}
          />{{else}}{{this.text}}{{/if}}</span>
      <span class='pretui-stat-foot'>
        {{#if this.hasDelta}}<Delta @value={{this.deltaValue}} @format={{@deltaFormat}} />{{/if}}
        {{#if @hint}}<span class='pretui-stat-hint'>{{@hint}}</span>{{/if}}
      </span>
    </div>
    <style scoped>
      .pretui-stat {
        display: grid;
        gap: 3px;
        align-content: start;
      }
      .pretui-stat-label {
        font-family: var(--font-mono);
        font-size: 10.5px;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-stat-value {
        font-size: var(--text-stat, 25px);
        font-weight: 600;
        letter-spacing: var(--track-heading, -0.02em);
        font-variant-numeric: tabular-nums;
        line-height: var(--pretui-stat-line, 1.2);
        /* Column reservation (@minDigits): one tabular digit advance is 1ch
           plus the tracking that follows it. Unset it resolves to 0 and the
           box is content-sized exactly as before. */
        min-width: calc(
          var(--pretui-stat-min-digits, 0) *
            (1ch + var(--track-heading, -0.02em))
        );
      }
      .pretui-stat-foot {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .pretui-stat-hint {
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}

export interface ProseSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// The typographic reading surface — styles inline code per Law 3's quieter cousin.
export const Prose: TemplateOnlyComponent<ProseSignature> = <template>
  <div class='pretui-prose' data-test-pretui-prose ...attributes>{{yield}}</div>
  <style scoped>
    .pretui-prose {
      max-width: 62ch;
      line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
    }
    .pretui-prose :deep(p) {
      margin: 0 0 var(--space-4, 11px);
    }
    .pretui-prose :deep(code) {
      font-family: var(--font-mono);
      font-size: 0.92em;
      background: var(--inset, var(--boxel-100));
      padding: 1px 5px;
      border-radius: 5px;
      box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
    }
  </style>
</template>;

export interface StreamingTextSignature {
  Args: {
    text: string;
    // words per second for the CSS stagger (Law 7: seconds-based, unitless rates)
    rate?: number;
    startDelay?: number;
    cursor?: boolean;
  };
  Element: HTMLSpanElement;
}

// Timer-free stream: each word carries animation-delay = start + i/rate.
// Reduced motion / prerender shows the end state; sr-only mirror has full text.
export class StreamingText extends Component<StreamingTextSignature> {
  get words(): { word: string; style: ReturnType<typeof htmlSafe> }[] {
    let rate = this.args.rate ?? 18;
    let start = this.args.startDelay ?? 0;
    return this.args.text.split(' ').map((word, i) => ({
      word,
      style: htmlSafe(`animation-delay: ${(start + i / rate).toFixed(3)}s`),
    }));
  }
  <template>
    <span class='pretui-stream' data-test-pretui-streaming-text ...attributes>
      <span aria-hidden='true'>
        {{#each this.words as |w|}}<span class='pretui-stream-word' style={{w.style}}>{{w.word}} </span>{{/each}}
      </span>
      <span class='pretui-sr'>{{@text}}</span>
      {{#if @cursor}}<span class='pretui-stream-cursor' aria-hidden='true'></span>{{/if}}
    </span>
    <style scoped>
      @keyframes pretui-stream-in {
        from {
          opacity: 0;
          filter: blur(4px);
        }
        to {
          opacity: 1;
          filter: blur(0);
        }
      }
      .pretui-stream-word {
        display: inline;
        opacity: 0;
        animation: pretui-stream-in 420ms cubic-bezier(0.22, 0.61, 0.25, 1) both;
      }
      .pretui-stream-cursor {
        display: inline-block;
        width: 2px;
        height: 0.9em;
        vertical-align: -0.1em;
        border-radius: 1px;
        background: currentColor;
        margin-left: 1px;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-stream-word {
          animation: none;
          opacity: 1;
        }
      }
    </style>
  </template>
}

// Table — the DataGrid shell as a yieldable primitive (added for the
// freestyle dogfood pass: composite tables that need custom cell content —
// like the Component API table — wear the same cloth as DataGrid without its
// data-driven machinery). Yielded rows/cells are styled via :deep().
export interface TableSignature {
  Blocks: { head: []; body: [] };
  Element: HTMLDivElement;
}

export const Table: TemplateOnlyComponent<TableSignature> = <template>
  <div class='pretui-tablewrap' data-test-pretui-table ...attributes>
    <table class='pretui-table'>
      <thead>{{yield to='head'}}</thead>
      <tbody>{{yield to='body'}}</tbody>
    </table>
  </div>
  <style scoped>
    .pretui-tablewrap {
      overflow-x: auto;
      min-width: 0;
      max-width: 100%;
      border-radius: var(--radius);
      box-shadow: 0 0 0 1px var(--border);
      background: var(--card);
    }
    .pretui-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-ui-md, 12.5px);
      background: var(--card);
    }
    .pretui-table :deep(th) {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 30px;
      padding: 0 10px;
      text-align: left;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: var(--track-eyebrow, 0.08em);
      text-transform: uppercase;
      color: var(--muted-foreground);
      background: var(--inset, var(--boxel-100));
      box-shadow: inset 0 -1px 0 var(--line-strong, var(--boxel-400));
      white-space: nowrap;
    }
    .pretui-table :deep(td) {
      padding: 8px 10px;
      vertical-align: top;
      box-shadow: inset 0 -1px 0 var(--border);
    }
    .pretui-table :deep(tbody tr:nth-child(even) td) {
      background: var(--stripe, var(--boxel-100));
    }
    .pretui-table :deep(tbody tr:hover td) {
      background: var(--hover, var(--boxel-100));
    }
  </style>
</template>;
