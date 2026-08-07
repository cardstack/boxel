import {
  FieldDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import { formatMoney, lineTotal } from './money';

export class LineItem extends FieldDef {
  static displayName = 'Line Item';

  @field description = contains(StringField);
  @field quantity = contains(NumberField);
  @field unitPrice = contains(AmountWithCurrency);

  static embedded = class Embedded extends Component<typeof LineItem> {
    get total() {
      return formatMoney(
        lineTotal(this.args.model),
        this.args.model?.unitPrice?.currency?.code,
      );
    }
    get unit() {
      return formatMoney(
        this.args.model?.unitPrice?.amount,
        this.args.model?.unitPrice?.currency?.code,
      );
    }
    <template>
      <div class='line-item'>
        <span class='desc'>{{@model.description}}</span>
        <span class='qty'>{{@model.quantity}} × {{this.unit}}</span>
        <span class='total'>{{this.total}}</span>
      </div>
      <style scoped>
        .line-item {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 1rem;
          align-items: baseline;
          font-size: 0.875rem;
          padding: 0.25rem 0;
        }
        .qty {
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .total {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}
