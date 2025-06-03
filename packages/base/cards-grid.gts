import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';

import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import Captions from '@cardstack/boxel-icons/captions';
import AllCardsIcon from '@cardstack/boxel-icons/square-stack';

import {
  chooseCard,
  specRef,
  baseRealm,
  isCardInstance,
  SupportedMimeType,
  subscribeToRealm,
  type Query,
} from '@cardstack/runtime-common';

import CardsGridLayout, {
  VIEW_OPTIONS,
  SORT_OPTIONS,
  type FilterOption,
  type ViewOption,
  type SortOption,
} from './components/cards-grid-layout';

import {
  contains,
  field,
  Component,
  CardDef,
  realmInfo,
  realmURL,
  type BaseDef,
} from './card-api';
import type { RealmEventContent } from './matrix-event';
import { Spec } from './spec';
import StringField from './string';

const [_CardView, StripView, GridView] = VIEW_OPTIONS;

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardsGridLayout
      @format='fitted'
      @context={{@context}}
      @query={{this.query}}
      @realms={{this.realms}}
      @isLive={{true}}
      @filterOptions={{this.filterOptions}}
      @sortOptions={{this.sortOptions}}
      @viewOptions={{this.viewOptions}}
      @activeViewId={{this.activeViewId}}
      @activeFilter={{this.activeFilter}}
      @activeSort={{this.activeSort}}
      @onChangeFilter={{this.onChangeFilter}}
      @onChangeView={{this.onChangeView}}
      @onChangeSort={{this.onChangeSort}}
    >
      <:content>
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
      </:content>
    </CardsGridLayout>
    <style scoped>
      .add-button {
        display: inline-block;
        position: sticky;
        left: 93%;
        width: fit-content;
        bottom: var(--boxel-sp);
        z-index: 1;
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }
    </style>
  </template>

  private cardTypeFilters: FilterOption[] = new TrackedArray();
  private filterOptions: FilterOption[] = [
    {
      displayName: 'All Cards',
      icon: AllCardsIcon,
      query: {
        filter: {
          not: {
            eq: {
              _cardType: 'Cards Grid',
            },
          },
        },
      },
      filters: this.cardTypeFilters,
      isExpanded: true,
    },
  ];
  private viewOptions: ViewOption[] = new TrackedArray([StripView, GridView]);
  private sortOptions: SortOption[] = new TrackedArray(SORT_OPTIONS);

  @tracked private activeViewId: ViewOption['id'] = this.viewOptions[1].id;
  @tracked private activeFilter: FilterOption = this.filterOptions[0];
  @tracked private activeSort: SortOption = this.sortOptions[0];

  constructor(owner: any, args: any) {
    super(owner, args);
    this.loadFilterList.perform();
    let unsubscribe = subscribeToRealm(this.realms[0], this.refreshFilterList);

    registerDestructor(this, unsubscribe);
  }

  @action private createNew() {
    this.createCard.perform();
  }

  private get query(): Query | undefined {
    if (!this.activeFilter?.query) {
      return undefined;
    }
    return {
      ...this.activeFilter.query,
      sort: this.activeSort?.sort,
    };
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  @action private onChangeFilter(filter: FilterOption) {
    this.activeFilter = filter;
  }

  @action private onChangeSort(option: SortOption) {
    this.activeSort = option;
  }

  @action private onChangeView(viewId: ViewOption['id']) {
    this.activeViewId = viewId;
  }

  private createCard = restartableTask(async () => {
    let preselectedCardTypeQuery: Query | undefined;
    let filter = this.activeFilter?.query?.filter;
    let activeFilterRef = filter && 'type' in filter ? filter.type : undefined;
    if (activeFilterRef) {
      preselectedCardTypeQuery = {
        filter: {
          on: specRef,
          eq: { ref: activeFilterRef },
        },
        sort: [
          {
            by: 'createdAt',
            direction: 'desc',
          },
        ],
      };
    }
    let specId = await chooseCard(
      {
        filter: {
          on: specRef,
          every: [{ eq: { isCard: true } }],
        },
      },
      { preselectedCardTypeQuery },
    );
    if (!specId) {
      return;
    }

    let spec = await this.args.context?.store.get<Spec>(specId);

    if (spec && isCardInstance<Spec>(spec)) {
      await this.args.context?.actions?.createCard?.(
        spec.ref,
        new URL(specId),
        {
          realmURL: this.args.model[realmURL],
        },
      );
    }
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
      attributes: {
        displayName: string;
        total: number;
        iconHTML: string | null;
      };
    }[];
    let excludedCardTypeIds = [
      `${baseRealm.url}card-api/CardDef`,
      `${baseRealm.url}cards-grid/CardsGrid`,
    ];

    this.cardTypeFilters.splice(0, this.cardTypeFilters.length);

    cardTypeSummaries.forEach((summary) => {
      if (excludedCardTypeIds.includes(summary.id)) {
        return;
      }
      const lastIndex = summary.id.lastIndexOf('/');
      this.cardTypeFilters.push({
        displayName: summary.attributes.displayName,
        icon: summary.attributes.iconHTML ?? Captions,
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

    let flattenedFilters: FilterOption[] = [];
    this.filterOptions.map((f) =>
      f.filters?.length
        ? flattenedFilters.push(f, ...f.filters)
        : flattenedFilters.push(f),
    );

    this.activeFilter =
      flattenedFilters.find(
        (filter) => filter.displayName === this.activeFilter.displayName,
      ) ?? this.filterOptions[0];
  });

  private refreshFilterList = (ev: RealmEventContent) => {
    if (ev.eventName === 'index' && ev.indexType === 'incremental') {
      this.loadFilterList.perform();
    }
  };
}

export class CardsGrid extends CardDef {
  static displayName = 'Cards Grid';
  static icon = LayoutGridPlusIcon;
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
