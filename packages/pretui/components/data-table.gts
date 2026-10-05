// Pretui — DataTable: the record listing: sort, filter, select, paginate and column visibility.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { cssDeclaration, cssStyleFrom, cssValue } from '../pretui-css';
import { DataShell, DataSource } from '../data-component';
import type { DataArgs, DataLoad, RowKey, RowKeyFn, SelectionMode, SortState } from '../data-component';
import { Button } from './button';
import { FilterChips } from './filter-chips';
import type { FilterChipOption } from './filter-chips';
import type { PretuiSize } from '../pretui-primitives';
import { EmptyState } from './empty-state';
import { Pagination } from './pagination';
import { Menu } from './menu';
import type { MenuEntry } from '../internal/menu';
import { rovingTabindex } from '../focus';
import { printValue, readField, setsIndeterminate } from '../internal/reading-listing';
import type { ListingSizeArg } from '../internal/reading-listing';
import { resolveSize } from '../pretui-primitives';

// ═════════════════════════════════════════════════════════════════════════
// DataTable — the record listing
// ═════════════════════════════════════════════════════════════════════════

/** Where a column's content sits. Logical, so RTL is free. */
export type ColumnAlign = 'start' | 'end' | 'center';
/** Which edge a column pins to. */
export type ColumnPin = 'start' | 'end';
/** A filter's current value: a query string, or the chosen enum values. */
export type FilterValue = string | readonly string[];
/** The whole filter state, keyed by column. */
export type FilterState = Record<string, FilterValue>;

/** One choice in an `'options'` filter — the same shape `FilterChips` takes,
 * because that is what renders it. */
export type ColumnFilterOption = FilterChipOption;

export interface ColumnFilter<T> {
  /** `'text'` is a case-insensitive contains match over the cell's printed
   * value; `'options'` is a multi-select over a fixed set. */
  kind: 'text' | 'options';
  /** the choices, for `kind: 'options'` */
  options?: ColumnFilterOption[];
  /** replaces the built-in matcher — the hook for dates, ranges, nested
   * paths, or anything the printed value cannot express */
  match?: (row: T, value: FilterValue) => boolean;
}

export interface DataColumn<T> {
  /** identity, default field read, and sort key */
  key: string;
  /** header text, and the column's name in the column menu */
  label: string;
  /** read the cell's value; defaults to `row[key]` */
  value?: (row: T) => unknown;
  /** `false` opts this column out of sorting; unset follows `@sortable` */
  sortable?: boolean;
  /** `'start'` (default), `'end'` for numbers, `'center'` for glyphs */
  align?: ColumnAlign;
  /** machine value — mono, tabular numerals, `'end'` alignment implied for
   * numbers (mono is for machine values only) */
  mono?: boolean;
  /** any CSS length. REQUIRED on a pinned column and on every pinned column
   * before it — offsets are summed from declared widths, never measured. */
  width?: string;
  /** pin to the inline start or end while the table scrolls sideways */
  pin?: ColumnPin;
  /** Ant's spelling: `true` means `'start'` */
  fixed?: ColumnPin | true;
  /** start hidden (still listed, and re-showable, in the column menu) */
  hidden?: boolean;
  /** never hideable — the identity column */
  alwaysVisible?: boolean;
  /** per-column filter, surfaced in the toolbar */
  filter?: ColumnFilter<T>;
}

interface HeaderCell<T> {
  key: string;
  col: DataColumn<T>;
  label: string;
  align: ColumnAlign;
  mono: string | undefined;
  sortable: boolean;
  ariaSort: 'ascending' | 'descending' | 'none' | undefined;
  mark: string;
  hint: string;
  pin: ColumnPin | undefined;
  filtered: string | undefined;
  style: ReturnType<typeof cssStyleFrom>;
}

interface BodyCell<T> {
  key: string;
  col: DataColumn<T>;
  value: unknown;
  text: string;
  align: ColumnAlign;
  mono: string | undefined;
  pin: ColumnPin | undefined;
  style: ReturnType<typeof cssStyleFrom>;
}

interface TableLine<T> {
  key: RowKey;
  row: T;
  index: number;
  cells: BodyCell<T>[];
  selected: boolean;
  ariaSelected: 'true' | 'false' | undefined;
  selectedFlag: string | undefined;
  expanded: boolean;
  expandedFlag: 'true' | 'false';
  detailId: string;
  label: string;
}

interface FilterControl<T> {
  key: string;
  col: DataColumn<T>;
  isText: boolean;
  label: string;
  text: string;
  values: string[];
  options: ColumnFilterOption[];
}

export interface DataTableSignature<T> {
  Args: {
    /** the column model, in display order */
    columns: DataColumn<T>[];
    /** the records. `@rows` is the tabular-collection noun (the List-ish
     * contract); `@dataSource` is Ant's spelling and is accepted. */
    rows?: readonly T[];
    /** alias for `@rows` */
    dataSource?: readonly T[];
    /** async loader — see `DataArgs.load`. Filters still apply, in the
     * browser, over whatever the loader returned. To filter at the source
     * instead, feed `@filters` into `@loadKey`. */
    load?: DataLoad<T>;
    /** re-run `@load` whenever this changes. No debounce — that is a timer. */
    loadKey?: unknown;
    /** stable identity for a row. Pass it: a listing sorts, and an
     * index-keyed row's identity MOVES when it does. */
    key?: RowKeyFn<T>;
    /** the table's accessible name, rendered as a real `<caption>` */
    caption?: string;
    /** accessible name when there should be no visible caption */
    label?: string;
    /** density — `xs|s|m|l|xl`, `sm`/`md`/`lg`/`middle` accepted */
    size?: ListingSizeArg;
    /** every column is sortable unless it says otherwise (default true) */
    sortable?: boolean;
    /** controlled sort */
    sort?: SortState | null;
    /** uncontrolled seed */
    defaultSort?: SortState | null;
    /** fires on every step of the asc → desc → unsorted cycle */
    onSortChange?: (sort: SortState | null) => void;
    /** replaces the default field comparator; return ASCENDING order */
    comparator?: (a: T, b: T, sort: SortState) => number;
    /** `'none'` (default), `'single'` or `'multi'` */
    selectionMode?: SelectionMode;
    /** controlled selection */
    selected?: readonly RowKey[];
    /** uncontrolled seed */
    defaultSelected?: readonly RowKey[];
    /** fires with the next selection on every change */
    onSelectionChange?: (keys: RowKey[], rows: T[]) => void;
    /** controlled column visibility — the keys that are SHOWN */
    visibleColumns?: readonly string[];
    /** uncontrolled seed; defaults to every column without `hidden` */
    defaultVisibleColumns?: readonly string[];
    /** fires with the next visible set */
    onVisibleColumnsChange?: (keys: string[]) => void;
    /** show the column-visibility menu (default true when anything is
     * hideable) */
    columnMenu?: boolean;
    /** controlled filter state, keyed by column */
    filters?: Readonly<FilterState>;
    /** uncontrolled seed */
    defaultFilters?: Readonly<FilterState>;
    /** fires with the next filter state on every change */
    onFiltersChange?: (filters: FilterState) => void;
    /** controlled expanded rows */
    expandedKeys?: readonly RowKey[];
    /** uncontrolled seed */
    defaultExpandedKeys?: readonly RowKey[];
    /** fires with the next expanded set */
    onExpandedChange?: (keys: RowKey[]) => void;
    /** rows per page. Unset (default) renders every row and no pager. */
    pageSize?: number;
    /** controlled page (1-based) */
    page?: number;
    /** uncontrolled seed */
    defaultPage?: number;
    /** fires with the next page */
    onPageChange?: (page: number) => void;
    /** the row's accessible name, used on its selection control and its
     * expander. Defaults to `Row N` — pass this. */
    rowLabel?: (row: T, index: number) => string;
    /** zebra striping (default true) */
    striped?: boolean;
    /** header sticks while the body scrolls (default true) */
    stickyHeader?: boolean;
    /** minimum table width before the scroller takes over (any CSS length).
     * Mantine's `Table.ScrollContainer` requires this and is right to. */
    minWidth?: string;
    /** a caller-driven pending state: `aria-busy` and a dimmed body, with
     * focus and scroll position kept */
    busy?: boolean;
    /** alias for `@busy` */
    loading?: boolean;
    /** rendered for an empty cell (default '—') */
    placeholder?: string;
    /** noun for the polite result count ('lot' → '6 of 24 lots') */
    itemNoun?: string;
    emptyTitle?: string;
    emptyMessage?: string;
    loadingLabel?: string;
    skeletonRows?: number;
  };
  Blocks: {
    /**
     * One cell. There is one block for every column, so switch on
     * `col.key` — that is `<DataGrid>`'s contract and it stays the same one.
     *
     * The first param is the PRINTED value: a string, already through the
     * `@placeholder` rule. It is not the raw field, and that is deliberate.
     * A generic row's field is `unknown`, and a
     * caller should never have to narrow `unknown` inside a template — if
     * they must, the component's types are wrong. The row itself is the
     * second param, fully typed, so `{{row.kg}}` is always available.
     */
    cell: [text: string, row: T, col: DataColumn<T>];
    /** per-row detail. Supplying it turns on the expander column. */
    expanded: [row: T];
    /** the row's action affordance — a Menu, an IconButton */
    actions: [row: T];
    /** extra toolbar content, before the built-in filters */
    toolbar: [];
    /** replaces the default EmptyState */
    empty: [];
    /** replaces the default spinner + skeleton */
    loading: [];
    /** replaces the default Alert */
    error: [];
  };
  Element: HTMLDivElement;
}

export class DataTable<T> extends Component<DataTableSignature<T>> {
  private guid = guidFor(this);

  /**
   * TWO state machines, and the split is the design.
   *
   * `loader` owns the LOAD: status, `aria-busy`, retry, the four state
   * slots. `table` owns the VIEW: sort, selection, the row-key contract —
   * over rows that have ALREADY been filtered.
   *
   * One machine could not do both. Filtering has to happen before selection
   * so that "select all" means "select all the rows you can see", and before
   * sorting so the two never disagree; but `DataSource` deliberately does not
   * filter (a filter model that cannot be `rows.filter(...)` is a query, not
   * a component). Stacking the two is one line each and no new state.
   */
  loader = new DataSource<T>(() => this.loaderArgs);
  table = new DataSource<T>(() => this.tableArgs);

  @tracked private internalVisible: readonly string[] | undefined = undefined;
  @tracked private internalFilters: FilterState | undefined = undefined;
  @tracked private internalExpanded: readonly RowKey[] | undefined = undefined;
  @tracked private internalPage: number | undefined = undefined;

  // ── args plumbing ──────────────────────────────────────────────────────

  private get loaderArgs(): DataArgs<T> {
    let a = this.args;
    return {
      rows: a.rows ?? a.dataSource,
      load: a.load,
      loadKey: a.loadKey,
      key: a.key,
      // This component owns its own count announcement, because the honest
      // one is "6 of 24" and only this layer knows the 24.
      silentCount: true,
      emptyTitle: a.emptyTitle,
      emptyMessage: a.emptyMessage,
      loadingLabel: a.loadingLabel,
      skeletonRows: a.skeletonRows,
    };
  }

  private get tableArgs(): DataArgs<T> {
    let a = this.args;
    return {
      rows: this.filteredRows,
      key: a.key,
      selectionMode: a.selectionMode,
      selected: a.selected,
      defaultSelected: a.defaultSelected,
      onSelectionChange: a.onSelectionChange,
      sort: a.sort,
      defaultSort: a.defaultSort,
      onSortChange: a.onSortChange,
      comparator: a.comparator,
      silentCount: true,
    };
  }

  // ── shape ──────────────────────────────────────────────────────────────

  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  get placeholder(): string {
    return this.args.placeholder ?? '—';
  }
  get itemNoun(): string {
    return this.args.itemNoun ?? 'result';
  }
  get striped(): string | undefined {
    return (this.args.striped ?? true) ? 'true' : undefined;
  }
  get sticky(): string | undefined {
    return (this.args.stickyHeader ?? true) ? 'true' : undefined;
  }
  get busy(): 'true' | undefined {
    return this.args.busy ?? this.args.loading ? 'true' : undefined;
  }
  get selectionMode(): SelectionMode {
    return this.table.selectionMode;
  }
  get selectable(): boolean {
    return this.selectionMode !== 'none';
  }
  get multi(): boolean {
    return this.selectionMode === 'multi';
  }
  get radioName(): string {
    return this.guid + '-dt';
  }
  get scrollLabel(): string {
    return this.args.label ?? this.args.caption ?? 'Table';
  }
  get scrollStyle() {
    return cssStyleFrom([cssDeclaration('--pretui-dt-min-w', this.args.minWidth)]);
  }

  labelFor = (row: T, index: number): string =>
    this.args.rowLabel?.(row, index) ?? 'Row ' + String(index + 1);

  // ── columns ────────────────────────────────────────────────────────────

  get allColumns(): DataColumn<T>[] {
    return this.args.columns ?? [];
  }

  private pinOf(col: DataColumn<T>): ColumnPin | undefined {
    if (col.pin) {
      return col.pin;
    }
    return col.fixed === true ? 'start' : (col.fixed ?? undefined);
  }

  get visibleKeys(): readonly string[] {
    if (this.args.visibleColumns !== undefined) {
      return this.args.visibleColumns;
    }
    if (this.internalVisible !== undefined) {
      return this.internalVisible;
    }
    return (
      this.args.defaultVisibleColumns ??
      this.allColumns.filter((c) => !c.hidden).map((c) => c.key)
    );
  }

  isColumnVisible = (key: string): boolean => this.visibleKeys.includes(key);

  get columns(): DataColumn<T>[] {
    let shown = this.visibleKeys;
    return this.allColumns.filter(
      (c) => c.alwaysVisible || shown.includes(c.key),
    );
  }

  get hideableColumns(): DataColumn<T>[] {
    return this.allColumns.filter((c) => !c.alwaysVisible);
  }

  get showColumnMenu(): boolean {
    return (this.args.columnMenu ?? true) && this.hideableColumns.length > 0;
  }

  toggleColumn = (key: string) => {
    let current = this.visibleKeys;
    let next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...this.allColumns.map((c) => c.key).filter(
          (k) => k === key || current.includes(k),
        )];
    if (this.args.visibleColumns === undefined) {
      this.internalVisible = next;
    }
    this.args.onVisibleColumnsChange?.(next);
  };

  get columnMenuItems(): MenuEntry[] {
    return this.hideableColumns.map((col) => ({
      kind: 'toggle' as const,
      label: col.label,
      checked: this.isColumnVisible(col.key),
      onSelect: () => this.toggleColumn(col.key),
    }));
  }

  // ── pinning ────────────────────────────────────────────────────────────
  //
  // Offsets are SUMMED from declared widths. A pinned column whose
  // predecessors are not all measurable is left unpinned rather than laid on
  // top of one of them: a visible loss of the pin beats an invisible overlap.

  get hasStartPin(): boolean {
    return this.allColumns.some((c) => this.pinOf(c) === 'start');
  }
  get hasEndPin(): boolean {
    return this.allColumns.some((c) => this.pinOf(c) === 'end');
  }
  /** the pin the leading control columns wear, when anything pins start */
  get leadPin(): ColumnPin | undefined {
    return this.hasStartPin ? 'start' : undefined;
  }
  /** the pin the trailing actions column wears, when anything pins end */
  get tailPin(): ColumnPin | undefined {
    return this.hasEndPin ? 'end' : undefined;
  }

  private get pinOffsets(): Map<string, string | undefined> {
    let out = new Map<string, string | undefined>();
    // The control columns' combined width is resolved in CSS, not here:
    // whether the expander and actions columns exist is a `has-block` fact,
    // and `has-block` only exists inside the template. `--pretui-dt-lead`
    // and `--pretui-dt-tail` are computed from data attributes and classes
    // the template sets, so the offset arithmetic works either way.
    let parts: string[] = ['var(--pretui-dt-lead, 0px)'];
    let broken = false;
    for (let col of this.columns) {
      if (this.pinOf(col) !== 'start') {
        continue;
      }
      out.set(col.key, broken ? undefined : this.offsetExpression(parts));
      let width = cssValue(col.width);
      if (width === undefined) {
        broken = true;
      } else {
        parts.push(width);
      }
    }
    // End pins accumulate from the trailing edge, so walk backwards.
    let tail: string[] = ['var(--pretui-dt-tail, 0px)'];
    let tailBroken = false;
    let reversed = this.columns.slice().reverse();
    for (let col of reversed) {
      if (this.pinOf(col) !== 'end') {
        continue;
      }
      out.set(col.key, tailBroken ? undefined : this.offsetExpression(tail));
      let width = cssValue(col.width);
      if (width === undefined) {
        tailBroken = true;
      } else {
        tail.push(width);
      }
    }
    return out;
  }

  /** Every part is already through `cssValue` or an authored literal, so the
   * declaration is built rather than re-validated (pretui-css's contract). */
  private offsetExpression(parts: readonly string[]): string {
    if (parts.length === 0) {
      return '0px';
    }
    if (parts.length === 1) {
      return parts[0] as string;
    }
    return 'calc(' + parts.join(' + ') + ')';
  }

  private cellStyle(col: DataColumn<T>): ReturnType<typeof cssStyleFrom> {
    let pin = this.pinOf(col);
    let offset = pin ? this.pinOffsets.get(col.key) : undefined;
    let side = pin === 'end' ? 'inset-inline-end' : 'inset-inline-start';
    return cssStyleFrom([
      cssDeclaration('width', col.width),
      offset === undefined ? undefined : side + ': ' + offset,
    ]);
  }

  private pinAttr(col: DataColumn<T>): ColumnPin | undefined {
    let pin = this.pinOf(col);
    if (!pin) {
      return undefined;
    }
    return this.pinOffsets.get(col.key) === undefined ? undefined : pin;
  }

  private alignOf(col: DataColumn<T>): ColumnAlign {
    return col.align ?? 'start';
  }

  // ── filtering ──────────────────────────────────────────────────────────

  get filterState(): FilterState {
    if (this.args.filters !== undefined) {
      return this.args.filters as FilterState;
    }
    return this.internalFilters ?? (this.args.defaultFilters as FilterState) ?? {};
  }

  get filterControls(): FilterControl<T>[] {
    let state = this.filterState;
    let out: FilterControl<T>[] = [];
    for (let col of this.columns) {
      let spec = col.filter;
      if (!spec) {
        continue;
      }
      let raw = state[col.key];
      out.push({
        key: col.key,
        col,
        isText: spec.kind !== 'options',
        label: col.label,
        text: typeof raw === 'string' ? raw : '',
        values: Array.isArray(raw) ? [...(raw as string[])] : [],
        options: spec.options ?? [],
      });
    }
    return out;
  }

  get hasFilters(): boolean {
    return this.activeFilterKeys.length > 0;
  }

  get activeFilterKeys(): string[] {
    let state = this.filterState;
    return Object.keys(state).filter((key) => {
      let value = state[key];
      return typeof value === 'string'
        ? value.trim().length > 0
        : Array.isArray(value) && value.length > 0;
    });
  }

  isFiltered = (key: string): boolean => this.activeFilterKeys.includes(key);

  private commitFilters(next: FilterState) {
    if (this.args.filters === undefined) {
      this.internalFilters = next;
    }
    // A filter change moves the reader to a different result set; page 1 is
    // the only page guaranteed to exist in it.
    this.goToPage(1);
    this.args.onFiltersChange?.(next);
  }

  setTextFilter = (key: string, event: Event) => {
    let field = event.target as HTMLInputElement;
    this.commitFilters({ ...this.filterState, [key]: field.value });
    // controlled @filters: show what the owner holds, not the rejected keystroke
    let held = this.filterState[key];
    let text = typeof held === 'string' ? held : '';
    if (field.value !== text) {
      field.value = text;
    }
  };

  setOptionFilter = (key: string, values: string[]) => {
    this.commitFilters({ ...this.filterState, [key]: values });
  };

  clearFilters = () => {
    this.commitFilters({});
  };

  private matches(col: DataColumn<T>, row: T, value: FilterValue): boolean {
    let spec = col.filter;
    if (!spec) {
      return true;
    }
    if (spec.match) {
      return spec.match(row, value);
    }
    if (spec.kind === 'options') {
      let wanted = value as readonly string[];
      return wanted.includes(String(this.rawValue(col, row)));
    }
    let query = String(value).trim().toLowerCase();
    if (query.length === 0) {
      return true;
    }
    return printValue(this.rawValue(col, row), '')
      .toLowerCase()
      .includes(query);
  }

  private rawValue(col: DataColumn<T>, row: T): unknown {
    return col.value ? col.value(row) : readField(row, col.key);
  }

  /** Filter over the RAW loaded rows, before sort and before selection. */
  get filteredRows(): readonly T[] {
    let rows = this.loader.rows;
    let keys = this.activeFilterKeys;
    if (keys.length === 0) {
      return rows;
    }
    let state = this.filterState;
    let cols = this.allColumns.filter(
      (c) => c.filter !== undefined && keys.includes(c.key),
    );
    if (cols.length === 0) {
      return rows;
    }
    return rows.filter((row) =>
      cols.every((col) => this.matches(col, row, state[col.key] as FilterValue)),
    );
  }

  // ── expansion ──────────────────────────────────────────────────────────
  //
  // Whether the expander and actions columns exist is a `has-block` fact, and
  // `has-block` only exists inside the template. It is NOT smuggled into a
  // tracked field through a modifier: that field is read during the same
  // render that would write it, which is the backtracking re-render
  // assertion. Everything that needs the fact takes it as an argument
  // (`colspanFor`, `showToolbarWith`) or resolves it in CSS.

  get expandedKeys(): readonly RowKey[] {
    if (this.args.expandedKeys !== undefined) {
      return this.args.expandedKeys;
    }
    return this.internalExpanded ?? this.args.defaultExpandedKeys ?? [];
  }

  isExpanded = (key: RowKey): boolean => this.expandedKeys.includes(key);

  toggleExpanded = (key: RowKey) => {
    let current = this.expandedKeys;
    let next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    if (this.args.expandedKeys === undefined) {
      this.internalExpanded = next;
    }
    this.args.onExpandedChange?.([...next]);
  };

  detailId = (key: RowKey): string => this.guid + '-d-' + String(key);

  // ── paging ─────────────────────────────────────────────────────────────

  get pageSize(): number {
    let n = this.args.pageSize ?? 0;
    return n > 0 ? Math.floor(n) : 0;
  }
  get paged(): boolean {
    return this.pageSize > 0;
  }
  get pageCount(): number {
    return this.paged
      ? Math.max(1, Math.ceil(this.table.count / this.pageSize))
      : 1;
  }
  get page(): number {
    let raw = this.args.page ?? this.internalPage ?? this.args.defaultPage ?? 1;
    return Math.min(this.pageCount, Math.max(1, Math.floor(raw)));
  }
  goToPage = (next: number) => {
    if (this.args.page === undefined) {
      this.internalPage = next;
    }
    this.args.onPageChange?.(next);
  };

  get pageRows(): T[] {
    let rows = this.table.visibleRows;
    if (!this.paged) {
      return rows;
    }
    let start = (this.page - 1) * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }

  // ── the rendered model ─────────────────────────────────────────────────

  get headers(): HeaderCell<T>[] {
    let sortableDefault = this.args.sortable ?? true;
    return this.columns.map((col) => {
      let sortable = col.sortable ?? sortableDefault;
      let state = this.table.ariaSort(col.key);
      return {
        key: col.key,
        col,
        label: col.label,
        align: this.alignOf(col),
        mono: col.mono ? 'true' : undefined,
        sortable,
        ariaSort: sortable ? state : undefined,
        mark: state === 'ascending' ? '↑' : state === 'descending' ? '↓' : '↕',
        hint: this.sortHint(state),
        pin: this.pinAttr(col),
        filtered: this.isFiltered(col.key) ? 'true' : undefined,
        style: this.cellStyle(col),
      };
    });
  }

  /** The visually hidden mirror inside the sort button. MUI's demo ships the
   * current state only; naming the NEXT one is what makes the button's
   * behaviour predictable without activating it. */
  private sortHint(state: 'ascending' | 'descending' | 'none'): string {
    if (state === 'ascending') {
      return 'sorted ascending — activate to sort descending';
    }
    if (state === 'descending') {
      return 'sorted descending — activate to remove the sort';
    }
    return 'not sorted — activate to sort ascending';
  }

  sortBy = (key: string) => {
    this.table.toggleSort(key);
  };

  /** Where the current page starts inside the filtered set. Every index
   * handed to the row-key contract is ABSOLUTE, not page-local: without a
   * `@key` the documented fallback is the index, and a page-local index
   * would give page 2's first row the same identity as page 1's — selection
   * and expansion would leak between pages. */
  get pageOffset(): number {
    return this.paged ? (this.page - 1) * this.pageSize : 0;
  }

  get lines(): TableLine<T>[] {
    let cols = this.columns;
    let offset = this.pageOffset;
    return this.pageRows.map((row, i) => {
      let index = offset + i;
      let key = this.table.keyFor(row, index);
      let selected = this.table.isSelected(row, index);
      let expanded = this.isExpanded(key);
      return {
        key,
        row,
        index,
        selected,
        ariaSelected: this.selectable
          ? selected
            ? ('true' as const)
            : ('false' as const)
          : undefined,
        selectedFlag: selected ? 'true' : undefined,
        expanded,
        expandedFlag: expanded ? ('true' as const) : ('false' as const),
        detailId: this.detailId(key),
        label: this.labelFor(row, index),
        cells: cols.map((col) => {
          let value = this.rawValue(col, row);
          return {
            key: col.key,
            col,
            value,
            text: printValue(value, this.placeholder),
            align: this.alignOf(col),
            mono: col.mono ? 'true' : undefined,
            pin: this.pinAttr(col),
            style: this.cellStyle(col),
          };
        }),
      };
    });
  }

  /** Columns spanned by every detail row. Takes the two block facts as
   * arguments because they are only knowable inside the template. */
  colspanFor = (expandable: boolean, actions: boolean): number =>
    this.columns.length +
    (this.selectable ? 1 : 0) +
    (expandable ? 1 : 0) +
    (actions ? 1 : 0);

  /** The toolbar earns its space when it has something in it — an empty bar
   * above a table is chrome pretending to be a feature. A selectable table
   * only grows one once something IS selected. */
  showToolbarWith = (extra: boolean): boolean =>
    extra ||
    this.filterControls.length > 0 ||
    this.showColumnMenu ||
    this.hasSelection;

  // ── selection ──────────────────────────────────────────────────────────

  /**
   * Select-all covers the WHOLE filtered result set, not the current page.
   *
   * shadcn and Ant both scope it to the page and then bolt on a second
   * "select all N" affordance, which leaves the reader to work out which of
   * two checkboxes they just clicked. One meaning is better than two, and
   * the ambiguity that makes whole-set selection a footgun is removed by
   * naming the count in the control's accessible name — "Select all 24
   * lots" cannot be mistaken for "select these six".
   */
  get allSelected(): boolean {
    return this.table.allSelected;
  }
  get someSelected(): boolean {
    return !this.allSelected && this.selectedCount > 0;
  }
  get selectedCount(): number {
    return this.table.selectedKeys.length;
  }
  get hasSelection(): boolean {
    return this.selectedCount > 0;
  }
  get selectAllLabel(): string {
    let verb = this.allSelected ? 'Deselect all ' : 'Select all ';
    let noun = this.shown === 1 ? this.itemNoun : this.itemNoun + 's';
    return verb + String(this.shown) + ' ' + noun;
  }

  // A controlled @selected may not take the change; the browser has already
  // flipped the box, so set it back from the selection state.
  toggleRow = (row: T, index: number, event: Event) => {
    let box = event.target as HTMLInputElement;
    this.table.toggleSelected(row, index);
    if (box.type === 'radio') {
      // the browser unchecked the group's previous radio too; put every radio
      // back to what its row says, which is the owner's selection
      let table = box.closest('table');
      table?.querySelectorAll<HTMLInputElement>('input.pretui-dt-radio').forEach((radio) => {
        radio.checked = radio.closest('tr')?.getAttribute('aria-selected') === 'true';
      });
      box.checked = this.table.isSelected(row, index);
    } else {
      box.checked = this.table.isSelected(row, index);
    }
  };
  toggleAll = (event: Event) => {
    let box = event.target as HTMLInputElement;
    this.table.selectAll();
    box.checked = this.allSelected;
    box.indeterminate = this.someSelected;
  };
  clearSelection = () => {
    this.table.clearSelection();
  };

  // ── counts and the announcement ────────────────────────────────────────

  get total(): number {
    return this.loader.rows.length;
  }
  get shown(): number {
    return this.table.count;
  }
  get noResults(): boolean {
    return this.loader.status === 'ready' && this.shown === 0;
  }

  /**
   * Derived only from SETTLED state, so a filter keystroke that re-queries
   * announces once when the results land rather than once per key — the same
   * rule `DataSource` enforces, restated here because this layer knows the
   * honest number ("6 of 24") and that one does not.
   */
  get announcement(): string {
    let status = this.loader.status;
    if (status === 'loading' || status === 'idle') {
      return '';
    }
    let noun = this.itemNoun;
    let plural = noun + 's';
    if (this.shown === 0) {
      return 'No ' + plural;
    }
    if (this.shown === this.total) {
      return (
        String(this.shown) + ' ' + (this.shown === 1 ? noun : plural)
      );
    }
    return String(this.shown) + ' of ' + String(this.total) + ' ' + plural;
  }

  get selectionSummary(): string {
    return (
      String(this.selectedCount) +
      ' of ' +
      String(this.shown) +
      ' selected'
    );
  }

  expandLabel = (line: TableLine<T>): string =>
    (line.expanded ? 'Collapse ' : 'Expand ') + line.label;

  <template>
    <div
      class='pretui-dt'
      data-test-pretui-datatable
      data-size={{this.size}}
      data-pick={{if this.selectable 'true'}}
      data-detail={{if (has-block 'expanded') 'true'}}
      data-actions={{if (has-block 'actions') 'true'}}
      data-striped={{this.striped}}
      data-sticky={{this.sticky}}
      aria-busy={{this.busy}}
      ...attributes
    >
      {{!-- The live region is always present and always empty to start: an
            aria-live element inserted with text already in it is not
            reliably announced. --}}
      <p class='pretui-sr' role='status' data-test-pretui-dt-live>
        {{this.announcement}}
      </p>

      {{#if (this.showToolbarWith (has-block 'toolbar'))}}
        <div class='pretui-dt-bar'>
          {{#if (has-block 'toolbar')}}
            <div class='pretui-dt-bar-slot'>{{yield to='toolbar'}}</div>
          {{/if}}

          {{#each this.filterControls key='key' as |control|}}
            {{#if control.isText}}
              <label class='pretui-dt-filter'>
                <span class='pretui-dt-filter-label'>{{control.label}}</span>
                <input
                  type='search'
                  class='pretui-dt-filter-input'
                  value={{control.text}}
                  data-test-pretui-dt-filter
                  {{on 'input' (fn this.setTextFilter control.key)}}
                />
              </label>
            {{else}}
              <div class='pretui-dt-filter pretui-dt-filter-chips'>
                <FilterChips
                  @label={{control.label}}
                  @options={{control.options}}
                  @multiple={{true}}
                  @values={{control.values}}
                  @onValuesChange={{fn this.setOptionFilter control.key}}
                />
              </div>
            {{/if}}
          {{/each}}

          {{#if this.hasFilters}}
            <Button
              @appearance='plain'
              @size='s'
              data-test-pretui-dt-clear
              {{on 'click' this.clearFilters}}
            >Clear filters</Button>
          {{/if}}

          <span class='pretui-dt-bar-gap'></span>

          {{#if this.hasSelection}}
            <span class='pretui-dt-selcount'>{{this.selectionSummary}}</span>
            <Button
              @appearance='plain'
              @size='s'
              {{on 'click' this.clearSelection}}
            >Clear</Button>
          {{/if}}

          {{#if this.showColumnMenu}}
            <Menu
              @items={{this.columnMenuItems}}
              @label='Columns'
              @align='end'
            >
              <:trigger as |isOpen toggle|>
                <Button
                  @appearance='outlined'
                  @size='s'
                  data-open={{if isOpen 'true'}}
                  data-test-pretui-dt-columns
                  {{on 'click' toggle}}
                >Columns</Button>
              </:trigger>
            </Menu>
          {{/if}}
        </div>
      {{/if}}

      <DataShell
        @state={{this.loader}}
        @hasLoading={{has-block 'loading'}}
        @hasEmpty={{has-block 'empty'}}
        @hasError={{has-block 'error'}}
        @emptyTitle={{@emptyTitle}}
        @emptyMessage={{@emptyMessage}}
        @loadingLabel={{@loadingLabel}}
        @skeletonRows={{@skeletonRows}}
      >
        <:default>
          {{!-- A scrollable box is a keyboard trap when it has no tab stop.
                MUI, Tremor and shadcn all ship it without one; this is the
                documented fix — a named region that can be reached and
                scrolled with the keyboard. --}}
          <div
            class='pretui-dt-scroll'
            role='region'
            aria-label={{this.scrollLabel}}
            style={{this.scrollStyle}}
            {{rovingTabindex true}}
          >
            <table class='pretui-dt-table'>
              {{#if @caption}}
                <caption class='pretui-dt-caption'>{{@caption}}</caption>
              {{/if}}
              <thead>
                <tr>
                  {{#if this.selectable}}
                    <th scope='col' class='pretui-dt-pick-h' data-pin={{this.leadPin}}>
                      {{#if this.multi}}
                        <input
                          type='checkbox'
                          class='pretui-dt-box'
                          checked={{this.allSelected}}
                          aria-label={{this.selectAllLabel}}
                          data-test-pretui-dt-selectall
                          {{setsIndeterminate this.someSelected}}
                          {{on 'change' this.toggleAll}}
                        />
                      {{else}}
                        <span class='pretui-sr'>Selection</span>
                      {{/if}}
                    </th>
                  {{/if}}
                  {{#if (has-block 'expanded')}}
                    <th scope='col' class='pretui-dt-exp-h' data-pin={{this.leadPin}}>
                      <span class='pretui-sr'>Detail</span>
                    </th>
                  {{/if}}
                  {{#each this.headers key='key' as |head|}}
                    <th
                      scope='col'
                      data-align={{head.align}}
                      data-mono={{head.mono}}
                      data-pin={{head.pin}}
                      data-filtered={{head.filtered}}
                      aria-sort={{head.ariaSort}}
                      style={{head.style}}
                      data-test-pretui-dt-head
                    >
                      {{#if head.sortable}}
                        <button
                          type='button'
                          class='pretui-dt-sort'
                          data-test-pretui-dt-sort
                          {{on 'click' (fn this.sortBy head.key)}}
                        >
                          <span class='pretui-dt-sort-text'>{{head.label}}</span>
                          <span class='pretui-dt-mark' aria-hidden='true'>{{head.mark}}</span>
                          <span class='pretui-sr'>{{head.hint}}</span>
                        </button>
                      {{else}}
                        {{head.label}}
                      {{/if}}
                    </th>
                  {{/each}}
                  {{#if (has-block 'actions')}}
                    <th scope='col' class='pretui-dt-act-h' data-pin={{this.tailPin}}>
                      <span class='pretui-sr'>Actions</span>
                    </th>
                  {{/if}}
                </tr>
              </thead>
              <tbody>
                {{#each this.lines key='key' as |line|}}
                  <tr
                    class='pretui-dt-row'
                    aria-selected={{line.ariaSelected}}
                    data-selected={{line.selectedFlag}}
                    data-test-pretui-dt-row
                  >
                    {{#if this.selectable}}
                      <td class='pretui-dt-pick' data-pin={{this.leadPin}}>
                        {{#if this.multi}}
                          <input
                            type='checkbox'
                            class='pretui-dt-box'
                            checked={{line.selected}}
                            aria-label={{line.label}}
                            data-test-pretui-dt-select
                            {{on 'change' (fn this.toggleRow line.row line.index)}}
                          />
                        {{else}}
                          <input
                            type='radio'
                            class='pretui-dt-box pretui-dt-radio'
                            name={{this.radioName}}
                            checked={{line.selected}}
                            aria-label={{line.label}}
                            data-test-pretui-dt-select
                            {{on 'change' (fn this.toggleRow line.row line.index)}}
                          />
                        {{/if}}
                      </td>
                    {{/if}}
                    {{#if (has-block 'expanded')}}
                      <td class='pretui-dt-exp' data-pin={{this.leadPin}}>
                        <button
                          type='button'
                          class='pretui-dt-expbtn'
                          aria-expanded={{line.expandedFlag}}
                          aria-controls={{line.detailId}}
                          aria-label={{this.expandLabel line}}
                          data-test-pretui-dt-expand
                          {{on 'click' (fn this.toggleExpanded line.key)}}
                        >
                          <span class='pretui-dt-chev' aria-hidden='true'>›</span>
                        </button>
                      </td>
                    {{/if}}
                    {{#each line.cells key='key' as |cell|}}
                      <td
                        data-align={{cell.align}}
                        data-mono={{cell.mono}}
                        data-pin={{cell.pin}}
                        style={{cell.style}}
                        data-test-pretui-dt-cell
                      >
                        {{#if (has-block 'cell')}}
                          {{yield cell.text line.row cell.col to='cell'}}
                        {{else}}
                          {{cell.text}}
                        {{/if}}
                      </td>
                    {{/each}}
                    {{#if (has-block 'actions')}}
                      <td class='pretui-dt-act' data-pin={{this.tailPin}}>
                        {{yield line.row to='actions'}}
                      </td>
                    {{/if}}
                  </tr>
                  {{#if line.expanded}}
                    <tr class='pretui-dt-detail' id={{line.detailId}}>
                      <td
                        colspan={{this.colspanFor
                          (has-block 'expanded')
                          (has-block 'actions')
                        }}
                      >
                        {{yield line.row to='expanded'}}
                      </td>
                    </tr>
                  {{/if}}
                {{/each}}
              </tbody>
            </table>
          </div>

          {{#if this.noResults}}
            {{!-- Distinct from DataShell's empty state, which means "this
                  dataset has no rows". This one means "your filters matched
                  nothing", and it has to offer a way back out. --}}
            <div class='pretui-dt-noresults' data-test-pretui-dt-noresults>
              <EmptyState
                @title='Nothing matches these filters'
                @message='Every row was filtered out. Widen a filter, or clear them all and start again.'
                @texture={{false}}
              >
                <:action>
                  <Button
                    @appearance='outlined'
                    @size='s'
                    {{on 'click' this.clearFilters}}
                  >Clear filters</Button>
                </:action>
              </EmptyState>
            </div>
          {{/if}}

          {{#if this.paged}}
            <div class='pretui-dt-foot'>
              <span class='pretui-dt-count'>{{this.announcement}}</span>
              <Pagination
                @page={{this.page}}
                @pages={{this.pageCount}}
                @onPageChange={{this.goToPage}}
              />
            </div>
          {{/if}}
        </:default>
        <:loading>{{yield to='loading'}}</:loading>
        <:empty>{{yield to='empty'}}</:empty>
        <:error>{{yield to='error'}}</:error>
      </DataShell>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-dt {
          display: grid;
          gap: var(--space-3, 8px);
          min-width: 0;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
          /* The control columns' effective widths. A pin offset computed in
             JS cannot know whether the expander or actions column exists —
             that is a has-block fact and has-block lives in the template — so
             the template stamps the facts and the arithmetic happens here.
             Custom properties substitute at computed-value time, so the
             overrides below are picked up by these two calc()s. */
          --pretui-dt-pick-eff: 0px;
          --pretui-dt-exp-eff: 0px;
          --pretui-dt-act-eff: 0px;
          --pretui-dt-lead: calc(
            var(--pretui-dt-pick-eff) + var(--pretui-dt-exp-eff)
          );
          --pretui-dt-tail: var(--pretui-dt-act-eff);
        }
        .pretui-dt[data-pick='true'] {
          --pretui-dt-pick-eff: var(--pretui-dt-pick-w, 2.6em);
        }
        .pretui-dt[data-detail='true'] {
          --pretui-dt-exp-eff: var(--pretui-dt-exp-w, 2.2em);
        }
        .pretui-dt[data-actions='true'] {
          --pretui-dt-act-eff: var(--pretui-dt-act-w, 3em);
        }
        .pretui-dt[data-size='xs'] {
          font-size: 10.5px;
        }
        .pretui-dt[data-size='s'] {
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-dt[data-size='l'] {
          font-size: 14px;
        }
        .pretui-dt[data-size='xl'] {
          font-size: 16px;
        }
        .pretui-dt[aria-busy='true'] .pretui-dt-scroll {
          opacity: 0.62;
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
        .pretui-dt-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-dt-bar-gap {
          flex: 1 1 auto;
        }
        .pretui-dt-bar-slot {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
        }
        .pretui-dt-filter {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .pretui-dt-filter-label {
          font-family: var(--font-mono);
          font-size: 0.82em;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-dt-filter-input {
          font: inherit;
          letter-spacing: inherit;
          block-size: 2.24em;
          min-inline-size: 9em;
          padding-inline: 0.7em;
          color: var(--foreground);
          background: var(--pretui-control-rest, var(--field, var(--boxel-light)));
          border: 0;
          border-radius: var(--radius);
          box-shadow: 0 0 0 1px var(--pretui-control-border, var(--input));
        }
        .pretui-dt-filter-input:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-dt-selcount {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-dt-scroll {
          overflow: auto;
          min-width: 0;
          max-width: 100%;
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-dt-scroll:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-dt-table {
          width: 100%;
          min-inline-size: var(--pretui-dt-min-w, 0);
          border-collapse: separate;
          border-spacing: 0;
          background: var(--card);
        }
        .pretui-dt-caption {
          caption-side: top;
          text-align: start;
          padding: 0.62em var(--space-4, 11px);
          color: var(--muted-foreground);
          font-size: 0.94em;
        }
        .pretui-dt-table th {
          height: 2.4em;
          padding: 0 0.8em;
          text-align: start;
          font-family: var(--font-mono);
          font-size: 0.82em;
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
          background: var(--inset, var(--boxel-100));
          box-shadow: inset 0 -1px 0 var(--line-strong, var(--boxel-400));
          white-space: nowrap;
          vertical-align: middle;
        }
        .pretui-dt[data-sticky] .pretui-dt-table th {
          position: sticky;
          top: 0;
          z-index: var(--pretui-z-sticky-header, 11);
        }
        .pretui-dt-table th[aria-sort='ascending'],
        .pretui-dt-table th[aria-sort='descending'] {
          color: var(--foreground);
        }
        .pretui-dt-table th[data-filtered='true']::after {
          content: '';
          display: inline-block;
          inline-size: 4px;
          block-size: 4px;
          margin-inline-start: 5px;
          border-radius: 50%;
          vertical-align: 0.28em;
          background: var(--primary);
        }
        .pretui-dt-sort {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: none;
          border: 0;
          padding: 0;
          font: inherit;
          letter-spacing: inherit;
          text-transform: inherit;
          color: inherit;
          cursor: pointer;
        }
        .pretui-dt-sort:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 3px;
        }
        .pretui-dt-mark {
          opacity: 0.4;
          font-family: var(--font-sans);
        }
        th[aria-sort='ascending'] .pretui-dt-mark,
        th[aria-sort='descending'] .pretui-dt-mark {
          opacity: 1;
        }
        .pretui-dt-table td {
          height: 2.56em;
          padding: 0.4em 0.8em;
          vertical-align: middle;
          box-shadow: inset 0 -1px 0 var(--border);
          background: var(--card);
        }
        .pretui-dt-table th[data-align='end'],
        .pretui-dt-table td[data-align='end'] {
          text-align: end;
        }
        .pretui-dt-table th[data-align='center'],
        .pretui-dt-table td[data-align='center'] {
          text-align: center;
        }
        .pretui-dt-table td[data-mono='true'] {
          font-family: var(--font-mono);
          font-size: 0.94em;
          font-variant-numeric: tabular-nums;
        }
        .pretui-dt[data-striped] .pretui-dt-row:nth-child(odd) td {
          background: var(--stripe, var(--boxel-100));
        }
        .pretui-dt-row:hover td {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-dt-row[data-selected='true'] td {
          background: var(--pretui-selected, var(--boxel-100));
        }
        /* Selection reads without colour too (Law 8): a rule down the inline
           start of the row. */
        .pretui-dt-row[data-selected='true'] td:first-child {
          box-shadow:
            inset 2px 0 0 var(--primary),
            inset 0 -1px 0 var(--border);
        }
        /* Pinned cells inherit the row's computed background, so zebra,
           hover and selection all survive the pin. */
        .pretui-dt-table td[data-pin],
        .pretui-dt-table th[data-pin] {
          position: sticky;
          z-index: var(--pretui-z-sticky, 10);
          background: inherit;
        }
        .pretui-dt-table td[data-pin='start'],
        .pretui-dt-table th[data-pin='start'] {
          box-shadow:
            inset -1px 0 0 var(--line-strong, var(--boxel-400)),
            inset 0 -1px 0 var(--border);
        }
        .pretui-dt-table td[data-pin='end'],
        .pretui-dt-table th[data-pin='end'] {
          box-shadow:
            inset 1px 0 0 var(--line-strong, var(--boxel-400)),
            inset 0 -1px 0 var(--border);
        }
        .pretui-dt[data-sticky] .pretui-dt-table th[data-pin] {
          z-index: var(--pretui-z-sticky-header, 11);
        }
        .pretui-dt-pick-h,
        .pretui-dt-pick {
          inline-size: var(--pretui-dt-pick-w, 2.6em);
          inset-inline-start: 0;
        }
        .pretui-dt-exp-h,
        .pretui-dt-exp {
          inline-size: var(--pretui-dt-exp-w, 2.2em);
          inset-inline-start: var(--pretui-dt-pick-eff, 0px);
        }
        .pretui-dt-act-h,
        .pretui-dt-act {
          inline-size: var(--pretui-dt-act-w, 3em);
          inset-inline-end: 0;
          text-align: end;
        }
        .pretui-dt-box {
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
          vertical-align: middle;
        }
        .pretui-dt-radio {
          border-radius: 50%;
        }
        .pretui-dt-box:checked {
          background: var(--primary);
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--primary) 70%, var(--border)),
            var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
        }
        .pretui-dt-box:checked::before {
          content: '';
          width: 9px;
          height: 9px;
          background: var(--primary-foreground);
          clip-path: polygon(14% 47%, 38% 70%, 86% 18%, 96% 30%, 39% 89%, 4% 58%);
        }
        .pretui-dt-radio:checked::before {
          clip-path: circle(50%);
          width: 7px;
          height: 7px;
        }
        /* The mixed state gets a non-colour channel too — a dash, not a tint. */
        .pretui-dt-box:indeterminate {
          background: var(--primary);
        }
        .pretui-dt-box:indeterminate::before {
          content: '';
          width: 9px;
          height: 2px;
          border-radius: 1px;
          background: var(--primary-foreground);
        }
        .pretui-dt-box:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-dt-expbtn {
          display: inline-grid;
          place-content: center;
          inline-size: 1.7em;
          block-size: 1.7em;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: none;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-dt-expbtn:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-dt-expbtn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-dt-chev {
          display: block;
          line-height: 1;
          transition: transform var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, cubic-bezier(0.2, 0.9, 0.25, 1.05));
        }
        .pretui-dt-expbtn[aria-expanded='true'] .pretui-dt-chev {
          transform: rotate(90deg);
        }
        .pretui-dt-detail td {
          padding: var(--space-4, 11px) var(--space-5, 14px);
          background: var(--inset, var(--boxel-100));
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .pretui-dt-noresults {
          padding: var(--space-4, 11px) 0;
        }
        .pretui-dt-foot {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 8px);
        }
        .pretui-dt-count {
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-dt-chev {
            transition: none;
          }
        }
        @media (pointer: coarse) {
          .pretui-dt-table td {
            height: 44px;
          }
          .pretui-dt-box {
            width: 20px;
            height: 20px;
          }
          .pretui-dt-expbtn {
            inline-size: 2.4em;
            block-size: 2.4em;
          }
        }
      }
    </style>
  </template>
}
