import {
  Component,
  realmURL,
  field,
  BaseDef,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { TrackedMap } from 'tracked-built-ins';
import GlimmerComponent from '@glimmer/component';
import {
  BoxelButton,
  DndItem,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import {
  DndKanbanBoard,
  DndColumn,
  BoxelSelect,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import { action } from '@ember/object';
import { LooseSingleCardDocument, getCards } from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
// @ts-expect-error path resolution issue
import { AppCard } from '/experiments/app-card';
import { TaskStatusField, Project, Task } from './productivity/task';
import { FilterDropdown } from './productivity/filter-dropdown';
import { StatusPill } from './productivity/filter-dropdown-item';
import { FilterTrigger } from './productivity/filter-trigger';
import getTaskCardsResource from './productivity/task-cards-resource';
import { FilterDisplay } from './productivity/filter-display';
import Checklist from '@cardstack/boxel-icons/checklist';
import RectangleEllipsis from '@cardstack/boxel-icons/rectangle-ellipsis';
import User from '@cardstack/boxel-icons/user';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import {
  AnyFilter,
  CardTypeFilter,
  Query,
  EqFilter,
} from '@cardstack/runtime-common/query';

type FilterType = 'status' | 'assignee';

export interface SelectedItem {
  name?: string;
  label?: string;
  index?: number;
}

class WorkTrackerIsolated extends Component<typeof AppCard> {
  @tracked loadingColumnKey: string | undefined;
  @tracked selectedFilter: FilterType | undefined;
  filters = {
    status: {
      searchKey: 'label',
      label: 'Status',
      codeRef: {
        module: new URL('./productivity/task', import.meta.url).href,
        name: 'Status',
      },
      options: () => TaskStatusField.values,
    },
    assignee: {
      searchKey: 'name',
      label: 'Assignee',
      codeRef: {
        module: new URL('./productivity/task', import.meta.url).href,
        name: 'TeamMember',
      },
      options: () => this.assigneeCards,
    },
  };
  selectedItems = new TrackedMap<FilterType, SelectedItem[]>();
  constructor(owner: Owner, args: any) {
    super(owner, args);
  }

  get filterTypes() {
    return Object.keys(this.filters) as FilterType[];
  }

  cards = getCards(this.getTaskQuery, this.realmHrefs, { isLive: true });

  assigneeQuery = getCards(
    {
      filter: {
        type: this.filters.assignee.codeRef,
      },
    },
    this.realmHrefs,
    { isLive: true },
  );

  get cardInstances() {
    if (!this.cards || !this.cards.instances) {
      return [];
    }
    return this.cards.instances as Task[];
  }

  get assigneeCards() {
    return this.assigneeQuery.instances;
  }

  @action showTaskCard(card: Task): boolean {
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

  hasColumnKey = (card: Task, key: string) => {
    return card.status?.label === key;
  };

  taskCollection = getTaskCardsResource(
    this,
    () => this.cardInstances,
    () => TaskStatusField.values.map((status) => status.label) ?? [],
    () => this.hasColumnKey,
  );

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

  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  get realmHref() {
    return this.realmURL.href;
  }

  get realmHrefs() {
    return [this.realmURL?.href];
  }

  get assignedTaskCodeRef() {
    return {
      module: new URL('./productivity/task', import.meta.url).href,
      name: 'Task',
    };
  }

  get currentProject() {
    return this.args.model.project;
  }

  get getTaskQuery(): Query {
    let everyArr: (AnyFilter | CardTypeFilter | EqFilter)[] = [];
    if (!this.realmURL) {
      throw new Error('No realm url');
    }
    if (!this.currentProject || !this.currentProject.id) {
      console.log('No project');
      everyArr.push({ eq: { 'project.id': null } });
    } else {
      everyArr.push({ eq: { 'project.id': this.currentProject.id } });
    }
    return (
      everyArr.length > 0
        ? {
            filter: {
              on: this.assignedTaskCodeRef,
              every: everyArr,
            },
          }
        : {
            filter: {
              type: this.assignedTaskCodeRef,
            },
          }
    ) as Query;
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
                self: this.currentProject.id ?? null,
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
    _targetCard: DndItem | undefined,
    _sourceColumnAfterDrag: DndColumn,
    targetColumnAfterDrag: DndColumn,
  ) {
    let cardInNewCol = targetColumnAfterDrag.cards.find(
      (c: CardDef) => c.id === draggedCard.id,
    );
    if (cardInNewCol) {
      let statusValue = TaskStatusField.values.find(
        (value) => value.label === targetColumnAfterDrag.title,
      );
      cardInNewCol.status = new TaskStatusField(statusValue);
      await this.args.context?.actions?.saveCard?.(cardInNewCol);
    }
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

  get options() {
    return this.selectedFilterConfig?.options();
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

  @action selectedFilterItems(filterType: FilterType) {
    return this.selectedItems.get(filterType) ?? [];
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

  get isLoading() {
    return this.cards && this.cards.isLoading;
  }

  get assigneeIsLoading() {
    return (
      this.selectedFilter === 'assignee' &&
      this.assigneeQuery &&
      this.assigneeQuery.isLoading
    );
  }

  @action viewCard() {
    this.args.context?.actions?.viewCard?.(new URL(this.args.model.id), 'edit');
  }

  <template>
    <div class='task-app'>
      {{#if (not this.currentProject.id)}}
        <div class='disabled'>
          {{#if @context.actions.viewCard}}
            <BoxelButton @kind='primary' {{on 'click' this.viewCard}}>
              Link a project to continue
            </BoxelButton>
          {{/if}}
        </div>
      {{else if this.isLoading}}
        <div class='disabled'>
          <LoadingIndicator @color='var(--boxel-light)' />
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
              @placeholder={{'Choose a Filter'}}
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
                @removeItem={{(fn this.removeFilter filterType)}}
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
      </div>
    </div>
    {{!TODO: Get rid of global styles}}
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

export class WorkTracker extends AppCard {
  static displayName = 'Work Tracker';
  static icon = Checklist;
  static headerColor = '#ff7f7b';
  static prefersWideFormat = true;
  static isolated = WorkTrackerIsolated;
  @field project = linksTo(() => Project);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
