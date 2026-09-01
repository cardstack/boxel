import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { LineItem } from './line-item';
import { lineTotal, sumLineItems, formatMoney } from './money';

// Invoice Editor — line-item editing UI for an Invoice before it's sent.
// The one Commerce concept that's a UI, not a data model: `invoice.gts`
// already models line items via the realm's existing `LineItem` FieldDef,
// this component just gives a consumer a pre-send editing surface for them
// rather than only the read-only rendering `invoice.gts`'s own isolated
// view provides.

interface InvoiceEditorSignature {
  Args: {
    lineItems: LineItem[];
    onChange: (lineItems: LineItem[]) => void;
  };
  Element: HTMLElement;
}

export default class InvoiceEditor extends GlimmerComponent<InvoiceEditorSignature> {
  get rows() {
    return (this.args.lineItems ?? []).map((item, index) => ({
      index,
      description: item?.description ?? '',
      quantity: item?.quantity ?? 0,
      unitAmount: item?.unitPrice?.amount ?? 0,
      currencyCode: item?.unitPrice?.currency?.code ?? 'USD',
      totalDisplay: formatMoney(
        lineTotal(item),
        item?.unitPrice?.currency?.code,
      ),
    }));
  }

  get totalDisplay() {
    let currency = this.args.lineItems?.[0]?.unitPrice?.currency?.code;
    return formatMoney(sumLineItems(this.args.lineItems ?? []), currency);
  }

  @action
  updateDescription(index: number, event: Event) {
    let value = (event.target as HTMLInputElement).value;
    this.patchRow(index, { description: value });
  }

  @action
  updateQuantity(index: number, event: Event) {
    let value = Number((event.target as HTMLInputElement).value) || 0;
    this.patchRow(index, { quantity: value });
  }

  @action
  updateUnitAmount(index: number, event: Event) {
    let value = Number((event.target as HTMLInputElement).value) || 0;
    let items = this.args.lineItems ?? [];
    let current = items[index];
    this.patchRow(index, {
      unitPrice: {
        amount: value,
        currency: current?.unitPrice?.currency ?? { code: 'USD' },
      },
    });
  }

  @action
  removeRow(index: number) {
    let items = [...(this.args.lineItems ?? [])];
    items.splice(index, 1);
    this.args.onChange(items);
  }

  @action
  addRow() {
    let items = [...(this.args.lineItems ?? [])];
    items.push(
      new LineItem({
        description: '',
        quantity: 1,
        unitPrice: { amount: 0, currency: { code: 'USD' } },
      }),
    );
    this.args.onChange(items);
  }

  patchRow(index: number, patch: Record<string, unknown>) {
    let items = [...(this.args.lineItems ?? [])];
    let current = items[index];
    items[index] = new LineItem({
      description: current?.description,
      quantity: current?.quantity,
      unitPrice: current?.unitPrice,
      ...patch,
    } as any);
    this.args.onChange(items);
  }

  <template>
    <div class='invoice-editor' ...attributes>
      <table>
        <thead>
          <tr>
            <th class='t-desc'>Description</th>
            <th class='t-num'>Qty</th>
            <th class='t-num'>Unit</th>
            <th class='t-num'>Amount</th>
            <th class='t-action'></th>
          </tr>
        </thead>
        <tbody>
          {{#each this.rows as |row|}}
            <tr>
              <td class='t-desc'>
                <input
                  type='text'
                  value={{row.description}}
                  {{on 'input' (fn this.updateDescription row.index)}}
                />
              </td>
              <td class='t-num'>
                <input
                  type='number'
                  value={{row.quantity}}
                  {{on 'input' (fn this.updateQuantity row.index)}}
                />
              </td>
              <td class='t-num'>
                <input
                  type='number'
                  value={{row.unitAmount}}
                  {{on 'input' (fn this.updateUnitAmount row.index)}}
                />
              </td>
              <td class='t-num t-strong'>{{row.totalDisplay}}</td>
              <td class='t-action'>
                <button
                  type='button'
                  {{on 'click' (fn this.removeRow row.index)}}
                >&times;</button>
              </td>
            </tr>
          {{/each}}
        </tbody>
        <tfoot>
          <tr>
            <td class='t-desc' colspan='3'>Total</td>
            <td class='t-num t-total'>{{this.totalDisplay}}</td>
            <td class='t-action'></td>
          </tr>
        </tfoot>
      </table>
      <button type='button' class='add-row' {{on 'click' this.addRow}}>+
        Add line item</button>
    </div>
    <style scoped>
      .invoice-editor {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      th {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, #6b7280);
        padding: 0 0.5rem 0.5rem;
        border-bottom: 1px solid var(--border, #e5e7eb);
        text-align: left;
      }
      td {
        padding: 0.375rem 0.5rem;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      .t-desc input {
        width: 100%;
      }
      .t-num {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .t-num input {
        width: 5rem;
        text-align: right;
      }
      input {
        box-sizing: border-box;
        padding: 0.375rem 0.5rem;
        font: inherit;
        border: 1px solid var(--border, #cbd5e1);
        border-radius: var(--boxel-border-radius-sm, 0.375rem);
        background: var(--card, #ffffff);
        color: var(--foreground, #111111);
      }
      .t-strong {
        font-weight: 600;
      }
      .t-action button {
        border: none;
        background: none;
        color: var(--muted-foreground, #6b7280);
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
      }
      tfoot td {
        border-bottom: none;
        border-top: 2px solid var(--foreground, #111111);
        padding-top: 0.75rem;
        font-weight: 700;
      }
      .t-total {
        font-size: 1.125rem;
      }
      .add-row {
        align-self: flex-start;
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 600;
        border: 1px dashed var(--border, #cbd5e1);
        border-radius: var(--boxel-border-radius-sm, 0.375rem);
        background: none;
        color: var(--foreground, #111111);
        cursor: pointer;
      }
    </style>
  </template>
}
