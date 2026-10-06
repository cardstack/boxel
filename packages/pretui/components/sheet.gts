// Pretui — Sheet: a spreadsheet-grade editable data grid over the vendored surfaces grid engine.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { cssStyle } from '../pretui-css';
import { EmptyState } from './empty-state';
// eslint-disable-next-line import/no-unresolved -- realm-served ESM bundle;
// glint cannot resolve it locally (same accepted baseline as
// surfaces-preview.gts), the realm loader resolves it at runtime.
import { Cell, Grid, Row, getSheet } from '../surfaces/grid/index.js';

// ── the bundle's shapes, re-declared locally ─────────────────────────────
// The realm bundle carries no .d.ts that glint can see, so these mirror
// the parts of boxel-grid's public API this module actually touches.
// Declaring them here keeps the rest of the file honestly typed instead of
// leaking `any` through every call site.

interface EngineColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  width: string;
  editable: boolean;
  commit: (row: SheetDatum, next: unknown) => boolean;
}

interface EngineCell {
  colKey: string;
  value: unknown;
  editable: boolean;
  commit: (next: unknown) => boolean;
}

interface EngineRow {
  key: string;
  source?: unknown;
  cells: readonly EngineCell[];
}

interface EngineTarget {
  rowKey: string;
  colKey: string;
}

interface EngineRuntime {
  selection: {
    readonly current: EngineTarget | null;
    select: (target: EngineTarget, mode?: 'replace' | 'extend') => void;
    clear: () => void;
  };
  keyboard: {
    bind: (pattern: string, handler: () => boolean | void) => () => void;
  };
}

interface EngineSheet {
  readonly runtime: EngineRuntime;
  readonly rows: readonly EngineRow[];
  readonly gridTemplateColumns: string;
}

// ── public types ─────────────────────────────────────────────────────────

export type SheetValueType = 'text' | 'number' | 'boolean' | 'date';
export type SheetDatum = Record<string, unknown>;
export interface SheetSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface SheetColumn {
  /** property name on each row object */
  key: string;
  /** header label */
  label: string;
  /** value type — drives the cell widget, alignment, and commit coercion */
  type?: SheetValueType;
  /** CSS grid track for this column */
  width?: string;
  /** override the type's default alignment */
  align?: 'start' | 'center' | 'end';
  /** render as a machine value (mono, tabular) — default true for number */
  mono?: boolean;
  /** per-column edit gate — default true */
  editable?: boolean;
  /** per-column sort gate — default true */
  sortable?: boolean;
  /** short unit/format note set beside the header label ("kg",
   *  "USD/kg", "ref"). Chrome, not load-bearing: it is suppressed below
   *  30rem of sheet width, so never put a value a reader must have here. */
  hint?: string;
}

/** What `<Sheet>` yields to `<:toolbar>` and `<:footer>`. */
export interface SheetApi {
  /** current quick-filter text */
  query: string;
  setQuery: (next: string) => void;
  /** current sort, or null */
  sort: SheetSort | null;
  /** cycle a column: asc → desc → unsorted */
  toggleSort: (key: string) => void;
  clearSort: () => void;
  /** rows after filter */
  visibleCount: number;
  /** rows before filter */
  totalCount: number;
  columns: readonly SheetColumn[];
}

// ── the token bridge ─────────────────────────────────────────────────────
// boxel-grid declares its palette ON `.boxel-grid` (via `:where()`), which
// beats inherited custom properties, so a wrapper cannot re-theme it —
// upstream's documented channel is the inline `style` splat. Every engine
// token below resolves through a `--pretui-sheet-*` knob first (so a
// consumer can restyle one axis without touching the rest), then a Pretui
// semantic token, then a LIGHT literal. No dark branch anywhere: the theme
// frame supplies the tokens.
const GRID_TOKENS = htmlSafe(
  [
    // palette
    '--bg: var(--pretui-sheet-surface, var(--card))',
    '--bg-zebra: var(--pretui-sheet-stripe, var(--stripe, #f5f5f5))',
    '--bg-hover: var(--pretui-sheet-hover, var(--hover, #f4f5f6))',
    '--bg-focus: var(--pretui-sheet-cell-focus, color-mix(in oklch, var(--pretui-sheet-accent, var(--primary)) 8%, transparent))',
    '--accent-bg: var(--pretui-sheet-range, color-mix(in oklch, var(--pretui-sheet-accent, var(--primary)) 5%, transparent))',
    '--accent: var(--pretui-sheet-accent, var(--primary))',
    '--accent-soft: var(--ring)',
    '--border: var(--pretui-sheet-line, var(--line-strong, var(--border)))',
    '--border-soft: var(--pretui-sheet-line-soft, var(--border))',
    '--bg-toolbar: var(--pretui-sheet-head-bg, var(--inset, #f7f8f9))',
    '--fg: var(--card-foreground)',
    '--fg-muted: var(--muted-foreground)',
    '--fg-faded: var(--ink-3, #9a9da3)',
    '--mono: var(--font-mono)',
    // dimensional — the density knob feeds --pretui-sheet-row-h
    '--row-h: var(--pretui-sheet-row-h, 32px)',
    '--header-h: var(--pretui-sheet-head-h, 30px)',
    // cell internals (the only reachable channel into <CellInner>)
    '--boxel-grid-cell-padding: var(--pretui-sheet-cell-pad, 0 10px)',
    '--boxel-grid-cell-content-min-block-size: var(--pretui-sheet-row-h, 32px)',
    '--boxel-grid-editor-bg: var(--pretui-sheet-editor-bg, var(--card))',
    '--boxel-grid-editor-outline: 2px solid var(--pretui-sheet-accent, var(--primary))',
    '--boxel-grid-editor-outline-offset: -2px',
    '--boxel-grid-max-block-size: var(--pretui-sheet-max-height, 22rem)',
    '--boxel-grid-sticky-top: 0px',
  ].join('; '),
);

const DEFAULT_TRACK = 'minmax(7rem, 1fr)';
/** commit sentinel — "this value never reaches the row" */
const REJECT = Symbol('pretui-sheet-reject');


// a const, not an inline `!/…/` literal: content-tag misreads the negated form
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in `yyyy-mm-dd`: `2026-02-30` is refused, where
 *  `new Date` would quietly roll it into March. */
function isCalendarDate(text: string): boolean {
  let m = ISO_DATE.exec(text);
  if (!m) {
    return false;
  }
  let [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

function coerce(column: SheetColumn, next: unknown): unknown | typeof REJECT {
  switch (column.type) {
    case 'number': {
      let text = String(next ?? '').trim();
      if (text === '') {
        return null;
      }
      let n = Number(text);
      return Number.isFinite(n) ? n : REJECT;
    }
    case 'boolean':
      return next === true || next === 'true';
    case 'date': {
      let text = String(next ?? '').trim();
      if (text === '') {
        return '';
      }
      return isCalendarDate(text) ? text : REJECT;
    }
    default:
      return String(next ?? '');
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return -1;
  }
  if (b == null) {
    return 1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function alignFor(column: SheetColumn): 'start' | 'center' | 'end' {
  if (column.align) {
    return column.align;
  }
  if (column.type === 'number') {
    return 'end';
  }
  if (column.type === 'boolean') {
    return 'center';
  }
  return 'start';
}

function isMono(column: SheetColumn): boolean {
  // Law 3 — machine values look like machine values. Numbers and dates are
  // machine values by default; prose columns are not.
  return column.mono ?? (column.type === 'number' || column.type === 'date');
}

// ── view models (what the template iterates) ─────────────────────────────

interface CellView {
  colKey: string;
  value: unknown;
  /** widget kind handed to <Cell @type> */
  kind: SheetValueType;
  editable: boolean;
  commit: (next: unknown) => boolean;
  ariaColIndex: number;
  align: string;
  mono: boolean;
  pinned: boolean;
  /** a boolean column with no write path — renders a disabled checkbox
   *  instead of the engine's "true"/"false" readonly text */
  frozenBoolean: boolean;
}

interface RowView {
  key: string;
  ariaRowIndex: number;
  zebra: boolean;
  cells: CellView[];
}

interface HeaderView {
  key: string;
  label: string;
  hint?: string;
  ariaColIndex: number;
  align: string;
  sortable: boolean;
  /** 'ascending' | 'descending' | 'none' — the aria-sort value. Undefined
   *  on a column that cannot be sorted at all: `aria-sort='none'` there
   *  would advertise a sort affordance that does not exist. */
  sortState?: string;
  /** 'asc' | 'desc' on the sorted column, undefined everywhere else.
   *  MUST be undefined and not '' — an empty string still renders the
   *  attribute, and `[data-dir]` would then match every header. */
  dir?: string;
  pinned: boolean;
}

export interface SheetSignature {
  Args: {
    /** the data. Plain objects, mutated in place on commit — pass a stable
     *  array (a getter that rebuilds it each read loses every edit).
     *  Give every row an `id`: getSheet keys rows by `row.id`, falling
     *  back to the ORDINAL (`r0`, `r1`…), so id-less rows re-key
     *  themselves every time a sort or filter reorders them and the
     *  selected cell appears to jump. */
    rows: SheetDatum[];
    /** column definitions, in display order */
    columns: SheetColumn[];
    /** accessible name for the grid — always supply a real one */
    label?: string;
    /** row height / padding scale */
    density?: 'compact' | 'default' | 'roomy';
    /** stripe alternate rows — default true */
    zebra?: boolean;
    /** CSS max-height for the scroll container — default 22rem */
    maxHeight?: string;
    /** master edit gate — default true */
    editable?: boolean;
    /** master sort gate — default true */
    sortable?: boolean;
    /** initial sort */
    defaultSort?: SheetSort;
    /** controlled quick filter; omit to let the toolbar drive it */
    filter?: string;
    /** stick the first column to the left edge while scrolling across */
    pinFirstColumn?: boolean;
    /** reject a value before it reaches the row — returning false keeps
     *  the editor open with the bad text intact */
    validate?: (next: unknown, column: SheetColumn, row: SheetDatum) => boolean;
    /** fires after a value is written to the row object */
    onCommit?: (row: SheetDatum, key: string, next: unknown) => void;
    /** fires whenever the sort cycles — null means "unsorted" */
    onSortChange?: (sort: SheetSort | null) => void;
    /** fires on every quick-filter keystroke; pair with `@filter` to
     *  control the query from outside */
    onFilterChange?: (query: string) => void;
  };
  Blocks: {
    /** chrome above the grid — receives the SheetApi */
    toolbar: [SheetApi];
    /** replaces the default empty state */
    empty: [];
    /** summary band below the grid — receives the SheetApi */
    footer: [SheetApi];
  };
  Element: HTMLDivElement;
}

/**
 * `Sheet` — an editable, sortable, filterable data grid: boxel-grid's
 * runtime wearing Pretui cloth. Reach for it when values must be *edited*
 * in place (DataGrid and Table are read-only presentations); reach for
 * DataGrid when they must only be read.
 */
export class Sheet extends Component<SheetSignature> {
  @tracked private internalSort: SheetSort | null =
    this.args.defaultSort ?? null;
  @tracked private internalQuery = '';
  /** bumped by every committed edit — see note 8 in the module header */
  @tracked private generation = 0;

  private sheet: EngineSheet;
  private unbindKeys: Array<() => void> = [];

  constructor(owner: unknown, args: SheetSignature['Args']) {
    // `never` rather than `any`: Glimmer's owner parameter is nominally
    // typed and untyped at this call site in strict-mode .gts, and `never`
    // widens without opening a hole in the file's typing.
    super(owner as never, args);
    this.sheet = getSheet(this, this.sheetOptions()) as EngineSheet;
    this.bindExtraKeys();
  }

  willDestroy(): void {
    super.willDestroy();
    for (let off of this.unbindKeys) {
      off();
    }
    this.unbindKeys = [];
  }

  // ── options handed to getSheet ─────────────────────────────────────────
  // `columns` is a getter on the literal so column changes re-materialize
  // the row model (getSheet reads options.columns lazily inside its own
  // getters — a plain array would freeze at construction).
  private sheetOptions() {
    let host = this;
    return {
      data: () => host.orderedRows,
      get columns() {
        return host.engineColumns;
      },
      editable: {
        forColumn: (column: EngineColumn) => column.editable,
      },
    };
  }

  private bindExtraKeys(): void {
    let bind = this.sheet.runtime.keyboard.bind;
    this.unbindKeys = [
      bind('PageDown', () => this.pageBy(10)),
      bind('PageUp', () => this.pageBy(-10)),
      bind('Ctrl+Home', () => this.jumpToEdge('first')),
      bind('Ctrl+End', () => this.jumpToEdge('last')),
      bind('Space', () => this.toggleBooleanCell()),
    ];
  }

  // ── derived state ──────────────────────────────────────────────────────

  get columns(): SheetColumn[] {
    return this.args.columns ?? [];
  }
  get label(): string {
    return this.args.label ?? 'Data sheet';
  }
  get isEditable(): boolean {
    return this.args.editable ?? true;
  }
  get isSortable(): boolean {
    return this.args.sortable ?? true;
  }
  get zebra(): boolean {
    return this.args.zebra ?? true;
  }
  get density(): string {
    return this.args.density ?? 'default';
  }
  get sort(): SheetSort | null {
    return this.internalSort;
  }
  get query(): string {
    return this.args.filter ?? this.internalQuery;
  }
  get wrapperStyle() {
    // `@maxHeight` is a caller string reaching an inline style — validated
    // against the kit allowlist (lengths and calc() survive; a declaration
    // smuggled in behind a semicolon does not).
    return cssStyle('--pretui-sheet-max-height', this.args.maxHeight);
  }
  get gridTokens() {
    return GRID_TOKENS;
  }

  private get sourceRows(): SheetDatum[] {
    // Reading `generation` subscribes this getter to every committed edit.
    // Row objects are plain and untracked, so without it the engine writes
    // the new value and nothing re-renders (note 8).
    let generation = this.generation;
    let rows = this.args.rows ?? [];
    return generation < 0 ? [] : rows;
  }

  /** filtered + sorted, same object identities — edits still write through */
  get orderedRows(): SheetDatum[] {
    let rows = this.sourceRows;
    let q = this.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        this.columns.some((column) =>
          String(row[column.key] ?? '')
            .toLowerCase()
            .includes(q),
        ),
      );
    }
    let sort = this.sort;
    if (sort) {
      let dir = sort.dir === 'desc' ? -1 : 1;
      rows = [...rows].sort(
        (a, b) => compareValues(a[sort.key], b[sort.key]) * dir,
      );
    }
    return rows;
  }

  get totalCount(): number {
    return (this.args.rows ?? []).length;
  }
  get visibleCount(): number {
    return this.orderedRows.length;
  }
  get isEmpty(): boolean {
    return this.visibleCount === 0;
  }
  /** "no data" and "the filter matched nothing" are different failures
   *  and get different copy — one is the caller's, one is the reader's */
  get filteredToNothing(): boolean {
    return this.totalCount > 0 && this.visibleCount === 0;
  }
  get emptyTitle(): string {
    return this.filteredToNothing ? 'No matches' : 'Nothing to show';
  }
  get emptyMessage(): string {
    return this.filteredToNothing
      ? `No rows match “${this.query.trim()}”.`
      : 'This sheet has no rows yet.';
  }

  /** engine column defs — date columns declare as text so the raw ISO
   *  string survives the read path (note 9) */
  get engineColumns(): EngineColumn[] {
    return this.columns.map((column) => ({
      key: column.key,
      label: column.label,
      type: column.type === 'number' || column.type === 'boolean'
        ? column.type
        : ('text' as const),
      width: column.width ?? DEFAULT_TRACK,
      editable: this.isEditable && (column.editable ?? true),
      commit: (row: SheetDatum, next: unknown) => this.writeCell(column, row, next),
    }));
  }

  get gridTemplateColumns(): string {
    return this.columns
      .map((column) => column.width ?? DEFAULT_TRACK)
      .join(' ');
  }

  get headers(): HeaderView[] {
    let sort = this.sort;
    return this.columns.map((column, index) => {
      let active = sort?.key === column.key;
      let sortable = this.isSortable && (column.sortable ?? true);
      return {
        key: column.key,
        label: column.label,
        hint: column.hint,
        ariaColIndex: index + 1,
        align: alignFor(column),
        sortable,
        sortState: sortable
          ? active
            ? sort?.dir === 'desc'
              ? 'descending'
              : 'ascending'
            : 'none'
          : undefined,
        dir: active ? (sort?.dir ?? 'asc') : undefined,
        pinned: !!this.args.pinFirstColumn && index === 0,
      };
    });
  }

  get rowViews(): RowView[] {
    // Second read of `generation` (the first is in sourceRows, which only
    // invalidates the engine's data thunk). Row objects are plain and
    // untracked: without a direct read here, a committed edit could
    // re-run the thunk, hit TanStack's identity-keyed row-model memo, and
    // leave this getter — and therefore every rendered cell — on the
    // pre-edit values. See note 8 in the module header.
    if (this.generation < 0) {
      return [];
    }
    let columns = this.columns;
    let pinFirst = !!this.args.pinFirstColumn;
    return this.sheet.rows.map((row, rowIndex) => ({
      key: row.key,
      ariaRowIndex: rowIndex + 2, // +1 for the header row, +1 for 1-basing
      zebra: this.zebra && rowIndex % 2 === 1,
      cells: row.cells.map((cell, colIndex) => {
        let column = columns[colIndex] ?? { key: cell.colKey, label: '' };
        let editable = cell.editable;
        return {
          colKey: cell.colKey,
          value: cell.value,
          kind: (column.type ?? 'text') as SheetValueType,
          editable,
          commit: cell.commit,
          ariaColIndex: colIndex + 1,
          align: alignFor(column),
          mono: isMono(column),
          pinned: pinFirst && colIndex === 0,
          frozenBoolean: column.type === 'boolean' && !editable,
        };
      }),
    }));
  }

  get ariaRowCount(): number {
    return this.visibleCount + 1;
  }
  get ariaColCount(): number {
    return this.columns.length;
  }

  get statusText(): string {
    let sort = this.sort;
    let column = sort
      ? this.columns.find((candidate) => candidate.key === sort.key)
      : undefined;
    let counts =
      this.visibleCount === this.totalCount
        ? `${this.totalCount} rows`
        : `${this.visibleCount} of ${this.totalCount} rows`;
    return column
      ? `${counts} · sorted by ${column.label}, ${sort?.dir === 'desc' ? 'descending' : 'ascending'}`
      : counts;
  }

  get api(): SheetApi {
    return {
      query: this.query,
      setQuery: this.setQuery,
      sort: this.sort,
      toggleSort: this.toggleSort,
      clearSort: this.clearSort,
      visibleCount: this.visibleCount,
      totalCount: this.totalCount,
      columns: this.columns,
    };
  }

  // ── commit path ────────────────────────────────────────────────────────

  private writeCell(
    column: SheetColumn,
    row: SheetDatum,
    next: unknown,
  ): boolean {
    let value = coerce(column, next);
    if (value === REJECT) {
      return false; // the engine keeps the editor open for a retry
    }
    if (this.args.validate && !this.args.validate(value, column, row)) {
      return false;
    }
    row[column.key] = value;
    this.generation++;
    this.args.onCommit?.(row, column.key, value);
    return true;
  }

  // ── sort / filter ──────────────────────────────────────────────────────

  toggleSort = (key: string): void => {
    let current = this.internalSort;
    let next: SheetSort | null =
      !current || current.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null;
    this.internalSort = next;
    this.args.onSortChange?.(next);
  };

  clearSort = (): void => {
    this.internalSort = null;
    this.args.onSortChange?.(null);
  };

  setQuery = (next: string): void => {
    this.internalQuery = next;
    this.args.onFilterChange?.(next);
  };

  clickSort = (key: string, _event: Event): void => {
    this.toggleSort(key);
  };

  // ── keyboard: the escape hatch and the missing bindings ────────────────

  /**
   * Capture-phase guard on OUR wrapper — it runs before <Grid>'s own
   * keydown listener on the grid root, which is the only place a Tab press
   * can be rescued (the runtime preventDefaults every Tab).
   */
  guardKeys = (event: Event): void => {
    // `{{on}}` hands us a bare Event; narrow rather than lying in the
    // parameter type (which is what the compiler rejects).
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    let target = event.target as HTMLElement | null;
    if (target?.closest?.('.pretui-sheet-hrow')) {
      // header chrome (sort buttons) owns its own keys — Tab/Enter/Space
      // must reach the button, not the cell runtime
      event.stopPropagation();
      return;
    }
    if (event.key === 'Tab' && !this.sheet.runtime.selection.current) {
      // nothing selected: let the browser move focus out of the grid
      event.stopPropagation();
    }
  };

  private currentPosition(): { row: number; col: number } | null {
    let current = this.sheet.runtime.selection.current;
    if (!current) {
      return null;
    }
    let row = this.rowViews.findIndex((view) => view.key === current.rowKey);
    let col = this.columns.findIndex(
      (column) => column.key === current.colKey,
    );
    return row < 0 || col < 0 ? null : { row, col };
  }

  private selectAt(rowIndex: number, colIndex: number): boolean {
    let rows = this.rowViews;
    let columns = this.columns;
    if (!rows.length || !columns.length) {
      return false;
    }
    let row = rows[Math.min(Math.max(rowIndex, 0), rows.length - 1)];
    let column = columns[Math.min(Math.max(colIndex, 0), columns.length - 1)];
    if (!row || !column) {
      return false;
    }
    this.sheet.runtime.selection.select({
      rowKey: row.key,
      colKey: column.key,
    });
    return true;
  }

  private pageBy(delta: number): boolean {
    let position = this.currentPosition();
    return position
      ? this.selectAt(position.row + delta, position.col)
      : this.selectAt(delta > 0 ? 0 : this.rowViews.length - 1, 0);
  }

  private jumpToEdge(edge: 'first' | 'last'): boolean {
    return edge === 'first'
      ? this.selectAt(0, 0)
      : this.selectAt(this.rowViews.length - 1, this.columns.length - 1);
  }

  /** Space flips a boolean cell in place — no editor, matching how the
   *  engine's checkbox widget commits on change. */
  private toggleBooleanCell(): boolean {
    let position = this.currentPosition();
    if (!position) {
      return false;
    }
    let cell = this.rowViews[position.row]?.cells[position.col];
    if (!cell || !cell.editable || cell.kind !== 'boolean') {
      return false;
    }
    cell.commit(cell.value !== true);
    return true;
  }

  <template>
    {{! Two static-analysis blind spots, suppressed with the reasons
        stated here rather than worked around in the markup.

        no-invalid-interactive: the keydown below adds NO interaction of
        its own. It is a capture-phase guard that lets Tab OUT of the
        grid the runtime would otherwise trap (see guardKeys). Every real
        interaction in this component sits on a <button> or on the
        engine's own role="gridcell" elements; the rule cannot tell
        event delegation on a container from a click handler on a div.

        require-context-role: <:header>'s content is rendered by <Grid>
        INSIDE the role="rowgroup" wrapper it owns, so the role="row"
        further down does have its required parent at runtime — the rule
        cannot see across the component boundary. Dropping the role
        instead (what surfaces-preview.gts did) leaves the columnheaders
        as direct rowgroup children, which is the real ARIA violation. }}
    {{! template-lint-disable no-invalid-interactive require-context-role }}
    <div
      class='pretui-sheet'
      role='group'
      aria-label='{{this.label}} sheet'
      data-density={{this.density}}
      data-test-pretui-sheet
      style={{this.wrapperStyle}}
      {{on 'keydown' this.guardKeys capture=true}}
      ...attributes
    >
      {{#if (has-block 'toolbar')}}
        <div class='pretui-sheet-bar'>{{yield this.api to='toolbar'}}</div>
      {{/if}}

      <Grid
        {{! @glint-expect-error - the vendored grid bundle declares no element type }}
        class='pretui-sheet-grid'
        style={{this.gridTokens}}
        @sheet={{this.sheet}}
        @preset='sheet'
        @chrome='none'
        @editable={{this.isEditable}}
        @gridTemplateColumns={{this.gridTemplateColumns}}
        @aria-label={{this.label}}
        aria-rowcount={{this.ariaRowCount}}
        aria-colcount={{this.ariaColCount}}
      >
        <:header>
          <div class='pretui-sheet-hrow' role='row' aria-rowindex='1'>
            {{#each this.headers key='key' as |header|}}
              <div
                class='pretui-sheet-h'
                role='columnheader'
                aria-colindex={{header.ariaColIndex}}
                aria-sort={{header.sortState}}
                data-align={{header.align}}
                data-dir={{header.dir}}
                data-pin={{if header.pinned 'start'}}
              >
                {{#if header.sortable}}
                  <button
                    type='button'
                    class='pretui-sheet-hbtn'
                    {{on 'click' (fn this.clickSort header.key)}}
                  >
                    <span class='pretui-sheet-hlabel'>{{header.label}}</span>
                    {{#if header.hint}}
                      <span class='pretui-sheet-hhint'>{{header.hint}}</span>
                    {{/if}}
                    <span class='pretui-sheet-caret' aria-hidden='true'></span>
                  </button>
                {{else}}
                  <span class='pretui-sheet-hstatic'>
                    <span class='pretui-sheet-hlabel'>{{header.label}}</span>
                    {{#if header.hint}}
                      <span class='pretui-sheet-hhint'>{{header.hint}}</span>
                    {{/if}}
                  </span>
                {{/if}}
              </div>
            {{/each}}
          </div>
        </:header>

        <:body>
          {{#each this.rowViews key='key' as |row|}}
            <Row
              {{! @glint-expect-error - the vendored grid bundle declares no element type }}
              class='pretui-sheet-row'
              @rowKey={{row.key}}
              aria-rowindex={{row.ariaRowIndex}}
              data-zebra={{if row.zebra '1'}}
            >
              {{#each row.cells key='colKey' as |cell|}}
                {{#if cell.frozenBoolean}}
                  {{! a boolean with no write path: keep the checkbox widget
                      (editable) but withhold onCommit, which renders it
                      disabled — the engine's readonly kind would print the
                      words "true"/"false" instead }}
                  <Cell
                    {{! @glint-expect-error - the vendored grid bundle declares no element type }}
                    class='pretui-sheet-cell'
                    @colKey={{cell.colKey}}
                    @value={{cell.value}}
                    @type='boolean'
                    @editable={{true}}
                    aria-colindex={{cell.ariaColIndex}}
                    data-align={{cell.align}}
                    data-pin={{if cell.pinned 'start'}}
                  />
                {{else}}
                  <Cell
                    {{! @glint-expect-error - the vendored grid bundle declares no element type }}
                    class='pretui-sheet-cell'
                    @colKey={{cell.colKey}}
                    @value={{cell.value}}
                    @type={{cell.kind}}
                    @editable={{cell.editable}}
                    @onCommit={{cell.commit}}
                    aria-colindex={{cell.ariaColIndex}}
                    data-align={{cell.align}}
                    data-mono={{if cell.mono '1'}}
                    data-pin={{if cell.pinned 'start'}}
                  />
                {{/if}}
              {{/each}}
            </Row>
          {{/each}}
        </:body>
      </Grid>

      {{! Outside the <Grid>: role="rowgroup" only admits role="row"
          children, so an empty-state panel inside <:body> would be
          invalid ARIA — upstream's own examples put overlays there. }}
      {{#if this.isEmpty}}
        <div class='pretui-sheet-empty'>
          {{#if (has-block 'empty')}}
            {{yield to='empty'}}
          {{else}}
            <EmptyState
              @title={{this.emptyTitle}}
              @message={{this.emptyMessage}}
              @texture={{false}}
            />
          {{/if}}
        </div>
      {{/if}}

      <div class='pretui-sheet-foot'>
        <p class='pretui-sheet-status' role='status'>{{this.statusText}}</p>
        {{#if (has-block 'footer')}}
          <div class='pretui-sheet-footslot'>{{yield this.api to='footer'}}</div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        /* ── the surface ────────────────────────────────────────────────
           Law 1: depth is hairline + shadow, never a contrast step. The
           engine's own chrome is off (@chrome='none') so this is the only
           border in play. */
        .pretui-sheet {
          --pretui-sheet-row-h: 32px;
          --pretui-sheet-cell-pad: 0 10px;
          display: grid;
          gap: 0;
          min-width: 0;
          /* Unnamed only — the named forms make the scoped-CSS transpiler
             drop every rule after them. Declared HERE so the @container
             block at the bottom has an ancestor container to resolve
             against; without it that query can never match. */
          container-type: inline-size;
          border-radius: var(--pretui-sheet-radius, var(--radius));
          background: var(--pretui-sheet-surface, var(--card));
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          ), var(--pretui-shadow-raise, 0 1px 2px rgb(19 20 22 / 0.05));
          overflow: hidden;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--card-foreground);
        }
        .pretui-sheet[data-density='compact'] {
          --pretui-sheet-row-h: 26px;
          --pretui-sheet-cell-pad: 0 8px;
        }
        .pretui-sheet[data-density='roomy'] {
          --pretui-sheet-row-h: 40px;
          --pretui-sheet-cell-pad: 0 14px;
        }

        .pretui-sheet-bar {
          padding: var(--space-3, 8px);
          box-shadow: inset 0 -1px 0 var(--border);
        }

        /* The engine paints nothing at chrome='none'; the scroller stays. */
        .pretui-sheet-grid {
          border: 0;
          background: transparent;
          min-width: 0;
        }
        .pretui-sheet-grid:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          box-shadow: none;
        }

        /* ── header ─────────────────────────────────────────────────────
           A real role="row" wrapping the columnheaders (upstream's example
           omits it — invalid ARIA). `subgrid` threads the ONE column
           template the Grid put on the header wrapper, so header and body
           tracks can never disagree. */
        .pretui-sheet-hrow {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: subgrid;
          min-width: 100%;
          background: var(--pretui-sheet-head-bg, var(--inset, #f7f8f9));
          box-shadow:
            inset 0 -1px 0 var(--pretui-sheet-line, var(--line-strong, #dfe2e7)),
            0 6px 8px -8px rgb(19 20 22 / 0.28);
        }
        .pretui-sheet-h {
          display: flex;
          align-items: center;
          min-width: 0;
          min-height: var(--pretui-sheet-head-h, 30px);
          padding: 0 10px;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
          white-space: nowrap;
        }
        .pretui-sheet-h[data-align='end'] {
          justify-content: flex-end;
        }
        .pretui-sheet-h[data-align='center'] {
          justify-content: center;
        }
        .pretui-sheet-h[data-dir] {
          color: var(--foreground);
        }
        .pretui-sheet-hbtn,
        .pretui-sheet-hstatic {
          display: inline-flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          letter-spacing: inherit;
          text-transform: inherit;
          color: inherit;
        }
        .pretui-sheet-hbtn {
          cursor: pointer;
          border-radius: var(--radius-sm, 5px);
        }
        .pretui-sheet-hbtn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-sheet-hlabel {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-sheet-hhint {
          font-size: 0.85em;
          letter-spacing: 0;
          text-transform: none;
          color: var(--ink-3, #9a9da3);
        }
        /* The caret is the sort state made visible in a still frame (Law 8);
           the transition only encodes asc→desc, and reduced motion keeps the
           END state. */
        .pretui-sheet-caret {
          width: 0;
          height: 0;
          border-left: 3.5px solid transparent;
          border-right: 3.5px solid transparent;
          border-bottom: 4px solid currentColor;
          opacity: 0;
          transform: rotate(0deg);
          transition:
            opacity var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease),
            transform var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
        }
        /* the caret is the "this column sorts" hint, so it must appear on the
           keyboard path too — hover-only leaves a tabbing user with no cue */
        .pretui-sheet-hbtn:hover .pretui-sheet-caret,
        .pretui-sheet-hbtn:focus-visible .pretui-sheet-caret {
          opacity: 0.35;
        }
        .pretui-sheet-h[data-dir] .pretui-sheet-caret {
          opacity: 1;
        }
        .pretui-sheet-h[data-dir='desc'] .pretui-sheet-caret {
          transform: rotate(180deg);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-sheet-caret {
            transition: none;
          }
        }

        /* ── rows ───────────────────────────────────────────────────────
           Backgrounds live on the ROW so pinned cells can inherit them and
           stay opaque while the body scrolls sideways. */
        .pretui-sheet-row {
          min-width: 0;
          background: var(--pretui-sheet-surface, var(--card));
        }
        .pretui-sheet-row[data-zebra='1'] {
          background: var(--pretui-sheet-stripe, var(--stripe, #f5f5f5));
        }
        .pretui-sheet-row:hover {
          background: var(--pretui-sheet-hover, var(--hover, #f4f5f6));
        }

        /* ── cells ──────────────────────────────────────────────────────
           The engine stamps data-bx-grid-active / -in-range / -editing onto
           the cell as runtime state changes; these rules are the Pretui
           re-cut of those states. Order matters: state rules come last so
           they beat the pin rule at equal specificity. */
        .pretui-sheet-cell {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          box-shadow:
            inset -1px 0 0 var(--pretui-sheet-line-soft, var(--border)),
            inset 0 -1px 0 var(--pretui-sheet-line-soft, var(--border));
        }
        .pretui-sheet-cell[data-align='end'] {
          text-align: right;
        }
        .pretui-sheet-cell[data-align='center'] {
          text-align: center;
        }
        .pretui-sheet-cell[data-mono='1'] {
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11.5px);
          font-variant-numeric: tabular-nums;
        }
        /* Sticky first column — honest CSS, not the engine's column pinning
           (see the module header). `background: inherit` takes the row's
           computed colour, so zebra and hover survive the pin. */
        .pretui-sheet-cell[data-pin='start'],
        .pretui-sheet-h[data-pin='start'] {
          position: sticky;
          left: 0;
          /* kit stacking scale (pretui-css.gts) — the ad-hoc --z-sticky-* pair
             this replaced was outside the scale and could not be ordered
             against anything else that floats. */
          z-index: var(--pretui-z-sticky, 10);
          background: inherit;
          box-shadow:
            inset -1px 0 0 var(--pretui-sheet-line, var(--line-strong, #dfe2e7)),
            inset 0 -1px 0 var(--pretui-sheet-line-soft, var(--border)),
            6px 0 8px -8px rgb(19 20 22 / 0.35);
        }
        .pretui-sheet-h[data-pin='start'] {
          z-index: var(--pretui-z-sticky-header, 11);
          background: var(--pretui-sheet-head-bg, var(--inset, #f7f8f9));
        }
        .pretui-sheet-cell[data-bx-grid-in-range] {
          background: var(
            --pretui-sheet-range,
            color-mix(
              in oklch,
              var(--pretui-sheet-accent, var(--primary)) 5%,
              transparent
            )
          );
        }
        .pretui-sheet-cell[data-bx-grid-active] {
          background: var(
            --pretui-sheet-cell-focus,
            color-mix(
              in oklch,
              var(--pretui-sheet-accent, var(--primary)) 8%,
              transparent
            )
          );
          box-shadow: inset 0 0 0 2px var(--ring);
        }
        .pretui-sheet-cell[data-bx-grid-editing] {
          background: var(--pretui-sheet-editor-bg, var(--card));
          box-shadow: inset 0 0 0 1px
            var(--pretui-sheet-line, var(--line-strong, #dfe2e7));
        }

        .pretui-sheet-empty {
          padding: var(--space-6, 19px);
          box-shadow: inset 0 1px 0 var(--border);
        }

        /* ── footer ─────────────────────────────────────────────────────
           role="status" — the one live region. Sort and filter changes are
           otherwise silent to a screen reader. */
        .pretui-sheet-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4, 11px);
          padding: 6px 10px;
          box-shadow: inset 0 1px 0 var(--border);
        }
        .pretui-sheet-status {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--muted-foreground);
        }
        .pretui-sheet-footslot {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          min-width: 0;
        }

        @container (max-width: 30rem) {
          .pretui-sheet-hhint {
            display: none;
          }
        }
      }
    </style>
  </template>
}
