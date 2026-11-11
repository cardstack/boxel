import NumberField, { deserializeForUI, serializeForUI } from './number';
import { FieldDef, field, contains, Component } from './card-api';
import { NumberSerializer } from '@cardstack/runtime-common';
import { TextInputValidator } from './text-input-validator';
import CurrencyField from './currency';
import { action } from '@ember/object';
import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { ignoredByPasswordManagers } from './components/password-managers';
import { guidFor } from '@ember/object/internals';

class View extends Component<typeof AmountWithCurrency> {
  get formatNumberWithSeparator() {
    let num = this.args.model.amount;
    const currencySymbol = this.args.model.currency?.symbol;

    if (num === null || num === undefined) {
      num = 0;
    }

    return `${currencySymbol} ${num.toLocaleString('en-US')}`;
  }

  <template>{{this.formatNumberWithSeparator}}</template>
}

class Edit extends Component<typeof AmountWithCurrency> {
  get id() {
    return guidFor(this);
  }

  @action
  setAmount(val: number | null | undefined) {
    let newModel = new AmountWithCurrency();
    if (val != null) {
      newModel.amount = val;
    }
    newModel.currency.code = newModel.currency.code || 'USD';
    this.args.set(newModel);
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model.amount ?? null,
    (val) => this.setAmount(val),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  @action
  setCurrency(val: CurrencyField) {
    let newModel = new AmountWithCurrency();
    newModel.amount = this.args.model.amount as number;
    newModel.currency = val;
    this.args.set(newModel);
  }

  <template>
    <BoxelInputGroup
      @id={{this.id}}
      @placeholder='0.00'
      @value={{this.textInputValidator.asString}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @onInput={{this.textInputValidator.onInput}}
      @autocomplete='off'
      @inputmode='decimal'
      class='input-selectable-currency-amount'
      {{ignoredByPasswordManagers}}
    >
      <:before as |Accessories|>
        <Accessories.Text>{{@model.currency.symbol}}</Accessories.Text>
      </:before>
      <:after>
        <div class='input-selectable-currency'>
          <@fields.currency />
        </div>
      </:after>
    </BoxelInputGroup>
    <style scoped>
      .input-selectable-currency-amount {
        position: relative;
        width: 100%;
      }

      .input-selectable-currency > div {
        height: 100%;
      }

      /* the currency picker sets its own height and type size */
      :deep(.currency-field-edit) {
        min-width: 6.25rem;
      }
    </style>
  </template>
}

export default class AmountWithCurrency extends FieldDef {
  static displayName = 'Amount With Currency';

  @field amount = contains(NumberField);
  @field currency = contains(CurrencyField);

  static edit = Edit;
  static atom = View;
  static embedded = View;
}
