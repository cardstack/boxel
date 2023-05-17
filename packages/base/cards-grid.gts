import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { Component, Card, relativeTo } from './card-api';
import { CardContainer, IconButton } from '@cardstack/boxel-ui';
import {
  chooseCard,
  catalogEntryRef,
  getCards,
  baseRealm,
} from '@cardstack/runtime-common';
import { type CatalogEntry } from './catalog-entry';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardContainer class='cards-grid'>
      <ul class='cards-grid__cards'>
        {{#each this.request.instances as |card|}}
          <li data-test-cards-grid-item={{card.id}}>
            <CardContainer class='grid-card'>
              <div class='grid-card__thumbnail'>
                <div
                  class='grid-card__thumbnail-text'
                  data-test-cards-grid-item-thumbnail-text
                >{{card.constructor.displayName}}</div>
              </div>
              <h3
                class='grid-card__title'
                data-test-cards-grid-item-title
              >{{card.title}}</h3>
              <h4
                class='grid-card__display-name'
                data-test-cards-grid-item-display-name
              >{{card.constructor.displayName}}</h4>
            </CardContainer>
          </li>
        {{else}}
          {{#if this.request.isLoading}}
            Loading...
          {{else}}
            <p>No cards available</p>
          {{/if}}
        {{/each}}
      </ul>

      {{#if @context.actions.createCard}}
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

  @tracked request?: {
    instances: Card[];
    isLoading: boolean;
  };

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.getRealmCards.perform();
  }

  private getRealmCards = restartableTask(async () => {
    this.request = await getCards({
      filter: {
        not: {
          any: [
            { type: catalogEntryRef },
            {
              type: {
                module: `${baseRealm.url}cards-grid`,
                name: 'CardsGrid',
              },
            },
          ],
        },
      },
    });
  });

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

    await this.args.context?.actions?.createCard?.(
      card.ref,
      this.args.model[relativeTo]
    );
  });
}

export class CardsGrid extends Card {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
}
