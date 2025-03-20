import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

import {
  contains,
  field,
  Component,
  CardDef,
  realmInfo,
  type BaseDef,
} from './card-api';
import { isCardInstance } from '@cardstack/runtime-common';
import StringField from './string';

import FilterSection from './components/filter-section';
import CardSection from './components/card-section';
import CardListingContainer from './components/card-listing-container';

import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import TopBarFilter, { type FilterOption } from './components/top-bar-filter';

class Isolated extends Component<typeof Catalog> {
  mockCards = [
    { name: 'Card 1' },
    { name: 'Card 2' },
    { name: 'Card 3' },
    { name: 'Card 4' },
  ];

  specFilterOptions: FilterOption[] = [
    { id: 'all', displayName: 'All' },
    { id: 'apps', displayName: 'Apps' },
    { id: 'cards', displayName: 'Cards' },
    { id: 'fields', displayName: 'Fields' },
    { id: 'skills', displayName: 'Skills' },
  ];

  @tracked activeSpecFilterId: string = this.specFilterOptions[0].id;

  @action
  handleSpecFilterChanged(filterId: string) {
    this.activeSpecFilterId = filterId;
  }

  get shouldShowSection() {
    return (sectionId: string) => {
      if (this.activeSpecFilterId === 'all') {
        return true;
      }
      return this.activeSpecFilterId === sectionId.toLowerCase();
    };
  }

  <template>
    <div class='catalog-layout'>
      <section class='main-content'>
        <div class='sidebar'>
          {{! TODO: Add FilterSection component here }}
          {{! TODO: Give Args to FilterSection if needed - query, realms, selectedView, context, etc. }}
          <FilterSection />
        </div>
        {{! Note: Content will be display 2 columns: Content Listing Display and Related Listing Cards in the same time }}
        <div class='content'>
          <TopBarFilter
            @filters={{this.specFilterOptions}}
            @activeFilterId={{this.activeSpecFilterId}}
            @onChange={{this.handleSpecFilterChanged}}
            class='spec-filter-bar'
          />

          <div class='content-display-container'>
            {{! Column 1: Card Listing Section }}
            {{! TODO: We need to have a single listing display at here after click one of card}}
            <CardListingContainer class='card-listing-section'>
              {{#if (this.shouldShowSection 'apps')}}
                <CardSection @title='Apps' @cards={{this.mockCards}} />
              {{/if}}

              {{#if (this.shouldShowSection 'cards')}}
                <CardSection @title='Cards' @cards={{this.mockCards}} />
              {{/if}}

              {{#if (this.shouldShowSection 'fields')}}
                <CardSection @title='Fields' @cards={{this.mockCards}} />
              {{/if}}

              {{#if (this.shouldShowSection 'skills')}}
                <CardSection @title='Skills' @cards={{this.mockCards}} />
              {{/if}}
            </CardListingContainer>

            {{! Column 2: Related Listing Cards }}
            {{! TODO: Parent & Related Listing Cards will be display at here - can make this to component }}
            <div class='related-listing-cards'>
              <CardListingContainer>
                <h3 class='listing-title'>Parent Listing card</h3>
              </CardListingContainer>

              <CardListingContainer>
                <h3 class='listing-title'>Related Listings from Publisher</h3>
              </CardListingContainer>
            </div>
          </div>
        </div>
      </section>
    </div>

    <style scoped>
      :global(:root) {
        --catalog-layout-padding-top: var(--boxel-sp-lg);
      }
      .catalog-layout {
        height: 100%;
        background-color: var(--boxel-100);
      }
      .title {
        font: bold var(--boxel-font-lg);
        line-height: 1.58;
        letter-spacing: 0.21px;
      }
      .main-content {
        padding: var(--catalog-layout-padding-top) 0 0 var(--boxel-sp-sm);
        display: flex;
        gap: var(--boxel-sp-xl);
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
      }
      .sidebar {
        position: relative;
      }

      .spec-filter-bar {
        position: sticky;
        top: 0;
        z-index: 10;
        background-color: var(--boxel-100);
        padding-bottom: var(--boxel-sp-sm);
        border-bottom: 1px solid var(--boxel-200);
        box-shadow: 0 0 15px var(--boxel-200);
      }

      .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        overflow-y: auto;
        padding-right: var(--boxel-sp-sm);
        container-name: content;
        container-type: inline-size;
      }
      .content-display-container {
        display: grid;
        grid-template-columns: 1fr 247px;
        gap: var(--boxel-sp-lg);
      }
      .card-listing-section {
        --card-listing-container-background-color: transparent;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      .related-listing-cards {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .listing-title {
        margin: 0;
        padding: var(--boxel-sp-sm);
        font-weight: 600;
      }

      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }
      .instance-error {
        position: relative;
      }
      .instance-error::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.1);
      }
      .instance-error .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-error-300);
      }
      .instance-error:hover .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-dark);
      }

      @container content (inline-size <= 768px) {
        .content-display-container {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class Catalog extends CardDef {
  static displayName = 'Catalog';
  static icon = LayoutGridPlusIcon;
  static isolated = Isolated;
  static prefersWideFormat = true;
  @field realmName = contains(StringField, {
    computeVia: function (this: Catalog) {
      return this[realmInfo]?.name;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Catalog) {
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
