import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';

import StarIcon from '@cardstack/boxel-icons/star';
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
  type FilterOption,
  type ViewOption,
} from './components/cards-grid-layout';

import {
  contains,
  field,
  Component,
  CardDef,
  realmInfo,
  realmURL,
  linksToMany,
  type BaseDef,
} from './card-api';
import type { RealmEventContent } from './matrix-event';
import { Spec } from './spec';
import StringField from './string';

const [CardView, StripView, GridView] = VIEW_OPTIONS;

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardsGridLayout
      class='{{this.activeFilter.displayName}}-layout'
      @format='fitted'
      @context={{@context}}
      @realms={{this.realms}}
      @isLive={{true}}
      @viewOptions={{this.viewOptions}}
      @activeView={{this.selectedView}}
      @activeFilter={{this.activeFilter}}
      @filterOptions={{this.filterOptions}}
      @onChangeFilter={{this.onChangeFilter}}
    >
      <:cards>
        {{#each this.activeFilter.cards as |Card|}}
          <li
            class='{{this.activeFilter.displayName}}-card boxel-card-list-item'
          >
            <Card @format='embedded' class='boxel-embedded-card' />
          </li>
        {{/each}}
      </:cards>

      <:content>
        {{#unless this.activeFilter.hideAddButton}}
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
        {{/unless}}
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

  private filterOptions: FilterOption[] = new TrackedArray([
    {
      displayName: 'Starred',
      icon: StarIcon,
      cards: this.args.fields.starred,
      hideAddButton: true,
      viewOptions: [],
      activeView: CardView,
    },
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
      filters: new TrackedArray(),
      isExpanded: true,
    },
  ]);

  private viewOptions: ViewOption[] = new TrackedArray([StripView, GridView]);

  @tracked private selectedView: ViewOption = this.viewOptions[1];
  @tracked private activeFilter: FilterOption = this.filterOptions[0];

  constructor(owner: any, args: any) {
    super(owner, args);
    this.loadFilterList.perform();
    let unsubscribe = subscribeToRealm(this.realms[0], this.refreshFilterList);

    registerDestructor(this, unsubscribe);
  }

  @action private createNew() {
    this.createCard.perform();
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  @action private onChangeFilter(filter: FilterOption) {
    this.activeFilter = filter;
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

    cardTypeSummaries.forEach((summary) => {
      if (excludedCardTypeIds.includes(summary.id)) {
        return;
      }
      const lastIndex = summary.id.lastIndexOf('/');
      this.filterOptions[this.filterOptions.length - 1].filters?.push({
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
  @field starred = linksToMany(() => CardDef);

  static getDisplayName(instance: BaseDef) {
    if (isCardInstance(instance)) {
      return (instance as CardDef)[realmInfo]?.name ?? this.displayName;
    }
    return this.displayName;
  }
}
