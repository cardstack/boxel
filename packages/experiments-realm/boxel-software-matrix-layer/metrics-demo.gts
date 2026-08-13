import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import ChartLineIcon from '@cardstack/boxel-icons/chart-line';
import GaugeIcon from '@cardstack/boxel-icons/gauge';
import { Account } from './account';
import { AccountMetrics } from './account-metrics';
import { LineChart, type ChartPoint } from './line-chart';
import { formatMoney } from './money';

export class AccountMetricsDemo extends CardDef {
  static displayName = 'Account Metrics Demo';
  static icon = GaugeIcon;

  @field account = linksTo(Account);

  static isolated = class Isolated extends Component<
    typeof AccountMetricsDemo
  > {
    <template>
      <div class='demo'>
        <h2>{{if @model.account.name @model.account.name 'No account'}}</h2>
        <AccountMetrics
          @account={{@model.account}}
          @context={{@context}}
        />
      </div>
      <style scoped>
        .demo {
          padding: 1.25rem;
        }
        h2 {
          margin: 0 0 0.875rem;
          font-size: 1.125rem;
          font-family: var(--font-heading, inherit);
        }
      </style>
    </template>
  };
}

export class LineChartDemo extends CardDef {
  static displayName = 'Line Chart Demo';
  static icon = ChartLineIcon;

  @field seriesName = contains(StringField);
  @field labels = containsMany(StringField);
  @field values = containsMany(NumberField);

  static isolated = class Isolated extends Component<typeof LineChartDemo> {
    get points(): ChartPoint[] {
      let labels = this.args.model.labels ?? [];
      let values = this.args.model.values ?? [];
      return values.map((value, i) => ({
        label: labels[i] ?? String(i + 1),
        value: value ?? 0,
      }));
    }
    formatValue = (n: number) => formatMoney(n, 'USD');

    <template>
      <div class='demo'>
        {{#if @model.seriesName}}
          <h2>{{@model.seriesName}}</h2>
        {{/if}}
        <LineChart @points={{this.points}} @formatValue={{this.formatValue}} />
      </div>
      <style scoped>
        .demo {
          padding: 1.25rem;
        }
        h2 {
          margin: 0 0 0.875rem;
          font-size: 1.125rem;
          font-family: var(--font-heading, inherit);
        }
      </style>
    </template>
  };
}
