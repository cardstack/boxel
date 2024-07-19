import CodeRefField from 'https://cardstack.com/base/code-ref';
import {
  CardDef,
  field,
  containsMany,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { cssVar, eq } from '@cardstack/boxel-ui/helpers';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import { restartableTask } from 'ember-concurrency';
import { contains, realmURL } from 'https://cardstack.com/base/card-api';
import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';
import { getLiveCards, cardTypeDisplayName } from '@cardstack/runtime-common';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import BooleanField from 'https://cardstack.com/base/boolean';
import { ColorPicker } from './color-picker';

class Tab extends FieldDef {
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
}

class Isolated extends Component<typeof AppCard> {
  @tracked activeTabIndex = 0;

  @action
  setActiveTab(index: number) {
    this.activeTabIndex = index;
    this.setSearch();
  }

  get activeTab() {
    if (this.args.model.tabs?.length == 0) {
      return undefined;
    }
    return this.args.model.tabs?.[this.activeTabIndex];
  }

  get noTabs() {
    return this.args.model.tabs?.length == 0;
  }

  @tracked
  private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };

  private setSearch() {
    console.log('Setting the search up');
    if (!this.activeTab) {
      return;
    }
    let tabRef = this.activeTab.ref;
    let realm = this.args.model[realmURL];
    if (!realm) {
      console.warn('Could not get realm');
      return;
    }
    this.liveQuery = getLiveCards(
      {
        filter: {
          type: {
            name: tabRef.name,
            module: tabRef.module.replace('../', realm.href),
          },
        },
      },
      realm ? [realm.href] : undefined,
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
    if (!this.liveQuery) {
      return [];
    }
    return this.liveQuery.instances;
  }

  get tableData() {
    if (this.instances.length == 0) {
      return {
        headers: [],
        rows: [],
      };
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

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.setActiveTab(0);
  }

  @action
  createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    console.log('Create card', this, this.activeTab);
    let realm = this.args.model[realmURL];
    if (!realm) {
      console.warn('Realm is required');
      return;
    }
    if (!this.activeTab) {
      console.warn('Could not get active tab');
      return;
    }
    let tabRef = {
      name: this.activeTab.ref.name,
      module: this.activeTab.ref.module.replace('../', realm.href),
    };
    if (!this.args.model.id) {
      console.warn('Could not get model id');
      return;
    }
    await this.args.context?.actions?.createCard?.(
      tabRef,
      new URL(this.args.model.id),
      {
        realmURL: realm,
      },
    );
  });

  @tracked moduleName = '';

  @action
  async setupInitialTabs() {
    if (!this.moduleName) {
      console.warn('Module name is required');
      return;
    }

    let loader = (import.meta as any).loader;
    let realm = this.args.model[realmURL];
    console.log('realm - ', realm);
    let module = await loader.import(realm + this.moduleName);
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
            module: '../' + this.moduleName,
          },
          isTable: false,
        }),
      );
    }

    this.args.model.tabs = tabs;
    this.setActiveTab(0);
    this.moduleName = '';
  }

  @action
  updateModuleName(event: Event) {
    this.moduleName = (event.target as HTMLInputElement).value;
  }

  <template>
    {{#if this.noTabs}}
      <div
        class='dashboard-content'
        style='padding: 20px; max-width: 600px; margin: 0 auto;'
      >
        <p style='margin-bottom: 20px; font-size: 16px;'>It looks like this app
          hasn't been setup yet. For a quick setup, enter the module name and
          click create.</p>
        <div style='display: flex; gap: 10px;'>
          <input
            type='text'
            value={{this.moduleName}}
            {{on 'input' this.updateModuleName}}
            style='flex-grow: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px;'
          />
          <button
            {{on 'click' this.setupInitialTabs}}
            style='padding: 10px 20px; background-color: #009879; color: white; border: none; border-radius: 4px; cursor: pointer;'
          >
            Create
          </button>
        </div>
      </div>
    {{else}}
      <section class='dashboard'>
        <header
          class='dashboard-header'
          style={{cssVar db-header-bg-color=this.args.model.headerColor}}
        >
          <h1 class='dashboard-title'><@fields.title /></h1>
          <nav class='dashboard-nav'>
            <ul class='tab-list'>
              {{#each this.args.model.tabs as |tab index|}}
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

        <div class='tab-content'>
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
            <div class='cards-grid'>
              <ul class='cards' data-test-cards-grid-cards>
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
                  {{else}}
                    <p>No cards available</p>
                  {{/if}}
                {{/each}}
              </ul>
            </div>
          {{/if}}
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
      </section>
    {{/if}}

    <style>
      .dashboard {
        --db-header-bg-color: var(
          --boxel-db-header-bg-color,
          var(--boxel-light)
        );
        --db-header-color: var(--boxel-db-header-color, var(--boxel-dark));
        position: relative;
        min-height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--db-bg-color, var(--boxel-light));
        color: var(--db-color, var(--boxel-dark));
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .dashboard-header {
        padding-right: var(--boxel-sp-lg);
        padding-left: var(--boxel-sp-lg);
        background-color: var(--db-header-bg-color);
        color: var(--db-header-color);
      }
      .dashboard-title {
        margin: 0;
        padding-top: var(--boxel-sp-lg);
        padding-bottom: var(--boxel-sp-xs);
        font: 900 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .dashboard-nav {
        font: var(--boxel-font-sm);
      }
      .dashboard-nav ul {
        list-style-type: none;
        margin: 0;
        display: flex;
        gap: var(--boxel-sp);
        padding: 0;
      }
      .dashboard-nav a {
        padding: var(--boxel-sp-xs) 0;
        font-weight: 700;
      }
      .active {
        border-bottom: 4px solid var(--db-header-color);
      }
      .dashboard-nav a:hover {
        color: var(--db-header-color);
        border-bottom: 4px solid var(--db-header-color);
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

      .cards-grid {
        --grid-card-text-thumbnail-height: 6.25rem;
        --grid-card-label-color: var(--boxel-450);
        --grid-card-width: 10.125rem;
        --grid-card-height: 15.125rem;

        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl);
        position: relative; /* Do not change this */
        height: 100%;
      }
      .cards {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(var(--grid-card-width), 1fr)
        );
        gap: var(--boxel-sp);
        justify-items: center;
        height: 100%;
      }
      .cards > li {
        height: max-content;
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }

      .add-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        bottom: 10px;
        z-index: 1;
        margin: 10px;
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
    </style>
  </template>
}

export class AppCard extends CardDef {
  static displayName = 'AppCard';
  static prefersWideFormat = true;
  @field headerColor = contains(ColorPicker);
  @field tabs = containsMany(Tab);
  static isolated = Isolated;
}
