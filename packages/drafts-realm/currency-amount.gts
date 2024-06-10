import {
  Component,
  FieldDef,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import {
  BoxelInput,
  BoxelSelect,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

const formatNumber = (val: number) => {
  let formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(val);
};

class EmbeddedSecForAmount extends Component<typeof CurrencyAmount> {
  get getFormattedAmount() {
    if (!this.args.model.totalAmount) return null;
    const formattedNumber = formatNumber(this.args.model.totalAmount);
    return formattedNumber;
  }

  <template>
    {{this.getFormattedAmount}}
  </template>
}

class EditSecForAmount extends Component<typeof CurrencyAmount> {
  @tracked currencyOptions = ['Select', 'RM', 'USD'];
  get selectedCurrency() {
    return this.args.model.currency || this.currencyOptions[0] || 'Select';
  }

  @action
  updateCurrency(item: string) {
    this.args.model.currency = item;
  }

  @action
  updateAmount(val: number) {
    this.args.model.totalAmount = val;
  }

  get getFormattedAmount() {
    if (!this.args.model.totalAmount) return null;
    const formattedNumber = formatNumber(this.args.model.totalAmount);
    return formattedNumber;
  }

  <template>
    <div class='container'>
      <div class='form-row-full'>
        <FieldContainer @tag='label' @vertical={{true}} class='left-input'>
          <BoxelSelect
            @selected={{this.selectedCurrency}}
            @onChange={{this.updateCurrency}}
            @options={{this.currencyOptions}}
            class='select'
            aria-label='Select Currency'
            as |item|
          >
            <div>{{item}}</div>
          </BoxelSelect>
        </FieldContainer>

        <FieldContainer @tag='label' @vertical={{true}} class='right-input'>
          <BoxelInput
            @value={{this.args.model.totalAmount}}
            @onInput={{this.updateAmount}}
            @helperText={{this.getFormattedAmount}}
          />
        </FieldContainer>
      </div>

    </div>

    <style>
      .container {
        container-type: inline-size;
      }
      .form-row-full {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .left-input {
        display: inline-block;
        min-width: 100px;
        flex: auto;
      }
      .right-input {
        display: inline-block;
        flex-grow: 1;
        width: 100%;
      }
      .select {
        padding: var(--boxel-sp-xxs);
        background-color: white;
      }

      @container (min-width: 640px) {
        .form-row-full {
          flex-wrap: nowrap;
        }
      }
    </style>
  </template>
}

export class CurrencyAmount extends FieldDef {
  static displayName = 'Currency Amount';
  @field currency = contains(StringField, {
    description: `Currency`,
  });

  @field totalAmount = contains(NumberField, {
    description: `Total Amount`,
  });

  static embedded = EmbeddedSecForAmount;
  static edit = EditSecForAmount;
}
