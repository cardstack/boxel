import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { Component, Card, relativeTo } from './card-api';
import { IconButton } from '@cardstack/boxel-ui';
import {
  chooseCard,
  catalogEntryRef,
  getCards,
  baseRealm,
  cardTypeDisplayName,
} from '@cardstack/runtime-common';
import { type CatalogEntry } from './catalog-entry';
import { fn } from '@ember/helper';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class='cards-grid'>
      <ul class='cards-grid__cards'>
        {{#each this.request.instances as |card|}}
          <li
            data-test-cards-grid-item={{card.id}}
            {{on 'click' (fn this.openCard card)}}
          >
            <div class='grid-card'>
              <div class='grid-card__thumbnail'>
                <div
                  class='grid-card__thumbnail-text'
                  data-test-cards-grid-item-thumbnail-text
                >{{cardTypeDisplayName card}}</div>
              </div>
              <h3
                class='grid-card__title'
                data-test-cards-grid-item-title
              >{{card.title}}</h3>
              <h4
                class='grid-card__display-name'
                data-test-cards-grid-item-display-name
              >{{cardTypeDisplayName card}}</h4>
            </div>
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
    </div>
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

  @action openCard(card: Card) {
    this.args.context?.actions?.viewCard(card);
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

    let newCard = await this.args.context?.actions?.createCard?.(
      card.ref,
      this.args.model[relativeTo]
    );

    if (newCard) {
      this.openCard(newCard);
    }
  });
}

export class CardsGrid extends Card {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
}
