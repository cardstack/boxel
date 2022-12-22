import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { CardContainer } from '@cardstack/boxel-ui';

let EXCHANGE_RATES: Record<string, number> = {
  "USD": 1,
  "USDC": 1,
  "DAI": 1,
  "LINK": 0.16995055,
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

export class Asset extends Card {
  @field name = contains(StringCard);
  @field symbol = contains(StringCard);
  @field logoURL = contains(StringCard);
  @field exchangeRate = contains(IntegerCard, { computeVia:
    function(this: Asset) { return EXCHANGE_RATES[this.symbol]; }
  });
  static embedded = class Embedded extends Component<typeof Asset> {
    <template>
      <CardContainer {{attachStyles styles}}>
        <img src={{@model.logoURL}} width="20" height="20"/>
        <div class="payment-method__currency"><@fields.symbol/></div>
      </CardContainer>
    </template>
  };
  static isolated = this.embedded;
}

// For fiat money
export class Currency extends Asset {
  @field sign = contains(StringCard); // $, €, £, ¥, ₽, ₿ etc.
}
