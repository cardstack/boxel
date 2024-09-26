import {
  Component,
  CardDef,
  realmURL,
  CardContext,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { CardContainer } from '@cardstack/boxel-ui/components';

import {
  BoxelInput,
  Modal as BoxelModal,
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { DropdownArrowFilled, IconPlus } from '@cardstack/boxel-ui/icons';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { fn, array } from '@ember/helper';
import { action } from '@ember/object';
import { type Query } from '@cardstack/runtime-common';

class TaskAppCardIsolated extends Component<typeof TaskAppCard> {
  @tracked isSheetOpen = false;
  @tracked selectedFilter = '';
  @tracked isModalOpen = false;
  @tracked taskDescription = '';
  @tracked errorMessage = '';
  @tracked triggerStatus = '';

  filterOptions = ['All', 'Status Type', 'Assignee', 'Project'];

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get assignedTaskCodeRef() {
    return {
      module: 'http://localhost:4201/experiments/productivity/task',
      name: 'Task',
    };
  }

  get backlogQuery() {
    return {
      filter: {
        on: this.assignedTaskCodeRef,
        any: [
          {
            eq: {
              'status.label': 'Backlog',
            },
          },
        ],
      },
    };
  }

  get nextSprintQuery() {
    return {
      filter: {
        on: this.assignedTaskCodeRef,
        any: [
          {
            eq: {
              'status.label': 'Next Sprint',
            },
          },
        ],
      },
    };
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

  @action
  triggerAddTaskModal(status: string) {
    this.triggerStatus = status;
    console.log(this.triggerStatus);
    this.isModalOpen = true;
  }

  @action
  closeModal() {
    this.triggerStatus = '';
    this.isModalOpen = false;
    this.taskDescription = ''; // 重置任务描述
  }

  @action
  updateTaskDescription(value: string) {
    this.taskDescription = value;
  }

  @action
  createNewTask() {}

  <template>
    <div class='task-app'>
      <div class='filter-section'>
        <BoxelDropdown>
          <:trigger as |bindings|>
            <BoxelButton {{bindings}}>
              {{#if this.selectedFilter.length}}
                {{this.selectedFilter}}
              {{else}}
                Filter
                <DropdownArrowFilled
                  width='10'
                  height='10'
                  style='margin-left: 5px;'
                />
              {{/if}}
            </BoxelButton>
          </:trigger>
          <:content as |dd|>
            <BoxelMenu
              @closeMenu={{dd.close}}
              @items={{array
                (menuItem 'All' (fn this.updateFilter 'Status' 'All'))
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
        <ColumnQuery
          @context={{@context}}
          @realms={{this.realms}}
          @query={{this.backlogQuery}}
          @title='Backlog'
          @triggerAddTaskModal={{this.triggerAddTaskModal}}
        />
        <ColumnQuery
          @context={{@context}}
          @realms={{this.realms}}
          @query={{this.nextSprintQuery}}
          @title='Next Sprint'
          @triggerAddTaskModal={{this.triggerAddTaskModal}}
        />
        <ColumnQuery
          @context={{@context}}
          @realms={{this.realms}}
          @query={{this.nextSprintQuery}}
          @title='Current Sprint'
          @triggerAddTaskModal={{this.triggerAddTaskModal}}
        />
        <ColumnQuery
          @context={{@context}}
          @realms={{this.realms}}
          @query={{this.nextSprintQuery}}
          @title='In Review'
          @triggerAddTaskModal={{this.triggerAddTaskModal}}
        />
        <ColumnQuery
          @context={{@context}}
          @realms={{this.realms}}
          @query={{this.nextSprintQuery}}
          @title='Staged'
          @triggerAddTaskModal={{this.triggerAddTaskModal}}
        />
        <ColumnQuery
          @context={{@context}}
          @realms={{this.realms}}
          @query={{this.nextSprintQuery}}
          @title='Shipped'
          @triggerAddTaskModal={{this.triggerAddTaskModal}}
        />
      </div>
      <Sheet @onClose={{this.toggleSheet}} @isOpen={{this.isSheetOpen}}>
        <h2>Sheet Content</h2>
        <p>This is the content of the sheet.</p>
      </Sheet>
    </div>

    <BoxelModal
      @isOpen={{this.isModalOpen}}
      @onClose={{this.closeModal}}
      @size='small'
      @centered={{true}}
    >
      <div class='modal-content'>
        <h2>{{this.triggerStatus}} - Add New Task</h2>
        <BoxelInput
          @type='textarea'
          @value={{this.taskDescription}}
          @onChange={{this.updateTaskDescription}}
          @placeholder='Enter task description...'
          style='--boxel-input-height: 200px'
        />
        <div class='button-container'>
          <BoxelButton @kind='primary' {{on 'click' this.createNewTask}}>Create
            New Task</BoxelButton>
          <BoxelButton
            @kind='secondary'
            {{on 'click' this.closeModal}}
          >Cancel</BoxelButton>
        </div>
      </div>
    </BoxelModal>

    <style>
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
        margin-bottom: var(--boxel-sp);
        background-color: var(--boxel-light);
      }

      .modal-content {
        background-color: white;
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
      }

      .button-container {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp);
      }

      .error-message {
        color: var(--boxel-error);
        margin-top: var(--boxel-sp);
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

    <style>
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

export class TaskAppCard extends CardDef {
  static displayName = 'App Task';
  static prefersWideFormat = true;
  static isolated = TaskAppCardIsolated;
}

interface ColumnQuerySignature {
  Args: {
    context: CardContext | undefined;
    realms: string[];
    query: Query;
    title: string;
    triggerAddTaskModal: (status: string) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

class ColumnQuery extends GlimmerComponent<ColumnQuerySignature> {
  @tracked taskDescription = '';

  @action updateTaskDescription(value: string) {
    this.taskDescription = value;
  }

  <template>
    <div class='column'>
      <div class='column-title'>
        <span>{{@title}}</span>
        <IconPlus
          width='12'
          height='12'
          {{on 'click' (fn @triggerAddTaskModal @title)}}
          style='cursor: pointer;'
        />
      </div>
      <div class='column-data'>
        <ul class='cards' data-test-cards-grid-cards>
          {{#let
            (component @context.prerenderedCardSearchComponent)
            as |PrerenderedCardSearch|
          }}
            <PrerenderedCardSearch
              @query={{@query}}
              @format='fitted'
              @realms={{@realms}}
            >
              <:loading>Loading...</:loading>
              <:response as |cards|>
                {{#each cards as |card|}}
                  <li class='card'>
                    <CardContainer @displayBoundaries={{true}}>
                      {{card.component}}
                    </CardContainer>
                  </li>
                {{/each}}
              </:response>
            </PrerenderedCardSearch>
          {{/let}}
        </ul>
      </div>
    </div>

    <style>
      .column {
        flex: 0 0 var(--boxel-xs-container);
        border-right: var(--boxel-border);
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .column-title {
        position: sticky;
        top: 0;
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        font: var(--boxel-font-sm);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .column-data {
        flex-grow: 1;
        overflow-y: auto;
        padding: var(--boxel-sp);
      }

      .cards {
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .card {
        padding: 10px; /* Add padding here so scroll works */
      }
      .modal-content {
        background-color: white;
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
      }
      .button-container {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>
}
