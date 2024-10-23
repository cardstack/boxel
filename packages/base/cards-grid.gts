import { action } from '@ember/object';
import { fn } from '@ember/helper';
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
  IconButton,
  Tooltip,
  type Filter,
  BoxelDropdown,
  Menu as BoxelMenu,
  BoxelButton,
} from '@cardstack/boxel-ui/components';
import { IconList, IconGrid } from '@cardstack/boxel-ui/icons';
import { eq, cn } from '@cardstack/boxel-ui/helpers';
import {
  chooseCard,
  catalogEntryRef,
  baseRealm,
  isCardInstance,
  SupportedMimeType,
  Query,
} from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from './catalog-entry';
import StringField from './string';
import { TrackedArray } from 'tracked-built-ins';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';

interface SortOption {
  displayName: string;
  sort: Query['sort'];
}

let availableSortOptions: SortOption[] = [
  {
    displayName: 'A-Z',
    sort: [
      {
        on: {
          module: `${baseRealm.url}card-api`,
          name: 'CardDef',
        },
        by: 'title',
        direction: 'asc',
      },
    ],
  },
  {
    displayName: 'Date Updated',
    sort: [
      {
        by: 'lastModified',
        direction: 'desc',
      },
    ],
  },
  {
    displayName: 'Date Created',
    sort: [
      {
        by: 'createdAt',
        direction: 'desc',
      },
    ],
  },
];

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class={{cn 'cards-grid' strip-view=(eq this.viewSize 'strip')}}>
      <div class='sidebar'>
        <FilterList
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onFilterChanged}}
        />
      </div>
      <div class='content'>
        <div class='top-bar'>
          <div class='title'>
            {{this.activeFilter.displayName}}
          </div>
          <div class='view-as'>
            <span>View as</span>
            <IconButton
              @icon={{IconList}}
              @width='20px'
              @height='20px'
              class={{cn
                'view-as__button'
                is-selected-view=(eq this.viewSize 'strip')
              }}
              {{on 'click' (fn (mut this.viewSize) 'strip')}}
            />
            <IconButton
              @icon={{IconGrid}}
              @width='20px'
              @height='20px'
              class={{cn
                'view-as__button'
                is-selected-view=(eq this.viewSize 'grid')
              }}
              {{on 'click' (fn (mut this.viewSize) 'grid')}}
            />
          </div>
          <div class='sorting'>
            <span>
              Sort by
            </span>

            <BoxelDropdown>
              <:trigger as |bindings|>
                <BoxelButton class='sort-button' {{bindings}}>
                  {{this.selectedSortOption.displayName}}
                  <DropdownArrowDown width='12px' height='12px' />
                </BoxelButton>
              </:trigger>
              <:content as |dd|>
                <BoxelMenu
                  @closeMenu={{dd.close}}
                  @items={{this.sortMenuOptions}}
                />
              </:content>
            </BoxelDropdown>
          </div>
        </div>

        <ul class='cards' data-test-cards-grid-cards>
          {{#if this.isShowingCards}}
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
                    <li
                      class='card'
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
                      <CardContainer @displayBoundaries='true'>
                        {{card.component}}
                      </CardContainer>
                    </li>
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
      .top-bar {
        display: grid;
        grid-template-columns: 1fr auto auto;
        padding-right: var(--boxel-sp);
        gap: var(--boxel-sp-xxxl);
      }
      .sort-button {
        border-radius: var(--boxel-border-radius);
        min-width: 200px;
        justify-content: flex-start;
        padding-left: var(--boxel-sp-sm);
        padding-right: var(--boxel-sp-sm);
      }

      .sort-button > svg {
        margin-left: auto;
      }
      .sorting {
        margin-left: auto;
      }
      .sorting > span {
        margin-right: var(--boxel-sp-xs);
      }
      .title {
        font: bold var(--boxel-font-lg);
        line-height: 1.58;
        letter-spacing: 0.21px;
      }
      .cards-grid {
        --grid-card-min-width: 11.125rem;
        --grid-card-max-width: 1fr;
        --grid-card-height: 15.125rem;

        padding: var(--cards-grid-padding-top) 0 0 var(--boxel-sp-sm);

        display: flex;
        gap: var(--boxel-sp-xl);
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
      }
      .strip-view {
        --grid-card-min-width: 21.875rem;
        --grid-card-max-width: calc(50% - var(--boxel-sp));
        --grid-card-height: 6.125rem;
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
      .view-as {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .view-as > span {
        text-wrap: nowrap;
        margin-right: var(--boxel-sp-xxs);
      }
      .view-as__button {
        --boxel-icon-button-width: 20px;
        --boxel-icon-button-height: 20px;
        --icon-color: var(--boxel-450);
      }
      .is-selected-view {
        --icon-color: var(--boxel-dark);
      }
      .cards {
        list-style-type: none;
        margin: 0;
        padding: 0;
        padding-left: 1px;
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(var(--grid-card-min-width), var(--grid-card-max-width))
        );
        grid-auto-rows: var(--grid-card-height);
        gap: var(--boxel-sp);
        flex-grow: 1;
      }
      .card {
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

  filters: { displayName: string; query: any }[] = new TrackedArray([
    {
      displayName: 'Favorites',
      query: {
        filter: {
          any:
            this.args.model.favorites?.map((card) => {
              return { eq: { id: card.id } } ?? {};
            }) ?? [],
        },
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
      },
    },
  ]);

  @tracked private selectedSortOption: SortOption = availableSortOptions[0];
  @tracked activeFilter = this.filters[0];
  @tracked viewSize: 'grid' | 'strip' = 'grid';

  @action setSelectedSortOption(option: SortOption) {
    this.selectedSortOption = option;
    this.activeFilter = this.activeFilter;
  }

  @action onFilterChanged(filter: Filter) {
    this.activeFilter = filter;
  }

  @action
  createNew() {
    this.createCard.perform();
  }

  constructor(owner: any, args: any) {
    super(owner, args);
    this.loadFilterList.perform();
  }

  private get sortMenuOptions() {
    return availableSortOptions.map((option) => {
      return new MenuItem(option.displayName, 'action', {
        action: () => {
          this.setSelectedSortOption(option);
        },
      });
    });
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  private get query() {
    return { ...this.activeFilter.query, sort: this.selectedSortOption.sort };
  }

  private get isShowingCards() {
    return (
      this.activeFilter.displayName !== 'Favorites' ||
      (this.args.model.favorites && this.args.model.favorites.length > 0)
    );
  }

  private createCard = restartableTask(async () => {
    let preselectedCardTypeQuery: Query | undefined;
    let activeFilterRef = this.activeFilter?.query?.filter?.type;
    if (activeFilterRef) {
      preselectedCardTypeQuery = {
        filter: {
          on: catalogEntryRef,
          eq: { ref: activeFilterRef },
        },
      };
    }
    let card = await chooseCard<CatalogEntry>(
      {
        filter: {
          on: catalogEntryRef,
          every: [{ eq: { isField: false } }],
        },
      },
      { preselectedCardTypeQuery },
    );
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
    let excludedCardTypeIds = [
      `${baseRealm.url}card-api/CardDef`,
      `${baseRealm.url}cards-grid/CardsGrid`,
    ];
    cardTypeSummaries.forEach((summary) => {
      if (excludedCardTypeIds.includes(summary.id)) {
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
        },
      });
    });
  });
}

export class CardsGrid extends CardDef {
  static displayName = 'Cards Grid';
  static icon = LayoutGridIcon;
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
