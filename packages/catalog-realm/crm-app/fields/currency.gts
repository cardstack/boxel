import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import CurrencyDollarIcon from '@cardstack/boxel-icons/currency-dollar';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import type Owner from '@ember/owner';
// @ts-ignore
import { currencyCodeSymbolMapping } from 'https://esm.run/currency-code-symbol-map';

export class Currency extends CardDef {
  static displayName = 'Currency';
  static icon = CurrencyDollarIcon;
  @field code = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.code />
    </template>
  };
}

interface CurrencyData {
  code: string;
}

class CurrencyFieldEdit extends Component<typeof CurrencyField> {
  // TODO: this is a temporary fix to show the default symbol until the field allows for a default value
  @tracked currency: CurrencyData | undefined = this.args.model.code
    ? {
        code: this.args.model.code,
      }
    : { code: 'USD' };
  @tracked currencies: CurrencyData[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCurrencies.perform();
  }

  private loadCurrencies = restartableTask(async () => {
    this.currencies = Object.entries(currencyCodeSymbolMapping).map(
      ([code, symbol]) => {
        return {
          code,
          symbol,
        } as CurrencyData;
      },
    );
  });

  @action onSelectCurrency(currency: CurrencyData) {
    this.currency = { code: currency.code };
    this.args.model.code = currency.code;
  }

  <template>
    {{#if this.loadCurrencies.isRunning}}
      Loading currencies...
    {{else}}
      <BoxelSelect
        @placeholder='Choose a currency'
        @options={{this.currencies}}
        @selected={{this.currency}}
        @onChange={{this.onSelectCurrency}}
        @searchEnabled={{true}}
        @searchField='code'
        class='currency-field-edit'
        as |currency|
      >
        {{currency.code}}
      </BoxelSelect>
    {{/if}}
  </template>
}

export class CurrencyField extends FieldDef {
  static displayName = 'Currency';
  @field code = contains(StringField);
  static edit = CurrencyFieldEdit;

  get symbol() {
    // TODO: this is a temporary fix to show the default symbol until the field allows for a default value
    return currencyCodeSymbolMapping[this.code || 'USD'];
  }

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model.symbol}}
    </template>
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
