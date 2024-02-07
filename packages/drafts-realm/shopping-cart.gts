import NumberField from 'https://cardstack.com/base/number';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { Product as ProductCard } from './product';
import { MonetaryAmount, MonetaryAmountEmbedded } from './monetary-amount';
import { Currency } from './asset';
import { ExchangeRate } from './exchange-rate';

class LineItemEmbedded extends Component<typeof LineItem> {
  <template>
    <div class='row'>
      <div class='cell'>
        <@fields.quantity @format='atom' />
      </div>
      <div class='cell'>
        <@fields.product.title @format='atom' />
      </div>
      <div class='cell'>
        <@fields.product.unitPrice @format='atom' />
      </div>
      <div class='cell'>
        <@fields.total @format='atom' />
      </div>
    </div>
    <style>
      .row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
      }
      .cell {
        flex: 1;
      }
    </style>
  </template>
}

class LineItem extends FieldDef {
  @field product = linksTo(ProductCard);
  @field quantity = contains(NumberField);
  @field total = contains(MonetaryAmount, {
    computeVia(this: LineItem) {
      let result = new MonetaryAmount();
      if (!this.product || !this.quantity) {
        result.amount = 0;
        return result;
      }
      result.currency = this.product.unitPrice.currency;
      result.amount = this.product.unitPrice.amount * this.quantity;
      return result;
    },
  });

  static displayName = 'Shopping Cart Line Item';
  static embedded = LineItemEmbedded;
}

class ShoppingCartIsolated extends Component<typeof ShoppingCart> {
  lookupExchangeRateCard(
    asset1: Currency,
    asset2: Currency,
  ): ExchangeRate | undefined {
    if (asset1 === asset2) {
      return new ExchangeRate({
        asset1: asset1,
        asset2: asset2,
        conversionRate: 1,
      });
    }
    let pairs = this.args.model.exchangeRates;
    return pairs?.find(
      (pair) =>
        (pair.asset1 === asset1 && pair.asset2 === asset2) ||
        (pair.asset1 === asset2 && pair.asset2 === asset1),
    );
  }

  get total(): MonetaryAmount {
    let { model } = this.args;
    let result = new MonetaryAmount();
    if (!model.lineItems || !model.preferredCurrency) {
      result.amount = 0;
      return result;
    }
    result.currency = model.preferredCurrency;
    let lineItemExchangeRatePairs: [LineItem, ExchangeRate?][] = [];
    for (let lineItem of model.lineItems) {
      let exchangeRate = this.lookupExchangeRateCard(
        lineItem.total.currency,
        model.preferredCurrency,
      );
      lineItemExchangeRatePairs.push([lineItem, exchangeRate]);
    }
    result.amount = lineItemExchangeRatePairs.reduce(
      (sum, [lineItem, exchangeRate]) => {
        return sum + (exchangeRate?.convert(lineItem.total).amount || 0);
      },
      0,
    );
    return result;
  }

  <template>
    <div>
      <div class='header-container'>
        Shopping Cart
      </div>
      <div class='cart-container'>
        <@fields.lineItems />
        <@fields.preferredCurrency />
        <MonetaryAmountEmbedded @model={{this.total}} />
      </div>
    </div>
    <style>
      .header-container {
        background-image: url(https://i.imgur.com/PQuDAEo.jpg);
        color: white;
        font: var(--boxel-font-lg);
        padding: var(--boxel-sp);
      }
      .cart-container {
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}

export class ShoppingCart extends CardDef {
  static displayName = 'Shopping Cart';
  @field lineItems = containsMany(LineItem);
  @field preferredCurrency = linksTo(Currency);
  @field exchangeRates = linksToMany(ExchangeRate);
  static isolated = ShoppingCartIsolated;

  /*

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }


































  */
}

function waitUntil(predicate: () => Boolean) {
  return new Promise((resolve) => {
    let interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}
