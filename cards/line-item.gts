import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';
import { formatUSD } from './currency-format';

let lineItemStyles = initStyleSheet(`
  this {
    display: grid;
    grid-template-columns: 3fr 1fr 2fr; 
  }
  .line-item__qty {
    justify-self: center;
  }
  .line-item__amount {
    justify-self: end;
  }
`);

export class LineItem extends Card {
  @field name = contains(StringCard);
  @field quantity = contains(IntegerCard);
  @field amount = contains(IntegerCard);
  @field description = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{attachStyles lineItemStyles}}>
        <div>
          <div><strong><@fields.name/></strong></div>
          <@fields.description/>
        </div>
        <div class="line-item__qty"><@fields.quantity/></div>
        <div class="line-item__amount">
          <strong>{{formatUSD @model.amount}}</strong>
        </div>
      </div>
    </template>
  };
}