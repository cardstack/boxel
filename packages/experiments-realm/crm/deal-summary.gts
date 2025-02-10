import Component from '@glimmer/component';

import { getCards } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common';
import type { Deal } from './shared';

import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';

import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import CalculatorIcon from '@cardstack/boxel-icons/calculator';
import NumbersIcon from '@cardstack/boxel-icons/numbers';
import ChartCovariateIcon from '@cardstack/boxel-icons/chart-covariate';

interface Signature {
  Args: {
    query: Query;
    realmHrefs: string[];
  };
}

function formatCurrencyValue(value: number, currencySymbol: string) {
  return `${currencySymbol} ${value.toLocaleString('en-US')}`;
}

export class DealSummary extends Component<Signature> {
  dealCardsQuery = getCards(
    () => this.args.query,
    () => this.args.realmHrefs,
    {
      isLive: true,
    },
  );

  get deals() {
    return (this.dealCardsQuery.instances || []) as Deal[];
  }

  get dealSummaries() {
    if (
      !this.deals ||
      this.deals.length === 0 ||
      this.dealCardsQuery.isLoading
    ) {
      return undefined;
    }

    // TODO: In future we might need to deal with different currencies
    // We assume currently is all the same

    const currencySymbol = this.deals[0].computedValue?.currency.symbol;

    let totalDealValue = 0;
    let totalDealCount = this.deals.length;
    let predictedRevenue = 0;

    for (let deal of this.deals) {
      totalDealValue += deal.computedValue?.amount ?? 0;
      predictedRevenue += deal.predictedRevenue?.amount ?? 0;
    }

    const averageDealSize = totalDealValue / totalDealCount || 0;

    return {
      totalDealValue: formatCurrencyValue(totalDealValue, currencySymbol),
      totalDealCount,
      predictedRevenue: formatCurrencyValue(predictedRevenue, currencySymbol),
      averageDealSize: formatCurrencyValue(averageDealSize, currencySymbol),
    };
  }

  <template>
    <SummaryGridContainer>
      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Total Deal Value</h3>
        </:title>
        <:icon>
          <TrendingUpIcon class='header-icon' />
        </:icon>
        <:content>
          <div class='value'>
            {{#if this.dealSummaries}}
              {{this.dealSummaries.totalDealValue}}
            {{else}}
              -
            {{/if}}
          </div>
        </:content>
      </SummaryCard>
      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Average Deal Size</h3>
        </:title>
        <:icon>
          <CalculatorIcon class='header-icon' />
        </:icon>
        <:content>
          <div class='value'>
            {{#if this.dealSummaries}}
              {{this.dealSummaries.averageDealSize}}
            {{else}}
              -
            {{/if}}
          </div>
        </:content>
      </SummaryCard>
      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Deal Count</h3>
        </:title>
        <:icon>
          <NumbersIcon class='header-icon' />
        </:icon>
        <:content>
          <div class='value'>
            {{#if this.dealSummaries}}
              {{this.dealSummaries.totalDealCount}}
            {{else}}
              -
            {{/if}}
          </div>
        </:content>
      </SummaryCard>
      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Predicted Revenue</h3>
        </:title>
        <:icon>
          <ChartCovariateIcon class='header-icon' />
        </:icon>
        <:content>
          <div class='value'>
            {{#if this.dealSummaries}}
              {{this.dealSummaries.predictedRevenue}}
            {{else}}
              -
            {{/if}}
          </div>
        </:content>
      </SummaryCard>
    </SummaryGridContainer>
    <style scoped>
      h1,
      h2,
      h3,
      h4,
      p {
        margin: 0;
      }
      .summary-title {
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .value {
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}

export default DealSummary;
