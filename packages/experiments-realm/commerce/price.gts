import NumberField from '../../base/number';
import { MonetaryAmount } from '../monetary-amount';
import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
//essentially, copied from offer but treated within a field
export class PriceCta extends FieldDef {
  @field label = contains(StringField);
  @field subLabel = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model.label}}
      {{@model.subLabel}}
    </template>
  };
}

const PRICE_TYPES = ['subscription', 'one-time', 'discount', 'free'];
const PRICE_INTERVALS = ['monthly', 'yearly'];

export class PriceType extends StringField {
  private static priceTypes = PRICE_TYPES;

  static edit = class Edit extends Component<typeof this> {
    get priceTypes() {
      return PriceType.priceTypes;
    }
    <template>
      <BoxelSelect
        @options={{this.priceTypes}}
        @selected={{@model}}
        @onChange={{@set}}
        as |item|
      >
        {{item}}
      </BoxelSelect>
    </template>
  };
}

export class PriceInterval extends StringField {
  private static intervals = PRICE_INTERVALS;

  static edit = class Edit extends Component<typeof this> {
    get intervals() {
      return PriceInterval.intervals;
    }
    <template>
      <BoxelSelect
        @options={{this.intervals}}
        @selected={{@model}}
        @onChange={{@set}}
        as |item|
      >
        {{item}}
      </BoxelSelect>
    </template>
  };
}

export class Price extends FieldDef {
  get validPriceType() {
    return PRICE_TYPES.includes(this.type);
  }

  get validPriceInterval() {
    return PRICE_INTERVALS.includes(this.interval);
  }

  get validDiscountType() {
    return (
      this.type === 'discount' &&
      this.percentDiscount !== null &&
      this.percentDiscount !== undefined &&
      this.percentDiscount >= 0 &&
      this.percentDiscount <= 100
    );
  }

  @field summary = contains(StringField);
  @field basePrice = contains(MonetaryAmount);
  @field cta = contains(PriceCta, {
    computeVia: function (this: Price) {
      let priceCta = new PriceCta({});

      if (this.type === 'free') {
        priceCta.label = 'Free';
        priceCta.subLabel = '';
      } else {
        const currencySign = this.value?.currency?.sign || '';
        const amount = this.value?.amount;

        switch (this.type) {
          case 'one-time':
            priceCta.label = `Buy for ${amount || ''} ${currencySign}`;
            priceCta.subLabel = 'Base Price';
            break;
          case 'discount':
            const basePrice = this.basePrice?.amount;
            if (basePrice !== undefined && this.percentDiscount !== undefined) {
              const discountedAmount =
                basePrice * (1 - this.percentDiscount / 100);
              priceCta.label = `Buy for ${basePrice} ${currencySign}`; // This should be crossed out
              priceCta.subLabel = `${
                this.percentDiscount
              }% off: ${discountedAmount.toFixed(2)} ${currencySign}`;
            }
            break;
          case 'subscription':
            priceCta.label = 'Subscribe';
            priceCta.subLabel = `${currencySign} ${amount || ''} per ${
              this.interval || ''
            }`;
            break;
          default:
            if (amount && currencySign) {
              priceCta.label = `Buy for ${amount} ${currencySign}`;
            }
        }
      }

      return priceCta;
    },
  });
  @field type = contains(PriceType);
  @field interval = contains(PriceInterval);
  @field value = contains(MonetaryAmount);
  @field percentDiscount = contains(NumberField);

  static edit = class Edit extends Component<typeof this> {
    <template>
      <@fields.type format='edit' />
      <@fields.summary format='edit' />
      {{#if (eq @model.type 'one-time')}}
        <@fields.value format='edit' />
      {{else if (eq @model.type 'subscription')}}
        <@fields.value format='edit' />
        <@fields.interval format='edit' />
      {{else if (eq @model.type 'discount')}}
        <@fields.percentDiscount format='edit' />
      {{else}}
      {{/if}}
      <@fields.cta />
    </template>
  };
}
