import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { trackedFunction } from 'ember-resources/util/function';

import { TrackedArray } from 'tracked-built-ins';

import { and, bool } from '@cardstack/boxel-ui/helpers';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import { consumeContext } from '@cardstack/host/helpers/consume-context';

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
  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare recentCardsService: RecentCards;
  @tracked private recentCardCollectionResource:
    | {
        value: TrackedArray<ReturnType<getCard>> | null;
      }
    | undefined;

  private makeCardResources = () => {
    this.recentCardCollectionResource = trackedFunction(
      this,
      () =>
        new TrackedArray(
          this.recentCardsService.recentCardIds.map((id) =>
            this.getCard(this, () => id),
          ),
        ),
    );
  };

  private get recentCardResources() {
    return this.recentCardCollectionResource?.value;
  }

  get hasRecentCards() {
    return this.recentCardResources
      ? this.recentCardResources.length > 0
      : false;
  }

  <template>
    {{consumeContext this.makeCardResources}}

    {{#if (and (bool this.recentCardResources) this.hasRecentCards)}}
      <ResultsSection
        @label='Recent'
        @isCompact={{@isCompact}}
        as |SearchResult|
      >
        {{#each this.recentCardResources as |cardResource i|}}
          {{#let cardResource.card as |card|}}
            {{#if card}}
              <SearchResult
                @card={{card}}
                @cardId={{card.id}}
                @isCompact={{@isCompact}}
                {{on 'click' (fn @handleCardSelect card.id)}}
                data-test-search-result-index={{i}}
              />
            {{/if}}
          {{/let}}
        {{/each}}
      </ResultsSection>
    {{/if}}
  </template>
}
