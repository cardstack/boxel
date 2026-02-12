import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import type RecentCards from '@cardstack/host/services/recent-cards-service';

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
  @service declare private recentCardsService: RecentCards;
  @tracked private recentCardCollection = getCardCollection(
    this,
    () => this.recentCardsService.recentCardIds,
  );

  get hasRecentCards() {
    return this.recentCardsService.recentCardIds.length > 0;
  }

  <template>
    {{#if this.hasRecentCards}}
      <ResultsSection
        @label={{@label}}
        @isCompact={{@isCompact}}
        as |SearchResult|
      >
        {{#each this.recentCardCollection.cards as |card i|}}
          {{#if card}}
            <SearchResult
              @card={{card}}
              @cardId={{card.id}}
              @isCompact={{@isCompact}}
              {{on 'click' (fn @handleCardSelect card.id)}}
              data-test-search-result-index={{i}}
            />
          {{/if}}
        {{/each}}
      </ResultsSection>
    {{/if}}
  </template>
}
