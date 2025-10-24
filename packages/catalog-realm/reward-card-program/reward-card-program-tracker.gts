import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { RewardCardProgram, Benefit } from './reward-card-program';
import { gt, eq, and, or } from '@cardstack/boxel-ui/helpers';
import { formatDateTime, formatCurrency } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { ProgressRadial, FieldContainer } from '@cardstack/boxel-ui/components';

class BenefitUsageTrackingEmbedded extends Component<
  typeof BenefitUsageTracking
> {
  @tracked showDetails = false;

  toggleDetails = () => {
    this.showDetails = !this.showDetails;
  };

  get timePeriodUnit() {
    return this.args.model?.benefit?.timePeriod?.unit ?? 'quarter';
  }

  get timePeriodCount() {
    return this.args.model?.benefit?.timePeriod?.count ?? 1;
  }

  updateUsage = (quarter: string, event: Event) => {
    if (this.args.model) {
      const checked = (event.target as HTMLInputElement).checked;
      switch (quarter) {
        case 'Q1':
          this.args.model.usedQ1 = checked;
          break;
        case 'Q2':
          this.args.model.usedQ2 = checked;
          break;
        case 'Q3':
          this.args.model.usedQ3 = checked;
          break;
        case 'Q4':
          this.args.model.usedQ4 = checked;
          break;
      }
    }
  };

  updateMonthlyUsage = (month: string, event: Event) => {
    if (this.args.model) {
      const checked = (event.target as HTMLInputElement).checked;
      switch (month) {
        case 'Jan':
          this.args.model.usedJan = checked;
          break;
        case 'Feb':
          this.args.model.usedFeb = checked;
          break;
        case 'Mar':
          this.args.model.usedMar = checked;
          break;
        case 'Apr':
          this.args.model.usedApr = checked;
          break;
        case 'May':
          this.args.model.usedMay = checked;
          break;
        case 'Jun':
          this.args.model.usedJun = checked;
          break;
        case 'Jul':
          this.args.model.usedJul = checked;
          break;
        case 'Aug':
          this.args.model.usedAug = checked;
          break;
        case 'Sep':
          this.args.model.usedSep = checked;
          break;
        case 'Oct':
          this.args.model.usedOct = checked;
          break;
        case 'Nov':
          this.args.model.usedNov = checked;
          break;
        case 'Dec':
          this.args.model.usedDec = checked;
          break;
      }
    }
  };

  updateYearlyUsage = (event: Event) => {
    if (this.args.model) {
      const checked = (event.target as HTMLInputElement).checked;
      this.args.model.usedAnnually = checked;
    }
  };

  updateHalfYearUsage = (half: string, event: Event) => {
    if (this.args.model) {
      const checked = (event.target as HTMLInputElement).checked;
      if (half === 'first') {
        this.args.model.usedFirstHalf = checked;
      } else {
        this.args.model.usedSecondHalf = checked;
      }
    }
  };

  get maxPeriods() {
    const unit = this.timePeriodUnit;
    const count = this.timePeriodCount;

    // Check 6-month special case first!
    if (unit === 'month' && count === 6) return 2;
    switch (unit) {
      case 'month':
        return 12;
      case 'quarter':
        return 4;
      case 'half-year':
        return 2;
      case 'year':
        return 1;
      default:
        return 4;
    }
  }

  get usageCount() {
    const unit = this.timePeriodUnit;
    const count = this.timePeriodCount;

    if (unit === 'year') {
      return this.args.model?.usedAnnually ? 1 : 0;
    } else if (unit === 'month') {
      const monthsUsed = [
        this.args.model?.usedJan,
        this.args.model?.usedFeb,
        this.args.model?.usedMar,
        this.args.model?.usedApr,
        this.args.model?.usedMay,
        this.args.model?.usedJun,
        this.args.model?.usedJul,
        this.args.model?.usedAug,
        this.args.model?.usedSep,
        this.args.model?.usedOct,
        this.args.model?.usedNov,
        this.args.model?.usedDec,
      ].filter(Boolean).length;
      return monthsUsed;
    } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
      const halfYearsUsed = [
        this.args.model?.usedFirstHalf,
        this.args.model?.usedSecondHalf,
      ].filter(Boolean).length;
      return halfYearsUsed;
    } else {
      const quartersUsed = [
        this.args.model?.usedQ1,
        this.args.model?.usedQ2,
        this.args.model?.usedQ3,
        this.args.model?.usedQ4,
      ].filter(Boolean).length;
      return quartersUsed;
    }
  }

  get usagePercentage() {
    return (this.usageCount / this.maxPeriods) * 100;
  }

  get progressClass() {
    let pct = Math.round(this.usagePercentage / 10) * 10;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return `progress-${pct}`;
  }

  get usageText() {
    const unit = this.timePeriodUnit;
    const count = this.timePeriodCount;

    if (unit === 'month' && count === 6) {
      return `${this.usageCount}/2 periods used`;
    } else if (unit === 'year') {
      return this.usageCount > 0 ? 'Used this year' : 'Not used yet';
    } else if (unit === 'month') {
      return `${this.usageCount}/12 months used`;
    } else if (unit === 'half-year') {
      return `${this.usageCount}/2 periods used`;
    } else {
      return `${this.usageCount}/4 quarters used`;
    }
  }

  get usedValue() {
    const amount = this.args.model?.benefit?.amount?.amount ?? 0;
    const unit = this.timePeriodUnit;
    const count = this.timePeriodCount;

    if (unit === 'year') {
      return this.args.model?.usedAnnually ? amount : 0;
    } else if (unit === 'month' && count === 6) {
      // 6-month special case handled elsewhere
      const halfYearsUsed = this.usageCount;
      const isAnnualValue = amount >= 100;
      const halfYearlyValue = isAnnualValue ? amount / 2 : amount;
      return Math.round(halfYearlyValue * halfYearsUsed);
    } else if (unit === 'month') {
      const monthsUsed = this.usageCount;
      const isAnnualValue = amount >= 50;
      const monthlyValue = isAnnualValue ? amount / 12 : amount;
      return Math.round(monthlyValue * monthsUsed);
    } else if (unit === 'half-year') {
      const halfYearsUsed = this.usageCount;
      const isAnnualValue = amount >= 100;
      const halfYearlyValue = isAnnualValue ? amount / 2 : amount;
      return Math.round(halfYearlyValue * halfYearsUsed);
    } else {
      const quartersUsed = this.usageCount;
      const isAnnualValue = amount >= 100;
      const quarterlyValue = isAnnualValue ? amount / 4 : amount;
      return Math.round(quarterlyValue * quartersUsed);
    }
  }

  get totalPossibleValue() {
    const amount = this.args.model?.benefit?.amount?.amount ?? 0;
    const unit = this.timePeriodUnit;
    const count = this.timePeriodCount;

    if (unit === 'year') {
      return amount;
    } else if (unit === 'month' && count === 6) {
      const isAnnualValue = amount >= 100;
      return isAnnualValue ? amount : amount * 2;
    } else if (unit === 'month') {
      const isAnnualValue = amount >= 50;
      return isAnnualValue ? amount : amount * 12;
    } else if (unit === 'half-year') {
      const isAnnualValue = amount >= 100;
      return isAnnualValue ? amount : amount * 2;
    } else {
      const isAnnualValue = amount >= 100;
      return isAnnualValue ? amount : amount * 4;
    }
  }

  get valueText() {
    return `$${this.usedValue} of $${this.totalPossibleValue} value redeemed`;
  }

  <template>
    <div class='benefit-usage-tracking'>
      <div class='tracking-header'>
        <div class='benefit-info'>
          <h4 class='benefit-name'>
            {{if @model.benefit.name @model.benefit.name 'Unknown Benefit'}}
          </h4>
          <div class='benefit-value'>
            {{#if @model.benefit.amount.amount}}
              <span class='benefit-amount'>
                {{formatCurrency
                  @model.benefit.amount.amount
                  currency=(if
                    @model.benefit.amount.currency.code
                    @model.benefit.amount.currency.code
                    'USD'
                  )
                  size='short'
                }}
                total value
              </span>
            {{/if}}
            <span class='value-breakdown'>{{this.valueText}}</span>
          </div>
        </div>

        <div class='usage-summary'>
          <div class='usage-progress'>
            <div class='progress-bar'>
              <div class='progress-fill {{this.progressClass}}'></div>
            </div>
            <span class='usage-text'>{{this.usageText}}</span>
          </div>
          <button
            type='button'
            class='expand-button'
            aria-label='Toggle details'
            aria-expanded='{{this.showDetails}}'
            {{on 'click' this.toggleDetails}}
          >
            <svg
              class='expand-icon {{if this.showDetails "expanded"}}'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='6,9 12,15 18,9'></polyline>
            </svg>
          </button>
        </div>
      </div>

      {{#if this.showDetails}}
        <div class='tracking-details'>
          {{#if (eq this.timePeriodUnit 'year')}}
            <div class='yearly-usage {{if @model.usedAnnually "used"}}'>
              <label class='yearly-label'>
                <input
                  type='checkbox'
                  checked={{@model.usedAnnually}}
                  {{on 'change' this.updateYearlyUsage}}
                  class='yearly-checkbox'
                />
                <span class='yearly-text'>Used in 2025</span>
                <span class='yearly-note'>Annual benefit - can be used once per
                  year</span>
              </label>
            </div>
          {{else if (eq this.timePeriodUnit 'month')}}
            <div class='monthly-grid'>
              <div class='month-item {{if @model.usedJan "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedJan}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Jan')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>January</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedFeb "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedFeb}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Feb')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>February</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedMar "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedMar}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Mar')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>March</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedApr "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedApr}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Apr')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>April</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedMay "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedMay}}
                    {{on 'change' (fn this.updateMonthlyUsage 'May')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>May</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedJun "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedJun}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Jun')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>June</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedJul "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedJul}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Jul')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>July</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedAug "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedAug}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Aug')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>August</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedSep "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedSep}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Sep')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>September</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedOct "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedOct}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Oct')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>October</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedNov "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedNov}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Nov')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>November</span>
                </label>
              </div>
              <div class='month-item {{if @model.usedDec "used"}}'>
                <label class='month-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedDec}}
                    {{on 'change' (fn this.updateMonthlyUsage 'Dec')}}
                    class='month-checkbox'
                  />
                  <span class='month-text'>December</span>
                </label>
              </div>
            </div>
          {{else if
            (or
              (eq this.timePeriodUnit 'half-year')
              (and (eq this.timePeriodUnit 'month') (eq this.timePeriodCount 6))
            )
          }}
            <div class='half-year-grid'>
              <div class='half-year-period {{if @model.usedFirstHalf "used"}}'>
                <label class='half-year-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedFirstHalf}}
                    {{on 'change' (fn this.updateHalfYearUsage 'first')}}
                    class='half-year-checkbox'
                  />
                  <span class='half-year-text'>First Half (Jan - Jun)</span>
                  <span class='half-year-period'>{{if
                      @model.usedFirstHalf
                      '6 months used'
                      '6 months available'
                    }}</span>
                </label>
              </div>

              <div class='half-year-period {{if @model.usedSecondHalf "used"}}'>
                <label class='half-year-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedSecondHalf}}
                    {{on 'change' (fn this.updateHalfYearUsage 'second')}}
                    class='half-year-checkbox'
                  />
                  <span class='half-year-text'>Second Half (Jul - Dec)</span>
                  <span class='half-year-period'>{{if
                      @model.usedSecondHalf
                      '6 months used'
                      '6 months available'
                    }}</span>
                </label>
              </div>
            </div>
          {{else}}
            <div class='quarters-grid'>
              <div class='quarter-item'>
                <label class='quarter-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedQ1}}
                    {{on 'change' (fn this.updateUsage 'Q1')}}
                    class='quarter-checkbox'
                  />
                  <span class='quarter-text'>Q1 2025</span>
                  <span class='quarter-period'>Jan - Mar</span>
                </label>
              </div>

              <div class='quarter-item'>
                <label class='quarter-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedQ2}}
                    {{on 'change' (fn this.updateUsage 'Q2')}}
                    class='quarter-checkbox'
                  />
                  <span class='quarter-text'>Q2 2025</span>
                  <span class='quarter-period'>Apr - Jun</span>
                </label>
              </div>

              <div class='quarter-item'>
                <label class='quarter-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedQ3}}
                    {{on 'change' (fn this.updateUsage 'Q3')}}
                    class='quarter-checkbox'
                  />
                  <span class='quarter-text'>Q3 2025</span>
                  <span class='quarter-period'>Jul - Sep</span>
                </label>
              </div>

              <div class='quarter-item'>
                <label class='quarter-label'>
                  <input
                    type='checkbox'
                    checked={{@model.usedQ4}}
                    {{on 'change' (fn this.updateUsage 'Q4')}}
                    class='quarter-checkbox'
                  />
                  <span class='quarter-text'>Q4 2025</span>
                  <span class='quarter-period'>Oct - Dec</span>
                </label>
              </div>
            </div>
          {{/if}}

          {{#if @model.lastUsedDate}}
            <div class='last-used'>
              <span class='last-used-label'>Last used:</span>
              <span class='last-used-date'>{{formatDateTime
                  @model.lastUsedDate
                  size='medium'
                }}</span>
            </div>
          {{/if}}

          {{#if @model.notes}}
            <div class='usage-notes'>
              <@fields.notes />
            </div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .benefit-usage-tracking {
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, var(--boxel-radius));
        background: var(--card, var(--boxel-light));
        overflow: hidden;
        transition: all 0.3s ease;
        box-shadow: var(--shadow, var(--boxel-box-shadow));
      }

      .benefit-usage-tracking:hover {
        border-color: var(--primary, var(--boxel-dark));
        box-shadow: var(--shadow-md, var(--boxel-box-shadow-lg));
        transform: translateY(-1px);
      }

      .tracking-header {
        padding: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        background: var(--secondary, var(--boxel-50));
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }

      .benefit-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1;
      }

      .benefit-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, var(--boxel-dark));
        margin: 0;
        line-height: 1.3;
        font-family: var(--font-serif, var(--boxel-font-family));
        letter-spacing: var(--tracking-normal, var(--boxel-lsp));
      }

      .benefit-value {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, var(--boxel-sp-xs)) * 0.5);
      }

      .benefit-amount {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-dark));
        font-weight: 500;
        font-family: var(--font-sans, var(--boxel-font-family));
      }

      .value-breakdown {
        font-size: 0.75rem;
        color: var(--primary, var(--boxel-500));
        font-weight: 600;
        font-family: var(--font-sans, var(--boxel-font-family));
      }

      .usage-summary {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .usage-progress {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        align-items: flex-end;
      }

      .progress-bar {
        width: 60px;
        height: 4px;
        background: var(--muted, var(--boxel-50));
        border-radius: calc(var(--radius, var(--boxel-radius)) * 0.5);
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary, var(--boxel-dark));
        transition: width 0.3s ease;
        border-radius: calc(var(--radius, var(--boxel-radius)) * 0.5);
      }

      /* Progress width utility classes (10% increments) */
      .progress-0 {
        width: 0%;
      }
      .progress-10 {
        width: 10%;
      }
      .progress-20 {
        width: 20%;
      }
      .progress-30 {
        width: 30%;
      }
      .progress-40 {
        width: 40%;
      }
      .progress-50 {
        width: 50%;
      }
      .progress-60 {
        width: 60%;
      }
      .progress-70 {
        width: 70%;
      }
      .progress-80 {
        width: 80%;
      }
      .progress-90 {
        width: 90%;
      }
      .progress-100 {
        width: 100%;
      }

      .usage-text {
        font-size: 0.6875rem;
        color: var(--muted-foreground, var(--boxel-dark));
        font-weight: 500;
        font-family: var(--font-sans, var(--boxel-font-family));
      }

      .expand-icon {
        width: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        height: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        color: var(--muted-foreground, var(--boxel-dark));
        transition: transform 0.3s ease;
      }

      .expand-icon.expanded {
        transform: rotate(180deg);
      }

      .expand-button {
        border: 0;
        background: none;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .tracking-details {
        padding: 1rem;
        background: var(--card, var(--boxel-light));
      }

      .quarters-grid,
      .half-year-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .monthly-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .yearly-usage {
        border-radius: 6px;
      }

      .yearly-label {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        border-radius: 8px;
        background: var(--accent, var(--boxel-light-100));
        cursor: pointer;
        user-select: none;
        transition: all 0.2s ease;
      }

      .yearly-checkbox {
        width: 1.25rem;
        height: 1.25rem;
        margin-bottom: 0.5rem;
        accent-color: var(--primary, var(--boxel-dark));
      }

      .yearly-text {
        font-size: 1rem;
        font-weight: 600;
        color: inherit;
      }

      .yearly-note {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-dark));
        font-style: italic;
      }

      .month-item {
        padding: 0.75rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: 6px;
        background: var(--muted, var(--boxel-50));
        transition: all 0.2s ease;
      }

      .month-label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        cursor: pointer;
        user-select: none;
      }

      .month-checkbox {
        width: 1rem;
        height: 1rem;
        margin-bottom: 0.25rem;
        accent-color: var(--primary, var(--boxel-dark));
      }

      .month-text {
        font-size: 0.8125rem;
        font-weight: 600;
        color: inherit;
      }

      .quarter-item {
        padding: 0.75rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: 6px;
        background: var(--muted, var(--boxel-50));
        transition: all 0.2s ease;
      }

      .half-year-period {
        padding: 0.75rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: 6px;
        background: var(--muted, var(--boxel-50));
        transition: all 0.2s ease;
      }

      .yearly-usage.used,
      .half-year-period.used,
      .month-item.used,
      .quarter-item.used {
        border: 2px solid var(--primary, var(--boxel-dark));
      }

      .half-year-label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        cursor: pointer;
        user-select: none;
      }

      .half-year-checkbox {
        width: 1rem;
        height: 1rem;
        margin-bottom: 0.25rem;
        accent-color: var(--primary, var(--boxel-dark));
      }

      .half-year-text {
        font-size: 0.8125rem;
        font-weight: 600;
        color: inherit;
      }

      .quarter-label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        cursor: pointer;
        user-select: none;
      }

      .quarter-checkbox {
        width: 1rem;
        height: 1rem;
        margin-bottom: 0.25rem;
        accent-color: var(--primary, var(--boxel-dark));
      }

      .quarter-text {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--foreground, var(--boxel-dark));
      }

      .quarter-period {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-dark));
      }

      .last-used {
        padding: 0.75rem;
        background: var(--accent, var(--boxel-light-100));
        border-radius: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .last-used-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-dark));
        font-weight: 500;
      }

      .last-used-date {
        font-size: 0.75rem;
        color: var(--foreground, var(--boxel-dark));
        font-weight: 600;
      }

      .usage-notes {
        padding: 0.75rem;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: 6px;
        background: var(--muted, var(--boxel-50));
        font-size: 0.8125rem;
        line-height: 1.4;
      }

      @media (max-width: 640px) {
        .quarters-grid,
        .half-year-grid {
          grid-template-columns: 1fr;
        }

        .monthly-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .tracking-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .usage-summary {
          align-self: stretch;
          justify-content: space-between;
        }
      }
    </style>
  </template>
}

class BenefitUsageTrackingEdit extends Component<typeof BenefitUsageTracking> {
  <template>
    <div class='benefit-usage-tracking-edit'>
      <FieldContainer @label='Benefit'>
        <@fields.benefit />
      </FieldContainer>
      <FieldContainer @label='Title'>
        <@fields.title />
      </FieldContainer>
      <FieldContainer @label='Last Used Date'>
        <@fields.lastUsedDate />
      </FieldContainer>
      <FieldContainer @label='Notes'>
        <@fields.notes />
      </FieldContainer>

      {{#if @model.benefit}}
        {{#if (eq @model.benefit.timePeriod.unit 'year')}}
          <FieldContainer @label='Used Annually'>
            <@fields.usedAnnually />
          </FieldContainer>
        {{else if (eq @model.benefit.timePeriod.unit 'month')}}
          <FieldContainer @label='Used January'><@fields.usedJan
            /></FieldContainer>
          <FieldContainer @label='Used February'><@fields.usedFeb
            /></FieldContainer>
          <FieldContainer @label='Used March'><@fields.usedMar
            /></FieldContainer>
          <FieldContainer @label='Used April'><@fields.usedApr
            /></FieldContainer>
          <FieldContainer @label='Used May'><@fields.usedMay /></FieldContainer>
          <FieldContainer @label='Used June'><@fields.usedJun
            /></FieldContainer>
          <FieldContainer @label='Used July'><@fields.usedJul
            /></FieldContainer>
          <FieldContainer @label='Used August'><@fields.usedAug
            /></FieldContainer>
          <FieldContainer @label='Used September'><@fields.usedSep
            /></FieldContainer>
          <FieldContainer @label='Used October'><@fields.usedOct
            /></FieldContainer>
          <FieldContainer @label='Used November'><@fields.usedNov
            /></FieldContainer>
          <FieldContainer @label='Used December'><@fields.usedDec
            /></FieldContainer>
        {{else if
          (or
            (eq @model.benefit.timePeriod.unit 'half-year')
            (and
              (eq @model.benefit.timePeriod.unit 'month')
              (eq @model.benefit.timePeriod.count 6)
            )
          )
        }}
          <FieldContainer @label='Used First Half'>
            <@fields.usedFirstHalf />
          </FieldContainer>
          <FieldContainer @label='Used Second Half'>
            <@fields.usedSecondHalf />
          </FieldContainer>
        {{else}}
          <FieldContainer @label='Used Q1'><@fields.usedQ1 /></FieldContainer>
          <FieldContainer @label='Used Q2'><@fields.usedQ2 /></FieldContainer>
          <FieldContainer @label='Used Q3'><@fields.usedQ3 /></FieldContainer>
          <FieldContainer @label='Used Q4'><@fields.usedQ4 /></FieldContainer>
        {{/if}}
      {{/if}}
    </div>

    <style scoped>
      .benefit-usage-tracking-edit {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
    </style>
  </template>
}

export class BenefitUsageTracking extends FieldDef {
  static displayName = 'Benefit Usage Tracking';

  @field benefit = linksTo(Benefit);

  @field usedQ1 = contains(BooleanField);
  @field usedQ2 = contains(BooleanField);
  @field usedQ3 = contains(BooleanField);
  @field usedQ4 = contains(BooleanField);

  @field usedJan = contains(BooleanField);
  @field usedFeb = contains(BooleanField);
  @field usedMar = contains(BooleanField);
  @field usedApr = contains(BooleanField);
  @field usedMay = contains(BooleanField);
  @field usedJun = contains(BooleanField);
  @field usedJul = contains(BooleanField);
  @field usedAug = contains(BooleanField);
  @field usedSep = contains(BooleanField);
  @field usedOct = contains(BooleanField);
  @field usedNov = contains(BooleanField);
  @field usedDec = contains(BooleanField);

  @field usedFirstHalf = contains(BooleanField);
  @field usedSecondHalf = contains(BooleanField);
  @field usedAnnually = contains(BooleanField);

  @field lastUsedDate = contains(DateField);

  @field notes = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: BenefitUsageTracking) {
      try {
        return this.benefit?.name ?? 'Benefit Usage Tracking';
      } catch (e) {
        return 'Benefit Usage Tracking';
      }
    },
  });

  static embedded = BenefitUsageTrackingEmbedded;
  static edit = BenefitUsageTrackingEdit;
}

export class RewardCardProgramTracker extends CardDef {
  static displayName = 'Reward Card Program Tracker';

  @field cardholderName = contains(StringField);
  @field cardProgram = linksTo(RewardCardProgram);
  @field trackingYear = contains(StringField);
  @field benefitTrackings = containsMany(BenefitUsageTracking);

  @field notes = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: RewardCardProgramTracker) {
      try {
        const cardName = this.cardProgram?.cardName ?? 'Unknown Card';
        const year = this.trackingYear ?? '2025';
        return `${cardName} - ${year} Benefit Tracker`;
      } catch (e) {
        return 'Reward Card Program Tracker';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get trackings() {
      return this.args.model?.benefitTrackings ?? [];
    }

    timeUnit(tracking: any) {
      return tracking?.benefit?.timePeriod?.unit ?? 'quarter';
    }

    timeCount(tracking: any) {
      return tracking?.benefit?.timePeriod?.count ?? 1;
    }

    maxPeriods(tracking: any) {
      const unit = this.timeUnit(tracking);
      const count = this.timeCount(tracking);
      switch (unit) {
        case 'month':
          return 12;
        case 'quarter':
          return 4;
        case 'half-year':
          return 2;
        case 'year':
          return 1;
        default:
          if (count === 6 && unit === 'month') return 2;
          return 4;
      }
    }

    usageCount(tracking: any) {
      const unit = this.timeUnit(tracking);
      const count = this.timeCount(tracking);
      if (unit === 'year') {
        return tracking?.usedAnnually ? 1 : 0;
      } else if (unit === 'month') {
        const months = [
          tracking?.usedJan,
          tracking?.usedFeb,
          tracking?.usedMar,
          tracking?.usedApr,
          tracking?.usedMay,
          tracking?.usedJun,
          tracking?.usedJul,
          tracking?.usedAug,
          tracking?.usedSep,
          tracking?.usedOct,
          tracking?.usedNov,
          tracking?.usedDec,
        ];
        return months.filter(Boolean).length;
      } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        return [tracking?.usedFirstHalf, tracking?.usedSecondHalf].filter(
          Boolean,
        ).length;
      } else {
        return [
          tracking?.usedQ1,
          tracking?.usedQ2,
          tracking?.usedQ3,
          tracking?.usedQ4,
        ].filter(Boolean).length;
      }
    }

    benefitAmount(tracking: any) {
      return tracking?.benefit?.amount?.amount ?? 0;
    }

    trackingUsedValue(tracking: any) {
      const amount = this.benefitAmount(tracking);
      const unit = this.timeUnit(tracking);
      const count = this.timeCount(tracking);
      if (unit === 'year') {
        return tracking?.usedAnnually ? amount : 0;
      } else if (unit === 'month') {
        const monthsUsed = this.usageCount(tracking);
        const isAnnual = amount >= 50;
        const monthly = isAnnual ? amount / 12 : amount;
        return Math.round(monthly * monthsUsed);
      } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        const halfUsed = this.usageCount(tracking);
        const isAnnual = amount >= 100;
        const half = isAnnual ? amount / 2 : amount;
        return Math.round(half * halfUsed);
      } else {
        const qUsed = this.usageCount(tracking);
        const isAnnual = amount >= 100;
        const quarterly = isAnnual ? amount / 4 : amount;
        return Math.round(quarterly * qUsed);
      }
    }

    trackingTotalPossible(tracking: any) {
      const amount = this.benefitAmount(tracking);
      const unit = this.timeUnit(tracking);
      const count = this.timeCount(tracking);
      if (unit === 'year') return amount;
      if (unit === 'month') {
        const isAnnual = amount >= 50;
        return isAnnual ? amount : amount * 12;
      }
      if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        const isAnnual = amount >= 100;
        return isAnnual ? amount : amount * 2;
      }
      const isAnnual = amount >= 100;
      return isAnnual ? amount : amount * 4;
    }

    get totalValueRedeemed() {
      return this.trackings.reduce(
        (sum: number, t: any) => sum + this.trackingUsedValue(t),
        0,
      );
    }

    get totalValueAvailable() {
      return this.trackings.reduce(
        (sum: number, t: any) => sum + this.trackingTotalPossible(t),
        0,
      );
    }

    get valueUsedPct() {
      const total = this.totalValueAvailable;
      if (!total) return 0;
      return Math.round((this.totalValueRedeemed / total) * 100);
    }

    get annualFee() {
      return this.args.model?.cardProgram?.annualFee?.amount ?? 0;
    }

    get feeRecoveryPct() {
      const fee = this.annualFee;
      if (!fee) return 0;
      return Math.round((this.totalValueRedeemed / fee) * 100);
    }

    get feeProfit() {
      return Math.round(this.totalValueRedeemed - this.annualFee);
    }

    get completedBenefitsCount() {
      return this.trackings.filter(
        (t: any) => this.usageCount(t) >= this.maxPeriods(t),
      ).length;
    }

    get completionPct() {
      const count = this.trackings.length;
      if (!count) return 0;
      return Number(((this.completedBenefitsCount / count) * 100).toFixed(1));
    }

    get cardTitle() {
      const name = this.args.model?.cardProgram?.cardName ?? 'Card';
      return `${name} Benefit Tracker`;
    }

    get cardThumbnail() {
      return this.args.model?.cardProgram?.thumbnailURL ?? null;
    }

    get currencyCode() {
      return this.args.model?.cardProgram?.annualFee?.currency?.code ?? 'USD';
    }

    <template>
      <article class='tracker-card'>
        <header class='tracker-header'>
          <div class='tracker-title-section'>
            <h1 class='tracker-title'>{{this.cardTitle}}</h1>
            {{#if this.cardThumbnail}}
              <img
                src={{this.cardThumbnail}}
                alt={{this.cardTitle}}
                class='tracker-thumbnail'
              />
            {{/if}}
          </div>

          <div class='tracker-chips'>
            {{#if @model.cardholderName}}
              <span class='chip name-chip'>{{@model.cardholderName}}</span>
            {{/if}}
            {{#if @model.trackingYear}}
              <span class='chip year-chip'>{{@model.trackingYear}}</span>
            {{/if}}
          </div>
        </header>

        <section class='summary-grid'>
          <div class='donut-card'>
            <ProgressRadial
              @max={{100}}
              @value={{this.valueUsedPct}}
              class='donut-progress-radial'
            />
            <div class='donut-subtext'>
              {{this.completedBenefitsCount}}
              of
              {{this.trackings.length}}
              benefits maximized
            </div>
          </div>

          <div class='stats-grid'>
            <div class='stat-card stat-green'>
              <div class='stat-label'>☆ Value Redeemed</div>
              <div class='stat-value'>
                {{formatCurrency
                  this.totalValueRedeemed
                  currency=this.currencyCode
                  size='short'
                }}
              </div>
              <div class='stat-sub'>
                of
                {{formatCurrency
                  this.totalValueAvailable
                  currency=this.currencyCode
                  size='short'
                }}
                available
              </div>
            </div>

            <div class='stat-card stat-blue'>
              <div class='stat-label'>✧ Fee Recovery</div>
              <div class='stat-value'>{{this.feeRecoveryPct}}%</div>
              <div class='stat-sub'>
                {{if (gt this.feeProfit 0) '+' ''}}{{formatCurrency
                  this.feeProfit
                  currency=this.currencyCode
                  size='short'
                }}
                profit
              </div>
            </div>

            <div class='stat-card'>
              <div class='stat-label'>↻ Completion Rate</div>
              <div class='stat-value'>{{this.completionPct}}%</div>
              <div class='stat-sub'>Benefits fully utilized</div>
            </div>

            <div class='stat-card'>
              <div class='stat-label'>▣ Annual Fee</div>
              <div class='stat-value'>
                {{formatCurrency
                  this.annualFee
                  currency=this.currencyCode
                  size='short'
                }}
              </div>
              <div class='stat-sub'>{{@model.cardProgram.cardName}}</div>
            </div>
          </div>
        </section>

        {{#if this.trackings.length}}
          <section class='benefit-section'>
            <h3 class='section-title'>Benefit Usage Tracking</h3>
            <div class='benefit-list'>
              <@fields.benefitTrackings @format='embedded' />
            </div>
          </section>
        {{/if}}
      </article>

      <style
        scoped
      >
        .tracker-card {
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-radius));
          background: var(--card, var(--boxel-light));
          padding: calc(var(--spacing, var(--boxel-sp-xs)));
        }

        .tracker-header {
          border: 1px solid var(--border, var(--boxel-border-color));
          padding: calc(var(--spacing, var(--boxel-sp-xs)));
          margin-bottom: calc(var(--spacing, var(--boxel-sp-xs)));
          border-radius: var(--radius, var(--boxel-radius));
        }

        .tracker-title-section {
          display: grid;
          grid-template-columns: 1fr 100px;
          gap: calc(var(--spacing, var(--boxel-sp)) * 2);
        }

        .tracker-title {
          font-family: var(--font-serif, var(--boxel-font-family));
          font-size: 2rem;
          font-weight: 500;
          margin: 0 0 calc(var(--spacing, var(--boxel-sp-xs)) * 2) 0;
          letter-spacing: var(--tracking-normal, var(--boxel-lsp));
        }

        .tracker-thumbnail {
          max-width: 100px;
          height: auto;
          border-radius: var(--radius, var(--boxel-radius));
        }

        .tracker-chips {
          display: flex;
          gap: 0.5rem;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: 0.375rem;
          background: var(--muted, var(--boxel-700));
          color: var(--foreground, var(--boxel-50));
          font-size: 0.75rem;
          font-weight: 600;
        }
        .year-chip {
          background: var(--accent, var(--boxel-50));
          color: var(--foreground, var(--boxel-700));
        }

        .summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }

        .donut-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-radius));
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          background: var(--card, var(--boxel-light));
        }
        .donut-progress-radial {
          --boxel-progress-radial-fill-color: var(--muted-foreground, var(--boxel-dark));
          --boxel-progress-radial-size: 150px;
          --boxel-progress-radial-font-weight: 700;
        }
        .donut-subtext {
          margin-top: 0.75rem;
          color: var(--muted-foreground, var(--boxel-dark));
          font-size: 0.875rem;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
        }
        .stat-card {
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-radius));
          padding: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          background: var(--card, var(--boxel-light));
        }
        .stat-green {
          box-shadow: inset 0 0 0 2px oklch(0.7 0.12 160);
        }
        .stat-blue {
          box-shadow: inset 0 0 0 2px oklch(0.7 0.12 260);
        }
        .stat-label {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-dark));
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .stat-value {
          font-size: 1.75rem;
          font-weight: 600;
          margin-top: 0.25rem;
        }
        .stat-sub {
          font-size: 0.875rem;
          color: var(--muted-foreground, var(--boxel-dark));
        }

        .benefit-section {
          margin-top: calc(var(--spacing, var(--boxel-sp-xs)) * 2);
          border: 1px solid var(--border, var,--boxel-border-color));
          border-radius: var(--radius, var,--boxel-radius));
          padding: calc(var(--spacing, var,--boxel-sp-xs)) * 2);
          background: var(--card, var,--boxel-light));
        }
        .section-title {
          font-family: var(--font-serif, var,--boxel-font-family));
          font-size: 1rem;
          margin: 0 0 1rem 0;
        }
        .benefit-list {
          display: grid;
          gap: 1rem;
        }

        @media (max-width: 880px) {
          .summary-grid {
            grid-template-columns: 1fr;
          }
          .donut-card {
            margin-inline: auto;
          }
        }
      </style>
    </template>
  };
}
