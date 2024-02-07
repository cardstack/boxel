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
        <img src={{@model.product.thumbnailURL}} alt={{@model.product.title}} />
        <@fields.product.title @format='atom' />
      </div>
      <div class='cell quantity-cell'>
        <@fields.quantity @format='atom' />
      </div>
      <div class='cell price-cell'>
        <@fields.product.unitPrice @format='atom' />
      </div>
      <div class='cell price-cell'>
        <@fields.total @format='atom' />
      </div>
    </div>
    <style>
      .row {
        display: grid;
        grid-template-columns: 1fr 60px 120px 120px;
      }
      .cell {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm) var(--boxel-sp-xs) 0;
      }
      img {
        border-radius: 5px;
        display: block;
        max-width: 60px;
        aspect-ratio: 1.6;
        object-fit: cover;
        float: left;
        margin-right: var(--boxel-sp-xs);
      }
      .quantity-cell {
        text-align: center;
      }
      .price-cell {
        text-align: right;
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
      if (!this.product?.unitPrice || !this.quantity) {
        result.amount = 0;
        return result;
      }
      return this.product.unitPrice.multiply(this.quantity);
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
    if (asset1.symbol === asset2.symbol) {
      return {
        asset1: asset1,
        asset2: asset2,
        conversionRate: 1,
        convert(input: MonetaryAmount) {
          if (input.currency.symbol === this.asset1.symbol) {
            return input.amount * this.conversionRate;
          } else if (input.currency.symbol === this.asset2.symbol) {
            return input.amount * (1 / this.conversionRate);
          } else {
            throw new Error(
              `Can only convert amounts in ${this.asset1.symbol} to ${this.asset2.symbol}, and vice versa`,
            );
          }
        },
      } as ExchangeRate;
    }
    let pairs = this.args.model.exchangeRates;
    return pairs?.find(
      (pair) =>
        (pair.asset1.symbol === asset1.symbol &&
          pair.asset2.symbol === asset2.symbol) ||
        (pair.asset1.symbol === asset2.symbol &&
          pair.asset2.symbol === asset1.symbol),
    );
  }

  get total(): MonetaryAmount {
    let { model } = this.args;
    let result = new MonetaryAmount();
    result.currency = model.preferredCurrency!;
    if (!model.lineItems) {
      result.amount = 0;
      return result;
    }
    let lineItemExchangeRatePairs: [LineItem, ExchangeRate?][] = [];
    for (let lineItem of model.lineItems) {
      let exchangeRate = this.lookupExchangeRateCard(
        lineItem.total.currency,
        model.preferredCurrency!,
      );
      lineItemExchangeRatePairs.push([lineItem, exchangeRate]);
    }
    result.amount = lineItemExchangeRatePairs.reduce(
      (sum, [lineItem, exchangeRate]) => {
        // console.log(exchangeRate?.asset1); // if you comment this line in, and construct a new instance of ExchangeRate in lookupExchangeRateCard, the component continuously re-renders
        // return sum + lineItem.total.amount || 0;
        return sum + (exchangeRate?.convert(lineItem.total) || 0);
      },
      0,
    );
    return result;
  }

  <template>
    <div>
      <div class='header-container'>
        Shopping Cart
        <div class='preferred-currency-container'>
          Preferred currency:<br />
          <@fields.preferredCurrency @format='atom' />
        </div>
      </div>
      <div class='cart-container'>
        <div class='line-items-header'>
          <div class='cell'>
            Product
          </div>
          <div class='cell quantity-cell'>
            Qty
          </div>
          <div class='cell price-cell'>
            Unit Price
          </div>
          <div class='cell price-cell'>
            Total
          </div>
        </div>

        <@fields.lineItems />
        <div class='cell total-container'>
          <MonetaryAmountEmbedded @model={{this.total}} />
        </div>
      </div>
    </div>
    <style>
      .header-container {
        background-image: url(https://i.imgur.com/PQuDAEo.jpg);
        color: white;
        font: var(--boxel-font-lg);
        font-weight: bold;
        padding: var(--boxel-sp);
      }
      .preferred-currency-container {
        color: white;
        float: right;
        font: var(--boxel-font-sm);
        margin-top: -8px;
        text-align: right;
      }
      .preferred-currency-container > div {
        color: black;
      }
      .cart-container {
        padding: var(--boxel-sp);
      }
      .line-items-header {
        display: grid;
        grid-template-columns: 1fr 60px 120px 120px;
        font-weight: bold;
      }
      .cell {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm) var(--boxel-sp-xs) 0;
      }
      .quantity-cell {
        text-align: center;
      }
      .price-cell {
        text-align: right;
      }
      .total-container {
        font-weight: bold;
        text-align: right;
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
