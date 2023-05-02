import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { Component, Card } from './card-api';
import { CardContainer, IconButton } from '@cardstack/boxel-ui';
import {
  chooseCard,
  catalogEntryRef,
  isCardCatalogAvailable,
} from '@cardstack/runtime-common';
import { type CatalogEntry } from './catalog-entry';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardContainer class='demo-card cards-grid' @displayBoundaries={{true}}>
      This cards-grid instance should become even better.
      {{#if this.isCardCatalogAvailable}}
        <IconButton
          @icon='icon-plus-circle'
          @width='40px'
          @height='40px'
          @tooltip='Add a new card to this collection'
          @tooltipPosition='left'
          class='add-button cards-grid__add-button'
          {{on 'click' this.selectCard}}
          data-test-create-new-card-button
        />
      {{/if}}
    </CardContainer>
  </template>

  get isCardCatalogAvailable() {
    return isCardCatalogAvailable();
  }

  @action
  selectCard() {
    this.selectNewCard.perform();
  }

  private selectNewCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isPrimitive: false },
      },
    });
    return card;
  });
}

export class CardsGrid extends Card {
  static isolated = Isolated;
}
