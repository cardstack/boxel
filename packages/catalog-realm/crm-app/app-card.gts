import BooleanField from 'https://cardstack.com/base/boolean';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import Base64ImageField from 'https://cardstack.com/base/base64-image';
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
  FieldsTypeFor,
  CreateCardFn,
} from 'https://cardstack.com/base/card-api';
import { CardContainer } from '@cardstack/boxel-ui/components';
import { and, bool, cn } from '@cardstack/boxel-ui/helpers';
import {
  baseRealm,
  type PrerenderedCardLike,
  type Query,
} from '@cardstack/runtime-common';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
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

export interface TabComponentSignature {
  activeTab?: Tab;
  currentRealm: URL;
  realms: string[];
  setActiveTab: (tabId: string) => void;
  createCard?: CreateCardFn;
}

export interface DefaultTabSignature extends TabComponentSignature {
  model: Partial<AppCard>;
  context?: CardContext;
}

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
}

class TableView extends GlimmerComponent<{
  Args: { cards: PrerenderedCardLike[]; context?: CardContext };
}> {
  <template>
    {{#if this.isLoaded}}
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
    {{/if}}
    <style scoped>
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

  // explicitly setting this to @tracked since there is
  // a possibility it might be initialized as undefined
  @tracked private cardCollection = this.args.context?.getCardCollection(
    this,
    () => this.args.cards.map((c) => c.url),
  );

  private get isLoaded() {
    return this.cardCollection?.isLoaded;
  }

  get tableData() {
    if (!this.cardCollection || this.cardCollection.cards.length === 0) {
      return;
    }
    let exampleCard = this.cardCollection.cards[0];
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

    let rows = this.cardCollection.cards.map((card) => {
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

class DefaultTabTemplate extends GlimmerComponent<DefaultTabSignature> {
  <template>
    <div class='app-card-content'>
      {{#if this.activeTabRef}}
        {{#if this.query}}
          <@context.prerenderedCardSearchComponent
            @query={{this.query}}
            @format='fitted'
            @realms={{@realms}}
            @isLive={{true}}
          >
            <:loading>Loading...</:loading>
            <:response as |cards|>
              {{#if @activeTab.isTable}}
                <TableView @cards={{cards}} @context={{@context}} />
              {{else}}
                <CardsGrid @cards={{cards}} @context={{@context}} />
              {{/if}}
            </:response>
          </@context.prerenderedCardSearchComponent>
        {{/if}}
      {{else}}
        <p>No cards available</p>
      {{/if}}
      {{#if (and (bool @createCard) (bool this.activeTabRef))}}
        <div class='add-card-button'>
          <Tooltip @placement='left' @offset={{6}}>
            <:trigger>
              <div class='add-card-button-container'>
                <AddButton
                  {{on 'click' this.createNew}}
                  @loading={{this.isCreateCardRunning}}
                />
              </div>
            </:trigger>
            <:content>
              Add a new card to this collection
            </:content>
          </Tooltip>
        </div>
      {{/if}}
    </div>
    <style scoped>
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
      .add-card-button-container {
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .error {
        color: var(--boxel-error-100);
      }
    </style>
  </template>

  constructor(owner: Owner, args: any) {
    super(owner, args);
    if (!this.args.model.tabs?.length) {
      this.setupInitialTabs();
      return;
    }
  }

  async setupInitialTabs() {
    let module;
    try {
      if (!this.args.model.moduleId) {
        return;
      }
      let loader: Loader = (import.meta as any).loader;
      module = await loader.import(this.args.model.moduleId);
    } catch (e) {
      console.error(e);
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

    if (tabs[0]) {
      this.args.setActiveTab(tabs[0].tabId);
    }
  }

  setTabs(tabs: Tab[]) {
    this.args.model.tabs = tabs ?? [];
  }

  get activeTabRef() {
    if (!this.args.activeTab?.ref?.name || !this.args.activeTab.ref.module) {
      return;
    }
    return codeRefWithAbsoluteURL(
      this.args.activeTab.ref,
      this.args.currentRealm,
    );
  }

  get query() {
    if (!this.activeTabRef) {
      console.error('Can not get cards without a card ref.');
      return;
    }
    return {
      filter: {
        every: [
          { type: this.activeTabRef },
          { not: { eq: { id: this.args.model.id! } } },
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
    } as Query;
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
      try {
        if (!this.activeTabRef) {
          throw new Error('Can not create a card without a card ref.');
        }
        let opts = {
          doc: doc
            ? {
                ...doc,
                meta: {
                  ...doc.data.meta,
                  realmURL: this.args.currentRealm,
                },
              }
            : undefined,
          realmURL: this.args.currentRealm,
        };
        await this.args.createCard?.(
          this.activeTabRef,
          this.args.currentRealm,
          opts,
        );
      } catch (e: unknown) {
        throw e;
      }
    },
  );
}

export class AppCardTemplate extends GlimmerComponent<{
  Args: {
    model: Partial<AppCard>;
    fields: FieldsTypeFor<AppCard>;
    context?: CardContext;
  };
  Blocks: { component: [args: TabComponentSignature]; default: [] };
}> {
  <template>
    <section class='app-card'>
      <TabbedHeader
        @headerTitle={{@model.title}}
        @tabs={{@model.tabs}}
        @setActiveTab={{this.setActiveTab}}
        @activeTabId={{this.activeTab.tabId}}
        @headerBackgroundColor={{this.headerColor}}
      >
        <:headerIcon>
          {{#if @model.headerIcon.base64}}
            <@fields.headerIcon />
          {{/if}}
        </:headerIcon>
      </TabbedHeader>
      {{yield
        (hash
          activeTab=this.activeTab
          currentRealm=this.currentRealm
          realms=this.realms
          setActiveTab=this.setActiveTab
        )
        to='component'
      }}
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

  @tracked activeTabId?: string;
  @tracked tabs = this.args.model.tabs ?? [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    let hashTab = window.location?.hash?.slice(1);
    let tabId =
      hashTab?.length && this.tabs.map((t) => t.tabId)?.includes(hashTab)
        ? hashTab
        : this.tabs[0]?.tabId;
    if (tabId) {
      this.setActiveTab(tabId);
    }
  }

  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }

  get currentRealm() {
    return this.args.model[realmURL]!;
  }

  get realms(): string[] {
    return [this.currentRealm.href];
  }

  get activeTab() {
    return this.tabs.find((t) => t.tabId === this.activeTabId) ?? this.tabs[0];
  }

  @action setActiveTab(id: string) {
    this.activeTabId = id;
  }
}

export class AppCardIsolated extends Component<typeof AppCard> {
  <template>
    <AppCardTemplate
      @model={{@model}}
      @fields={{@fields}}
      @context={{@context}}
    >
      <:component as |args|>
        <DefaultTabTemplate
          @activeTab={{args.activeTab}}
          @context={{@context}}
          @currentRealm={{args.currentRealm}}
          @model={{@model}}
          @realms={{args.realms}}
          @setActiveTab={{args.setActiveTab}}
          @createCard={{@createCard}}
        />
      </:component>
    </AppCardTemplate>
  </template>
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

export class CardsGrid extends GlimmerComponent<{
  Args: {
    cards: PrerenderedCardLike[];
    context?: CardContext;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    {{#if @cards.length}}
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
    {{else}}
      <p>No cards available</p>
    {{/if}}
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
