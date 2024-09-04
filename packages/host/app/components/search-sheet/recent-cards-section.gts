import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import RecentCards from '@cardstack/host/services/recent-cards-service';

import ResultsSection from './results-section';

interface Signature {
  Element: HTMLElement;
  Args: {
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
  };
  Blocks: {};
}

export default class RecentCardsSection extends Component<Signature> {
  @service declare recentCardsService: RecentCards;

  @cached
  private get orderedRecentCards() {
    // Most recently added first
    return [...this.recentCardsService.recentCards].reverse();
  }

  <template>
    {{#if this.recentCardsService.any}}
      <ResultsSection
        @label='Recent'
        @isCompact={{@isCompact}}
        as |SearchResult|
      >
        {{#each this.orderedRecentCards as |card i|}}
          <SearchResult
            @card={{card}}
            @cardId={{card.id}}
            @isCompact={{@isCompact}}
            {{on 'click' (fn @handleCardSelect card.id)}}
            data-test-search-result-index={{i}}
          />
        {{/each}}
      </ResultsSection>
    {{/if}}
  </template>
}
