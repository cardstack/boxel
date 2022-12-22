import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { CardContainer } from '@cardstack/boxel-ui';

export const EXCHANGE_RATES: Record<string, number> = {
  "USD": 1,
  "USDC": 1,
  "DAI": 1,
  "LINK": 0.0552,
}

let styles = initStyleSheet(`
  this {
    display: inline-grid;
    grid-template-columns: var(--boxel-sp) 1fr;
    gap: var(--boxel-sp-xxxs);
  }
  .payment-method__currency {
    font: 700 var(--boxel-font);
  }
`);

class PaymentMethodView extends Component<typeof PaymentMethod> {
  <template>
    <CardContainer {{attachStyles styles}}>
      <img src={{@model.logo}} width="20" height="20"/>
      <div class="payment-method__currency"><@fields.name/></div>
    </CardContainer>
  </template>
}

export class PaymentMethod extends Card {
  @field name = contains(StringCard);
  @field logo = contains(StringCard);
  @field exchangeRate = contains(IntegerCard, { computeVia:
    function(this: PaymentMethod) { return EXCHANGE_RATES[this.name]; }
  });

  static embedded = PaymentMethodView;
  static isolated = PaymentMethodView;
}
