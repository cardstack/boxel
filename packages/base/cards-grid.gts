import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import {
  contains,
  field,
  Component,
  CardDef,
  realmInfo,
  realmURL,
  relativeTo,
  type BaseDef,
} from './card-api';
import { AddButton, Tooltip } from '@cardstack/boxel-ui';
import {
  chooseCard,
  catalogEntryRef,
  getLiveCards,
  baseRealm,
  cardTypeDisplayName,
} from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { type CatalogEntry } from './catalog-entry';
import StringField from './string';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class='cards-grid'>
      <ul class='cards' data-test-cards-grid-cards>
        {{! use "key" to keep the list stable between refreshes }}
        {{#each this.instances key='id' as |card|}}
          <li
            {{@context.cardComponentModifier
              card=card
              format='data'
              fieldType=undefined
              fieldName=undefined
            }}
            data-test-cards-grid-item={{card.id}}
          >
            <div class='grid-card'>
              <div class='grid-thumbnail'>
                <div
                  class='grid-thumbnail-text'
                  data-test-cards-grid-item-thumbnail-text
                >{{cardTypeDisplayName card}}</div>
              </div>
              <h3
                class='grid-title'
                data-test-cards-grid-item-title
              >{{card.title}}</h3>
              <h4
                class='grid-display-name'
                data-test-cards-grid-item-display-name
              >{{cardTypeDisplayName card}}</h4>
            </div>
          </li>
        {{else}}
          {{#if this.liveQuery.isLoading}}
            Loading...
          {{else}}
            <p>No cards available</p>
          {{/if}}
        {{/each}}
      </ul>

      {{#if @context.actions.createCard}}
        <div class='add-button'>
          <Tooltip @placement='left' @offset={{6}}>
            <:trigger>
              <AddButton {{on 'click' this.createNew}} />
            </:trigger>
            <:content>
              Add a new card to this collection
            </:content>
          </Tooltip>
        </div>
      {{/if}}
    </div>
    <style>
      .cards-grid {
        --grid-card-text-thumbnail-height: 6.25rem;
        --grid-card-label-color: var(--boxel-450);
        --grid-card-width: 10.125rem;
        --grid-card-height: 15.125rem;

        position: relative; /* Do not change this */
        max-width: 70rem;
        margin: 0 auto;
      }
      .cards {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(var(--grid-card-width), 1fr)
        );
        gap: var(--boxel-sp);
        justify-items: center;
        height: 100%;
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }

      .add-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        bottom: var(--boxel-sp-xl);
        z-index: 1;
      }
      .grid-card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
      }
      .grid-card > *,
      .grid-thumbnail-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .grid-thumbnail {
        display: flex;
        align-items: center;
        height: var(--grid-card-text-thumbnail-height);
        background-color: var(--boxel-teal);
        color: var(--boxel-light);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .grid-title {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        text-align: center;
      }
      .grid-display-name {
        margin: 0;
        font: 500 var(--boxel-font-xs);
        text-align: center;
        color: var(--grid-card-label-color);
      }
      .grid-thumbnail + * {
        margin-top: var(--boxel-sp-lg);
      }
      .grid-title + .grid-display-name {
        margin-top: 0.2em;
      }
    </style>
  </template>

  @tracked
  private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.liveQuery = getLiveCards(
      {
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
        // sorting by title so that we can maintain stability in
        // the ordering of the search results (server sorts results
        // by order indexed by default)
        sort: [
          {
            on: {
              module: `${baseRealm.url}card-api`,
              name: 'CardDef',
            },
            by: 'title',
          },
        ],
      },
      this.args.model[realmURL] ? [this.args.model[realmURL].href] : undefined,
      async (ready: Promise<void> | undefined) => {
        if (this.args.context?.actions) {
          this.args.context.actions.doWithStableScroll(
            this.args.model as CardDef,
            async () => {
              await ready;
            },
          );
        }
      },
    );
  }

  get instances() {
    if (!this.liveQuery) {
      return;
    }
    return this.liveQuery.instances;
  }

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

    // before auto save we used to add the new card to the stack
    // after it was created. now this no longer really makes sense
    // after auto-save. The card is in the stack in an edit mode.
    //if the user wants to view the card in isolated mode they can
    // just toggle the edit button. otherwise we'll pop 2 of the
    // same cards into the stack.
    await this.args.context?.actions?.createCard?.(
      card.ref,
      this.args.model[relativeTo],
    );
  });
}

export class CardsGrid extends CardDef {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
  @field realmName = contains(StringField, {
    computeVia: function (this: CardsGrid) {
      return this[realmInfo]?.name;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: CardsGrid) {
      return this.realmName;
    },
  });

  static getDisplayName(instance: BaseDef) {
    if (instance instanceof CardDef) {
      return instance[realmInfo]?.name ?? this.displayName;
    }
    return this.displayName;
  }
}
