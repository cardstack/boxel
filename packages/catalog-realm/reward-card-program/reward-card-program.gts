// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { gt } from '@cardstack/boxel-ui/helpers';
import { formatCurrency, formatNumber } from '@cardstack/boxel-ui/helpers';
import { AmountWithCurrency } from '../fields/amount-with-currency';
import { createOptionSelectField } from '../utils/create-option-select';

const BusinessOrPersonalField = createOptionSelectField({
  displayName: 'Business or Personal',
  options: ['personal', 'business', 'both'],
  view: 'boxel-select',
  placeholder: 'Select type',
});

const UnitField = createOptionSelectField({
  displayName: 'Unit',
  options: ['week', 'month', 'quarter', 'half-year', 'year'],
  view: 'boxel-select',
  placeholder: 'Select unit',
});

const TimeScopeField = createOptionSelectField({
  displayName: 'Time Scope',
  options: ['calendar', 'cardmember', 'rolling', 'lifetime'],
  view: 'boxel-select',
  placeholder: 'Select time scope',
});

const ResetBasisField = createOptionSelectField({
  displayName: 'Reset Basis',
  options: ['calendar-year', 'cardmember-year', 'rolling'],
  view: 'boxel-select',
  placeholder: 'Select reset basis',
});

const BonusTypeField = createOptionSelectField({
  displayName: 'Bonus Type',
  options: ['points', 'statement-credit'],
  view: 'boxel-select',
  placeholder: 'Select bonus type',
});

const BonusCurrencyField = createOptionSelectField({
  displayName: 'Bonus Currency',
  options: ['USD', 'Membership Rewards'],
  view: 'boxel-select',
  placeholder: 'Select currency (or type)',
});

const BenefitKindField = createOptionSelectField({
  displayName: 'Benefit Kind',
  options: ['statement-credit', 'travel-credit', 'offer'],
  view: 'boxel-select',
  placeholder: 'Select kind',
});

const StatusLevelField = createOptionSelectField({
  displayName: 'Status Level',
  options: ['Silver', 'Gold', 'Gold Elite', 'Platinum', 'Diamond'],
  view: 'boxel-select',
  placeholder: 'Select status level',
});

export class TimePeriod extends CardDef {
  static displayName = 'Time Period';

  @field unit = contains(UnitField);
  @field count = contains(NumberField);
  @field scope = contains(TimeScopeField);
  @field resetBasis = contains(ResetBasisField);
  @field eligibleBookingNightsMin = contains(NumberField);
  @field maxUsesPerPeriod = contains(NumberField);
  @field minAmount = contains(AmountWithCurrency);
  @field notes = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: TimePeriod) {
      try {
        const parts = [];
        if (this.count && this.unit) {
          parts.push(`${this.count} ${this.unit}`);
        } else if (this.unit) {
          parts.push(this.unit);
        }
        if (this.scope) {
          parts.push(`(${this.scope})`);
        }
        return parts.length > 0 ? parts.join(' ') : 'Time Period';
      } catch (e) {
        return 'Time Period';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='time-period'>
        <div class='period-display'>
          {{#if @model.count}}
            <span class='count'>{{@model.count}}</span>
          {{/if}}
          {{#if @model.unit}}
            <span class='unit'>{{@model.unit}}</span>
          {{/if}}
          {{#if @model.scope}}
            <span class='scope'>({{@model.scope}})</span>
          {{/if}}
        </div>
        {{#if @model.notes}}
          <div class='notes'>{{@model.notes}}</div>
        {{/if}}
      </div>

      <style scoped>
        .time-period {
          padding: var(--spacing, var(--boxel-sp-xs))
            calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          border: 1px solid var(--border, var(--boxel-border-color, #d3d3d3));
          border-radius: var(--radius, var(--boxel-border-radius));
          background: var(--card, var(--boxel-light, #fff));
          color: var(--card-foreground, var(--boxel-dark, #000));
          font-size: 0.875rem;
          font-family: var(--font-serif, serif);
          box-shadow: var(--shadow-sm, var(--boxel-box-shadow));
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        .time-period:hover {
          box-shadow: var(--shadow, var(--boxel-box-shadow-hover));
        }
        .period-display {
          display: flex;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 0.75);
          align-items: baseline;
          letter-spacing: var(--tracking-normal, 0.01em);
        }
        .count {
          font-weight: 600;
          color: var(--primary, var(--boxel-dark));
          font-family: var(--font-sans, system-ui);
        }
        .unit {
          color: var(--foreground, var(--boxel-dark));
          font-style: italic;
        }
        .scope {
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.75rem;
          font-weight: 400;
        }
        .notes {
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 0.75);
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          border-top: 1px solid var(--border, var(--boxel-border-color));
          padding-top: calc(var(--spacing, var(--boxel-sp-xs)) * 0.75);
          font-family: var(--font-serif, serif);
        }
      </style>
    </template>
  };
}

export class SignupBonus extends CardDef {
  static displayName = 'Signup Bonus';

  @field bonusType = contains(BonusTypeField);
  @field pointsAmount = contains(NumberField);
  @field bonusCurrency = contains(BonusCurrencyField);
  @field spendRequirement = contains(AmountWithCurrency);
  @field spendWindowDays = contains(NumberField);
  @field description = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: SignupBonus) {
      try {
        if (this.pointsAmount && this.bonusCurrency) {
          return `${this.pointsAmount.toLocaleString()} ${this.bonusCurrency}`;
        }
        return this.bonusCurrency
          ? `${this.bonusCurrency} Bonus`
          : 'Welcome Bonus';
      } catch (e) {
        return 'Welcome Bonus';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='signup-bonus'>
        <div class='bonus-header'>
          <div class='bonus-amount'>
            {{#if @model.pointsAmount}}
              <span class='points'>{{formatNumber
                  @model.pointsAmount
                  size='short'
                }}</span>
              <span class='currency'>{{@model.bonusCurrency}}</span>
            {{else}}
              <span class='points'>{{@model.bonusCurrency}}</span>
            {{/if}}
          </div>
          {{#if @model.spendRequirement.amount}}
            <div class='requirement'>
              <span class='spend-label'>Spend:</span>
              <span class='spend-amount'>{{formatCurrency
                  @model.spendRequirement.amount
                  currency=(if
                    @model.spendRequirement.currency.code
                    @model.spendRequirement.currency.code
                    'USD'
                  )
                  size='short'
                }}</span>
              {{#if @model.spendWindowDays}}
                <span class='window'>in {{@model.spendWindowDays}} days</span>
              {{/if}}
            </div>
          {{/if}}
        </div>
        {{#if @model.description}}
          <div class='description'>{{@model.description}}</div>
        {{/if}}
      </div>

      <style scoped>
        .signup-bonus {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          border: 2px solid var(--primary, var(--boxel-dark));
          border-radius: var(--radius, var(--boxel-border-radius));
          background: linear-gradient(
            135deg,
            var(--card, var(--boxel-light)) 0%,
            var(--secondary, var(--boxel-light-200)) 100%
          );
          color: var(--card-foreground, var(--boxel-dark));
          font-size: 0.875rem;
          font-family: var(--font-serif, serif);
          box-shadow: var(--shadow-lg, var(--boxel-deep-box-shadow));
          position: relative;
          overflow: hidden;
        }
        .signup-bonus::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(
            90deg,
            var(--primary, var(--boxel-dark)) 0%,
            var(--accent, var(--boxel-highlight)) 100%
          );
        }
        .bonus-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }
        .bonus-amount {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 0.5);
        }
        .points {
          font-size: 1.75rem;
          font-weight: 400;
          color: var(--primary, var(--boxel-dark));
          font-family: var(--font-serif, serif);
          letter-spacing: var(--tracking-normal, 0.01em);
        }
        .currency {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--primary, var(--boxel-dark));
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans, system-ui);
        }
        .requirement {
          text-align: right;
          font-size: 0.8125rem;
          font-family: var(--font-sans, system-ui);
        }
        .spend-label {
          color: var(--muted-foreground, var(--boxel-450));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .spend-amount {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          display: block;
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 0.25);
        }
        .window {
          display: block;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 0.25);
        }
        .description {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          border-top: 1px solid var(--border, var(--boxel-border-color));
          padding-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-style: italic;
          line-height: 1.5;
          font-family: var(--font-serif, serif);
        }
      </style>
    </template>
  };
}

export class Benefit extends CardDef {
  static displayName = 'Benefit';

  @field name = contains(StringField);
  @field partner = contains(StringField);
  @field benefitKind = contains(BenefitKindField);
  @field amount = contains(AmountWithCurrency);
  @field timePeriod = linksTo(TimePeriod);
  @field enrollmentRequired = contains(BooleanField);
  @field minSpend = contains(AmountWithCurrency);
  @field programURL = contains(UrlField);
  @field conditions = contains(MarkdownField);
  @field details = containsMany(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Benefit) {
      try {
        return this.name ?? 'Benefit';
      } catch (e) {
        return 'Benefit';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='benefit'>
        <div class='benefit-header'>
          <div class='benefit-title'>
            <h3 class='benefit-name'>{{if
                @model.name
                @model.name
                'Benefit'
              }}</h3>
            {{#if @model.enrollmentRequired}}
              <div class='enrollment-badge'>enrollment required</div>
            {{/if}}
          </div>
          {{#if @model.amount.amount}}
            <div class='benefit-value'>
              <div class='amount'>{{formatCurrency
                  @model.amount.amount
                  currency=(if
                    @model.amount.currency.code
                    @model.amount.currency.code
                    'USD'
                  )
                  size='short'
                }}</div>
              {{#if @model.timePeriod}}
                <div class='period'>per
                  <@fields.timePeriod @format='atom' /></div>
              {{/if}}
            </div>
          {{/if}}
        </div>

        {{#if @model.partner}}
          <div class='partner'>{{@model.partner}}</div>
        {{/if}}

        {{#if @model.minSpend.amount}}
          <div class='spend-requirement'>
            <span class='spend-label'>Minimum spend:</span>
            <span class='spend-amount'>{{formatCurrency
                @model.minSpend.amount
                currency=(if
                  @model.minSpend.currency.code
                  @model.minSpend.currency.code
                  'USD'
                )
                size='short'
              }}</span>
          </div>
        {{/if}}

        {{#if @model.conditions}}
          <div class='conditions'>{{@model.conditions}}</div>
        {{/if}}

        {{#if (gt @model.details.length 0)}}
          <div class='details-section'>
            <div class='details-label'>Details:</div>
            <ul class='details'>
              {{#each @model.details as |detail|}}
                <li>{{detail}}</li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .benefit {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 4);
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-border-radius));
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-size: 0.875rem;
          font-family: var(--font-serif, serif);
          box-shadow: var(--shadow, var(--boxel-box-shadow));
          transition: all 0.3s ease;
          position: relative;
        }
        .benefit:hover {
          box-shadow: var(--shadow-md, var(--boxel-box-shadow-hover));
          transform: translateY(-1px);
        }
        .benefit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 4);
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
        }
        .benefit-title {
          flex: 1;
        }
        .benefit-name {
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
          font-size: 1.125rem;
          letter-spacing: var(--tracking-normal, 0.01em);
          margin: 0 0 calc(var(--spacing, var(--boxel-sp-xs)) * 2) 0;
          line-height: 1.3;
        }
        .enrollment-badge {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 1)
            calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          background: oklch(0.52 0.08 25);
          color: var(--background, var(--boxel-light));
          border-radius: calc(var(--radius, var(--boxel-border-radius)) * 0.5);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans, system-ui);
          border: 1px solid oklch(0.45 0.1 25);
          display: inline-block;
        }
        .benefit-value {
          text-align: right;
          font-family: var(--font-sans, system-ui);
          flex-shrink: 0;
        }
        .amount {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--primary, var(--boxel-dark));
          letter-spacing: var(--tracking-normal, 0.01em);
          display: block;
          line-height: 1.1;
        }
        .period {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 1);
          font-style: italic;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        .partner {
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-size: 0.8125rem;
          border-left: 3px solid var(--primary, var(--boxel-dark));
          padding-left: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-weight: 500;
        }
        .spend-requirement {
          background: var(--muted, var(--boxel-light-200));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: calc(var(--radius, var(--boxel-border-radius)) * 0.5);
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: var(--font-sans, system-ui);
        }
        .spend-label {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .spend-amount {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .conditions {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          border-top: 1px solid var(--border, var(--boxel-border-color));
          padding-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          line-height: 1.6;
          font-style: italic;
          font-family: var(--font-serif, serif);
        }
        .details-section {
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
        }
        .details-label {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 1.5);
          font-size: 0.875rem;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-family: var(--font-sans, system-ui);
        }
        .details {
          list-style: none;
          padding: 0;
          margin: 0;
          background: var(--muted, var(--boxel-light-200));
          border-radius: calc(var(--radius, var(--boxel-border-radius)) * 0.5);
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }
        .details li {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 1) 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          position: relative;
          padding-left: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          line-height: 1.5;
          font-family: var(--font-serif, serif);
        }
        .details li:not(:last-child) {
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
          padding-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 1.5);
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 1);
        }
        .details li::before {
          content: '✓';
          color: var(--primary, var(--boxel-dark));
          position: absolute;
          left: 0;
          font-weight: bold;
          font-size: 0.75rem;
        }
      </style>
    </template>
  };
}

export class MembershipBenefit extends CardDef {
  static displayName = 'Membership Benefit';

  @field membershipProgram = contains(StringField);
  @field statusLevel = contains(StatusLevelField);
  @field autoEnrollment = contains(BooleanField);
  @field enrollmentInstructions = contains(MarkdownField);
  @field benefitsList = containsMany(StringField);
  @field partner = contains(StringField);
  @field enrollmentRequired = contains(BooleanField);
  @field conditions = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: MembershipBenefit) {
      try {
        const parts = [];
        if (this.membershipProgram) parts.push(this.membershipProgram);
        if (this.statusLevel) parts.push(this.statusLevel);
        return parts.length > 0 ? parts.join(' ') : 'Membership Benefit';
      } catch (e) {
        return 'Membership Benefit';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='membership-benefit'>
        <div class='membership-header'>
          <div class='membership-name'>
            <strong>{{if
                @model.membershipProgram
                @model.membershipProgram
                'Membership Program'
              }}</strong>
            {{#if @model.statusLevel}}
              <span class='status-badge'>{{@model.statusLevel}} Status</span>
            {{/if}}
          </div>
          <div class='enrollment-status'>
            {{#if @model.autoEnrollment}}
              <span class='auto-badge'>Auto-enrolled</span>
            {{else if @model.enrollmentRequired}}
              <span class='manual-badge'>Enrollment required</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.partner}}
          <div class='partner'>{{@model.partner}}</div>
        {{/if}}

        {{#if (gt @model.benefitsList.length 0)}}
          <div class='benefits-list'>
            <div class='benefits-label'>Key Benefits:</div>
            <ul class='benefits-items'>
              {{#each @model.benefitsList as |benefit|}}
                <li>{{benefit}}</li>
              {{/each}}
            </ul>
          </div>
        {{/if}}

        {{#if @model.enrollmentInstructions}}
          <div
            class='enrollment-instructions'
          >{{@model.enrollmentInstructions}}</div>
        {{/if}}
      </div>

      <style scoped>
        .membership-benefit {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          border: 2px solid var(--accent, var(--boxel-highlight));
          border-radius: var(--radius, var(--boxel-border-radius));
          background: linear-gradient(
            135deg,
            var(--card, var(--boxel-light)) 0%,
            var(--secondary, var(--boxel-light-200)) 100%
          );
          color: var(--card-foreground, var(--boxel-dark));
          font-size: 0.875rem;
          font-family: var(--font-serif, serif);
          box-shadow: var(--shadow-md, var(--boxel-box-shadow));
          position: relative;
          overflow: hidden;
        }
        .membership-benefit::before {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          width: 4px;
          height: 100%;
          background: linear-gradient(
            180deg,
            var(--accent, var(--boxel-highlight)) 0%,
            var(--primary, var(--boxel-dark)) 100%
          );
        }
        .membership-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }
        .membership-name {
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
          font-size: 1rem;
          letter-spacing: var(--tracking-normal, 0.01em);
        }
        .status-badge {
          display: block;
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 0.75)
            calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          background: var(--primary, var(--boxel-dark));
          color: var(--primary-foreground, var(--boxel-light));
          border-radius: calc(var(--radius, var(--boxel-border-radius)) * 0.5);
          font-size: 0.75rem;
          font-weight: 500;
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 1.5);
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-family: var(--font-sans, system-ui);
        }
        .auto-badge {
          display: inline-block;
          background: oklch(0.6 0.15 140);
          color: var(--background, var(--boxel-light));
          border-radius: calc(var(--radius, var(--boxel-border-radius)) * 0.5);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans, system-ui);
          border: 1px solid oklch(0.5 0.18 140);
        }
        .manual-badge {
          display: inline-block;
          background: oklch(0.52 0.08 25);
          color: var(--background, var(--boxel-light));
          border-radius: calc(var(--radius, var(--boxel-border-radius)) * 0.5);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          text-align: right;
          letter-spacing: 0.05em;
          font-family: var(--font-sans, system-ui);
          border: 1px solid oklch(0.45 0.1 25);
        }
        .partner {
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-size: 0.8125rem;
          border-left: 2px solid var(--border, var(--boxel-border-color));
          padding-left: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }
        .benefits-label {
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 1.5);
          font-size: 0.8125rem;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-family: var(--font-sans, system-ui);
        }
        .benefits-items {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .benefits-items li {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 0.75) 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          position: relative;
          padding-left: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          line-height: 1.4;
          font-family: var(--font-serif, serif);
        }
        .benefits-items li::before {
          content: '•';
          color: var(--primary, var(--boxel-dark));
          position: absolute;
          left: 0;
          font-weight: bold;
        }
        .enrollment-instructions {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          border-top: 1px solid var(--border, var(--boxel-border-color));
          padding-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-style: italic;
          line-height: 1.5;
          font-family: var(--font-serif, serif);
        }
      </style>
    </template>
  };
}

export class EarningRule extends CardDef {
  static displayName = 'Earning Rule';

  @field category = contains(StringField);
  @field rateMultiplier = contains(NumberField);
  @field appliesTo = contains(StringField);
  @field capAmount = contains(AmountWithCurrency);
  @field capPeriod = linksTo(TimePeriod);
  @field conditions = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: EarningRule) {
      try {
        const rate = this.rateMultiplier ? `${this.rateMultiplier}X` : '';
        const category = this.category ?? '';
        return rate && category
          ? `${rate} ${category}`
          : category || 'Earning Rule';
      } catch (e) {
        return 'Earning Rule';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='earning-rule'>
        <div class='earning-header'>
          <div class='earning-rate'>
            {{#if @model.rateMultiplier}}
              <span class='multiplier'>{{@model.rateMultiplier}}X</span>
              <span class='points-label'>points</span>
            {{/if}}
          </div>
          {{#if @model.capAmount.amount}}
            <div class='cap-info'>
              <span class='cap-label'>Cap:</span>
              <span class='cap-amount'>{{formatCurrency
                  @model.capAmount.amount
                  currency=(if
                    @model.capAmount.currency.code
                    @model.capAmount.currency.code
                    'USD'
                  )
                  size='short'
                }}</span>
              {{#if @model.capPeriod}}
                <span class='cap-period'>per
                  <@fields.capPeriod @format='atom' /></span>
              {{/if}}
            </div>
          {{/if}}
        </div>

        {{#if @model.category}}
          <div class='category'>{{@model.category}}</div>
        {{/if}}

        {{#if @model.appliesTo}}
          <div class='applies-to'>{{@model.appliesTo}}</div>
        {{/if}}

        {{#if @model.conditions}}
          <div class='conditions'>{{@model.conditions}}</div>
        {{/if}}
      </div>

      <style scoped>
        .earning-rule {
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          border: 2px solid var(--primary, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-border-radius));
          background: linear-gradient(
            135deg,
            var(--card, var(--boxel-light)) 0%,
            var(--secondary, var(--boxel-light-200)) 100%
          );
          color: var(--card-foreground, var(--boxel-dark));
          font-size: 0.875rem;
          font-family: var(--font-serif, serif);
          box-shadow: var(--shadow-md, var(--boxel-box-shadow));
          position: relative;
          overflow: hidden;
        }
        .earning-rule::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: linear-gradient(
            90deg,
            var(--primary, var(--boxel-dark)) 0%,
            var(--accent, var(--boxel-highlight)) 100%
          );
        }
        .earning-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 3);
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }
        .earning-rate {
          display: flex;
          align-items: baseline;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 1.5);
        }
        .multiplier {
          font-size: 1.75rem;
          font-weight: 400;
          color: var(--primary, var(--boxel-dark));
          font-family: var(--font-serif, serif);
          letter-spacing: var(--tracking-normal, 0.01em);
        }
        .points-label {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          text-transform: lowercase;
        }
        .cap-info {
          text-align: right;
          font-size: 0.8125rem;
          font-family: var(--font-sans, system-ui);
        }
        .cap-label {
          color: oklch(0.55 0.18 25);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          display: block;
        }
        .cap-amount {
          font-weight: 600;
          color: oklch(0.55 0.18 25);
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 0.5);
          display: block;
        }
        .cap-period {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 0.5);
        }
        .category {
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 1.5);
          font-size: 1rem;
          letter-spacing: var(--tracking-normal, 0.01em);
        }
        .applies-to {
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-size: 0.8125rem;
          border-left: 2px solid var(--border, var(--boxel-border-color));
          padding-left: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          line-height: 1.4;
        }
        .conditions {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          border-top: 1px solid var(--border, var(--boxel-border-color));
          padding-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          font-style: italic;
          line-height: 1.5;
          font-family: var(--font-serif, serif);
        }
      </style>
    </template>
  };
}

export class RewardCardProgram extends CardDef {
  static displayName = 'Reward Card Program';

  @field cardName = contains(StringField);
  @field issuer = contains(StringField);
  @field network = contains(StringField);
  @field businessOrPersonal = contains(BusinessOrPersonalField);

  @field annualFee = contains(AmountWithCurrency);

  @field programStartDate = contains(DateField);
  @field programEndDate = contains(DateField);

  @field signupBonus = linksTo(SignupBonus);

  @field statementBenefits = linksToMany(Benefit);
  @field membershipBenefits = linksToMany(MembershipBenefit);
  @field earningRules = linksToMany(EarningRule);

  @field notes = contains(MarkdownField);
  @field networkLogoUrl = contains(UrlField);

  @field title = contains(StringField, {
    computeVia: function (this: RewardCardProgram) {
      try {
        return this.cardName ?? 'Unnamed Card Program';
      } catch (e) {
        return 'Unnamed Card Program';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    private annualizationFactor(benefit: Benefit): number {
      try {
        const period = benefit?.timePeriod;
        if (!period) return 1;

        const unit = period.unit?.toLowerCase?.();
        const count = Number(period.count ?? 1) || 1;

        const perYear =
          unit === 'week'
            ? 52
            : unit === 'month'
            ? 12
            : unit === 'quarter'
            ? 4
            : unit === 'half-year'
            ? 2
            : unit === 'year'
            ? 1
            : 1;

        return perYear / count;
      } catch (_e) {
        return 1;
      }
    }

    get totalAnnualValue() {
      try {
        const benefits = this.args.model?.statementBenefits ?? [];
        return benefits.reduce((total, benefit) => {
          const base = Number(benefit.amount?.amount || 0);
          const period = benefit?.timePeriod;
          const usesPerPeriod = Number(period?.maxUsesPerPeriod ?? 1) || 1;
          const factor = this.annualizationFactor(benefit);
          return total + base * usesPerPeriod * factor;
        }, 0);
      } catch (e) {
        console.error(
          'RewardCardProgram: Error calculating total annual value',
          e,
        );
        return 0;
      }
    }

    get valueToFeeRatio() {
      try {
        const fee = this.args.model?.annualFee?.amount ?? 0;
        const value = this.totalAnnualValue;
        return fee > 0 ? Math.round((value / fee) * 100) / 100 : 0;
      } catch (e) {
        return 0;
      }
    }

    get cardTypeLabel() {
      const type = this.args.model?.businessOrPersonal;
      return type === 'business'
        ? 'Business Card'
        : type === 'personal'
        ? 'Personal Card'
        : 'Credit Card';
    }

    get primaryEarningRate() {
      try {
        const rules = this.args.model?.earningRules ?? [];
        const maxRate = Math.max(
          ...rules.map((rule) => rule.rateMultiplier || 1),
        );
        return maxRate > 1 ? maxRate : null;
      } catch (e) {
        return null;
      }
    }

    get displayCurrency() {
      try {
        return this.args.model?.annualFee?.currency?.code ?? 'USD';
      } catch (e) {
        return 'USD';
      }
    }

    <template>
      <div class='platinum-stage'>
        <div class='command-center'>
          
          <header class='executive-header'>
            {{#if @model.networkLogoUrl}}
              <div class='top-network-logo'>
                <img
                  src='{{@model.networkLogoUrl}}'
                  alt=''
                  aria-hidden='true'
                  class='top-network-image'
                />
              </div>
            {{/if}}

            <div class='brand-signature'>
              <div class='card-identity'>
                <h1 class='card-title'>{{if
                    @model.cardName
                    @model.cardName
                    'Premium Card Program'
                  }}</h1>
                <div class='issuer-network'>
                  {{#if @model.issuer}}
                    <span class='issuer-badge'>{{@model.issuer}}</span>
                  {{/if}}
                  {{#if @model.network}}
                    <span class='network-badge'>{{@model.network}}</span>
                  {{/if}}
                  <span class='type-badge'>{{this.cardTypeLabel}}</span>
                </div>
              </div>

              {{#if @model.annualFee.amount}}
                <div class='fee-structure'>
                  <div class='annual-fee'>
                    <span class='fee-label'>Annual Fee</span>
                    <span class='fee-amount'>{{formatCurrency
                        @model.annualFee.amount
                        currency=this.displayCurrency
                        size='short'
                      }}</span>
                  </div>
                  {{#if (gt this.totalAnnualValue 0)}}
                    <div class='value-proposition'>
                      <span class='value-label'>Annual Value</span>
                      <span class='value-amount'>{{formatCurrency
                          this.totalAnnualValue
                          currency=this.displayCurrency
                          size='short'
                        }}</span>
                      <span class='value-ratio'>{{this.valueToFeeRatio}}× return</span>
                    </div>
                  {{/if}}
                </div>
              {{/if}}
            </div>

            {{#if @model.thumbnailURL}}
              <div class='card-showcase'>
                <div class='card-frame'>
                  <img
                    src='{{@model.thumbnailURL}}'
                    alt='{{@model.cardName}} Physical Card'
                    class='card-image'
                  />
                </div>
              </div>
            {{/if}}

            <div class='metrics-panel'>
              {{#if @fields.signupBonus}}
                <div class='welcome-metric'>
                  <div class='metric-value'>
                    {{#if @model.signupBonus.pointsAmount}}
                      {{formatNumber
                        @model.signupBonus.pointsAmount
                        size='short'
                      }}
                    {{else}}
                      {{@model.signupBonus.bonusCurrency}}
                    {{/if}}
                  </div>
                  <div class='metric-label'>Welcome Bonus</div>
                </div>
              {{/if}}

              {{#if this.primaryEarningRate}}
                <div class='earning-metric'>
                  <div class='metric-value'>{{this.primaryEarningRate}}×</div>
                  <div class='metric-label'>Max Earning Rate</div>
                </div>
              {{/if}}

              {{#if (gt @model.statementBenefits.length 0)}}
                <div class='benefits-metric'>
                  <div
                    class='metric-value'
                  >{{@model.statementBenefits.length}}</div>
                  <div class='metric-label'>Statement Benefits</div>
                </div>
              {{/if}}
            </div>
          </header>

          <main class='content-grid'>
            
            {{#if @fields.signupBonus}}
              <section class='welcome-section'>
                <h2 class='section-title'>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                    />
                  </svg>
                  Limited-Time Welcome Offer
                </h2>
                <div class='welcome-showcase'>
                  <@fields.signupBonus @format='embedded' />
                </div>
              </section>
            {{/if}}

            {{#if (gt @model.statementBenefits.length 0)}}
              <section class='benefits-section'>
                <h2 class='section-title'>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
                    <line x1='8' y1='21' x2='16' y2='21' />
                    <line x1='12' y1='17' x2='12' y2='21' />
                  </svg>
                  Statement Benefits & Credits
                  <span class='value-indicator'>{{formatCurrency
                      this.totalAnnualValue
                      currency=this.displayCurrency
                      size='short'
                    }}
                    annual value</span>
                </h2>
                <div class='benefits-grid'>
                  <@fields.statementBenefits @format='embedded' />
                </div>
              </section>
            {{/if}}

            {{#if (gt @model.earningRules.length 0)}}
              <section class='earning-section'>
                <h2 class='section-title'>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <line x1='12' y1='1' x2='12' y2='23' />
                    <path
                      d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'
                    />
                  </svg>
                  Points Earning Structure
                </h2>
                <div class='earning-matrix'>
                  <@fields.earningRules @format='embedded' />
                </div>
              </section>
            {{/if}}

            {{#if (gt @model.membershipBenefits.length 0)}}
              <section class='membership-section'>
                <h2 class='section-title'>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'
                    />
                    <rect x='8' y='2' width='8' height='4' rx='1' ry='1' />
                    <path d='M9 14l2 2 4-4' />
                  </svg>
                  Elite Status & Memberships
                </h2>
                <div class='membership-collection'>
                  <@fields.membershipBenefits @format='embedded' />
                </div>
              </section>
            {{/if}}

            {{#if @model.notes}}
              <section class='intelligence-section'>
                <h2 class='section-title'>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
                    <line x1='12' y1='17' x2='12.01' y2='17' />
                  </svg>
                  Program Intelligence
                </h2>
                <div class='intelligence-content'>
                  <@fields.notes />
                </div>
              </section>
            {{/if}}

          </main>

        </div>
      </div>

      <style scoped>
        .platinum-stage {
          background: var(--background, oklch(0.99 0 0));
          color: var(--foreground, oklch(0.15 0 0));
          min-height: 100vh;
          width: 100%;
          position: relative;
          overflow-y: auto;
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            system-ui,
            sans-serif;
          font-feature-settings:
            'liga' 1,
            'kern' 1,
            'calt' 1;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          container-type: inline-size;
        }

        .command-center {
          max-width: 84rem;
          margin: 0 auto;
          padding: 4.854rem 3rem;
          min-height: 100vh;
        }

        .executive-header {
          display: flex;
          flex-direction: column;
          gap: 3rem;
          margin-bottom: 4rem;
          padding-bottom: 2rem;
          border-bottom: 1px solid var(--border, oklch(0.2 0 0));
          position: relative;
          align-items: flex-start;
        }
        .top-network-logo {
          align-self: flex-start;
          margin-bottom: 1rem;
          padding: 0.75rem 1.5rem;
          background: var(--background, oklch(0.98 0 0));
          border-radius: var(--radius, var(--boxel-border-radius));
          border: 1px solid var(--border, oklch(0.2 0 0));
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .top-network-image {
          height: 32px;
          width: auto;
          max-width: 200px;
          object-fit: contain;
          display: block;
        }

        .brand-signature {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: flex-start;
          gap: 2rem;
          width: 100%;
        }

        .card-showcase {
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
          margin-bottom: 0;
        }
        .card-frame {
          border-radius: var(--radius);
          overflow: hidden;
          position: relative;
        }
        .card-image {
          width: 460px;
          height: auto;
          object-fit: cover;
          border-radius: calc(var(--radius) * 0.75);
          display: block;
          filter: contrast(1.1) saturate(1.1);
        }

        .card-identity .card-title {
          font-size: 3.5rem;
          font-weight: 300;
          letter-spacing: -0.02em;
          color: var(--primary, oklch(0.78 0 0));
          margin: 0 0 1.618rem 0;
          line-height: 0.95;
          font-family: 'Playfair Display', serif;
        }

        .issuer-network {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .issuer-badge,
        .network-badge,
        .type-badge {
          padding: 0.618rem 1.236rem;
          border-radius: 0;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-family: 'Inter', sans-serif;
          border: 1px solid var(--primary, var(--boxel-border-color));
        }

        .issuer-badge {
          background: var(--gold-accent, oklch(0.75 0.15 65));
          color: var(--foreground, oklch(0.08 0 0));
        }

        .network-badge {
          background: var(--secondary, oklch(0.15 0 0));
          color: var(--secondary-foreground, oklch(0.95 0 0));
          border: 1px solid var(--primary, var(--boxel-border-color));
        }

        .type-badge {
          background: var(--muted, oklch(0.25 0 0));
          color: var(--muted-foreground, oklch(0.7 0 0));
        }
        .fee-structure {
          display: flex;
          gap: 2rem;
          align-items: flex-end;
        }

        .annual-fee,
        .value-proposition {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .fee-label,
        .value-label {
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.7 0 0));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: var(--tracking-wider, 0.05em);
        }

        .fee-amount {
          font-size: 1.5rem;
          font-weight: 300;
          color: var(--primary, oklch(0.78 0 0));
          font-family: 'Inter', sans-serif;
        }

        .value-amount {
          font-size: 1.5rem;
          font-weight: 300;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-family: 'Inter', sans-serif;
        }

        .value-ratio {
          font-size: 0.875rem;
          color: var(--value-positive, oklch(0.7 0.15 140));
          font-weight: 600;
        }

        .metrics-panel {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          width: 50%;
          gap: 1.5rem;
        }

        .welcome-metric,
        .earning-metric,
        .benefits-metric {
          text-align: right;
          padding: 1rem 1.5rem;
          background: var(--background, oklch(0.98 0 0));
          border-radius: var(--radius, 0.375rem);
          border: 1px solid var(--primary, var(--boxel-border-color));
          backdrop-filter: blur(8px);
          min-width: 8rem;
        }

        .metric-value {
          font-size: 1.75rem;
          font-weight: 300;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          line-height: 1;
          margin-bottom: 0.25rem;
          font-family: 'Inter', sans-serif;
        }

        .metric-label {
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.7 0 0));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: var(--tracking-wider, 0.05em);
        }

        .content-grid {
          display: flex;
          flex-direction: column;
          gap: 6.472rem;
        }

        .welcome-section,
        .benefits-section,
        .earning-section,
        .membership-section,
        .intelligence-section {
          background: var(--background, oklch(0.98 0 0));
          border-radius: 0;
          padding: 4.045rem 3rem;
          border: none;
          border-top: 3px solid var(--gold-accent, oklch(0.75 0.15 65));
          position: relative;
          overflow: hidden;
        }

        .welcome-section::before,
        .benefits-section::before,
        .earning-section::before,
        .membership-section::before,
        .intelligence-section::before {
          content: '';
          position: absolute;
          top: 0;
          left: 3rem;
          right: 3rem;
          bottom: 0;
          background-image:
            linear-gradient(
              to right,
              var(--border, oklch(0.2 0 0 / 0.1)) 1px,
              transparent 1px
            ),
            linear-gradient(
              to bottom,
              var(--border, oklch(0.2 0 0 / 0.1)) 1px,
              transparent 1px
            );
          background-size: 1.618rem 1.618rem;
          pointer-events: none;
          opacity: 0.3;
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 1.236rem;
          font-size: 1.618rem;
          font-weight: 400;
          color: var(--primary, oklch(0.78 0 0));
          margin: 0 0 3.236rem 0;
          letter-spacing: -0.01em;
          font-family: 'Playfair Display', serif;
          position: relative;
        }

        .section-title::after {
          content: '';
          position: absolute;
          bottom: -1.618rem;
          left: 0;
          width: 4.854rem;
          height: 1px;
          background: linear-gradient(
            90deg,
            var(--gold-accent, oklch(0.75 0.15 65)) 0%,
            transparent 100%
          );
        }

        .section-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          flex-shrink: 0;
        }

        .value-indicator {
          margin-left: auto;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 0.25rem 0.75rem;
          background: var(--gold-accent, oklch(0.75 0.15 65 / 0.1));
          border-radius: var(--radius, 0.375rem);
          border: 1px solid var(--gold-accent, oklch(0.75 0.15 65 / 0.2));
        }

        .welcome-showcase {
          max-width: 32rem;
        }

        .benefits-grid > .containsMany-field {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
          gap: 1.5rem;
        }

        .earning-matrix > .containsMany-field {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .membership-collection > .containsMany-field {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
          gap: 1.5rem;
        }

        .intelligence-content {
          font-size: 0.9375rem;
          line-height: 1.6;
          color: var(--muted-foreground, oklch(0.7 0 0));
        }

        @container (width <= 1024px) {
          .command-center {
            padding: 2rem 1.5rem;
          }

          .brand-signature {
            flex-direction: column;
            gap: 2rem;
          }

          .metrics-panel {
            justify-content: flex-start;
            align-items: center;
          }

          .welcome-metric,
          .earning-metric,
          .benefits-metric {
            min-width: 6rem;
          }

          .benefits-grid > .containsMany-field {
            grid-template-columns: 1fr;
          }

          .membership-collection > .containsMany-field {
            grid-template-columns: 1fr;
          }
        }

        @container (width <= 640px) {
          .card-image {
            width: 320px;
          }
          .command-center {
            padding: 1.5rem 1rem;
          }

          .card-title {
            font-size: 1.875rem;
          }

          .fee-structure {
            flex-direction: column;
            gap: 1rem;
            align-items: flex-start;
          }

          .metrics-panel {
            width: 100%;
            flex-direction: column;
            align-items: stretch;
          }

          .welcome-section,
          .benefits-section,
          .earning-section,
          .membership-section,
          .intelligence-section {
            padding: 1.5rem;
          }

          .section-title {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
          }

          .value-indicator {
            margin-left: 0;
            align-self: flex-start;
          }
        }

        .welcome-metric,
        .earning-metric,
        .benefits-metric {
          transition: all var(--duration-standard, 400ms)
            var(--easing-luxury, cubic-bezier(0.4, 0, 0.2, 1));
        }

        .welcome-metric:hover,
        .earning-metric:hover,
        .benefits-metric:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-premium, 0 12px 48px oklch(0 0 0 / 0.5));
          border-color: var(--gold-accent, oklch(0.75 0.15 65 / 0.3));
        }

        .section-icon {
          transition: transform var(--duration-micro, 120ms)
            var(--easing-luxury, cubic-bezier(0.4, 0, 0.2, 1));
        }

        .section-title:hover .section-icon {
          transform: scale(1.1);
        }

        * {
          box-sizing: border-box;
        }
        .platinum-stage {
          --spacing-unit: 8px;
          --radius: 0.375rem;
        }
      </style>
    </template>
  };
}
