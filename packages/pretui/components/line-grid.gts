// Pretui — LineGrid: an editable grid of line items — journal lines, invoice lines, allocations — with totals and a balance check.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { eq } from '../helpers';
import { AmountInput } from './amount-input';
import { Combobox, type ComboboxOption } from './combobox';
import { Input } from './input';
import { Button } from './button';
import { FormatNumber } from './format-number';
import { formatNumber } from '../internal/reading-format';
import { StatusChip } from './status-chip';

// ── LineGrid ← the bookkeeper's entry grid ──────────────────────────────
// The rows of an entry being written: an account, a debit, a credit, a memo; or a product, a
// quantity, a price. Every accounting, invoicing and expense app hand-builds this grid, and each
// gets the same things wrong: amounts typed as cents or parsed from strings, a debit and a credit
// both filled on one line, totals that drift from the rows, and a keyboard that has to leave the
// grid to add a line.
//
// Better than the inspiration (QuickBooks' and Xero's journal grids, and spreadsheet rows):
// - it is controlled and reports one cell at a time (`@onChange(index, key, value)`), so a caller
//   binds it straight to stored fields and nothing is held in a draft (Law 2: one input, the
//   caller's data; the grid derives totals and balance);
// - amounts are stored in minor units (cents) and typed in major units, by the kit's AmountInput,
//   with its locale-aware separators and its parse-on-every-keystroke; a grid shows no unit per
//   cell (the totals carry the currency), so a line stays one control high;
// - a column can pair with another (`pairsWith`): typing a debit clears that line's credit, the
//   accountant's one-sided-line rule, enforced where it is typed;
// - totals and the balance check are derived, live, and announced politely, never painted in
//   colour alone (Law 8): "Out of balance by $12.00" is words in a status chip;
// - Enter moves down the column and, on the last line, adds the next one; Shift+Enter moves up;
// - anything a caller might show differently is a slot: `<:footer>` gets the totals and balance (Law 7).

/** How a column is edited. */
export type LineGridColumnKind =
  | 'text'
  | 'code'
  | 'amount'
  | 'number'
  | 'choice';

export interface LineGridColumn {
  /** the key of this column's value in each row */
  key: string;
  /** the column header, and the cell's accessible name with the row's ("Line 2, Debit") */
  label: string;
  /** 'text' (default), 'code' (mono, Law 3), 'amount' (money), 'number', or 'choice' (a Combobox over @options) */
  kind?: LineGridColumnKind;
  /** choice: the candidates. With none, the column falls back to a mono text box. */
  options?: ComboboxOption[];
  /** amount and number: the stored value is in units of 10^-scale; amounts default to 2 (cents) */
  scale?: number;
  /** amount and number: typing a non-zero value here clears this column on the same row (a debit clears the credit) */
  pairsWith?: string;
  /** amount and number: sum the column in the footer */
  total?: boolean;
  /** an empty cell in a started row is invalid */
  required?: boolean;
  /** a CSS length for the column */
  width?: string;
  /** ghost text in an empty text cell */
  placeholder?: string;
}

export type LineGridRow = Record<string, unknown>;

export interface LineGridState {
  /** each total column's sum, in its stored units */
  totals: Record<string, number>;
  /** whether the @balance pair sums equal (true when there is no pair) */
  balanced: boolean;
  /** the @balance pair's first sum less its second */
  difference: number;
}

export interface LineGridSignature {
  Args: {
    /** the columns, in order */
    columns: LineGridColumn[];
    /** the lines, values in their stored units. The grid never changes them; it reports. */
    rows: LineGridRow[];
    /** the grid's accessible name, e.g. 'Journal lines' */
    label: string;
    /** one cell changed: the row's index, the column key and the value in stored units (undefined when cleared) */
    onChange: (index: number, key: string, value: unknown) => void;
    /** add a blank line; without it the grid has no Add button and Enter on the last line stops */
    onAdd?: () => void;
    /** remove the line at index; without it lines can't be removed */
    onRemove?: (index: number) => void;
    /** two amount column keys whose sums must be equal: the footer shows Balanced or Out of balance by … */
    balance?: [string, string];
    /** ISO 4217 code for amount columns (default 'USD') */
    currency?: string;
    /** BCP-47 locale; omit for the runtime default */
    locale?: string;
    /** this many leading lines can't be removed (default 0) */
    minRows?: number;
    /** the Add button's label (default 'Add line') */
    addLabel?: string;
    /** every control dimmed and inert */
    disabled?: boolean;
  };
  Blocks: {
    /** replaces the footer's balance status; receives the totals, whether it balances, and the difference */
    footer: [state: LineGridState];
  };
  Element: HTMLDivElement;
}

const NUMERIC = new Set<LineGridColumnKind>(['amount', 'number']);
const filled = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && v !== 0;
const toNumber = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;

// Focus follows the grid: a cell asks to be focused once it renders (after Enter, or after a line is added).
const focusOnce = modifier((el: HTMLElement, [wanted]: [boolean]) => {
  if (!wanted) return;
  let target = el.querySelector<HTMLElement>(
    'input, [role="combobox"], button',
  );
  target?.focus();
});

export class LineGrid extends Component<LineGridSignature> {
  @tracked focusAt: { row: number; col: string } | undefined;

  get columns(): LineGridColumn[] {
    return (this.args.columns ?? []).filter(Boolean);
  }
  get rows(): LineGridRow[] {
    return (this.args.rows ?? []).filter(Boolean);
  }
  get currency() {
    return this.args.currency ?? 'USD';
  }
  get minRows() {
    return this.args.minRows ?? 0;
  }
  get canRemove() {
    return !!this.args.onRemove && !this.args.disabled;
  }
  get canAdd() {
    return !!this.args.onAdd && !this.args.disabled;
  }
  get hasTotals() {
    return this.columns.some((c) => c.total) || !!this.args.balance;
  }
  kindOf = (c: LineGridColumn): LineGridColumnKind => c.kind ?? 'text';
  scaleOf = (c: LineGridColumn) =>
    c.scale ?? (this.kindOf(c) === 'amount' ? 2 : 0);
  colStyle = (c: LineGridColumn) =>
    c.width ? htmlSafe(`width: ${c.width}`) : undefined;
  isChoice = (c: LineGridColumn) =>
    this.kindOf(c) === 'choice' && (c.options ?? []).length > 0;

  // ── values ──
  /** the number an AmountInput or decimal box shows: the stored value in major units */
  shown = (row: LineGridRow, c: LineGridColumn) => {
    let v = row[c.key];
    if (v === undefined || v === null || v === '') return null;
    let n = toNumber(v);
    return n === 0 ? null : n / 10 ** this.scaleOf(c);
  };
  text = (row: LineGridRow, c: LineGridColumn) => String(row[c.key] ?? '');
  started = (row: LineGridRow) => this.columns.some((c) => filled(row[c.key]));
  invalid = (row: LineGridRow, c: LineGridColumn) => {
    if (!this.started(row)) return false;
    if (c.required && !filled(row[c.key])) return true;
    // a one-sided line: both members of a pair filled is an error the grid can't produce, but a caller's data can
    return !!c.pairsWith && filled(row[c.key]) && filled(row[c.pairsWith]);
  };
  cellLabel = (index: number, c: LineGridColumn) =>
    `Line ${index + 1}, ${c.label}`;
  removeLabel = (index: number) => `Remove line ${index + 1}`;
  removable = (index: number) => this.canRemove && index >= this.minRows;
  wantsFocus = (index: number, c: LineGridColumn) =>
    this.focusAt?.row === index && this.focusAt?.col === c.key;

  get state(): LineGridState {
    let totals: Record<string, number> = {};
    let sum = (key: string) =>
      this.rows.reduce((n, r) => n + toNumber(r[key]), 0);
    for (let c of this.columns)
      if (c.total || this.args.balance?.includes(c.key))
        totals[c.key] = sum(c.key);
    let [a, b] = this.args.balance ?? [];
    let difference = a && b ? (totals[a] ?? 0) - (totals[b] ?? 0) : 0;
    return { totals, balanced: difference === 0, difference };
  }
  get totalCells() {
    let state = this.state;
    return this.columns.map((c, i) => ({
      key: c.key,
      first: i === 0,
      numeric: NUMERIC.has(this.kindOf(c)),
      shown: c.key in state.totals,
      major: (state.totals[c.key] ?? 0) / 10 ** this.scaleOf(c),
      amount: this.kindOf(c) === 'amount',
    }));
  }
  // The balance pair shares a scale; the difference is read in the first column's.
  get balanceScale() {
    let key = this.args.balance?.[0];
    let c = this.columns.find((col) => col.key === key);
    return c ? this.scaleOf(c) : 2;
  }
  get balanceText() {
    let s = this.state;
    if (!this.args.balance) return '';
    if (s.balanced) return 'Balanced';
    let gap = formatNumber(
      Math.abs(s.difference) / 10 ** this.balanceScale,
      this.args.locale,
      { style: 'currency', currency: this.currency },
    );
    return `Out of balance by ${gap}`;
  }

  // ── changes: one cell at a time, in stored units ──
  setAmount = (index: number, c: LineGridColumn, value: number | undefined) => {
    let stored =
      value === undefined || value === null || Number.isNaN(value)
        ? undefined
        : Math.round(value * 10 ** this.scaleOf(c));
    this.args.onChange(index, c.key, stored);
    if (c.pairsWith && stored && filled(this.rows[index]?.[c.pairsWith]))
      this.args.onChange(index, c.pairsWith, 0);
  };
  setText = (index: number, c: LineGridColumn, value: string) =>
    this.args.onChange(index, c.key, value === '' ? undefined : value);
  setChoice = (index: number, c: LineGridColumn, value: string) =>
    this.args.onChange(index, c.key, value === '' ? undefined : value);
  remove = (index: number) => this.args.onRemove?.(index);
  add = () => {
    if (!this.canAdd) return;
    let added = this.rows.length;
    this.args.onAdd!();
    let first = this.columns[0];
    if (first) this.focusAt = { row: added, col: first.key };
  };

  // Enter walks down a column (adding a line at the bottom); Shift+Enter walks up. An open
  // listbox keeps Enter for itself: it prevents the default, and that event is left alone.
  keydown = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing)
      return;
    let cell = (event.target as HTMLElement)?.closest<HTMLElement>(
      '[data-line-cell]',
    );
    if (!cell) return;
    let row = Number(cell.dataset['row']),
      col = cell.dataset['col'] ?? '';
    let next = event.shiftKey ? row - 1 : row + 1;
    if (next < 0) return;
    event.preventDefault();
    if (next >= this.rows.length) {
      if (!this.canAdd) return;
      this.args.onAdd!();
    }
    this.focusAt = { row: next, col };
  };

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <div
      class='pretui-linegrid'
      data-test-pretui-line-grid
      {{on 'keydown' this.keydown}}
      ...attributes
    >
      <div
        class='pretui-linegrid-scroll'
        role='region'
        aria-label={{@label}}
        tabindex='-1'
      >
        <table class='pretui-linegrid-table' aria-label={{@label}}>
          <colgroup>
            {{#each this.columns as |c|}}<col
                style={{this.colStyle c}}
              />{{/each}}
            {{#if this.canRemove}}<col
                class='pretui-linegrid-col-remove'
              />{{/if}}
          </colgroup>
          <thead>
            <tr>
              {{#each this.columns as |c|}}<th
                  scope='col'
                  data-kind={{this.kindOf c}}
                >{{c.label}}</th>{{/each}}
              {{#if this.canRemove}}<th scope='col'><span
                    class='pretui-linegrid-sr'
                  >Remove</span></th>{{/if}}
            </tr>
          </thead>
          <tbody>
            {{#each this.rows key='@index' as |row index|}}
              <tr data-line={{index}}>
                {{#each this.columns as |c|}}
                  <td
                    data-line-cell
                    data-row={{index}}
                    data-col={{c.key}}
                    data-kind={{this.kindOf c}}
                    {{focusOnce (this.wantsFocus index c)}}
                  >
                    {{#if (eq (this.kindOf c) 'amount')}}
                      <AmountInput
                        @value={{this.shown row c}}
                        @precision={{this.scaleOf c}}
                        @locale={{@locale}}
                        @affix='never'
                        @quiet={{true}}
                        @label={{this.cellLabel index c}}
                        @invalid={{this.invalid row c}}
                        @disabled={{@disabled}}
                        @onChange={{fn this.setAmount index c}}
                      />
                    {{else if (eq (this.kindOf c) 'number')}}
                      <AmountInput
                        @value={{this.shown row c}}
                        @precision={{this.scaleOf c}}
                        @locale={{@locale}}
                        @affix='never'
                        @quiet={{true}}
                        @label={{this.cellLabel index c}}
                        @invalid={{this.invalid row c}}
                        @disabled={{@disabled}}
                        @onChange={{fn this.setAmount index c}}
                      />
                    {{else if (this.isChoice c)}}
                      <Combobox
                        @options={{c.options}}
                        @value={{this.text row c}}
                        @label={{this.cellLabel index c}}
                        @placeholder={{c.placeholder}}
                        @invalid={{this.invalid row c}}
                        @disabled={{@disabled}}
                        @onValueChange={{fn this.setChoice index c}}
                      />
                    {{else}}
                      <Input
                        @value={{this.text row c}}
                        @placeholder={{c.placeholder}}
                        @invalid={{this.invalid row c}}
                        @disabled={{@disabled}}
                        @onInput={{fn this.setText index c}}
                        aria-label={{this.cellLabel index c}}
                      />
                    {{/if}}
                  </td>
                {{/each}}
                {{#if this.canRemove}}
                  <td class='pretui-linegrid-remove'>
                    {{#if (this.removable index)}}<Button
                        @appearance='plain'
                        @tone='neutral'
                        @size='xs'
                        aria-label={{this.removeLabel index}}
                        {{on 'click' (fn this.remove index)}}
                      >×</Button>{{/if}}
                  </td>
                {{/if}}
              </tr>
            {{/each}}
          </tbody>
          {{#if this.hasTotals}}
            <tfoot>
              <tr>
                {{#each this.totalCells as |t|}}
                  {{#if t.first}}
                    <th scope='row' data-kind='text'>Total</th>
                  {{else if t.shown}}
                    <td data-kind='amount'>{{#if t.amount}}<FormatNumber
                          @value={{t.major}}
                          @style='currency'
                          @currency={{this.currency}}
                          @locale={{@locale}}
                        />{{else}}<FormatNumber
                          @value={{t.major}}
                          @locale={{@locale}}
                        />{{/if}}</td>
                  {{else}}
                    <td></td>
                  {{/if}}
                {{/each}}
                {{#if this.canRemove}}<td></td>{{/if}}
              </tr>
            </tfoot>
          {{/if}}
        </table>
      </div>
      <div class='pretui-linegrid-foot'>
        {{#if this.canAdd}}<Button
            @appearance='outlined'
            @tone='neutral'
            @size='s'
            {{on 'click' this.add}}
          >{{if @addLabel @addLabel 'Add line'}}</Button>{{/if}}
        <span class='pretui-linegrid-status' role='status' aria-live='polite'>
          {{#if (has-block 'footer')}}
            {{yield this.state to='footer'}}
          {{else if @balance}}
            <StatusChip
              @value={{this.balanceText}}
              @tone={{if this.state.balanced 'success' 'danger'}}
            />
          {{/if}}
        </span>
      </div>
    </div>
    <style scoped>
      @layer PretComponent, PretComposite;
      @layer PretComponent {
        .pretui-linegrid {
          display: grid;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        /* Law 1c: the frame paints inward. */
        .pretui-linegrid-scroll {
          overflow-x: auto;
          border-radius: var(--boxel-border-radius);
          box-shadow: inset 0 0 0 1px var(--border);
          background-color: var(--card);
          color: var(--card-foreground);
        }
        .pretui-linegrid-table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--boxel-font-size-sm);
        }
        thead th {
          height: 1.875rem;
          padding: 0 var(--boxel-sp-xs);
          text-align: start;
          font-family: var(--font-mono);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
          text-transform: uppercase;
          white-space: nowrap;
          background-color: var(--inset);
          color: var(--foreground);
          box-shadow: inset 0 -1px 0 var(--border-strong);
        }
        thead th[data-kind='amount'],
        thead th[data-kind='number'] {
          text-align: end;
        }
        tbody td {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-3xs);
          vertical-align: middle;
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .pretui-linegrid-col-remove {
          width: 2.25rem;
        }
        .pretui-linegrid-remove {
          text-align: center;
        }
        /* Totals: a rule over the figures, weight on the row. Law 8: no colour carries them. */
        tfoot th,
        tfoot td {
          padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
          font-weight: 600;
          text-align: start;
        }
        tfoot td[data-kind='amount'] {
          text-align: end;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          box-shadow: inset 0 1px 0 var(--foreground);
        }
        .pretui-linegrid-foot {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .pretui-linegrid-status:empty {
          display: none;
        }
        .pretui-linegrid-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
      }
      /* Composite: the cell controls sit flush in the grid. Figures end-align, codes and account
         choices are mono (Law 3), and each control takes its cell's width. AmountInput and Input
         have no alignment or width argument, so this reaches in, in the
         layer the kit reserves for exactly that. */
      @layer PretComposite {
        td :deep(.pretui-amount),
        td :deep(input) {
          width: 100%;
          min-width: 0;
        }
        td[data-kind='amount'] :deep(input),
        td[data-kind='number'] :deep(input) {
          text-align: end;
          font-variant-numeric: tabular-nums;
        }
        td[data-kind='code'] :deep(input),
        td[data-kind='choice'] :deep(input) {
          font-family: var(--font-mono);
        }
      }
    </style>
  </template>
}
