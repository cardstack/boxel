// Pretui — ToolChangeTable: a bulk write's changes, one line per card, folded after a few.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import ArrowRight from '@cardstack/boxel-icons/arrow-right';

export interface ToolChangeRow {
  /** the card the change is on: 'Lena Ruiz' */
  card: string;
  /** what the change was, as the card says it: 'Became a Regular'. A
   * change from one value to another gives `from` and `to` instead, and
   * the table draws the arrow between them */
  change?: string;
  /** the value before: 'Member' */
  from?: string;
  /** the value after: 'Regular' */
  to?: string;
  /** a change that did not land: 'changed since the preview' */
  skipped?: string;
}

export interface ToolChangeTableSignature {
  Args: {
    rows: ToolChangeRow[];
    /** the change column's heading. Default 'Change' */
    changeLabel?: string;
    /** how many rows show before "Show N more". Default 4 */
    limit?: number;
    /** the table's caption, for a screen reader. Default 'Changes' */
    caption?: string;
    /** each row gets a checkbox: the reader keeps some of a bulk write */
    selectable?: boolean;
    /** the cards chosen, by name; controlled */
    selected?: string[];
    onSelectionChange?: (cards: string[]) => void;
  };
  Element: HTMLDivElement;
}

/**
 * What a write did to each card, for a write across many: Lena Ruiz ·
 * Member to Regular, then "Show 36 more". One ToolChange says one field's
 * change; this says one change across forty cards.
 */
export class ToolChangeTable extends Component<ToolChangeTableSignature> {
  @tracked showAll = false;
  get limit() {
    return this.args.limit ?? 4;
  }
  get shown(): ToolChangeRow[] {
    return this.showAll ? this.args.rows : this.args.rows.slice(0, this.limit);
  }
  get more(): number {
    return this.args.rows.length - this.shown.length;
  }
  /** set by "Show N more": the first row it reveals takes focus, since
   * the button the reader pressed leaves the page */
  private focusFrom: number | undefined;
  expand = () => {
    this.focusFrom = this.limit;
    this.showAll = true;
  };
  focusIfFirstShown = modifier(
    (element: HTMLElement, [index]: [number]) => {
      if (index === this.focusFrom) {
        this.focusFrom = undefined;
        element.setAttribute('tabindex', '-1');
        element.focus();
      }
    },
  );
  isSelected = (row: ToolChangeRow) =>
    (this.args.selected ?? []).includes(row.card);
  get allSelected(): boolean {
    let chosen = this.args.selected ?? [];
    return this.args.rows.every((r) => r.skipped || chosen.includes(r.card));
  }
  toggleRow = (row: ToolChangeRow, event: Event) => {
    let on = (event.target as HTMLInputElement).checked;
    let chosen = new Set(this.args.selected ?? []);
    if (on) {
      chosen.add(row.card);
    } else {
      chosen.delete(row.card);
    }
    this.args.onSelectionChange?.(
      this.args.rows.map((r) => r.card).filter((c) => chosen.has(c)),
    );
  };
  toggleAll = (event: Event) => {
    let on = (event.target as HTMLInputElement).checked;
    this.args.onSelectionChange?.(
      on ? this.args.rows.filter((r) => !r.skipped).map((r) => r.card) : [],
    );
  };
  <template>
    <div
      class='pretui-changetable'
      data-test-pretui-tool-change-table
      ...attributes
    >
      <table>
        <caption class='pretui-changetable-caption'>{{if
            @caption
            @caption
            'Changes'
          }}</caption>
        <thead>
          <tr>
            {{#if @selectable}}<th
                scope='col'
                class='pretui-changetable-pick'
              ><input
                  type='checkbox'
                  aria-label='Keep every change'
                  checked={{this.allSelected}}
                  {{on 'change' this.toggleAll}}
                  data-test-pretui-tool-change-table-all
                /></th>{{/if}}
            <th scope='col'>Card</th>
            <th scope='col'>{{if @changeLabel @changeLabel 'Change'}}</th>
          </tr>
        </thead>
        <tbody>
          {{#each this.shown as |row index|}}
            <tr
              data-skipped={{if row.skipped 'true'}}
              {{this.focusIfFirstShown index}}
              data-test-pretui-tool-change-row={{row.card}}
            >
              {{#if @selectable}}<td class='pretui-changetable-pick'><input
                    type='checkbox'
                    aria-label='Keep the change to {{row.card}}'
                    checked={{this.isSelected row}}
                    disabled={{if row.skipped true}}
                    {{on 'change' (fn this.toggleRow row)}}
                    data-test-pretui-tool-change-pick={{row.card}}
                  /></td>{{/if}}
              <th scope='row'>{{row.card}}</th>
              <td>
                {{#if row.to}}{{#if row.from}}<span
                      class='pretui-changetable-from'
                    >{{row.from}}</span><ArrowRight
                      class='pretui-changetable-arrow'
                      width='12'
                      height='12'
                      role='img'
                      aria-label='changed to'
                    />{{/if}}{{row.to}}{{else}}{{row.change}}{{/if}}
                {{#if row.skipped}}<span
                    class='pretui-changetable-skipped'
                  >{{row.skipped}}</span>{{/if}}
              </td>
            </tr>
          {{/each}}
        </tbody>
      </table>
      {{#if this.more}}
        <button
          type='button'
          class='pretui-changetable-more'
          {{on 'click' this.expand}}
          data-test-pretui-tool-change-table-more
        >Show {{this.more}} more</button>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-changetable-from {
          color: var(--subtle-foreground);
        }
        .pretui-changetable-arrow {
          margin-inline: var(--boxel-sp-4xs);
          vertical-align: -0.1em;
          color: var(--subtle-foreground);
        }
      }
      @layer PretComponent {
        .pretui-changetable {
          display: grid;
          justify-items: start;
          gap: var(--boxel-sp-4xs);
          padding-inline-start: calc(
            var(--pretui-toolrow-disc, var(--boxel-sp)) +
              var(--pretui-toolrow-gap, var(--boxel-sp-xs))
          );
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-variant-numeric: tabular-nums;
        }
        .pretui-changetable-caption {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        /* table headers are the one place tracked caps stay: sans, caption
           size, 0.04em */
        thead th {
          padding: 0 var(--boxel-sp-xs) var(--boxel-sp-4xs) 0;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-align: start;
          text-transform: uppercase;
          color: var(--subtle-foreground);
          box-shadow: inset 0 -1px 0 var(--border);
        }
        tbody th,
        tbody td {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs) var(--boxel-sp-4xs) 0;
          text-align: start;
          vertical-align: baseline;
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .pretui-changetable-pick {
          width: 1.25rem;
          padding-inline-end: var(--boxel-sp-xs);
        }
        .pretui-changetable-pick input {
          accent-color: var(--primary);
        }
        tbody th {
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
        }
        tbody td {
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
        }
        tbody tr:last-child th,
        tbody tr:last-child td {
          box-shadow: none;
        }
        tbody tr:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        tr[data-skipped] th,
        tr[data-skipped] td {
          color: var(--muted-foreground);
        }
        tr[data-skipped] td {
          text-decoration: line-through;
        }
        .pretui-changetable-skipped {
          display: block;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          text-decoration: none;
          color: var(--attention-ink);
        }
        /* 1.5rem tall, the smallest target a pointer is asked to hit */
        .pretui-changetable-more {
          min-height: 1.5rem;
          padding: 0;
          border: 0;
          background-color: transparent;
          font-family: inherit;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-changetable-more:hover {
          color: var(--primary-ink);
        }
        .pretui-changetable-more:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
