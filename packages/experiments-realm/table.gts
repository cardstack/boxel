import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type { CardDef } from 'https://cardstack.com/base/card-api';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  value: (item: CardDef) => string | number | null | undefined;
  sortValue?: (item: CardDef) => string | number | null | undefined;
}

function cellValue(column: TableColumn, item: CardDef): string {
  let v = column.value(item);
  return v === null || v === undefined ? '—' : String(v);
}

interface TableSignature {
  Args: {
    columns: TableColumn[];
    emptyMessage?: string;
    items: CardDef[];
    onRowClick?: (item: CardDef) => void;
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
              </th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each this.sortedItems as |item|}}
            {{! row click is a pointer convenience; keyboard path is the consumer's open affordance }}
            {{! template-lint-disable no-invalid-interactive }}
            <tr
              class={{if @onRowClick 'clickable'}}
              {{on 'click' (fn this.rowClicked item)}}
            >
              {{#each @columns as |column|}}
                <td class='align-{{if column.align column.align "left"}}'>
                  {{cellValue column item}}
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
    <style scoped>
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
        border-bottom: 1px solid var(--border, #e5e7eb);
        position: sticky;
        top: 0;
        background: var(--card, #ffffff);
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
        color: var(--muted-foreground, #6b7280);
      }
      .align-right .sort-btn {
        justify-content: flex-end;
      }
      .sort-mark {
        font-size: 0.5625rem;
      }
      td {
        padding: 0.625rem 0.5rem;
        border-bottom: 1px solid var(--border, #e5e7eb);
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
        background: var(--muted, #f8f9fa);
      }
      .empty {
        text-align: center;
        color: var(--muted-foreground, #6b7280);
        padding: 1.5rem;
      }
    </style>
  </template>
}
