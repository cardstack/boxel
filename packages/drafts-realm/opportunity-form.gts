import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  FieldDef,
  contains,
  field,
  linksTo,
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
import { Company } from './crm/account';
import NumberField from '../base/number';
import { MatrixUser } from './matrix-user';

interface CategorySignature {
  name: string;
  percentage?: number;
}

const formatNumber = (val: number) => {
  let formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(val);
};

/* Amount */
class EmbeddedSecForAmount extends Component<typeof AmountField> {
  <template>
    <CardContainer @displayBoundaries={{false}} class='container'>
      <FieldContainer @tag='label' @vertical={{true}}><@fields.currency
        /></FieldContainer>

      <FieldContainer @tag='label' @vertical={{true}}><@fields.totalAmount
        /></FieldContainer>
    </CardContainer>
  </template>
}

class EditSecForAmount extends Component<typeof AmountField> {
  @tracked currencyOptions = ['Select', 'RM'];
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
    <CardContainer @displayBoundaries={{false}} class='container'>
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

    </CardContainer>

    <style>
      .form-row-full {
        display: flex;
        width: 100%;
        gap: var(--boxel-sp-xs);
      }
      .left-input {
        display: inline-block;
        min-width: 100px;
      }
      .right-input {
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

class AmountField extends FieldDef {
  @field currency = contains(StringField, {
    description: `Currency`,
  });

  @field totalAmount = contains(NumberField, {
    description: `Total Amount`,
  });

  static embedded = EmbeddedSecForAmount;
  static edit = EditSecForAmount;
}

/* Opportunity Form */
class IsolatedSecForOpportunityForm extends Component<typeof OpportunityForm> {
  get getCompanyName() {
    if (!this.args.model.company) return '-';
    return this.args.model.company;
  }

  get getFormattedAmount() {
    const amount = this.args.model.amount;
    const hasAmount = amount && amount.totalAmount;
    if (!hasAmount) return null;
    const formattedNumber = formatNumber(amount.totalAmount);
    return formattedNumber;
  }

  get getTotalCurrencyAmount() {
    const amount = this.args.model.amount;
    const hasTotalCurrency =
      amount &&
      amount.currency &&
      amount.currency !== 'Select' &&
      this.getFormattedAmount;
    if (!hasTotalCurrency) return '-';
    return amount.currency + ' ' + this.getFormattedAmount;
  }

  get getStage() {
    if (!this.args.model.stage) return '-';
    return this.args.model.stage;
  }

  get getFormattedPercentage() {
    if (!this.args.model.percentage) return '-';

    const formattedNumber = formatNumber(
      Math.round(this.args.model.percentage),
    );

    return formattedNumber + '%';
  }

  get getForestCategory() {
    if (!this.args.model.forecastCategory) return '-';
    return this.args.model.forecastCategory;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='container'>
      <div class='left-box'>
        <h2><@fields.opportunityName /></h2>

        <div class='description'>
          <@fields.description />
        </div>
      </div>

      <div class='right-box'>
        <div class='field-input-column'>
          <label>Account Name: </label>
          <@fields.accountName />
        </div>

        <div class='field-input-group'>
          <div class='field-input'>
            <label>Company Name: </label>

            <@fields.company />
          </div>
          <div class='field-input'>
            <label>Close Date: </label>
            <@fields.closeDate />
          </div>
          <div class='field-input'>
            <label>Amount: </label>
            {{this.getTotalCurrencyAmount}}
          </div>
          <div class='field-input'>
            <label>Stage: </label>
            {{this.getStage}}
          </div>
          <div class='field-input'>
            <label>Percentage: </label>
            {{this.getFormattedPercentage}}
          </div>
          <div class='field-input'>
            <label>Forecast Category: </label>
            {{this.getForestCategory}}
          </div>
          <div class='field-input'>
            <label>Opportunity Owner: </label>
            <@fields.owner />
          </div>
        </div>
      </div>

    </CardContainer>

    <style>
      .container {
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
        grid-column: span 4;
        gap: var(--boxel-sp);
      }
      .right-box > * + * {
        border-top: 1px solid var(--boxel-form-control-border-color);
        border-bottom-width: 0px;
      }
      .description {
        text-align: justify;
      }
      .field-input {
        display: flex;
        gap: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-sm);
        flex-wrap: wrap;
      }
      .field-input-group {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        gap: var(--boxel-sp);
        background-color: #fbfbfb;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }
      .field-input-column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        flex-wrap: wrap;
      }
      label {
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
  /* Stage Category */
  get selectedStageCategory() {
    return {
      name:
        this.args.model.stage || this.stageCategoryOptions[0].name || 'Select',
    };
  }

  @tracked stageCategoryOptions = [
    { name: 'None', percentage: 0 },
    { name: 'Qualification', percentage: 10 },
    { name: 'Needs Analysis', percentage: 25 },
    { name: 'Proposal', percentage: 50 },
    { name: 'Negotiation', percentage: 75 },
    { name: 'Closed Won', percentage: 100 },
    { name: 'Closed Lost', percentage: 100 },
  ] as unknown as Array<CategorySignature>;

  @action updateStageCategory(type: { name: string; percentage: number }) {
    this.args.model.stage = type.name;
    this.args.model.percentage = type.percentage;
  }

  /* Percentage */
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

  /* Forecast Category */
  @tracked forecastCategoryOptions = [
    { name: 'None' },
    { name: 'Omitted' },
    { name: 'Pipeline' },
    { name: 'Best Case' },
    { name: 'Commit' },
    { name: 'Closed' },
  ] as Array<CategorySignature>;

  @tracked selectedForecastCategory = {
    name:
      this.args.model.forecastCategory ||
      this.forecastCategoryOptions[0].name ||
      'Select',
  };

  @action updateForecastCategory(type: { name: string }) {
    this.selectedForecastCategory = type;
    this.args.model.forecastCategory = type.name;
  }

  <template>
    <CardContainer @displayBoundaries={{true}} class='container'>
      <FieldContainer @tag='label' @label='Opportunity Name' @vertical={{true}}>
        <@fields.opportunityName />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Account Name' @vertical={{true}}>
        <@fields.accountName />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Company' @vertical={{true}}>
        <@fields.company />
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
        <BoxelSelect
          @searchEnabled={{true}}
          @searchField='name'
          @selected={{this.selectedStageCategory}}
          @onChange={{this.updateStageCategory}}
          @options={{this.stageCategoryOptions}}
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer @tag='label' @label='Percentage' @vertical={{true}}>
        <BoxelInput
          @value={{this.args.model.percentage}}
          @onInput={{this.updatePercentage}}
          @helperText={{this.getFormattedPercentage}}
        />
      </FieldContainer>

      <FieldContainer
        @tag='label'
        @label='Forecast Category'
        @vertical={{true}}
      >
        <BoxelSelect
          @searchEnabled={{true}}
          @searchField='name'
          @selected={{this.selectedForecastCategory}}
          @onChange={{this.updateForecastCategory}}
          @options={{this.forecastCategoryOptions}}
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer
        @tag='label'
        @label='Opportunity Owner'
        @vertical={{true}}
      >
        <@fields.owner />
      </FieldContainer>
    </CardContainer>

    <style>
      .container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

class ViewSecForOpportunityForm extends Component<typeof OpportunityForm> {
  <template>
    <div class='field-input-group'>
      <FieldContainer @tag='label' @label='Opportunity Name' @vertical={{true}}>
        <@fields.opportunityName />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Account Name' @vertical={{true}}>
        <@fields.accountName />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Company' @vertical={{true}}>
        <@fields.company />
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
      <FieldContainer
        @tag='label'
        @label='Opportunity Owner'
        @vertical={{true}}
      >
        <@fields.owner />
      </FieldContainer>
    </div>

    <style>
      .container {
        display: grid;
        gap: var(--boxel-sp-lg);
        overflow: hidden;
      }
      .field-group-title {
        font-size: 1rem;
        font-weight: bold;
        margin-bottom: 0.75rem;
        text-decoration: underline;
        text-decoration-thickness: 2px;
        text-underline-offset: 4px;
        color: var(--boxel-dark-teal);
      }
      .field-input-group {
        overflow: overlay;
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

export class OpportunityForm extends CardDef {
  static displayName = 'Opportunity Form';
  @field title = contains(StringField, {
    computeVia: function (this: OpportunityForm) {
      return this.opportunityName;
    },
  });
  @field opportunityName = contains(StringField, {
    description: `Opportunity Name`,
  });
  @field accountName = contains(StringField, {
    description: `Account Name`,
  });
  @field company = linksTo(Company, {
    description: `User's Company Name`,
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
  @field stage = contains(StringField, {
    description: `Stage`,
  });
  @field percentage = contains(NumberField, {
    description: `Percentage`,
  });
  @field forecastCategory = contains(StringField, {
    description: `Forecast Category`,
  });
  @field owner = linksTo(MatrixUser, {
    description: `Owner`,
  });

  static isolated = IsolatedSecForOpportunityForm;
  static edit = EditSecForOpportunityForm;
  static embedded = ViewSecForOpportunityForm;
  static atom = ViewSecForOpportunityForm;
}
