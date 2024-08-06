import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { cn } from '@cardstack/boxel-ui/helpers';

import { CardDef } from 'https://cardstack.com/base/card-api';

import { getCard } from '../../../resources/card-resource';
import Preview from '../../preview';
import ResultsSection from '../results-section';

import { removeFileExtension } from '../utils';

import type CardService from '../../../services/card-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

const waiter = buildWaiter('prerendered-card-search:waiter');

interface Signature {
  Element: HTMLElement;
  Args: {
    url: string;
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
  };
  Blocks: {};
}
export default class CardURLResults extends Component<Signature> {
  @service declare cardService: CardService;
  @tracked private cardFromURL: CardDef | null = null;

  private getCard = restartableTask(async (cardURL: string) => {
    this.cardFromURL = null;

    let maybeIndexCardURL = this.cardService.realmURLs.find(
      (u) => u === cardURL + '/',
    );
    const cardResource = getCard(this, () => maybeIndexCardURL ?? cardURL, {
      isLive: () => false,
    });
    let token = waiter.beginAsync();
    try {
      await cardResource.loaded;
      let { card } = cardResource;
      if (!card) {
        console.warn(`Unable to fetch card at ${cardURL}`);
        return;
      }
      this.cardFromURL = card;
    } finally {
      waiter.endAsync(token);
    }
  });

  private get search() {
    this.getCard.perform(this.args.url);
    let self = this;
    return {
      get label() {
        if (self.getCard.isRunning) {
          return `Fetching ${self.args.url}`;
        }
        if (self.cardFromURL) {
          return `Card found at ${self.args.url}`;
        }
        return `No card found at ${self.args.url}`;
      },
    };
  }

  <template>
    <ResultsSection @label={{this.search.label}} @isCompact={{@isCompact}}>
      {{#if this.cardFromURL}}
        <Preview
          @card={{this.cardFromURL}}
          @format='embedded'
          {{on 'click' (fn @handleCardSelect this.cardFromURL.id)}}
          class={{cn 'search-result' is-compact=@isCompact}}
          data-test-search-sheet-search-result='0'
          data-test-search-result={{removeFileExtension this.cardFromURL.id}}
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
