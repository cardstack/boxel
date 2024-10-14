import {
  Component,
  realmURL,
  CardContext,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
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
import { AppCard } from './app-card';

interface ColumnData {
  status: {
    label: string;
    index: number;
  };
  query: Query;
  codeRef: ResolvedCodeRef;
}

class AppTaskCardIsolated extends Component<typeof AppTaskCard> {
  @tracked isSheetOpen = false;
  @tracked selectedFilter = '';
  @tracked taskDescription = '';
  filterOptions = ['All', 'Status Type', 'Assignee', 'Project'];

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

  get backlogQuery() {
    return this.getQueryForStatus('Backlog');
  }

  get nextSprintQuery() {
    return this.getQueryForStatus('Next Sprint');
  }

  get currentSprintQuery() {
    return this.getQueryForStatus('Current Sprint');
  }

  get inProgressQuery() {
    return this.getQueryForStatus('In Progress');
  }

  get inReviewQuery() {
    return this.getQueryForStatus('In Review');
  }

  get stagedQuery() {
    return this.getQueryForStatus('Staged');
  }

  get shippedQuery() {
    return this.getQueryForStatus('Shipped');
  }

  columnData: ColumnData[] = [
    {
      status: {
        label: 'Backlog',
        index: 0,
      },
      query: this.backlogQuery,
    },
    {
      status: {
        label: 'Next Sprint',
        index: 1,
      },
      query: this.nextSprintQuery,
    },
    {
      status: {
        label: 'Current Sprint',
        index: 2,
      },
      query: this.currentSprintQuery,
    },
    {
      status: {
        label: 'In Progress',
        index: 3,
      },
      query: this.inProgressQuery,
    },
    {
      status: {
        label: 'In Review',
        index: 4,
      },
      query: this.inReviewQuery,
    },
    {
      status: {
        label: 'Staged',
        index: 5,
      },
      query: this.stagedQuery,
    },
    {
      status: {
        label: 'Shipped',
        index: 6,
      },
      query: this.shippedQuery,
    },
  ].map((column): ColumnData => {
    return {
      ...column,
      codeRef: this.assignedTaskCodeRef,
    };
  });

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
        {{#each this.columnData as |column|}}
          <ColumnQuery
            @context={{@context}}
            @realms={{this.realms}}
            @column={{column}}
            @realmURL={{this.realmURL}}
          />
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

      .button-container {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp);
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
  static prefersWideFormat = true;
  static isolated = AppTaskCardIsolated;
  @field title = contains(StringField, {
    computeVia: function (this: AppTaskCard) {
      return 'App Task';
    },
  });
}

interface ColumnQuerySignature {
  Args: {
    context: CardContext | undefined;
    realms: string[];
    column: ColumnData;
    realmURL: URL | undefined;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

class ColumnQuery extends GlimmerComponent<ColumnQuerySignature> {
  @action createNewTask(column: ColumnData) {
    this._createNewTask.perform(column);
  }

  _createNewTask = restartableTask(async (column: ColumnData) => {
    if (this.args.realmURL === undefined) {
      return;
    }
    try {
      let cardRef = column.codeRef;

      if (!cardRef) {
        return;
      }

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            taskName: null,
            taskDetail: null,
            status: column.status,
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
          realmURL: this.args.realmURL,
          doc,
        },
      );
    } catch (error) {
      console.error('Error creating card:', error);
    }
  });

  <template>
    <div class='column'>
      <div class='column-title'>
        <span>{{@column.status.label}}</span>
        <div>
          <button
            class='create-new-task-button'
            {{on 'click' (fn this.createNewTask @column)}}
          >
            {{#if this._createNewTask.isRunning}}
              <CircleSpinner width='12px' height='12px' />
            {{else}}
              <IconPlus width='12px' height='12px' />
            {{/if}}
          </button>
        </div>
      </div>
      <div class='column-data'>
        <ul class='cards' data-test-cards-grid-cards>
          {{#let
            (component @context.prerenderedCardSearchComponent)
            as |PrerenderedCardSearch|
          }}
            <PrerenderedCardSearch
              @query={{@column.query}}
              @format='fitted'
              @realms={{@realms}}
            >
              <:loading>
                <LoadingIndicator class='loading-indicator' />
              </:loading>
              <:response as |cards|>
                {{#each cards as |card|}}
                  <li
                    class='card'
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                    data-test-cards-grid-item={{removeFileExtension card.url}}
                    data-cards-grid-item={{removeFileExtension card.url}}
                  >
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

    <style scoped>
      .create-new-task-button {
        all: unset;
        cursor: pointer;
      }
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
      }

      .cards {
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-direction: column;
      }
      .card {
        padding: var(--boxel-sp-xxs);
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
      .loading-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        width: 100%;
      }
    </style>
  </template>
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
