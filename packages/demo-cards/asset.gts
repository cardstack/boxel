import {
  contains,
  field,
  Card,
  Component,
  relativeTo,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { CardContainer } from '@cardstack/boxel-ui';

let EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  USDC: 1,
  DAI: 1,
  LINK: 0.16995055,
  EUR: 0.94,
};

class Asset extends Card {
  @field name = contains(StringCard);
  @field symbol = contains(StringCard);
  @field logoURL = contains(StringCard);
  @field exchangeRate = contains(IntegerCard, {
    computeVia: function (this: Asset) {
      return EXCHANGE_RATES[this.symbol];
    },
  });
  @field logoHref = contains(StringCard, {
    computeVia: function (this: Asset) {
      if (!this.logoURL) {
        return null;
      }
      return new URL(this.logoURL, this[relativeTo] || this.id).href;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Asset) {
      return this.name;
    },
  });
  static embedded = class Embedded extends Component<typeof Asset> {
    <template>
      <CardContainer class='asset-card'>
        {{#if @model.logoURL}}
          <img src={{@model.logoHref}} width='20' height='20' />
        {{/if}}
        <div class='payment-method__currency'><@fields.symbol /></div>
      </CardContainer>
    </template>
  };
}

// For fiat money
export class Currency extends Asset {
  @field sign = contains(StringCard); // $, €, £, ¥, ₽, ₿ etc.
}

// For crypto
export class Token extends Asset {
  @field address = contains(StringCard);
}
