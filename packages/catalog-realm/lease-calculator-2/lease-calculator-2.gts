import {
  CardDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Component } from 'https://cardstack.com/base/card-api';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import CarIcon from '@cardstack/boxel-icons/car';
import TagIcon from '@cardstack/boxel-icons/tag';
import DollarSignIcon from '@cardstack/boxel-icons/currency-dollar';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { currencyFormat, eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';

class Isolated extends Component<typeof LeaseFinanceCalculator> {
  @tracked showAdditionalDetails = false;

  @action toggleAdditionalDetails() {
    this.showAdditionalDetails = !this.showAdditionalDetails;
  }

  get isLease() {
    return eq(this.args.model.calculatorMode, 'Lease');
  }

  get effectiveMonthlyPayment() {
    return this.isLease
      ? Number(this.args.model.leaseEffectiveMonthlyCost)
      : Number(this.args.model.financeEffectiveMonthlyCost);
  }

  get monthlyPayment() {
    return this.isLease
      ? Number(this.args.model.leasePostTaxMonthlyPayment)
      : Number(this.args.model.financeMonthlyPayment);
  }

  get dueAtSigning() {
    return this.isLease
      ? Number(this.args.model.leaseDueAtSigning)
      : Number(this.args.model.financeDueAtSigning);
  }

  get leasehackrScore() {
    return this.args.model.leasehackrScore;
  }

  <template>
    <div class='calculator-wrapper'>
      <div class='header'>
        <div class='vehicle-details'>
          <CarIcon
            width='32'
            height='32'
            fill='none'
            stroke='var(--brand-color)'
            stroke-width='1.5'
          />
          <div class='vehicle-info'>
            <h1>{{@model.title}}</h1>
            <div class='vehicle-meta'>{{@model.vehicleMake}}
              {{@model.rateFindrModel}}
              {{@model.rateFindrTrim}}</div>
          </div>
        </div>

      </div>

      <div class='content'>
        <div class='summary-section'>
          <div class='price-overview'>
            <div class='price-card'>
              <div class='price-header'>Monthly Payment</div>
              <div class='price-value'>{{currencyFormat
                  this.monthlyPayment
                }}</div>
              <div class='price-note'>for
                {{@model.leaseTermMonths}}
                months</div>
            </div>

            <div class='price-card'>
              <div class='price-header'>Due at Signing</div>
              <div class='price-value'>{{currencyFormat
                  this.dueAtSigning
                }}</div>
              <div class='price-note'>includes down payment</div>
            </div>

            <div class='price-card highlight-card'>
              <div class='price-header'>Effective Monthly Cost</div>
              <div class='price-value'>{{currencyFormat
                  this.effectiveMonthlyPayment
                }}</div>
              <div class='price-note'>true monthly expense</div>
            </div>
          </div>

          {{#if this.isLease}}
            <div class='leasehackr-score-card'>
              <div class='leasehackr-label'>LEASEHACKR SCORE</div>
              <div class='leasehackr-value'>{{this.leasehackrScore}}</div>
              <div class='leasehackr-explainer'>Higher is better. 8+ years is
                excellent.</div>
            </div>
          {{/if}}

          <div class='vehicle-details-section'>
            <h2>Vehicle Details</h2>
            <div class='details-grid'>
              <div class='detail-item'>
                <TagIcon
                  width='20'
                  height='20'
                  fill='none'
                  stroke='var(--secondary-color)'
                  stroke-width='1.5'
                />
                <div class='detail-content'>
                  <div class='detail-label'>MSRP</div>
                  <div class='detail-value'>{{currencyFormat
                      (Number @model.msrp)
                    }}</div>
                </div>
              </div>

              <div class='detail-item'>
                <DollarSignIcon
                  width='20'
                  height='20'
                  fill='none'
                  stroke='var(--secondary-color)'
                  stroke-width='1.5'
                />
                <div class='detail-content'>
                  <div class='detail-label'>Selling Price</div>
                  <div class='detail-value'>{{currencyFormat
                      (if
                        this.isLease
                        (Number @model.leaseSellingPrice)
                        (Number @model.financeSellingPrice)
                      )
                    }}</div>
                </div>
              </div>

              <div class='detail-item'>
                <DollarSignIcon
                  width='20'
                  height='20'
                  fill='none'
                  stroke='var(--secondary-color)'
                  stroke-width='1.5'
                />
                <div class='detail-content'>
                  <div class='detail-label'>Down Payment</div>
                  <div class='detail-value'>{{currencyFormat
                      (if
                        this.isLease
                        (Number @model.leaseDownPayment)
                        (Number @model.financeDownPayment)
                      )
                    }}</div>
                </div>
              </div>

              <div class='detail-item'>
                <CalendarIcon
                  width='20'
                  height='20'
                  fill='none'
                  stroke='var(--secondary-color)'
                  stroke-width='1.5'
                />
                <div class='detail-content'>
                  <div class='detail-label'>Term</div>
                  <div class='detail-value'>{{if
                      this.isLease
                      @model.leaseTermMonths
                      @model.financeTermMonths
                    }}
                    months</div>
                </div>
              </div>
            </div>
          </div>

          {{#if this.isLease}}
            <div class='lease-details-section'>
              <h2>Lease Details</h2>
              <div class='details-grid'>
                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Residual Value</div>
                    <div
                      class='detail-value'
                    >{{@model.leaseResidualPercentage}}% ({{currencyFormat
                        (Number @model.leaseResidualValue)
                      }})</div>
                  </div>
                </div>

                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Money Factor</div>
                    <div class='detail-value'>{{@model.leaseMoneyFactor}}
                      ({{@model.leaseAPR}}% APR)</div>
                  </div>
                </div>

                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Mileage Allowance</div>
                    <div class='detail-value'>{{@model.leaseMilesPerYear}}
                      miles per year</div>
                  </div>
                </div>

                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Sales Tax Rate</div>
                    <div
                      class='detail-value'
                    >{{@model.leaseSalesTaxRate}}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div class='additional-details'>
              <button
                class='additional-details-toggle'
                {{on 'click' this.toggleAdditionalDetails}}
              >
                <span class='additional-details-label'>
                  <strong>Additional Details</strong>
                  {{if this.showAdditionalDetails '▲' '▼'}}
                </span>
              </button>

              {{#if this.showAdditionalDetails}}
                <div class='additional-details-content'>
                  <div class='micro-details-grid'>
                    <div class='micro-detail-item'>
                      <span class='micro-label'>Acquisition Fee:</span>
                      <span class='micro-value'>{{currencyFormat
                          (Number @model.leaseAcquisitionFee)
                        }}</span>
                    </div>
                    <div class='micro-detail-item'>
                      <span class='micro-label'>Dealer Fees:</span>
                      <span class='micro-value'>{{currencyFormat
                          (Number @model.leaseDealerFees)
                        }}</span>
                    </div>
                    <div class='micro-detail-item'>
                      <span class='micro-label'>Government Fees:</span>
                      <span class='micro-value'>{{currencyFormat
                          (Number @model.leaseGovernmentFees)
                        }}</span>
                    </div>
                    <div class='micro-detail-item'>
                      <span class='micro-label'>Incentives (Taxed):</span>
                      <span class='micro-value'>{{currencyFormat
                          (Number @model.leaseTaxedIncentives)
                        }}</span>
                    </div>
                    <div class='micro-detail-item'>
                      <span class='micro-label'>Incentives (Untaxed):</span>
                      <span class='micro-value'>{{currencyFormat
                          (Number @model.leaseUntaxedIncentives)
                        }}</span>
                    </div>
                    <div class='micro-detail-item'>
                      <span class='micro-label'>Disposition Fee:</span>
                      <span class='micro-value'>{{currencyFormat
                          (Number @model.leaseDispositionFee)
                        }}</span>
                    </div>
                  </div>
                </div>
              {{/if}}
            </div>
          {{else}}
            <div class='finance-details-section'>
              <h2>Finance Details</h2>
              <div class='details-grid'>
                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>APR</div>
                    <div class='detail-value'>{{@model.financeAPR}}%</div>
                  </div>
                </div>

                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Sales Tax Rate</div>
                    <div
                      class='detail-value'
                    >{{@model.financeSalesTaxRate}}%</div>
                  </div>
                </div>

                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Expected Resale</div>
                    <div class='detail-value'>{{currencyFormat
                        (Number @model.financeExpectedResaleValue)
                      }}</div>
                  </div>
                </div>

                <div class='detail-item'>
                  <div class='detail-content'>
                    <div class='detail-label'>Keep Term</div>
                    <div class='detail-value'>{{@model.financeKeepTermMonths}}
                      months</div>
                  </div>
                </div>
              </div>
            </div>
          {{/if}}

          <div class='memo-section'>
            <h3>Notes</h3>
            <div class='memo-content'>{{@model.memo}}</div>
          </div>
        </div>
      </div>

      <div class='footer'>
        <div class='disclaimer'>
          This calculator provides estimated payments for illustrative purposes
          only. Please contact your dealer for actual terms and offers.
        </div>
      </div>
    </div>

    <style scoped>
      .calculator-wrapper {
        --brand-color: #1c69d4;
        --brand-color-dark: #0c4ea0;
        --secondary-color: #4d4d4d;
        --light-bg: #f7f7f7;
        --border-color: #e0e0e0;
        --text-color: #333;
        --subtitle-color: #666;
        --highlight-color: #1c69d4;
        --highlight-bg: #f0f7ff;
        --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);

        font-family: 'BMW Group', 'Helvetica Neue', Arial, sans-serif;
        color: var(--text-color);
        max-width: 1000px;
        margin: 0 auto;
        background-color: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: var(--card-shadow);
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24px 32px;
        border-bottom: 1px solid var(--border-color);
        background-color: white;
      }

      .vehicle-details {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .vehicle-info h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        color: var(--text-color);
      }

      .vehicle-meta {
        color: var(--subtitle-color);
        font-size: 14px;
        margin-top: 4px;
      }

      .calculator-mode {
        display: flex;
        background-color: var(--light-bg);
        border-radius: 6px;
        overflow: hidden;
      }

      .tab {
        padding: 8px 24px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .tab.active {
        background-color: var(--brand-color);
        color: white;
      }

      .content {
        padding: 32px;
      }

      .summary-section {
        display: flex;
        flex-direction: column;
        gap: 32px;
      }

      .price-overview {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 24px;
      }

      .price-card {
        flex: 1;
        min-width: 200px;
        padding: 24px;
        background-color: white;
        border-radius: 8px;
        box-shadow: var(--card-shadow);
        text-align: center;
        border: 1px solid var(--border-color);
      }

      .highlight-card {
        background-color: var(--highlight-bg);
        border: 2px solid var(--brand-color);
        box-shadow: 0 4px 16px rgba(28, 105, 212, 0.15);
      }

      .price-header {
        font-size: 14px;
        color: var(--subtitle-color);
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: 600;
      }

      .price-value {
        font-size: 28px;
        font-weight: 600;
        color: var(--brand-color);
      }

      .price-note {
        font-size: 12px;
        color: var(--subtitle-color);
        margin-top: 8px;
      }

      .leasehackr-score-card {
        background: linear-gradient(135deg, #1c69d4, #0c4ea0);
        padding: 24px;
        border-radius: 8px;
        color: white;
        text-align: center;
        box-shadow: 0 6px 16px rgba(12, 78, 160, 0.25);
      }

      .leasehackr-label {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 1px;
        margin-bottom: 8px;
      }

      .leasehackr-value {
        font-size: 36px;
        font-weight: 700;
        margin: 8px 0;
      }

      .leasehackr-explainer {
        font-size: 12px;
        opacity: 0.85;
      }

      h2 {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border-color);
        color: var(--brand-color-dark);
      }

      h3 {
        font-size: 16px;
        font-weight: 600;
        margin-top: 0;
        margin-bottom: 12px;
        color: var(--brand-color-dark);
      }

      .details-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 24px;
      }

      .detail-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .detail-content {
        flex: 1;
      }

      .detail-label {
        font-size: 12px;
        color: var(--subtitle-color);
        margin-bottom: 4px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .detail-value {
        font-size: 16px;
        color: var(--text-color);
        font-weight: 500;
      }

      .additional-details {
        background-color: #f9f9f9;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--border-color);
      }

      .additional-details-toggle {
        padding: 16px;
        cursor: pointer;
        width: 100%;
        border: none;
      }

      .additional-details-label {
        margin: 0;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
      }

      .additional-details-content {
        padding: 16px;
        border-top: 1px solid var(--border-color);
      }

      .micro-details-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px;
        font-size: 12px;
      }

      .micro-detail-item {
        display: flex;
        justify-content: space-between;
      }

      .micro-label {
        color: var(--subtitle-color);
        font-weight: 500;
      }

      .micro-value {
        font-weight: 600;
      }

      .memo-section {
        background-color: var(--light-bg);
        padding: 24px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
      }

      .memo-content {
        font-size: 14px;
        line-height: 1.5;
        color: var(--text-color);
      }

      .footer {
        background-color: var(--light-bg);
        padding: 16px 32px;
        border-top: 1px solid var(--border-color);
      }

      .disclaimer {
        font-size: 12px;
        color: var(--subtitle-color);
        text-align: center;
      }
    </style>
  </template>
}

export class LeaseFinanceCalculator extends CardDef {
  static displayName = 'Lease/Finance Calculator';

  static isolated = Isolated;

  @field calculatorMode = contains(StringField);
  @field vehicleMake = contains(StringField);
  @field msrp = contains(NumberField);

  @field rateFindrSearchMethod = contains(StringField);
  @field rateFindrModelYear = contains(NumberField);
  @field rateFindrModel = contains(StringField);
  @field rateFindrTrim = contains(StringField);
  @field rateFindrVin = contains(StringField);
  @field rateFindrCountry = contains(StringField);
  @field rateFindrLeaseTerm = contains(NumberField);
  @field rateFindrFinanceTerm = contains(NumberField);
  @field rateFindrMilesPerYear = contains(NumberField);
  @field rateFindrPostalCode = contains(StringField);

  @field rateFindrLeaseOutputVehicleDesc = contains(StringField);
  @field rateFindrLeaseOutputLender = contains(StringField);
  @field rateFindrLeaseOutputTerm = contains(StringField);
  @field rateFindrLeaseOutputMileage = contains(StringField);
  @field rateFindrLeaseOutputZipcode = contains(StringField);
  @field rateFindrLeaseResidualValueOptions = containsMany(StringField);
  @field rateFindrLeaseMoneyFactorOptions = containsMany(StringField);
  @field rateFindrFinanceOutputVehicleDesc = contains(StringField);
  @field rateFindrFinanceOutputLender = contains(StringField);
  @field rateFindrFinanceOutputTerm = contains(StringField);
  @field rateFindrFinanceOutputZipcode = contains(StringField);
  @field rateFindrFinanceAPROptions = containsMany(StringField);
  @field rateFindrGeneralIncentives = containsMany(StringField);
  @field rateFindrConditionalIncentives = containsMany(StringField);
  @field rateFindrDealerIncentives = containsMany(StringField);
  @field leaseSellingPrice = contains(NumberField);
  @field leaseDiscountPercentage = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      if (this.msrp && this.msrp !== 0 && this.leaseSellingPrice != null) {
        try {
          return ((this.msrp - this.leaseSellingPrice) / this.msrp) * 100;
        } catch {
          return 0;
        }
      }
      return 0;
    },
  });
  @field leaseTermMonths = contains(NumberField);
  @field leaseMilesPerYear = contains(NumberField);
  @field leaseResidualPercentage = contains(NumberField);
  @field leaseResidualValue = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      if (this.msrp && this.leaseResidualPercentage != null) {
        try {
          return this.msrp * (this.leaseResidualPercentage / 100);
        } catch {
          return 0;
        }
      }
      return 0;
    },
  });
  @field leaseDemoCarMileage = contains(NumberField);
  @field leaseMoneyFactor = contains(NumberField);
  @field leaseAPR = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      if (this.leaseMoneyFactor != null) {
        try {
          return this.leaseMoneyFactor * 2400;
        } catch {
          return 0;
        }
      }
      return 0;
    },
  });
  @field leaseMSDCount = contains(NumberField);
  @field leaseAcquisitionFeeWaiver = contains(BooleanField);
  @field leaseOnePay = contains(BooleanField);
  @field leaseAdjustedMoneyFactor = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        let mf = this.leaseMoneyFactor ?? 0;
        const msdCount = this.leaseMSDCount ?? 0;

        if (this.vehicleMake === 'BMW' && msdCount > 0) {
          mf -= msdCount * 0.00006;
        }
        if (this.leaseAcquisitionFeeWaiver && this.vehicleMake === 'BMW') {
          mf += 0.0005;
        }
        if (this.leaseOnePay) {
        }
        return Math.max(mf, 0.00001);
      } catch {
        return this.leaseMoneyFactor ?? 0; // Fallback
      }
    },
  });

  // Lease Capitalized Cost Section:
  @field leaseTaxedIncentives = contains(NumberField);
  @field leaseUntaxedIncentives = contains(NumberField);
  @field leaseDownPayment = contains(NumberField);
  @field leaseTradeInEquity = contains(NumberField);
  @field leaseZeroDriveOff = contains(BooleanField);
  @field leaseCapitalizeTaxes = contains(BooleanField);

  // Lease Fees Section:
  @field leaseAcquisitionFee = contains(NumberField);
  @field leasePayAcquisitionFeeUpfront = contains(BooleanField);
  @field leaseDealerFees = contains(NumberField);
  @field leasePayDealerFeesUpfront = contains(BooleanField);
  @field leaseGovernmentFees = contains(NumberField);
  @field leasePayGovernmentFeesUpfront = contains(BooleanField);
  @field leaseServiceFees = contains(NumberField);

  @field leaseSalesTaxRate = contains(NumberField);
  @field leaseTaxMethod = contains(StringField);
  @field leaseIsNewYorkTax = contains(BooleanField);
  @field leaseTaxFeesOnSellingPrice = contains(StringField);

  @field leasePostSaleIncentives = contains(NumberField);
  @field leaseDispositionFee = contains(NumberField);

  @field financeSellingPrice = contains(NumberField);
  @field financeDiscountPercentage = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      if (this.msrp && this.msrp !== 0 && this.financeSellingPrice != null) {
        try {
          return ((this.msrp - this.financeSellingPrice) / this.msrp) * 100;
        } catch {
          return 0;
        }
      }
      return 0;
    },
  });

  @field financeTaxableFees = contains(NumberField);
  @field financeUntaxedFees = contains(NumberField);
  @field financeSalesTaxRate = contains(NumberField);

  @field financeTermMonths = contains(NumberField);
  @field financeAPR = contains(NumberField);

  @field financeManufacturerRebates = contains(NumberField);
  @field financeDownPayment = contains(NumberField);
  @field financeTradeInEquity = contains(NumberField);

  @field financePostSaleIncentives = contains(NumberField);

  @field financeKeepTermMonths = contains(NumberField);
  @field financeExpectedResaleValue = contains(NumberField);
  @field financeExpectedResalePercentage = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      if (
        this.msrp &&
        this.msrp !== 0 &&
        this.financeExpectedResaleValue != null
      ) {
        try {
          return (this.financeExpectedResaleValue / this.msrp) * 100;
        } catch {
          return 0;
        }
      }
      return 0;
    },
  });

  @field memo = contains(TextAreaField);

  @field leasePreTaxMonthlyPayment = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const sellingPrice = this.leaseSellingPrice ?? 0;
        const untaxedIncentives = this.leaseUntaxedIncentives ?? 0;
        const taxedIncentives = this.leaseTaxedIncentives ?? 0;
        const downPayment = this.leaseDownPayment ?? 0;
        const tradeInEquity = this.leaseTradeInEquity ?? 0;
        const residualValue = this.leaseResidualValue ?? 0;
        const term = this.leaseTermMonths ?? 36;
        const adjustedMF = this.leaseAdjustedMoneyFactor ?? 0;

        let capitalizedFees = 0;
        if (!this.leasePayAcquisitionFeeUpfront) {
          capitalizedFees += this.leaseAcquisitionFee ?? 0;
        }
        if (!this.leasePayDealerFeesUpfront) {
          capitalizedFees += this.leaseDealerFees ?? 0;
        }
        if (!this.leasePayGovernmentFeesUpfront) {
          capitalizedFees += this.leaseGovernmentFees ?? 0;
        }

        const netCapCost =
          sellingPrice -
          untaxedIncentives -
          taxedIncentives -
          downPayment -
          tradeInEquity +
          capitalizedFees;

        if (term === 0) return 0;

        const depreciationFee = (netCapCost - residualValue) / term;
        const financeFee = (netCapCost + residualValue) * adjustedMF;
        const payment = depreciationFee + financeFee;
        return Math.round(payment * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
  @field leasePostTaxMonthlyPayment = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const preTaxPmt = this.leasePreTaxMonthlyPayment ?? 0;
        const taxRate = this.leaseSalesTaxRate ?? 0;
        if (
          this.leaseTaxMethod === 'MonthlyPayment' &&
          !this.leaseCapitalizeTaxes &&
          !this.leaseZeroDriveOff
        ) {
          return Math.round(preTaxPmt * (1 + taxRate / 100) * 100) / 100;
        }
        return preTaxPmt;
      } catch {
        return 0;
      }
    },
  });
  @field leaseDueAtSigning = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        let upfrontFees = 0;
        if (this.leasePayAcquisitionFeeUpfront) {
          upfrontFees += this.leaseAcquisitionFee ?? 0;
        }
        if (this.leasePayDealerFeesUpfront) {
          upfrontFees += this.leaseDealerFees ?? 0;
        }
        if (this.leasePayGovernmentFeesUpfront) {
          upfrontFees += this.leaseGovernmentFees ?? 0;
        }

        const downPayment = this.leaseDownPayment ?? 0;
        const firstMonthPayment = this.leasePostTaxMonthlyPayment ?? 0;

        let upfrontTax = 0;
        const taxRate = (this.leaseSalesTaxRate ?? 0) / 100;
        const taxedIncentives = this.leaseTaxedIncentives ?? 0;

        if (
          this.leaseTaxMethod === 'MonthlyPayment' &&
          !this.leaseCapitalizeTaxes &&
          !this.leaseZeroDriveOff
        ) {
          let taxableUpfrontItems = downPayment + taxedIncentives;
          if (this.leasePayDealerFeesUpfront) {
            taxableUpfrontItems += this.leaseDealerFees ?? 0;
          }
          if (this.leasePayAcquisitionFeeUpfront) {
            taxableUpfrontItems += this.leaseAcquisitionFee ?? 0;
          }
          upfrontTax = taxableUpfrontItems * taxRate;
        }

        const das =
          firstMonthPayment +
          downPayment +
          upfrontFees +
          upfrontTax -
          (this.leaseTradeInEquity ?? 0);
        return Math.round(das * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
  @field leaseMSDPaymentRefundable = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const msdCount = this.leaseMSDCount ?? 0;
        if (msdCount === 0) return 0;

        const baseMonthlyPayment = this.leasePostTaxMonthlyPayment ?? 0;
        let roundingFactor = 50;

        if (
          this.vehicleMake === 'Toyota' ||
          this.vehicleMake === 'Lexus' ||
          this.vehicleMake === 'Mazda' ||
          this.vehicleMake === 'Audi'
        ) {
          roundingFactor = 25;
        }

        const singleMsdPayment =
          Math.ceil(baseMonthlyPayment / roundingFactor) * roundingFactor;
        return singleMsdPayment * msdCount;
      } catch {
        return 0;
      }
    },
  });
  @field leaseTotalCost = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const term = this.leaseTermMonths ?? 0;
        if (term === 0) return 0;

        const monthlyPayment = this.leasePostTaxMonthlyPayment ?? 0;
        let totalCost =
          monthlyPayment * term +
          (this.leaseDownPayment ?? 0) +
          (this.leaseAcquisitionFee ?? 0) +
          (this.leaseDealerFees ?? 0) +
          (this.leaseGovernmentFees ?? 0);
        totalCost -=
          (this.leaseTaxedIncentives ?? 0) +
          (this.leaseUntaxedIncentives ?? 0) +
          (this.leaseTradeInEquity ?? 0);
        totalCost += this.leaseDispositionFee ?? 0;
        totalCost += this.leaseServiceFees ?? 0;
        totalCost -= this.leasePostSaleIncentives ?? 0;

        const totalCostCalc =
          monthlyPayment * (term - (this.leaseOnePay ? term : 1)) +
          (this.leaseDueAtSigning ?? 0) +
          (this.leaseDispositionFee ?? 0) +
          (this.leaseServiceFees ?? 0) -
          (this.leasePostSaleIncentives ?? 0);

        return Math.round(totalCostCalc * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
  @field leaseEffectiveMonthlyCost = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const totalCost = this.leaseTotalCost ?? 0;
        const term = this.leaseTermMonths ?? 0;
        if (term === 0) return 0;
        return Math.round((totalCost / term) * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
  @field leasehackrScore = contains(StringField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const msrp = this.msrp ?? 0;
        const effectiveMonthlyCost = this.leaseEffectiveMonthlyCost ?? 0;
        const taxRate = this.leaseSalesTaxRate ?? 0;

        if (effectiveMonthlyCost === 0) return 'N/A';

        const msrpWithTax = msrp * (1 + taxRate / 100);
        const score = msrpWithTax / effectiveMonthlyCost / 12;
        return score.toFixed(1) + ' years';
      } catch {
        return 'N/A';
      }
    },
  });

  @field financeMonthlyPayment = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const sellingPrice = this.financeSellingPrice ?? 0;
        const taxableFees = this.financeTaxableFees ?? 0;
        const untaxedFees = this.financeUntaxedFees ?? 0;
        const salesTaxRate = (this.financeSalesTaxRate ?? 0) / 100;
        const downPayment = this.financeDownPayment ?? 0;
        const manufacturerRebates = this.financeManufacturerRebates ?? 0;
        const tradeInEquity = this.financeTradeInEquity ?? 0; // Positive value reduces loan amount

        const apr = (this.financeAPR ?? 0) / 100;
        const termMonths = this.financeTermMonths ?? 0;

        if (termMonths === 0) return 0;

        const taxOnPriceAndTaxableFees =
          (sellingPrice + taxableFees) * salesTaxRate;
        const totalAmountToFinanceBeforeDownPayments =
          sellingPrice + taxableFees + untaxedFees + taxOnPriceAndTaxableFees;
        const loanAmount =
          totalAmountToFinanceBeforeDownPayments -
          downPayment -
          manufacturerRebates -
          tradeInEquity;

        if (loanAmount <= 0) return 0;

        const monthlyRate = apr / 12;

        if (monthlyRate === 0) {
          return Math.round((loanAmount / termMonths) * 100) / 100;
        }

        const payment =
          (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
          (Math.pow(1 + monthlyRate, termMonths) - 1);
        return Math.round(payment * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
  @field financeDueAtSigning = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      return this.financeDownPayment ?? 0;
    },
  });
  @field financeTotalCost = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const monthlyPayment = this.financeMonthlyPayment ?? 0;
        const keepTermMonths =
          this.financeKeepTermMonths ?? this.financeTermMonths ?? 0;
        const downPayment = this.financeDownPayment ?? 0;
        const expectedResaleValue = this.financeExpectedResaleValue ?? 0;
        const postSaleIncentives = this.financePostSaleIncentives ?? 0;

        const totalPaymentsMade = monthlyPayment * keepTermMonths;
        const totalCost =
          downPayment +
          totalPaymentsMade -
          expectedResaleValue -
          postSaleIncentives;

        return Math.round(totalCost * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
  @field financeEffectiveMonthlyCost = contains(NumberField, {
    computeVia: function (this: LeaseFinanceCalculator) {
      try {
        const totalCost = this.financeTotalCost ?? 0;
        const keepTermMonths =
          this.financeKeepTermMonths ?? this.financeTermMonths ?? 0;
        if (keepTermMonths === 0) return 0;
        return Math.round((totalCost / keepTermMonths) * 100) / 100;
      } catch {
        return 0;
      }
    },
  });
}
