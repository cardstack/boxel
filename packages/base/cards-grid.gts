import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

import {
  AddButton,
  CardsGridLayout,
  type Filter,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { IconList, IconGrid } from '@cardstack/boxel-ui/icons';

import HighlightsIcon from '@cardstack/boxel-icons/layout-panel-top';
import RecentIcon from '@cardstack/boxel-icons/clock';
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
  Query,
} from '@cardstack/runtime-common';

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

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardsGridLayout
      @format='fitted'
      @context={{@context}}
      @realms={{this.realms}}
      @isLive={{true}}
      @viewOptions={{this.viewOptions}}
      @selectedView={{this.selectedView}}
      @activeFilter={{this.activeFilter}}
      @filters={{this.filters}}
    >
      <:content>
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
      </:content>
    </CardsGridLayout>
    <style scoped>
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

  private filters: Filter[] = new TrackedArray([
    {
      displayName: 'Highlights',
      icon: HighlightsIcon,
    },
    {
      displayName: 'Recent',
      icon: RecentIcon,
    },
    {
      displayName: 'Starred',
      icon: StarIcon,
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
  private viewOptions = [
    { id: 'strip', icon: IconList },
    { id: 'grid', icon: IconGrid },
  ];
  @tracked private selectedView = this.viewOptions[1];
  @tracked private activeFilter = this.filters[0];

  constructor(owner: any, args: any) {
    super(owner, args);
    this.loadFilterList.perform();
    let unsubscribe = subscribeToRealm(this.realms[0], this.refreshFilterList);

    registerDestructor(this, unsubscribe);
  }

  @action createNew() {
    this.createCard.perform();
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  private createCard = restartableTask(async () => {
    let preselectedCardTypeQuery: Query | undefined;
    let activeFilterRef = this.activeFilter?.query?.filter?.type;
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
      this.filters[this.filters.length - 1].filters?.push({
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

    let flattenedFilters: Filter[] = [];
    this.filters.map((f) =>
      f.filters?.length
        ? flattenedFilters.push(f, ...f.filters)
        : flattenedFilters.push(f),
    );

    this.activeFilter =
      flattenedFilters.find(
        (filter) => filter.displayName === this.activeFilter.displayName,
      ) ?? this.filters[0];
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
