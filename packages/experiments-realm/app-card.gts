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
import { CardContainer } from '@cardstack/boxel-ui/components';
import { and, bool, cn } from '@cardstack/boxel-ui/helpers';
import { baseRealm, type Query } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import { restartableTask } from 'ember-concurrency';

import {
  AddButton,
  Tooltip,
  TabbedHeader,
} from '@cardstack/boxel-ui/components';

import {
  codeRefWithAbsoluteURL,
  type Loader,
  LooseSingleCardDocument,
  isSingleCardDocument,
} from '@cardstack/runtime-common';

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
  @tracked component: ComponentLike | null = null;
}

class TableView extends GlimmerComponent<{ Args: { instances: CardDef[] } }> {
  <template>
    <table class='styled-table'>
      <thead>
        <tr>
          {{#each this.tableData.headers as |header|}}
            <th class='table-header'>{{header}}</th>
          {{/each}}
        </tr>
      </thead>
      <tbody>
        {{#each this.tableData.rows as |row|}}
          <tr>
            {{#each row as |cell|}}
              <td class='table-cell'>
                <div class='cell-content'>{{cell}}</div>
              </td>
            {{/each}}
          </tr>
        {{/each}}
      </tbody>
    </table>
    <style>
      .styled-table {
        width: 100%;
        margin-bottom: 40px;
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
    </style>
  </template>

  get tableData() {
    if (!this.args.instances) {
      return;
    }
    let exampleCard = this.args.instances[0];
    let headers: string[] = [];
    for (let fieldName in exampleCard) {
      if (
        fieldName !== 'title' &&
        fieldName !== 'description' &&
        fieldName !== 'thumbnailURL' &&
        fieldName !== 'id'
      ) {
        headers.push(fieldName);
      }
    }
    headers.sort();

    let rows = this.args.instances.map((card) => {
      let row: string[] = [];
      for (let header of headers) {
        row.push((card as any)[header]);
      }
      return row;
    });
    return {
      headers,
      rows,
    };
  }
}

class DefaultTabTemplate extends GlimmerComponent<{
  Args: {
    model?: Partial<AppCard>;
    context?: CardContext;
    tabs?: Tab[];
    setTabs?: (tabs: Tab[]) => void;
    activeTab?: Tab;
    setActiveTab?: (index: number) => void;
  };
}> {
  <template>
    <div class='app-card-content'>
      {{#if this.errorMessage}}
        <p class='error'>{{this.errorMessage}}</p>
      {{/if}}
      <QueryContainer
        @query={{this.query}}
        @realms={{this.realms}}
        @context={{@context}}
        as |cards|
      >
        {{#if cards.length}}
          {{#if @activeTab.isTable}}
            <TableView @instances={{cards}} />
          {{else}}
            <CardsGrid @cards={{cards}} @context={{@context}} />
          {{/if}}
        {{else}}
          <p>No cards available</p>
        {{/if}}
      </QueryContainer>
      {{#if (and (bool @context.actions.createCard) (bool @activeTab.ref))}}
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
    </div>
    <style>
      .app-card-content {
        width: 100%;
        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-xxl);
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

  @tracked errorMessage = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    if (!this.args.tabs?.length) {
      this.setupInitialTabs();
      return;
    }
  }

  async setupInitialTabs() {
    this.errorMessage = '';
    if (!this.args.model?.moduleId) {
      this.errorMessage = 'Error: ModuleId is not available.';
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

    this.args.setTabs?.(tabs);
    this.args.setActiveTab?.(0);
  }

  get query() {
    if (!this.activeTabRef) {
      return;
    }
    return {
      filter: {
        every: [
          { type: this.activeTabRef },
          { not: { eq: { id: this.args.model?.id! } } },
        ],
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
          by: 'title',
        },
      ],
    };
  }

  get currentRealm() {
    return this.args.model?.[realmURL];
  }

  get realms(): string[] {
    return this.args.model?.[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get activeTabRef() {
    if (!this.args.activeTab?.ref || !this.currentRealm) {
      return;
    }
    return codeRefWithAbsoluteURL(this.args.activeTab.ref, this.currentRealm);
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
}

class AppCardIsolated extends Component<typeof AppCard> {
  <template>
    <section class='app-card'>
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
      {{#if this.activeTab.component}}
        <this.activeTab.component />
      {{else}}
        <DefaultTabTemplate
          @tabs={{this.tabs}}
          @activeTab={{this.activeTab}}
          @model={{this.args.model}}
          @context={{@context}}
          @setActiveTab={{this.setActiveTab}}
          @setTabs={{this.setTabs}}
        />
      {{/if}}
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
    </style>
  </template>

  @tracked tabs = this.args.model.tabs;
  @tracked activeTabIndex = 0;
  @tracked errorMessage = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    let index = this.tabs?.findIndex(
      (tab: Tab) => tab.tabId === window.location?.hash?.slice(1),
    );
    if (index && index !== -1) {
      this.setActiveTab(index);
    }
  }

  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }

  get activeTab() {
    return this.tabs?.[this.activeTabIndex];
  }

  setTabs(tabs: Tab[]) {
    this.args.model.tabs = tabs;
  }

  @action setActiveTab(index: number) {
    this.activeTabIndex = index;
  }
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
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

export class QueryContainer extends GlimmerComponent<{
  Args: {
    query: Query;
    realms: string[];
    context: CardContext;
  };
}> {
  <template>
    {{#let
      (component @context.prerenderedCardSearchComponent)
      as |PrerenderedCardSearch|
    }}
      <PrerenderedCardSearch
        @query={{@query}}
        @format='fitted'
        @realms={{@realms}}
      >
        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          {{yield cards}}
        </:response>
      </PrerenderedCardSearch>
    {{/let}}
  </template>
}

export class CardsGrid extends GlimmerComponent<{
  Args: {
    cards: CardDef[];
    context?: CardContext;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    <ul class={{cn 'cards-grid' list-format=@isListFormat}} ...attributes>
      {{#each @cards as |card|}}
        <li
          class='cards-grid-item'
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
          <CardContainer class='card' @displayBoundaries={{true}}>
            {{card.component}}
          </CardContainer>
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
      .card {
        height: 100%;
        width: 100%;
        container-name: fitted-card;
        container-type: size;
      }
    </style>
  </template>

  getComponent = (card: CardDef) => card.constructor.getComponent(card);
}
