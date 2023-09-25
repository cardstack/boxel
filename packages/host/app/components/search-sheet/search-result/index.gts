import Component from '@glimmer/component';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import { cardTypeDisplayName } from '@cardstack/runtime-common';
import { CardContainer } from '@cardstack/boxel-ui';
import { trackedFunction } from 'ember-resources/util/function';
import type CardService from '../../../services/card-service';
import { service } from '@ember/service';
import cn from '@cardstack/boxel-ui/helpers/cn';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: CardDef;
    compact?: boolean;
  };
}

export default class SearchResult extends Component<Signature> {
  <template>
    <CardContainer
      @displayBoundaries={{true}}
      class={{cn 'search-result' is-compact=@compact}}
      data-test-search-result={{@card.id}}
      ...attributes
    >
      <header class='search-result__title'>{{@card.title}}</header>
      <p class='search-result__subtitle'>
        <span class='search-result__display-name'>
          {{cardTypeDisplayName @card}}
        </span>
        <span class='search-result__realm-name'>In {{this.realmName}}</span>
      </p>
    </CardContainer>
    <style>
      .search-result {
        padding: var(--boxel-sp);
        width: 250px;
        cursor: pointer;
      }
      .search-result.is-compact {
        width: 199px;
        height: 50px;
        padding: var(--boxel-sp-xxs);
      }
      .search-result__title {
        margin-bottom: var(--boxel-sp-xs);
        font: 500 var(--boxel-font-sm);
        overflow: hidden;
        text-wrap: nowrap;
      }
      .search-result__subtitle {
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .is-compact .search-result__title {
        margin-bottom: 0;
      }
      .search-result__display-name {
        margin: 0;
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-450);
      }
      .search-result:not(.is-compact) .search-result__realm-name {
        display: block;
      }
      .search-result__realm-name {
        margin: 0;
        color: var(--boxel-teal);
        font-size: var(--boxel-font-size-xs);
      }
      .is-compact .search-result__display-name:after {
        content: ', ';
      }
    </style>
  </template>

  @service declare cardService: CardService;

  fetchRealmName = trackedFunction(this, async () => {
    let realmInfoSymbol = await this.cardService.getRealmInfo(this.args.card);
    return realmInfoSymbol?.name;
  });

  get realmName() {
    return this.fetchRealmName.value ?? '';
  }
}
