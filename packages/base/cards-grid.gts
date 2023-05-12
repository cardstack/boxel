import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { Component, Card, relativeTo } from './card-api';
import { CardContainer, IconButton } from '@cardstack/boxel-ui';
import { chooseCard, catalogEntryRef } from '@cardstack/runtime-common';
import { type CatalogEntry } from './catalog-entry';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardContainer class='demo-card cards-grid' @displayBoundaries={{true}}>
      This cards-grid instance should become even better.
      {{#if @actions.createCard}}
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

  @action
  createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isPrimitive: false },
      },
    });
    if (!card) {
      return;
    }

    await this.args.actions?.createCard?.(
      card.ref,
      this.args.model[relativeTo]
    );
  });
}

export class CardsGrid extends Card {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
}
