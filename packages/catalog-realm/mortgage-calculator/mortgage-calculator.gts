import NumberField from 'https://cardstack.com/base/number';
import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import CalculatorIcon from '@cardstack/boxel-icons/calculator';

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatUsd(val: number | undefined) {
  if (val === undefined) {
    return '';
  }
  return formatter.format(val);
}

function svgPieStartAngle({
  data,
  index,
  total,
  start = 0,
}: {
  data: { value?: number }[];
  index: number;
  total: number;
  start?: number;
}) {
  return data.slice(0, index).reduce((sum, item) => {
    const angle = ((item.value || 0) / total) * 360 || 0;
    return sum + angle;
  }, start);
}

interface DonutSectionSignature {
  Element: SVGGElement;
  Args: {
    fill: string;
    size: number;
    value: number | undefined;
    total: number;
    startAngle: number;
  };
}

class DonutSection extends GlimmerComponent<DonutSectionSignature> {
  get halfWidth() {
    return this.args.size / 2;
  }

  get radius() {
    return this.halfWidth;
  }

  get startX() {
    return (
      this.halfWidth +
      this.radius * Math.cos(this.args.startAngle * (Math.PI / 180))
    );
  }

  get startY() {
    return (
      this.halfWidth +
      this.radius * Math.sin(this.args.startAngle * (Math.PI / 180))
    );
  }

  get angle() {
    const angle = ((this.args.value || 0) / this.args.total) * 360;
    return angle < 359.99 ? angle : 359.99;
  }

  get endAngle() {
    return this.angle + this.args.startAngle;
  }

  get largeArcFlag() {
    return this.angle > 180 ? 1 : 0;
  }

  get sweepFlag() {
    return this.args.startAngle < this.endAngle ? 1 : 0;
  }

  get endX() {
    return (
      this.halfWidth + this.radius * Math.cos(this.endAngle * (Math.PI / 180))
    );
  }

  get endY() {
    return (
      this.halfWidth + this.radius * Math.sin(this.endAngle * (Math.PI / 180))
    );
  }

  <template>
    <g fill={{@fill}} ...attributes>
      <path
        d='
          M {{this.halfWidth}} {{this.halfWidth}}
          L {{this.startX}} {{this.startY}}
          A {{this.radius}} {{this.radius}} 0 {{this.largeArcFlag}} {{this.sweepFlag}} {{this.endX}} {{this.endY}}
          Z
        '
      ></path>
    </g>
  </template>
}

interface DonutSectionData {
  class?: string;
  color: string;
  value: number | undefined;
  label: string;
  percent: number | undefined;
}

interface DonutChartSignature {
  Element: SVGElement;
  Args: {
    data: DonutSectionData[];
    size: number;
  };
}

class DonutChart extends GlimmerComponent<DonutChartSignature> {
  get viewBox() {
    const { size } = this.args;
    return `0 0 ${size} ${size}`;
  }

  get total() {
    const { data } = this.args;
    return data.reduce((sum, item) => sum + (item.value || 0), 0);
  }

  get center() {
    return this.args.size / 2;
  }

  get holeRadius() {
    return this.args.size / 4;
  }

  <template>
    <svg
      width={{@size}}
      height={{@size}}
      viewBox={{this.viewBox}}
      preserveAspectRatio='xMinYMin'
    >
      {{#each @data as |item index|}}
        <DonutSection
          class={{item.class}}
          @fill={{item.color}}
          @size={{@size}}
          @value={{item.value}}
          @total={{this.total}}
          @startAngle={{svgPieStartAngle
            data=@data
            index=index
            total=this.total
            start=-90
          }}
        />
      {{/each}}
      <circle
        cx={{this.center}}
        cy={{this.center}}
        r={{this.holeRadius}}
        fill='#ffffff'
      />
    </svg>
  </template>
}

export class MortgageCalculator extends CardDef {
  @field homePrice = contains(NumberField);
  @field downPaymentPercentage = contains(NumberField);
  @field loanTermYears = contains(NumberField);
  @field interestRatePercentage = contains(NumberField);
  @field taxPerMonth = contains(NumberField);
  @field insurancePerMonth = contains(NumberField);
  @field hoaFeesPerMonth = contains(NumberField);
  @field downPayment = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.homePrice * (this.downPaymentPercentage / 100);
    },
  });
  @field loanAmount = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.homePrice - this.downPayment;
    },
  });
  @field numberOfPayments = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.loanTermYears * 12;
    },
  });
  @field monthlyInterestRate = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.interestRatePercentage / 100 / 12;
    },
  });
  @field monthlyMortgagePayment = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return (
        this.loanAmount *
        ((this.monthlyInterestRate *
          Math.pow(1 + this.monthlyInterestRate, this.numberOfPayments)) /
          (Math.pow(1 + this.monthlyInterestRate, this.numberOfPayments) - 1))
      );
    },
  });
  @field monthlyTotal = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return (
        this.monthlyMortgagePayment +
        this.taxPerMonth +
        this.insurancePerMonth +
        this.hoaFeesPerMonth
      );
    },
  });
  @field lifetimeMortgagePayment = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.monthlyMortgagePayment * this.numberOfPayments;
    },
  });
  @field lifetimeTaxes = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.taxPerMonth * this.numberOfPayments;
    },
  });
  @field lifetimeInsurance = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.insurancePerMonth * this.numberOfPayments;
    },
  });
  @field lifetimeHoaFees = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return this.hoaFeesPerMonth * this.numberOfPayments;
    },
  });
  @field lifetimeTotal = contains(NumberField, {
    computeVia(this: MortgageCalculator) {
      return (
        this.lifetimeMortgagePayment +
        this.taxPerMonth +
        this.insurancePerMonth +
        this.hoaFeesPerMonth
      );
    },
  });

  static displayName = 'Mortgage Calculator';
  static icon = CalculatorIcon;

  static isolated = class Isolated extends Component<typeof this> {
    get chartData(): DonutSectionData[] {
      let { model } = this.args;
      return [
        {
          value: model.monthlyMortgagePayment,
          color: '#30EF9D',
          label: 'Principal & Interest',
          percent:
            model.monthlyMortgagePayment &&
            model.monthlyTotal &&
            Math.round(
              (model.monthlyMortgagePayment / model.monthlyTotal) * 100,
            ),
        },
        {
          value: model.taxPerMonth,
          color: '#589BFF',
          label: 'Property Taxes',
          percent:
            model.taxPerMonth &&
            model.monthlyTotal &&
            Math.round((model.taxPerMonth / model.monthlyTotal) * 100),
        },
        {
          value: model.insurancePerMonth,
          color: '#FF2F8A',
          label: 'Home Insurance',
          percent:
            model.insurancePerMonth &&
            model.monthlyTotal &&
            Math.round((model.insurancePerMonth / model.monthlyTotal) * 100),
        },
        {
          value: model.hoaFeesPerMonth,
          color: '#FFB74A',
          label: 'HOA Fees',
          percent:
            model.hoaFeesPerMonth &&
            model.monthlyTotal &&
            Math.round((model.hoaFeesPerMonth / model.monthlyTotal) * 100),
        },
      ];
    }

    <template>
      <div class='wrapper'>
        <aside class='form-container'>
          <label>Home price</label>
          <@fields.homePrice @format='edit' />

          <label>Down payment (%)</label>
          <@fields.downPaymentPercentage @format='edit' />

          <label>Loan term (years)</label>
          <@fields.loanTermYears @format='edit' />

          <label>Interest rate (%)</label>
          <@fields.interestRatePercentage @format='edit' />

          <label>Prop. tax per month</label>
          <@fields.taxPerMonth @format='edit' />

          <label>Home ins. per month</label>
          <@fields.insurancePerMonth @format='edit' />

          <label>HOA fees per month</label>
          <@fields.hoaFeesPerMonth @format='edit' />

        </aside>
        <div class='results-container'>
          <div class='results'>
            <div class='loan-amount'>
              <label>Loan Amount:</label>
              <span>
                {{formatUsd @model.loanAmount}}
              </span>
            </div>

            <div class='down-payment'>
              <label>Down Payment:</label>
              <span>
                {{formatUsd @model.downPayment}}
              </span>
            </div>

            <div class='header-monthly'>Monthly</div>
            <div class='header-total'>Total</div>

            <div class='mortgage-payment label'>
              Mortgage Payment
            </div>
            <div class='mortgage-payment monthly'>
              {{formatUsd @model.monthlyMortgagePayment}}
            </div>
            <div class='mortgage-payment total'>
              {{formatUsd @model.lifetimeMortgagePayment}}
            </div>

            <div class='tax label'>
              Property Tax
            </div>
            <div class='tax monthly'>
              {{formatUsd @model.taxPerMonth}}
            </div>
            <div class='tax total'>
              <@fields.lifetimeTaxes />
            </div>

            <div class='insurance label'>
              Home Insurance
            </div>
            <div class='insurance monthly'>
              {{formatUsd @model.insurancePerMonth}}
            </div>
            <div class='insurance total'>
              {{formatUsd @model.lifetimeInsurance}}
            </div>

            <div class='hoa label'>
              HOA Fees
            </div>
            <div class='hoa monthly'>
              {{formatUsd @model.hoaFeesPerMonth}}
            </div>
            <div class='hoa total'>
              {{formatUsd @model.lifetimeHoaFees}}
            </div>

            <div class='aggregate label'>
              Total Out-of-Pocket
            </div>
            <div class='aggregate monthly'>
              {{formatUsd @model.monthlyTotal}}
            </div>
            <div class='aggregate total'>
              {{formatUsd @model.lifetimeTotal}}
            </div>
            <div class='chart'>
              <DonutChart @data={{this.chartData}} @size={{160}} />
            </div>
            <div class='legend'>
              {{#each this.chartData as |item|}}
                <div><div
                    class='swatch'
                    style={{htmlSafe (concat 'background: ' item.color)}}
                  ></div>
                  {{item.percent}}% -
                  {{item.label}}</div>
              {{/each}}
            </div>
          </div>
        </div>
      </div>
      <style scoped>
        .wrapper {
          max-width: 940px;
          display: grid;
          margin: 0 auto;
          grid-template-columns: 1fr 4fr;
          grid-gap: 0;
        }
        .form-container {
          border-bottom-left-radius: 18px;
          width: 218px;
          padding: 15px;
        }
        .form-container label {
          display: block;
          font-weight: 500;
          margin-top: 1em;
          padding-left: 15px;
          margin-bottom: 0.1em;
        }
        .form-container :deep(input) {
          background: #eeeef3;
          border: none;
          border-radius: 24px;
        }
        .results-container {
          background: #007272;
          padding: 14px;
        }
        .results {
          background: white;
          border-radius: 14px;
          display: grid;
          grid-template-columns: 2fr repeat(2, 1fr);
          grid-template-rows: repeat(7, 1fr) 220px;
          grid-column-gap: 0px;
          grid-row-gap: 0px;
          font-weight: 500;
          padding-top: 12px;
        }

        .results > * {
          padding: 6px 12px;
        }

        .monthly,
        .total {
          text-align: right;
        }

        .loan-amount {
          grid-area: 1 / 1 / 2 / 2;
        }
        .down-payment {
          grid-area: 1 / 2 / 2 / 4;
        }
        .loan-amount,
        .down-payment {
          padding: 6px 12px;
          border-bottom: 1px solid #ececf1;
          text-align: center;
        }
        .loan-amount span,
        .down-payment span {
          font-weight: 800;
          font-size: 1.1em;
        }
        .header-monthly {
          grid-area: 2 / 2 / 3 / 3;
        }
        .header-total {
          grid-area: 2 / 3 / 3 / 4;
        }
        .header-monthly,
        .header-total {
          text-transform: uppercase;
          font-weight: 800;
          text-align: right;
          padding-top: 18px;
        }
        .mortgage-payment.label {
          grid-area: 3 / 1 / 4 / 2;
        }
        .mortgage-payment.monthly {
          grid-area: 3 / 2 / 4 / 3;
        }
        .mortgage-payment.total {
          grid-area: 3 / 3 / 4 / 4;
        }
        .mortgage-payment,
        .aggregate {
          background-color: #eeeef3;
          font-size: 1.2em;
          font-weight: 800;
          padding-top: 12px;
        }
        .tax.label {
          grid-area: 4 / 1 / 5 / 2;
        }
        .tax.monthly {
          grid-area: 4 / 2 / 5 / 3;
        }
        .tax.total {
          grid-area: 4 / 3 / 5 / 4;
        }
        .tax {
          padding-top: 12px;
        }
        .insurance.label {
          grid-area: 5 / 1 / 6 / 2;
        }
        .insurance.monthly {
          grid-area: 5 / 2 / 6 / 3;
        }
        .insurance.total {
          grid-area: 5 / 3 / 6 / 4;
        }
        .hoa.label {
          grid-area: 6 / 1 / 7 / 2;
        }
        .hoa.monthly {
          grid-area: 6 / 2 / 7 / 3;
        }
        .hoa.total {
          grid-area: 6 / 3 / 7 / 4;
        }
        .aggregate.label {
          grid-area: 7 / 1 / 8 / 2;
        }
        .aggregate.monthly {
          grid-area: 7 / 2 / 8 / 3;
        }
        .aggregate.total {
          grid-area: 7 / 3 / 8 / 4;
        }

        .chart {
          grid-area: 8 / 1 / 9 / 2;
          padding: 18px 12px;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .legend {
          grid-area: 8 / 2 / 9 / 4;
          align-items: center;
          align-items: stretch;
          display: flex;
          flex-direction: column;
          justify-content: center;
          font-weight: 500;
        }
        .legend > div {
          line-height: 2em;
        }
        .swatch {
          display: inline-block;
          width: 20px;
          height: 20px;
          border-radius: 5px;
          vertical-align: middle;
          margin-right: 6px;
        }
      </style>
    </template>
  };

  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }


  */
}
