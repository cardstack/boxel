import BooleanField from 'https://cardstack.com/base/boolean';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import {
  CardDef,
  field,
  contains,
  containsMany,
  FieldDef,
  Component,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import { restartableTask } from 'ember-concurrency';
// @ts-ignore
import cssUrl from 'ember-css-url';

import {
  AddButton,
  Tooltip,
  FieldContainer,
  BoxelButton,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { cssVar, eq } from '@cardstack/boxel-ui/helpers';

import {
  getLiveCards,
  cardTypeDisplayName,
  codeRefWithAbsoluteURL,
  type Loader,
  type Query,
} from '@cardstack/runtime-common';

class CodeRefEdit extends Component<typeof EditableCodeRef> {
  <template>
    <FieldContainer @label='Module' @tag='label'>
      <BoxelInput @value={{this.module}} @onInput={{this.onModuleInput}} />
    </FieldContainer>
    <FieldContainer @label='Name' @tag='label'>
      <BoxelInput @value={{this.name}} @onInput={{this.onNameInput}} />
    </FieldContainer>
  </template>

  @tracked name?: string = this.args.model?.name;
  @tracked module?: string = this.args.model?.module;

  get ref() {
    if (!this.name?.trim().length || !this.module?.trim().length) {
      return null;
    }
    return { name: this.name, module: this.module };
  }

  setFullRef() {
    this.args.set(this.ref);
  }

  @action onModuleInput(val: string) {
    this.module = val?.trim();
    this.setFullRef();
  }

  @action onNameInput(val: string) {
    this.name = val?.trim();
    this.setFullRef();
  }
}

class EditableCodeRef extends CodeRefField {
  static edit = CodeRefEdit;
}

class Tab extends FieldDef {
  @field ref = contains(EditableCodeRef);
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
      <header
        class='app-card-header'
        style={{cssVar db-header-bg-color=this.headerColor}}
      >
        <div class='app-card-title-group'>
          <h1 class='app-card-title'><@fields.title /></h1>
        </div>
        <nav class='app-card-nav'>
          <ul class='app-card-tab-list'>
            {{#each @model.tabs as |tab index|}}
              <li>
                <a
                  {{on 'click' (fn this.setActiveTab index)}}
                  class={{if (eq this.activeTabIndex index) 'active'}}
                >
                  {{tab.ref.name}}
                </a>
              </li>
            {{/each}}
          </ul>
        </nav>
      </header>

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
            <ul class='cards-grid' data-test-cards-grid-cards>
              {{! use "key" to keep the list stable between refreshes }}
              {{#each this.instances key='id' as |card|}}
                <li
                  {{@context.cardComponentModifier
                    card=card
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                  data-test-cards-grid-item={{card.id}}
                  {{! In order to support scrolling cards into view
            we use a selector that is not pruned out in production builds }}
                  data-cards-grid-item={{card.id}}
                >
                  <div class='grid-card'>
                    <div
                      class='grid-thumbnail'
                      style={{cssUrl 'background-image' card.thumbnailURL}}
                    >
                      {{#unless card.thumbnailURL}}
                        <div
                          class='grid-thumbnail-text'
                          data-test-cards-grid-item-thumbnail-text
                        >{{cardTypeDisplayName card}}</div>
                      {{/unless}}
                    </div>
                    <h3
                      class='grid-title'
                      data-test-cards-grid-item-title
                    >{{card.title}}</h3>
                    <h4
                      class='grid-display-name'
                      data-test-cards-grid-item-display-name
                    >{{cardTypeDisplayName card}}</h4>
                  </div>
                </li>
              {{else}}
                {{#if this.liveQuery.isLoading}}
                  Loading...
                {{else if this.errorMessage}}
                  <p class='error'>{{this.errorMessage}}</p>
                {{else}}
                  <p>No cards available</p>
                {{/if}}
              {{/each}}
            </ul>
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
        background-color: var(--db-bg-color, var(--boxel-light));
        color: var(--db-color, var(--boxel-dark));
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .app-card-header {
        padding: 0 var(--boxel-sp-lg);
        background-color: var(--db-header-bg-color, var(--boxel-light));
        color: var(--db-header-color, var(--boxel-dark));
        border-bottom: var(--boxel-border);
      }
      .app-card-title {
        font: 900 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .app-card-nav {
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .app-card-tab-list {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: flex;
        gap: var(--boxel-sp-lg);
      }
      .app-card-tab-list a {
        padding: var(--boxel-sp-xs) var(--boxel-sp-xxs);
        font-weight: 700;
      }
      .app-card-tab-list a.active,
      .app-card-tab-list a:hover:not(:disabled) {
        color: var(--db-header-color, var(--boxel-dark));
        border-bottom: 4px solid var(--db-header-color, var(--boxel-dark));
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
      .tabbed-interface {
        width: 100%;
      }
      .grid-card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
      }
      .grid-thumbnail {
        display: flex;
        align-items: center;
        height: var(--grid-card-text-thumbnail-height);
        background-color: var(--boxel-teal);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        color: var(--boxel-light);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .grid-title {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        text-align: center;
      }
      .grid-display-name {
        margin: 0;
        font: 500 var(--boxel-font-xs);
        text-align: center;
        color: var(--grid-card-label-color);
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
      .cards-grid {
        --grid-card-text-thumbnail-height: 6.25rem;
        --grid-card-label-color: var(--boxel-450);
        --grid-card-width: 10.125rem;
        --grid-card-height: 15.125rem;
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(var(--grid-card-width), 1fr)
        );
        grid-auto-rows: max-content;
        gap: var(--boxel-sp);
        justify-items: center;
        height: 100%;
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
      .grid-card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
      }
      .grid-card > *,
      .grid-thumbnail-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .grid-thumbnail {
        display: flex;
        align-items: center;
        height: var(--grid-card-text-thumbnail-height);
        background-color: var(--boxel-teal);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        color: var(--boxel-light);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .grid-title {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        text-align: center;
      }
      .grid-display-name {
        margin: 0;
        font: 500 var(--boxel-font-xs);
        text-align: center;
        color: var(--grid-card-label-color);
      }
      .grid-thumbnail + * {
        margin-top: var(--boxel-sp-lg);
      }
      .grid-title + .grid-display-name {
        margin-top: 0.2em;
      }
      .error {
        color: var(--boxel-error-100);
      }
    </style>
  </template>

  @tracked activeTabIndex = 0;
  @tracked private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };
  @tracked errorMessage = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.setSearch();
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  get activeTab() {
    if (!this.args.model.tabs?.length) {
      return;
    }
    let tab = this.args.model.tabs[this.activeTabIndex];
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
    return Object.getPrototypeOf(this.args.model).constructor.headerColor;
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
      query = { filter: { type: this.activeTabRef } };
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

  @action createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    if (!this.activeTabRef) {
      return;
    }
    try {
      await this.args.context?.actions?.createCard?.(
        this.activeTabRef,
        undefined,
      );
    } catch (e) {
      console.error(e);
      this.errorMessage =
        e instanceof Error ? `Error: ${e.message}` : 'An error occurred';
    }
  });
}

export class AppCard extends CardDef {
  static displayName = 'App Card';
  static prefersWideFormat = true;
  static headerColor = '#ffffff';
  @field tabs = containsMany(Tab);
  static isolated = AppCardIsolated;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='app-card-embedded'>
        <header>
          <div class='icon' />
          <div class='title-group'>
            <h3><@fields.title /></h3>
            <h4>{{@model.constructor.displayName}}</h4>
          </div>
        </header>
        <p><@fields.description /></p>
      </article>
      <style>
        .app-card-embedded {
          padding: var(--boxel-sp);
        }
        header {
          display: flex;
          gap: var(--boxel-sp);
          align-items: center;
        }
        h3 {
          margin: 0;
          font-size: 1.125rem;
          letter-spacing: var(--boxel-lsp-xs);
        }
        h4 {
          margin: 0;
          font: 500 var(--boxel-font-xs);
          line-height: 1.7;
          letter-spacing: var(--boxel-lsp-xs);
          color: var(--boxel-450);
        }
        p {
          letter-spacing: var(--boxel-lsp-xs);
        }
        .icon {
          width: 100px;
          height: 100px;
          background-color: var(--boxel-450);
          border-radius: var(--boxel-border-radius-sm);
        }
      </style>
    </template>
  };
}
