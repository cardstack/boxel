// @ts-nocheck
import {
  Component,
  realmURL,
  CardContext,
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

class AppTaskCardIsolated extends Component<typeof AppTaskCard> {
  @tracked loadingColumnKey: string | undefined;
  @tracked isSheetOpen = false;
  @tracked selectedFilter = '';
  @tracked taskDescription = '';
  filterOptions = ['All', 'Status Type', 'Assignee', 'Project'];

  liveQuery = getCards(this.getTaskQuery, this.realms);

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get assignedTaskCodeRef() {
    return {
      module: `${this.args.model[realmURL]?.href}productivity/task`, //this is problematic when copying cards bcos of the way they are copied
      name: 'Task',
    };
  }

  getQueryForStatus(status: string) {
    return {
      filter: {
        on: this.assignedTaskCodeRef,
        any: [
          {
            eq: {
              'status.label': status,
            },
          },
        ],
      },
    };
  }

  get getTaskQuery(): Query {
    return {
      filter: {
        type: this.assignedTaskCodeRef,
      },
    };
  }

  get statuses() {
    return TaskStatusField.values;
  }

  get tasks() {
    if (this.liveQuery === undefined) {
      return;
    }

    return this.liveQuery?.instances as Task[];
  }

  @action getTaskWithStatus(status: string) {
    if (this.tasks === undefined) {
      return [];
    }
    return this.tasks?.filter((task) => task.status.label === status);
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

  get realmURL() {
    return this.args.model[realmURL];
  }

  _createNewTask = restartableTask(async (statusLabel: string) => {
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

  @action createNewTask(statusLabel: string) {
    this.loadingColumnKey = statusLabel;
    this._createNewTask.perform(statusLabel);
  }

  @action isCreateNewTaskLoading(statusLabel: string) {
    return this.loadingColumnKey === statusLabel;
  }

  <template>
    <div class='task-app'>
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

        <button class='sheet-toggle' {{on 'click' this.toggleSheet}}>
          {{if this.isSheetOpen 'Close' 'Open'}}
          Sheet
        </button>
      </div>

      <div class='columns-container'>
        {{#each this.statuses as |status|}}
          <div class='column'>
            {{#let (this.getTaskWithStatus status.label) as |taskCards|}}
              <ColumnHeader
                @statusLabel={{status.label}}
                @createNewTask={{this.createNewTask}}
                @isCreateNewTaskLoading={{this.isCreateNewTaskLoading}}
              />
              <div class='column-data'>
                <ul class='cards' data-test-cards-grid-cards>
                  {{#each taskCards as |card|}}
                    <li
                      {{@context.cardComponentModifier
                        cardId=card.id
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                      data-test-cards-grid-item={{removeFileExtension card.id}}
                      data-cards-grid-item={{removeFileExtension card.id}}
                    >
                      {{#let (getComponent card) as |CardComponent|}}
                        <CardComponent />
                      {{/let}}
                    </li>
                  {{/each}}
                </ul>
              </div>
            {{/let}}
          </div>
        {{/each}}
      </div>
      <Sheet @onClose={{this.toggleSheet}} @isOpen={{this.isSheetOpen}}>
        <h2>Sheet Content</h2>
        <p>This is the content of the sheet.</p>
      </Sheet>
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

      .sheet-toggle {
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background-color: var(--boxel-purple);
        color: var(--boxel-light);
        border: none;
        border-radius: var(--boxel-border-radius);
        cursor: pointer;
      }

      .columns-container {
        display: flex;
        overflow-x: auto;
        flex-grow: 1;
      }

      .task-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        background-color: var(--boxel-light);
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
      .column {
        display: flex;
        flex-direction: column;
        flex: 0 0 var(--boxel-xs-container);
        border-right: var(--boxel-border);
        height: 100%;
        transition: background-color 0.3s ease;
      }

      .column-data {
        position: relative;
        padding: var(--boxel-sp);
        height: 100%;
        background-color: var(--boxel-600);
        z-index: 0;
        overflow-y: auto;
      }
      .cards {
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
    </style>
  </template>

  toggleSheet = () => {
    this.isSheetOpen = !this.isSheetOpen;
  };
}

export interface SheetSignature {
  Args: {
    onClose: () => void;
    isOpen: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

class Sheet extends GlimmerComponent<SheetSignature> {
  <template>
    <div class='sheet-overlay {{if @isOpen "is-open"}}'>
      <div class='sheet-content {{if @isOpen "is-open"}}'>
        <button class='close-button' {{on 'click' @onClose}}>×</button>
        {{yield}}
      </div>
    </div>

    <style scoped>
      .sheet-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0);
        display: flex;
        justify-content: flex-end;
        pointer-events: none;
        transition: background-color 0.3s ease-out;
      }

      .sheet-overlay.is-open {
        background-color: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
      }

      .sheet-content {
        width: 300px;
        height: 100%;
        background-color: var(--boxel-light);
        padding: var(--boxel-sp);
        box-shadow: -2px 0 5px rgba(0, 0, 0, 0.1);
        transform: translateX(100%);
        transition: transform 0.3s ease-out;
        position: relative;
      }

      .sheet-content.is-open {
        transform: translateX(0);
      }

      .close-button {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        padding: var(--boxel-sp-xxs);
        line-height: 1;
      }
    </style>
  </template>
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

interface ColumnHeaderSignature {
  statusLabel: string;
  createNewTask: (statusLabel: string) => void;
  isCreateNewTaskLoading: (statusLabel: string) => void;
}

class ColumnHeader extends GlimmerComponent<ColumnHeaderSignature> {
  <template>
    <div class='column-header'>
      {{@statusLabel}}
      <button
        class='create-new-task-button'
        {{on 'click' (fn @createNewTask @statusLabel)}}
      >
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
      .column-header {
        display: flex;
        justify-content: space-between;
        position: sticky;
        top: 0;
        background-color: var(--dnd-kanban-header-bg, var(--boxel-100));
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        font: var(--boxel-font-sm);
      }
      .create-new-task-button {
        all: unset;
        cursor: pointer;
      }
    </style>
  </template>
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
