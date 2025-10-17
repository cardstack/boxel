// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core APIs
import StringField from 'https://cardstack.com/base/string'; // ² Base fields
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { gt, eq } from '@cardstack/boxel-ui/helpers'; // ³ Helpers
import { formatCurrency, formatNumber } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';

/**
 * TimePeriod
 * Individual card for time period specifications
 */
export class TimePeriod extends CardDef {
  // ⁴ Time period card
  static displayName = 'Time Period';

  @field unit = contains(StringField); // ⁵ 'week' | 'month' | 'quarter' | 'half-year' | 'year'
  @field count = contains(NumberField); // ⁶ e.g., 1, 4, or 4.5
  @field scope = contains(StringField); // ⁷ 'calendar' | 'cardmember' | 'rolling' | 'lifetime'
  @field resetBasis = contains(StringField); // ⁸ 'calendar-year' | 'cardmember-year' | 'rolling'
  @field eligibleBookingNightsMin = contains(NumberField); // ⁹ e.g., 2 for "2+ nights"
  @field maxUsesPerPeriod = contains(NumberField); // ¹⁰ Optional: cap like "10 visits/year"
  @field minAmount = contains(NumberField); // ¹¹ Optional: per-use min amount gate
  @field minAmountCurrency = contains(StringField); // ¹² Currency for minAmount
  @field notes = contains(MarkdownField); // ¹³ Freeform notes

  @field title = contains(StringField, {
    // ¹⁴ Computed title
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
    // ¹⁵ Embedded format
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
        /* ¹⁶ Vintage luxury styling */
        .time-period {
          padding: var(--spacing, 0.375rem) calc(var(--spacing, 0.375rem) * 2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--card);
          color: var(--card-foreground);
          font-size: 0.875rem;
          font-family: var(--font-serif);
          box-shadow: var(--shadow-sm);
          transition: all 0.2s ease;
        }
        .time-period:hover {
          box-shadow: var(--shadow);
        }
        .period-display {
          display: flex;
          gap: calc(var(--spacing) * 0.75);
          align-items: baseline;
          letter-spacing: var(--tracking-normal, 0.01em);
        }
        .count {
          font-weight: 600;
          color: var(--primary);
          font-family: var(--font-sans);
        }
        .unit {
          color: var(--foreground);
          font-style: italic;
        }
        .scope {
          color: var(--muted-foreground);
          font-size: 0.75rem;
          font-weight: 400;
        }
        .notes {
          margin-top: calc(var(--spacing) * 0.75);
          font-size: 0.75rem;
          color: var(--muted-foreground);
          font-style: italic;
          border-top: 1px solid var(--border);
          padding-top: calc(var(--spacing) * 0.75);
          font-family: var(
            --font-serif
          ); /* Better readability for fine print */
        }
      </style>
    </template>
  };
}

/**
 * SignupBonus
 * Individual card for welcome offers
 */
export class SignupBonus extends CardDef {
  // ¹⁷ Signup bonus card
  static displayName = 'Signup Bonus';

  @field bonusType = contains(StringField); // ¹⁸ 'points' | 'statement-credit'
  @field pointsAmount = contains(NumberField); // ¹⁹ When bonusType='points'
  @field bonusCurrency = contains(StringField); // ²⁰ e.g., 'Membership Rewards' OR 'USD'
  @field spendRequirementAmount = contains(NumberField); // ²¹ e.g., 8000
  @field spendRequirementCurrency = contains(StringField); // ²² e.g., 'USD'
  @field spendWindowDays = contains(NumberField); // ²³ e.g., 180 (6 months)
  @field description = contains(MarkdownField); // ²⁴ Human description

  @field title = contains(StringField, {
    // ²⁵ Computed title
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
    // ²⁶ Embedded format
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
          {{#if @model.spendRequirementAmount}}
            <div class='requirement'>
              <span class='spend-label'>Spend:</span>
              <span class='spend-amount'>{{formatCurrency
                  @model.spendRequirementAmount
                  currency='USD'
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
        /* ²⁷ Vintage luxury welcome offer styling */
        .signup-bonus {
          padding: calc(var(--spacing) * 3);
          border: 2px solid var(--primary);
          border-radius: var(--radius);
          background: linear-gradient(
            135deg,
            var(--card) 0%,
            var(--secondary) 100%
          );
          color: var(--card-foreground);
          font-size: 0.875rem;
          font-family: var(--font-serif);
          box-shadow: var(--shadow-lg);
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
            var(--primary) 0%,
            var(--accent) 100%
          );
        }
        .bonus-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing) * 3);
          margin-bottom: calc(var(--spacing) * 2);
        }
        .bonus-amount {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing) * 0.5);
        }
        .points {
          font-size: 1.75rem;
          font-weight: 400;
          color: var(--primary);
          font-family: var(--font-serif);
          letter-spacing: var(--tracking-normal);
        }
        .currency {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--primary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans);
        }
        .requirement {
          text-align: right;
          font-size: 0.8125rem;
          font-family: var(--font-sans);
        }
        .spend-label {
          color: var(--muted-foreground);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .spend-amount {
          font-weight: 600;
          color: var(--foreground);
          display: block;
          margin-top: calc(var(--spacing) * 0.25);
        }
        .window {
          display: block;
          color: var(--muted-foreground);
          font-style: italic;
          margin-top: calc(var(--spacing) * 0.25);
        }
        .description {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          border-top: 1px solid var(--border);
          padding-top: calc(var(--spacing) * 2);
          margin-top: calc(var(--spacing) * 2);
          font-style: italic;
          line-height: 1.5;
          font-family: var(
            --font-serif
          ); /* Better readability for fine print */
        }
      </style>
    </template>
  };
}

/**
 * Benefit
 * Individual card for statement credits and general benefits
 */
export class Benefit extends CardDef {
  // ²⁸ Benefit card
  static displayName = 'Benefit';

  @field name = contains(StringField); // ²⁹ Short label
  @field partner = contains(StringField); // ³⁰ Program/partner name
  @field benefitKind = contains(StringField); // ³¹ 'statement-credit' | 'travel-credit' | 'offer'
  @field amount = contains(NumberField); // ³² e.g., 200
  @field currency = contains(StringField); // ³³ e.g., 'USD'
  @field timePeriod = linksTo(TimePeriod); // ³⁴ Link to time period
  @field enrollmentRequired = contains(BooleanField); // ³⁵ Whether enrollment required
  @field minSpend = contains(NumberField); // ³⁶ Minimum spend to unlock
  @field minSpendCurrency = contains(StringField); // ³⁷ Currency for minSpend
  @field programURL = contains(UrlField); // ³⁸ Link to partner/program
  @field conditions = contains(MarkdownField); // ³⁹ Terms, notes, exclusions
  @field details = containsMany(StringField); // ⁴⁰ Bullet-point details

  @field title = contains(StringField, {
    // ⁴¹ Computed title
    computeVia: function (this: Benefit) {
      try {
        return this.name ?? 'Benefit';
      } catch (e) {
        return 'Benefit';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    // ⁴² Embedded format
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
          {{#if @model.amount}}
            <div class='benefit-value'>
              <div class='amount'>{{formatCurrency
                  @model.amount
                  currency='USD'
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

        {{#if @model.minSpend}}
          <div class='spend-requirement'>
            <span class='spend-label'>Minimum spend:</span>
            <span class='spend-amount'>{{formatCurrency
                @model.minSpend
                currency=@model.minSpendCurrency
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
        /* ⁴³ Vintage luxury benefit styling */
        .benefit {
          padding: calc(var(--spacing) * 4);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--card);
          color: var(--card-foreground);
          font-size: 0.875rem;
          font-family: var(--font-serif);
          box-shadow: var(--shadow);
          transition: all 0.3s ease;
          position: relative;
        }
        .benefit:hover {
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
        }
        .benefit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing) * 4);
          margin-bottom: calc(var(--spacing) * 3);
        }
        .benefit-title {
          flex: 1;
        }
        .benefit-name {
          font-weight: 500;
          color: var(--foreground);
          font-size: 1.125rem;
          letter-spacing: var(--tracking-normal);
          margin: 0 0 calc(var(--spacing) * 2) 0;
          line-height: 1.3;
        }
        .enrollment-badge {
          padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
          background: oklch(0.52 0.08 25);
          color: var(--background);
          border-radius: calc(var(--radius) * 0.5);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans);
          border: 1px solid oklch(0.45 0.1 25);
          display: inline-block;
        }
        .benefit-value {
          text-align: right;
          font-family: var(--font-sans);
          flex-shrink: 0;
        }
        .amount {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--primary);
          letter-spacing: var(--tracking-normal);
          display: block;
          line-height: 1.1;
        }
        .period {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          margin-top: calc(var(--spacing) * 1);
          font-style: italic;
          display: block;
        }
        .partner {
          color: var(--muted-foreground);
          font-style: italic;
          margin-bottom: calc(var(--spacing) * 2);
          font-size: 0.8125rem;
          border-left: 3px solid var(--primary);
          padding-left: calc(var(--spacing) * 2);
          font-weight: 500;
        }
        .spend-requirement {
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: calc(var(--radius) * 0.5);
          padding: calc(var(--spacing) * 2);
          margin-bottom: calc(var(--spacing) * 2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: var(--font-sans);
        }
        .spend-label {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .spend-amount {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--foreground);
        }
        .conditions {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          border-top: 1px solid var(--border);
          padding-top: calc(var(--spacing) * 2);
          margin-top: calc(var(--spacing) * 2);
          line-height: 1.6;
          font-style: italic;
          font-family: var(--font-serif);
        }
        .details-section {
          margin-top: calc(var(--spacing) * 3);
        }
        .details-label {
          font-weight: 600;
          color: var(--foreground);
          margin-bottom: calc(var(--spacing) * 1.5);
          font-size: 0.875rem;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-family: var(--font-sans);
        }
        .details {
          list-style: none;
          padding: 0;
          margin: 0;
          background: var(--muted);
          border-radius: calc(var(--radius) * 0.5);
          padding: calc(var(--spacing) * 2);
        }
        .details li {
          padding: calc(var(--spacing) * 1) 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          position: relative;
          padding-left: calc(var(--spacing) * 3);
          line-height: 1.5;
          font-family: var(--font-serif);
        }
        .details li:not(:last-child) {
          border-bottom: 1px solid var(--border);
          padding-bottom: calc(var(--spacing) * 1.5);
          margin-bottom: calc(var(--spacing) * 1);
        }
        .details li::before {
          content: '✓';
          color: var(--primary);
          position: absolute;
          left: 0;
          font-weight: bold;
          font-size: 0.75rem;
        }
      </style>
    </template>
  };
}

/**
 * MembershipBenefit
 * Individual card for elite status and membership perks
 */
export class MembershipBenefit extends CardDef {
  // ⁴⁴ Membership benefit card
  static displayName = 'Membership Benefit';

  @field membershipProgram = contains(StringField); // ⁴⁵ e.g., 'Hilton Honors'
  @field statusLevel = contains(StringField); // ⁴⁶ e.g., 'Gold', 'Gold Elite'
  @field autoEnrollment = contains(BooleanField); // ⁴⁷ true if granted automatically
  @field enrollmentInstructions = contains(MarkdownField); // ⁴⁸ Steps to enroll/activate
  @field benefitsList = containsMany(StringField); // ⁴⁹ Key privileges as bullet points
  @field partner = contains(StringField); // ⁵⁰ Partner name
  @field enrollmentRequired = contains(BooleanField); // ⁵¹ Whether enrollment required
  @field conditions = contains(MarkdownField); // ⁵² Terms and conditions

  @field title = contains(StringField, {
    // ⁵³ Computed title
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
    // ⁵⁴ Embedded format
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
        /* ⁵⁵ Vintage luxury membership styling */
        .membership-benefit {
          padding: calc(var(--spacing) * 3);
          border: 2px solid var(--accent);
          border-radius: var(--radius);
          background: linear-gradient(
            135deg,
            var(--card) 0%,
            var(--secondary) 100%
          );
          color: var(--card-foreground);
          font-size: 0.875rem;
          font-family: var(--font-serif);
          box-shadow: var(--shadow-md);
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
            var(--accent) 0%,
            var(--primary) 100%
          );
        }
        .membership-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing) * 3);
          margin-bottom: calc(var(--spacing) * 2);
        }
        .membership-name strong {
          font-weight: 500;
          color: var(--foreground);
          font-size: 1rem;
          letter-spacing: var(--tracking-normal);
        }
        .status-badge {
          display: block;
          padding: calc(var(--spacing) * 0.75) calc(var(--spacing) * 2);
          background: var(--primary);
          color: var(--primary-foreground);
          border-radius: calc(var(--radius) * 0.5);
          font-size: 0.75rem;
          font-weight: 500;
          margin-top: calc(var(--spacing) * 1.5);
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-family: var(--font-sans);
        }
        .auto-badge {
          padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2.5);
          background: oklch(0.6 0.15 140); /* Green for automatic benefits */
          color: var(--background);
          border-radius: calc(var(--radius) * 0.5);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans);
          border: 1px solid oklch(0.5 0.18 140);
        }
        .manual-badge {
          padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2.5);
          background: oklch(
            0.52 0.08 25
          ); /* Amber/orange for manual enrollment */
          color: var(--background);
          border-radius: calc(var(--radius) * 0.5);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-sans);
          border: 1px solid oklch(0.45 0.1 25);
        }
        .partner {
          color: var(--muted-foreground);
          font-style: italic;
          margin-bottom: calc(var(--spacing) * 2);
          font-size: 0.8125rem;
          border-left: 2px solid var(--border);
          padding-left: calc(var(--spacing) * 2);
        }
        .benefits-label {
          font-weight: 500;
          color: var(--foreground);
          margin-bottom: calc(var(--spacing) * 1.5);
          font-size: 0.8125rem;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-family: var(--font-sans);
        }
        .benefits-items {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .benefits-items li {
          padding: calc(var(--spacing) * 0.75) 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          position: relative;
          padding-left: calc(var(--spacing) * 3);
          line-height: 1.4;
          font-family: var(
            --font-serif
          ); /* Better readability for fine print */
        }
        .benefits-items li::before {
          content: '•';
          color: var(--primary);
          position: absolute;
          left: 0;
          font-weight: bold;
        }
        .enrollment-instructions {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          border-top: 1px solid var(--border);
          padding-top: calc(var(--spacing) * 2);
          margin-top: calc(var(--spacing) * 2);
          font-style: italic;
          line-height: 1.5;
          font-family: var(
            --font-serif
          ); /* Better readability for fine print */
        }
      </style>
    </template>
  };
}

/**
 * EarningRule
 * Individual card for points earning rules
 */
export class EarningRule extends CardDef {
  // ⁵⁶ Earning rule card
  static displayName = 'Earning Rule';

  @field category = contains(StringField); // ⁵⁷ e.g., 'Flights', 'Prepaid Hotels'
  @field rateMultiplier = contains(NumberField); // ⁵⁸ e.g., 5 for 5X
  @field appliesTo = contains(StringField); // ⁵⁹ Channel/constraint
  @field capAmount = contains(NumberField); // ⁶⁰ Monetary cap
  @field capCurrency = contains(StringField); // ⁶¹ e.g., 'USD'
  @field capPeriod = linksTo(TimePeriod); // ⁶² Structured cap period
  @field conditions = contains(MarkdownField); // ⁶³ Additional notes/limitations

  @field title = contains(StringField, {
    // ⁶⁴ Computed title
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
    // ⁶⁵ Embedded format
    <template>
      <div class='earning-rule'>
        <div class='earning-header'>
          <div class='earning-rate'>
            {{#if @model.rateMultiplier}}
              <span class='multiplier'>{{@model.rateMultiplier}}X</span>
              <span class='points-label'>points</span>
            {{/if}}
          </div>
          {{#if @model.capAmount}}
            <div class='cap-info'>
              <span class='cap-label'>Cap:</span>
              <span class='cap-amount'>{{formatCurrency
                  @model.capAmount
                  currency='USD'
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
        /* ⁶⁶ Vintage luxury earning rule styling */
        .earning-rule {
          padding: calc(var(--spacing) * 3);
          border: 2px solid var(--primary);
          border-radius: var(--radius);
          background: linear-gradient(
            135deg,
            var(--card) 0%,
            var(--secondary) 100%
          );
          color: var(--card-foreground);
          font-size: 0.875rem;
          font-family: var(--font-serif);
          box-shadow: var(--shadow-md);
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
            var(--primary) 0%,
            var(--accent) 100%
          );
        }
        .earning-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing) * 3);
          margin-bottom: calc(var(--spacing) * 2);
        }
        .earning-rate {
          display: flex;
          align-items: baseline;
          gap: calc(var(--spacing) * 1.5);
        }
        .multiplier {
          font-size: 1.75rem;
          font-weight: 400;
          color: var(--primary);
          font-family: var(--font-serif);
          letter-spacing: var(--tracking-normal);
        }
        .points-label {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          font-style: italic;
          text-transform: lowercase;
        }
        .cap-info {
          text-align: right;
          font-size: 0.8125rem;
          font-family: var(--font-sans);
        }
        .cap-label {
          color: oklch(0.55 0.18 25); /* Wine red for caps/limitations */
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          display: block;
        }
        .cap-amount {
          font-weight: 600;
          color: oklch(0.55 0.18 25); /* Wine red for caps/limitations */
          margin-top: calc(var(--spacing) * 0.5);
          display: block;
        }
        .cap-period {
          display: block;
          color: var(--muted-foreground);
          font-style: italic;
          margin-top: calc(var(--spacing) * 0.5);
        }
        .category {
          font-weight: 500;
          color: var(--foreground);
          margin-bottom: calc(var(--spacing) * 1.5);
          font-size: 1rem;
          letter-spacing: var(--tracking-normal);
        }
        .applies-to {
          color: var(--muted-foreground);
          font-style: italic;
          margin-bottom: calc(var(--spacing) * 2);
          font-size: 0.8125rem;
          border-left: 2px solid var(--border);
          padding-left: calc(var(--spacing) * 2);
          line-height: 1.4;
        }
        .conditions {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          border-top: 1px solid var(--border);
          padding-top: calc(var(--spacing) * 2);
          margin-top: calc(var(--spacing) * 2);
          font-style: italic;
          line-height: 1.5;
          font-family: var(
            --font-serif
          ); /* Better readability for fine print */
        }
      </style>
    </template>
  };
}

/**
 * RewardCardSystem
 * Main card that links to individual benefit/rule cards instead of containing them as fields
 */
export class RewardCardSystem extends CardDef {
  // ⁶⁷ Main system card
  static displayName = 'Reward Card System';

  // Core identifiers
  @field cardName = contains(StringField); // ⁶⁸ e.g., 'The Platinum Card from American Express'
  @field issuer = contains(StringField); // ⁶⁹ e.g., 'American Express'
  @field network = contains(StringField); // ⁷⁰ e.g., 'American Express', 'Visa', 'Mastercard'
  @field businessOrPersonal = contains(StringField); // ⁷¹ 'personal' | 'business' | 'both'

  // Economics
  @field annualFee = contains(NumberField); // ⁷² e.g., 695
  @field annualFeeCurrency = contains(StringField); // ⁷³ e.g., 'USD'

  // Program dates
  @field programStartDate = contains(DateField); // ⁷⁴ ISO date
  @field programEndDate = contains(DateField); // ⁷⁵ Optional sunset

  // Welcome offer - now links to separate card
  @field signupBonus = linksTo(SignupBonus); // ⁷⁶ Link to signup bonus card

  // Ongoing value - now links to separate cards
  @field statementBenefits = linksToMany(Benefit); // ⁷⁷ Links to benefit cards
  @field membershipBenefits = linksToMany(MembershipBenefit); // ⁷⁸ Links to membership cards
  @field earningRules = linksToMany(EarningRule); // ⁷⁹ Links to earning rule cards

  // Optional summary/notes
  @field notes = contains(MarkdownField); // ⁸⁰ Freeform notes
  @field amexLogoUrl = contains(UrlField); // ⁸¹ URL for Amex logo

  @field title = contains(StringField, {
    // ⁸² Computed title
    computeVia: function (this: RewardCardSystem) {
      try {
        return this.cardName ?? 'Unnamed Card System';
      } catch (e) {
        return 'Unnamed Card System';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // ⁸³ Isolated format enhanced with RewardCardProgram styling
    get totalAnnualValue() {
      try {
        const benefits = this.args.model?.statementBenefits ?? [];
        return benefits.reduce((total, benefit) => {
          const amount = benefit.amount || 0;
          return total + amount;
        }, 0);
      } catch (e) {
        console.error(
          'RewardCardSystem: Error calculating total annual value',
          e,
        );
        return 0;
      }
    }

    get valueToFeeRatio() {
      try {
        const fee = this.args.model?.annualFee ?? 0;
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

    <template>
      {{! ⁸⁴ Premium stage with dark luxury foundation }}
      <div class='platinum-stage'>
        <div class='command-center'>

          {{! ⁸⁵ Executive header with prominent card showcase }}
          <header class='executive-header'>
            {{! ⁸⁵ᵃ American Express logo overlay at top }}
            {{#if @model.amexLogoUrl}}
              <div class='top-amex-logo'>
                <img
                  src='{{@model.amexLogoUrl}}'
                  alt='{{@model.issuer}} Logo'
                  class='top-amex-image'
                />
              </div>
            {{/if}}

            <div class='brand-signature'>
              <div class='card-identity'>
                <h1 class='card-title'>{{if
                    @model.cardName
                    @model.cardName
                    'Premium Card System'
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

              {{#if @model.annualFee}}
                <div class='fee-structure'>
                  <div class='annual-fee'>
                    <span class='fee-label'>Annual Fee</span>
                    <span class='fee-amount'>{{formatCurrency
                        @model.annualFee
                        currency='USD'
                        minimumFractionDigits=0
                        maximumFractionDigits=0
                      }}</span>
                  </div>
                  {{#if (gt this.totalAnnualValue 0)}}
                    <div class='value-proposition'>
                      <span class='value-label'>Annual Value</span>
                      <span class='value-amount'>{{formatCurrency
                          this.totalAnnualValue
                          currency='USD'
                          minimumFractionDigits=0
                          maximumFractionDigits=0
                        }}</span>
                      <span class='value-ratio'>{{this.valueToFeeRatio}}× return</span>
                    </div>
                  {{/if}}
                </div>
              {{/if}}
            </div>

            {{! ⁸⁶ Strategic metrics panel }}
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

          {{! ⁸⁷ Swiss-organized content sections }}
          <main class='content-grid'>

            {{! ⁸⁸ Welcome offer prominence }}
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

            {{! ⁸⁹ Statement benefits matrix }}
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
                      currency='USD'
                      size='short'
                    }}
                    annual value</span>
                </h2>
                <div class='benefits-grid'>
                  <@fields.statementBenefits @format='embedded' />
                </div>
              </section>
            {{/if}}

            {{! ⁹⁰ Earning structure }}
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

            {{! ⁹¹ Elite memberships }}
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

            {{! ⁹² Program intelligence }}
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
        /* ⁹³ Pentagram-level typographic foundation with mathematical precision */
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
        }

        .command-center {
          max-width: 84rem; /* Golden ratio progression: 52 * 1.618 */
          margin: 0 auto;
          padding: 4.854rem 3rem; /* Golden ratio: 3 * 1.618 */
          min-height: 100vh;
        }

        /* ⁹⁴ Executive header with platinum authority and card showcase */
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

        /* ⁹⁴ᵃ Top American Express logo styling */
        .top-amex-logo {
          align-self: flex-start;
          margin-bottom: 1rem;
          padding: 0.75rem 1.5rem;
          background: var(--surface, oklch(0.98 0 0));
          border-radius: var(--radius);
          border: 1px solid var(--border, oklch(0.2 0 0));
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .top-amex-image {
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

        .card-identity .card-title {
          font-size: 3.5rem; /* Expanded for gravitas */
          font-weight: 300;
          letter-spacing: -0.02em; /* Tighter for luxury feel */
          color: var(--primary, oklch(0.88 0 0));
          margin: 0 0 1.618rem 0; /* Golden ratio */
          line-height: 0.95; /* Tight leading for impact */
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
          padding: 0.618rem 1.236rem; /* Golden ratio progression */
          border-radius: 0; /* Pentagram precision */
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.1em; /* Increased for editorial precision */
          text-transform: uppercase;
          font-family: 'Inter', sans-serif; /* Contrast with serif headlines */
          border: 1px solid;
        }

        .issuer-badge {
          background: var(--gold-accent, oklch(0.75 0.15 65));
          color: var(--accent-foreground, oklch(0.08 0 0));
        }

        .network-badge {
          background: var(--secondary, oklch(0.15 0 0));
          color: var(--secondary-foreground, oklch(0.95 0 0));
          border: 1px solid var(--border, oklch(0.2 0 0));
        }

        .type-badge {
          background: var(--muted, oklch(0.25 0 0));
          color: var(--muted-foreground, oklch(0.7 0 0));
        }

        /* ⁹⁵ Fee structure with value intelligence */
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
          color: var(--foreground, oklch(0.95 0 0));
          font-family: 'Inter', sans-serif; /* Use sans-serif for numbers */
        }

        .value-amount {
          font-size: 1.5rem;
          font-weight: 300;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-family: 'Inter', sans-serif; /* Use sans-serif for numbers */
        }

        .value-ratio {
          font-size: 0.875rem;
          color: var(--value-positive, oklch(0.7 0.15 140));
          font-weight: 600;
        }

        /* ⁹⁶ Strategic metrics panel */
        .metrics-panel {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          align-items: flex-end;
        }

        .welcome-metric,
        .earning-metric,
        .benefits-metric {
          text-align: right;
          padding: 1rem 1.5rem;
          background: var(--surface, oklch(0.98 0 0));
          border-radius: var(--radius, 0.375rem);
          border: 1px solid var(--border, oklch(0.2 0 0));
          backdrop-filter: blur(8px);
          min-width: 8rem;
        }

        .metric-value {
          font-size: 1.75rem;
          font-weight: 300;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          line-height: 1;
          margin-bottom: 0.25rem;
          font-family: 'Inter', sans-serif; /* Use sans-serif for all numbers */
        }

        .metric-label {
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.7 0 0));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: var(--tracking-wider, 0.05em);
        }

        /* ⁹⁷ Pentagram editorial layout with mathematical spacing */
        .content-grid {
          display: flex;
          flex-direction: column;
          gap: 6.472rem; /* Golden ratio progression: 4 * 1.618 */
        }

        .welcome-section,
        .benefits-section,
        .earning-section,
        .membership-section,
        .intelligence-section {
          background: var(--surface, oklch(0.98 0 0));
          border-radius: 0; /* Pentagram precision: eliminate unnecessary curves */
          padding: 4.045rem 3rem; /* Golden ratio progression */
          border: none;
          border-top: 3px solid var(--gold-accent, oklch(0.75 0.15 65));
          position: relative;
          overflow: hidden;
        }

        /* Editorial grid lines for Pentagram precision */
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
          background-size: 1.618rem 1.618rem; /* Golden ratio grid */
          pointer-events: none;
          opacity: 0.3;
        }

        /* ⁹⁸ Pentagram-inspired section typography with editorial precision */
        .section-title {
          display: flex;
          align-items: center;
          gap: 1.236rem; /* Golden ratio progression */
          font-size: 1.618rem; /* Golden ratio */
          font-weight: 400;
          color: var(--primary, oklch(0.88 0 0));
          margin: 0 0 3.236rem 0; /* Golden ratio progression */
          letter-spacing: -0.01em;
          font-family: 'Playfair Display', serif;
          position: relative;
        }

        .section-title::after {
          content: '';
          position: absolute;
          bottom: -1.618rem;
          left: 0;
          width: 4.854rem; /* Golden ratio progression */
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
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-weight: 500;
          padding: 0.25rem 0.75rem;
          background: var(--gold-accent, oklch(0.75 0.15 65 / 0.1));
          border-radius: var(--radius, 0.375rem);
          border: 1px solid var(--gold-accent, oklch(0.75 0.15 65 / 0.2));
        }

        /* ⁹⁹ Collection layouts with proper spacing */
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

        /* ¹⁰⁰ Responsive luxury experience */
        @media (max-width: 1024px) {
          .command-center {
            padding: 2rem 1.5rem;
          }

          .brand-signature {
            flex-direction: column;
            gap: 2rem;
          }

          .metrics-panel {
            flex-direction: row;
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

        @media (max-width: 640px) {
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

        /* ¹⁰¹ Premium hover states and micro-interactions */
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

        /* ¹⁰² Swiss precision spacing system */
        * {
          box-sizing: border-box;
        }

        /* Apply theme CSS variables consistently */
        .platinum-stage {
          --spacing-unit: 8px;
          --radius: 0.375rem;
        }
      </style>
    </template>
  };
}
