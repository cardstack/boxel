import NumberField from 'https://cardstack.com/base/number';
import {
  FieldDef,
  field,
  contains,
  linksTo,
  relativeTo,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { Currency } from './asset';
import { action } from '@ember/object';
import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { getLiveCards } from '@cardstack/runtime-common';
import { cn } from '@cardstack/boxel-ui/helpers';
import { guidFor } from '@ember/object/internals';

class Edit extends Component<typeof MonetaryAmount> {
  get id() {
    return guidFor(this);
  }

  // TODO: how to I query the current realm? Do I even want to do that?
  liveCurrencyQuery = getLiveCards(
    {
      filter: {
        type: {
          module: `${this.args.model[relativeTo]?.origin}/drafts/asset`,
          name: 'Currency',
        },
      },
      sort: [
        {
          on: {
            module: `${this.args.model[relativeTo]?.origin}/drafts/asset`,
            name: 'Currency',
          },
          by: 'name',
        },
      ],
    },
    this.args.model[relativeTo]
      ? [`${this.args.model[relativeTo]?.origin}/drafts/`]
      : undefined,
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
      <:before>
        <div class='input-selectable-currency-amount__before'>
          <span class='input-selectable-currency-amount__currency-sign'>
            {{this.args.model.currency.sign}}
          </span>
        </div>
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
          as |item itemCssClass|
        >
          <div
            data-test-currency={{item.symbol}}
            class={{cn
              'input-selectable-currency-amount__dropdown-item'
              itemCssClass
            }}
          >
            {{#if item.logoURI}}
              <img
                src={{item.logoURI}}
                class='boxel-selectable-currency-icon__icon'
                loading='lazy'
                role='presentation'
              />
            {{/if}}
            {{item.symbol}}
            ({{item.name}})
          </div>
        </Accessories.Select>
      </:after>
    </BoxelInputGroup>
    <style>
      .input-selectable-currency-amount {
        --input-selectable-currency-amount-input-font-size: var(
          --boxel-font-size
        );

        position: relative;
        width: 100%;
        font-family: var(--boxel-font-family);
        font-size: var(--input-selectable-currency-amount-input-font-size);
      }
      .input-selectable-currency-amount__before {
        border-top: 1px solid #aaaaaa;
        border-bottom: 1px solid #aaaaaa;
        border-left: 1px solid #aaaaaa;
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

export class MonetaryAmount extends FieldDef {
  static displayName = 'MonetaryAmount';

  @field amount = contains(NumberField);
  @field currency = linksTo(Currency);

  static edit = Edit;

  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }
























































  */
}
