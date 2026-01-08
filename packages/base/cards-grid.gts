import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import { TrackedArray } from 'tracked-built-ins';

import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';
import { HighlightIcon } from '@cardstack/boxel-ui/icons';

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
  codeRefFromInternalKey,
  type Query,
  CardErrorJSONAPI,
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
  type BoxComponent,
} from './card-api';
import type { RealmEventContent } from './matrix-event';
import { Spec } from './spec';
import StringField from './string';

const [_CardView, StripView, GridView] = VIEW_OPTIONS;

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <CardsGridLayout
      {{this.setupRealmSubscription this.primaryRealm}}
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
        {{#if @canEdit}}
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
  private highlightsCards: BoxComponent[] = new TrackedArray();
  private filterOptions: FilterOption[] = [];
  private viewOptions: ViewOption[] = new TrackedArray([StripView, GridView]);
  private sortOptions: SortOption[] = new TrackedArray(SORT_OPTIONS);

  @tracked private activeViewId: ViewOption['id'] = this.viewOptions[1].id;
  @tracked private activeFilter!: FilterOption;
  @tracked private activeSort: SortOption = this.sortOptions[0];

  #unsubscribeFromRealm: (() => void) | undefined;
  #subscribedRealm: string | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.setupFilterOptions();
    this.activeFilter = this.filterOptions[0];
    this.loadHighlightsCards.perform();
    registerDestructor(this, () => this.teardownRealmSubscription());
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

  private get primaryRealm(): string | undefined {
    return this.realms[0];
  }

  private get isPersonalRealm(): boolean {
    let realmHref = this.args.model[realmURL]?.href;
    return realmHref?.includes('/personal/') ?? false;
  }

  private get highlightFilter(): FilterOption {
    return {
      displayName: 'Highlights',
      icon: HighlightIcon,
      cards: this.highlightsCards,
    };
  }

  private get allCardsFilter(): FilterOption {
    return {
      displayName: 'All Cards',
      icon: AllCardsIcon,
      query: {
        filter: {
          every: [
            {
              not: {
                eq: {
                  _cardType: 'Cards Grid',
                },
              },
            },
            {
              not: {
                eq: {
                  _cardType: 'Index',
                },
              },
            },
          ],
        },
      },
      filters: this.cardTypeFilters,
      isExpanded: true,
    };
  }

  private setupFilterOptions() {
    this.filterOptions.splice(0, this.filterOptions.length);
    if (this.isPersonalRealm) {
      this.filterOptions.push(this.highlightFilter);
    }
    this.filterOptions.push(this.allCardsFilter);
  }

  private teardownRealmSubscription() {
    this.#unsubscribeFromRealm?.();
    this.#unsubscribeFromRealm = undefined;
    this.#subscribedRealm = undefined;
  }

  setupRealmSubscription = modifier(
    (_element, [realm]: [string | undefined]) => {
      if (!realm) {
        this.teardownRealmSubscription();
        return;
      }
      if (realm !== this.#subscribedRealm) {
        this.teardownRealmSubscription();
        this.#subscribedRealm = realm;
        this.#unsubscribeFromRealm = subscribeToRealm(
          realm,
          this.refreshFilterList,
        );
        this.loadFilterList.perform();
      }

      return () => {
        this.teardownRealmSubscription();
      };
    },
  );

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
    let filter = this.activeFilter?.query?.filter;
    let activeFilterRef = filter && 'type' in filter ? filter.type : undefined;

    let spec: Spec | CardErrorJSONAPI | undefined;
    if (activeFilterRef) {
      let instances = await this.args.context?.store.search({
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
      } as Query);
      if (instances?.[0]?.id) {
        spec = instances[0] as Spec;
      }
    } else {
      let specId = await chooseCard({
        filter: {
          on: specRef,
          every: [{ eq: { isCard: true } }],
        },
      });

      if (!specId) {
        return;
      }

      spec = await this.args.context?.store.get<Spec>(specId);
    }

    if (spec && isCardInstance<Spec>(spec)) {
      await this.args.createCard?.(spec.ref, new URL(spec.id!), {
        realmURL: this.args.model[realmURL],
      });
    }
  });

  private loadFilterList = restartableTask(async () => {
    let realm = this.primaryRealm;
    if (!realm) {
      return;
    }
    let response = await fetch(`${realm}_types`, {
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
      `${baseRealm.url}index/IndexCard`,
    ];

    this.cardTypeFilters.splice(0, this.cardTypeFilters.length);

    cardTypeSummaries.forEach((summary) => {
      if (!summary.id || excludedCardTypeIds.includes(summary.id)) {
        return;
      }
      let codeRef = codeRefFromInternalKey(summary.id);
      if (!codeRef) {
        return;
      }
      this.cardTypeFilters.push({
        displayName: summary.attributes.displayName ?? codeRef.name,
        icon: summary.attributes.iconHTML ?? Captions,
        query: {
          filter: {
            type: codeRef,
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

  private loadHighlightsCards = restartableTask(async () => {
    if (!this.args.context?.store) {
      return;
    }

    try {
      // Load the welcome-to-boxel card
      const welcomeCardUrl = `https://cardstack.com/base/welcome-to-boxel.json`;
      const welcomeCard = (await this.args.context.store.get(
        welcomeCardUrl,
      )) as BaseDef;

      // Load the ai-app-generator card
      const aiAppGeneratorUrl = `https://cardstack.com/base/ai-app-generator.json`;
      const aiAppGeneratorCard = (await this.args.context.store.get(
        aiAppGeneratorUrl,
      )) as BaseDef;

      // Load the community cards
      const communityCardsUrl = `https://cardstack.com/base/join-the-community.json`;
      const communityCards = (await this.args.context.store.get(
        communityCardsUrl,
      )) as BaseDef;

      // Clear existing cards and add the new ones
      this.highlightsCards.splice(0, this.highlightsCards.length);

      if (welcomeCard) {
        this.highlightsCards.push(
          welcomeCard.constructor.getComponent(welcomeCard),
        );
      }

      if (aiAppGeneratorCard) {
        this.highlightsCards.push(
          aiAppGeneratorCard.constructor.getComponent(aiAppGeneratorCard),
        );
      }

      if (communityCards) {
        this.highlightsCards.push(
          communityCards.constructor.getComponent(communityCards),
        );
      }
    } catch (error) {
      console.warn('Failed to load highlights cards:', error);
    }
  });
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
