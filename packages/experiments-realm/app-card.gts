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
  FieldsTypeFor,
} from 'https://cardstack.com/base/card-api';
import { CardContainer } from '@cardstack/boxel-ui/components';
import { and, bool, cn } from '@cardstack/boxel-ui/helpers';
import { baseRealm } from '@cardstack/runtime-common';
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
  model: Partial<AppCard>;
  context?: CardContext;
  activeTabId?: string;
  setActiveTab?: (tabId: string) => void;
}

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
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

class DefaultTabTemplate extends GlimmerComponent<TabComponentSignature> {
  <template>
    <div class='app-card-content'>
      <@context.prerenderedCardSearchComponent
        @query={{this.query}}
        @format='fitted'
        @realms={{this.realms}}
      >
        <:loading>Loading...</:loading>
        <:response as |cards|>
          {{#if this.activeTab.isTable}}
            <TableView @instances={{cards}} />
          {{else}}
            <CardsGrid @cards={{cards}} @context={{@context}} />
          {{/if}}
        </:response>
      </@context.prerenderedCardSearchComponent>
      {{#if (and (bool @context.actions.createCard) (bool this.activeTabRef))}}
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
      .error {
        color: var(--boxel-error-100);
      }
    </style>
  </template>

  get currentRealm() {
    return this.args.model?.[realmURL];
  }

  get realms(): string[] {
    return this.args.model?.[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get activeTab() {
    return this.args.model.tabs?.find((t) => t.tabId === this.args.activeTabId);
  }

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
      throw e;
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
    this.args.setActiveTab?.(tabs[0].tabId);
  }

  setTabs(tabs: Tab[]) {
    this.args.model.tabs = tabs;
  }

  get activeTabRef() {
    if (!this.activeTab?.ref?.name || !this.activeTab.ref.module) {
      return;
    }
    return codeRefWithAbsoluteURL(this.activeTab.ref, this.currentRealm);
  }

  get query() {
    if (!this.activeTabRef) {
      throw new Error('Can not get cards without a card ref.');
    }
    return {
      filter: {
        every: [
          { type: this.activeTabRef },
          { not: { eq: { id: this.args.model.id } } },
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
        await this.args.context?.actions?.createCard?.(
          this.activeTabRef,
          this.currentRealm,
          { doc },
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
        @activeTabId={{this.activeTabId}}
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
          model=@model
          context=@context
          activeTabId=this.activeTabId
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

  constructor(owner: Owner, args: any) {
    super(owner, args);
    let tabId = window.location?.hash?.slice(1).length
      ? window.location?.hash?.slice(1)
      : this.args.model.tabs?.[0]?.tabId;
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
          @model={{@model}}
          @context={{args.context}}
          @activeTabId={{args.activeTabId}}
          @setActiveTab={{args.setActiveTab}}
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
    cards: CardDef[];
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
