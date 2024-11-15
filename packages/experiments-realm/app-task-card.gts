import {
  Component,
  realmURL,
  StringField,
  contains,
  field,
  BaseDef,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { TrackedMap } from 'tracked-built-ins';
import GlimmerComponent from '@glimmer/component';
import { DndItem, LoadingIndicator } from '@cardstack/boxel-ui/components';
import {
  DndKanbanBoard,
  DndColumn,
  BoxelSelect,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import { action } from '@ember/object';
import { LooseSingleCardDocument, getCards } from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
import { AppCard } from '/catalog/app-card';
import { TaskStatusField } from './productivity/task';
import { FilterDropdown } from './productivity/filter-dropdown';
import { StatusPill } from './productivity/filter-dropdown-item';
import { FilterTrigger } from './productivity/filter-trigger';
import getTaskCardsResource from './productivity/task-cards-resource';
import { FilterDisplay } from './productivity/filter-display';
import Checklist from '@cardstack/boxel-icons/checklist';
import { eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';

import type Owner from '@ember/owner';
import {
  AnyFilter,
  CardTypeFilter,
  Query,
} from '@cardstack/runtime-common/query';

type FilterType = 'status' | 'assignee' | 'project';

export interface SelectedItem {
  name?: string;
  label?: string;
  index?: number;
}

class AppTaskCardIsolated extends Component<typeof AppCard> {
  @tracked loadingColumnKey: string | undefined;
  @tracked selectedFilter: FilterType | undefined;
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
  filters = {
    status: {
      label: 'Status',
      codeRef: {
        module: `${this.realmHref}productivity/task`,
        name: 'Status',
      },
      options: () => TaskStatusField.values,
    },
    assignee: {
      label: 'Assignee',
      codeRef: {
        module: `${this.realmHref}productivity/task`,
        name: 'TeamMember',
      },
      options: () => this.assigneeCards,
    },
    project: {
      label: 'Project',
      codeRef: {
        module: `${this.realmHref}productivity/task`,
        name: 'Project',
      },
      options: () => this.projectCards,
    },
  };
  selectedItems = new TrackedMap<FilterType, SelectedItem[]>();
  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.initializeDropdownData.perform();
  }

  get filterTypes() {
    return Object.keys(this.filters) as FilterType[];
  }

  taskCollection = getTaskCardsResource(
    this,
    () => this.getTaskQuery,
    () => this.realmHref,
  );

  initializeDropdownData = restartableTask(async () => {
    this.assigneeQuery = getCards(
      {
        filter: {
          type: this.filters.assignee.codeRef,
        },
      },
      this.realmHrefs,
    );

    this.projectQuery = getCards(
      {
        filter: {
          type: this.filters.project.codeRef,
        },
      },
      this.realmHrefs,
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

  filterObject(filterType: FilterType) {
    let selectedItems = this.selectedItems.get(filterType) ?? [];
    return selectedItems.map((item) => {
      if (filterType === 'status') {
        return {
          eq: {
            'status.label': item.label,
          },
        };
      } else {
        let key = filterType + '.name';
        return {
          eq: {
            [key]: item.name,
          },
        };
      }
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
      module: `${this.realmHref}productivity/task`, //this is problematic when copying cards bcos of the way they are copied
      name: 'Task',
    };
  }

  get getTaskQuery(): Query {
    let everyArr: (AnyFilter | CardTypeFilter)[] = [];
    this.filterTypes.forEach((filterType) => {
      let anyFilter = this.filterObject(filterType);
      if (anyFilter.length > 0) {
        everyArr.push({
          any: anyFilter,
        } as AnyFilter);
      }
    });

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

  @action onSelectFilter(item: FilterType) {
    if (this.selectedFilter) {
      this.selectedFilter = item;
    }
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

  <template>
    <div class='task-app'>
      <div class='filter-section'>
        {{#if this.initializeDropdownData.isRunning}}
          isLoading...
        {{else}}
          <h2 class='project-title'>Project</h2>
          {{#if this.selectedFilterConfig}}
            {{#let (this.selectedFilterConfig.options) as |options|}}
              <FilterDropdown
                @options={{options}}
                @realmURLs={{this.realmHrefs}}
                @selected={{this.selectedItemsForFilter}}
                @onChange={{this.onChange}}
                @onClose={{this.onClose}}
                as |item|
              >
                {{#let (this.isSelectedItem item) as |isSelected|}}
                  {{#if (eq this.selectedFilter 'status')}}
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
          <div class='filter-display'>
            {{#each this.filterTypes as |filterType|}}
              {{#let (this.selectedFilterItems filterType) as |items|}}
                <FilterDisplay
                  @key={{filterType}}
                  @items={{items}}
                  @removeItem={{(fn this.removeFilter filterType)}}
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
        {{/if}}
      </div>
      <div class='columns-container'>
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
      </div>
    </div>

    <style scoped>
      .task-app {
        display: flex;
        position: relative;
        flex-direction: column;
        font: var(--boxel-font);
        margin-left: var(--boxel-sp);
        height: 100%;
      }
      .filter-section {
        padding: var(--boxel-sp-xs) 0;
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp);
        align-items: center;
      }
      .project-title {
        font-size: var(-- --boxel-sp-lg);
        font-weight: 600;
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
        height: 150px !important;
        box-shadow: none;
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
