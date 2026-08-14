import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';

export interface DataColumn {
  key: string;
  label: string;
  /** Right-align numbers and durations; everything else reads better at start. */
  align?: 'start' | 'end';
  width?: string;
  sortable?: boolean;
  /**
   * Hidden below this container width, in px. A fixed set, not an arbitrary
   * number: the rule is a real container query, and CSS cannot read a value
   * off an attribute — an open number here would be a knob that silently did
   * nothing, which is worse than no knob.
   */
  showAbove?: 480 | 640 | 720 | 900;
}

interface Signature {
  Args: {
    columns: DataColumn[];
    rows: any[];
    /** Column key currently sorted by. */
    sortKey?: string;
    sortDescending?: boolean;
    onSort?: (key: string) => void;
    onSelectRow?: (row: any) => void;
    rowKey?: string;
    emptyMessage?: string;
    caption?: string;
  };
  Blocks: {
    cell: [any, DataColumn];
  };
  Element: HTMLElement;
}

/**
 * A sortable table over already-resolved rows.
 *
 * The Structures layer has a Table row with nothing behind it. This is not a
 * data grid — no virtualisation, no editing, no column resizing — it is the
 * honest markup half: a real `<table>` with a real `<caption>`, `<th scope>`
 * and `aria-sort`, so a screen reader can navigate it and a sighted user can
 * tell which column is sorted.
 *
 * It deliberately does not fetch. Whoever mounts it owns the query, which is
 * what lets the same rows drive a table and a board without the two drifting.
 *
 * **Known duplicate, recorded rather than hidden.** The matrix layer already
 * has a Table block (`richard.tan1/boxel-software-matrix-layer/table.gts`).
 * It cannot be consumed from here: it lives in a different realm on a
 * different server, and `@cardstack/catalog/...` is the only cross-realm
 * import alias this realm has. The right resolution is to promote one of the
 * two into the catalog and have both apps consume that; until then this is a
 * declared duplicate against the matrix tracker, not an accidental one.
 */
export class DataTable extends GlimmerComponent<Signature> {
  get visibleColumns(): DataColumn[] {
    return (this.args.columns ?? []).filter(Boolean);
  }

  sortStateFor = (column: DataColumn) => {
    if (this.args.sortKey !== column.key) {
      return 'none';
    }
    return this.args.sortDescending ? 'descending' : 'ascending';
  };

  widthClassFor = (column: DataColumn) => {
    return column.showAbove ? `dt-above-${column.showAbove}` : '';
  };

  styleFor = (column: DataColumn) => {
    let bits: string[] = [];
    if (column.width) {
      bits.push(`width:${column.width}`);
    }
    if (column.align === 'end') {
      bits.push('text-align:end');
    }
    return htmlSafe(bits.join(';'));
  };

  sort = (column: DataColumn, _event?: Event) => {
    if (column.sortable === false) {
      return;
    }
    this.args.onSort?.(column.key);
  };

  select = (row: any, _event?: Event) => {
    this.args.onSelectRow?.(row);
  };

  <template>
    <div class='dt-scroll' ...attributes>
      <table class='dt'>
        {{#if @caption}}<caption
            class='dt-caption'
          >{{@caption}}</caption>{{/if}}
        <thead>
          <tr>
            {{#each this.visibleColumns as |column|}}
              <th
                scope='col'
                class={{this.widthClassFor column}}
                style={{this.styleFor column}}
                aria-sort={{this.sortStateFor column}}
              >
                {{#if @onSort}}
                  <button
                    type='button'
                    class='dt-sort'
                    {{on 'click' (fn this.sort column)}}
                  >
                    <span>{{column.label}}</span>
                    {{#if (eq @sortKey column.key)}}
                      <span class='dt-caret' aria-hidden='true'>{{if
                          @sortDescending
                          '▾'
                          '▴'
                        }}</span>
                    {{/if}}
                  </button>
                {{else}}
                  {{column.label}}
                {{/if}}
              </th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each @rows key=@rowKey as |row|}}
            <tr class='dt-row {{if @onSelectRow "dt-clickable"}}'>
              {{#each this.visibleColumns as |column index|}}
                <td
                  class={{this.widthClassFor column}}
                  style={{this.styleFor column}}
                >
                  {{! Whole-row click without lying about the markup: the first
                      cell holds a real button whose hit area is stretched over
                      the row. Putting the handler on the <tr> would make a row
                      that keyboards cannot reach and screen readers announce
                      as a row that is somehow also a control. }}
                  {{#if @onSelectRow}}{{#if (eq index 0)}}
                      <button
                        type='button'
                        class='dt-rowbtn'
                        {{on 'click' (fn this.select row)}}
                      >
                        {{yield row column to='cell'}}
                      </button>
                    {{else}}
                      {{yield row column to='cell'}}
                    {{/if}}{{else}}
                    {{yield row column to='cell'}}
                  {{/if}}
                </td>
              {{/each}}
            </tr>
          {{else}}
            <tr>
              <td class='dt-empty' colspan={{this.visibleColumns.length}}>
                {{if @emptyMessage @emptyMessage 'Nothing to show.'}}
              </td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>

    <style scoped>
      /* The table scrolls inside its own box. A wide table must never make the
         page scroll sideways. */
      .dt-scroll {
        container-type: inline-size;
        container-name: dt;
        overflow-x: auto;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: var(--card, var(--boxel-light));
      }
      /* Narrow: secondary columns are DE-EMPHASISED, never removed. Hiding
         them was a data-loss illusion — the same table showed fewer facts on a
         phone than on a laptop, and nothing told the reader a column was
         missing. The table already scrolls sideways, so the honest narrow
         treatment is to keep every column and let the ones that matter lead. */
      @container dt (max-width: 640px) {
        .dt-above-480,
        .dt-above-640,
        .dt-above-720,
        .dt-above-900 {
          color: var(--muted-foreground, var(--boxel-450));
        }
      }
      .dt {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-sans, var(--boxel-font-family));
        font-size: var(--boxel-font-size-sm);
        color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
      }
      .dt-caption {
        caption-side: top;
        text-align: start;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: 0.625rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      th,
      td {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-bottom: 1px solid var(--border, var(--boxel-200));
        text-align: start;
        vertical-align: middle;
      }
      thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--muted, var(--boxel-100));
        font-size: 0.625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
      }
      tbody tr:last-child td {
        border-bottom: none;
      }
      .dt-sort {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        background: none;
        border: none;
        padding: 0;
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        color: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
        cursor: pointer;
      }
      .dt-sort:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .dt-caret {
        font-size: 0.75rem;
      }
      .dt-clickable {
        position: relative;
      }
      .dt-clickable:hover {
        background: var(--muted, var(--boxel-100));
      }
      .dt-rowbtn {
        display: block;
        width: 100%;
        background: none;
        border: none;
        padding: 0;
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        color: inherit;
        text-align: inherit;
        cursor: pointer;
      }
      .dt-rowbtn::after {
        content: '';
        position: absolute;
        inset: 0;
      }
      .dt-rowbtn:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .dt-empty {
        padding: var(--boxel-sp) var(--boxel-sp-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }
      td {
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export default DataTable;
