import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { cn } from '@cardstack/boxel-ui/helpers';

import { CardDef } from 'https://cardstack.com/base/card-api';

import Preview from '../../preview';
import ResultsSection from '../results-section';

import { removeFileExtension } from '../utils';

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
    <ResultsSection @label={{this.searchLabel}} @isCompact={{@isCompact}}>
      {{#if this.card}}
        <Preview
          @card={{this.card}}
          @format='embedded'
          {{on 'click' (fn @handleCardSelect this.card.id)}}
          class={{cn 'search-result' is-compact=@isCompact}}
          data-test-search-sheet-search-result='0'
          data-test-search-result={{removeFileExtension this.card.id}}
        />
      {{/if}}
    </ResultsSection>
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
