import Component from '@glimmer/component';

import type { Deal } from './deal';
import type { Query } from '@cardstack/runtime-common';

import SummaryCard from './components/summary-card';
import SummaryGridContainer from './components/summary-grid-container';

import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import CalculatorIcon from '@cardstack/boxel-icons/calculator';
import NumbersIcon from '@cardstack/boxel-icons/numbers';
import ChartCovariateIcon from '@cardstack/boxel-icons/chart-covariate';
import { type CardContext } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    query: Query;
    realmHrefs: string[];
    context?: CardContext;
  };
}

function formatCurrencyValue(value: number, currencySymbol: string) {
  return `${currencySymbol} ${value.toLocaleString('en-US')}`;
}

export class DealSummary extends Component<Signature> {
  dealCardsQuery = this.args.context?.getCards(
    this,
    () => this.args.query,
    () => this.args.realmHrefs,
    {
      isLive: true,
    },
  );

  get deals() {
    return (this.dealCardsQuery?.instances || []) as Deal[];
  }

  get dealSummaries() {
    if (
      !this.deals ||
      this.deals.length === 0 ||
      this.dealCardsQuery?.isLoading
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
      <SummaryCard
        @size='small'
        @iconComponent={{TrendingUpIcon}}
        @title='Total Deal Value'
      >
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
      <SummaryCard
        @size='small'
        @iconComponent={{CalculatorIcon}}
        @title='Average Deal Size'
      >
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
      <SummaryCard
        @size='small'
        @iconComponent={{NumbersIcon}}
        @title='Deal Count'
      >
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
      <SummaryCard
        @size='small'
        @iconComponent={{ChartCovariateIcon}}
        @title='Predicted Revenue'
      >
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
      .value {
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}

export default DealSummary;
