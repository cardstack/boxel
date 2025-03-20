import NumberField from 'https://cardstack.com/base/number';
import {
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { Currency } from './asset';
import { action } from '@ember/object';
import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { guidFor } from '@ember/object/internals';
import GlimmerComponent from '@glimmer/component';

interface MonetaryAmountAtomSignature {
  Element: HTMLSpanElement;
  Args: {
    model: MonetaryAmount | Partial<MonetaryAmount> | undefined;
  };
}

export class MonetaryAmountAtom extends GlimmerComponent<MonetaryAmountAtomSignature> {
  <template>
    {{@model.formattedAmount}}
  </template>
}

class Atom extends Component<typeof MonetaryAmount> {
  <template>
    {{@model.formattedAmount}}
  </template>
}
class Edit extends Component<typeof MonetaryAmount> {
  get id() {
    return guidFor(this);
  }

  // TODO refactor to use <PrerenderedCardSearch> component from the @context if you want live search
  liveCurrencyQuery = this.args.context?.getCards(
    this,
    () => {
      return {
        filter: {
          type: {
            module: new URL('./asset', import.meta.url).href,
            name: 'Currency',
          },
        },
        sort: [
          {
            on: {
              module: new URL('./asset', import.meta.url).href,
              name: 'Currency',
            },
            by: 'name',
          },
        ],
      };
    },
    () => [new URL('./', import.meta.url).href],
  );

  @action
  setAmount(val: number) {
    let newModel = new MonetaryAmount();
    newModel.amount = val;
    newModel.currency = this.args.model.currency as Currency;
    this.args.set(newModel);
  }

  @action
  setCurrency(val: Currency) {
    let newModel = new MonetaryAmount();
    newModel.amount = this.args.model.amount as number;
    newModel.currency = val;
    this.args.set(newModel);
  }

  <template>
    <BoxelInputGroup
      @id={{this.id}}
      @placeholder='0.00'
      @value={{@model.amount}}
      @invalid={{false}}
      @onInput={{this.setAmount}}
      @autocomplete='off'
      @inputmode='decimal'
      class='input-selectable-currency-amount'
    >
      <:before as |Accessories|>
        <Accessories.Text>{{@model.currency.sign}}</Accessories.Text>
      </:before>
      <:after as |Accessories|>
        <Accessories.Select
          class='input-selectable-currency-amount__select'
          @placeholder='Choose...'
          @options={{this.liveCurrencyQuery.instances}}
          @selected={{@model.currency}}
          @onChange={{this.setCurrency}}
          @dropdownClass='input-selectable-currency-amount__dropdown'
          @verticalPosition='below'
          as |item|
        >
          <div
            data-test-currency={{item.symbol}}
            class='input-selectable-currency-amount__dropdown-item'
            title={{item.name}}
          >
            {{#if item.logoURL}}
              <img
                src={{item.logoURL}}
                class='boxel-selectable-currency-icon__icon'
                loading='lazy'
                aria-hidden='true'
              />
            {{/if}}
            {{item.symbol}}
          </div>
        </Accessories.Select>
      </:after>
    </BoxelInputGroup>
    <style scoped>
      .input-selectable-currency-amount {
        --input-selectable-currency-amount-input-font-size: var(
          --boxel-font-size
        );

        position: relative;
        width: 100%;
        font-family: var(--boxel-font-family);
        font-size: var(--input-selectable-currency-amount-input-font-size);
      }

      .input-selectable-currency-amount__select[aria-disabled='true'] {
        opacity: 0.5;
      }

      .input-selectable-currency-amount__dropdown-item {
        white-space: nowrap;
      }

      .input-selectable-currency-amount__dropdown
        :deep(.ember-power-select-options[role='listbox']) {
        max-height: 18em;
      }
      .boxel-selectable-currency-icon__icon {
        margin-right: var(--boxel-sp-xxxs);
        vertical-align: bottom;
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
      }
    </style>
  </template>
}

interface MonetaryAmountEmbeddedSignature {
  Element: HTMLDivElement;
  Args: {
    model: MonetaryAmount | Partial<MonetaryAmount> | undefined;
  };
}

export class MonetaryAmountEmbedded extends GlimmerComponent<MonetaryAmountEmbeddedSignature> {
  <template>
    <div class='monetary-amount'>
      {{@model.formattedAmount}}
      {{#if @model.currency.logoURL}}
        <img
          src={{@model.currency.logoURL}}
          class='icon'
          loading='lazy'
          aria-hidden='true'
        />
      {{/if}}
    </div>
    <style scoped>
      .monetary-amount {
        font: var(--boxel-font-lg);
      }
    </style>
  </template>
}

class MonetaryAmountEmbeddedFormat extends Component<typeof MonetaryAmount> {
  <template>
    <MonetaryAmountEmbedded @model={{@model}} />
  </template>
}

export class MonetaryAmount extends FieldDef {
  static displayName = 'MonetaryAmount';

  @field amount = contains(NumberField);
  @field currency = linksTo(Currency);

  get formattedAmount() {
    return this.currency?.format(this.amount);
  }

  multiply(multiplier: number) {
    let newModel = new MonetaryAmount();
    newModel.amount = (this.amount || 0) * multiplier;
    newModel.currency = this.currency;
    return newModel;
  }

  static edit = Edit;
  static atom = Atom;
  static embedded = MonetaryAmountEmbeddedFormat;
}
