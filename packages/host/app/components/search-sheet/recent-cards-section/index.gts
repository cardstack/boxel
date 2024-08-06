import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { cn } from '@cardstack/boxel-ui/helpers';

import RecentCards from '@cardstack/host/services/recent-cards-service';

import Preview from '../../preview';
import ResultsSection from '../results-section';
import { removeFileExtension } from '../utils';

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
      <ResultsSection @label='Recent' @isCompact={{@isCompact}}>
        {{#each this.orderedRecentCards as |card i|}}
          <Preview
            @card={{card}}
            @format='embedded'
            {{on 'click' (fn @handleCardSelect card.id)}}
            data-test-search-sheet-recent-card-index={{i}}
            data-test-search-sheet-recent-card={{removeFileExtension card.id}}
            class={{cn 'search-result' is-compact=@isCompact}}
          />
        {{/each}}
      </ResultsSection>
    {{/if}}
    <style>
      /* current duplicated in card-query-results */
      .search-result.field-component-card.embedded-format {
        width: 311px;
        height: 76px;
        overflow: hidden;
        cursor: pointer;
        container-name: embedded-card;
        container-type: size;
      }
      .search-result.field-component-card.embedded-format.is-compact {
        width: 199px;
        height: 50px;
      }
    </style>
  </template>
}
