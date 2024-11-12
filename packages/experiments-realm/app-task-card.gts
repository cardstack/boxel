// @ts-nocheck
import {
  Component,
  realmURL,
  StringField,
  contains,
  field,
  BaseDef,
  CardDef,
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
import { FilterDropdown } from './productivity/filter-dropdown';
import { StatusPill } from './productivity/filter-dropdown-item';
import { FilterTrigger } from './productivity/filter-trigger';
import getTaskCardsResource from './productivity/task-cards-resource';
import Checklist from '@cardstack/boxel-icons/checklist';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { isEqual } from 'lodash';
import type Owner from '@ember/owner';
import { Resource } from 'ember-resources';

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
  private declare assigneeQuery: {
    instances: CardDef[];
    isLoading: boolean;
    loaded: Promise<void>;
  };
  private declare projectQuery: {
    instances: CardDef[];
    isLoading: boolean;
    loaded: Promise<void>;
  };
  filterTypes: FilterType[] = ['Status', 'Assignee', 'Project'];
  filters = {
    Status: {
      label: 'Status',
      codeRef: {
        module: `${this.realmURL?.href}productivity/task`,
        name: 'Status',
      },
      options: () => TaskStatusField.values,
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
      options: () => this.assigneeCards,
    },
    Project: {
      label: 'Project',
      codeRef: {
        module: `${this.realmURL?.href}productivity/task`,
        name: 'Project',
      },
      filter: (item: SelectedItem) => {
        return {
          eq: {
            'project.name': item.name,
          },
        };
      },
      options: () => this.projectCards,
    },
  };
  selectedItems = new TrackedMap<FilterType, SelectedItem[]>();
  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.initializeDropdownData.perform();
  }

  taskCollection = getTaskCardsResource(
    this,
    () => this.query,
    () => this.realmURL,
  );

  initializeDropdownData = restartableTask(async () => {
    this.assigneeQuery = getCards(
      {
        filter: {
          type: this.filters.Assignee.codeRef,
        },
      },
      [this.realmURL],
    );

    this.projectQuery = getCards(
      {
        filter: {
          type: this.filters.Project.codeRef,
        },
      },
      [this.realmURL],
    );
    await this.assigneeQuery.loaded;
    await this.projectQuery.loaded;
  });

  get assigneeCards() {
    return this.assigneeQuery.instances;
  }

  get projectCards() {
    return this.projectQuery.instances;
  }

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
    return this.selectedItems.get(this.selectedFilter) ?? [];
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

  @action isSelectedItem(item: SelectedItem) {
    let selectedItems = this.selectedItemsForFilter;
    return selectedItems.includes(item);
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

  get options() {
    return (
      this.selectedFilterConfig.getCards() ?? this.selectedFilterConfig?.options
    );
  }

  <template>
    <div class='task-app'>
      <button {{on 'click' this.changeQuery}}>Change Query</button>
      <div class='filter-section'>
        {{#if this.initializeDropdownData.isRunning}}
          isLoading...
        {{else}}
          {{#if this.selectedFilterConfig}}
            {{#let (this.selectedFilterConfig.options) as |options|}}
              <FilterDropdown
                @options={{options}}
                @realmURLs={{this.realmURLs}}
                @selected={{this.selectedItemsForFilter}}
                @onChange={{this.onChange}}
                @onClose={{this.onClose}}
                as |item|
              >
                {{#let (this.isSelectedItem item) as |isSelected|}}
                  {{#if (eq this.selectedFilter 'Status')}}
                    <StatusPill
                      @isSelected={{isSelected}}
                      @label={{item.label}}
                    />
                  {{else}}
                    <StatusPill
                      @isSelected={{isSelected}}
                      @label={{item.name}}
                    />
                  {{/if}}
                {{/let}}
              </FilterDropdown>
            {{/let}}
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
