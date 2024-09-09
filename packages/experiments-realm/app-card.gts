import BooleanField from 'https://cardstack.com/base/boolean';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import {
  CardDef,
  field,
  contains,
  containsMany,
  FieldDef,
  Component,
  realmURL,
  StringField,
  type CardContext,
} from 'https://cardstack.com/base/card-api';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';

import {
  AddButton,
  Tooltip,
  TabbedHeader,
  FilterList,
  type Filter as LeftNavFilter,
  Pill,
} from '@cardstack/boxel-ui/components';

import {
  codeRefWithAbsoluteURL,
  type Query,
  type Loader,
  LooseSingleCardDocument,
  isSingleCardDocument,
  SupportedMimeType,
  buildQueryString,
  assertQuery,
  PrerenderedCard,
} from '@cardstack/runtime-common';
import { AnyFilter } from '@cardstack/runtime-common/query';
import { TrackedMap } from 'tracked-built-ins';

// import { CardsGridComponent } from './cards-grid-component';

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
}

interface PillItem {
  id: string;
  selected: boolean;
  label: string;
}

interface PillFilter extends PillItem {
  kind: string;
  value: string;
}

class AppCardIsolated extends Component<typeof AppCard> {
  async setupInitialTabs() {
    this.errorMessage = '';
    if (!this.args.model.moduleId) {
      this.errorMessage = 'ModuleId is not available.';
      return;
    }
    let loader: Loader = (import.meta as any).loader;
    let module;
    try {
      module = await loader.import(this.args.model.moduleId);
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error occurred';
      return;
    }
    let exportedCards = Object.entries(module).filter(
      ([_, declaration]) =>
        declaration &&
        typeof declaration === 'function' &&
        'isCardDef' in declaration &&
        !AppCard.isPrototypeOf(declaration),
    );
    let tabs = [];
    for (let [name, _declaration] of exportedCards) {
      tabs.push(
        new Tab({
          displayName: name,
          tabId: name,
          ref: {
            name,
            module: this.args.model.moduleId,
          },
          isTable: false,
        }),
      );
    }

    this.args.model.tabs = tabs;
    this.setActiveTab(0);
  }

  leftNavFilters: LeftNavFilter[] = [];
  @tracked activeCategory: LeftNavFilter | undefined = this.leftNavFilters[0];
  pillFilterMap = new TrackedMap<string, PillFilter>();

  @action onCategoryChanged(leftNavFilter: LeftNavFilter) {
    this.activeCategory = leftNavFilter;
  }

  @action onPillSelect(id: string) {
    // debugger;
    let pillFilter = this.pillFilterMap.get(id);
    if (!pillFilter) {
      return;
    }
    this.pillFilterMap.set(id, {
      ...pillFilter,
      selected: !pillFilter.selected,
    });
  }

  get queryDisplay() {
    return JSON.stringify(this.query, null, 2);
  }

  get query(): Query {
    let categoryFilter = this.categoryFilter ? [this.categoryFilter] : [];
    let q = {
      filter: {
        on: this.activeTabRef,
        every: [...categoryFilter],
      },
    };
    assertQuery(q);
    return q;
  }

  //==== codeRef stuff
  get categoryCodeRef() {
    return {
      module: 'http://localhost:4201/experiments/commerce/listing',
      name: 'Category',
    };
  }

  get tagCodeRef() {
    return {
      module: 'http://localhost:4201/experiments/commerce/listing',
      name: 'Tag',
    };
  }

  //==== query stuff
  get categoryQuery() {
    return {
      filter: {
        type: this.categoryCodeRef,
      },
    };
  }

  get tagQuery() {
    return {
      filter: {
        type: this.tagCodeRef,
      },
    };
  }

  get categoryFilter() {
    if (this.activeCategory === undefined) {
      return { any: [] } as AnyFilter;
    }
    return {
      any: [
        {
          // on: this.activeTabRef,
          eq: { 'primaryCategory.name': this.activeCategory.displayName },
        },
        {
          // on: this.activeTabRef,
          eq: { 'secondaryCategory.name': this.activeCategory.displayName },
        },
      ],
    } as AnyFilter;
  }

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  <template>
    <section class='app-card'>
      <div>
        {{this.queryDisplay}}
      </div>
      <TabbedHeader
        @title={{@model.title}}
        @tabs={{this.tabs}}
        @onSetActiveTab={{this.setActiveTab}}
        @activeTabIndex={{this.activeTabIndex}}
        @headerBackgroundColor={{this.headerColor}}
      >
        <:headerIcon>
          {{#if @model.headerIcon.base64}}
            <@fields.headerIcon />
          {{/if}}
        </:headerIcon>
      </TabbedHeader>

      <section class='app-card-layout'>
        <aside class='app-card-filter sidebar'>

          <div class='card-box'>
            <h5>Categories</h5>
            {{#if this.loadCategoryFilterList.isRunning}}
              Loading...
            {{else}}
              <FilterList
                @filters={{this.leftNavFilters}}
                @activeFilter={{this.activeCategory}}
                @onChanged={{this.onCategoryChanged}}
              />
            {{/if}}
          </div>
          <div class='card-box'>
            <h5>Filters</h5>
            {{#if this.loadTagFilterList.isRunning}}
              Loading...
            {{else}}
              <PillPicker
                @items={{this.pillFilters}}
                @onSelect={{this.onPillSelect}}
              />
            {{/if}}
          </div>
        </aside>
        <main class='app-card-content'>
          {{#if this.activeTab}}

            {{!  Cards grid logic here }}
            <ConfigurableCardsGrid
              @query={{this.query}}
              @context={{@context}}
            />

            {{#if @context.actions.createCard}}
              <div class='add-card-button'>
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
          {{/if}}
        </main>
        <aside class='app-card-related-sidebar sidebar'>
          <div class='card-box'>
            <h5>Parent Listing</h5>
          </div>
          <div class='card-box'>
            <h5>Related Apps</h5>
          </div>
        </aside>
      </section>
    </section>
    <style scoped>
      .app-card {
        position: relative;
        min-height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .app-card-layout {
        display: grid;
        grid-template-columns: 1fr 600px 1fr;
        background: var(--boxel-100);
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }

      main.app-card-content {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        width: 100%;
        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-xxl);
      }

      aside.sidebar {
        padding: 0 var(--boxel-sp);
      }
      aside.sidebar > * + * {
        margin-top: var(--boxel-sp-lg);
      }
      aside.sidebar h5 {
        margin-top: 0;
      }

      .table {
        margin-bottom: 40px;
      }
      .styled-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9em;
        font-family: sans-serif;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.15);
      }
      .table-header {
        background-color: #009879;
        color: #ffffff;
        text-align: left;
        padding: 12px 15px;
      }
      .table-cell {
        padding: 12px 15px;
        border-bottom: 1px solid #dddddd;
      }
      .cell-content {
        max-width: 200px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      tr:nth-of-type(even) {
        background-color: #f3f3f3;
      }
      tr:last-of-type {
        border-bottom: 2px solid #009879;
      }

      .module-input-group {
        max-width: 800px;
        margin-top: var(--boxel-sp-xl);
        display: flex;
        gap: var(--boxel-sp);
      }
      .module-input-group > *:first-child {
        flex-grow: 1;
      }
      .module-input-group > button {
        margin-top: var(--boxel-sp);
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }

      .add-card-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        bottom: 20px;
        z-index: 1;
      }
      .error {
        color: var(--boxel-error-100);
      }
    </style>
  </template>

  @tracked tabs = this.args.model.tabs;
  @tracked activeTabIndex = 0;
  @tracked errorMessage = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    if (!this.tabs?.length) {
      this.setupInitialTabs();
      return;
    }
    this.setTab();
    this.setCategories();
    this.setTags();
  }

  setTab() {
    let index = this.tabs?.findIndex(
      (tab: Tab) => tab.tabId === window.location?.hash?.slice(1),
    );
    if (index && index !== -1) {
      this.activeTabIndex = index;
    }
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  get activeTab() {
    if (!this.tabs?.length) {
      return;
    }
    let tab = this.tabs[this.activeTabIndex];
    if (!tab) {
      return;
    }
    let { name, module } = tab.ref;
    if (!name || !module) {
      return;
    }
    return tab;
  }

  get activeTabRef() {
    if (!this.activeTab || !this.currentRealm) {
      return;
    }
    return codeRefWithAbsoluteURL(this.activeTab.ref, this.currentRealm);
  }

  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }

  @action setActiveTab(index: number) {
    this.activeTabIndex = index;
  }

  setCategories() {
    if (!this.currentRealm) {
      return;
    }
    this.loadCategoryFilterList.perform();
  }

  setTags() {
    if (!this.currentRealm) {
      return;
    }
    this.loadTagFilterList.perform();
  }

  private loadCategoryFilterList = restartableTask(async () => {
    let query = this.categoryQuery;
    let queryString = buildQueryString(query); //has ? in front of it
    let searchResults = await this.search(queryString);
    searchResults.forEach((json: any) => {
      this.leftNavFilters.push({
        displayName: json.attributes.title,
      });
    });
    this.activeCategory = this.leftNavFilters[0];
  });

  get pillFilters() {
    return Array.from(this.pillFilterMap.values());
  }

  private loadTagFilterList = restartableTask(async () => {
    let query = this.tagQuery;
    let queryString = buildQueryString(query); //has ? in front of it
    let searchResults = await this.search(queryString);
    searchResults.forEach((json: any) => {
      this.pillFilterMap.set(json.id, {
        id: json.id,
        kind: json.attributes.kind,
        value: json.attributes.value,
        label: json.attributes.value,
        selected: false,
      });
    });
  });

  async search(queryString: string) {
    let response = await fetch(`${this.realms[0]}_search${queryString}`, {
      headers: {
        Accept: SupportedMimeType.CardJson,
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
    return (await response.json()).data;
  }

  @action createNew(value: unknown) {
    let cardDoc = isSingleCardDocument(value) ? value : undefined;
    this.createCard.perform(cardDoc);
  }

  get isCreateCardRunning() {
    return this.createCard.isRunning;
  }

  private createCard = restartableTask(
    async (doc: LooseSingleCardDocument | undefined = undefined) => {
      if (!this.activeTabRef) {
        return;
      }
      try {
        await this.args.context?.actions?.createCard?.(
          this.activeTabRef,
          this.currentRealm,
          { doc },
        );
      } catch (e) {
        console.error(e);
        this.errorMessage =
          e instanceof Error ? `Error: ${e.message}` : 'An error occurred';
      }
    },
  );

  @action onPillClick(pillFilter: PillFilter) {
    console.log('Pill clicked:', pillFilter);
    // Handle pill click event here
  }
}

class PillPicker extends GlimmerComponent<{
  Args: {
    items: PillItem[];
    onSelect: (id: string) => void;
  };
}> {
  <template>
    {{#each @items as |item|}}
      <Pill
        @kind='button'
        class={{cn selected=(eq item.selected true)}}
        {{on 'click' (fn @onSelect item.id)}}
      >
        <:default>{{item.label}}</:default>
      </Pill>
    {{/each}}
    <style>
      .selected {
        --pill-background-color: var(--boxel-highlight);
      }
    </style>
  </template>
}
export class AppCard extends CardDef {
  static displayName = 'App Card';
  static prefersWideFormat = true;
  static headerColor = '#ffffff';
  @field tabs = containsMany(Tab);
  @field headerIcon = contains(Base64ImageField);
  @field moduleId = contains(StringField);
  static isolated = AppCardIsolated;
}

export class ConfigurableCardsGrid extends GlimmerComponent<{
  Args: {
    context?: CardContext;
    query?: Query;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    {{#let
      (component @context.prerenderedCardSearchComponent)
      as |PrerenderedCardSearch|
    }}
      <PrerenderedCardSearch
        @query={{@query}}
        @format='fitted'
        @realms={{this.realms}}
      >
        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          {{#if cards.length}}
            <CardsGrid @cards={{cards}} @context={{@context}} />
          {{else}}
            <div class='no-cards-message'>No Cards Available</div>
          {{/if}}
        </:response>
      </PrerenderedCardSearch>
    {{/let}}
    <style scoped>
      .cards-grid {
        --grid-card-width: 10.25rem; /* 164px */
        --grid-card-height: 14rem; /* 224px */
        list-style-type: none;
        margin: 0;
        padding: var(--cards-grid-padding, 0);
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--grid-card-width));
        grid-auto-rows: max-content;
        gap: var(--boxel-sp-xl) var(--boxel-sp-lg);
      }
      .cards-grid.list-format {
        --grid-card-width: 18.75rem; /* 300px */
        --grid-card-height: 12rem; /* 192px */
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
      .cards-grid-item {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
      }
      .cards-grid-item > :deep(.field-component-card.fitted-format) {
        --overlay-fitted-card-header-height: 0;
      }
      .no-cards-message {
        font-size: 1.2rem;
        color: var(--boxel-dark);
        text-align: center;
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>

  get realms() {
    return ['http://localhost:4201/experiments/'];
  }
}

export class CardsGrid extends GlimmerComponent<{
  Args: {
    cards: PrerenderedCard[] | [];
    context?: CardContext;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    <ul class={{cn 'cards-grid' list-format=@isListFormat}} ...attributes>
      {{#each @cards as |card|}}
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
      {{/each}}
    </ul>
    <style scoped>
      .cards-grid {
        --grid-card-width: 10.25rem; /* 164px */
        --grid-card-height: 14rem; /* 224px */
        list-style-type: none;
        margin: 0;
        padding: var(--cards-grid-padding, 0);
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--grid-card-width));
        grid-auto-rows: max-content;
        gap: var(--boxel-sp-xl) var(--boxel-sp-lg);
      }
      .cards-grid.list-format {
        --grid-card-width: 18.75rem; /* 300px */
        --grid-card-height: 12rem; /* 192px */
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
      .cards-grid-item {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
      }
      .cards-grid-item > :deep(.field-component-card.fitted-format) {
        --overlay-fitted-card-header-height: 0;
      }
    </style>
  </template>

  getComponent = (card: CardDef) => card.constructor.getComponent(card);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
