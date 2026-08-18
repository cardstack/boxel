import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
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
  align?: 'left' | 'right';
  custom?: boolean;
  sortable?: boolean;
  value: (item: CardDef) => string | number | null | undefined;
  sortValue?: (item: CardDef) => string | number | null | undefined;
}

function cellValue(column: TableColumn, item: CardDef): string {
  let v = column.value(item);
  return v === null || v === undefined ? '—' : String(v);
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
    /** Rows per page. Omit for no pagination — every row renders. */
    pageSize?: number;
  };
  Blocks: {
    cell: [CardDef, TableColumn];
  };
  Element: HTMLElement;
}

export class Table extends GlimmerComponent<TableSignature> {
  @tracked sortKey: string | undefined;
  @tracked sortDir: 'asc' | 'desc' = 'asc';

  get sortedItems(): CardDef[] {
    let items = (this.args.items ?? []).filter(Boolean);
    let column = this.args.columns.find((c) => c.key === this.sortKey);
    if (!column) return items;
    let dir = this.sortDir === 'asc' ? 1 : -1;
    let read = column.sortValue ?? column.value;
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
    if (this.sortKey !== key) return '';
    return this.sortDir === 'asc' ? '▲' : '▼';
  };

  @action toggleSort(column: TableColumn) {
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
        <thead>
          <tr>
            {{#each @columns as |column|}}
              <th class='align-{{if column.align column.align "left"}}'>
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
          {{#each this.pagedItems as |item|}}
            {{! row click is a pointer convenience; keyboard path is the consumer's open affordance }}
            {{! template-lint-disable no-invalid-interactive }}
            <tr
              class={{if @onRowClick 'clickable'}}
              {{on 'click' (fn this.rowClicked item)}}
            >
              {{#each @columns as |column|}}
                <td class='align-{{if column.align column.align "left"}}'>
                  {{#if column.custom}}
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
