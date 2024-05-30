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
  BoxelSelect,
  CardContainer,
  FieldContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { CrmAccount } from './crm/account';
import NumberField from '../base/number';

interface CategorySignature {
  name: string;
}

/* Stage */
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
    <div class='subject'>{{this.args.model.stage}}</div>

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
    name: this.args.model.account || 'Select',
  };

  @tracked accountPlaceholder = this.args.model.account || 'Select';

  get getAccountsNames() {
    let allAccounts = this.args.model.accounts || [];
    return allAccounts.map((o) => ({ name: o.accountName }));
  }

  @action updateAccount(type: { name: string }) {
    this.selectedAccount = type;
    this.args.model.account = type.name;
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
      {{this.args.model.account}}
    </CardContainer>

    <style>
      .card-container {
        background: transparent;
      }
    </style>
  </template>
}

class AccountField extends FieldDef {
  @field accounts = linksToMany(() => CrmAccount);
  @field account = contains(StringField);

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
    this.args.model.amount = val;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='card-container'>
      <GridContainer class='grid-container'>
        <FieldContainer @tag='label' @vertical={{true}}>
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

        <FieldContainer @tag='label' @vertical={{true}}><@fields.amount
          /></FieldContainer>
      </GridContainer>

      {{!-- <BoxelInputGroup @placeholder='Input with a select menu'>
        <:before as |Accessories|>
          <Accessories.Select
            @placeholder={{this.currencyPlaceHolder}}
            @selected={{this.selectedCurrency}}
            @onChange={{this.updateCurrency}}
            @options={{this.currencyOptions}}
            @dropdownClass='boxel-select-usage-dropdown'
            aria-label='Select an item'
            as |item|
          >
            <div>{{item}}</div>
          </Accessories.Select>

        </:before>
      </BoxelInputGroup> --}}
    </CardContainer>

    <style>
      .grid-container {
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: var(--boxel-sp);
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

class AmountField extends FieldDef {
  @field currency = contains(StringField);
  @field amount = contains(NumberField);

  static edit = EditSecForAmountField;
}

/* Opportunity Form */
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
  @field percentage = contains(NumberField, {
    description: `Percentage`,
  });
  @field forecastCategory = contains(ForecastField, {
    description: `Forecast Category`,
  });

  static edit = EditSecForOpportunityForm;
}
