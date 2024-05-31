import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  FieldDef,
  contains,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import DateCard from 'https://cardstack.com/base/date';
import StringField from 'https://cardstack.com/base/string';
import {
  BoxelInput,
  BoxelSelect,
  CardContainer,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { CrmAccount } from './crm/account';
import NumberField from '../base/number';

interface CategorySignature {
  name: string;
}

export const formatNumber = (val: number) => {
  let formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(val);
};

/* Percentage */
class EditSecForPercentageField extends Component<typeof PercentageField> {
  @action
  updatePercentage(val: number) {
    this.args.model.percentage = val;
  }

  get getFormattedPercentage() {
    if (!this.args.model.percentage) return null;
    const formattedNumber = formatNumber(
      Math.round(this.args.model.percentage),
    );

    return formattedNumber + '%';
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>
      <FieldContainer @tag='label' @vertical={{true}}>
        <BoxelInput
          @value={{this.args.model.percentage}}
          @onInput={{this.updatePercentage}}
          @helperText={{this.getFormattedPercentage}}
        />
      </FieldContainer>
    </CardContainer>
  </template>
}

class EmbdeddedSecForPercentageField extends Component<typeof PercentageField> {
  get getFormattedPercentage() {
    if (!this.args.model.percentage) return null;
    const formattedNumber = formatNumber(
      Math.round(this.args.model.percentage),
    );

    return formattedNumber + '%';
  }

  <template>
    <div class='totalCurrencyAmount'>{{this.getFormattedPercentage}}</div>

    <style>
      .totalCurrencyAmount {
        color: var(--boxel-dark-teal);
        font-weight: bold;
      }
    </style>
  </template>
}

class PercentageField extends FieldDef {
  @field percentage = contains(NumberField, {
    description: `Percentage`,
  });

  static edit = EditSecForPercentageField;
  static embedded = EmbdeddedSecForPercentageField;
}

/* Forecast */
class EmbeddedSecForForecastField extends Component<typeof ForecastField> {
  <template>
    <div class='subject'>{{this.args.model.category}}</div>

    <style>
      .subject {
        margin: 0px;
      }
    </style>
  </template>
}

class EditSecForForecastField extends Component<typeof ForecastField> {
  @tracked selectedCategory = {
    name: this.args.model.category || 'None',
  };

  @tracked categoryPlaceholder = this.args.model.category || 'None';

  @tracked categoryOptions = [
    { name: 'None' },
    { name: 'Omitted' },
    { name: 'Pipeline' },
    { name: 'Best Case' },
    { name: 'Commit' },
    { name: 'Closed' },
  ] as Array<CategorySignature>;

  @action updateCategory(type: { name: string }) {
    this.selectedCategory = type;
    this.args.model.category = type.name;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>

      <BoxelSelect
        @searchEnabled={{true}}
        @searchField='name'
        @placeholder={{this.categoryPlaceholder}}
        @selected={{this.selectedCategory}}
        @onChange={{this.updateCategory}}
        @options={{this.categoryOptions}}
        class='select'
        as |item|
      >
        <div>{{item.name}}</div>
      </BoxelSelect>

    </CardContainer>

    <style>
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

class ForecastField extends FieldDef {
  @field category = contains(StringField, {
    description: `Selected Category`,
  });

  static edit = EditSecForForecastField;
  static embedded = EmbeddedSecForForecastField;
}

/* Stage */
class EmbeddedSecForStageField extends Component<typeof StageField> {
  <template>
    <div class='subject'>{{this.args.model.category}}</div>

    <style>
      .subject {
        margin: 0px;
      }
    </style>
  </template>
}

class EditSecForStageField extends Component<typeof StageField> {
  @tracked selectedCategory = {
    name: this.args.model.category || 'None',
  };

  @tracked categoryPlaceholder = this.args.model.category || 'None';

  @tracked categoryOptions = [
    { name: 'None' },
    { name: 'Qualification' },
    { name: 'Needs Analysis' },
    { name: 'Proposal' },
    { name: 'Negotiation' },
    { name: 'Closed Won' },
    { name: 'Closed Lost' },
  ] as Array<CategorySignature>;

  @action updateCategory(type: { name: string }) {
    this.selectedCategory = type;
    this.args.model.category = type.name;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>

      <BoxelSelect
        @searchEnabled={{true}}
        @searchField='name'
        @placeholder={{this.categoryPlaceholder}}
        @selected={{this.selectedCategory}}
        @onChange={{this.updateCategory}}
        @options={{this.categoryOptions}}
        class='select'
        as |item|
      >
        <div>{{item.name}}</div>
      </BoxelSelect>

    </CardContainer>

    <style>
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

class StageField extends FieldDef {
  @field category = contains(StringField, {
    description: `Selected Category`,
  });

  static edit = EditSecForStageField;
  static embedded = EmbeddedSecForStageField;
}

/* Account */
class EditSecForAccountField extends Component<typeof AccountField> {
  @tracked selectedAccount = {
    name: this.args.model.name || 'Select',
  };

  @tracked accountPlaceholder = this.args.model.name || 'Select';

  get getAccountsNames() {
    let allAccounts = this.args.model.accounts || [];
    return allAccounts.map((o) => ({ name: o.accountName }));
  }

  @action updateAccount(type: { name: string }) {
    this.selectedAccount = type;
    this.args.model.name = type.name;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>

      <BoxelSelect
        @placeholder={{this.accountPlaceholder}}
        @selected={{this.selectedAccount}}
        @onChange={{this.updateAccount}}
        @options={{this.getAccountsNames}}
        class='select'
        as |item|
      >
        <div>{{item.name}}</div>
      </BoxelSelect>

    </CardContainer>

    <style>
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

class EmbeddedSecForAccountField extends Component<typeof AccountField> {
  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>
      {{this.args.model.name}}
    </CardContainer>

    <style>
      .card-container {
        background: transparent;
      }
    </style>
  </template>
}

class AccountField extends FieldDef {
  @field accounts = linksToMany(() => CrmAccount, {
    description: `CRM Accounts`,
  });
  @field name = contains(StringField, {
    description: `Account Name`,
  });

  static edit = EditSecForAccountField;
  static embedded = EmbeddedSecForAccountField;
}

/* Amount */
class EditSecForAmountField extends Component<typeof AmountField> {
  @tracked currencyOptions = ['USD', 'RM'];
  @tracked currencyPlaceHolder = 'RM';
  @tracked selectedCurrency = this.args.model.currency || 'RM';

  @action selectExampleOnSelectItem(item: string) {
    this.selectedCurrency = item;
  }

  @action
  updateCurrency(item: string) {
    this.args.model.currency = item;
    this.selectedCurrency = item;
  }

  @action
  updateAmount(val: number) {
    this.args.model.total = val;
  }

  get getFormattedAmount() {
    if (!this.args.model.total) return null;
    const formattedNumber = formatNumber(this.args.model.total);
    return formattedNumber;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>
      <div class='form-row-full'>
        <FieldContainer @tag='label' @vertical={{true}} class='inline-block'>
          <BoxelSelect
            @placeholder={{this.currencyPlaceHolder}}
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

        <FieldContainer @tag='label' @vertical={{true}} class='inline-block'>
          <BoxelInput
            @value={{this.args.model.total}}
            @onInput={{this.updateAmount}}
            @helperText={{this.getFormattedAmount}}
          />
        </FieldContainer>
      </div>

    </CardContainer>

    <style>
      .form-row-full {
        display: flex;
        width: 100%;
        gap: var(--boxel-sp-xs);
      }
      .inline-block {
        display: inline-block;
        flex-grow: 1;
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

class EmbdeddedSecForAmountField extends Component<typeof AmountField> {
  get getFormattedAmount() {
    if (!this.args.model.total) return null;
    const formattedNumber = formatNumber(this.args.model.total);
    return formattedNumber;
  }

  get totalCurrencyAmount() {
    if (!this.args.model.currency || !this.getFormattedAmount) return null;
    return this.args.model.currency + this.getFormattedAmount;
  }

  <template>
    <div class='totalCurrencyAmount'>{{this.totalCurrencyAmount}}</div>

    <style>
      .totalCurrencyAmount {
        color: var(--boxel-dark-teal);
        font-weight: bold;
      }
    </style>
  </template>
}

class AmountField extends FieldDef {
  @field currency = contains(StringField, {
    description: `Currency`,
  });

  @field total = contains(NumberField, {
    description: `Total Amount`,
  });

  static edit = EditSecForAmountField;
  static embedded = EmbdeddedSecForAmountField;
}

/* Opportunity Form */
class IsolatedSecForOpportunityForm extends Component<typeof OpportunityForm> {
  <template>
    <div class='card-container'>
      <div class='left-box'>
        <h2><@fields.opportunityName /></h2>
        <div class='description'><@fields.description /></div>
      </div>

      <div class='right-box'>
        <div class='field-input'>
          <label>Account Name: </label>
          <@fields.accountName />
        </div>

        <div class='field-input'>
          <label>Close Date: </label>
          <@fields.closeDate />
        </div>

        <div class='field-input'>
          <label>Amount: </label>
          <@fields.amount />
        </div>

        <div class='field-input'>
          <label>Stage: </label>
          <@fields.stage />
        </div>

        <div class='field-input'>
          <label>Percentage: </label>
          <@fields.percentage />
        </div>

        <div class='field-input'>
          <label>Forecast Category: </label>
          <@fields.forecastCategory />
        </div>
      </div>

    </div>

    <style>
      .card-container {
        padding: var(--boxel-sp-xl);
        display: grid;
        gap: var(--boxel-sp-lg);
        grid-template-columns: repeat(4, 1fr);
        container-type: inline-size;
        container-name: box;
      }
      .left-box {
        grid-column: span 4;
      }
      .right-box {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        gap: var(--boxel-sp-lg);
        grid-column: span 4;
        padding: var(--boxel-sp);
        background-color: #eeeeee50;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius-xl);
      }
      .description {
        text-align: justify;
      }
      .field-input {
        display: flex;
        gap: var(--boxel-sp-sm);
        font-size: 0.795rem;
        flex-wrap: wrap;
      }

      .field-input > label {
        font-weight: 700;
      }

      @container box (min-width: 640px) {
        .left-box {
          grid-column: span 2;
        }
        .right-box {
          grid-column: span 2;
          gap: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

class EditSecForOpportunityForm extends Component<typeof OpportunityForm> {
  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>
      <FieldContainer @tag='label' @label='Opportunity Name' @vertical={{true}}>
        <@fields.opportunityName />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Account Name' @vertical={{true}}>
        <@fields.accountName />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Close Date' @vertical={{true}}>
        <@fields.closeDate />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Amount' @vertical={{true}}>
        <@fields.amount />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Description' @vertical={{true}}>
        <@fields.description />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Stage' @vertical={{true}}>
        <@fields.stage />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Percentage' @vertical={{true}}>
        <@fields.percentage />
      </FieldContainer>

      <FieldContainer
        @tag='label'
        @label='Forecast Category'
        @vertical={{true}}
      >
        <@fields.forecastCategory />
      </FieldContainer>
    </CardContainer>

    <style>
      .card-container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

class ViewSecForOpportunityForm extends Component<typeof OpportunityForm> {
  <template>
    <CardContainer @displayBoundaries={{true}} class='card-container'>
      <@fields.opportunityName />
    </CardContainer>

    <style>
      .card-container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
        background-color: #eeeeee50;
      }
    </style>
  </template>
}

export class OpportunityForm extends CardDef {
  static displayName = 'Opportunity Form';
  @field opportunityName = contains(StringField, {
    description: `Opportunity Name`,
  });
  @field accountName = contains(AccountField, {
    description: `Account Name`,
  });
  @field closeDate = contains(DateCard, {
    description: `Close Date`,
  });
  @field amount = contains(AmountField, {
    description: `Amount`,
  });
  @field description = contains(MarkdownField, {
    description: `Description`,
  });
  @field stage = contains(StageField, {
    description: `Stage`,
  });
  @field percentage = contains(PercentageField, {
    description: `Percentage`,
  });
  @field forecastCategory = contains(ForecastField, {
    description: `Forecast Category`,
  });

  static isolated = IsolatedSecForOpportunityForm;
  static edit = EditSecForOpportunityForm;
  static embedded = ViewSecForOpportunityForm;
  static atom = ViewSecForOpportunityForm;
}
