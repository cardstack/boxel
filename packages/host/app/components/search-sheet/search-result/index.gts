import Component from '@glimmer/component';
import type { Card } from 'https://cardstack.com/base/card-api';
import { cardTypeDisplayName } from '@cardstack/runtime-common';
import { CardContainer } from '@cardstack/boxel-ui';
import { trackedFunction } from 'ember-resources/util/function';
import type CardService from '../../../services/card-service';
import { service } from '@ember/service';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: Card;
    index: number; //currently this arg is only for testing purposes
  };
}

export default class SearchResult extends Component<Signature> {
  <template>
    <CardContainer @displayBoundaries={{true}} class='search-result' data-test-search-result-index={{@index}} data-test-search-result={{@card.id}}>
      <header class='search-result__title'>{{@card.title}}</header>
      <p class='search-result__display-name'>{{cardTypeDisplayName @card}}</p>
      <p class='search-result__realm-name'>In {{this.realmName}}</p>
    </CardContainer>
    <style>
      .search-result { padding: var(--boxel-sp); width: 250px; }
      .search-result__title { margin-bottom: var(--boxel-sp-xs); font: 500 var(--boxel-font-sm); overflow: hidden; text-wrap: nowrap; }
      .search-result__display-name { margin: 0; font: 500 var(--boxel-font-xs); color: #919191}
      .search-result__realm-name { margin: 0; color: var(--boxel-teal); font-size: var(--boxel-font-size-xs); }
    </style>
  </template>

  @service declare cardService: CardService;

  fetchRealmName = trackedFunction(this, async () => {
    let realmInfoSymbol = await this.cardService.realmInfoSymbol();
    // @ts-ignore allows using Symbol as an index
    return this.args.card[realmInfoSymbol]?.name;
  });

  get realmName() {
    return this.fetchRealmName.value ?? '';
  }
}
