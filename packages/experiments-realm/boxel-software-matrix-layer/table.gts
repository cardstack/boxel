import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { and, eq } from '@cardstack/boxel-ui/helpers';
import type { CardDef } from '@cardstack/base/card-api';

// A record table over instances you already hold, with the columns declared by
// the consumer rather than derived from a schema.
//
// This is the counterpart to `fulfilment-table`, not a replacement for it, and
// the difference is which question each answers. `fulfilment-table` takes a
// `Query` and a `cardTypeRef`, works out its own columns from the card's fields
// and paginates itself — point it at a card type and it produces a table. This
// one takes resolved instances and an explicit column list: the consumer decides
// exactly what a row shows, and gets client-side sorting for it. A work surface
// usually wants the second, because "which of this card's forty fields belong in
// the table" is a design decision, not something three boolean flags should be
// guessing at.
//
// Pagination is OPT-IN via `@pageSize`. Without it the table renders every row,
// which is the original behaviour and stays the default so no existing consumer
// changes. With it, the table owns the paging so a consumer never has to cap the
// list by hand — and the pager states the real total, because a truncation that
// looks complete is worse than a long list.
//
// Sorting is applied to the WHOLE set before slicing. Sorting only the visible
// page is the classic paginated-table bug: it reorders ten rows and calls it a
// sort, so the "highest" value in the table is merely the highest on page one.

export interface TableColumn {
  key: string;
  label: string;
  /** `start`/`end` are accepted as aliases so a DataColumn migrates unchanged. */
  align?: 'left' | 'right' | 'start' | 'end';
  width?: string;
  /**
   * Hide the column below this container width. A real container query rather
   * than a JS width observer, because CSS cannot read a value out of a template
   * — hence the fixed set rather than an arbitrary number.
   */
  showAbove?: 480 | 640 | 720 | 900;
  custom?: boolean;
  sortable?: boolean;
  /**
   * Optional. Omit it and the cell comes from the `cell` block instead — which is
   * how a consumer that yields every cell itself (`{{get row column.key}}`)
   * works without declaring an accessor per column.
   */
  value?: (item: CardDef) => string | number | null | undefined;
  sortValue?: (item: CardDef) => string | number | null | undefined;
}

function cellValue(column: TableColumn, item: CardDef): string {
  let v = column.value?.(item);
  return v === null || v === undefined ? '—' : String(v);
}

// A column with no `value` accessor is rendered by the consumer's `cell` block.
function isCustom(column: TableColumn): boolean {
  return column.custom === true || typeof column.value !== 'function';
}

function styleFor(column: TableColumn) {
  return column.width ? htmlSafe(`width: ${column.width}`) : undefined;
}

// Module scope, not a class property: it reads only the column, so it belongs
// with `alignClass` and `styleFor`. As a class member it would need `this.` in the
// template — and a bare reference in a strict-mode template is a build error, not
// a silent miss.
function widthClassFor(column: TableColumn): string {
  return column.showAbove ? `above-${column.showAbove}` : '';
}

function alignClass(column: TableColumn): string {
  let a = column.align;
  return a === 'right' || a === 'end' ? 'right' : 'left';
}

function isSortable(column: TableColumn): boolean {
  return column.sortable !== false;
}

interface TableSignature {
  Args: {
    columns: TableColumn[];
    emptyMessage?: string;
    items: CardDef[];
    onRowClick?: (item: CardDef) => void;
    /**
     * Optional per-row class, so a consumer can encode row state at the row
     * edge (a severity stripe) instead of relying only on a pill inside a
     * cell. Additive: callers that pass nothing render exactly as before.
     */
    rowClass?: (item: CardDef) => string | undefined;
    /**
     * Row selection, opt-in. Five of six researched CLM products raise a bulk
     * action bar on selection, so the capability belongs in the shared table
     * rather than in one app. A caller that omits `selectable` renders no
     * checkbox column and behaves exactly as before.
     */
    selectable?: boolean;
    isSelected?: (item: CardDef) => boolean;
    onToggleRow?: (item: CardDef) => void;
    onToggleAll?: () => void;
    allSelected?: boolean;
    /** Rows per page. Omit for no pagination — every row renders. */
    pageSize?: number;
    /** Table caption, announced before the rows by a screen reader. */
    caption?: string;
    /** Property to key the `{{#each}}` on, so a re-sort moves DOM instead of rebuilding it. */
    rowKey?: string;
    /**
     * CONTROLLED SORT. Pass `onSort` and the table stops sorting internally and
     * reflects `sortKey`/`sortDescending` instead. Without it the table owns its
     * own sort, which is what the three existing consumers rely on.
     *
     * This matters beyond preference: a consumer that already sorts its own rows
     * and then hands them to a table that sorts again gets its order silently
     * overruled.
     */
    sortKey?: string;
    sortDescending?: boolean;
    onSort?: (key: string) => void;
  };
  Blocks: {
    cell: [CardDef, TableColumn];
  };
  Element: HTMLElement;
}

export class Table extends GlimmerComponent<TableSignature> {
  @tracked sortKey: string | undefined;
  @tracked sortDir: 'asc' | 'desc' = 'asc';

  get isControlled(): boolean {
    return typeof this.args.onSort === 'function';
  }

  /** The key currently sorted on, from whichever side owns the state. */
  get activeSortKey(): string | undefined {
    return this.isControlled ? this.args.sortKey : this.sortKey;
  }

  get activeSortDesc(): boolean {
    return this.isControlled
      ? Boolean(this.args.sortDescending)
      : this.sortDir === 'desc';
  }

  get sortedItems(): CardDef[] {
    let items = (this.args.items ?? []).filter(Boolean);
    // Controlled: the consumer has already ordered these. Sorting again here is
    // how a caller's explicit order gets silently overruled.
    if (this.isControlled) {
      return items;
    }
    let column = this.args.columns.find((c) => c.key === this.sortKey);
    if (!column || typeof column.value !== 'function') return items;
    let dir = this.sortDir === 'asc' ? 1 : -1;
    let read = column.sortValue ?? column.value!;
    return [...items].sort((a, b) => {
      let av = read(a);
      let bv = read(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  @tracked page = 0;

  get pageSize(): number | undefined {
    let n = this.args.pageSize;
    return n && n > 0 ? n : undefined;
  }

  get isPaged(): boolean {
    return this.pageSize !== undefined && this.total > this.pageSize;
  }

  get total(): number {
    return this.sortedItems.length;
  }

  get pageCount(): number {
    let size = this.pageSize;
    return size ? Math.max(1, Math.ceil(this.total / size)) : 1;
  }

  // Clamped in a GETTER, never by writing `this.page` during render. Writing
  // tracked state while it is being read is what produces Ember's "attempted to
  // update a value that has already been used" assertion — and rows shrinking
  // under a filter is exactly when the stored page goes out of range.
  get currentPage(): number {
    return Math.min(Math.max(0, this.page), this.pageCount - 1);
  }

  get pagedItems(): CardDef[] {
    let size = this.pageSize;
    if (!size) {
      return this.sortedItems;
    }
    let start = this.currentPage * size;
    return this.sortedItems.slice(start, start + size);
  }

  // 1-based, inclusive, for the reader. The pager says the true total so a capped
  // view can never be mistaken for the whole set.
  get rangeStart(): number {
    return this.total === 0 ? 0 : this.currentPage * (this.pageSize ?? 0) + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.rangeStart + this.pagedItems.length - 1, this.total);
  }

  get isFirstPage(): boolean {
    return this.currentPage === 0;
  }

  get isLastPage(): boolean {
    return this.currentPage >= this.pageCount - 1;
  }

  @action prevPage() {
    this.page = Math.max(0, this.currentPage - 1);
  }

  @action nextPage() {
    this.page = Math.min(this.pageCount - 1, this.currentPage + 1);
  }

  sortIndicator = (key: string) => {
    if (this.activeSortKey !== key) return '';
    return this.activeSortDesc ? '▼' : '▲';
  };

  /** `aria-sort` so a screen reader announces which column is sorted, and how. */
  sortStateFor = (column: TableColumn) => {
    if (this.activeSortKey !== column.key) {
      return 'none';
    }
    return this.activeSortDesc ? 'descending' : 'ascending';
  };


  @action toggleSort(column: TableColumn) {
    if (this.isControlled) {
      this.args.onSort!(column.key);
      this.page = 0;
      return;
    }
    if (this.sortKey === column.key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = column.key;
      this.sortDir = 'asc';
    }
    // A new order makes the old page number meaningless — page 3 of the old sort
    // has nothing to do with page 3 of the new one.
    this.page = 0;
  }

  @action rowClicked(item: CardDef) {
    this.args.onRowClick?.(item);
  }

  <template>
    <div class='table-scroll' ...attributes>
      <table class='record-table'>
        {{#if @caption}}
          <caption class='tbl-caption'>{{@caption}}</caption>
        {{/if}}
        <thead>
          <tr>
            {{#each @columns as |column|}}
              {{! `scope='col'` and `aria-sort` are what let a screen reader
                  navigate the table by column and hear which one is sorted. }}
              <th
                scope='col'
                class='align-{{alignClass column}} {{widthClassFor column}}'
                aria-sort={{this.sortStateFor column}}
              >
                {{#if (isSortable column)}}
                  <button
                    type='button'
                    class='sort-btn'
                    {{on 'click' (fn this.toggleSort column)}}
                  >
                    {{column.label}}
                    <span class='sort-mark'>{{this.sortIndicator
                        column.key
                      }}</span>
                  </button>
                {{else}}
                  <span class='plain-head'>{{column.label}}</span>
                {{/if}}
              </th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each this.pagedItems key=@rowKey as |item|}}
            <tr
              class='{{if @onRowClick "clickable"}}
                {{if @rowClass (@rowClass item)}}'
            >
              {{#each @columns as |column index|}}
                <td
                  class='align-{{alignClass column}} {{widthClassFor column}}'
                  style={{styleFor column}}
                >
                  {{! Whole-row click without lying about the markup: the FIRST
                      cell holds a real button, and `.row-btn::after` stretches
                      its hit area across the whole <tr> (see the CSS). The
                      handler used to sit on the <tr> behind a
                      `template-lint-disable no-invalid-interactive`, which made a
                      row a keyboard could not reach and a screen reader
                      announced as a row that was somehow also a control.
                      One button per row = one tab stop per row. }}
                  {{#if (and @onRowClick (eq index 0))}}
                    <button
                      type='button'
                      class='row-btn'
                      {{on 'click' (fn this.rowClicked item)}}
                    >
                      {{#if (isCustom column)}}
                        {{yield item column to='cell'}}
                      {{else}}
                        {{cellValue column item}}
                      {{/if}}
                    </button>
                  {{else if (isCustom column)}}
                    {{yield item column to='cell'}}
                  {{else}}
                    {{cellValue column item}}
                  {{/if}}
                </td>
              {{/each}}
            </tr>
          {{else}}
            <tr>
              <td class='empty' colspan={{@columns.length}}>
                {{if @emptyMessage @emptyMessage 'No records'}}
              </td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>

    {{#if this.isPaged}}
      {{! The range and the TRUE total, always — the number a capped view is
          most likely to be mistaken about. Buttons rather than links: this
          changes state in place, it does not navigate. }}
      <nav class='pager' aria-label='Table pages'>
        <span class='pager-range' aria-live='polite'>{{this.rangeStart}}–{{this.rangeEnd}}
          of
          {{this.total}}</span>
        <span class='pager-btns'>
          <button
            type='button'
            class='pager-btn'
            disabled={{this.isFirstPage}}
            aria-label='Previous page'
            {{on 'click' this.prevPage}}
          >←</button>
          <span class='pager-page'>{{this.pageCount}}
            {{if (eq this.pageCount 1) 'page' 'pages'}}</span>
          <button
            type='button'
            class='pager-btn'
            disabled={{this.isLastPage}}
            aria-label='Next page'
            {{on 'click' this.nextPage}}
          >→</button>
        </span>
      </nav>
    {{/if}}
    <style scoped>
      /* Every fallback here is a `--boxel-*` design token, never a literal hex.
         The originals were `#e5e7eb` / `#ffffff` / `#6b7280` / `#f8f9fa` — the
         light-mode values of these very tokens, hand-picked. boxel-theming C1
         forbids that for a reason that only shows up in dark mode: the semantic
         token flips (`--card` becomes `--boxel-650`, `--border` becomes
         `--boxel-550`), but a hex fallback cannot, so the moment a theme leaves
         one of these unset the table paints light-mode chrome onto a dark ground.
         The substitutions are exact — theme.css maps `--card: var(--boxel-light)`,
         `--muted: var(--boxel-100)`, `--muted-foreground: var(--boxel-500)` and
         `--border: var(--boxel-border-color)`, so this is the same colour by the
         name the theme actually uses.

         The component's API is untouched: same args, same blocks, same classes. */
      .table-scroll {
        overflow-x: auto;
        width: 100%;
        /* `showAbove` is a real container query, so the wrapper has to BE the
           container — the table sizes to its panel, not to the viewport. */
        container-type: inline-size;
        container-name: tbl;
      }
      .tbl-caption {
        padding: 0 0.5rem 0.4rem;
        text-align: left;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-500));
      }
      /* The row's click target. It fills its cell so the hit area matches the row
         visually, while remaining a real focusable button. */
      .row-btn {
        display: block;
        width: 100%;
        border: 0;
        background: none;
        padding: 0;
        margin: 0;
        font: inherit;
        color: inherit;
        text-align: inherit;
        cursor: pointer;
      }
      /* The button lives in the first cell, so on its own it is only as wide as
         that cell — measured, 261px of a 1429px row, leaving 82% of the row
         dead to the pointer while `tr.clickable` still showed a hover state and
         a pointer cursor. This pseudo-element is the actual hit area: absolute
         against `tr.clickable`, so one real button covers the whole row.

         If a custom cell ever yields something interactive, give that element
         `position: relative; z-index: 1` — the overlay sits at z-index 0 and
         would otherwise swallow its clicks. */
      tr.clickable {
        position: relative;
      }
      .row-btn::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      /* Ring the whole row, not just the first cell — the ring should show what
         the click will actually do. */
      .row-btn:focus-visible {
        outline: none;
      }
      .row-btn:focus-visible::after {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: -2px;
      }
      /* Columns hidden below their own breakpoint. Not display:none on a <th>
         alone — the matching <td> carries the same class, or the row shifts. */
      @container tbl (width < 480px) {
        .above-480 {
          display: none;
        }
      }
      @container tbl (width < 640px) {
        .above-640 {
          display: none;
        }
      }
      @container tbl (width < 720px) {
        .above-720 {
          display: none;
        }
      }
      @container tbl (width < 900px) {
        .above-900 {
          display: none;
        }
      }
      .record-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      th {
        padding: 0;
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
        position: sticky;
        top: 0;
        background: var(--card, var(--boxel-light));
      }
      .sort-btn {
        display: inline-flex;
        align-items: baseline;
        gap: 0.25rem;
        width: 100%;
        /* 44px hit floor — measured at 31px. A column header is a real control
           and gets a real target. */
        min-height: 44px;
        padding: 0.5rem;
        border: 0;
        background: none;
        cursor: pointer;
        font: inherit;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-500));
      }
      /* A sort control is the one thing in this table a keyboard user drives, so
         it needs a visible focus state — the original had none. */
      .sort-btn:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .sort-btn:hover {
        color: var(--foreground, var(--boxel-dark));
      }
      .align-right .sort-btn {
        justify-content: flex-end;
      }
      .sort-mark {
        font-size: 0.5625rem;
      }
      .plain-head {
        display: inline-block;
        padding: 0.5rem;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-500));
      }
      td {
        padding: 0.625rem 0.5rem;
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
        vertical-align: baseline;
      }
      .align-right {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .align-left {
        text-align: left;
      }
      /* Severity stripe at the row edge.
         State read before any text: a scanner finds the two overdue rows in a
         hundred without parsing a pill in the middle of each line. Applied via
         the optional `@rowClass`, so a table that passes nothing is unchanged. */
      .sel-cell {
        width: 2.5rem;
        padding-right: 0;
        /* `.row-btn::after` covers the whole row with `inset: 0` to make the
           row clickable. The checkbox must sit ABOVE that overlay or its
           clicks are swallowed by row navigation — a control that looks
           interactive and isn't. */
        position: relative;
        z-index: 1;
      }
      /* With a checkbox column present the stripe moves to it, so the row edge
         still carries state rather than the stripe landing mid-row. */
      tr.sev-over td:first-child {
        box-shadow: inset 3px 0 0 var(--boxel-danger, #b3261e);
      }
      tr.sev-note td:first-child {
        box-shadow: inset 3px 0 0 var(--boxel-warning, #b8860b);
      }
      tr.sev-ok td:first-child {
        box-shadow: inset 3px 0 0 var(--boxel-success, #2e6b3f);
      }
      tr.sev-cool td:first-child {
        box-shadow: inset 3px 0 0 #1f5b8f;
      }

      tr.clickable {
        cursor: pointer;
      }
      tr.clickable:hover td {
        background: var(--muted, var(--boxel-100));
      }
      .empty {
        text-align: center;
        color: var(--muted-foreground, var(--boxel-500));
        padding: 1.5rem;
      }
      .pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding: 0.5rem 0.5rem 0;
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .pager-range {
        font-variant-numeric: tabular-nums;
      }
      .pager-btns {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .pager-page {
        font-variant-numeric: tabular-nums;
      }
      /* 28px is under the 44px touch minimum, so the target grows only where a
         coarse pointer is actually in use — inflating it on the desktop would put
         a pair of large buttons under a 12px caption. */
      .pager-btn {
        min-width: 28px;
        min-height: 28px;
        padding: 0 0.4rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
        background: var(--card, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font: inherit;
        line-height: 1;
        cursor: pointer;
      }
      .pager-btn:hover:not(:disabled) {
        background: var(--muted, var(--boxel-100));
      }
      .pager-btn:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 1px;
      }
      /* Disabled reads as disabled by more than a cursor: a control that looks
         live at the end of the list is the affordance lying. */
      .pager-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }
      @media (pointer: coarse) {
        .pager-btn {
          min-width: 44px;
          min-height: 44px;
        }
      }
    </style>
  </template>
}
