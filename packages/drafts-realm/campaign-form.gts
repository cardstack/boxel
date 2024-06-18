import DateField from 'https://cardstack.com/base/date';
import BooleanField from 'https://cardstack.com/base/boolean';
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
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { parse, format, isBefore, isAfter } from 'date-fns';
import { fn } from '@ember/helper';

const dateFormat = `yyyy-MM-dd`;

const sanitisedNumber = (inputText: string) => {
  const sanitised = inputText
    .replace(/ /g, '')
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/RM/g, '');
  return !isNaN(parseFloat(sanitised)) ? parseFloat(sanitised) : 0;
};

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

  return formatter.format(currentNumber as number);
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
        {{formatNumberWithSeparator @model.number_sent}}
      </FieldContainer>
      <FieldContainer @label='Expected Response (%)' class='field'>
        {{formatNumberWithSeparator @model.expected_response_percentage true}}
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
  @tracked name = this.args.model.name;
  @tracked selectedStatus = { name: this.args.model.status };
  @tracked selectedActive = this.args.model.active;
  @tracked selectedType = { name: this.args.model.type };
  @tracked description = this.args.model.description;
  @tracked startDateString = this.args.model.start_date
    ? format(this.args.model.start_date, dateFormat)
    : null;
  @tracked endDateString = this.args.model.end_date
    ? format(this.args.model.end_date, dateFormat)
    : null;
  @tracked numberSentInputValue = formatNumberWithSeparator(
    this.args.model.number_sent,
  );
  @tracked expectedResponseInputValue = formatNumberWithSeparator(
    this.args.model.expected_response_percentage,
    true,
  );
  @tracked expectedRevenueInputValue = formatCurrency(
    this.args.model.expected_revenue,
  );
  @tracked budgetedCostInputValue = formatCurrency(
    this.args.model.budgeted_cost,
  );
  @tracked actualCostInputValue = formatCurrency(this.args.model.actual_cost);

  @action updateName(inputText: string) {
    this.name = inputText;
    this.args.model.name = inputText;
  }

  @action updateStatus(type: { name: string }) {
    this.selectedStatus = type;
    this.args.model.status = type.name;
  }

  @action updateActive() {
    this.args.model.active = !this.args.model.active;
  }

  @action updateType(type: { name: string }) {
    this.selectedType = type;
    this.args.model.type = type.name;
  }

  @action updateDescription(inputText: string) {
    this.description = inputText;
    this.args.model.description = inputText;
  }

  @action updateStartDate(date: Date) {
    // If the end date is set and the new start date is after the end date, update the end date
    if (this.args.model.end_date && isAfter(date, this.args.model.end_date)) {
      this.args.model.end_date = date;
      this.endDateString = format(date, dateFormat);
    }
    this.args.model.start_date = date;
    this.startDateString = format(date, dateFormat);
  }

  @action updateEndDate(date: Date) {
    // If the start date is set and the new end date is before the start date, update the start date
    if (
      this.args.model.start_date &&
      isBefore(date, this.args.model.start_date)
    ) {
      this.args.model.start_date = date;
      this.startDateString = format(date, dateFormat);
    }
    this.args.model.end_date = date;
    this.endDateString = format(date, dateFormat);
  }

  @action parseDateInput(field: string, date: string) {
    if (field === 'start_date') {
      return this.updateStartDate(parse(date, dateFormat, new Date()));
    }
    return this.updateEndDate(parse(date, dateFormat, new Date()));
  }

  validateOnKeyPress = (event: KeyboardEvent) => {
    const eventKey = event.key;
    // Allow only numeric characters (0-9) and decimal point (.)
    if (
      !/^\d+$/.test(eventKey) &&
      eventKey !== '.' &&
      eventKey !== 'Backspace' &&
      eventKey !== 'Delete' &&
      eventKey !== 'ArrowLeft' &&
      eventKey !== 'ArrowRight' &&
      eventKey !== 'ArrowUp' &&
      eventKey !== 'ArrowDown' &&
      eventKey !== 'Tab'
    ) {
      event.preventDefault();
    }
  };

  @action updateCustomNumberInput(
    fieldName:
      | 'numberSentInputValue'
      | 'expectedResponseInputValue'
      | 'expectedRevenueInputValue'
      | 'budgetedCostInputValue'
      | 'actualCostInputValue',
    inputText: string,
  ) {
    this[fieldName] = inputText;
  }

  @action onBlurNumberSent() {
    const currentNumber = sanitisedNumber(this.numberSentInputValue);
    const nearestRoundNumber = Math.round(currentNumber);

    const formatNumber = nearestRoundNumber;
    this.numberSentInputValue = formatNumberWithSeparator(formatNumber);
    this.args.model.number_sent = formatNumber.toString();
  }

  @action onBlurExpectedResponse() {
    const currentNumber = sanitisedNumber(this.expectedResponseInputValue);
    const formatNumber = nearestDecimal(currentNumber, 2);
    this.expectedResponseInputValue = formatNumberWithSeparator(
      formatNumber,
      true,
    );
    this.args.model.expected_response_percentage = formatNumber.toString();
  }

  @action onBlurCurrencyField(
    inputText: string,
    inputValueName:
      | 'expectedRevenueInputValue'
      | 'budgetedCostInputValue'
      | 'actualCostInputValue',
    fieldName: 'expected_revenue' | 'budgeted_cost' | 'actual_cost',
  ) {
    const currentNumber = sanitisedNumber(inputText);
    const formatNumber = Math.round(currentNumber);
    const numberWithCurrency = formatCurrency(formatNumber);
    this[inputValueName] = numberWithCurrency;
    this.args.model[fieldName] = formatNumber.toString();
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
          @value={{this.name}}
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
          @onFocus={{this.updateActive}}
          checked={{this.selectedActive}}
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
          @value={{this.description}}
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
          @value={{this.startDateString}}
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
          @value={{this.endDateString}}
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
        <BoxelInput
          @value={{this.numberSentInputValue}}
          @onKeyPress={{this.validateOnKeyPress}}
          @onInput={{fn this.updateCustomNumberInput 'numberSentInputValue'}}
          @onBlur={{this.onBlurNumberSent}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Expected Response (%)'
        data-test-field='expected_response_percentage'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @value={{this.expectedResponseInputValue}}
          @onKeyPress={{this.validateOnKeyPress}}
          @onInput={{fn
            this.updateCustomNumberInput
            'expectedResponseInputValue'
          }}
          @onBlur={{this.onBlurExpectedResponse}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Expected Revenue in Campaign'
        data-test-field='expected_revenue'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @value={{this.expectedRevenueInputValue}}
          @onKeyPress={{this.validateOnKeyPress}}
          @onInput={{fn
            this.updateCustomNumberInput
            'expectedRevenueInputValue'
          }}
          @onBlur={{fn
            this.onBlurCurrencyField
            this.expectedRevenueInputValue
            'expectedRevenueInputValue'
            'expected_revenue'
          }}
        />
      </FieldContainer>
      <FieldContainer
        @label='Budgeted Cost in Campaign'
        data-test-field='budgeted_cost'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @value={{this.budgetedCostInputValue}}
          @onKeyPress={{this.validateOnKeyPress}}
          @onInput={{fn this.updateCustomNumberInput 'budgetedCostInputValue'}}
          @onBlur={{fn
            this.onBlurCurrencyField
            this.budgetedCostInputValue
            'budgetedCostInputValue'
            'budgeted_cost'
          }}
        />
      </FieldContainer>
      <FieldContainer
        @label='Actual Cost in Campaign'
        data-test-field='actual_cost'
        @tag='label'
        class='field'
      >
        <BoxelInput
          @value={{this.actualCostInputValue}}
          @onKeyPress={{this.validateOnKeyPress}}
          @onInput={{fn this.updateCustomNumberInput 'actualCostInputValue'}}
          @onBlur={{fn
            this.onBlurCurrencyField
            this.actualCostInputValue
            'actualCostInputValue'
            'actual_cost'
          }}
        />
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
  @field name = contains(StringField);
  @field status = contains(StringField);
  @field active = contains(BooleanField);
  @field type = contains(StringField);
  @field parent_campaign = linksTo(() => CampaignForm);
  @field description = contains(StringField);
  @field start_date = contains(DateField);
  @field end_date = contains(DateField);
  @field number_sent = contains(StringField);
  @field expected_response_percentage = contains(StringField);
  @field expected_revenue = contains(StringField);
  @field budgeted_cost = contains(StringField);
  @field actual_cost = contains(StringField);

  static displayName = 'CampaignForm';

  static isolated = Isolated;
  static embedded = Embedded;
  static atom = Embedded;
  static edit = Edit;
}
