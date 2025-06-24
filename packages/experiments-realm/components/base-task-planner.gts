import {
  CardContext,
  CardDef,
  BaseDef,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import GlimmerComponent from '@glimmer/component';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import { action } from '@ember/object';
import { type getCards } from '@cardstack/runtime-common';
import { FilterDropdown } from './filter/filter-dropdown';
import { StatusPill } from './filter/filter-dropdown-item';
import { FilterTrigger } from './filter/filter-trigger';
import { FilterDisplay } from './filter/filter-display';
import RectangleEllipsis from '@cardstack/boxel-icons/rectangle-ellipsis';
import User from '@cardstack/boxel-icons/user';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import {
  BoxelButton,
  DndItem,
  LoadingIndicator,
  DndKanbanBoard,
  DndColumn,
  BoxelSelect,
} from '@cardstack/boxel-ui/components';
import type { Query } from '@cardstack/runtime-common/query';
import getKanbanResource from '../kanban-resource';

interface ColumnHeaderSignature {
  statusLabel: string;
  createNewTask: (statusLabel: string) => void;
  isCreateNewTaskLoading: (statusLabel: string) => boolean;
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
        font-size: 0.9rem;
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

export interface SelectedItem {
  name?: string;
  label?: string;
  index?: number;
}

export type FilterType = 'status' | 'assignee';

// Type definitions for the card structure
export interface TaskCard extends CardDef {
  id: string;
  status?: {
    label: string;
    index: number;
  };
  assignee?: {
    name: string;
  };
}

// Configuration for the status field
export interface StatusFieldConfig {
  values: Array<{
    label: string;
    index: number;
  }>;
}

// Configuration for card operations
export interface CardOperations {
  onCreateTask: (statusLabel: string) => Promise<void>;
  onMoveCard: (params: {
    draggedCard: DndItem;
    targetCard?: DndItem;
    sourceColumn: DndColumn;
    targetColumn: DndColumn;
  }) => Promise<void>;
  hasColumnKey: (card: TaskCard, key: string) => boolean;
  orderBy?: <T extends CardDef>(a: T, b: T) => number;
}

// Configuration for the task source
export interface TaskSourceConfig {
  module: string;
  name: string;
  getQuery: () => Query;
}

// Main configuration interface
export interface TaskPlannerConfig {
  status: StatusFieldConfig;
  cardOperations: CardOperations;
  taskSource: TaskSourceConfig;
  filters: {
    status: FilterConfig;
    assignee: FilterConfig;
  };
}

export interface FilterConfig {
  searchKey: string;
  label: string;
  codeRef: {
    module: string;
    name: string;
  };
  options: () => any[];
}

export interface TaskColumn {
  title: string;
  cards: TaskCard[];
}

export interface TaskCollection {
  columns: TaskColumn[];
}

interface TaskPlannerArgs {
  Args: {
    config: TaskPlannerConfig;
    realmURL: URL | undefined;
    parentId: string | undefined;
    context: CardContext | undefined;
    emptyStateMessage?: string;
    editCard: () => void;
  };
  Element: HTMLElement;
}

export class TaskPlanner extends GlimmerComponent<TaskPlannerArgs> {
  @tracked loadingColumnKey: string | undefined;
  @tracked selectedFilter: FilterType | undefined;
  selectedItems = new TrackedMap<FilterType, SelectedItem[]>();
  filters: Record<
    FilterType,
    {
      searchKey: string;
      label: string;
      codeRef: {
        module: string;
        name: string;
      };
      options: () => any[];
    }
  >;
  cards: ReturnType<getCards> | undefined;
  assigneeQuery: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.selectedItems = new TrackedMap();

    // Initialize filters
    this.filters = {
      status: {
        searchKey: 'label',
        label: 'Status',
        codeRef: {
          module: this.args.config.taskSource.module,
          name: 'Status',
        },
        options: () => this.args.config.status.values,
      },
      assignee: {
        searchKey: 'name',
        label: 'Assignee',
        codeRef: {
          module: this.args.config.taskSource.module,
          name: 'Assignee',
        },
        options: () => this.assigneeCards,
      },
    };

    // Initialize cards and assignee query
    this.cards = this.args.context?.getCards(
      this,
      () => this.getTaskQuery,
      () => this.realmHrefs,
      {
        isLive: true,
      },
    );

    this.assigneeQuery = this.args.context?.getCards(
      this,
      () => {
        return {
          filter: {
            type: this.args.config.filters.assignee.codeRef,
          },
        };
      },
      () => this.realmHrefs,
      { isLive: true },
    );
  }

  get emptyStateMessage(): string {
    return this.args.emptyStateMessage ?? 'Select a parent to continue';
  }

  get getTaskQuery(): Query {
    return this.args.config.taskSource.getQuery();
  }

  get filterTypes() {
    return Object.keys(this.args.config.filters) as FilterType[];
  }

  get cardInstances() {
    if (!this.cards || !this.cards.instances) {
      return [];
    }
    return this.cards.instances;
  }

  get assigneeCards() {
    return this.assigneeQuery?.instances ?? [];
  }

  get realmHref() {
    return this.args.realmURL?.href;
  }

  get realmHrefs() {
    if (!this.args.realmURL) {
      return [];
    }
    return [this.args.realmURL.href];
  }

  @action async onMoveCardMutation(
    draggedCard: DndItem,
    targetCard: DndItem | undefined,
    sourceColumnAfterDrag: DndColumn,
    targetColumnAfterDrag: DndColumn,
  ) {
    await this.args.config.cardOperations.onMoveCard({
      draggedCard,
      targetCard,
      sourceColumn: sourceColumnAfterDrag,
      targetColumn: targetColumnAfterDrag,
    });
  }

  @action showTaskCard(card: any): boolean {
    return this.filterTypes.every((filterType: FilterType) => {
      let selectedItems = this.selectedItems.get(filterType) ?? [];
      if (selectedItems.length === 0) return true;
      return selectedItems.some((item) => {
        if (filterType === 'status') {
          return card.status?.label === item.label;
        } else if (filterType === 'assignee') {
          return card.assignee?.name === item.name;
        } else {
          return false;
        }
      });
    });
  }

  @action getFilterIcon(filterType: FilterType) {
    switch (filterType) {
      case 'status':
        return RectangleEllipsis;
      case 'assignee':
        return User;
      default:
        return undefined;
    }
  }

  get selectedFilterConfig() {
    if (this.selectedFilter === undefined) {
      return undefined;
    }
    return this.args.config.filters[this.selectedFilter];
  }

  get selectedItemsForFilter() {
    if (this.selectedFilter === undefined) {
      return [];
    }
    return this.selectedItems.get(this.selectedFilter) ?? [];
  }

  @action onSelectFilter(item: FilterType) {
    this.selectedFilter = item;
  }

  @action onChange(selected: SelectedItem[]) {
    if (this.selectedFilter) {
      this.selectedItems.set(this.selectedFilter, selected);
    }
  }

  @action onClose() {
    this.selectedFilter = undefined;
    return true;
  }

  @action isSelectedItem(item: SelectedItem) {
    let selectedItems = this.selectedItemsForFilter;
    return selectedItems.includes(item);
  }

  @action selectedFilterItems(filterType: FilterType) {
    return this.selectedItems.get(filterType) ?? [];
  }

  get assigneeIsLoading() {
    return (
      this.selectedFilter === 'assignee' &&
      this.assigneeQuery &&
      this.assigneeQuery.isLoading
    );
  }

  getComponent(cardOrField: BaseDef) {
    return cardOrField.constructor.getComponent(cardOrField);
  }

  removeFileExtension(cardUrl: string) {
    return cardUrl.replace(/\.[^/.]+$/, '');
  }

  @action removeFilter(key: FilterType, item: SelectedItem) {
    let items = this.selectedItems.get(key);
    if (!items) {
      return;
    }
    let itemIndex: number;
    if (key === 'status') {
      itemIndex = items.findIndex((o) => item?.index === o?.index);
    } else {
      itemIndex = items.findIndex((o) => item === o);
    }

    if (itemIndex > -1) {
      items.splice(itemIndex, 1);
      this.selectedItems.set(key, items);
    }
  }

  taskCollection = getKanbanResource(
    this,
    () => this.cardInstances,
    () => this.args.config.status.values.map((status) => status.label) ?? [],
    () => this.args.config.cardOperations.hasColumnKey,
    () => this.args.config.cardOperations.orderBy,
  );

  @action async createNewTask(statusLabel: string) {
    this.loadingColumnKey = statusLabel;
    try {
      await this.args.config.cardOperations.onCreateTask(statusLabel);
    } finally {
      this.loadingColumnKey = undefined;
    }
  }

  @action isCreateNewTaskLoading(statusLabel: string): boolean {
    return this.loadingColumnKey === statusLabel;
  }

  <template>
    <div class='task-app'>
      {{#if (not @parentId)}}
        <div class='disabled'>
          <BoxelButton @kind='primary' {{on 'click' @editCard}}>
            {{this.emptyStateMessage}}
          </BoxelButton>
        </div>
      {{/if}}
      <div class='filter-section'>
        <div class='filter-dropdown-container'>
          {{#if this.selectedFilterConfig}}
            {{#let (this.selectedFilterConfig.options) as |options|}}
              <FilterDropdown
                @isLoading={{this.assigneeIsLoading}}
                @searchField={{this.selectedFilterConfig.searchKey}}
                @options={{options}}
                @realmURLs={{this.realmHrefs}}
                @selected={{this.selectedItemsForFilter}}
                @onChange={{this.onChange}}
                @onClose={{this.onClose}}
                as |item|
              >
                {{#let (this.isSelectedItem item) as |isSelected|}}
                  <StatusPill
                    @isSelected={{isSelected}}
                    @label={{if
                      (eq this.selectedFilter 'status')
                      item.label
                      item.name
                    }}
                  />
                {{/let}}
              </FilterDropdown>
            {{/let}}
          {{else}}
            <BoxelSelect
              class='status-select'
              @selected={{this.selectedFilter}}
              @options={{this.filterTypes}}
              @onChange={{this.onSelectFilter}}
              @placeholder='Choose a Filter'
              @matchTriggerWidth={{false}}
              @triggerComponent={{FilterTrigger}}
              as |item|
            >
              {{#let (this.getFilterIcon item) as |Icon|}}
                <div class='filter-option'>
                  {{#if Icon}}
                    <Icon class='filter-display-icon' />
                  {{/if}}
                  <span class='filter-display-text'>{{item}}</span>
                </div>
              {{/let}}
            </BoxelSelect>
          {{/if}}
        </div>
        <div class='filter-display-sec'>
          {{#each this.filterTypes as |filterType|}}
            {{#let (this.selectedFilterItems filterType) as |items|}}
              <FilterDisplay
                @key={{filterType}}
                @items={{items}}
                @removeItem={{fn this.removeFilter filterType}}
                @icon={{this.getFilterIcon filterType}}
                as |item|
              >
                {{#if (eq filterType 'status')}}
                  {{item.label}}
                {{else}}
                  {{item.name}}
                {{/if}}
              </FilterDisplay>
            {{/let}}
          {{/each}}
        </div>
      </div>
      <div class='columns-container'>
        <DndKanbanBoard
          @columns={{this.taskCollection.columns}}
          @onMove={{this.onMoveCardMutation}}
          @displayCard={{this.showTaskCard}}
        >
          <:header as |column|>
            <ColumnHeader
              @statusLabel={{column.title}}
              @createNewTask={{this.createNewTask}}
              @isCreateNewTaskLoading={{this.isCreateNewTaskLoading}}
            />
          </:header>
          <:card as |card|>
            {{#let (this.getComponent card) as |CardComponent|}}
              <div
                {{@context.cardComponentModifier
                  cardId=card.id
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
                data-test-cards-grid-item={{this.removeFileExtension card.id}}
                data-cards-grid-item={{this.removeFileExtension card.id}}
              >
                <CardComponent class='card' />
              </div>
            {{/let}}
          </:card>
        </DndKanbanBoard>
      </div>
    </div>
    {{! template-lint-disable require-scoped-style }}
    <style>
      .ember-power-select-dropdown.ember-basic-dropdown-content--below,
      .ember-power-select-dropdown.ember-basic-dropdown-content--in-place {
        border-top: 1px solid #aaaaaa;
        border-top-left-radius: var(--boxel-border-radius-sm);
        border-top-right-radius: var(--boxel-border-radius-sm);
      }
    </style>
    <style scoped>
      .task-app {
        display: flex;
        position: relative;
        flex-direction: column;
        font: var(--boxel-font);
        padding-left: var(--boxel-sp);
        height: 100%;
      }
      .disabled {
        position: absolute;
        top: 0%;
        left: 0%;
        width: 100%;
        height: 100%;
        background-color: rgb(38 38 38 / 50%);
        z-index: 10; /*TODO: Resolve z-index with drag and drop. This has to be greater than --draggable-overlay-z-index + 1*/
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: var(--boxel-font-size-lg);
        font-weight: 500;
      }
      .filter-section {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp);
        align-items: center;
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs);
        width: 100%;
      }
      .filter-dropdown-container {
        width: auto;
      }
      .filter-display-sec {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: end;
        gap: var(--boxel-sp-xxs);
        flex: 1;
        min-width: 0;
      }
      .columns-container {
        display: block;
        height: calc(100vh - 58px);
        overflow: hidden;
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
        height: 170px !important;
      }
      .status-select {
        border: none;
      }
      .filter-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 200px;
      }
      .filter-display-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        margin-right: var(--boxel-sp-xxxs);
      }
      .filter-display-text {
        word-break: break-word;
      }
      .filter-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 200px;
      }
      .filter-display-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        margin-right: var(--boxel-sp-xxxs);
      }
      .filter-display-text {
        word-break: break-word;
      }
    </style>
  </template>
}
