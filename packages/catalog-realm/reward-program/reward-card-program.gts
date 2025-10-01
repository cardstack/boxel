import { gt, eq } from '@cardstack/boxel-ui/helpers';
import { formatCurrency, formatNumber } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core APIs (added Component for field templates)
import StringField from 'https://cardstack.com/base/string'; // ² Base fields
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import MarkdownField from 'https://cardstack.com/base/markdown';

/**
 * BrandLogoField
 * For displaying issuer/network brand logos prominently
 */
export class BrandLogoField extends FieldDef {
  static displayName = 'Brand Logo';

  @field logoUrl = contains(UrlField);
  @field altText = contains(StringField);
  @field width = contains(NumberField); // Optional: preferred width in pixels
  @field height = contains(NumberField); // Optional: preferred height in pixels

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.logoUrl}}
        <div class='brand-logo'>
          <img
            src='{{@model.logoUrl}}'
            alt='{{if @model.altText @model.altText "Brand Logo"}}'
            class='logo-image'
            width='{{if @model.width @model.width "auto"}}'
            height='{{if @model.height @model.height "auto"}}'
          />
        </div>
      {{/if}}

      <style scoped>
        .brand-logo {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .logo-image {
          max-width: 100%;
          height: auto;
          filter: brightness(0.9) contrast(1.1);
          transition: filter var(--duration-micro, 120ms) ease;
        }

        .logo-image:hover {
          filter: brightness(1) contrast(1.2);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.logoUrl}}
        <img
          src='{{@model.logoUrl}}'
          alt='{{if @model.altText @model.altText "Logo"}}'
          style='width: 1.5rem; height: auto; vertical-align: middle;'
        />
      {{/if}}
    </template>
  };
}

/**
 * PeriodConstraintsField
 * Optional constraints that further qualify the time period application window
 */
export class PeriodConstraintsField extends FieldDef {
  // ¹⁴⁰ Constraints model
  static displayName = 'Period Constraints';
  @field resetBasis = contains(StringField); // ¹⁴¹ 'calendar-year' | 'cardmember-year' | 'rolling' | 'per-booking'
  @field eligibleBookingNightsMin = contains(NumberField); // ¹⁴² e.g., 2 for "2+ nights"
  @field maxUsesPerPeriod = contains(NumberField); // ¹⁷⁰ Optional: cap like "10 visits/year"
  @field minAmount = contains(NumberField); // ¹⁴³ Optional: per-use min amount gate
  @field minAmountCurrency = contains(StringField); // ¹⁴⁴ Currency for minAmount
  @field notes = contains(MarkdownField); // ¹⁴⁵ Freeform notes

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁶² Minimal list
    <template>
      <div class='pc'>
        {{#if @model.resetBasis}}<span
            class='pill'
          >{{@model.resetBasis}}</span>{{/if}}
        {{#if @model.eligibleBookingNightsMin}}<span
            class='pill'
          >{{@model.eligibleBookingNightsMin}}+ nights</span>{{/if}}
        {{#if @model.minAmount}}<span class='pill'>min
            {{@model.minAmount}}
            {{@model.minAmountCurrency}}</span>{{/if}}
        {{#if @model.maxUsesPerPeriod}}<span class='pill'>up to
            {{@model.maxUsesPerPeriod}}
            uses</span>{{/if}}
      </div>
      <style scoped>
        .pc {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          flex-wrap: wrap;
          font-size: 0.75rem;
        }
        .pill {
          padding: 0.125rem 0.375rem;
          border-radius: 0.375rem;
          background: rgba(0, 0, 0, 0.05);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    // ¹⁶³ Inline
    <template>
      <span>{{@model.resetBasis}}</span>
    </template>
  };
}

/**
 * TimePeriodField
 * Structured replacement for stringified time period
 */
export class TimePeriodField extends FieldDef {
  // ¹⁴⁶ Structured time period
  static displayName = 'Time Period';
  // Frequency unit breakdown with numeric multiplier
  @field unit = contains(StringField); // ¹⁴⁷ 'week' | 'month' | 'quarter' | 'half-year' | 'year' | 'one-time' | 'per-eligible-booking'
  @field count = contains(NumberField); // ¹⁴⁸ e.g., 1, 4, or 4.5 (TSA PreCheck 4.5 years)
  // Scope for reset cadence or applicability
  @field scope = contains(StringField); // ¹⁴⁹ 'calendar' | 'cardmember' | 'rolling' | 'lifetime' | 'per-booking'
  // Additional qualifiers
  @field constraints = contains(PeriodConstraintsField); // ¹⁵⁰ optional constraints

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁵¹ Compact embedded view
    <template>
      <div class='tp-compact'>
        {{#if @model.unit}}
          {{#if @model.count}}
            <span class='pill'>{{@model.count}} {{@model.unit}}</span>
          {{else}}
            <span class='pill'>{{@model.unit}}</span>
          {{/if}}
        {{else}}
          <span class='pill muted'>No period</span>
        {{/if}}

        {{#if @model.scope}}
          <span class='pill'>{{@model.scope}}</span>
        {{/if}}

        {{#if @model.constraints.eligibleBookingNightsMin}}
          <span class='pill'>{{@model.constraints.eligibleBookingNightsMin}}+
            nights</span>
        {{/if}}
      </div>

      <style scoped>
        .tp-compact {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
        }
        .pill {
          padding: 0.125rem 0.375rem;
          border-radius: 0.375rem;
          background: rgba(0, 0, 0, 0.05);
        }
        .pill.muted {
          opacity: 0.6;
        }
      </style>
    </template>
  };
  static atom = class Atom extends Component<typeof this> {
    // ¹⁶⁴ Tiny inline chip
    <template>
      <span>{{if
          @model.unit
          (concat (if @model.count (concat @model.count ' ') '') @model.unit)
          '—'
        }}</span>
    </template>
  };
}

/**
 * BenefitField
 * Generic benefit model for statement credits, travel credits, etc.
 */
export class BenefitField extends FieldDef {
  // ³ Base benefit field
  static displayName = 'Benefit';

  @field name = contains(StringField); // ⁴ Short label (e.g., "Airline Fee Credit")
  @field partner = contains(StringField); // ⁵ Program/partner name (e.g., "Selected Airline", "Uber", "Saks")
  @field benefitKind = contains(StringField); // ⁶ 'statement-credit' | 'travel-credit' | 'offer' | etc.

  // Monetary value and currency for the benefit (when applicable)
  @field amount = contains(NumberField); // ⁷ e.g., 200
  @field currency = contains(StringField); // ⁸ e.g., 'USD'

  // Periodicity broken down into unit/count/scope
  @field timePeriod = contains(TimePeriodField); // ⁹ structured time period

  // Qualification attributes
  @field enrollmentRequired = contains(BooleanField); // ¹⁰ Whether enrollment/activation is required
  @field minSpend = contains(NumberField); // ¹¹ Minimum spend to unlock (in currency units); omit if none
  @field minSpendCurrency = contains(StringField); // ¹² Currency for minSpend (e.g., 'USD')

  // Optional references and details
  @field programURL = contains(UrlField); // ¹³ Link to partner/program
  @field conditions = contains(MarkdownField); // ¹⁴ Terms, notes, exclusions, etc.
  @field details = containsMany(StringField); // ¹⁷¹ Optional bullet-point details for access/perks

  get annualizedValue() {
    try {
      if (!this.amount || !this.timePeriod?.unit) return null;

      const amount = this.amount;
      const unit = this.timePeriod.unit;
      const count = this.timePeriod.count || 1;

      // Handle special cases
      if (unit === 'per-eligible-booking' || unit === 'one-time') {
        return null; // Can't annualize usage-based benefits
      }

      // Calculate periods per year
      let periodsPerYear = 0;
      switch (unit) {
        case 'month':
          periodsPerYear = 12 / count;
          break;
        case 'quarter':
          periodsPerYear = 4 / count;
          break;
        case 'half-year':
          periodsPerYear = 2 / count;
          break;
        case 'year':
          periodsPerYear = 1 / count;
          break;
        case 'week':
          periodsPerYear = 52 / count;
          break;
        default:
          return null;
      }

      const annualValue = amount * periodsPerYear;

      // Handle special notes (like Uber's December bonus)
      if (this.timePeriod?.constraints?.notes?.includes('December')) {
        // Uber: $15/month + $20 in December = $200 total
        return 200;
      }

      return Math.round(annualValue * 100) / 100; // Round to 2 decimals
    } catch (e) {
      console.error('BenefitField: Error computing annualized value', e);
      return null;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁵³ Enhanced benefit view with per-period and annual totals
    <template>
      <div class='benefit-card'>
        <div class='benefit-header'>
          <div class='benefit-name'>
            <strong>{{if @model.name @model.name 'Benefit'}}</strong>
            <div class='benefit-badges'>
              {{#if @model.enrollmentRequired}}
                <span class='enrollment-badge'>enrollment required</span>
              {{/if}}
              {{#if @model.minSpend}}
                <span class='minspend-badge'>min spend:
                  {{formatCurrency
                    @model.minSpend
                    currency='USD'
                    minimumFractionDigits=0
                    maximumFractionDigits=0
                  }}</span>
              {{/if}}
            </div>
          </div>

          {{#if @model.amount}}
            <div class='value-display'>
              <div class='per-period'>
                <span class='amount'>{{formatCurrency
                    @model.amount
                    currency='USD'
                    minimumFractionDigits=0
                    maximumFractionDigits=0
                  }}</span>
                {{#if @model.timePeriod.unit}}
                  <span class='frequency'>per {{@model.timePeriod.unit}}</span>
                {{/if}}
              </div>

              {{#if this.annualizedValue}}
                <div class='annual-total'>
                  <span class='annual-label'>Annual:</span>
                  <span class='annual-amount'>{{formatCurrency
                      this.annualizedValue
                      currency='USD'
                      minimumFractionDigits=0
                      maximumFractionDigits=0
                    }}</span>
                </div>
              {{/if}}
            </div>
          {{/if}}
        </div>

        <div class='benefit-details'>
          {{#if @model.partner}}
            <span class='partner'>{{@model.partner}}</span>
          {{/if}}

          {{#if @model.timePeriod}}
            <div class='period-info'>
              <@fields.timePeriod @format='embedded' />
            </div>
          {{/if}}
        </div>

        {{#if @model.conditions}}
          <div class='conditions'>
            {{@model.conditions}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .benefit-card {
          padding: 1rem;
          border: 2px solid var(--border, oklch(0.3 0 0));
          border-radius: var(--radius);
          background: var(--surface, oklch(0.98 0 0));
          color: var(--foreground, oklch(0.95 0 0));
          font-size: 0.8125rem;
          line-height: 1.4;
          backdrop-filter: blur(8px);
          box-shadow: var(--shadow-card);
        }

        .benefit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .benefit-name {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          flex: 1;
        }

        .benefit-name strong {
          font-weight: 600;
          color: var(--primary, oklch(0.88 0 0));
          font-size: 0.875rem;
        }

        .benefit-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .enrollment-badge {
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          background: var(--surface-secondary, oklch(0.96 0 0));
          color: var(--gold-accent, oklch(0.75 0.15 65));
          border: 1px solid var(--gold-accent, oklch(0.75 0.15 65));
          font-size: 0.6875rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .minspend-badge {
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          background: var(--background, oklch(0.08 0 0));
          color: var(--ring, oklch(0.6 0.12 240));
          border: 1px solid var(--ring, oklch(0.6 0.12 240));
          font-size: 0.6875rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .value-display {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.125rem;
          text-align: right;
        }

        .per-period {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
        }

        .amount {
          font-weight: 700;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-size: 1rem;
        }

        .frequency {
          color: var(--muted-foreground, oklch(0.7 0 0));
          font-size: 0.75rem;
        }

        .annual-total {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: var(--surface-glass, oklch(0.95 0 0 / 0.9));
          border-radius: 0.25rem;
          border: 1px solid var(--border, oklch(0.2 0 0));
          backdrop-filter: blur(4px);
        }

        .annual-label {
          font-size: 0.6875rem;
          color: var(--ring, oklch(0.6 0.12 240));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .annual-amount {
          font-weight: 700;
          color: var(--ring, oklch(0.6 0.12 240));
          font-size: 0.875rem;
        }

        .benefit-details {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.5rem;
        }

        .partner {
          color: #6b7280;
          font-style: italic;
        }

        .period-info {
          margin-left: auto;
        }

        .conditions {
          font-size: 0.75rem;
          color: #6b7280;
          line-height: 1.3;
          border-top: 1px solid rgba(0, 0, 0, 0.05);
          padding-top: 0.5rem;
          margin-top: 0.5rem;
        }

        @media (max-width: 480px) {
          .benefit-header {
            flex-direction: column;
            align-items: stretch;
          }

          .value-display {
            align-items: flex-start;
            text-align: left;
          }

          .annual-total {
            align-self: flex-start;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    // ¹⁵⁴ Ultra-compact inline
    <template>
      <span>{{@model.name}}{{if
          @model.amount
          (concat ' — ' @model.amount ' ' @model.currency)
          ''
        }}</span>
    </template>
  };
}

/**
 * MembershipBenefitField
 * Subclass of BenefitField for automatic or enroll-to-activate elite status/membership perks
 */
export class MembershipBenefitField extends BenefitField {
  // ¹⁵ Membership/status subtype
  static displayName = 'Membership Benefit';

  @field membershipProgram = contains(StringField); // ¹⁶ e.g., 'Hilton Honors', 'Marriott Bonvoy'
  @field statusLevel = contains(StringField); // ¹⁷ e.g., 'Gold', 'Gold Elite', 'Sterling'
  @field autoEnrollment = contains(BooleanField); // ¹⁸ true if granted automatically, false if cardmember must enroll
  @field enrollmentInstructions = contains(MarkdownField); // ¹⁹ Steps to enroll/activate
  @field benefitsList = containsMany(StringField); // ²⁰ Key privileges as bullet points

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁵⁵ Enhanced membership benefit with clear status and enrollment info
    <template>
      <div class='membership-card'>
        <div class='membership-header'>
          <div class='membership-name'>
            <strong>{{if
                @model.membershipProgram
                @model.membershipProgram
                'Membership Program'
              }}</strong>
            <div class='membership-badges'>
              {{#if @model.statusLevel}}
                <span class='status-badge'>{{@model.statusLevel}} Status</span>
              {{/if}}
              {{#if @model.minSpend}}
                <span class='minspend-badge'>min spend:
                  {{formatCurrency
                    @model.minSpend
                    currency='USD'
                    minimumFractionDigits=0
                    maximumFractionDigits=0
                  }}</span>
              {{/if}}
            </div>
          </div>

          <div class='enrollment-info'>
            {{#if @model.autoEnrollment}}
              <span class='auto-badge'>Auto-enrolled</span>
            {{else if @model.enrollmentRequired}}
              <span class='manual-badge'>Enrollment required</span>
            {{/if}}
          </div>
        </div>

        <div class='membership-details'>
          {{#if @model.partner}}
            <span class='partner'>{{@model.partner}}</span>
          {{/if}}
        </div>

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
          <div class='enrollment-instructions'>
            {{@model.enrollmentInstructions}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .membership-card {
          padding: 1rem;
          border: 2px solid var(--border, oklch(0.3 0 0));
          border-radius: var(--radius);
          background: var(--surface, oklch(0.98 0 0));
          color: var(--foreground, oklch(0.15 0 0));
          font-size: 0.8125rem;
          line-height: 1.4;
          backdrop-filter: blur(8px);
          box-shadow: var(--shadow-card);
        }

        .membership-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .membership-name {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          flex: 1;
        }

        .membership-name strong {
          font-weight: 600;
          color: var(--primary, oklch(0.88 0 0));
          font-size: 0.875rem;
        }

        .membership-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .status-badge {
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          background: var(--background, oklch(0.08 0 0));
          color: var(--value-positive, oklch(0.7 0.15 140));
          border: 1px solid var(--value-positive, oklch(0.7 0.15 140));
          font-size: 0.6875rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .minspend-badge {
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          background: var(--background, oklch(0.08 0 0));
          color: var(--ring, oklch(0.6 0.12 240));
          border: 1px solid var(--ring, oklch(0.6 0.12 240));
          font-size: 0.6875rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .enrollment-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .auto-badge {
          padding: 0.25rem 0.5rem;
          background: var(--background, oklch(0.08 0 0));
          border: 1px solid var(--ring, oklch(0.6 0.12 240));
          border-radius: 0.25rem;
          font-size: 0.6875rem;
          color: var(--ring, oklch(0.6 0.12 240));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .manual-badge {
          padding: 0.25rem 0.5rem;
          background: var(--background, oklch(0.08 0 0));
          border: 1px solid var(--gold-accent, oklch(0.75 0.15 65));
          border-radius: 0.25rem;
          font-size: 0.6875rem;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .membership-details {
          margin-bottom: 0.5rem;
        }

        .partner {
          color: #6b7280;
          font-style: italic;
        }

        .benefits-list {
          margin-bottom: 0.5rem;
        }

        .benefits-label {
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.25rem;
          font-size: 0.75rem;
        }

        .benefits-items {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .benefits-items li {
          padding: 0.125rem 0;
          font-size: 0.75rem;
          color: #6b7280;
          position: relative;
          padding-left: 0.75rem;
        }

        .benefits-items li::before {
          content: '•';
          color: #059669;
          position: absolute;
          left: 0;
        }

        .enrollment-instructions {
          font-size: 0.75rem;
          color: #6b7280;
          line-height: 1.3;
          border-top: 1px solid rgba(0, 0, 0, 0.05);
          padding-top: 0.5rem;
          margin-top: 0.5rem;
        }

        @media (max-width: 480px) {
          .membership-header {
            flex-direction: column;
            align-items: stretch;
          }

          .enrollment-info {
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    // ¹⁵⁶ Inline chip
    <template>
      <span>{{@model.membershipProgram}} — {{@model.statusLevel}}</span>
    </template>
  };
}

/**
 * EarningRuleField
 * Points earning rule separate from benefits (rates, caps, channels, conditions)
 */
export class EarningRuleField extends FieldDef {
  // ²¹ Points earning
  static displayName = 'Earning Rule';

  @field category = contains(StringField); // ²² e.g., 'Flights', 'Prepaid Hotels'
  @field rateMultiplier = contains(NumberField); // ²³ e.g., 5 for 5X
  @field appliesTo = contains(StringField); // ²⁴ Channel/constraint (e.g., 'Booked direct or via Amex Travel')
  @field capAmount = contains(NumberField); // ²⁵ Monetary cap (if any), in currency units
  @field capCurrency = contains(StringField); // ²⁶ e.g., 'USD'
  @field capPeriod = contains(TimePeriodField); // ²⁷ Structured cap period ¹⁵²
  @field conditions = contains(MarkdownField); // ²⁸ Additional notes/limitations

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁶⁵ Enhanced earning rule with clear rate and limits
    <template>
      <div class='earning-card'>
        <div class='earning-header'>
          <div class='earning-rate'>
            {{#if @model.rateMultiplier}}
              <span class='rate-multiplier'>{{@model.rateMultiplier}}X</span>
              <span class='points-label'>points</span>
            {{else}}
              <span class='rate-multiplier'>—</span>
            {{/if}}
          </div>

          {{#if @model.capAmount}}
            <div class='cap-info'>
              <span class='cap-label'>Cap:</span>
              <span class='cap-amount'>{{formatCurrency
                  @model.capAmount
                  currency='USD'
                  minimumFractionDigits=0
                  maximumFractionDigits=0
                }}</span>
              {{#if @model.capPeriod.unit}}
                <span class='cap-period'>per {{@model.capPeriod.unit}}</span>
              {{/if}}
            </div>
          {{/if}}
        </div>

        <div class='earning-details'>
          {{#if @model.category}}
            <span class='category-badge'>{{@model.category}}</span>
          {{/if}}

          {{#if @model.appliesTo}}
            <div class='applies-to'>{{@model.appliesTo}}</div>
          {{/if}}
        </div>

        {{#if @model.conditions}}
          <div class='conditions'>
            {{@model.conditions}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .earning-card {
          padding: 1rem;
          border: 2px solid var(--border, oklch(0.3 0 0));
          border-radius: var(--radius);
          background: var(--surface, oklch(0.98 0 0));
          color: var(--foreground, oklch(0.15 0 0));
          font-size: 0.8125rem;
          line-height: 1.4;
          backdrop-filter: blur(8px);
          box-shadow: var(--shadow-card);
        }

        .earning-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .earning-rate {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
        }

        .rate-multiplier {
          font-weight: 700;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-size: 1.125rem;
        }

        .points-label {
          color: var(--muted-foreground, oklch(0.7 0 0));
          font-size: 0.75rem;
        }

        .cap-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.125rem;
          text-align: right;
        }

        .cap-label {
          font-size: 0.6875rem;
          color: #dc2626;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .cap-amount {
          font-weight: 600;
          color: #dc2626;
          font-size: 0.875rem;
        }

        .cap-period {
          font-size: 0.6875rem;
          color: #6b7280;
        }

        .earning-details {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.5rem;
        }

        .category-badge {
          padding: 0.25rem 0.5rem;
          background: #f3f4f6;
          border-radius: 0.25rem;
          font-weight: 500;
          color: #374151;
          font-size: 0.75rem;
        }

        .applies-to {
          color: #6b7280;
          font-style: italic;
          flex: 1;
        }

        .conditions {
          font-size: 0.75rem;
          color: #6b7280;
          line-height: 1.3;
          border-top: 1px solid rgba(0, 0, 0, 0.05);
          padding-top: 0.5rem;
          margin-top: 0.5rem;
        }

        @media (max-width: 480px) {
          .earning-header {
            flex-direction: column;
            align-items: stretch;
          }

          .cap-info {
            align-items: flex-start;
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    // ¹⁶⁶ Inline rule
    <template>
      <span>{{@model.rateMultiplier}}X {{@model.category}}</span>
    </template>
  };
}

/**
 * SignupBonusField
 * Uniform model for welcome offers (points or statement credit)
 */
export class SignupBonusField extends FieldDef {
  // ²⁹ Signup bonus
  static displayName = 'Signup Bonus';

  @field bonusType = contains(StringField); // ³⁰ 'points' | 'statement-credit'
  @field pointsAmount = contains(NumberField); // ³¹ When bonusType='points'
  @field bonusCurrency = contains(StringField); // ³² e.g., 'Membership Rewards' OR 'USD' for credit
  @field spendRequirementAmount = contains(NumberField); // ³³ e.g., 8000
  @field spendRequirementCurrency = contains(StringField); // ³⁴ e.g., 'USD'
  @field spendWindowDays = contains(NumberField); // ³⁵ e.g., 180 (6 months)
  @field description = contains(MarkdownField); // ³⁶ Human description

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁶⁰ Enhanced signup bonus with clear offer and requirements
    <template>
      <div class='signup-card'>
        <div class='signup-header'>
          <div class='bonus-offer'>
            {{#if @model.pointsAmount}}
              <span class='bonus-amount'>{{formatNumber
                  @model.pointsAmount
                  minimumFractionDigits=0
                  maximumFractionDigits=0
                }}</span>
              <span class='bonus-currency'>{{if
                  @model.bonusCurrency
                  @model.bonusCurrency
                  'points'
                }}</span>
            {{else if @model.bonusCurrency}}
              <span class='bonus-amount'>{{@model.bonusCurrency}}</span>
              <span class='bonus-currency'>credit</span>
            {{else}}
              <span class='bonus-amount'>Welcome</span>
              <span class='bonus-currency'>bonus</span>
            {{/if}}
          </div>

          {{#if @model.spendRequirementAmount}}
            <div class='requirement-info'>
              <div class='spend-requirement'>
                <span class='spend-label'>Spend:</span>
                <span class='spend-amount'>{{formatCurrency
                    @model.spendRequirementAmount
                    currency='USD'
                    minimumFractionDigits=0
                    maximumFractionDigits=0
                  }}</span>
              </div>
              {{#if @model.spendWindowDays}}
                <div class='time-window'>
                  <span class='window-amount'>{{@model.spendWindowDays}}</span>
                  <span class='window-unit'>days</span>
                </div>
              {{/if}}
            </div>
          {{/if}}
        </div>

        {{#if @model.description}}
          <div class='description'>
            {{@model.description}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .signup-card {
          padding: 1rem;
          border: 2px solid var(--gold-accent, oklch(0.75 0.15 65));
          border-radius: var(--radius);
          background: var(--surface, oklch(0.98 0 0));
          color: var(--foreground, oklch(0.15 0 0));
          font-size: 0.8125rem;
          line-height: 1.4;
          backdrop-filter: blur(8px);
          box-shadow: var(--shadow-card);
        }

        .signup-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .bonus-offer {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .bonus-amount {
          font-weight: 700;
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-size: 1.25rem;
          line-height: 1;
        }

        .bonus-currency {
          color: var(--gold-accent, oklch(0.75 0.15 65));
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .requirement-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.25rem;
          text-align: right;
        }

        .spend-requirement {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .spend-label {
          font-size: 0.6875rem;
          color: #92400e;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .spend-amount {
          font-weight: 600;
          color: #92400e;
          font-size: 0.875rem;
        }

        .time-window {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
          padding: 0.125rem 0.375rem;
          background: rgba(146, 64, 14, 0.1);
          border-radius: 0.25rem;
        }

        .window-amount {
          font-weight: 600;
          color: #92400e;
          font-size: 0.75rem;
        }

        .window-unit {
          font-size: 0.6875rem;
          color: #92400e;
        }

        .description {
          font-size: 0.75rem;
          color: #6b7280;
          line-height: 1.3;
          border-top: 1px solid rgba(146, 64, 14, 0.2);
          padding-top: 0.5rem;
          margin-top: 0.5rem;
        }

        @media (max-width: 480px) {
          .signup-header {
            flex-direction: column;
            align-items: stretch;
          }

          .requirement-info {
            align-items: flex-start;
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    // ¹⁶¹ Inline
    <template>
      <span>{{if
          @model.pointsAmount
          (concat @model.pointsAmount ' ' @model.bonusCurrency)
          (if
            @model.bonusCurrency
            (concat @model.bonusCurrency ' credit')
            'Signup Bonus'
          )
        }}</span>
    </template>
  };
}

/**
 * OtherBenefitField
 * For unique benefits that don't fit standard categories (like points back features)
 */
export class OtherBenefitField extends FieldDef {
  static displayName = 'Other Benefit';

  @field name = contains(StringField); // e.g., "35% Points Back on Flights"
  @field benefitType = contains(StringField); // e.g., "Points Back", "Bonus Multiplier", "Special Feature"
  @field description = contains(MarkdownField); // Full description with terms
  @field conditions = contains(MarkdownField); // Specific terms and limitations
  @field maxValue = contains(NumberField); // e.g., 1000000 for "up to 1M points back"
  @field maxValueUnit = contains(StringField); // e.g., "points", "USD"
  @field timePeriod = contains(TimePeriodField); // When applicable

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='other-benefit-card'>
        <div class='other-benefit-header'>
          <div class='benefit-name'>
            <strong>{{if @model.name @model.name 'Special Benefit'}}</strong>
            {{#if @model.benefitType}}
              <span class='benefit-type-badge'>{{@model.benefitType}}</span>
            {{/if}}
          </div>

          {{#if @model.maxValue}}
            <div class='max-value-info'>
              <span class='max-label'>Up to:</span>
              <span class='max-amount'>
                {{#if (eq @model.maxValueUnit 'points')}}
                  {{formatNumber
                    @model.maxValue
                    minimumFractionDigits=0
                    maximumFractionDigits=0
                  }}
                {{else}}
                  {{formatCurrency
                    @model.maxValue
                    currency='USD'
                    minimumFractionDigits=0
                    maximumFractionDigits=0
                  }}
                {{/if}}
              </span>
              <span class='max-unit'>{{@model.maxValueUnit}}</span>
              {{#if @model.timePeriod.unit}}
                <span class='max-period'>per {{@model.timePeriod.unit}}</span>
              {{/if}}
            </div>
          {{/if}}
        </div>

        {{#if @model.description}}
          <div class='benefit-description'>
            {{@model.description}}
          </div>
        {{/if}}

        {{#if @model.conditions}}
          <div class='benefit-conditions'>
            {{@model.conditions}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .other-benefit-card {
          padding: 1rem;
          border: 2px solid var(--ring, oklch(0.6 0.12 240));
          border-radius: var(--radius);
          background: var(--surface, oklch(0.98 0 0));
          color: var(--foreground, oklch(0.15 0 0));
          font-size: 0.8125rem;
          line-height: 1.4;
          backdrop-filter: blur(8px);
          box-shadow: var(--shadow-card);
        }

        .other-benefit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .benefit-name {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          flex: 1;
        }

        .benefit-name strong {
          font-weight: 600;
          color: var(--primary, oklch(0.88 0 0));
          font-size: 0.875rem;
        }

        .benefit-type-badge {
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          background: var(--background, oklch(0.08 0 0));
          color: var(--ring, oklch(0.6 0.12 240));
          border: 1px solid var(--ring, oklch(0.6 0.12 240));
          font-size: 0.6875rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          align-self: flex-start;
        }

        .max-value-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.125rem;
          text-align: right;
        }

        .max-label {
          font-size: 0.6875rem;
          color: #0369a1;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .max-amount {
          font-weight: 700;
          color: #0369a1;
          font-size: 1rem;
        }

        .max-unit {
          color: #0369a1;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .max-period {
          font-size: 0.6875rem;
          color: #6b7280;
        }

        .benefit-description {
          font-size: 0.75rem;
          color: #374151;
          line-height: 1.3;
          margin-bottom: 0.5rem;
        }

        .benefit-conditions {
          font-size: 0.75rem;
          color: #6b7280;
          line-height: 1.3;
          border-top: 1px solid rgba(3, 105, 161, 0.2);
          padding-top: 0.5rem;
          margin-top: 0.5rem;
        }

        @media (max-width: 480px) {
          .other-benefit-header {
            flex-direction: column;
            align-items: stretch;
          }

          .max-value-info {
            align-items: flex-start;
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span>{{@model.name}}</span>
    </template>
  };
}

/**
 * RewardCardProgram
 * Uniform schema for credit/charge card programs across issuers
 */
export class RewardCardProgram extends CardDef {
  // ³⁷ Card definition
  static displayName = 'Reward Card Program';

  // Core identifiers
  @field cardName = contains(StringField); // ³⁸ e.g., 'The Platinum Card from American Express'
  @field issuer = contains(StringField); // ³⁹ e.g., 'American Express'
  @field network = contains(StringField); // ⁴⁰ e.g., 'American Express', 'Visa', 'Mastercard'
  @field businessOrPersonal = contains(StringField); // ⁴¹ 'personal' | 'business' | 'both'

  // Economics
  @field annualFee = contains(NumberField); // ⁴² e.g., 695
  @field annualFeeCurrency = contains(StringField); // ⁴³ e.g., 'USD'

  // Program dates
  @field programStartDate = contains(DateField); // ⁴⁴ ISO date
  @field programEndDate = contains(DateField); // ⁴⁵ Optional sunset

  // Welcome offer
  @field signupBonus = contains(SignupBonusField); // ⁴⁶ Nested welcome offer

  // Ongoing value
  @field statementBenefits = containsMany(BenefitField); // ⁴⁷ Statement/travel credits and general benefits
  @field membershipBenefits = containsMany(MembershipBenefitField); // ⁴⁸ Elite statuses/automatic memberships
  @field earningRules = containsMany(EarningRuleField); // ⁴⁹ Points earning matrix
  @field otherBenefits = containsMany(OtherBenefitField); // ⁵⁰ Special benefits that don't fit standard categories

  // Optional summary/notes
  @field notes = contains(MarkdownField); // ⁵¹ Freeform notes for the program

  @field amexLogoUrl = contains(UrlField); // URL for Amex logo overlay

  // Override inherited title for consistent listing
  @field title = contains(StringField, {
    // ⁵¹ Safe computed title
    computeVia: function (this: RewardCardProgram) {
      try {
        return this.cardName ?? 'Unnamed Program';
      } catch {
        return 'Unnamed Program';
      }
    },
  });

  // ⁵² Award-winning isolated format: Premium Financial Command Center
  static isolated = class Isolated extends Component<typeof this> {
    get totalAnnualValue() {
      try {
        const benefits = this.args.model?.statementBenefits ?? [];
        return benefits.reduce((total, benefit) => {
          const annualValue = benefit.annualizedValue;
          return annualValue ? total + annualValue : total;
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
      {{! ⁵³ Premium stage with dark luxury foundation }}
      <div class='platinum-stage'>
        <div class='command-center'>

          {{! ⁵⁴ Executive header with prominent card showcase }}
          <header class='executive-header'>
            {{! ⁵³ᵃ American Express logo overlay at top }}
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

                {{#if @model.brandLogo.logoUrl}}
                  <div class='brand-logo-display'>
                    <@fields.brandLogo @format='embedded' />
                  </div>
                {{/if}}
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

            {{! ⁵⁴ᵃ Physical card showcase with premium presentation - now top left }}
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

            {{! ⁵⁵ Strategic metrics panel }}
            <div class='metrics-panel'>
              {{#if @model.signupBonus}}
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

          {{! ⁵⁶ Swiss-organized content sections }}
          <main class='content-grid'>

            {{! ⁵⁷ Welcome offer prominence }}
            {{#if @model.signupBonus}}
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

            {{! ⁵⁸ Statement benefits matrix }}
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

            {{! ⁵⁹ Earning structure }}
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

            {{! ⁶⁰ Elite memberships }}
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

            {{! ⁶¹ Additional premium features }}
            {{#if (gt @model.otherBenefits.length 0)}}
              <section class='premium-section'>
                <h2 class='section-title'>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polygon points='13,2 3,14 12,14 11,22 21,10 12,10 13,2' />
                  </svg>
                  Premium Features
                </h2>
                <div class='premium-grid'>
                  <@fields.otherBenefits @format='embedded' />
                </div>
              </section>
            {{/if}}

            {{! ⁶² Program intelligence }}
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
        /* ⁶³ Pentagram-level typographic foundation with mathematical precision */
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

        /* ⁶⁴ Executive header with platinum authority and card showcase */
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

        /* ⁶³ᵃ Top American Express logo styling */
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

        /* ⁶⁴ᵃ Premium card showcase - compact integration with header */
        .card-showcase {
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
          margin-bottom: 0;
        }

        .card-frame {
          border-radius: var(--radius);
          overflow: hidden;
          background: linear-gradient(
            135deg,
            var(--platinum-shimmer, oklch(0.92 0 0)) 0%,
            var(--gold-accent, oklch(0.75 0.15 65)) 100%
          );
          padding: 0.125rem;
          position: relative;
        }

        .card-image {
          width: 280px;
          height: auto;
          max-height: 175px;
          object-fit: cover;
          border-radius: calc(var(--radius) * 0.75);
          display: block;
          filter: contrast(1.1) saturate(1.1);
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

        /* Brand logo display */
        .brand-logo-display {
          margin-top: 0.75rem;
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .brand-logo-display img {
          max-width: 120px;
          max-height: 40px;
          height: auto;
          width: auto;
        }

        @media (min-width: 800px) and (max-width: 1000px) {
          .brand-logo-display img {
            max-width: 100px;
            max-height: 32px;
          }
        }

        /* ⁶⁵ Fee structure with value intelligence */
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

        /* ⁶⁶ Strategic metrics panel */
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

        /* ⁶⁷ Pentagram editorial layout with mathematical spacing */
        .content-grid {
          display: flex;
          flex-direction: column;
          gap: 6.472rem; /* Golden ratio progression: 4 * 1.618 */
        }

        .welcome-section,
        .benefits-section,
        .earning-section,
        .membership-section,
        .premium-section,
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
        .premium-section::before,
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

        /* ⁶⁸ Pentagram-inspired section typography with editorial precision */
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

        /* ⁶⁹ Collection layouts with proper spacing */
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

        .premium-grid > .containsMany-field {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
          gap: 1.5rem;
        }

        .intelligence-content {
          font-size: 0.9375rem;
          line-height: 1.6;
          color: var(--muted-foreground, oklch(0.7 0 0));
        }

        /* ⁷⁰ Responsive luxury experience */
        @media (max-width: 1024px) {
          .command-center {
            padding: 2rem 1.5rem;
          }

          .brand-signature {
            flex-direction: column;
            gap: 2rem;
          }

          .card-frame {
            padding: 0.0625rem;
          }

          .card-image {
            width: 240px;
            max-height: 150px;
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

          .premium-grid > .containsMany-field {
            grid-template-columns: 1fr;
          }
        }

        /* ⁷⁰ᵃ Optimized layout for 800px screens */
        @media (min-width: 800px) and (max-width: 1000px) {
          .command-center {
            padding: 1.5rem 2rem;
            max-width: 90rem;
          }

          .card-title {
            font-size: 2.5rem;
            line-height: 1;
          }

          .content-grid {
            gap: 4rem;
          }

          .welcome-section,
          .benefits-section,
          .earning-section,
          .membership-section,
          .premium-section,
          .intelligence-section {
            padding: 2.5rem 2rem;
          }

          .section-title {
            font-size: 1.375rem;
            margin-bottom: 2rem;
          }

          .benefits-grid > .containsMany-field {
            grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
            gap: 1.25rem;
          }

          .membership-collection > .containsMany-field {
            grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
            gap: 1.25rem;
          }

          .premium-grid > .containsMany-field {
            grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
            gap: 1.25rem;
          }

          .metrics-panel {
            flex-direction: row;
            gap: 1rem;
          }

          .welcome-metric,
          .earning-metric,
          .benefits-metric {
            min-width: 7rem;
            padding: 0.75rem 1rem;
          }

          .metric-value {
            font-size: 1.5rem;
          }

          .fee-structure {
            gap: 1.5rem;
          }

          .card-image {
            width: 220px;
            max-height: 140px;
          }
        }

        @media (max-width: 640px) {
          .command-center {
            padding: 1.5rem 1rem;
          }

          .card-image {
            width: 200px;
            max-height: 125px;
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
          .premium-section,
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

        /* ⁷¹ Premium hover states and micro-interactions */
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

        /* ⁷² Swiss precision spacing system */
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
