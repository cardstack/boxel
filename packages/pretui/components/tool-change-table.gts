// Pretui — ToolChangeTable: a bulk write's changes, one line per card, folded after a few.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
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
    /** how many rows show before "+N more". Default 4 */
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
 * Member to Regular, then "+36 more". One ToolChange says one field's
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
  expand = () => (this.showAll = true);
  isSelected = (row: ToolChangeRow) => (this.args.selected ?? []).includes(row.card);
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
    this.args.onSelectionChange?.(this.args.rows.map((r) => r.card).filter((c) => chosen.has(c)));
  };
  toggleAll = (event: Event) => {
    let on = (event.target as HTMLInputElement).checked;
    this.args.onSelectionChange?.(
      on ? this.args.rows.filter((r) => !r.skipped).map((r) => r.card) : [],
    );
  };
  <template>
    <div class='pretui-changetable' data-test-pretui-tool-change-table ...attributes>
      <table>
        <caption class='pretui-changetable-caption'>{{if
            @caption
            @caption
            'Changes'
          }}</caption>
        <thead>
          <tr>
            {{#if @selectable}}<th scope='col' class='pretui-changetable-pick'><input
                  type='checkbox'
                  aria-label='Keep every change'
                  checked={{this.allSelected}}
                  data-test-pretui-tool-change-table-all
                  {{on 'change' this.toggleAll}}
                /></th>{{/if}}
            <th scope='col'>Card</th>
            <th scope='col'>{{if @changeLabel @changeLabel 'Change'}}</th>
          </tr>
        </thead>
        <tbody>
          {{#each this.shown as |row|}}
            <tr
              data-skipped={{if row.skipped 'true'}}
              data-test-pretui-tool-change-row={{row.card}}
            >
              {{#if @selectable}}<td class='pretui-changetable-pick'><input
                    type='checkbox'
                    aria-label='Keep the change to {{row.card}}'
                    checked={{this.isSelected row}}
                    disabled={{if row.skipped true}}
                    data-test-pretui-tool-change-pick={{row.card}}
                    {{on 'change' (fn this.toggleRow row)}}
                  /></td>{{/if}}
              <th scope='row'>{{row.card}}</th>
              <td>
                {{#if row.to}}{{#if row.from}}<span
                      class='pretui-changetable-from'
                    >{{row.from}}</span><ArrowRight
                      class='pretui-changetable-arrow'
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
          data-test-pretui-tool-change-table-more
          {{on 'click' this.expand}}
        >+{{this.more}} more</button>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-changetable-from {
          color: var(--ink-3, var(--muted-foreground));
        }
        .pretui-changetable-arrow {
          width: 12px;
          height: 12px;
          margin-inline: var(--step-4, 4px);
          vertical-align: -1px;
          color: var(--ink-3, var(--muted-foreground));
        }
      }
      @layer PretComponent {
        .pretui-changetable {
          display: grid;
          justify-items: start;
          gap: var(--step-4, 4px);
          padding-inline-start: calc(
            var(--pretui-toolrow-disc, 16px) + var(--pretui-toolrow-gap, 8px)
          );
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
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
          padding: 0 var(--step-8, 8px) var(--step-4, 4px) 0;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-align: start;
          text-transform: uppercase;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          box-shadow: inset 0 -1px 0 var(--border);
        }
        tbody th,
        tbody td {
          padding: var(--step-4, 4px) var(--step-8, 8px) var(--step-4, 4px) 0;
          text-align: start;
          vertical-align: baseline;
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .pretui-changetable-pick {
          width: 20px;
          padding-inline-end: var(--step-8, 8px);
        }
        .pretui-changetable-pick input {
          accent-color: var(--primary, var(--boxel-highlight));
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
        tr[data-skipped] th,
        tr[data-skipped] td {
          color: var(--ink-2, var(--muted-foreground));
        }
        tr[data-skipped] td {
          text-decoration: line-through;
        }
        .pretui-changetable-skipped {
          display: block;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          text-decoration: none;
          color: var(
            --state-attention,
            var(
              --pretui-attention-ink,
              var(--pretui-attention, var(--boxel-fuschia))
            )
          );
        }
        .pretui-changetable-more {
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
          color: var(--ink-2, var(--muted-foreground));
          cursor: pointer;
        }
        .pretui-changetable-more:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-changetable-more:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
