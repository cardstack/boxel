// @ts-nocheck
import {
  Component,
  realmURL,
  StringField,
  contains,
  field,
  BaseDef,
} from 'https://cardstack.com/base/card-api';
import { getCard, getCards } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
  CircleSpinner,
  DndKanbanBoard,
  DndColumn,
} from '@cardstack/boxel-ui/components';
import { DropdownArrowFilled, IconPlus } from '@cardstack/boxel-ui/icons';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { fn, array } from '@ember/helper';
import { action } from '@ember/object';
import {
  LooseSingleCardDocument,
  ResolvedCodeRef,
  type Query,
} from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
import { AppCard } from '/catalog/app-card';
import { TaskStatusField, type LooseyGooseyData } from './productivity/task';
import Checklist from '@cardstack/boxel-icons/checklist';

import { isEqual } from 'lodash';
import type Owner from '@ember/owner';
import { Resource } from 'ember-resources';

interface Args {
  named: {
    query: Query | undefined;
  };
}

// This is a resource because we have to consider 3 data mechanism
// 1. the reactivity of the query. Changes in query should trigger server fetch
// 2. the drag and drop of cards. When dragging and dropping, we should NOT trigger a server fetch
//    but rather just update the local data structure
// 3. When we trigger a server fetch, we need to maintain the sort order of the cards.
//   Currently, we don't have any mechanism to maintain the sort order but this is good enough for now
class TaskCollection extends Resource<Args> {
  @tracked private data: Map<string, DndColumn> = new Map();
  @tracked private query: Query = undefined;

  private run = restartableTask(async (query: Query, realm: string) => {
    let staticQuery = getCards(query, [realm]); // I hate this
    await staticQuery.loaded;
    let cards = staticQuery.instances as Task[];
    this.commit(cards); //update stale data

    this.query = query;
  });

  queryHasChanged(query: Query) {
    return !isEqual(this.query, query);
  }

  commit(cards: CardDef) {
    TaskStatusField.values?.map((status: LooseyGooseyData) => {
      let statusLabel = status.label;
      let newCards = cards.filter((task) => task.status.label === statusLabel);
      this.data.set(statusLabel, new DndColumn(statusLabel, newCards));
    });
  }

  // Note:
  // sourceColumn & targetColumn is the column state after the drag and drop
  update(
    draggedCard: DndItem,
    targetCard: DndItem,
    sourceColumn: DndColumn,
    targetColumn: DndColumn,
  ) {
    let status = TaskStatusField.values.find(
      (value) => value.label === targetColumn.title,
    );
    let cardInNewCol = targetColumn.cards.find((c) => c.id === draggedCard.id);
    cardInNewCol.status.label = status.label;
    cardInNewCol.status.index = status.index;
  }

  get columns() {
    return Array.from(this.data.values());
  }

  modify(_positional: never[], named: Args['named']) {
    if (this.query === undefined || this.queryHasChanged(named.query)) {
      this.run.perform(named.query, named.realm);
    }
  }
}

export function getTaskCollection(
  parent: object,
  query: () => Query | undefined,
  realm: () => string | undefined,
) {
  return TaskCollection.from(parent, () => ({
    named: {
      realm: realm(),
      query: query(),
    },
  }));
}

class AppTaskCardIsolated extends Component<typeof AppTaskCard> {
  @tracked newQuery: Query | undefined;
  @tracked loadingColumnKey: string | undefined;
  @tracked selectedFilter = '';
  @tracked taskDescription = '';
  filterOptions = ['All', 'Status Type', 'Assignee', 'Project'];

  taskCollection = getTaskCollection(
    this,
    () => this.query,
    () => this.realmURL,
  );

  get query() {
    return this.newQuery ?? this.getTaskQuery;
  }

  get realmURL() {
    return this.args.model[realmURL];
  }

  get assignedTaskCodeRef() {
    return {
      module: `${this.args.model[realmURL]?.href}productivity/task`, //this is problematic when copying cards bcos of the way they are copied
      name: 'Task',
    };
  }

  get getTaskQuery(): Query {
    return {
      filter: {
        type: this.assignedTaskCodeRef,
      },
    };
  }

  //static statuses before query
  get statuses() {
    return TaskStatusField.values;
  }

  @action
  updateFilter(type: string, value: string) {
    switch (type) {
      case 'Status':
        this.selectedFilter = value;
        break;
      case 'Assignee':
        this.selectedFilter = value;
        break;
      case 'Project':
        this.selectedFilter = value;
        break;
      default:
        console.warn(`Unknown filter type: ${type}`);
    }
  }

  @action createNewTask(statusLabel: string) {
    this.loadingColumnKey = statusLabel;
    this._createNewTask.perform(statusLabel);
  }

  @action isCreateNewTaskLoading(statusLabel: string) {
    return this.loadingColumnKey === statusLabel;
  }
  private _createNewTask = restartableTask(async (statusLabel: string) => {
    if (this.realmURL === undefined) {
      return;
    }

    try {
      let cardRef = this.assignedTaskCodeRef;

      if (!cardRef) {
        return;
      }

      let index = TaskStatusField.values.find((value) => {
        return value.label === statusLabel;
      })?.index;

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            taskName: null,
            taskDetail: null,
            status: {
              index,
              label: statusLabel,
            },
            priority: {
              index: null,
              label: null,
            },
            dueDate: null,
            description: null,
            thumbnailURL: null,
          },
          relationships: {
            assignee: {
              links: {
                self: null,
              },
            },
            project: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: cardRef,
          },
        },
      };

      await this.args.context?.actions?.createCard?.(
        cardRef,
        new URL(cardRef.module),
        {
          realmURL: this.realmURL,
          doc,
        },
      );
    } catch (error) {
      console.error('Error creating card:', error);
    } finally {
      this.loadingColumnKey = undefined;
    }
  });

  @action async onMoveCardMutation(
    draggedCard: DndItem,
    targetCard: DndItem,
    sourceColumn: DndColumn,
    targetColumn: DndColumn,
  ) {
    this.taskCollection.update(
      draggedCard,
      targetCard,
      sourceColumn,
      targetColumn,
    );
    //TODO: save the card!
    await this.args.context?.actions?.saveCard?.(targetCard);
  }

  @action changeQuery() {
    this.newQuery = {
      filter: {
        on: this.assignedTaskCodeRef,
        // this is the column status
        any: [
          {
            eq: {
              'status.label': 'Backlog',
            },
          },
          {
            eq: {
              'status.label': 'Current Sprint',
            },
          },
        ],
      },
    };
  }

  <template>
    <div class='task-app'>
      <button {{on 'click' this.changeQuery}}>Change Query</button>
      <div class='filter-section'>
        <BoxelDropdown>
          <:trigger as |bindings|>
            <BoxelButton {{bindings}} class='dropdown-filter-button'>
              {{#if this.selectedFilter.length}}
                {{this.selectedFilter}}
              {{else}}
                <span class='dropdown-filter-text'>Filter</span>
                <DropdownArrowFilled
                  width='10'
                  height='10'
                  class='dropdown-arrow'
                />
              {{/if}}
            </BoxelButton>
          </:trigger>
          <:content as |dd|>
            <BoxelMenu
              @closeMenu={{dd.close}}
              @items={{array
                (menuItem
                  'Status Type' (fn this.updateFilter 'Status' 'Status Type')
                )
                (menuItem 'Assignee' (fn this.updateFilter 'Status' 'Assignee'))
                (menuItem 'Project' (fn this.updateFilter 'Status' 'Project'))
              }}
            />
          </:content>
        </BoxelDropdown>

      </div>
      <div class='columns-container'>
        {{#if this.loadTasks.isRunning}}
          Loading..
        {{else}}
          <DndKanbanBoard
            @columns={{this.taskCollection.columns}}
            @onMove={{this.onMoveCardMutation}}
          >
            <:header as |column|>
              <ColumnHeader
                @statusLabel={{column.title}}
                @createNewTask={{this.createNewTask}}
                @isCreateNewTaskLoading={{this.isCreateNewTaskLoading}}
              />
            </:header>
            <:card as |card|>
              {{#let (getComponent card) as |CardComponent|}}
                <div
                  {{@context.cardComponentModifier
                    cardId=card.id
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                  data-test-cards-grid-item={{removeFileExtension card.id}}
                  data-cards-grid-item={{removeFileExtension card.id}}
                >
                  <CardComponent class='card' />
                </div>
              {{/let}}

            </:card>
          </DndKanbanBoard>

        {{/if}}
      </div>
    </div>

    <style scoped>
      .task-app {
        display: flex;
        position: relative;
        flex-direction: column;
        height: 100vh;
        font: var(--boxel-font);
        overflow: hidden;
      }
      .filter-section {
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp);
        align-items: center;
      }
      .columns-container {
        display: flex;
        overflow-x: auto;
        flex-grow: 1;
      }
      .dropdown-filter-button {
        display: flex;
        align-items: center;
      }
      .dropdown-filter-text {
        margin-right: var(--boxel-sp-xxs);
      }
      .dropdown-arrow {
        display: inline-block;
      }
      /** Need to specify height because fitted field component has a default height**/
      .card {
        height: 150px !important;
      }
    </style>
  </template>
}

interface ColumnHeaderSignature {
  statusLabel: string;
  createNewTask: (statusLabel: string) => void;
  isCreateNewTaskLoading: (statusLabel: string) => void;
}

class ColumnHeader extends GlimmerComponent<ColumnHeaderSignature> {
  <template>
    <div class='column-header-content'>
      {{@statusLabel}}
      <button class='create-new-task-button' {{on 'click' this.createNewTask}}>
        {{#let (@isCreateNewTaskLoading @statusLabel) as |isLoading|}}
          {{#if isLoading}}
            <LoadingIndicator class='loading' />
          {{else}}
            <IconPlus width='12px' height='12px' />
          {{/if}}
        {{/let}}
      </button>
    </div>
    <style scoped>
      .loading {
        --boxel-loading-indicator-size: 14px;
      }
      .column-header-content {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xxs);
        font: var(--boxel-font-sm);
      }
      .create-new-task-button {
        all: unset;
        cursor: pointer;
      }
    </style>
  </template>

  @action createNewTask() {
    this.args.createNewTask(this.args.statusLabel);
  }
}

export class AppTaskCard extends AppCard {
  static displayName = 'App Task';
  static icon = Checklist;
  static prefersWideFormat = true;
  static isolated = AppTaskCardIsolated;
  @field title = contains(StringField, {
    computeVia: function (this: AppTaskCard) {
      return 'App Task';
    },
  });
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
