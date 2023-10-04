import {
  contains,
  field,
  CardDef,
  FieldDef,
  Component,
  relativeTo,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import NumberCard from 'https://cardstack.com/base/number';

let EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  USDC: 1,
  DAI: 1,
  LINK: 0.16995055,
  EUR: 0.94,
};

class Asset extends CardDef {
  static displayName = 'Asset';
  @field name = contains(StringCard);
  @field symbol = contains(StringCard);
  @field logoURL = contains(StringCard);
  @field exchangeRate = contains(NumberCard, {
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
      <div class='asset-card'>
        {{#if @model.logoURL}}
          <img src={{@model.logoHref}} width='20' height='20' />
        {{/if}}
        <div class='currency'><@fields.symbol /></div>
      </div>
      <style>
        .asset-card {
          display: inline-grid;
          grid-template-columns: var(--boxel-sp) 1fr;
          gap: var(--boxel-sp-xxxs);
        }

        .currency {
          font: 700 var(--boxel-font);
        }
      </style>
    </template>
  };
}

class AssetField extends FieldDef {
  static displayName = 'Asset';
  @field name = contains(StringCard);
  @field symbol = contains(StringCard);
  @field logoURL = contains(StringCard);
  @field exchangeRate = contains(NumberCard, {
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
      <div class='asset-card'>
        {{#if @model.logoURL}}
          <img src={{@model.logoHref}} width='20' height='20' />
        {{/if}}
        <div class='currency'><@fields.symbol /></div>
      </div>
      <style>
        .asset-card {
          display: inline-grid;
          grid-template-columns: var(--boxel-sp) 1fr;
          gap: var(--boxel-sp-xxxs);
        }

        .currency {
          font: 700 var(--boxel-font);
        }
      </style>
    </template>
  };
}

// For fiat money
export class Currency extends Asset {
  static displayName = 'Currency Card Type With Very Very Long Display Name';
  @field sign = contains(StringCard); // $, €, £, ¥, ₽, ₿ etc.
}

export class CurrencyField extends AssetField {
  static displayName = 'Currency Card Type With Very Very Long Display Name';
  @field sign = contains(StringCard); // $, €, £, ¥, ₽, ₿ etc.
}

// For crypto
export class Token extends Asset {
  static displayName = 'Token';
  @field address = contains(StringCard);
}

export class TokenField extends AssetField {
  static displayName = 'Token';
  @field address = contains(StringCard);
}
