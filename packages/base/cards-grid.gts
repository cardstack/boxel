import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { Component, Card } from './card-api';
import { CardContainer, IconButton } from '@cardstack/boxel-ui';
import {
  chooseCard,
  catalogEntryRef,
  createNewCard,
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
          {{on 'click' this.createNew}}
          data-test-create-new-card-button
        />
      {{/if}}
    </CardContainer>
  </template>

  get isCardCatalogAvailable() {
    return isCardCatalogAvailable();
  }

  @action
  async createNew() {
    this.createNewCard.perform();
  }

  private createNewCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isPrimitive: false },
      },
    });
    if (!card) {
      return;
    }
    let newCard = await createNewCard(card.ref, new URL(card.id));
    if (!newCard) {
      throw new Error(
        `bug: could not create new card from catalog entry ${JSON.stringify(
          catalogEntryRef
        )}`
      );
    }
    return newCard;
  });
}

export class CardsGrid extends Card {
  static typeDisplayName = 'Cards Grid';
  static isolated = Isolated;
}
