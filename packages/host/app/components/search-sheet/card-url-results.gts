import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { CardDef } from 'https://cardstack.com/base/card-api';

import ResultsSection from './results-section';

interface Signature {
  Element: HTMLElement;
  Args: {
    url: string;
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
    fetchCardByUrlResult: { card: CardDef | null } | undefined;
  };
  Blocks: {};
}
export default class CardURLResults extends Component<Signature> {
  private get card() {
    return this.args.fetchCardByUrlResult?.card;
  }

  private get searchLabel() {
    let searchResult = this.args.fetchCardByUrlResult;
    if (searchResult) {
      if (searchResult.card) {
        return `Card found at ${this.args.url}`;
      } else {
        return `No card found at ${this.args.url}`;
      }
    } else {
      return `Fetching ${this.args.url}`;
    }
  }

  <template>
    <ResultsSection
      @label={{this.searchLabel}}
      @isCompact={{@isCompact}}
      as |SearchResult|
    >
      {{#if this.card}}
        <SearchResult
          @card={{this.card}}
          @cardId={{this.card.id}}
          @isCompact={{@isCompact}}
          {{on 'click' (fn @handleCardSelect this.card.id)}}
          data-test-search-sheet-search-result='0'
        />
      {{/if}}
    </ResultsSection>
  </template>
}
