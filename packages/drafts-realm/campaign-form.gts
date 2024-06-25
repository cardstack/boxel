import DateField from 'https://cardstack.com/base/date';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  CardDef,
  field,
  contains,
  StringField,
  linksTo,
} from 'https://cardstack.com/base/card-api';

import {
  FieldContainer,
  BoxelSelect,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { parse, format, isBefore, isAfter } from 'date-fns';

const dateFormat = `yyyy-MM-dd`;

const nearestDecimal = (num: number, decimalPlaces: number) => {
  // https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
  const factorOfTen = Math.pow(10, decimalPlaces);
  return Math.round(num * factorOfTen + Number.EPSILON) / factorOfTen;
};

const formatCurrency = (
  num: number | string | null | undefined,
  locale: string = 'en-MY',
  currency: string = 'MYR',
) => {
  if (num === null || num === undefined) {
    return '';
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0, // No decimal places
    maximumFractionDigits: 0, // No decimal places
  });

  let currentNumber = num;
  if (typeof num === 'string') {
    currentNumber = parseFloat(num);
  }

  const formatNumber = Math.round(currentNumber as number);

  return formatter.format(formatNumber);
};

const formatNumberWithSeparator = (
  num: number | string | null | undefined,
  isPercentage = false,
) => {
  if (num === null || num === undefined) {
    return '';
  }

  let currentNumber = num;
  if (typeof num === 'string') {
    currentNumber = parseFloat(num);
  }

  return `${currentNumber.toLocaleString('en-US')}${isPercentage ? ' %' : ''}`;
};

class Isolated extends Component<typeof CampaignForm> {
  get numberSent() {
    let { model } = this.args;
    const nearestRoundNumber = Math.round(model.number_sent || 0);
    const formatNumber = nearestRoundNumber;
    return formatNumberWithSeparator(formatNumber);
  }

  get expectedResponsePercentage() {
    let { model } = this.args;
    const formatNumber = nearestDecimal(
      model.expected_response_percentage || 0,
      2,
    );
    return formatNumberWithSeparator(formatNumber, true);
  }

  <template>
    <div class='campaign-form-isolated'>
      <FieldContainer @label='Name' class='field'>
        {{@model.name}}
      </FieldContainer>
      <FieldContainer @label='Status' class='field'>
        {{@model.status}}
      </FieldContainer>
      <FieldContainer @label='Active' class='field'>
        {{if @model.active 'Yes' 'No'}}
      </FieldContainer>
      <FieldContainer @label='Type' class='field'>
        {{@model.type}}
      </FieldContainer>
      <FieldContainer @label='Parent Campaign' class='field'>
        <@fields.parent_campaign />
      </FieldContainer>
      <FieldContainer @label='Description' class='field'>
        {{@model.description}}
      </FieldContainer>
      <FieldContainer @label='Start Date' class='field'>
        <@fields.start_date />
      </FieldContainer>
      <FieldContainer @label='End Date' class='field'>
        <@fields.end_date />
      </FieldContainer>
      <FieldContainer @label='Num Sent in Campaign' class='field'>
        {{this.numberSent}}
      </FieldContainer>
      <FieldContainer @label='Expected Response (%)' class='field'>
        {{this.expectedResponsePercentage}}
      </FieldContainer>
      <FieldContainer @label='Expected Revenue in Campaign' class='field'>
        {{formatCurrency @model.expected_revenue}}
      </FieldContainer>
      <FieldContainer @label='Budgeted Cost in Campaign' class='field'>
        {{formatCurrency @model.budgeted_cost}}
      </FieldContainer>
      <FieldContainer @label='Actual Cost in Campaign' class='field'>
        {{formatCurrency @model.actual_cost}}
      </FieldContainer>
    </div>
    <style>
      .campaign-form-isolated {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class Embedded extends Component<typeof CampaignForm> {
  <template>
    {{@model.name}}
  </template>
}

class Edit extends Component<typeof CampaignForm> {
  get selectedStatus() {
    return {
      name: this.args.model.status,
    };
  }

  get selectedType() {
    return {
      name: this.args.model.type,
    };
  }

  get selectedActive() {
    return this.args.model.active;
  }

  get selectedStartDate() {
    return this.args.model.start_date
      ? format(this.args.model.start_date, dateFormat)
      : null;
  }

  get selectedEndDate() {
    return this.args.model.end_date
      ? format(this.args.model.end_date, dateFormat)
      : null;
  }

  @action updateName(inputText: string) {
    this.args.model.name = inputText;
  }

  @action updateStatus(type: { name: string }) {
    this.args.model.status = type.name;
  }

  @action updateActive() {
    this.args.model.active = !this.args.model.active;
  }

  @action updateType(type: { name: string }) {
    this.args.model.type = type.name;
  }

  @action updateDescription(inputText: string) {
    this.args.model.description = inputText;
  }

  @action updateStartDate(date: Date) {
    // If the end date is set and the new start date is after the end date, update the end date
    if (this.args.model.end_date && isAfter(date, this.args.model.end_date)) {
      this.args.model.end_date = date;
    }
    this.args.model.start_date = date;
  }

  @action updateEndDate(date: Date) {
    // If the start date is set and the new end date is before the start date, update the start date
    if (
      this.args.model.start_date &&
      isBefore(date, this.args.model.start_date)
    ) {
      this.args.model.start_date = date;
    }
    this.args.model.end_date = date;
  }

  @action parseDateInput(field: string, date: string) {
    const newDate = parse(date, dateFormat, new Date());
    if (field === 'start_date') {
      return this.updateStartDate(newDate);
    }
    return this.updateEndDate(newDate);
  }

  private campaignStatuses = [
    { name: 'None' },
    { name: 'Planned' },
    { name: 'In Progress' },
    { name: 'Completed' },
    { name: 'Aborted' },
  ];

  private campaignTypes = [
    { name: 'None' },
    { name: 'Advertisement' },
    { name: 'Email' },
    { name: 'Telemarketing' },
    { name: 'Banner Ads' },
    { name: 'Seminar/Conference' },
    { name: 'Public Relations' },
    { name: 'Partners' },
    { name: 'Referral Program' },
    { name: 'Other' },
  ];

  <template>
    <div class='campaign-form-edit'>
      <FieldContainer
        @label='Campaign Name'
        data-test-field='name'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @value={{this.args.model.name}}
          @onInput={{this.updateName}}
          maxlength='255'
        />
      </FieldContainer>
      <FieldContainer @label='Status' data-test-field='status' class='field'>
        <BoxelSelect
          @placeholder={{'Select Status'}}
          @selected={{this.selectedStatus}}
          @onChange={{this.updateStatus}}
          @options={{this.campaignStatuses}}
          @dropdownClass='boxel-select-campaign-status'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>
      <FieldContainer @label='Active' data-test-field='active' class='field'>
        <BoxelInput
          @type='checkbox'
          checked={{this.selectedActive}}
          {{on 'click' this.updateActive}}
          class='boxel-input-campaign-active'
        />
      </FieldContainer>
      <FieldContainer @label='Type' data-test-field='type' class='field'>
        <BoxelSelect
          @placeholder={{'Select Type'}}
          @selected={{this.selectedType}}
          @onChange={{this.updateType}}
          @options={{this.campaignTypes}}
          @dropdownClass='boxel-select-campaign-type'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>
      <FieldContainer
        @label='Parent Campaign'
        data-test-field='parent_campaign'
        @tag='label'
        class='field'
      >
        <@fields.parent_campaign />
      </FieldContainer>
      <FieldContainer
        @label='Description'
        data-test-field='description'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @type='textarea'
          @value={{this.args.model.description}}
          @onInput={{this.updateDescription}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Start Date'
        data-test-field='start_date'
        @tag='label'
        class='field'
      >
        <BoxelInput
          type='date'
          @value={{this.selectedStartDate}}
          @onInput={{fn this.parseDateInput 'start_date'}}
          @max='9999-12-31'
        />
      </FieldContainer>
      <FieldContainer
        @label='End Date'
        data-test-field='end_date'
        @tag='label'
        class='field'
      >
        <BoxelInput
          type='date'
          @value={{this.selectedEndDate}}
          @onInput={{fn this.parseDateInput 'end_date'}}
          @max='9999-12-31'
        />
      </FieldContainer>
      <FieldContainer
        @label='Num Sent in Campaign'
        data-test-field='number_sent'
        @tag='label'
        class='field'
      >
        <@fields.number_sent />
      </FieldContainer>
      <FieldContainer
        @label='Expected Response (%)'
        data-test-field='expected_response_percentage'
        @tag='label'
        class='field'
      >
        <@fields.expected_response_percentage />
      </FieldContainer>
      <FieldContainer
        @label='Expected Revenue in Campaign (RM)'
        data-test-field='expected_revenue'
        @tag='label'
        class='field'
      >
        <@fields.expected_revenue />
      </FieldContainer>
      <FieldContainer
        @label='Budgeted Cost in Campaign (RM)'
        data-test-field='budgeted_cost'
        @tag='label'
        class='field'
      >
        <@fields.budgeted_cost />
      </FieldContainer>
      <FieldContainer
        @label='Actual Cost in Campaign (RM)'
        data-test-field='actual_cost'
        @tag='label'
        class='field'
      >
        <@fields.actual_cost />
      </FieldContainer>
    </div>
    <style>
      .campaign-form-edit {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }

      .boxel-input-campaign-active {
        grid-column: unset;
      }
    </style>
  </template>
}

export class CampaignForm extends CardDef {
  @field name = contains(StringField, {
    description: 'The campaign name',
  });
  @field status = contains(StringField, {
    description: 'The campaign current status',
  });
  @field active = contains(BooleanField, {
    description: 'Tells whether the campaign is active or not',
  });
  @field type = contains(StringField, {
    description: 'The type of campaign',
  });
  @field parent_campaign = linksTo(() => CampaignForm, {
    description: 'The parent campaign',
  });
  @field description = contains(StringField, {
    description: 'The campaign description',
  });
  @field start_date = contains(DateField, {
    description: 'The campaign start date',
  });
  @field end_date = contains(DateField, {
    description: 'The campaign end date',
  });
  @field number_sent = contains(NumberField, {
    description: 'The number of forms sent in the campaign',
  });
  @field expected_response_percentage = contains(NumberField, {
    description: 'The expected response by percentage (%) in the campaign',
  });
  @field expected_revenue = contains(NumberField, {
    description: 'The expected revenue by RM in the campaign',
  });
  @field budgeted_cost = contains(NumberField, {
    description: 'The budgeted cost by RM in the campaign',
  });
  @field actual_cost = contains(NumberField, {
    description: 'The actual cost by RM in the campaign',
  });

  static displayName = 'CampaignForm';

  static isolated = Isolated;
  static embedded = Embedded;
  static atom = Embedded;
  static edit = Edit;
}
