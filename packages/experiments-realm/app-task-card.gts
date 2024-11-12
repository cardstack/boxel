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
import { TrackedMap } from 'tracked-built-ins';
import GlimmerComponent from '@glimmer/component';
import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import {
  BoxelButton,
  CircleSpinner,
  DndKanbanBoard,
  DndColumn,
  BoxelSelect,
  IconButton,
  BoxelMultiSelectBasic,
} from '@cardstack/boxel-ui/components';
import {
  DropdownArrowFilled,
  IconPlus,
  IconFunnel,
} from '@cardstack/boxel-ui/icons';
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
import { FilterDropdownCard } from './productivity/filter-dropdown';
import { FilterTrigger } from './productivity/filter-trigger';
import Checklist from '@cardstack/boxel-icons/checklist';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

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
  @tracked private order: Map<string, string[]> = new Map();
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
      let cardIdsFromOrder = this.order.get(statusLabel);
      let newCards: CardDef[] = [];
      if (cardIdsFromOrder) {
        newCards = cardIdsFromOrder.reduce((acc, id) => {
          let card = cards.find((c) => c.id === id);
          if (card) {
            acc.push(card);
          }
          return acc;
        }, []);
      } else {
        newCards = cards.filter((task) => task.status.label === statusLabel);
      }
      this.data.set(statusLabel, new DndColumn(statusLabel, newCards));
    });
  }

  // Note:
  // sourceColumnAfterDrag & targetColumnAfterDrag is the column state after the drag and drop
  update(
    draggedCard: DndItem,
    targetCard: DndItem | undefined,
    sourceColumnAfterDrag: DndColumn,
    targetColumnAfterDrag: DndColumn,
  ) {
    let status = TaskStatusField.values.find(
      (value) => value.label === targetColumnAfterDrag.title,
    );
    let cardInNewCol = targetColumnAfterDrag.cards.find(
      (c) => c.id === draggedCard.id,
    );
    cardInNewCol.status.label = status.label;
    cardInNewCol.status.index = status.index;
    //update the order of the cards in the column
    this.order.set(
      sourceColumnAfterDrag.title,
      sourceColumnAfterDrag.cards.map((c) => c.id),
    );
    this.order.set(
      targetColumnAfterDrag.title,
      targetColumnAfterDrag.cards.map((c) => c.id),
    );
    return cardInNewCol;
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

type FilterType = 'Status' | 'Assignee' | 'Project';

interface FilterObject {
  label?: string;
  codeRef: ResolvedCodeRef;
  filter: any;
}

interface SelectedItem {
  name: string;
}

class AppTaskCardIsolated extends Component<typeof AppTaskCard> {
  @tracked newQuery: Query | undefined;
  @tracked loadingColumnKey: string | undefined;
  @tracked selectedFilter: FilterType;
  filterTypes: FilterType[] = ['Status', 'Assignee', 'Project'];
  filters = {
    Status: {
      label: 'Status',
      codeRef: {
        module: `${this.realmURL?.href}productivity/task`,
        name: 'Status',
      },
      options: TaskStatusField.values,
      filter: (item: SelectedItem) => {
        return {
          eq: {
            'status.label': item.label,
          },
        };
      },
    },
    Assignee: {
      label: 'Assignee',
      codeRef: {
        module: `${this.realmURL?.href}productivity/task`,
        name: 'TeamMember',
      },
      filter: (item: SelectedItem) => {
        return {
          eq: {
            'assignee.name': item.name,
          },
        };
      },
    },
    Project: {
      label: 'Project',
      codeRef: {
        module: `${this.realmURL?.href}productivity/task`,
        name: 'Project',
      },
      options: [],
      filter: (item: SelectedItem) => {
        return {
          eq: {
            'project.name': item.name,
          },
        };
      },
    },
  };
  selectedItems = new TrackedMap<FilterType, SelectedItem[]>();

  taskCollection = getTaskCollection(
    this,
    () => this.query,
    () => this.realmURL,
  );

  filterArr(filterType: FilterType) {
    let filterObject = this.filters.get(filterType);
    let selectedItems = this.selectedItems.get(filterType);
    return items.map((item) => {
      return {
        eq: {
          [filterObject.codeRef.name]: item.name,
        },
      };
    });
  }

  get selectedFilterConfig() {
    if (this.selectedFilter === undefined) {
      return undefined;
    }
    return this.filters[this.selectedFilter];
  }

  get selectedItemsForFilter() {
    if (this.selectedFilter === undefined) {
      return [];
    }
    return this.selectedItems.get(this.selectedFilter);
  }

  get query() {
    return this.newQuery ?? this.getTaskQuery;
  }

  get realmURL() {
    return this.args.model[realmURL];
  }

  get realmURLs() {
    return [this.realmURL];
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
    targetCard: DndItem | undefined,
    sourceColumnAfterDrag: DndColumn,
    targetColumnAfterDrag: DndColumn,
  ) {
    let updatedCard = this.taskCollection.update(
      draggedCard,
      targetCard,
      sourceColumnAfterDrag,
      targetColumnAfterDrag,
    );
    //TODO: save the card!
    await this.args.context?.actions?.saveCard?.(updatedCard);
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

  @action onSelectFilter(item: FilterType) {
    this.selectedFilter = item;
  }

  @action onChange(value: SelectedItem) {
    this.selectedItems.set(this.selectedFilter, value);
  }

  @action onClose() {
    this.selectedFilter = undefined;
    return true;
  }

  <template>
    <div class='task-app'>
      <button {{on 'click' this.changeQuery}}>Change Query</button>
      <div class='filter-section'>
        {{#if this.selectedFilterConfig}}
          {{#if this.selectedFilterConfig.options}}
            Implement Field Dropdown
          {{else}}
            <FilterDropdownCard
              @codeRef={{this.selectedFilterConfig.codeRef}}
              @realmURLs={{this.realmURLs}}
              @selected={{this.selectedItemsForFilter}}
              @onChange={{this.onChange}}
              @onClose={{this.onClose}}
              as |item|
            >
              {{item.name}}
            </FilterDropdownCard>
          {{/if}}

        {{else}}
          <BoxelSelect
            class='status-select'
            @selected={{this.selectedFilter}}
            @options={{this.filterTypes}}
            @onChange={{this.onSelectFilter}}
            @placeholder={{'Choose a Filter'}}
            @matchTriggerWidth={{false}}
            @triggerComponent={{FilterTrigger}}
            as |item|
          >
            {{item}}
          </BoxelSelect>
        {{/if}}

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

      .status-select {
        border: none;
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

interface CheckBoxArgs {
  Args: {
    isSelected: boolean;
  };
  Element: Element;
}

class CheckboxIndicator extends GlimmerComponent<CheckBoxArgs> {
  <template>
    <div class='checkbox-indicator'>
      <span class={{cn 'check-icon' check-icon--selected=@isSelected}}>
        <CheckMark width='12' height='12' />
      </span>
    </div>
    <style scoped>
      .checkbox-indicator {
        width: 16px;
        height: 16px;
        border: 1px solid var(--boxel-500);
        border-radius: 3px;
        margin-right: var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .checkbox-indicator:hover,
      .checkbox-indicator:focus {
        box-shadow: 0 0 0 2px var(--boxel-dark-teal);
      }
      .check-icon {
        --icon-color: var(--boxel-dark-teal);
        visibility: collapse;
        display: contents;
      }
      .check-icon--selected {
        visibility: visible;
      }
    </style>
  </template>
}

interface StatusPillArgs {
  Args: {
    isSelected: boolean;
    label: string;
  };
  Element: Element;
}

class StatusPill extends GlimmerComponent<StatusPillArgs> {
  <template>
    <span class='status-pill'>
      <div class='status-pill-content'>
        <CheckboxIndicator @isSelected={{@isSelected}} />
        <div class='status-name'>{{@label}}</div>
      </div>
    </span>

    <style scoped>
      .status-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
        width: 100%;
      }
      .status-pill.selected {
        background-color: var(--boxel-highlight);
      }
      .status-pill-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .status-avatar {
        width: var(--boxel-sp-sm);
        height: var(--boxel-sp-sm);
        border-radius: 50%;
        background-color: var(--avatar-bg-color, var(--boxel-light));
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .status-name {
        flex-grow: 1;
      }
    </style>
  </template>
}
