import { and } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { subtract, multiply, divide, gt } from '@cardstack/boxel-ui/helpers';
import { currencyFormat } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

function round(value: number | undefined | null, decimals: number = 0): number {
  if (value === undefined || value === null) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundCurrency(value: number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return round(value, 2);
}

function roundMF(value: number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return round(value, 7);
}

export class LeaseCalculator extends CardDef {
  static displayName = 'Lease Calculator';

  static isolated = class Isolated extends Component<typeof LeaseCalculator> {
    get brandColors() {
      const make = this.args.model.vehicleMake?.toUpperCase() ?? '';
      // Default BMW colors
      let colors = {
        '--brand-blue': '#1c69d4',
        '--brand-dark-blue': '#0653b6',
        '--brand-black': '#262626',
        '--brand-gray': '#6d6d6d',
        '--brand-light-gray': '#f2f2f2',
        '--brand-white': '#ffffff',
        '--brand-accent': '#4c84c3',
      };
      if (make.includes('MERCEDES')) {
        colors = {
          '--brand-blue': '#26327c',
          '--brand-dark-blue': '#1a1f4c',
          '--brand-black': '#222222',
          '--brand-gray': '#888888',
          '--brand-light-gray': '#f5f5f5',
          '--brand-white': '#ffffff',
          '--brand-accent': '#b6b6b6',
        };
      } else if (make.includes('AUDI')) {
        colors = {
          '--brand-blue': '#bb0a30',
          '--brand-dark-blue': '#7c071f',
          '--brand-black': '#232323',
          '--brand-gray': '#8e8e8e',
          '--brand-light-gray': '#f4f4f4',
          '--brand-white': '#ffffff',
          '--brand-accent': '#c7c7c7',
        };
      } else if (make.includes('TOYOTA')) {
        colors = {
          '--brand-blue': '#000000',
          '--brand-dark-blue': '#000000',
          '--brand-black': '#000000',
          '--brand-gray': '#000000',
          '--brand-light-gray': '#f4f4f4',
          '--brand-white': '#ffffff',
          '--brand-accent': '#ffffff',
        };
      }
      // Add more brands as needed
      return htmlSafe(
        Object.entries(colors)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; '),
      );
    }

    get brandLogoUrl() {
      const make = this.args.model.vehicleMake?.toUpperCase() ?? '';
      if (make.includes('MERCEDES')) {
        return 'https://upload.wikimedia.org/wikipedia/commons/9/90/Mercedes-Logo.svg';
      } else if (make.includes('AUDI')) {
        return 'https://upload.wikimedia.org/wikipedia/commons/9/92/Audi-Logo_2016.svg';
      } else if (make.includes('TOYOTA')) {
        return 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Toyota.svg';
      }
      return 'https://upload.wikimedia.org/wikipedia/commons/f/f4/BMW_logo_%28gray%29.svg';
    }

    get vehicleImageUrl() {
      const make = this.args.model.vehicleMake?.toUpperCase() ?? '';
      if (make.includes('MERCEDES')) {
        return 'https://images.unsplash.com/photo-1621349337628-d4f1c1a24114?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
      } else if (make.includes('AUDI')) {
        return 'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?auto=format&fit=crop&w=800&q=80';
      } else if (make.includes('TOYOTA')) {
        return 'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=800&q=80';
      }
      return 'https://media.ed.edmunds-media.com/bmw/x3/2025/oem/2025_bmw_x3_4dr-suv_30-xdrive_fq_oem_1_815.jpg';
    }

    <template>
      <div class='lease-calculator' style={{this.brandColors}}>
        <header class='header'>
          <div class='branding'>
            <div
              class='logo'
              style={{htmlSafe
                (concat "background-image: url('" this.brandLogoUrl "');")
              }}
            ></div>
            <h2 class='title'>Lease Payment Calculator</h2>
          </div>
          {{#if @model.vehicleMake}}
            <h1 class='vehicle-name'>{{@model.vehicleMake}}
              {{#if @model.title}}{{@model.title}}{{else}}Lease Details{{/if}}</h1>
          {{/if}}
        </header>

        <div class='content-container'>
          <div class='vehicle-summary'>
            <div class='vehicle-image-container'>
              <div
                class='vehicle-image'
                style={{htmlSafe
                  (concat "background-image: url('" this.vehicleImageUrl "');")
                }}
              ></div>
              <div class='msrp-tag'>
                <div class='msrp-label'>MSRP</div>
                <div class='msrp-value'>{{currencyFormat
                    (Number @model.msrp)
                    'USD'
                  }}</div>
              </div>
            </div>

            <div class='key-details'>
              <div class='detail-row'>
                <div class='detail-label'>Your Price</div>
                <div class='detail-value'>{{currencyFormat
                    (Number @model.sellingPriceLease)
                    'USD'
                  }}</div>
                <div class='detail-notes'>
                  {{#if @model.sellingPriceOffMsrpLeasePercent}}
                    ({{@model.sellingPriceOffMsrpLeasePercent}}% off MSRP)
                  {{else}}
                    {{#if (and @model.msrp @model.sellingPriceLease)}}
                      ({{round
                        (multiply
                          (divide
                            (subtract
                              (Number @model.msrp)
                              (Number @model.sellingPriceLease)
                            )
                            (Number @model.msrp)
                          )
                          100
                        )
                        1
                      }}% off MSRP)
                    {{/if}}
                  {{/if}}
                </div>
              </div>

              <div class='detail-row'>
                <div class='detail-label'>Lease Term</div>
                <div class='detail-value'>{{@model.leaseTerm}} months</div>
              </div>

              <div class='detail-row'>
                <div class='detail-label'>Annual Mileage</div>
                <div class='detail-value'>{{@model.annualMileageLease}}
                  miles</div>
              </div>

              <div class='detail-row'>
                <div class='detail-label'>Residual Value</div>
                <div
                  class='detail-value'
                >{{@model.residualValueLeasePercent}}%</div>
                <div class='detail-notes'>({{currencyFormat
                    (Number @model.adjustedResidualValueLeaseCurrency)
                    'USD'
                  }})</div>
              </div>
            </div>
          </div>

          <div class='payment-summary'>
            <div class='monthly-payment'>
              <div class='payment-label'>Monthly Lease Payment</div>
              <div class='payment-value'>{{currencyFormat
                  (Number @model.postTaxMonthlyPaymentLease)
                  'USD'
                }}</div>
              <div class='payment-details'>
                <div class='payment-breakdown'>
                  <div>
                    <span class='breakdown-label'>Base Payment</span>
                    <span class='breakdown-value'>{{currencyFormat
                        (Number @model.preTaxMonthlyPaymentLease)
                        'USD'
                      }}</span>
                  </div>
                  <div>
                    <span class='breakdown-label'>Tax ({{@model.salesTaxRateLease}}%)</span>
                    <span class='breakdown-value'>{{currencyFormat
                        (Number @model.monthlyTaxLease)
                        'USD'
                      }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class='cash-due'>
              <div class='cash-due-label'>Cash Due at Signing</div>
              <div class='cash-due-value'>{{currencyFormat
                  (Number @model.dueAtSigningLease)
                  'USD'
                }}</div>
              <div class='cash-due-details'>
                <div class='cash-due-breakdown'>
                  <div>
                    <span class='breakdown-label'>First Payment</span>
                    <span class='breakdown-value'>{{currencyFormat
                        (Number @model.dueAtSigningFirstMonthPaymentComponent)
                        'USD'
                      }}</span>
                  </div>
                  {{#if (gt @model.dueAtSigningDownPaymentComponent 0)}}
                    <div>
                      <span class='breakdown-label'>Down Payment</span>
                      <span class='breakdown-value'>{{currencyFormat
                          (Number @model.dueAtSigningDownPaymentComponent)
                          'USD'
                        }}</span>
                    </div>
                  {{/if}}
                  {{#if (gt @model.dueAtSigningFeesComponent 0)}}
                    <div>
                      <span class='breakdown-label'>Fees</span>
                      <span class='breakdown-value'>{{currencyFormat
                          (Number @model.dueAtSigningFeesComponent)
                          'USD'
                        }}</span>
                    </div>
                  {{/if}}
                  {{#if (gt @model.dueAtSigningTaxesComponent 0)}}
                    <div>
                      <span class='breakdown-label'>Taxes</span>
                      <span class='breakdown-value'>{{currencyFormat
                          (Number @model.dueAtSigningTaxesComponent)
                          'USD'
                        }}</span>
                    </div>
                  {{/if}}
                </div>
              </div>
            </div>
          </div>

          <div class='additional-details'>
            <h3 class='section-title'>Lease Details</h3>

            <div class='details-grid'>
              <div class='detail-item'>
                <div class='detail-item-label'>Total Lease Cost</div>
                <div class='detail-item-value'>{{currencyFormat
                    (Number @model.totalLeaseCost)
                    'USD'
                  }}</div>
              </div>
              <div class='detail-item'>
                <div class='detail-item-label'>Effective Monthly Cost</div>
                <div class='detail-item-value'>{{currencyFormat
                    (Number @model.effectiveMonthlyLeaseCost)
                    'USD'
                  }}</div>
              </div>
              <div class='detail-item'>
                <div class='detail-item-label'>Leasehackr Score</div>
                <div class='detail-item-value'>{{round
                    @model.leasehackrScore
                    1
                  }}</div>
              </div>
              <div class='detail-item'>
                <div class='detail-item-label'>Money Factor</div>
                <div
                  class='detail-item-value'
                >{{@model.calculatedMoneyFactorLease}}</div>
              </div>
              <div class='detail-item'>
                <div class='detail-item-label'>APR Equivalent</div>
                <div
                  class='detail-item-value'
                >{{@model.aprEquivalentCalculatedMfLease}}%</div>
              </div>
            </div>
          </div>

          {{#if @model.userMemo}}
            <div class='user-notes'>
              <h4>Notes</h4>
              <p>{{@model.userMemo}}</p>
            </div>
          {{/if}}

          <div class='disclaimer'>
            <p>This payment calculator is for estimation purposes only. Actual
              lease terms may vary. Please contact your BMW dealer for exact
              pricing and availability. Tax, title, license, and dealer fees are
              additional.</p>
          </div>
        </div>
      </div>

      <style scoped>
        .lease-calculator {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: var(--brand-black);
          margin: 0;
          padding: 0;
          background-color: var(--brand-white);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
          overflow: hidden;
          width: 100%;
          max-width: 900px;
          margin: 0 auto;
        }

        /* Header Styling */
        .header {
          background-color: var(--brand-blue);
          color: var(--brand-white);
          padding: 1.5rem;
          position: relative;
        }

        .branding {
          display: flex;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .logo {
          width: 48px;
          height: 48px;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          margin-right: 12px;
          filter: brightness(0) invert(1);
        }

        .title {
          font-size: 1.2rem;
          font-weight: 300;
          margin: 0;
          opacity: 0.9;
        }

        .vehicle-name {
          font-size: 2rem;
          font-weight: 500;
          margin: 0.5rem 0 0 0;
        }

        /* Content Container */
        .content-container {
          padding: 1.5rem;
        }

        /* Vehicle Summary */
        .vehicle-summary {
          display: flex;
          margin-bottom: 2rem;
          gap: 2rem;
        }

        .vehicle-image-container {
          flex: 0 0 40%;
          position: relative;
        }

        .vehicle-image {
          width: 100%;
          aspect-ratio: 4/3;
          background-color: var(--brand-light-gray);
          border-radius: 8px;
          overflow: hidden;
          background-size: cover;
          background-position: center;
        }

        .msrp-tag {
          position: absolute;
          top: 12px;
          right: 12px;
          background-color: var(--brand-blue);
          color: var(--brand-white);
          border-radius: 4px;
          padding: 6px 10px;
          font-size: 0.9rem;
          font-weight: 500;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .msrp-label {
          font-size: 0.7rem;
          opacity: 0.8;
        }

        .key-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .detail-row {
          display: flex;
          align-items: baseline;
          margin-bottom: 0.8rem;
          flex-wrap: wrap;
        }

        .detail-label {
          width: 120px;
          font-weight: 600;
          color: var(--brand-gray);
          font-size: 0.9rem;
        }

        .detail-value {
          font-weight: 500;
          font-size: 1.1rem;
          margin-right: 8px;
        }

        .detail-notes {
          color: var(--brand-gray);
          font-size: 0.9rem;
        }

        /* Payment Summary */
        .payment-summary {
          display: flex;
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .monthly-payment,
        .cash-due {
          flex: 1;
          padding: 1.5rem;
          border-radius: 8px;
          background-color: var(--brand-light-gray);
        }

        .payment-label,
        .cash-due-label {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: var(--brand-gray);
        }

        .payment-value,
        .cash-due-value {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 1rem;
          color: var(--brand-blue);
        }

        .payment-details,
        .cash-due-details {
          font-size: 0.9rem;
        }

        .payment-breakdown,
        .cash-due-breakdown {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .breakdown-label {
          color: var(--brand-gray);
          margin-right: 0.5rem;
        }

        /* Additional Details */
        .additional-details {
          margin-top: 2rem;
        }

        .section-title {
          font-size: 1.2rem;
          font-weight: 600;
          margin: 0 0 1rem 0;
          color: var(--brand-black);
          position: relative;
          padding-bottom: 0.5rem;
        }

        .section-title:after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 40px;
          height: 3px;
          background-color: var(--brand-blue);
        }

        .details-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1.5rem 1rem;
        }

        .detail-item {
          padding: 0.8rem;
          border-radius: 6px;
          background-color: var(--brand-light-gray);
        }

        .detail-item-label {
          font-size: 0.8rem;
          color: var(--brand-gray);
          margin-bottom: 0.3rem;
        }

        .detail-item-value {
          font-size: 1.1rem;
          font-weight: 500;
        }

        /* User Notes */
        .user-notes {
          margin-top: 2rem;
          padding: 1.5rem;
          background-color: var(--brand-light-gray);
          border-radius: 8px;
        }

        .user-notes h4 {
          margin-top: 0;
          color: var(--brand-blue);
          font-weight: 600;
        }

        .user-notes p {
          margin-bottom: 0;
          font-size: 0.9rem;
          line-height: 1.5;
        }

        /* Disclaimer */
        .disclaimer {
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--brand-light-gray);
          font-size: 0.8rem;
          color: var(--brand-gray);
          line-height: 1.5;
        }

        /* Responsive adjustments */
        @media (max-width: 768px) {
          .vehicle-summary,
          .payment-summary {
            flex-direction: column;
            gap: 1.5rem;
          }

          .vehicle-image-container {
            flex: 0 0 auto;
          }

          .details-grid {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          }
        }
      </style>
    </template>
  };

  private getMakeSpecificMsdRate(make?: string): number {
    const upperMake = make?.toUpperCase();
    if (upperMake?.includes('BMW') || upperMake?.includes('MINI'))
      return 0.00006;
    if (upperMake?.includes('MERCEDES') || upperMake?.includes('MBFS'))
      return 0.00004;
    if (
      upperMake?.includes('TOYOTA') ||
      upperMake?.includes('LEXUS') ||
      upperMake?.includes('MAZDA')
    )
      return 0.00008;
    if (upperMake?.includes('AUDI')) return 0.00005;
    if (upperMake?.includes('INFINITI')) return 0.0001;
    if (upperMake?.includes('NISSAN')) return 0.00004;
    if (upperMake?.includes('VOLVO')) return 0.00005;
    return 0;
  }

  private getMakeSpecificAcqWaiverBump(make?: string): number {
    const upperMake = make?.toUpperCase();
    if (upperMake?.includes('BMW') || upperMake?.includes('MINI'))
      return 0.0005;
    if (
      upperMake?.includes('GM') ||
      upperMake?.includes('CHEVROLET') ||
      upperMake?.includes('BUICK') ||
      upperMake?.includes('CADILLAC') ||
      upperMake?.includes('GMC')
    )
      return 0.00075;
    if (upperMake?.includes('PORSCHE')) return 0.00033;
    return 0;
  }

  private getMakeSpecificOnePayReduction(
    make?: string,
    term?: number,
    baseMf?: number,
  ): number {
    const upperMake = make?.toUpperCase();
    const L_term = term ?? 0;
    const L_baseMf = baseMf ?? 0;

    if (upperMake?.includes('BMW') || upperMake?.includes('MINI')) {
      return L_term >= 36 ? 0.0007 : 0.0006;
    }
    if (upperMake?.includes('MERCEDES') || upperMake?.includes('MBFS'))
      return 0.0004;
    if (upperMake?.includes('TOYOTA') || upperMake?.includes('LEXUS')) {
      return L_baseMf >= 0.00101 ? 0.001 : 0;
    }
    if (
      upperMake?.includes('GM') ||
      upperMake?.includes('CHEVROLET') ||
      upperMake?.includes('BUICK') ||
      upperMake?.includes('CADILLAC') ||
      upperMake?.includes('GMC')
    ) {
      return L_term >= 36 ? 0.00073 : 0.00042;
    }
    return 0;
  }

  private getMakeSpecificMinMf(make?: string, isOnePay?: boolean): number {
    const upperMake = make?.toUpperCase();
    if (upperMake?.includes('BMW') || upperMake?.includes('MINI')) {
      return isOnePay ? 0.00005 : 0.00001;
    }
    if (upperMake?.includes('MERCEDES') || upperMake?.includes('MBFS'))
      return 0.00001;
    if (upperMake?.includes('TOYOTA') || upperMake?.includes('LEXUS'))
      return 0.00001;
    if (upperMake?.includes('AUDI')) return 0.00005;
    if (upperMake?.includes('VOLVO')) return 0.00001;
    return 0.00001; // General minimum
  }

  private getMsdRoundingFactor(make?: string): number {
    const upperMake = make?.toUpperCase();
    if (upperMake?.includes('BMW') || upperMake?.includes('MERCEDES'))
      return 50;
    if (
      upperMake?.includes('TOYOTA') ||
      upperMake?.includes('LEXUS') ||
      upperMake?.includes('AUDI') ||
      upperMake?.includes('INFINITI') ||
      upperMake?.includes('NISSAN')
    )
      return 25;
    return 50; // Default, or should throw error for unsupported
  }

  @field vehicleMake = contains(StringField);
  @field msrp = contains(NumberField);
  @field zipCode = contains(StringField);
  @field country = contains(StringField); // 'US' or 'CA'

  @field sellingPriceLease = contains(NumberField);
  @field sellingPriceOffMsrpLeasePercent = contains(NumberField);

  @field leaseTerm = contains(NumberField);
  @field annualMileageLease = contains(NumberField);
  @field residualValueLeasePercent = contains(NumberField);
  @field demoMileageLease = contains(NumberField);
  @field bmwDemoOption = contains(StringField);
  @field baseMoneyFactor = contains(NumberField);
  @field multipleSecurityDepositsCount = contains(NumberField);
  @field acquisitionFeeWaiverLease = contains(BooleanField);
  @field onePayLease = contains(BooleanField);
  @field manualMoneyFactorAdjustmentLease = contains(NumberField);

  @field taxedIncentivesLease = contains(NumberField);
  @field untaxedIncentivesLease = contains(NumberField);
  @field downPaymentLease = contains(NumberField);
  @field tradeInEquityLease = contains(NumberField);
  @field zeroDriveOffLease = contains(BooleanField);
  @field capitalizeUpfrontTaxesLease = contains(BooleanField);

  @field acquisitionFeeLease = contains(NumberField);
  @field payAcquisitionFeeUpfrontLease = contains(BooleanField);
  @field dealerFeesLease = contains(NumberField);
  @field payDealerFeesUpfrontLease = contains(BooleanField);
  @field governmentFeesLease = contains(NumberField);
  @field payGovernmentFeesUpfrontLease = contains(BooleanField);
  @field otherServiceFeesLease = contains(NumberField);

  @field salesTaxRateLease = contains(NumberField);
  @field taxMethodLease = contains(StringField);
  @field newYorkTaxRuleLease = contains(BooleanField);
  @field feesTaxedForSellingPriceTaxLease = contains(BooleanField);

  @field postSaleRebatesLease = contains(NumberField);
  @field dispositionFeeLease = contains(NumberField);

  @field sellingPriceFinance = contains(NumberField);
  @field sellingPriceOffMsrpFinancePercent = contains(NumberField);

  @field taxableFeesFinance = contains(NumberField);
  @field untaxedFeesFinance = contains(NumberField);
  @field salesTaxRateFinance = contains(NumberField);

  @field loanTermFinance = contains(NumberField);
  @field aprFinance = contains(NumberField);

  @field rebatesFinance = contains(NumberField);
  @field downPaymentFinance = contains(NumberField);
  @field tradeInEquityFinance = contains(NumberField);

  @field postSaleRebatesFinance = contains(NumberField);

  @field plannedKeepTermFinance = contains(NumberField);
  @field estimatedResaleValueFinance = contains(NumberField);
  @field estimatedResaleValueFinancePercent = contains(NumberField);

  @field userMemo = contains(StringField);
  @field resultMode = contains(StringField);

  @field baseResidualValueLeaseCurrency = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const msrp = this.msrp ?? 0;
      const residualPercent = (this.residualValueLeasePercent ?? 0) / 100;
      return roundCurrency(msrp * residualPercent);
    },
  });

  @field adjustedResidualValueLeaseCurrency = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      let baseResidual = this.baseResidualValueLeaseCurrency ?? 0;
      const demoMileage = this.demoMileageLease ?? 0;
      const make = this.vehicleMake?.toUpperCase();
      let adjustment = 0;

      if (make?.includes('BMW')) {
        if (demoMileage > 500) {
          const rate = this.bmwDemoOption === '$0.30/mile' ? 0.3 : 0.25;
          adjustment = rate * (demoMileage - 500);
        }
      } else if (make?.includes('MERCEDES') || make?.includes('MBFS')) {
        if (demoMileage >= 3000 && demoMileage < 10000) {
          adjustment = 0.2 * (demoMileage - 3000);
        }
      } else if (make?.includes('VOLVO')) {
        if (demoMileage >= 0 && demoMileage < 10000) {
          adjustment = 0.2 * demoMileage;
        }
      }

      return roundCurrency(baseResidual - adjustment);
    },
  });

  @field adjustedResidualValueLeasePercent = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (!this.msrp) return 0;
      const adjustedResidualValue =
        this.adjustedResidualValueLeaseCurrency ?? 0;
      return round((adjustedResidualValue / this.msrp) * 100, 2);
    },
  });

  @field aprEquivalentBaseMfLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      return (this.baseMoneyFactor ?? 0) * 2400;
    },
  });

  @field calculatedMoneyFactorLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      let baseMf = this.baseMoneyFactor ?? 0;
      const msdCount = this.multipleSecurityDepositsCount ?? 0;
      const acqFeeWaiver = this.acquisitionFeeWaiverLease ?? false;
      const onePay = this.onePayLease ?? false;
      const manualAdj = this.manualMoneyFactorAdjustmentLease ?? 0;
      const make = this.vehicleMake;
      const term = this.leaseTerm;

      const msdReductionRate = this.getMakeSpecificMsdRate(make);
      const mfMsdReduction = msdCount * msdReductionRate;

      const acqWaiverBump = acqFeeWaiver
        ? this.getMakeSpecificAcqWaiverBump(make)
        : 0;

      const onePayReduction = onePay
        ? this.getMakeSpecificOnePayReduction(make, term, baseMf)
        : 0;

      let calculatedMf =
        baseMf - mfMsdReduction + acqWaiverBump - onePayReduction + manualAdj;

      const minMf = this.getMakeSpecificMinMf(make, onePay);
      calculatedMf = Math.max(calculatedMf, minMf);

      return roundMF(calculatedMf);
    },
  });

  @field aprEquivalentCalculatedMfLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      return (this.calculatedMoneyFactorLease ?? 0) * 2400;
    },
  });

  @field netCapitalizedCostLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const sellingPrice = this.sellingPriceLease ?? 0;
      let acquisitionFee = this.acquisitionFeeLease ?? 0;
      const dealerFee = this.dealerFeesLease ?? 0;
      const governmentFee = this.governmentFeesLease ?? 0;

      const taxedIncentives = this.taxedIncentivesLease ?? 0;
      const untaxedIncentives = this.untaxedIncentivesLease ?? 0;
      let downPayment = this.downPaymentLease ?? 0;
      const tradeInEquity = this.tradeInEquityLease ?? 0;

      if (this.acquisitionFeeWaiverLease) acquisitionFee = 0;

      let capFees = 0;
      if (!this.payAcquisitionFeeUpfrontLease && !this.zeroDriveOffLease)
        capFees += acquisitionFee;
      if (!this.payDealerFeesUpfrontLease && !this.zeroDriveOffLease)
        capFees += dealerFee;
      if (!this.payGovernmentFeesUpfrontLease && !this.zeroDriveOffLease)
        capFees += governmentFee;

      let netCapCost =
        sellingPrice +
        capFees -
        taxedIncentives -
        untaxedIncentives -
        downPayment -
        tradeInEquity;

      if (this.zeroDriveOffLease) {
        const allFeesToCap = acquisitionFee + dealerFee + governmentFee;
        downPayment = 0;
        netCapCost =
          sellingPrice +
          allFeesToCap -
          taxedIncentives -
          untaxedIncentives -
          tradeInEquity;
      }

      return roundCurrency(netCapCost);
    },
  });

  @field monthlyDepreciationFeeLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const netCapCost = this.netCapitalizedCostLease ?? 0;
      const adjustedResidual = this.adjustedResidualValueLeaseCurrency ?? 0;
      const leaseTerm = this.leaseTerm ?? 1;
      if (leaseTerm === 0) return 0;
      return roundCurrency((netCapCost - adjustedResidual) / leaseTerm);
    },
  });

  @field monthlyRentChargeLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const netCapCost = this.netCapitalizedCostLease ?? 0;
      const adjustedResidual = this.adjustedResidualValueLeaseCurrency ?? 0;
      const calculatedMf = this.calculatedMoneyFactorLease ?? 0;
      return roundCurrency((netCapCost + adjustedResidual) * calculatedMf);
    },
  });

  @field preTaxMonthlyPaymentLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.onePayLease) return 0;

      return roundCurrency(
        (this.monthlyDepreciationFeeLease ?? 0) +
          (this.monthlyRentChargeLease ?? 0),
      );
    },
  });

  @field totalUpfrontTaxLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.capitalizeUpfrontTaxesLease || this.zeroDriveOffLease) return 0;

      let taxBase = 0;
      const salesTaxRate = (this.salesTaxRateLease ?? 0) / 100;

      if (this.taxMethodLease === 'MonthlyPayment') {
        taxBase += this.downPaymentLease ?? 0;
        taxBase += this.taxedIncentivesLease ?? 0;
        let upfrontFeesTaxed = 0;
        if (this.payAcquisitionFeeUpfrontLease)
          upfrontFeesTaxed += this.acquisitionFeeLease ?? 0;
        if (this.payDealerFeesUpfrontLease)
          upfrontFeesTaxed += this.dealerFeesLease ?? 0;
        taxBase += upfrontFeesTaxed;
        return roundCurrency(taxBase * salesTaxRate);
      }
      return 0;
    },
  });

  @field monthlyTaxLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.onePayLease) return 0;
      if (this.taxMethodLease === 'MonthlyPayment') {
        const preTaxMonthly = this.preTaxMonthlyPaymentLease ?? 0;
        const salesTaxRate = (this.salesTaxRateLease ?? 0) / 100;
        return roundCurrency(preTaxMonthly * salesTaxRate);
      }
      return 0;
    },
  });

  @field postTaxMonthlyPaymentLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.onePayLease) return 0;
      return roundCurrency(
        (this.preTaxMonthlyPaymentLease ?? 0) + (this.monthlyTaxLease ?? 0),
      );
    },
  });

  @field totalUpfrontFeesPaidLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.zeroDriveOffLease) return 0;

      let fees = 0;
      if (this.payAcquisitionFeeUpfrontLease)
        fees += this.acquisitionFeeLease ?? 0;
      if (this.payDealerFeesUpfrontLease) fees += this.dealerFeesLease ?? 0;
      if (this.payGovernmentFeesUpfrontLease)
        fees += this.governmentFeesLease ?? 0;
      fees += this.otherServiceFeesLease ?? 0;
      return roundCurrency(fees);
    },
  });

  @field dueAtSigningLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.zeroDriveOffLease) return 0;
      if (this.onePayLease) return this.dueAtSigningOnePayTotalLease ?? 0;

      const firstMonth = this.postTaxMonthlyPaymentLease ?? 0;
      const downPayment = this.downPaymentLease ?? 0;
      const upfrontFees = this.totalUpfrontFeesPaidLease ?? 0;
      const upfrontTax = this.totalUpfrontTaxLease ?? 0;

      return roundCurrency(firstMonth + downPayment + upfrontFees + upfrontTax);
    },
  });

  @field dueAtSigningFirstMonthPaymentComponent = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.onePayLease || this.zeroDriveOffLease) return 0;
      return this.postTaxMonthlyPaymentLease ?? 0;
    },
  });
  @field dueAtSigningDownPaymentComponent = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.onePayLease || this.zeroDriveOffLease) return 0;
      return this.downPaymentLease ?? 0;
    },
  });
  @field dueAtSigningFeesComponent = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (this.onePayLease || this.zeroDriveOffLease) return 0;
      return this.totalUpfrontFeesPaidLease ?? 0;
    },
  });
  @field dueAtSigningTaxesComponent = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (
        this.onePayLease ||
        this.zeroDriveOffLease ||
        this.capitalizeUpfrontTaxesLease
      )
        return 0;
      return this.totalUpfrontTaxLease ?? 0;
    },
  });

  @field dueAtSigningOnePayTotalLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      if (!this.onePayLease) return 0;

      const preTaxMonthlyOnePayApprox = this.preTaxMonthlyPaymentLease ?? 0;
      const leaseTerm = this.leaseTerm ?? 1;
      const acquisitionFee =
        (this.acquisitionFeeWaiverLease ? 0 : this.acquisitionFeeLease) ?? 0;
      const dealerFee = this.dealerFeesLease ?? 0;
      const governmentFee = this.governmentFeesLease ?? 0;
      const upfrontTaxOnePayApprox = this.totalUpfrontTaxLease ?? 0;

      return roundCurrency(
        preTaxMonthlyOnePayApprox * leaseTerm +
          acquisitionFee +
          dealerFee +
          governmentFee +
          upfrontTaxOnePayApprox, // This tax may vary
      );
    },
  });

  @field totalMultipleSecurityDepositsPaymentLease = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const msdCount = this.multipleSecurityDepositsCount ?? 0;
      if (msdCount === 0) return 0;

      let preTaxMonthlyForMsdApprox = this.preTaxMonthlyPaymentLease ?? 0;
      if (this.calculatedMoneyFactorLease !== this.baseMoneyFactor) {
        const rentChargeDiff =
          ((this.netCapitalizedCostLease ?? 0) +
            (this.adjustedResidualValueLeaseCurrency ?? 0)) *
          ((this.baseMoneyFactor ?? 0) -
            (this.calculatedMoneyFactorLease ?? 0));
        preTaxMonthlyForMsdApprox += rentChargeDiff;
      }

      if (this.taxMethodLease === 'MonthlyPayment') {
        preTaxMonthlyForMsdApprox *= 1 + (this.salesTaxRateLease ?? 0) / 100;
      }

      const roundingFactor = this.getMsdRoundingFactor(this.vehicleMake);
      const msdRoundedPayment =
        Math.ceil(preTaxMonthlyForMsdApprox / roundingFactor) * roundingFactor;

      return roundCurrency(msdRoundedPayment * msdCount);
    },
  });

  @field totalLeaseCost = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const leaseTerm = this.leaseTerm ?? 0;
      let totalMonthlyPayments = 0;
      if (!this.onePayLease && leaseTerm > 0) {
        totalMonthlyPayments =
          (this.postTaxMonthlyPaymentLease ?? 0) * (leaseTerm - 1);
      }

      let dueAtSigning = this.dueAtSigningLease ?? 0;
      if (this.onePayLease) {
        totalMonthlyPayments = 0;
        dueAtSigning = this.dueAtSigningOnePayTotalLease ?? 0;
      }

      const dispositionFee = this.dispositionFeeLease ?? 0;
      const tradeInEquity = this.tradeInEquityLease ?? 0;
      const postSaleRebates = this.postSaleRebatesLease ?? 0;

      let cost =
        totalMonthlyPayments +
        dueAtSigning +
        dispositionFee -
        postSaleRebates -
        tradeInEquity;

      return roundCurrency(cost);
    },
  });

  @field effectiveMonthlyLeaseCost = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const totalLeaseCost = this.totalLeaseCost ?? 0;
      const leaseTerm = this.leaseTerm ?? 1;
      if (leaseTerm === 0) return 0;
      return roundCurrency(totalLeaseCost / leaseTerm);
    },
  });

  @field leasehackrScore = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const msrp = this.msrp ?? 0;
      const taxRate = (this.salesTaxRateLease ?? 0) / 100;
      const effectiveMonthly = this.effectiveMonthlyLeaseCost ?? 0;

      if (effectiveMonthly === 0) return 0;

      const score = (msrp * (1 + taxRate)) / effectiveMonthly / 12;
      return round(score, 1);
    },
  });

  @field totalSalesTaxFinanced = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const sellingPrice = this.sellingPriceFinance ?? 0;
      const taxableFees = this.taxableFeesFinance ?? 0;
      const taxRate = (this.salesTaxRateFinance ?? 0) / 100;
      return roundCurrency((sellingPrice + taxableFees) * taxRate);
    },
  });

  @field totalVehicleCostFinance = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const sellingPrice = this.sellingPriceFinance ?? 0;
      const taxableFees = this.taxableFeesFinance ?? 0;
      const untaxedFees = this.untaxedFeesFinance ?? 0;
      const financedTax = this.totalSalesTaxFinanced ?? 0;
      return roundCurrency(
        sellingPrice + taxableFees + untaxedFees + financedTax,
      );
    },
  });

  @field amountFinanced = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const totalVehicleCost = this.totalVehicleCostFinance ?? 0;
      const downPayment = this.downPaymentFinance ?? 0;
      const rebates = this.rebatesFinance ?? 0;
      const tradeInEquity = this.tradeInEquityFinance ?? 0;
      return roundCurrency(
        totalVehicleCost - downPayment - rebates - tradeInEquity,
      );
    },
  });

  @field monthlyFinancePayment = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const amountFinanced = this.amountFinanced ?? 0;
      const loanTerm = this.loanTermFinance ?? 1;
      const apr = (this.aprFinance ?? 0) / 100;

      if (loanTerm === 0) return 0;

      if (apr === 0) {
        return roundCurrency(amountFinanced / loanTerm);
      }

      const monthlyRate = apr / 12;
      if (monthlyRate === 0) {
        return roundCurrency(amountFinanced / loanTerm);
      }

      const payment =
        (amountFinanced * monthlyRate) /
        (1 - Math.pow(1 + monthlyRate, -loanTerm));
      return roundCurrency(payment);
    },
  });

  @field totalOfAllFinancePayments = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const monthlyPayment = this.monthlyFinancePayment ?? 0;
      const loanTerm = this.loanTermFinance ?? 0;
      return roundCurrency(monthlyPayment * loanTerm);
    },
  });

  @field totalInterestPaidFinance = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const totalPayments = this.totalOfAllFinancePayments ?? 0;
      const amountFinanced = this.amountFinanced ?? 0;
      return roundCurrency(totalPayments - amountFinanced);
    },
  });

  private _calculateFinanceAmortization(): {
    interestPaidAtKeepTerm: number;
    principalPaidAtKeepTerm: number;
    loanBalanceAtKeepTerm: number;
  } {
    const amountFinanced = this.amountFinanced ?? 0;
    const monthlyPayment = this.monthlyFinancePayment ?? 0;
    const apr = (this.aprFinance ?? 0) / 100;
    const monthlyRate = apr / 12;
    const loanTerm = this.loanTermFinance ?? 0;
    const keepTerm = Math.min(
      this.plannedKeepTermFinance ?? loanTerm,
      loanTerm,
    );

    let balance = amountFinanced;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;

    if (amountFinanced === 0 || monthlyPayment === 0) {
      return {
        interestPaidAtKeepTerm: 0,
        principalPaidAtKeepTerm: 0,
        loanBalanceAtKeepTerm: 0,
      };
    }

    for (let i = 0; i < keepTerm; i++) {
      if (balance <= 0) break;
      const interestMonth = balance * monthlyRate;
      const principalMonth = monthlyPayment - interestMonth;

      totalInterestPaid += interestMonth;
      totalPrincipalPaid += principalMonth;
      balance -= principalMonth;
    }

    balance = Math.max(0, balance);

    return {
      interestPaidAtKeepTerm: roundCurrency(totalInterestPaid),
      principalPaidAtKeepTerm: roundCurrency(totalPrincipalPaid),
      loanBalanceAtKeepTerm: roundCurrency(balance),
    };
  }

  @field interestPaidAtKeepTermFinance = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      return this._calculateFinanceAmortization().interestPaidAtKeepTerm;
    },
  });

  @field principalPaidAtKeepTermFinance = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      return this._calculateFinanceAmortization().principalPaidAtKeepTerm;
    },
  });

  @field loanBalanceAtKeepTermFinance = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      return this._calculateFinanceAmortization().loanBalanceAtKeepTerm;
    },
  });

  @field vehicleEquityAtKeepTermFinance = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const estimatedResaleValue = this.estimatedResaleValueFinance ?? 0;
      const loanBalance = this.loanBalanceAtKeepTermFinance ?? 0; // This is 0 if KeepTerm >= LoanTerm
      return roundCurrency(estimatedResaleValue - loanBalance);
    },
  });

  @field totalFinanceCostAtKeepTerm = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const principalPaid = this.principalPaidAtKeepTermFinance ?? 0;
      const interestPaid = this.interestPaidAtKeepTermFinance ?? 0;
      const totalPaid = principalPaid + interestPaid;

      const downPayment = this.downPaymentFinance ?? 0;
      const tradeInEquity = this.tradeInEquityFinance ?? 0; // Assuming positive is good
      const equityAtKeepTerm = this.vehicleEquityAtKeepTermFinance ?? 0;
      const postSaleRebates = this.postSaleRebatesFinance ?? 0;

      const cost =
        totalPaid +
        downPayment +
        tradeInEquity -
        equityAtKeepTerm -
        postSaleRebates;

      return roundCurrency(cost);
    },
  });

  @field effectiveMonthlyFinanceCostAtKeepTerm = contains(NumberField, {
    computeVia: function (this: LeaseCalculator) {
      const totalFinanceCost = this.totalFinanceCostAtKeepTerm ?? 0;
      const keepTerm = this.plannedKeepTermFinance ?? 1;
      if (keepTerm === 0) return 0;
      return roundCurrency(totalFinanceCost / keepTerm);
    },
  });
}
