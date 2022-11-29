import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';
import { balanceInCurrency, formatUSD } from './currency-format';

let styles = initStyleSheet(`
  this {
    display: inline-grid;
    grid-template-columns: 1em 1fr;
    gap: 1em;
  }
  .payment-method__currency {
    font-size: 1rem;
    font-weight: bold;
  }
`);

export class PaymentMethod extends Card {
  @field currency = contains(StringCard);
  @field logo = contains(StringCard);
  @field exchangeRate = contains(IntegerCard);
  @field balance = contains(IntegerCard);

  static embedded = class Embedded extends Component<typeof PaymentMethod> {
    <template>
    {{#if @model.currency}}
      <div {{attachStyles styles}}>
        <img src={{@model.logo}} width="20" height="20"/>
        <div>
          <div class="payment-method__currency"><@fields.currency/></div>
          {{balanceInCurrency @model.balance @model.exchangeRate @model.currency}}
        </div>
      </div>
    {{/if}}
    </template>
  }
}
