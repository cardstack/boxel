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
  linksToMany,
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
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from './catalog-entry';
import StringField from './string';
import { TrackedArray } from 'tracked-built-ins';
import { not } from '@cardstack/boxel-ui/helpers';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class='cards-grid'>
      <div class='sidebar'>
        <FilterList
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onFilterChanged}}
        />
      </div>
      <div class='content'>
        <span class='headline'>{{this.activeFilter.displayName}}</span>
        <ul class='cards' data-test-cards-grid-cards>
          {{#if (not this.hideCards)}}
            {{#let
              (component @context.prerenderedCardSearchComponent)
              as |PrerenderedCardSearch|
            }}
              <PrerenderedCardSearch
                @query={{this.activeFilter.query}}
                @format='fitted'
                @realms={{this.realms}}
              >

                <:loading>
                  Loading...
                </:loading>
                <:response as |cards|>
                  {{measureLoadTime}}
                  {{#each cards as |card|}}
                    <CardContainer class='card'>
                      <li
                        {{@context.cardComponentModifier
                          cardId=card.url
                          format='data'
                          fieldType=undefined
                          fieldName=undefined
                        }}
                        data-test-cards-grid-item={{removeFileExtension
                          card.url
                        }}
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
          {{/if}}
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

    <style scoped>
      :global(:root) {
        --cards-grid-padding-top: var(--boxel-sp-lg);
      }
      .cards-grid {
        --grid-card-width: 11.125rem;
        --grid-card-height: 15.125rem;

        padding: var(--cards-grid-padding-top) 0 0 var(--boxel-sp-sm);

        display: flex;
        gap: var(--boxel-sp-xl);
        height: 100%;
        overflow: hidden;
      }
      .sidebar {
        position: relative;
      }
      :deep(.filter-list) {
        position: sticky;
        top: var(--cards-grid-padding-top);
        padding-right: var(--boxel-sp-sm);
        height: 100%;
        overflow-y: auto;
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
        overflow-y: auto;
        padding-right: var(--boxel-sp-sm);
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
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        justify-items: center;
        flex-grow: 1;
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

  constructor(owner: any, args: any) {
    super(owner, args);
    this.loadFilterList.perform();
  }

  filters: { displayName: string; query: any }[] = new TrackedArray([
    {
      displayName: 'Favorites',
      query: {
        filter: {
          any:
            this.args.model['favorites']?.map((card) => {
              return { eq: { id: card.id } } ?? {};
            }) ?? [],
        },
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
      },
    },
    {
      displayName: 'All Cards',
      query: {
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
      },
    },
  ]);
  @tracked activeFilter = this.filters[0];

  @action onFilterChanged(filter: Filter) {
    this.activeFilter = filter;
  }

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  @action
  createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isField: false },
      },
    });
    if (!card) {
      return;
    }

    await this.args.context?.actions?.createCard?.(card.ref, new URL(card.id), {
      realmURL: this.args.model[realmURL],
    });
  });

  private loadFilterList = restartableTask(async () => {
    let response = await fetch(`${this.realms[0]}_types`, {
      headers: {
        Accept: SupportedMimeType.CardTypeSummary,
      },
    });
    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} -
          ${response.statusText}. ${responseText}`,
      ) as any;

      err.status = response.status;
      err.responseText = responseText;

      throw err;
    }
    let cardTypeSummaries = (await response.json()).data as {
      id: string;
      attributes: { displayName: string; total: number };
    }[];
    cardTypeSummaries.forEach((summary) => {
      if (summary.attributes.displayName === 'Cards Grid') {
        return;
      }
      const lastIndex = summary.id.lastIndexOf('/');
      this.filters.push({
        displayName: summary.attributes.displayName,
        query: {
          filter: {
            type: {
              module: summary.id.substring(0, lastIndex),
              name: summary.id.substring(lastIndex + 1),
            },
          },
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
        },
      });
    });
  });

  private get hideCards() {
    return (
      this.activeFilter.displayName === 'Favorites' &&
      (!this.args.model['favorites'] ||
        this.args.model['favorites'].length === 0)
    );
  }
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
  @field favorites = linksToMany(CardDef);

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

function measureLoadTime() {
  // we consider rendering the cards grid part of the app
  // boot, so this is where we'll measure the app boot time.
  if ((globalThis as any).__bootStart) {
    console.log(
      `time since app boot: ${
        performance.now() - (globalThis as any).__bootStart
      } ms`,
    );
  }
}
