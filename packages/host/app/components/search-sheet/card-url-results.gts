import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { GetCardContextName, type getCard } from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import ResultsSection from './results-section';

interface Signature {
  Element: HTMLElement;
  Args: {
    url: string;
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
    searchKeyAsURL: string | undefined;
  };
  Blocks: {};
}
export default class CardURLResults extends Component<Signature> {
  @consume(GetCardContextName) declare private getCard: getCard;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.args.searchKeyAsURL);
  };

  private get card() {
    return this.cardResource?.card;
  }

  private get searchLabel() {
    if (this.cardResource && !this.cardResource.isLoaded) {
      return `Fetching ${this.args.url}`;
    }
    if (this.card) {
      return `Card found at ${this.args.url}`;
    }
    if (this.cardResource?.cardError) {
      return `No card found at ${this.args.url}`;
    }
    return '';
  }

  <template>
    {{consumeContext this.makeCardResource}}
    <ResultsSection
      @label={{this.searchLabel}}
      @isCompact={{@isCompact}}
      as |SearchResult|
    >
      {{#if this.card}}
        <SearchResult
          @cardId={{this.card.id}}
          @card={{this.card}}
          @isCompact={{@isCompact}}
          {{on 'click' (fn @handleCardSelect this.card.id)}}
          data-test-search-sheet-search-result='0'
        />
      {{/if}}
    </ResultsSection>
  </template>
}
