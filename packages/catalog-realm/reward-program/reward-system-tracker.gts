// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core APIs
import StringField from 'https://cardstack.com/base/string'; // ² Base fields
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { RewardCardSystem } from './reward-card-system'; // ³ Import the main card system
import { Benefit } from './reward-card-system'; // ⁴ Import benefit type
import { MembershipBenefit } from './reward-card-system'; // ⁵ Import membership benefit type
import { gt, eq, and, or, multiply, divide } from '@cardstack/boxel-ui/helpers'; // ⁶ Helpers
import { formatDateTime, formatCurrency, formatNumber } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper'; // ⁷ Function helper
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

/**
 * BenefitUsageTracking
 * Field for tracking individual benefit usage periods with checkboxes
 */
export class BenefitUsageTracking extends CardDef { // ⁷ Benefit usage tracking
  static displayName = 'Benefit Usage Tracking';

  @field benefit = linksTo(Benefit); // ⁸ Link to the benefit being tracked
  
  // Quarterly tracking fields (default)
  @field usedQ1 = contains(BooleanField); // ⁹ Q1 usage checkbox
  @field usedQ2 = contains(BooleanField); // ¹⁰ Q2 usage checkbox  
  @field usedQ3 = contains(BooleanField); // ¹¹ Q3 usage checkbox
  @field usedQ4 = contains(BooleanField); // ¹² Q4 usage checkbox
  
  // Monthly tracking fields (for monthly benefits)
  @field usedJan = contains(BooleanField); // ¹³ January usage
  @field usedFeb = contains(BooleanField); // ¹⁴ February usage
  @field usedMar = contains(BooleanField); // ¹⁵ March usage
  @field usedApr = contains(BooleanField); // ¹⁶ April usage
  @field usedMay = contains(BooleanField); // ¹⁷ May usage
  @field usedJun = contains(BooleanField); // ¹⁸ June usage
  @field usedJul = contains(BooleanField); // ¹⁹ July usage
  @field usedAug = contains(BooleanField); // ²⁰ August usage
  @field usedSep = contains(BooleanField); // ²¹ September usage
  @field usedOct = contains(BooleanField); // ²² October usage
  @field usedNov = contains(BooleanField); // ²³ November usage
  @field usedDec = contains(BooleanField); // ²⁴ December usage
  
  // Half-yearly tracking fields (for semi-annual benefits)
  @field usedFirstHalf = contains(BooleanField); // ²⁵ First half (Jan-Jun) usage
  @field usedSecondHalf = contains(BooleanField); // ²⁶ Second half (Jul-Dec) usage
  
  // Annual tracking field (for yearly benefits)
  @field usedAnnually = contains(BooleanField); // ²⁷ Annual usage indicator
  
  @field lastUsedDate = contains(DateField); // ²⁸ Last usage date
  @field notes = contains(MarkdownField); // ²⁹ Personal notes about usage

  @field title = contains(StringField, {
    // ¹⁵ Computed title
    computeVia: function (this: BenefitUsageTracking) {
      try {
        return this.benefit?.name ?? 'Benefit Usage Tracking';
      } catch (e) {
        return 'Benefit Usage Tracking';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁶ Embedded format
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
          case 'Jan': this.args.model.usedJan = checked; break;
          case 'Feb': this.args.model.usedFeb = checked; break;
          case 'Mar': this.args.model.usedMar = checked; break;
          case 'Apr': this.args.model.usedApr = checked; break;
          case 'May': this.args.model.usedMay = checked; break;
          case 'Jun': this.args.model.usedJun = checked; break;
          case 'Jul': this.args.model.usedJul = checked; break;
          case 'Aug': this.args.model.usedAug = checked; break;
          case 'Sep': this.args.model.usedSep = checked; break;
          case 'Oct': this.args.model.usedOct = checked; break;
          case 'Nov': this.args.model.usedNov = checked; break;
          case 'Dec': this.args.model.usedDec = checked; break;
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
      
      switch (unit) {
        case 'month': return 12;
        case 'quarter': return 4;
        case 'year': return 1;
        case 'half-year': return 2;
        default: 
          // Handle custom periods like "6 months" = half-year
          if (count === 6 && unit === 'month') return 2;
          return 4;
      }
    }

    get usageCount() {
      const unit = this.timePeriodUnit;
      const count = this.timePeriodCount;
      
      if (unit === 'year') {
        return this.args.model?.usedAnnually ? 1 : 0;
      } else if (unit === 'month') {
        // Count individual months used
        const monthsUsed = [
          this.args.model?.usedJan, this.args.model?.usedFeb, this.args.model?.usedMar,
          this.args.model?.usedApr, this.args.model?.usedMay, this.args.model?.usedJun,
          this.args.model?.usedJul, this.args.model?.usedAug, this.args.model?.usedSep,
          this.args.model?.usedOct, this.args.model?.usedNov, this.args.model?.usedDec,
        ].filter(Boolean).length;
        return monthsUsed;
      } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        const halfYearsUsed = [
          this.args.model?.usedFirstHalf,
          this.args.model?.usedSecondHalf,
        ].filter(Boolean).length;
        return halfYearsUsed;
      } else {
        // Quarterly tracking (default)
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

    get usageText() {
      const unit = this.timePeriodUnit;
      const count = this.timePeriodCount;
      
      if (unit === 'year') {
        return this.usageCount > 0 ? 'Used this year' : 'Not used yet';
      } else if (unit === 'month') {
        return `${this.usageCount}/12 months used`;
      } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        return `${this.usageCount}/2 periods used`;
      } else {
        return `${this.usageCount}/4 quarters used`;
      }
    }

    get usedValue() {
      const amount = this.args.model?.benefit?.amount ?? 0;
      const unit = this.timePeriodUnit;
      const count = this.timePeriodCount;
      
      if (unit === 'year') {
        return this.args.model?.usedAnnually ? amount : 0;
      } else if (unit === 'month') {
        const monthsUsed = this.usageCount;
        // For monthly benefits like Walmart+ ($12.95/month), treat small amounts as per-month
        const isAnnualValue = amount >= 50; // Heuristic: assume values ≥$50 are annual
        const monthlyValue = isAnnualValue ? (amount / 12) : amount;
        return Math.round(monthlyValue * monthsUsed);
      } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        const halfYearsUsed = this.usageCount;
        // Check if amount represents total annual value or half-year value
        const isAnnualValue = amount >= 100; // Heuristic: assume values ≥$100 are annual
        const halfYearlyValue = isAnnualValue ? (amount / 2) : amount;
        return Math.round(halfYearlyValue * halfYearsUsed);
      } else {
        // Quarterly benefits - need to handle both scenarios
        const quartersUsed = this.usageCount;
        // Check if amount represents total annual value or quarterly value
        const isAnnualValue = amount >= 100; // Heuristic: assume values ≥$100 are annual
        const quarterlyValue = isAnnualValue ? (amount / 4) : amount;
        return Math.round(quarterlyValue * quartersUsed);
      }
    }

    get totalPossibleValue() {
      const amount = this.args.model?.benefit?.amount ?? 0;
      const unit = this.timePeriodUnit;
      const count = this.timePeriodCount;
      
      // For quarterly, monthly, and half-year benefits, calculate total annual value
      if (unit === 'year') {
        return amount;
      } else if (unit === 'month') {
        // For monthly benefits like Walmart+ ($12.95/month), treat small amounts as per-month
        const isAnnualValue = amount >= 50; // Heuristic: assume values ≥$50 are annual
        return isAnnualValue ? amount : (amount * 12);
      } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
        // Check if amount represents total annual value or half-year value
        const isAnnualValue = amount >= 100; // Heuristic: assume values ≥$100 are annual
        return isAnnualValue ? amount : (amount * 2);
      } else {
        // Quarterly benefits - calculate total annual value
        const isAnnualValue = amount >= 100; // Heuristic: assume values ≥$100 are annual
        return isAnnualValue ? amount : (amount * 4);
      }
    }

    get valueText() {
      return `$${this.usedValue} of $${this.totalPossibleValue} value redeemed`;
    }

    <template>
      <div class='benefit-usage-tracking'>
        <div class='tracking-header' {{on 'click' this.toggleDetails}}>
          <div class='benefit-info'>
            <h4 class='benefit-name'>
              {{if @model.benefit.name @model.benefit.name 'Unknown Benefit'}}
            </h4>
            <div class='benefit-value'>
              {{#if @model.benefit.amount}}
                <span class='benefit-amount'>
                  ${{@model.benefit.amount}} total value
                </span>
              {{/if}}
              <span class='value-breakdown'>{{this.valueText}}</span>
            </div>
          </div>
          
          <div class='usage-summary'>
            <div class='usage-progress'>
              <div class='progress-bar'>
                <div 
                  class='progress-fill' 
                  style='width: {{this.usagePercentage}}%'
                ></div>
              </div>
              <span class='usage-text'>{{this.usageText}}</span>
            </div>
            <svg class='expand-icon {{if this.showDetails "expanded"}}' 
                 viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
              <polyline points='6,9 12,15 18,9'></polyline>
            </svg>
          </div>
        </div>

        {{#if this.showDetails}}
          <div class='tracking-details'>
              {{#if (eq this.timePeriodUnit 'year')}}
              {{! For yearly benefits, show single usage indicator }}
              <div class='yearly-usage'>
                <label class='yearly-label'>
                  <input 
                    type='checkbox' 
                    checked={{@model.usedAnnually}}
                    {{on 'change' this.updateYearlyUsage}}
                    class='yearly-checkbox'
                  />
                  <span class='yearly-text'>Used in 2025</span>
                  <span class='yearly-note'>Annual benefit - can be used once per year</span>
                </label>
              </div>
              {{else if (eq this.timePeriodUnit 'month')}}
              {{! For monthly benefits, show individual months }}
              <div class='monthly-grid'>
                <div class='month-item {{if @model.usedJan "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedJan}} {{on 'change' (fn this.updateMonthlyUsage 'Jan')}} class='month-checkbox' />
                    <span class='month-text'>January</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedFeb "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedFeb}} {{on 'change' (fn this.updateMonthlyUsage 'Feb')}} class='month-checkbox' />
                    <span class='month-text'>February</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedMar "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedMar}} {{on 'change' (fn this.updateMonthlyUsage 'Mar')}} class='month-checkbox' />
                    <span class='month-text'>March</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedApr "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedApr}} {{on 'change' (fn this.updateMonthlyUsage 'Apr')}} class='month-checkbox' />
                    <span class='month-text'>April</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedMay "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedMay}} {{on 'change' (fn this.updateMonthlyUsage 'May')}} class='month-checkbox' />
                    <span class='month-text'>May</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedJun "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedJun}} {{on 'change' (fn this.updateMonthlyUsage 'Jun')}} class='month-checkbox' />
                    <span class='month-text'>June</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedJul "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedJul}} {{on 'change' (fn this.updateMonthlyUsage 'Jul')}} class='month-checkbox' />
                    <span class='month-text'>July</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedAug "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedAug}} {{on 'change' (fn this.updateMonthlyUsage 'Aug')}} class='month-checkbox' />
                    <span class='month-text'>August</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedSep "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedSep}} {{on 'change' (fn this.updateMonthlyUsage 'Sep')}} class='month-checkbox' />
                    <span class='month-text'>September</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedOct "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedOct}} {{on 'change' (fn this.updateMonthlyUsage 'Oct')}} class='month-checkbox' />
                    <span class='month-text'>October</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedNov "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedNov}} {{on 'change' (fn this.updateMonthlyUsage 'Nov')}} class='month-checkbox' />
                    <span class='month-text'>November</span>
                  </label>
                </div>
                <div class='month-item {{if @model.usedDec "used"}}'>
                  <label class='month-label'>
                    <input type='checkbox' checked={{@model.usedDec}} {{on 'change' (fn this.updateMonthlyUsage 'Dec')}} class='month-checkbox' />
                    <span class='month-text'>December</span>
                  </label>
                </div>
              </div>
              {{else if (or (eq this.timePeriodUnit 'half-year') (and (eq this.timePeriodUnit 'month') (eq this.timePeriodCount 6)))}}
              {{! For half-year benefits like Saks Credit }}
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
                    <span class='half-year-period'>{{if @model.usedFirstHalf "6 months used" "6 months available"}}</span>
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
                    <span class='half-year-period'>{{if @model.usedSecondHalf "6 months used" "6 months available"}}</span>
                  </label>
                </div>
              </div>
              {{else}}
              {{! Default quarterly tracking }}
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
                <span class='last-used-date'>{{formatDateTime @model.lastUsedDate size='medium'}}</span>
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
        /* ¹⁷ Vintage luxury benefit tracking styling */
        .benefit-usage-tracking {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--card);
          overflow: hidden;
          transition: all 0.3s ease;
          box-shadow: var(--shadow);
        }

        .benefit-usage-tracking:hover {
          border-color: var(--primary);
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
        }

        .tracking-header {
          padding: calc(var(--spacing) * 4);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: calc(var(--spacing) * 4);
          background: var(--secondary);
          border-bottom: 1px solid var(--border);
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
          color: var(--foreground);
          margin: 0;
          line-height: 1.3;
          font-family: var(--font-serif);
          letter-spacing: var(--tracking-normal);
        }

        .benefit-value {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing) * 0.5);
        }

        .benefit-amount {
          font-size: 0.75rem;
          color: var(--muted-foreground);
          font-weight: 500;
          font-family: var(--font-sans);
        }

        .value-breakdown {
          font-size: 0.75rem;
          color: var(--primary);
          font-weight: 600;
          font-family: var(--font-sans);
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
          background: var(--muted);
          border-radius: calc(var(--radius) * 0.5);
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: var(--primary);
          transition: width 0.3s ease;
          border-radius: calc(var(--radius) * 0.5);
        }

        .usage-text {
          font-size: 0.6875rem;
          color: var(--muted-foreground);
          font-weight: 500;
          font-family: var(--font-sans);
        }

        .expand-icon {
          width: calc(var(--spacing) * 4);
          height: calc(var(--spacing) * 4);
          color: var(--muted-foreground);
          transition: transform 0.3s ease;
        }

        .expand-icon.expanded {
          transform: rotate(180deg);
        }

        .tracking-details {
          padding: 1rem;
          background: var(--card, #ffffff);
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
          margin-bottom: 1rem;
        }

        .yearly-label {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 1rem;
          border: 2px solid var(--primary, #3b82f6);
          border-radius: 8px;
          background: var(--accent, #f1f5f9);
          cursor: pointer;
          user-select: none;
          transition: all 0.2s ease;
        }

        .yearly-label:hover {
          background: var(--primary, #3b82f6);
          color: white;
        }

        .yearly-checkbox {
          width: 1.25rem;
          height: 1.25rem;
          margin-bottom: 0.5rem;
          accent-color: var(--primary, #3b82f6);
        }

        .yearly-text {
          font-size: 1rem;
          font-weight: 600;
          color: inherit;
        }

        .yearly-note {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          font-style: italic;
        }

        .month-item {
          padding: 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 6px;
          background: var(--muted, #f9fafb);
          transition: all 0.2s ease;
        }

        .month-item:hover {
          background: var(--accent, #f1f5f9);
          border-color: var(--primary, #3b82f6);
        }

        .month-item.used {
          background: var(--primary, #3b82f6);
          color: white;
          border-color: var(--primary, #3b82f6);
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
          accent-color: var(--primary, #3b82f6);
        }

        .month-text {
          font-size: 0.8125rem;
          font-weight: 600;
          color: inherit;
        }

        .quarter-item {
          padding: 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 6px;
          background: var(--muted, #f9fafb);
          transition: all 0.2s ease;
        }

        .quarter-item:hover {
          background: var(--accent, #f1f5f9);
          border-color: var(--primary, #3b82f6);
        }

        .half-year-period {
          padding: 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 6px;
          background: var(--muted, #f9fafb);
          transition: all 0.2s ease;
        }

        .half-year-period:hover {
          background: var(--accent, #f1f5f9);
          border-color: var(--primary, #3b82f6);
        }

        .half-year-period.used {
          background: var(--primary, #3b82f6);
          color: white;
          border-color: var(--primary, #3b82f6);
        }

        .half-year-period.used .half-year-period {
          color: rgba(255, 255, 255, 0.9);
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
          accent-color: var(--primary, #3b82f6);
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
          accent-color: var(--primary, #3b82f6);
        }

        .quarter-text {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--foreground, #111827);
        }

        .quarter-period {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }

        .last-used {
          padding: 0.75rem;
          background: var(--accent, #f1f5f9);
          border-radius: 6px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .last-used-label {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          font-weight: 500;
        }

        .last-used-date {
          font-size: 0.75rem;
          color: var(--foreground, #111827);
          font-weight: 600;
        }

        .usage-notes {
          padding: 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 6px;
          background: var(--muted, #f9fafb);
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
  };
}

/**
 * RewardSystemTracker  
 * Main card for tracking benefit redemptions across different time periods
 */
export class RewardSystemTracker extends CardDef { // ¹⁸ Main tracker card
  static displayName = 'Reward System Tracker';

  @field cardSystem = linksTo(RewardCardSystem); // ¹⁹ Link to the reward card system
  @field trackingYear = contains(StringField); // ²⁰ Year being tracked (e.g., "2025")
  @field benefitTrackings = containsMany(BenefitUsageTracking); // ²¹ Collection of benefit trackings
  @field cardholderName = contains(StringField); // ²² Name of cardholder
  @field notes = contains(MarkdownField); // ²³ General tracking notes

  @field title = contains(StringField, {
    // ²⁴ Computed title
    computeVia: function (this: RewardSystemTracker) {
      try {
        const cardName = this.cardSystem?.cardName ?? 'Unknown Card';
        const year = this.trackingYear ?? '2025';
        return `${cardName} - ${year} Benefit Tracker`;
      } catch (e) {
        return 'Reward System Tracker';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // ²⁵ Isolated format
    get totalBenefitsValue() {
      try {
        const trackings = this.args.model?.benefitTrackings ?? [];
        return trackings.reduce((total, tracking) => {
          const amount = tracking.benefit?.amount ?? 0;
          const period = tracking.benefit?.timePeriod?.unit;
          const count = tracking.benefit?.timePeriod?.count ?? 1;
          
          // Calculate total annual value based on time period
          if (period === 'year') {
            return total + amount;
          } else if (period === 'month') {
            // Check if amount represents total annual value or monthly value
            const isAnnualValue = amount >= 100;
            return total + (isAnnualValue ? amount : (amount * 12));
          } else if (period === 'half-year' || (count === 6 && period === 'month')) {
            // Check if amount represents total annual value or half-year value
            const isAnnualValue = amount >= 100;
            return total + (isAnnualValue ? amount : (amount * 2));
          } else {
            // Quarterly benefits - calculate total annual value
            const isAnnualValue = amount >= 100;
            return total + (isAnnualValue ? amount : (amount * 4));
          }
        }, 0);
      } catch (e) {
        return 0;
      }
    }

    get usedBenefitsValue() {
      try {
        const trackings = this.args.model?.benefitTrackings ?? [];
        return trackings.reduce((total, tracking) => {
          const amount = tracking.benefit?.amount ?? 0;
          const period = tracking.benefit?.timePeriod?.unit;
          const count = tracking.benefit?.timePeriod?.count ?? 1;
          
          if (period === 'year') {
            // Annual benefit: used = full value
            return total + (tracking.usedAnnually ? amount : 0);
          } else if (period === 'month') {
            // Monthly benefit: count individual months
            const monthsUsed = [
              tracking.usedJan, tracking.usedFeb, tracking.usedMar,
              tracking.usedApr, tracking.usedMay, tracking.usedJun,
              tracking.usedJul, tracking.usedAug, tracking.usedSep,
              tracking.usedOct, tracking.usedNov, tracking.usedDec,
            ].filter(Boolean).length;
            // For monthly benefits like Walmart+ ($12.95/month), treat small amounts as per-month
            const isAnnualValue = amount >= 50;
            const monthlyValue = isAnnualValue ? (amount / 12) : amount;
            return total + (monthlyValue * monthsUsed);
          } else if (period === 'half-year' || (count === 6 && period === 'month')) {
            // Half-year benefit: count periods used
            const halfYearsUsed = [
              tracking.usedFirstHalf,
              tracking.usedSecondHalf,
            ].filter(Boolean).length;
            // Check if amount represents total annual value or half-year value
            const isAnnualValue = amount >= 100;
            const halfYearlyValue = isAnnualValue ? (amount / 2) : amount;
            return total + (halfYearlyValue * halfYearsUsed);
          } else {
            // Quarterly benefit: count quarters used
            const quartersUsed = [
              tracking.usedQ1,
              tracking.usedQ2, 
              tracking.usedQ3,
              tracking.usedQ4,
            ].filter(Boolean).length;
            // Check if amount represents total annual value or quarterly value
            const isAnnualValue = amount >= 100;
            const quarterlyValue = isAnnualValue ? (amount / 4) : amount;
            return total + (quarterlyValue * quartersUsed);
          }
        }, 0);
      } catch (e) {
        return 0;
      }
    }

    get utilizationPercentage() {
      const total = this.totalBenefitsValue;
      const used = this.usedBenefitsValue;
      return total > 0 ? Math.round((used / total) * 100) : 0;
    }

    get progressStroke() {
      // Fix circle progress calculation - SVG stroke-dasharray needs circumference calculation
      const percentage = this.utilizationPercentage;
      const circumference = 2 * Math.PI * 15.915; // radius = 15.915
      const progress = (percentage / 100) * circumference;
      return `${progress} ${circumference}`;
    }

    get completedBenefitsCount() {
      const trackings = this.args.model?.benefitTrackings ?? [];
      return trackings.filter(tracking => {
        const unit = tracking.benefit?.timePeriod?.unit ?? 'quarter';
        const count = tracking.benefit?.timePeriod?.count ?? 1;
        
        if (unit === 'year') {
          return tracking.usedAnnually;
        } else if (unit === 'month') {
          const monthsUsed = [
            tracking.usedJan, tracking.usedFeb, tracking.usedMar,
            tracking.usedApr, tracking.usedMay, tracking.usedJun,
            tracking.usedJul, tracking.usedAug, tracking.usedSep,
            tracking.usedOct, tracking.usedNov, tracking.usedDec,
          ].filter(Boolean).length;
          return monthsUsed >= 6; // Consider partially complete if >50% used
        } else if (unit === 'half-year' || (count === 6 && unit === 'month')) {
          return tracking.usedFirstHalf && tracking.usedSecondHalf;
        } else {
          const quartersUsed = [
            tracking.usedQ1, tracking.usedQ2, tracking.usedQ3, tracking.usedQ4,
          ].filter(Boolean).length;
          return quartersUsed >= 2; // Consider partially complete if >50% used
        }
      }).length;
    }

    get totalBenefitsCount() {
      return this.args.model?.benefitTrackings?.length ?? 0;
    }

    get savingsVsFee() {
      const fee = this.args.model?.cardSystem?.annualFee ?? 0;
      const used = this.usedBenefitsValue;
      return used - fee;
    }

    get feeRecoveryPercentage() {
      const fee = this.args.model?.cardSystem?.annualFee ?? 0;
      const used = this.usedBenefitsValue;
      return fee > 0 ? Math.min(Math.round((used / fee) * 100), 999) : 0;
    }

    <template>
      <div class='tracker-stage'>
        <div class='tracker-container'>
          
          {{! ²⁶ Header with card information }}
          <header class='tracker-header'>
            <div class='card-info'>
              <h1 class='tracker-title'>
                {{if @model.cardSystem.cardName @model.cardSystem.cardName 'Reward Card'}} 
                Benefit Tracker
              </h1>
              <div class='tracker-meta'>
                {{#if @model.cardholderName}}
                  <span class='cardholder'>{{@model.cardholderName}}</span>
                {{/if}}
                <span class='tracking-year'>{{if @model.trackingYear @model.trackingYear '2025'}}</span>
              </div>
            </div>

            {{! ⁽¹⁰²⁾ Enhanced fintech dashboard with mint-quality metrics }}
            <div class='fintech-dashboard'>
              {{! ⁽¹⁰³⁾ Primary utilization circle with proper SVG calculation }}
              <div class='primary-metric'>
                <div class='utilization-circle'>
                  <svg class='circle-chart' viewBox='0 0 42 42' aria-label='Benefits utilization: {{this.utilizationPercentage}}%'>
                    <circle 
                      class='circle-track' 
                      cx='21' 
                      cy='21' 
                      r='15.915'
                      fill='transparent'
                      stroke='var(--neutral-200, #e5e7eb)'
                      stroke-width='2.5'
                    />
                    <circle 
                      class='circle-progress' 
                      cx='21' 
                      cy='21' 
                      r='15.915'
                      fill='transparent'
                      stroke='url(#utilization-gradient)'
                      stroke-width='2.5'
                      stroke-dasharray='{{this.progressStroke}}'
                      stroke-dashoffset='0'
                      stroke-linecap='round'
                      style='transform: rotate(-90deg); transform-origin: 50% 50%;'
                    />
                    <defs>
                      <linearGradient id='utilization-gradient' x1='0%' y1='0%' x2='100%' y2='100%'>
                        <stop offset='0%' style='stop-color: var(--emerald-500, #10b981); stop-opacity: 1' />
                        <stop offset='100%' style='stop-color: var(--blue-600, #2563eb); stop-opacity: 1' />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div class='circle-content'>
                    <span class='metric-value'>{{this.utilizationPercentage}}%</span>
                    <span class='metric-label'>Benefits Used</span>
                  </div>
                </div>
                <div class='metric-subtitle'>
                  {{this.completedBenefitsCount}} of {{this.totalBenefitsCount}} benefits maximized
                </div>
              </div>

              {{! ⁽¹⁰⁴⁾ Financial metrics grid - mint/brez style }}
              <div class='metrics-grid'>
                <div class='metric-card value-redeemed'>
                  <div class='metric-header'>
                    <svg class='metric-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
                      <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/>
                    </svg>
                    <span class='metric-title'>Value Redeemed</span>
                  </div>
                  <div class='metric-amount positive'>{{formatCurrency this.usedBenefitsValue currency='USD' size='short'}}</div>
                  <div class='metric-detail'>of {{formatCurrency this.totalBenefitsValue currency='USD' size='short'}} available</div>
                </div>

                <div class='metric-card fee-recovery'>
                  <div class='metric-header'>
                    <svg class='metric-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
                      <path d='M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/>
                      <circle cx='8.5' cy='7' r='4'/>
                      <polyline points='17,11 19,13 23,9'/>
                    </svg>
                    <span class='metric-title'>Fee Recovery</span>
                  </div>
                  <div class='metric-amount {{if (gt this.feeRecoveryPercentage 100) "positive" "warning"}}'>
                    {{this.feeRecoveryPercentage}}%
                  </div>
                  <div class='metric-detail'>
                    {{#if @model.cardSystem.annualFee}}
                      {{#if (gt this.savingsVsFee 0)}}
                        +{{formatCurrency this.savingsVsFee currency='USD' size='short'}} profit
                      {{else}}
                        {{formatCurrency (multiply this.savingsVsFee -1) currency='USD' size='short'}} to break even
                      {{/if}}
                    {{else}}
                      No annual fee
                    {{/if}}
                  </div>
                </div>

                <div class='metric-card completion-rate'>
                  <div class='metric-header'>
                    <svg class='metric-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
                      <path d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/>
                      <polyline points='22,4 12,14.01 9,11.01'/>
                    </svg>
                    <span class='metric-title'>Completion Rate</span>
                  </div>
                  <div class='metric-amount neutral'>
                    {{formatNumber (divide this.completedBenefitsCount this.totalBenefitsCount) style='percent' size='short'}}
                  </div>
                  <div class='metric-detail'>Benefits fully utilized</div>
                </div>

                {{#if @model.cardSystem.annualFee}}
                <div class='metric-card annual-fee'>
                  <div class='metric-header'>
                    <svg class='metric-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
                      <rect x='1' y='4' width='22' height='16' rx='2' ry='2'/>
                      <line x1='1' y1='10' x2='23' y2='10'/>
                    </svg>
                    <span class='metric-title'>Annual Fee</span>
                  </div>
                  <div class='metric-amount neutral'>{{formatCurrency @model.cardSystem.annualFee currency='USD' size='short'}}</div>
                  <div class='metric-detail'>{{@model.cardSystem.cardName}}</div>
                </div>
                {{/if}}
              </div>
            </div>
          </header>

          {{! ²⁷ Benefits tracking grid }}
          <main class='tracking-content'>
            {{#if (gt @model.benefitTrackings.length 0)}}
              <section class='benefits-tracking'>
                <h2 class='section-title'>
                  <svg class='section-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
                    <path d='M9 11l3 3 8-8'/>
                    <path d='M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9'/>
                  </svg>
                  Benefit Usage Tracking
                </h2>
                
                <div class='benefits-list'>
                  <@fields.benefitTrackings @format='embedded' />
                </div>
              </section>
            {{else}}
              <div class='empty-state'>
                <svg class='empty-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>
                  <path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7z'/>
                  <path d='M9 12l2 2 4-4'/>
                </svg>
                <h3>No Benefits Tracked Yet</h3>
                <p>Add benefit tracking entries to start monitoring your redemptions and maximize your card's value.</p>
              </div>
            {{/if}}

            {{#if @model.notes}}
              <section class='notes-section'>
                <h3 class='notes-title'>Personal Notes</h3>
                <div class='notes-content'>
                  <@fields.notes />
                </div>
              </section>
            {{/if}}
          </main>

        </div>
      </div>

      <style scoped>
        /* ⁽¹⁰⁵⁾ Vintage luxury fintech interface with heritage aesthetics */
        .tracker-stage {
          background: var(--background);
          color: var(--foreground);
          min-height: 100vh;
          font-family: var(--font-sans);
          font-feature-settings: 'liga' 1, 'kern' 1, 'calt' 1;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          letter-spacing: var(--tracking-normal);
        }

        .tracker-container {
          max-width: 80rem;
          margin: 0 auto;
          padding: calc(var(--spacing) * 8);
        }

        .tracker-header {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing) * 8);
          margin-bottom: calc(var(--spacing) * 12);
          padding: calc(var(--spacing) * 8);
          background: var(--card);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          box-shadow: var(--shadow-lg);
          position: relative;
          overflow: hidden;
        }

        .tracker-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
        }

        .card-info {
          flex: 1;
        }

        .tracker-title {
          font-size: 2.25rem;
          font-weight: 400;
          color: var(--foreground);
          margin: 0 0 calc(var(--spacing) * 3) 0;
          line-height: 1.1;
          letter-spacing: var(--tracking-normal);
          font-family: var(--font-serif);
        }

        .tracker-meta {
          display: flex;
          gap: calc(var(--spacing) * 3);
          align-items: center;
          flex-wrap: wrap;
        }

        .cardholder {
          font-size: 0.875rem;
          font-weight: 600;
          padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
          background: var(--primary);
          color: var(--primary-foreground);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          letter-spacing: var(--tracking-normal);
          font-family: var(--font-sans);
        }

        .tracking-year {
          font-size: 0.875rem;
          color: var(--muted-foreground);
          font-weight: 600;
          padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
          background: var(--muted);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          letter-spacing: var(--tracking-normal);
          font-family: var(--font-sans);
        }

         /* ⁽¹⁰⁶⁾ Vintage luxury dashboard layout - optimized for 800px */
         .fintech-dashboard {
           display: grid;
           grid-template-columns: 280px 1fr;
           gap: calc(var(--spacing) * 8);
           align-items: start;
         }

         .primary-metric {
           display: flex;
           flex-direction: column;
           align-items: center;
           gap: calc(var(--spacing) * 4);
           padding: calc(var(--spacing) * 6);
           background: var(--card);
           border-radius: var(--radius);
           border: 2px solid var(--primary);
           box-shadow: var(--shadow-lg);
           position: relative;
           overflow: hidden;
         }

         .primary-metric::before {
           content: '';
           position: absolute;
           top: 0;
           left: 0;
           right: 0;
           height: 3px;
           background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
         }

         .utilization-circle {
           position: relative;
           width: 220px;
           height: 220px;
           display: flex;
           align-items: center;
           justify-content: center;
         }

        .circle-chart {
          width: 100%;
          height: 100%;
          filter: drop-shadow(var(--shadow));
        }

        .circle-track {
          stroke: var(--border);
          opacity: 0.3;
        }

        .circle-progress {
          stroke: var(--primary);
          transition: stroke-dasharray 1s cubic-bezier(0.4, 0, 0.2, 1);
        }

         .circle-content {
           position: absolute;
           text-align: center;
           display: flex;
           flex-direction: column;
           align-items: center;
           justify-content: center;
           gap: calc(var(--spacing) * 1.5);
           width: 100%;
           height: 100%;
         }

         .metric-value {
           font-size: 2.75rem;
           font-weight: 400;
           color: var(--primary);
           line-height: 1;
           letter-spacing: var(--tracking-normal);
           font-family: var(--font-serif);
         }

         .metric-label {
           font-size: 0.9375rem;
           color: var(--muted-foreground);
           font-weight: 500;
           text-transform: uppercase;
           letter-spacing: var(--tracking-normal);
           font-family: var(--font-sans);
           white-space: nowrap;
         }

         .metric-subtitle {
           font-size: 0.9375rem;
           color: var(--muted-foreground);
           text-align: center;
           font-weight: 500;
           line-height: 1.4;
           font-family: var(--font-sans);
           max-width: 200px;
         }

         /* ⁽¹⁰⁷⁾ Vintage luxury metrics grid - optimized for 800px */
         .metrics-grid {
           display: grid;
           grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
           gap: calc(var(--spacing) * 4);
         }

        .metric-card {
          padding: calc(var(--spacing) * 6);
          background: var(--card);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .metric-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
        }

        .metric-card:hover {
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
          border-color: var(--primary);
        }

        .metric-header {
          display: flex;
          align-items: center;
          gap: calc(var(--spacing) * 3);
          margin-bottom: calc(var(--spacing) * 4);
        }

        .metric-icon {
          width: calc(var(--spacing) * 5);
          height: calc(var(--spacing) * 5);
          color: var(--primary);
          flex-shrink: 0;
        }

        .metric-title {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: var(--tracking-normal);
          font-family: var(--font-sans);
        }

        .metric-amount {
          font-size: 1.875rem;
          font-weight: 400;
          line-height: 1;
          margin-bottom: calc(var(--spacing) * 2);
          letter-spacing: var(--tracking-normal);
          font-family: var(--font-serif);
        }

        .metric-amount.positive {
          color: var(--primary);
        }

        .metric-amount.warning {
          color: var(--destructive);
        }

        .metric-amount.neutral {
          color: var(--muted-foreground);
        }

        .metric-detail {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          font-weight: 500;
          line-height: 1.4;
          font-family: var(--font-sans);
        }

        /* ⁽¹⁰⁸⁾ Enhanced card backgrounds for different metric types */
        .value-redeemed::before {
          background: linear-gradient(90deg, var(--emerald-500, #10b981) 0%, var(--teal-500, #14b8a6) 100%);
        }

        .fee-recovery::before {
          background: linear-gradient(90deg, var(--blue-500, #3b82f6) 0%, var(--indigo-500, #6366f1) 100%);
        }

        .completion-rate::before {
          background: linear-gradient(90deg, var(--purple-500, #a855f7) 0%, var(--pink-500, #ec4899) 100%);
        }

        .annual-fee::before {
          background: linear-gradient(90deg, var(--slate-500, #64748b) 0%, var(--slate-600, #475569) 100%);
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: calc(var(--spacing) * 3);
          font-size: 1.125rem;
          font-weight: 400;
          color: var(--foreground);
          margin: 0 0 calc(var(--spacing) * 6) 0;
          font-family: var(--font-serif);
          letter-spacing: var(--tracking-normal);
        }

        .section-icon {
          width: calc(var(--spacing) * 5);
          height: calc(var(--spacing) * 5);
          color: var(--primary);
        }

        .benefits-list > .containsMany-field {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing) * 4);
        }

        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          color: var(--muted-foreground, #6b7280);
        }

        .empty-icon {
          width: 3rem;
          height: 3rem;
          color: var(--muted-foreground, #6b7280);
          margin: 0 auto 1rem;
        }

        .empty-state h3 {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--foreground, #111827);
          margin: 0 0 0.5rem 0;
        }

        .empty-state p {
          font-size: 0.875rem;
          line-height: 1.5;
          max-width: 28rem;
          margin: 0 auto;
        }

        .notes-section {
          margin-top: 3rem;
          padding-top: 2rem;
          border-top: 1px solid var(--border, #e5e7eb);
        }

        .notes-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--foreground, #111827);
          margin: 0 0 1rem 0;
        }

        .notes-content {
          padding: 1rem;
          background: var(--muted, #f9fafb);
          border-radius: 8px;
          border: 1px solid var(--border, #e5e7eb);
          font-size: 0.875rem;
          line-height: 1.5;
        }

         /* ⁽¹⁰⁹⁾ Responsive fintech layout */
         @media (max-width: 1000px) {
           .fintech-dashboard {
             grid-template-columns: 1fr;
             gap: 1.5rem;
           }

           .primary-metric {
             align-self: center;
             max-width: 320px;
             margin: 0 auto;
           }

           .metrics-grid {
             grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
           }
         }

         @media (max-width: 800px) {
           .fintech-dashboard {
             grid-template-columns: 1fr;
             gap: 1rem;
           }

           .primary-metric {
             max-width: 280px;
           }

           .metrics-grid {
             grid-template-columns: repeat(2, 1fr);
             gap: 0.75rem;
           }
         }

        @media (max-width: 768px) {
          .tracker-container {
            padding: 1rem;
          }

          .tracker-header {
            padding: 1.5rem;
            margin-bottom: 2rem;
          }

          .tracker-title {
            font-size: 1.75rem;
          }

          .tracker-meta {
            gap: 0.5rem;
          }

          .fintech-dashboard {
            gap: 1.5rem;
          }

          .primary-metric {
            padding: 1.5rem;
          }

           .utilization-circle {
             width: 180px;
             height: 180px;
           }

           .metric-value {
             font-size: 2.25rem;
           }

          .metrics-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .metric-card {
            padding: 1.25rem;
          }

          .metric-amount {
            font-size: 1.5rem;
          }
        }

        @media (max-width: 480px) {
          .tracker-container {
            padding: 0.75rem;
          }

          .tracker-header {
            padding: 1rem;
            border-radius: 12px;
          }

          .tracker-title {
            font-size: 1.5rem;
          }

          .cardholder,
          .tracking-year {
            font-size: 0.8125rem;
            padding: 0.375rem 0.75rem;
          }

          .primary-metric {
            padding: 1rem;
          }

           .utilization-circle {
             width: 160px;
             height: 160px;
           }

           .metric-value {
             font-size: 2rem;
           }

           .metric-label {
             font-size: 0.875rem;
           }

          .metric-card {
            padding: 1rem;
          }

          .metric-amount {
            font-size: 1.25rem;
          }

          .metric-icon {
            width: 1rem;
            height: 1rem;
          }

          .metric-title {
            font-size: 0.8125rem;
          }
        }
      </style>
    </template>
  };
}