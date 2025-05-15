import { action } from '@ember/object';
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
import { BoxelLayout } from '@cardstack/boxel-ui/components';
import {
  chooseCard,
  specRef,
  baseRealm,
  isCardInstance,
  SupportedMimeType,
  subscribeToRealm,
  Query,
} from '@cardstack/runtime-common';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { Spec } from './spec';
import StringField from './string';
import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import Captions from '@cardstack/boxel-icons/captions';
import { registerDestructor } from '@ember/destroyable';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    {{!-- <div class={{cn 'cards-grid' strip-view=(eq this.viewSize 'strip')}}>
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
          <ViewSelector
            @items={{this.viewOptions}}
            @onChange={{this.onViewChange}}
            @selectedId={{this.viewSize}}
          />
          <SortDropdown
            @options={{this.sortOptions}}
            @onSelect={{this.setSelectedSortOption}}
            @selectedOption={{this.selectedSortOption}}
          />
        </div>
        <CardList
          @format='fitted'
          @context={{@context}}
          @query={{this.query}}
          @realms={{this.realms}}
          @isLive={{true}}
          data-test-cards-grid-cards
        />
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
    </div> --}}

    <BoxelLayout
      @format='fitted'
      @context={{@context}}
      @realms={{this.realms}}
      @isLive={{true}}
    />

    <style scoped>
      .top-bar {
        display: grid;
        grid-template-columns: 1fr auto auto;
        padding-right: var(--boxel-sp);
        gap: var(--boxel-sp-xxxl);
      }
      .title {
        font: bold var(--boxel-font-lg);
        letter-spacing: 0.21px;
      }
      .cards-grid {
        --cards-grid-padding-top: var(--boxel-sp-lg);
        --grid-card-min-width: 10.625rem; /* 170px */
        --grid-card-max-width: 10.625rem; /* 170px */
        --grid-card-height: 15.625rem; /* 250px */

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
        overflow-y: hidden;
      }
      :deep(.filter-list:hover) {
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

  constructor(owner: any, args: any) {
    super(owner, args);
    // this.loadFilterList.perform();
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

    // Remove all filter items except the first one,
    // as 'All Cards' is a predefined filter and not a result from the card type summary API.
    this.filters.splice(1, this.filters.length);
    cardTypeSummaries.forEach((summary) => {
      if (excludedCardTypeIds.includes(summary.id)) {
        return;
      }
      const lastIndex = summary.id.lastIndexOf('/');
      this.filters.push({
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

    this.activeFilter =
      this.filters.find(
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
