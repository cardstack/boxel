// Pretui — StatementTable: figures in sections, with subtotals and totals, set the way an accountant sets them.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { eq } from '../helpers';
import { FormatNumber } from './format-number';
import { formatNumber, toNumber } from '../internal/reading-format';
import { Button } from './button';
import { EmptyState } from './empty-state';

// ── StatementTable ← the accountant's schedule ──────────────────────────
// A profit and loss, a trial balance, an aging, a budget against actuals: rows of figures in
// sections, each section closed by a subtotal and the whole by a total. Table is the cloth with
// no opinion about figures; DataTable is a record listing with sorting and selection. Neither
// knows that a total is ruled above and double-ruled below, that a negative balance is set in
// parentheses, or that money is held in cents. This does.
//
// Better than the inspiration (a spreadsheet's accounting format, and the hand-set statement tables
// every finance app writes for itself):
// - the caller hands over numbers, never formatted strings, so columns stay figures: the kit's
//   FormatNumber sets them, with the accounting sign, and a screen reader hears "minus" where the eye
//   sees parentheses (Law 8: the meaning survives without the typography);
// - a row says what it *is* (line, heading, subtotal, total), not how it looks; the rules, weight
//   and indentation follow from the role, so every statement in an app reads the same (Law 2);
// - totals are marked by weight and rules, never by colour, and never by a rule down the inline
//   start (Laws 8 and 12);
// - anything a caller might want to set differently is a slot: `<:cell>` for a column of kind
//   'custom', `<:caption>`, `<:empty>` (Law 7);
// - `data` puts hooks on each row for tests and automation, so a statement can be checked
//   figure by figure without scraping its formatted text;
// - a row can carry `children` (an account's months, its sub-accounts, its postings) behind a real
//   disclosure button, so a statement opens where it is read instead of sending the reader away.

/** How a column's values are set. */
export type StatementColumnKind =
  | 'text'
  | 'code'
  | 'amount'
  | 'number'
  | 'percent'
  | 'quantity'
  | 'custom';

export interface StatementColumn {
  /** the key of this column's value in each row's `cells` */
  key: string;
  /** the column header */
  label: string;
  /** 'text' (default), 'code' (mono, Law 3), 'amount' (money), 'number', 'percent', 'quantity', or 'custom' (rendered by the `<:cell>` block) */
  kind?: StatementColumnKind;
  /** the value is held in units of 10^-scale: amounts default to 2 (cents), percents to 0 (a fraction, 0.42), everything else to 0. 4 reads a percent held in basis points. */
  scale?: number;
  /** amount: 'balance' (default) marks a negative with the table's @negative style; 'change' always shows the sign (+$120.00, −$80.00), for variances and deltas */
  sign?: 'balance' | 'change';
  /** amount: drop the cents */
  whole?: boolean;
  /** fraction digits for number, percent and quantity (defaults 0, 1 and 3) */
  digits?: number;
  /** 'secondary' folds the column away when the table is narrower than 40rem */
  priority?: 'primary' | 'secondary';
  /** a CSS length for the column, e.g. '6rem' */
  width?: string;
}

/** What a row is. The role decides its rules, weight and header semantics. */
export type StatementRowRole = 'line' | 'heading' | 'subtotal' | 'total';

export interface StatementRow {
  /** a stable key for the row (an account number, a customer id, 'total') */
  key: string;
  /** 'line' (default), 'heading' (a section title across the table), 'subtotal' or 'total' */
  role?: StatementRowRole;
  /** indentation level of the row's first cell, 0–3 (default 0) */
  depth?: number;
  /** the row's values, by column key. Amounts are numbers in the column's scale; a missing value leaves the cell blank. A heading row reads its title from its first column's cell. */
  cells: Record<string, unknown>;
  /** `data-*` hooks set on the row: `{ row: true, dr: 1200 }` → `data-row="" data-dr="1200"`; camelCase keys become kebab-case; null, undefined and false are left off */
  data?: Record<string, string | number | boolean | null | undefined>;
  /** rows shown under this one when it is expanded (an account's months, sub-accounts, postings); they indent one level deeper unless they set their own depth */
  children?: StatementRow[];
}

export interface StatementTableSignature {
  Args: {
    /** the columns, in order */
    columns: StatementColumn[];
    /** the rows, in order: lines, headings, subtotals and totals as the statement reads */
    rows: StatementRow[];
    /** the table's name, rendered as a real `<caption>` */
    caption?: string;
    /** the name when it is nowhere on screen; names the table and its scroll region */
    label?: string;
    /** id of an on-screen heading that names the table */
    labelledBy?: string;
    /** ISO 4217 currency for 'amount' columns (default 'USD') */
    currency?: string;
    /** BCP-47 locale; omit for the runtime default */
    locale?: string;
    /** how a negative balance is set: 'parentheses' (default, the accounting sign) or 'minus' */
    negative?: 'parentheses' | 'minus';
    /** how a zero amount is set: 'blank' (default, the statement convention), 'dash' or 'show' */
    zero?: 'blank' | 'dash' | 'show';
    /** 'regular' (default) or 'compact' */
    density?: 'regular' | 'compact';
    /** false drops the frame, for a table seated in a panel that already draws one (default true) */
    framed?: boolean;
    /** makes each line's select column a link-styled button; called with the row */
    onRowSelect?: (row: StatementRow) => void;
    /** the column whose cell carries the drill-in button (default: the first column) */
    selectColumn?: string;
    /** the empty state's title (default 'Nothing to report') */
    emptyTitle?: string;
    /** the empty state's message */
    emptyMessage?: string;
    /** the keys of the expanded rows, controlled (a child's key is `parentKey/childKey`) */
    expanded?: string[];
    /** the expanded rows to start with, uncontrolled */
    defaultExpanded?: string[];
    /** called with the new set of expanded keys when a row is opened or closed */
    onExpandedChange?: (keys: string[]) => void;
    /** the disclosure button's name for a row (default: 'Show the detail of <first column>') */
    expandLabel?: (row: StatementRow) => string;
  };
  Blocks: {
    caption: [];
    cell: [value: unknown, row: StatementRow, column: StatementColumn];
    empty: [];
  };
  Element: HTMLDivElement;
}

const NUMERIC = new Set<StatementColumnKind>([
  'amount',
  'number',
  'percent',
  'quantity',
]);
const DEFAULT_DIGITS: Partial<Record<StatementColumnKind, number>> = {
  number: 0,
  percent: 1,
  quantity: 3,
};

interface CellView {
  key: string;
  column: StatementColumn;
  kind: StatementColumnKind;
  value: unknown;
  numeric: boolean;
  header: boolean;
  select: boolean;
  text: string;
  /** the number FormatNumber is handed, in major units; undefined leaves the cell blank */
  major?: number;
  style?: 'currency' | 'percent' | 'decimal';
  currencySign?: 'standard' | 'accounting';
  signDisplay?: 'auto' | 'exceptZero';
  digits?: number;
  placeholder: string;
  /** a screen reader hears this instead of the parentheses */
  spoken?: string;
}
interface RowView {
  key: string;
  row: StatementRow;
  role: StatementRowRole;
  depth: string;
  title: string;
  cells: CellView[];
  /** the row has children: it carries a disclosure button */
  expandable: boolean;
  expanded: boolean;
  /** a child row: the key of the row it opens from */
  childOf?: string;
  /** the ids of this row's child rows, for aria-controls */
  controls?: string;
  id: string;
}

/** `data` → attributes on the row, kept in step as the row changes. */
const rowData = modifier((el: HTMLElement, [data]: [StatementRow['data']]) => {
  let names: string[] = [];
  for (let [k, v] of Object.entries(data ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    let name = `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    el.setAttribute(name, v === true ? '' : String(v));
    names.push(name);
  }
  return () => names.forEach((n) => el.removeAttribute(n));
});

// The disclosure button that opens a row's children. A real Button: focus ring, press and pointer
// sizing are the kit's; the state is aria-expanded, and the glyph follows it (Law 8: the state is
// also announced, never only drawn).
const Disclosure: TemplateOnlyComponent<{
  Args: {
    expanded: boolean;
    controls?: string;
    label: string;
    onToggle: () => void;
  };
}> = <template>
  <Button
    class='pretui-statement-toggle'
    @appearance='plain'
    @tone='neutral'
    @size='xs'
    aria-expanded={{if @expanded 'true' 'false'}}
    aria-controls={{@controls}}
    aria-label={{@label}}
    {{on 'click' @onToggle}}
  >
    <span aria-hidden='true'>{{if @expanded '▾' '▸'}}</span>
  </Button>
  <style scoped>
    @layer PretComponent, PretComposite;
    /* Composite: the toggle sits inline before the row's first value and takes no more room than its glyph. */
    @layer PretComposite {
      .pretui-statement-toggle {
        min-width: 1.25rem;
        min-height: 0;
        padding: 0;
        margin-inline-end: var(--boxel-sp-4xs);
        vertical-align: baseline;
      }
    }
  </style>
</template>;

// A cell's value: figures through FormatNumber, everything else as text.
const CellValue: TemplateOnlyComponent<{
  Args: { cell: CellView; currency: string; locale?: string };
}> = <template>
  {{#if @cell.numeric}}
    {{#if @cell.spoken}}
      <FormatNumber
        aria-hidden='true'
        @value={{@cell.major}}
        @style={{@cell.style}}
        @currency={{@currency}}
        @currencySign={{@cell.currencySign}}
        @signDisplay={{@cell.signDisplay}}
        @minimumFractionDigits={{@cell.digits}}
        @maximumFractionDigits={{@cell.digits}}
        @locale={{@locale}}
        @spoken='off'
        @placeholder={{@cell.placeholder}}
      />
      <span
        class='pretui-statement-sr'
        data-test-pretui-statement-sr
      >{{@cell.spoken}}</span>
    {{else}}
      <FormatNumber
        @value={{@cell.major}}
        @style={{@cell.style}}
        @currency={{@currency}}
        @currencySign={{@cell.currencySign}}
        @signDisplay={{@cell.signDisplay}}
        @minimumFractionDigits={{@cell.digits}}
        @maximumFractionDigits={{@cell.digits}}
        @locale={{@locale}}
        @placeholder={{@cell.placeholder}}
      />
    {{/if}}
  {{else}}
    {{@cell.text}}
  {{/if}}
  <style scoped>
    @layer PretComponent {
      .pretui-statement-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    }
  </style>
</template>;

// The content of one cell; the cell element itself (th or td) belongs to the row. A selectable
// cell wraps its value, formatted as usual, in a link-styled button.
const CellContent: TemplateOnlyComponent<{
  Args: {
    cell: CellView;
    currency: string;
    locale?: string;
    onSelect?: () => void;
  };
}> = <template>
  {{#if @onSelect}}
    {{#if @cell.select}}
      <Button
        class='pretui-statement-select'
        @appearance='link'
        @tone='neutral'
        @size='s'
        {{on 'click' @onSelect}}
      ><CellValue
          @cell={{@cell}}
          @currency={{@currency}}
          @locale={{@locale}}
        /></Button>
    {{else}}
      <CellValue @cell={{@cell}} @currency={{@currency}} @locale={{@locale}} />
    {{/if}}
  {{else}}
    <CellValue @cell={{@cell}} @currency={{@currency}} @locale={{@locale}} />
  {{/if}}
  <style scoped>
    @layer PretComponent, PretComposite;
    /* Composite: the drill-in Button sits in a table cell, so it drops its own block padding and
       height and starts its text where the cell's text starts. */
    @layer PretComposite {
      .pretui-statement-select {
        padding: 0;
        min-height: 0;
        text-align: start;
      }
    }
  </style>
</template>;

let uid = 0;

export class StatementTable extends Component<StatementTableSignature> {
  private idBase = `pretui-statement-${++uid}`;
  @tracked ownExpanded: string[] | undefined;
  get expandedKeys(): string[] {
    return (
      this.args.expanded ?? this.ownExpanded ?? this.args.defaultExpanded ?? []
    );
  }
  isExpanded = (key: string) => this.expandedKeys.includes(key);
  toggle = (key: string) => {
    let keys = this.isExpanded(key)
      ? this.expandedKeys.filter((k) => k !== key)
      : [...this.expandedKeys, key];
    if (this.args.expanded === undefined) this.ownExpanded = keys;
    this.args.onExpandedChange?.(keys);
  };
  toggleLabel = (r: RowView) =>
    this.args.expandLabel
      ? this.args.expandLabel(r.row)
      : `Show the detail of ${r.title}`;
  get currency() {
    return this.args.currency ?? 'USD';
  }
  get columns(): StatementColumn[] {
    return (this.args.columns ?? []).filter(Boolean);
  }
  get colCount() {
    return this.columns.length || 1;
  }
  get selectKey() {
    return this.args.onRowSelect
      ? (this.args.selectColumn ?? this.columns[0]?.key)
      : undefined;
  }
  get hasRows() {
    return (this.args.rows ?? []).length > 0;
  }
  // A scroll box with no tab stop traps a keyboard user; with a name it becomes a reachable region.
  get regionLabel() {
    return this.args.label ?? this.args.caption;
  }
  get regionLabelledBy() {
    return this.regionLabel ? undefined : this.args.labelledBy;
  }
  get named() {
    return !!(this.regionLabel || this.args.labelledBy);
  }
  get tableLabel() {
    return this.args.caption || this.args.labelledBy
      ? undefined
      : this.args.label;
  }
  get tableLabelledBy() {
    return this.args.caption ? undefined : this.args.labelledBy;
  }
  hasToggle = (r: RowView, c: CellView) =>
    r.expandable && c.key === this.columns[0]?.key;
  colStyle = (c: StatementColumn) =>
    c.width ? htmlSafe(`width: ${c.width}`) : undefined;
  kindOf = (c: StatementColumn): StatementColumnKind => c.kind ?? 'text';
  // A subtotal or total is named by its row header: the first text cell that holds its label, so
  // a total whose label sits past an empty code column is still announced by name.
  headerKeyOf = (row: StatementRow, role: StatementRowRole) => {
    if (role !== 'subtotal' && role !== 'total') return undefined;
    let labelled = this.columns.find(
      (c) =>
        !NUMERIC.has(this.kindOf(c)) &&
        row.cells?.[c.key] !== undefined &&
        row.cells?.[c.key] !== null &&
        row.cells?.[c.key] !== '',
    );
    return (labelled ?? this.columns[0])?.key;
  };

  cell(
    row: StatementRow,
    column: StatementColumn,
    headerKey: string | undefined,
    role: StatementRowRole,
  ): CellView {
    let kind = this.kindOf(column),
      value = row.cells?.[column.key],
      numeric = NUMERIC.has(kind);
    let view: CellView = {
      key: column.key,
      column,
      kind,
      value,
      numeric,
      header: column.key === headerKey,
      select:
        role === 'line' &&
        column.key === this.selectKey &&
        !!this.args.onRowSelect,
      text: value === null || value === undefined ? '' : String(value),
      placeholder: '',
    };
    if (!numeric) return view;
    let n = toNumber(value as number | string | undefined),
      scale = column.scale ?? (kind === 'amount' ? 2 : 0),
      zero = this.args.zero ?? 'blank';
    let major = n === undefined ? undefined : n / 10 ** scale;
    if (major === 0 && zero !== 'show') {
      major = undefined;
      view.placeholder = zero === 'dash' ? '—' : '';
    }
    view.major = major;
    if (kind === 'amount') {
      view.style = 'currency';
      view.digits = column.whole ? 0 : undefined;
      let change = column.sign === 'change',
        parens = (this.args.negative ?? 'parentheses') === 'parentheses';
      view.signDisplay = change ? 'exceptZero' : 'auto';
      view.currencySign = !change && parens ? 'accounting' : 'standard';
      if (
        major !== undefined &&
        major < 0 &&
        view.currencySign === 'accounting'
      ) {
        view.spoken = formatNumber(major, this.args.locale, {
          style: 'currency',
          currency: this.currency,
          currencySign: 'standard',
          minimumFractionDigits: view.digits,
          maximumFractionDigits: view.digits,
        });
      }
    } else {
      view.style = kind === 'percent' ? 'percent' : 'decimal';
      view.digits = column.digits ?? DEFAULT_DIGITS[kind];
    }
    return view;
  }

  // The rows as rendered: each expanded row followed by its children, recursively. A child's key is
  // its parent's key and its own, so two accounts can both have a '2026-01'.
  get view(): RowView[] {
    let out: RowView[] = [],
      first = this.columns[0],
      titleOf = (row: StatementRow) =>
        first ? String(row.cells?.[first.key] ?? '') : '';
    let walk = (
      rows: StatementRow[],
      parentKey: string | undefined,
      parentDepth: number,
    ) => {
      for (let row of rows.filter(Boolean)) {
        let role = row.role ?? 'line',
          key = parentKey ? `${parentKey}/${row.key}` : row.key;
        let depth = row.depth ?? (parentKey ? parentDepth + 1 : 0),
          kids = (row.children ?? []).filter(Boolean);
        let expandable = kids.length > 0 && role !== 'heading',
          expanded = expandable && this.isExpanded(key);
        let id = `${this.idBase}-${key.replace(/[^\w-]/g, '_')}`;
        out.push({
          key,
          row,
          role,
          id,
          depth: String(Math.max(0, Math.min(3, depth))),
          title: titleOf(row),
          childOf: parentKey,
          expandable,
          expanded,
          controls: expandable
            ? kids
                .map(
                  (k) =>
                    `${this.idBase}-${`${key}/${k.key}`.replace(/[^\w-]/g, '_')}`,
                )
                .join(' ')
            : undefined,
          cells:
            role === 'heading'
              ? []
              : this.columns.map((c) =>
                  this.cell(row, c, this.headerKeyOf(row, role), role),
                ),
        });
        if (expanded) walk(kids, key, depth);
      }
    };
    walk(this.args.rows ?? [], undefined, 0);
    return out;
  }

  <template>
    <div
      class='pretui-statement'
      data-density={{if (eq @density 'compact') 'compact'}}
      data-framed={{if (eq @framed false) 'false'}}
      data-test-pretui-statement-table
      ...attributes
    >
      {{#if this.hasRows}}
        <div
          class='pretui-statement-scroll'
          role={{if this.named 'region'}}
          aria-label={{this.regionLabel}}
          aria-labelledby={{this.regionLabelledBy}}
          tabindex={{if this.named '0'}}
          data-test-pretui-statement-scroll
        >
          <table
            class='pretui-statement-table'
            aria-label={{this.tableLabel}}
            aria-labelledby={{this.tableLabelledBy}}
          >
            {{#if (has-block 'caption')}}
              <caption class='pretui-statement-caption'>{{yield
                  to='caption'
                }}</caption>
            {{else if @caption}}
              <caption class='pretui-statement-caption'>{{@caption}}</caption>
            {{/if}}
            <colgroup>{{#each this.columns as |c|}}<col
                  data-priority={{c.priority}}
                  style={{this.colStyle c}}
                />{{/each}}</colgroup>
            <thead>
              <tr>{{#each this.columns as |c|}}<th
                    scope='col'
                    data-kind={{this.kindOf c}}
                    data-priority={{c.priority}}
                  >{{c.label}}</th>{{/each}}</tr>
            </thead>
            <tbody>
              {{#each this.view key='key' as |r|}}
                {{#if (eq r.role 'heading')}}
                  <tr data-role='heading' {{rowData r.row.data}}><th
                      scope='rowgroup'
                      colspan={{this.colCount}}
                    >{{r.title}}</th></tr>
                {{else}}
                  <tr
                    id={{r.id}}
                    data-role={{r.role}}
                    data-depth={{r.depth}}
                    data-child={{if r.childOf 'true'}}
                    {{rowData r.row.data}}
                  >
                    {{#each r.cells key='key' as |c|}}
                      {{#if c.header}}
                        <th
                          scope='row'
                          data-kind={{c.kind}}
                          data-numeric={{if c.numeric 'true'}}
                          data-priority={{c.column.priority}}
                          data-toggle={{if (this.hasToggle r c) 'true'}}
                        >
                          {{#if (this.hasToggle r c)}}<Disclosure
                              @expanded={{r.expanded}}
                              @controls={{r.controls}}
                              @label={{this.toggleLabel r}}
                              @onToggle={{fn this.toggle r.key}}
                            />{{/if}}
                          {{#if (eq c.kind 'custom')}}{{yield
                              c.value
                              r.row
                              c.column
                              to='cell'
                            }}{{else}}<CellContent
                              @cell={{c}}
                              @currency={{this.currency}}
                              @locale={{@locale}}
                            />{{/if}}
                        </th>
                      {{else}}
                        <td
                          data-kind={{c.kind}}
                          data-numeric={{if c.numeric 'true'}}
                          data-priority={{c.column.priority}}
                          data-toggle={{if (this.hasToggle r c) 'true'}}
                        >
                          {{#if (this.hasToggle r c)}}<Disclosure
                              @expanded={{r.expanded}}
                              @controls={{r.controls}}
                              @label={{this.toggleLabel r}}
                              @onToggle={{fn this.toggle r.key}}
                            />{{/if}}
                          {{#if (eq c.kind 'custom')}}{{yield
                              c.value
                              r.row
                              c.column
                              to='cell'
                            }}{{else}}<CellContent
                              @cell={{c}}
                              @currency={{this.currency}}
                              @locale={{@locale}}
                              @onSelect={{if c.select (fn this.select r.row)}}
                            />{{/if}}
                        </td>
                      {{/if}}
                    {{/each}}
                  </tr>
                {{/if}}
              {{/each}}
            </tbody>
          </table>
        </div>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState
          @size='s'
          @title={{if @emptyTitle @emptyTitle 'Nothing to report'}}
          @message={{@emptyMessage}}
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* The table measures its own width, so a column marked secondary folds where the table is
           narrow, whatever the viewport is doing. */
        .pretui-statement {
          container: pretui-statement / inline-size;
          min-width: 0;
        }
        /* Law 1c: the frame paints inward, and the focus ring is the one thing drawn outside. */
        .pretui-statement-scroll {
          --pretui-statement-head-height: 1.875rem;

          overflow: auto;
          max-height: var(--pretui-statement-max-height, none);
          scroll-padding-block-start: var(--pretui-statement-head-height);
          border-radius: var(--boxel-border-radius);
          box-shadow: inset 0 0 0 1px var(--border);
          background-color: var(--card);
          color: var(--card-foreground);
        }
        .pretui-statement[data-framed='false'] .pretui-statement-scroll {
          border-radius: 0;
          box-shadow: none;
          background-color: transparent;
        }
        .pretui-statement-scroll:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-statement-table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-md);
        }
        .pretui-statement[data-density='compact'] .pretui-statement-table {
          font-size: var(--boxel-font-size-xs);
        }
        .pretui-statement-caption {
          padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
          text-align: start;
          color: var(--muted-foreground);
          font-size: var(--boxel-caption-font-size);
          font-weight: var(--boxel-caption-font-weight);
          letter-spacing: var(--boxel-caption-letter-spacing);
        }
        th,
        td {
          padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
          vertical-align: baseline;
          text-align: start;
        }
        .pretui-statement[data-density='compact'] th,
        .pretui-statement[data-density='compact'] td {
          padding-block: var(--boxel-sp-4xs);
        }
        /* The header voice: the label role in mono, a band that sticks inside a bounded table. */
        thead th {
          position: sticky;
          top: 0;
          z-index: 1;
          height: var(--pretui-statement-head-height);
          padding-block: 0;
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
        /* Figures: end-aligned, tabular, never broken across lines. */
        [data-kind='amount'],
        [data-kind='number'],
        [data-kind='percent'],
        [data-kind='quantity'] {
          text-align: end;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        /* Law 3: machine values look like machine values. */
        td[data-kind='code'],
        th[data-kind='code'][scope='row'] {
          font-family: var(--font-mono);
        }
        tr[data-role='line'] > td,
        tr[data-role='line'] > th {
          box-shadow: inset 0 -1px 0 var(--border);
        }
        @media (hover: hover) {
          tr[data-role='line']:hover > * {
            background-color: var(--hover);
            color: var(--foreground);
          }
        }
        /* A section title spans the table in the label voice, with room above it. */
        tr[data-role='heading'] > th {
          padding-block: var(--boxel-sp-sm) var(--boxel-sp-3xs);
          font-family: var(--font-mono);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        /* Law 8: a subtotal and a total read as such in a still frame without colour, by weight
           and by the accountant's rules: a single rule over the figures, and a double rule under
           a total's. */
        tr[data-role='subtotal'] > * {
          font-weight: 600;
        }
        tr[data-role='total'] > * {
          font-weight: 700;
        }
        tr[data-role='subtotal'] > [data-numeric],
        tr[data-role='total'] > [data-numeric] {
          box-shadow: inset 0 1px 0 var(--foreground);
        }
        tr[data-role='total'] > [data-numeric] {
          border-block-end: 3px double var(--foreground);
        }
        /* The disclosure and the value it opens stay on one line. */
        [data-toggle] {
          white-space: nowrap;
        }
        /* An opened row's children read as detail: the muted ink, figures unchanged. */
        tr[data-child] > * {
          color: var(--muted-foreground);
        }
        tr[data-depth='1'] > :first-child {
          padding-inline-start: calc(var(--boxel-sp-xs) + var(--boxel-sp));
        }
        tr[data-depth='2'] > :first-child {
          padding-inline-start: calc(var(--boxel-sp-xs) + 2 * var(--boxel-sp));
        }
        tr[data-depth='3'] > :first-child {
          padding-inline-start: calc(var(--boxel-sp-xs) + 3 * var(--boxel-sp));
        }
        @container pretui-statement (max-width: 40rem) {
          [data-priority='secondary'] {
            display: none;
          }
        }
      }
    </style>
  </template>

  select = (row: StatementRow) => this.args.onRowSelect?.(row);
}
