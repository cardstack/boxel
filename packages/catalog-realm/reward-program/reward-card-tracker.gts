import {
  formatDateTime,
  gt,
  formatCurrency,
} from '@cardstack/boxel-ui/helpers';
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core APIs
import StringField from 'https://cardstack.com/base/string'; // ² Base fields
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { RewardCardProgram } from './reward-card-program'; // ³ Link to program

/**
 * TimePeriodTrackingField
 * Tracks a specific time period for benefits with resets
 */
export class TimePeriodTrackingField extends FieldDef {
  // ⁴ Time period tracking
  static displayName = 'Time Period Tracking';

  @field periodLabel = contains(StringField); // ⁵ e.g., "Q1 2025", "January 2025", "2025 Calendar Year"
  @field periodStartDate = contains(DateField); // ⁶ Start of tracking period
  @field periodEndDate = contains(DateField); // ⁷ End of tracking period
  @field maxValue = contains(NumberField); // ⁸ Maximum available for this period
  @field currency = contains(StringField); // ⁹ Currency for monetary benefits
  @field redeemedValue = contains(NumberField); // ¹⁰ User-entered: amount redeemed
  @field isFullyRedeemed = contains(BooleanField); // ¹¹ User-toggled: mark as fully used
  @field notes = contains(MarkdownField); // ¹² User notes about redemptions

  // ¹³ Computed values
  get remainingValue() {
    try {
      if (this.isFullyRedeemed) return 0;
      const max = this.maxValue ?? 0;
      const redeemed = this.redeemedValue ?? 0;
      return Math.max(0, max - redeemed);
    } catch (e) {
      return 0;
    }
  }

  get utilizationPercentage() {
    try {
      const max = this.maxValue ?? 0;
      if (max === 0) return 0;
      const redeemed = this.redeemedValue ?? 0;
      return Math.min(100, Math.round((redeemed / max) * 100));
    } catch (e) {
      return 0;
    }
  }

  get isExpired() {
    try {
      if (!this.periodEndDate) return false;
      return new Date() > new Date(this.periodEndDate);
    } catch (e) {
      return false;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁴ Period tracking display
    <template>
      <div class='period-tracking'>
        <div class='period-header'>
          <div class='period-info'>
            <strong>{{if
                @model.periodLabel
                @model.periodLabel
                'Tracking Period'
              }}</strong>
            {{#if @model.periodEndDate}}
              <span class='period-dates'>
                {{#if @model.periodStartDate}}
                  {{formatDateTime @model.periodStartDate size='short'}}
                  -
                {{/if}}
                {{formatDateTime @model.periodEndDate size='short'}}
                {{#if this.isExpired}}
                  <span class='expired-badge'>EXPIRED</span>
                {{/if}}
              </span>
            {{/if}}
          </div>

          {{#if @model.maxValue}}
            <div class='value-display'>
              <div class='utilization-bar'>
                <div
                  class='utilization-fill'
                  style='width: {{this.utilizationPercentage}}%'
                ></div>
              </div>
              <div class='value-breakdown'>
                <span class='redeemed'>{{formatCurrency
                    @model.redeemedValue
                    currency=@model.currency
                    size='short'
                  }}</span>
                <span class='separator'>/</span>
                <span class='total'>{{formatCurrency
                    @model.maxValue
                    currency=@model.currency
                    size='short'
                  }}</span>
                <span
                  class='percentage'
                >({{this.utilizationPercentage}}%)</span>
              </div>
            </div>
          {{/if}}
        </div>

        {{#if @model.isFullyRedeemed}}
          <div class='status-indicator fully-redeemed'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M9 12l2 2 4-4' />
              <circle cx='12' cy='12' r='10' />
            </svg>
            Fully Redeemed
          </div>
        {{else if (gt this.remainingValue 0)}}
          <div class='status-indicator remaining'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <line x1='12' y1='8' x2='12' y2='12' />
              <line x1='12' y1='16' x2='12.01' y2='16' />
            </svg>
            {{formatCurrency this.remainingValue currency=@model.currency}}
            remaining
          </div>
        {{/if}}

        {{#if @model.notes}}
          <div class='tracking-notes'>
            {{@model.notes}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ¹⁵ Period tracking styles */
        .period-tracking {
          padding: 0.75rem;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 0.5rem;
          background: var(--surface, #fefefe);
          font-size: 0.8125rem;
        }

        .period-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }

        .period-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .period-dates {
          font-size: 0.75rem;
          color: #6b7280;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .expired-badge {
          padding: 0.125rem 0.375rem;
          background: #fef2f2;
          color: #dc2626;
          border-radius: 0.25rem;
          font-weight: 600;
          font-size: 0.6875rem;
        }

        .value-display {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.25rem;
          min-width: 8rem;
        }

        .utilization-bar {
          width: 100%;
          height: 0.5rem;
          background: #f3f4f6;
          border-radius: 0.25rem;
          overflow: hidden;
        }

        .utilization-fill {
          height: 100%;
          background: linear-gradient(90deg, #10b981 0%, #059669 100%);
          transition: width 0.3s ease;
        }

        .value-breakdown {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
          font-size: 0.75rem;
        }

        .redeemed {
          font-weight: 600;
          color: #059669;
        }

        .separator {
          color: #9ca3af;
        }

        .total {
          color: #374151;
        }

        .percentage {
          color: #6b7280;
          font-size: 0.6875rem;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.5rem;
          border-radius: 0.375rem;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .status-indicator svg {
          width: 1rem;
          height: 1rem;
        }

        .fully-redeemed {
          background: #f0fdf4;
          color: #166534;
          border: 1px solid #bbf7d0;
        }

        .remaining {
          background: #fffbeb;
          color: #92400e;
          border: 1px solid #fde68a;
        }

        .tracking-notes {
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid #f3f4f6;
          font-size: 0.75rem;
          color: #6b7280;
          line-height: 1.4;
        }
      </style>
    </template>
  };
}

/**
 * BenefitTrackingField
 * Tracks redemption of a specific benefit across time periods
 */
export class BenefitTrackingField extends FieldDef {
  // ¹⁶ Benefit tracking
  static displayName = 'Benefit Tracking';

  @field benefitName = contains(StringField); // ¹⁷ Name of benefit being tracked
  @field benefitType = contains(StringField); // ¹⁸ 'statement-credit' | 'membership' | 'access' | etc.
  @field isOneTime = contains(BooleanField); // ¹⁹ true for signup bonuses, false for recurring
  @field trackingPeriods = containsMany(TimePeriodTrackingField); // ²⁰ Time-based tracking
  @field overallNotes = contains(MarkdownField); // ²¹ General notes about this benefit

  // ²² Computed aggregated values
  get totalValueRedeemed() {
    try {
      return (
        this.trackingPeriods?.reduce((total, period) => {
          return total + (period.redeemedValue ?? 0);
        }, 0) ?? 0
      );
    } catch (e) {
      return 0;
    }
  }

  get totalValueAvailable() {
    try {
      return (
        this.trackingPeriods?.reduce((total, period) => {
          return total + (period.maxValue ?? 0);
        }, 0) ?? 0
      );
    } catch (e) {
      return 0;
    }
  }

  get currentPeriod() {
    try {
      const now = new Date();
      return (
        this.trackingPeriods?.find((period) => {
          if (!period.periodStartDate || !period.periodEndDate) return false;
          const start = new Date(period.periodStartDate);
          const end = new Date(period.periodEndDate);
          return now >= start && now <= end;
        }) ?? null
      );
    } catch (e) {
      return null;
    }
  }

  get overallUtilization() {
    try {
      const total = this.totalValueAvailable;
      if (total === 0) return 0;
      return Math.round((this.totalValueRedeemed / total) * 100);
    } catch (e) {
      return 0;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    // ²³ Benefit tracking display
    <template>
      <div class='benefit-tracking'>
        <div class='benefit-header'>
          <div class='benefit-identity'>
            <h3>{{if @model.benefitName @model.benefitName 'Benefit'}}</h3>
            <div class='benefit-badges'>
              {{#if @model.benefitType}}
                <span class='type-badge'>{{@model.benefitType}}</span>
              {{/if}}
              {{#if @model.isOneTime}}
                <span class='onetime-badge'>One-time</span>
              {{else}}
                <span class='recurring-badge'>Recurring</span>
              {{/if}}
            </div>
          </div>

          {{#if (gt this.totalValueAvailable 0)}}
            <div class='aggregated-stats'>
              <div class='total-stats'>
                <span class='stat-label'>Total Redeemed</span>
                <span class='stat-value'>{{formatCurrency
                    this.totalValueRedeemed
                    currency='USD'
                  }}</span>
              </div>
              <div class='utilization-stat'>
                <span class='stat-label'>Overall Utilization</span>
                <span class='stat-value'>{{this.overallUtilization}}%</span>
              </div>
            </div>
          {{/if}}
        </div>

        {{#if this.currentPeriod}}
          <div class='current-period-highlight'>
            <h4>Current Period</h4>
            {{#let this.currentPeriod as |period|}}
              <div class='period-tracking'>
                <div class='period-header'>
                  <div class='period-info'>
                    <strong>{{if
                        period.periodLabel
                        period.periodLabel
                        'Current Period'
                      }}</strong>
                    {{#if period.periodEndDate}}
                      <span class='period-dates'>
                        {{#if period.periodStartDate}}
                          {{formatDateTime period.periodStartDate size='short'}}
                          -
                        {{/if}}
                        {{formatDateTime period.periodEndDate size='short'}}
                      </span>
                    {{/if}}
                  </div>
                  {{#if period.maxValue}}
                    <div class='value-display'>
                      <span class='remaining-value'>
                        {{formatCurrency
                          period.remainingValue
                          currency=period.currency
                        }}
                        remaining
                      </span>
                    </div>
                  {{/if}}
                </div>
              </div>
            {{/let}}
          </div>
        {{/if}}

        {{#if (gt @model.trackingPeriods.length 0)}}
          <div class='periods-section'>
            <h4>Tracking Periods</h4>
            <div class='periods-list'>
              <@fields.trackingPeriods @format='embedded' />
            </div>
          </div>
        {{/if}}

        {{#if @model.overallNotes}}
          <div class='overall-notes'>
            <h4>Notes</h4>
            {{@model.overallNotes}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ²⁴ Benefit tracking styles */
        .benefit-tracking {
          padding: 1.25rem;
          border: 2px solid var(--border, #e2e8f0);
          border-radius: 0.75rem;
          background: var(--surface, #fefefe);
          font-size: 0.875rem;
        }

        .benefit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1.5rem;
          margin-bottom: 1.25rem;
        }

        .benefit-identity h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--primary, #1f2937);
        }

        .benefit-badges {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .type-badge,
        .onetime-badge,
        .recurring-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .type-badge {
          background: #f3f4f6;
          color: #374151;
        }

        .onetime-badge {
          background: #fef3c7;
          color: #92400e;
        }

        .recurring-badge {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .aggregated-stats {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          text-align: right;
        }

        .total-stats,
        .utilization-stat {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
        }

        .stat-value {
          font-size: 1.125rem;
          font-weight: 600;
          color: #059669;
        }

        .current-period-highlight {
          padding: 1rem;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 0.5rem;
          margin-bottom: 1.25rem;
        }

        .current-period-highlight h4 {
          margin: 0 0 0.75rem 0;
          font-size: 0.875rem;
          font-weight: 600;
          color: #166534;
        }

        .periods-section h4,
        .overall-notes h4 {
          margin: 0 0 0.75rem 0;
          font-size: 0.875rem;
          font-weight: 600;
          color: #374151;
        }

        .periods-list > .containsMany-field {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .overall-notes {
          margin-top: 1.25rem;
          padding-top: 1rem;
          border-top: 1px solid #f3f4f6;
          font-size: 0.8125rem;
          line-height: 1.5;
          color: #6b7280;
        }
      </style>
    </template>
  };
}

/**
 * RewardCardTracker
 * Main tracker that links to a reward card program and tracks benefit redemptions
 */
export class RewardCardTracker extends CardDef {
  // ²⁵ Main tracker
  static displayName = 'Reward Card Tracker';

  @field cardProgram = linksTo(RewardCardProgram); // ²⁶ Link to the card program being tracked
  @field trackerName = contains(StringField); // ²⁷ Custom name for this tracker instance
  @field cardholderName = contains(StringField); // ²⁸ Name of cardholder
  @field accountOpenDate = contains(DateField); // ²⁹ When account was opened
  @field trackingStartDate = contains(DateField); // ³⁰ When tracking began
  @field benefitTracking = containsMany(BenefitTrackingField); // ³¹ Individual benefit tracking
  @field generalNotes = contains(MarkdownField); // ³² Overall tracker notes

  // ³³ Override inherited title
  @field title = contains(StringField, {
    computeVia: function (this: RewardCardTracker) {
      try {
        const programName = this.cardProgram?.cardName ?? 'Card Program';
        const trackerName = this.trackerName ?? 'Tracker';
        return `${trackerName} - ${programName}`;
      } catch (e) {
        return 'Reward Card Tracker';
      }
    },
  });

  // ³⁴ Computed summary statistics
  get totalValueTracked() {
    try {
      return (
        this.benefitTracking?.reduce((total, benefit) => {
          return total + benefit.totalValueAvailable;
        }, 0) ?? 0
      );
    } catch (e) {
      return 0;
    }
  }

  get totalValueRedeemed() {
    try {
      return (
        this.benefitTracking?.reduce((total, benefit) => {
          return total + benefit.totalValueRedeemed;
        }, 0) ?? 0
      );
    } catch (e) {
      return 0;
    }
  }

  get overallRedemptionRate() {
    try {
      const total = this.totalValueTracked;
      if (total === 0) return 0;
      return Math.round((this.totalValueRedeemed / total) * 100);
    } catch (e) {
      return 0;
    }
  }

  get activeBenefitsCount() {
    try {
      const now = new Date();
      return (
        this.benefitTracking?.filter((benefit) => {
          return benefit.trackingPeriods?.some((period) => {
            if (!period.periodEndDate) return true;
            return new Date(period.periodEndDate) >= now;
          });
        }).length ?? 0
      );
    } catch (e) {
      return 0;
    }
  }

  // ³⁵ Computed: Auto-enumerate all benefits from linked program
  get allAvailableBenefits() {
    try {
      if (!this.cardProgram) return [];

      const benefits = [];

      // ³⁶ Statement benefits (credits, access)
      if (this.cardProgram.statementBenefits) {
        this.cardProgram.statementBenefits.forEach((benefit) => {
          benefits.push({
            benefitName: benefit.name,
            benefitType: benefit.benefitKind || 'statement-credit',
            isOneTime: false,
            partner: benefit.partner,
            amount: benefit.amount,
            currency: benefit.currency,
            timePeriod: benefit.timePeriod,
            conditions: benefit.conditions,
            enrollmentRequired: benefit.enrollmentRequired,
            source: 'statement-benefit',
          });
        });
      }

      // ³⁷ Membership benefits (status, elite)
      if (this.cardProgram.membershipBenefits) {
        this.cardProgram.membershipBenefits.forEach((benefit) => {
          benefits.push({
            benefitName:
              benefit.name ||
              `${benefit.membershipProgram} ${benefit.statusLevel}`,
            benefitType: 'membership',
            isOneTime: false,
            partner: benefit.partner,
            amount: benefit.amount,
            currency: benefit.currency,
            timePeriod: benefit.timePeriod,
            conditions: benefit.conditions || benefit.enrollmentInstructions,
            enrollmentRequired: benefit.enrollmentRequired,
            source: 'membership-benefit',
          });
        });
      }

      // ³⁸ Signup bonus (one-time)
      if (this.cardProgram.signupBonus) {
        const bonus = this.cardProgram.signupBonus;
        benefits.push({
          benefitName: 'Welcome Bonus',
          benefitType: bonus.bonusType || 'points',
          isOneTime: true,
          partner: 'Card Issuer',
          amount: bonus.pointsAmount || 0,
          currency: bonus.bonusCurrency,
          timePeriod: null,
          conditions: `Spend ${bonus.spendRequirementAmount} ${bonus.spendRequirementCurrency} in ${bonus.spendWindowDays} days`,
          enrollmentRequired: false,
          source: 'signup-bonus',
        });
      }

      // ³⁹ Other benefits (special features)
      if (this.cardProgram.otherBenefits) {
        this.cardProgram.otherBenefits.forEach((benefit) => {
          benefits.push({
            benefitName: benefit.name,
            benefitType: benefit.benefitType || 'special',
            isOneTime: false,
            partner: 'Various',
            amount: benefit.maxValue,
            currency: benefit.maxValueUnit,
            timePeriod: benefit.timePeriod,
            conditions: benefit.conditions,
            enrollmentRequired: false,
            source: 'other-benefit',
          });
        });
      }

      // ⁵⁰ Earning Rules (points multipliers)
      if (this.cardProgram.earningRules) {
        this.cardProgram.earningRules.forEach((rule) => {
          benefits.push({
            benefitName: `${rule.rateMultiplier}x on ${rule.category}`,
            benefitType: 'earning-rate',
            isOneTime: false,
            partner: rule.appliesTo,
            amount: null,
            currency: null,
            timePeriod: rule.capPeriod,
            conditions: rule.conditions,
            enrollmentRequired: false,
            source: 'earning-rule',
          });
        });
      }

      return benefits;
    } catch (e) {
      console.error('RewardCardTracker: Error enumerating benefits', e);
      return [];
    }
  }

  // ⁴⁰ Computed: Benefits with user annotations merged
  get benefitsWithAnnotations() {
    try {
      const availableBenefits = this.allAvailableBenefits;
      const userTracking = this.benefitTracking || [];

      return availableBenefits.map((benefit) => {
        // ⁴¹ Find matching user tracking annotation
        const userAnnotation = userTracking.find(
          (tracking) =>
            tracking.benefitName === benefit.benefitName ||
            (tracking.benefitName &&
              benefit.benefitName &&
              tracking.benefitName
                .toLowerCase()
                .includes(benefit.benefitName.toLowerCase())) ||
            benefit.benefitName
              .toLowerCase()
              .includes(tracking.benefitName.toLowerCase()),
        );

        return {
          ...benefit,
          hasUserTracking: !!userAnnotation,
          userTracking: userAnnotation,
          // ⁴² Computed tracking stats from user data
          totalRedeemed: userAnnotation?.totalValueRedeemed || 0,
          utilizationRate: userAnnotation?.overallUtilization || 0,
          currentPeriodActive: !!userAnnotation?.currentPeriod,
          userNotes: userAnnotation?.overallNotes,
        };
      });
    } catch (e) {
      console.error('RewardCardTracker: Error merging annotations', e);
      return [];
    }
  }

  // ⁴³ Computed: Benefits missing user tracking
  get untrackedBenefits() {
    try {
      return this.benefitsWithAnnotations.filter(
        (benefit) => !benefit.hasUserTracking,
      );
    } catch (e) {
      return [];
    }
  }

  // ⁴⁴ Computed: Summary statistics
  get benefitsSummary() {
    try {
      const total = this.allAvailableBenefits.length;
      const tracked = this.benefitsWithAnnotations.filter(
        (b) => b.hasUserTracking,
      ).length;
      const oneTime = this.allAvailableBenefits.filter(
        (b) => b.isOneTime,
      ).length;
      const recurring = total - oneTime;

      return {
        totalBenefits: total,
        trackedBenefits: tracked,
        untrackedBenefits: total - tracked,
        oneTimeBenefits: oneTime,
        recurringBenefits: recurring,
        trackingCompleteness:
          total > 0 ? Math.round((tracked / total) * 100) : 0,
      };
    } catch (e) {
      return {
        totalBenefits: 0,
        trackedBenefits: 0,
        untrackedBenefits: 0,
        oneTimeBenefits: 0,
        recurringBenefits: 0,
        trackingCompleteness: 0,
      };
    }
  }

  // ⁴⁵ Templates to display the automatic tracking
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='reward-tracker'>
        <header class='tracker-header'>
          <h1>{{@model.title}}</h1>

          {{#if @model.cardProgram}}
            <div class='linked-program'>
              <strong>Tracking Program:</strong>
              {{@model.cardProgram.cardName}}
            </div>
          {{/if}}

          <div class='tracker-meta'>
            {{#if @model.cardholderName}}
              <div>Cardholder: {{@model.cardholderName}}</div>
            {{/if}}
            {{#if @model.accountOpenDate}}
              <div>Account Opened:
                {{formatDateTime @model.accountOpenDate size='medium'}}</div>
            {{/if}}
          </div>
        </header>

        {{! ⁴⁶ Benefits Summary Statistics }}
        <section class='benefits-summary'>
          <h2>Benefits Overview</h2>
          <div class='summary-stats'>
            <div class='stat-card'>
              <div
                class='stat-value'
              >{{this.benefitsSummary.totalBenefits}}</div>
              <div class='stat-label'>Total Benefits Available</div>
            </div>
            <div class='stat-card'>
              <div
                class='stat-value'
              >{{this.benefitsSummary.trackedBenefits}}</div>
              <div class='stat-label'>Benefits Being Tracked</div>
            </div>
            <div class='stat-card'>
              <div
                class='stat-value'
              >{{this.benefitsSummary.trackingCompleteness}}%</div>
              <div class='stat-label'>Tracking Completeness</div>
            </div>
            <div class='stat-card'>
              <div class='stat-value'>{{formatCurrency
                  this.totalValueRedeemed
                  currency='USD'
                }}</div>
              <div class='stat-label'>Total Value Redeemed</div>
            </div>
          </div>
        </section>

        {{! ⁴⁷ Auto-Discovered Benefits with Tracking Status }}
        <section class='auto-benefits'>
          <h2>All Available Benefits</h2>
          <p class='section-description'>
            These benefits are automatically discovered from your linked
            {{@model.cardProgram.cardName}}
            program. You can add manual tracking for any benefit by creating
            entries in the "Benefit Tracking" section below.
          </p>

          {{#if (gt this.allAvailableBenefits.length 0)}}
            <div class='benefits-grid'>
              {{#each
                this.benefitsWithAnnotations key='benefitName'
                as |benefit|
              }}
                <div
                  class='benefit-card
                    {{if benefit.hasUserTracking "tracked" "untracked"}}'
                >
                  <div class='benefit-header'>
                    <h3>{{benefit.benefitName}}</h3>
                    {{#if benefit.hasUserTracking}}
                      <span class='tracking-badge tracked'>Being Tracked</span>
                    {{else}}
                      <span class='tracking-badge untracked'>Not Tracked</span>
                    {{/if}}
                  </div>

                  <div class='benefit-details'>
                    <div class='benefit-type'>{{benefit.benefitType}}</div>
                    {{#if benefit.partner}}
                      <div class='benefit-partner'>Partner:
                        {{benefit.partner}}</div>
                    {{/if}}
                    {{#if benefit.amount}}
                      <div class='benefit-value'>
                        {{formatCurrency
                          benefit.amount
                          currency=benefit.currency
                        }}
                        {{#if benefit.timePeriod}}
                          {{#if benefit.timePeriod.unit}}per
                            {{benefit.timePeriod.unit}}{{/if}}
                        {{/if}}
                      </div>
                    {{/if}}
                  </div>

                  {{#if benefit.hasUserTracking}}
                    <div class='tracking-stats'>
                      <div class='redeemed-amount'>
                        Redeemed:
                        {{formatCurrency benefit.totalRedeemed currency='USD'}}
                      </div>
                      <div class='utilization-rate'>
                        Utilization:
                        {{benefit.utilizationRate}}%
                      </div>
                    </div>
                  {{/if}}

                  {{#if benefit.conditions}}
                    <div class='benefit-conditions'>{{benefit.conditions}}</div>
                  {{/if}}
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class='empty-state'>
              No benefits automatically discovered. Ensure your card program is
              properly linked.
            </div>
          {{/if}}
        </section>

        {{! ⁴⁸ User's Manual Benefit Tracking }}
        {{#if (gt @model.benefitTracking.length 0)}}
          <section class='manual-tracking'>
            <h2>Your Benefit Tracking</h2>
            <div class='tracking-container'>
              <@fields.benefitTracking @format='embedded' />
            </div>
          </section>
        {{else}}
          <section class='manual-tracking'>
            <h2>Your Benefit Tracking</h2>
            <div class='empty-tracking'>
              <p>No manual tracking entries yet. Add tracking for specific
                benefits to monitor redemption progress.</p>
            </div>
          </section>
        {{/if}}

        {{#if @model.generalNotes}}
          <section class='general-notes'>
            <h2>General Notes</h2>
            <div class='notes-content'>
              {{@model.generalNotes}}
            </div>
          </section>
        {{/if}}
      </div>

      <style scoped>
        /* ⁴⁹ Reward tracker styles */
        .reward-tracker {
          max-width: 72rem;
          margin: 0 auto;
          padding: 2rem;
          font-family: 'Inter', sans-serif;
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .tracker-header {
          margin-bottom: 2rem;
          padding-bottom: 1.5rem;
          border-bottom: 2px solid #e2e8f0;
        }

        .tracker-header h1 {
          font-size: 2rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 1rem 0;
        }

        .linked-program {
          font-size: 1rem;
          color: #374151;
          margin-bottom: 0.75rem;
        }

        .tracker-meta {
          display: flex;
          gap: 2rem;
          font-size: 0.875rem;
          color: #6b7280;
        }

        /* Summary statistics */
        .benefits-summary {
          margin-bottom: 3rem;
        }

        .benefits-summary h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 1rem 0;
        }

        .summary-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }

        .stat-card {
          padding: 1.25rem;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          text-align: center;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #059669;
          margin-bottom: 0.25rem;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        /* Auto-discovered benefits */
        .auto-benefits {
          margin-bottom: 3rem;
        }

        .auto-benefits h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 0.5rem 0;
        }

        .section-description {
          color: #6b7280;
          margin-bottom: 1.5rem;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .benefits-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1rem;
        }

        .benefit-card {
          padding: 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          background: #fefefe;
        }

        .benefit-card.tracked {
          border-color: #10b981;
          background: #f0fdf4;
        }

        .benefit-card.untracked {
          border-color: #f59e0b;
          background: #fffbeb;
        }

        .benefit-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .benefit-header h3 {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
          flex: 1;
        }

        .tracking-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .tracking-badge.tracked {
          background: #dcfce7;
          color: #166534;
        }

        .tracking-badge.untracked {
          background: #fef3c7;
          color: #92400e;
        }

        .benefit-details {
          margin-bottom: 0.75rem;
        }

        .benefit-type {
          font-size: 0.75rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
          text-transform: capitalize;
        }

        .benefit-partner {
          font-size: 0.75rem;
          color: #6b7280;
          font-style: italic;
          margin-bottom: 0.25rem;
        }

        .benefit-value {
          font-size: 0.875rem;
          font-weight: 600;
          color: #059669;
        }

        .tracking-stats {
          padding: 0.75rem;
          background: #f0fdf4;
          border-radius: 0.25rem;
          margin-bottom: 0.75rem;
          border: 1px solid #bbf7d0;
        }

        .redeemed-amount,
        .utilization-rate {
          font-size: 0.75rem;
          color: #166534;
          margin-bottom: 0.25rem;
        }

        .benefit-conditions {
          font-size: 0.6875rem;
          color: #6b7280;
          line-height: 1.3;
          border-top: 1px solid #f3f4f6;
          padding-top: 0.5rem;
        }

        /* Manual tracking section */
        .manual-tracking {
          margin-bottom: 3rem;
        }

        .manual-tracking h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 1rem 0;
        }

        .tracking-container > .containsMany-field {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .empty-tracking {
          padding: 2rem;
          text-align: center;
          background: #f8fafc;
          border: 1px dashed #d1d5db;
          border-radius: 0.5rem;
          color: #6b7280;
        }

        .empty-state {
          padding: 2rem;
          text-align: center;
          background: #f8fafc;
          border: 1px dashed #d1d5db;
          border-radius: 0.5rem;
          color: #6b7280;
        }

        /* General notes */
        .general-notes h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 1rem 0;
        }

        .notes-content {
          padding: 1rem;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          line-height: 1.5;
          color: #374151;
        }

        /* Responsive design */
        @media (max-width: 768px) {
          .reward-tracker {
            padding: 1rem;
          }

          .tracker-meta {
            flex-direction: column;
            gap: 0.5rem;
          }

          .summary-stats {
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          }

          .benefits-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };
}
