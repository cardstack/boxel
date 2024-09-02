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
  type BaseDef,
} from './card-api';
import {
  AddButton,
  CardContainer,
  FilterList,
  Tooltip,
  type Filter,
} from '@cardstack/boxel-ui/components';
import {
  chooseCard,
  catalogEntryRef,
  baseRealm,
  isCardInstance,
} from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from './catalog-entry';
import StringField from './string';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class='cards-grid'>
      <FilterList
        @filters={{this.filters}}
        @activeFilter={{this.activeFilter}}
        @onChanged={{this.onFilterChanged}}
      />
      <div class='content'>
        <span class='headline'>{{this.activeFilter.displayName}}</span>
        <ul class='cards' data-test-cards-grid-cards>
          {{#let
            (component @context.prerenderedCardSearchComponent)
            as |PrerenderedCardSearch|
          }}
            <PrerenderedCardSearch
              @query={{this.query}}
              @format='fitted'
              @realms={{this.realms}}
            >

              <:loading>
                Loading...
              </:loading>
              <:response as |cards|>
                {{#each cards as |card|}}
                  <CardContainer class='card'>
                    <li
                      {{@context.cardComponentModifier
                        cardId=card.url
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                      data-test-cards-grid-item={{removeFileExtension card.url}}
                      {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                      data-cards-grid-item={{removeFileExtension card.url}}
                    >
                      {{card.component}}
                    </li>
                  </CardContainer>
                {{/each}}
              </:response>
            </PrerenderedCardSearch>
          {{/let}}
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
    </div>

    <style>
      .cards-grid {
        --grid-card-width: 11.125rem;
        --grid-card-height: 15.125rem;

        padding: var(--boxel-sp-lg) var(--boxel-sp-sm);

        display: flex;
        gap: var(--boxel-sp-xl);
      }
      :deep(.filter-list__button:first-child) {
        margin-bottom: var(--boxel-sp-xl);
      }
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        position: relative; /* Do not change this */
      }
      .headline {
        font: bold var(--boxel-font-lg);
        line-height: 1.58;
        letter-spacing: 0.21px;
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
      .card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        overflow: hidden;
        cursor: pointer;
        container-name: fitted-card;
        container-type: size;
      }
      .add-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        width: fit-content;
        bottom: var(--boxel-sp-xl);
        z-index: 1;
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }
    </style>
  </template>

  private filters: Filter[] = [
    {
      displayName: 'All Apps',
      query: {
        filter: {
          eq: {
            _cardType: 'Apps',
          },
        },
      },
    },
    {
      displayName: 'All Cards',
      query: {
        filter: {
          eq: {
            _cardType: 'Card',
          },
        },
      },
    },
    {
      displayName: 'Person',
      query: {
        filter: {
          eq: {
            _cardType: 'Person',
          },
        },
      },
    },
    {
      displayName: 'Pet',
      query: {
        filter: {
          eq: {
            _cardType: 'Pet',
          },
        },
      },
    },
  ];
  @tracked activeFilter = this.filters[0];

  @action onFilterChanged(filter: Filter) {
    this.activeFilter = filter;
  }

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get query() {
    return {
      filter: {
        not: {
          eq: {
            _cardType: 'Cards Grid',
          },
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
          by: '_cardType',
        },
        {
          on: {
            module: `${baseRealm.url}card-api`,
            name: 'CardDef',
          },
          by: 'title',
        },
      ],
    };
  }

  @action
  createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        every: [{ eq: { isField: false } }],
      },
    });
    if (!card) {
      return;
    }

    await this.args.context?.actions?.createCard?.(card.ref, new URL(card.id), {
      realmURL: this.args.model[realmURL],
    });
  });
}

export class CardsGrid extends CardDef {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
  static prefersWideFormat = true;
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
    if (isCardInstance(instance)) {
      return (instance as CardDef)[realmInfo]?.name ?? this.displayName;
    }
    return this.displayName;
  }
}
function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
