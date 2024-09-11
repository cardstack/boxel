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
  BoxelInput,
  CardContainer,
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

const CONFIG = {
  displayQuery: false,
};

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
    if (!CONFIG.displayQuery) {
      return;
    }
    return JSON.stringify(this.query, null, 2);
  }

  get query(): Query {
    let categoryFilter = this.categoryFilter ? [this.categoryFilter] : [];
    let pillFilter = this.pillFilter ? [this.pillFilter] : [];
    let q = {
      filter: {
        on: this.activeTabRef,
        every: [...categoryFilter, ...pillFilter],
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

  get pillFilter() {
    let selectedPills = this.pillFilters
      .filter((pill) => pill.selected)
      .map((pill) => {
        return {
          eq: {
            'tags.value': pill.value,
          },
        };
      });
    if (selectedPills.length === 0) {
      return {};
    }
    return {
      any: selectedPills,
    };
  }

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  //search input
  @tracked private searchKey = '';

  @action private debouncedSetSearchKey(searchKey: string) {
    // debounce(this, this.setSearchKey, searchKey, 300);
  }

  @action
  private setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
  }

  @action private onSearchInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // this.onCancel();
      // (e.target as HTMLInputElement)?.blur?.();
    }
  }

  //checkbox

  checkboxInputs: any = [
    { id: 'free', label: 'Free', value: false },
    { id: 'forMembers', label: 'For Members', value: false },
    { id: 'premium', label: 'Premium', value: false },
  ];

  @action
  updateInputValue(id: string, event: Event) {
    const target = event.target as HTMLInputElement;
    const input = this.checkboxInputs.find((input: any) => input.id === id);
    if (input) {
      input.value = target.checked;
    }
  }

  <template>
    <section class='app-card'>
      {{#if this.queryDisplay}}
        <div>
          {{this.queryDisplay}}
        </div>
      {{/if}}
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
              <div class='search-and-filter-group'>

                <BoxelInput
                  @type='search'
                  @placeholder='Filter by name or type'
                  @state='initial'
                  @onInput={{this.debouncedSetSearchKey}}
                  {{on 'keydown' this.onSearchInputKeyDown}}
                  autocomplete='off'
                  data-test-search-field
                />

                <PillPicker
                  @items={{this.pillFilters}}
                  @onSelect={{this.onPillSelect}}
                />

                <div class='checkbox-inputs'>
                  {{#each this.checkboxInputs as |item|}}
                    <label>
                      <input
                        type='checkbox'
                        checked={{item.isSelected}}
                        {{on 'change' (fn this.updateInputValue item.id)}}
                      />
                      <span>{{item.label}}</span>
                    </label>
                  {{/each}}
                </div>

              </div>
            {{/if}}
          </div>
        </aside>
        <main class='app-card-content'>
          {{#if this.activeTab}}

            {{!==  Cards grid component is here (same as packages/base/cards-grid) }}
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
            </ul>
            {{!==  Cards grid component is here (same as packages/base/cards-grid) }}

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
      </section>
    </section>
    <style scoped>
      /*==These are the cards grid styles*/
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
      /*==These are the cards grid styles*/
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
        grid-template-columns: 300px 1fr;
        background: var(--boxel-100);
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }

      main.app-card-content {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        width: 100%;
        min-width: 600px;
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

      .search-and-filter-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .search-and-filter-group .search {
        background-color: var(--boxel-100);
        color: var(--boxel-dark);
        --boxel-form-control-border-color: var(--boxel-400);
      }

      .search-and-filter-group .search::placeholder {
        color: var(--boxel-dark);
        opacity: 0.6;
      }

      .checkbox-inputs {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .checkbox-inputs label {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-sm);
      }
      .checkbox-inputs label span {
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
    //console.log('Pill clicked:', pillFilter);
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
    <div class='pill-picker'>
      {{#each @items as |item|}}
        <Pill
          @kind='button'
          class={{cn selected=(eq item.selected true)}}
          style='padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);'
          {{on 'click' (fn @onSelect item.id)}}
        >
          <:default>{{item.label}}</:default>
        </Pill>
      {{/each}}
    </div>
    <style>
      .pill-picker {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
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

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
