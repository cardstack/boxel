import { contains, field, Component, CardDef, FieldDef } from './card-api';
import StringField from './string';
import CurrencyDollarIcon from '@cardstack/boxel-icons/currency-dollar';
import { Select } from '@cardstack/pretui/components/select';
import type { SelectOption } from '@cardstack/pretui/components/select';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import type Owner from '@ember/owner';
import { currencyCodeSymbolMapping } from './helpers/currency-symbols';

export class Currency extends CardDef {
  static displayName = 'Currency';
  static icon = CurrencyDollarIcon;
  @field code = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.code /></template>
  };
}

class CurrencyFieldEdit extends Component<typeof CurrencyField> {
  @tracked currencies: SelectOption[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCurrencies.perform();
  }

  private loadCurrencies = restartableTask(async () => {
    this.currencies = Object.keys(currencyCodeSymbolMapping).map((code) => ({
      value: code,
      label: code,
    }));
  });

  // TODO: this is a temporary fix to show the default symbol until the field allows for a default value
  get code() {
    return this.args.model.code || 'USD';
  }

  @action onSelectCurrency(code: string) {
    this.args.model.code = code;
  }

  <template>
    {{#if this.loadCurrencies.isRunning}}
      Loading currencies...
    {{else}}
      <Select
        @placeholder='Choose a currency'
        @options={{this.currencies}}
        @value={{this.code}}
        @onValueChange={{this.onSelectCurrency}}
        @searchEnabled={{true}}
        class='currency-field-edit'
      />
    {{/if}}
    <style scoped>
      /* the app's full control size, beside the edit form's other inputs */
      .currency-field-edit {
        --pretui-field-h: var(--boxel-form-control-height);
        --pretui-field-font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

export default class CurrencyField extends FieldDef {
  static displayName = 'Currency';
  static icon = CurrencyDollarIcon;
  @field code = contains(StringField);
  static edit = CurrencyFieldEdit;

  get symbol() {
    // TODO: this is a temporary fix to show the default symbol until the field allows for a default value
    return currencyCodeSymbolMapping[this.code || 'USD'];
  }

  static atom = class Atom extends Component<typeof this> {
    <template>{{@model.symbol}}</template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{! TODO: this is a temporary fix to show the default symbol until the field allows for a default value }}
      {{#if @model.symbol}}
        {{@model.symbol}}
      {{else}}
        Please select a currency
      {{/if}}
    </template>
  };
}
