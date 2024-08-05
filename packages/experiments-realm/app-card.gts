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
import { cn } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import { restartableTask } from 'ember-concurrency';

import {
  AddButton,
  Tooltip,
  FieldContainer,
  BoxelButton,
  BoxelInput,
  TabbedHeader,
} from '@cardstack/boxel-ui/components';

import {
  getLiveCards,
  codeRefWithAbsoluteURL,
  type Loader,
  type Query,
  LooseSingleCardDocument,
  isSingleCardDocument,
} from '@cardstack/runtime-common';

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
}

class AppCardIsolated extends Component<typeof AppCard> {
  @tracked moduleName = '';
  @action updateModuleName(val: string) {
    this.errorMessage = '';
    this.moduleName = val;
  }
  @action async setupInitialTabs() {
    if (!this.moduleName) {
      this.errorMessage = 'Module name is required';
      return;
    }
    if (!this.currentRealm) {
      this.errorMessage = 'Current realm is not available';
      return;
    }
    let loader: Loader = (import.meta as any).loader;
    let module;
    try {
      module = await loader.import(this.currentRealm.href + this.moduleName);
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
        'isCardDef' in declaration,
    );
    let tabs = [];
    for (let [name, _declaration] of exportedCards) {
      tabs.push(
        new Tab({
          displayName: name,
          tabId: name,
          ref: {
            name,
            module: this.moduleName,
          },
          isTable: false,
        }),
      );
    }

    this.args.model.tabs = tabs;
    this.setActiveTab(0);
    this.moduleName = '';
  }

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
      <div class='app-card-content'>
        {{#if this.activeTab}}
          {{#if this.activeTab.isTable}}
            <div class='table'>
              {{#if this.liveQuery.isLoading}}
                Loading...
              {{else}}
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
            </div>
          {{else}}
            {{#if this.instances.length}}
              <CardsGrid @instances={{this.instances}} @context={{@context}} />
            {{else}}
              {{#if this.liveQuery.isLoading}}
                Loading...
              {{else if this.errorMessage}}
                <p class='error'>{{this.errorMessage}}</p>
              {{else}}
                <p>No cards available</p>
              {{/if}}
            {{/if}}
          {{/if}}
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
        {{else}}
          <p>
            It looks like this app hasn't been setup yet. For a quick setup,
            enter the module name and click create.
          </p>
          <div class='module-input-group'>
            <FieldContainer
              @label='Module Name'
              @vertical={{true}}
              @tag='label'
            >
              <BoxelInput
                @value={{this.moduleName}}
                @onInput={{this.updateModuleName}}
                @state={{if this.errorMessage 'invalid' 'initial'}}
                @errorMessage={{this.errorMessage}}
              />
            </FieldContainer>
            <BoxelButton
              @kind='primary'
              @size='touch'
              {{on 'click' this.setupInitialTabs}}
            >
              Create
            </BoxelButton>
          </div>
        {{/if}}
      </div>
    </section>
    <style>
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
      .app-card-content {
        width: 100%;
        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-xxl);
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
  @tracked private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };
  @tracked errorMessage = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.setTab();
    this.setSearch();
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

  get tableData() {
    if (!this.instances) {
      return;
    }
    let exampleCard = this.instances[0];
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

    let rows = this.instances.map((card) => {
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

  @action setActiveTab(index: number) {
    this.activeTabIndex = index;
    this.setSearch();
  }

  setSearch(query?: Query) {
    if (!this.currentRealm) {
      return;
    }
    if (!query) {
      if (!this.activeTabRef) {
        return;
      }
      query = {
        filter: {
          every: [
            { type: this.activeTabRef },
            { not: { eq: { id: this.args.model.id! } } },
          ],
        },
      };
    }
    this.liveQuery = getLiveCards(
      query,
      [this.currentRealm.href], // we're only searching in the current realm
      async (ready: Promise<void> | undefined) => {
        if (this.args.context?.actions) {
          this.args.context.actions.doWithStableScroll(
            this.args.model as CardDef,
            async () => {
              await ready;
            },
          );
        }
      },
    );
  }

  get instances() {
    return this.liveQuery?.instances;
  }

  @action createNew(value: unknown) {
    let cardDoc = isSingleCardDocument(value) ? value : undefined;
    this.createCard.perform(cardDoc);
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

export class AppCard extends CardDef {
  static displayName = 'App Card';
  static prefersWideFormat = true;
  static headerColor = '#ffffff';
  @field tabs = containsMany(Tab);
  @field headerIcon = contains(Base64ImageField);
  static isolated = AppCardIsolated;
}

export const getComponent = (card: CardDef) => {
  if (!card) {
    return;
  }
  return card.constructor.getComponent(card);
};

export class CardsGrid extends GlimmerComponent<{
  Args: {
    instances: CardDef[] | [];
    context?: CardContext;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    <ul class={{cn 'cards-grid' list-format=@isListFormat}} ...attributes>
      {{! use "key" to keep the list stable between refreshes }}
      {{#each @instances key='id' as |card|}}
        <li
          class='cards-grid-item'
          {{! In order to support scrolling cards into view
            we use a selector that is not pruned out in production builds }}
          data-cards-grid-item={{card.id}}
          {{@context.cardComponentModifier
            card=card
            format='data'
            fieldType=undefined
            fieldName=undefined
          }}
        >
          {{#let (getComponent card) as |Card|}}
            <Card />
          {{/let}}
        </li>
      {{/each}}
    </ul>
    <style>
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
      .cards-grid-item > :deep(.field-component-card.embedded-format) {
        --overlay-embedded-card-header-height: 0;
      }
    </style>
  </template>
}
