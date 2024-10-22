import {
  Component,
  realmURL,
  CardContext,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { getCard } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { CardContainer } from '@cardstack/boxel-ui/components';
import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
  CircleSpinner,
} from '@cardstack/boxel-ui/components';
import { DropdownArrowFilled, IconPlus } from '@cardstack/boxel-ui/icons';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { fn, array, hash } from '@ember/helper';
import { action } from '@ember/object';
import {
  LooseSingleCardDocument,
  ResolvedCodeRef,
  type Query,
} from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
import { AppCard } from './app-card';
import {
  DndKanbanBoard,
  DndCard as Card,
  DndColumn as Column,
} from '@cardstack/boxel-ui/components';

interface ColumnData {
  status: {
    label: string;
    index: number;
  };
  query: Query;
  codeRef: ResolvedCodeRef;
}

interface AppTaskCardIsolatedArgs {
  context: CardContext;
}

class AppTaskCardIsolated extends Component<
  typeof AppTaskCard | AppTaskCardIsolatedArgs
> {
  @tracked isSheetOpen = false;
  @tracked selectedFilter = '';
  @tracked taskDescription = '';
  @tracked triggeredColumnIndex: number | null = null;
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

  columnData: any[] = [
    {
      status: {
        label: 'Backlog',
        index: 0,
      },
      query: this.getQueryForStatus('Backlog'),
    },
    {
      status: {
        label: 'Next Sprint',
        index: 1,
      },
      query: this.getQueryForStatus('Next Sprint'),
    },
    {
      status: {
        label: 'Current Sprint',
        index: 2,
      },
      query: this.getQueryForStatus('Current Sprint'),
    },
    {
      status: {
        label: 'In Progress',
        index: 3,
      },
      query: this.getQueryForStatus('In Progress'),
    },
    {
      status: {
        label: 'In Review',
        index: 4,
      },
      query: this.getQueryForStatus('In Review'),
    },
    {
      status: {
        label: 'Staged',
        index: 5,
      },
      query: this.getQueryForStatus('Staged'),
    },
    {
      status: {
        label: 'Shipped',
        index: 6,
      },
      query: this.getQueryForStatus('Shipped'),
    },
  ].map((column): any => {
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

  columns: any[] = this.columnData.map((column) => {
    return new Column(column.status.label, column.cards, column);
  });

  @action
  updateColumnCards(columnIndex: any, cards: any[]) {
    const dndCards = cards.map(
      (card) =>
        new Card({
          ...card,
        }),
    );
    this.columns[columnIndex].cards = dndCards;
  }

  get realmURL() {
    return this.args.model[realmURL];
  }

  @action createNewTask(column: any) {
    this._createNewTask.perform(column.cardAPI);
    this.triggeredColumnIndex = column.cardAPI.status.index;
  }

  _createNewTask = restartableTask(async (column: any, columnIndex: number) => {
    if (this.realmURL === undefined) {
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

      console.log(
        cardRef,
        new URL(cardRef.module),
        this.args.model[realmURL],
        doc,
      );

      await this.args.context?.actions?.createCard?.(
        cardRef,
        new URL(cardRef.module),
        {
          realmURL: this.realmURL,
          doc,
        },
      );

      console.log('yes');
    } catch (error) {
      console.error('Error creating card:', error);
    } finally {
      this.triggeredColumnIndex = null;
    }
  });

  @action async onMoveCardMutation(draggedCard: any, newColumn: any) {
    try {
      let cardUrl = new URL(draggedCard.data.url);
      console.log('Attempting to fetch card at URL:', cardUrl);

      let resource = getCard(cardUrl);
      await resource.loaded;

      const cardInstance: any = resource.card;

      if (cardInstance) {
        console.log('Card found:', cardInstance);
        cardInstance.status.index = newColumn.cardAPI.status.index;
        cardInstance.status.label = newColumn.cardAPI.status.label;

        console.log('Updating card status to:', cardInstance);

        await this.customSaveCard(cardInstance);
      } else {
        throw new Error(
          `Could not find card ${draggedCard.data.url} in the system`,
        );
      }
    } catch (error) {
      console.error('Error updating card status:', error);
    }
  }

  // 自定义保存方法
  async customSaveCard(cardInstance: any) {
    const publicAPI = this.args.context?.actions;
    if (!publicAPI?.saveCard) {
      throw new Error('saveCard action not available');
    }

    try {
      await publicAPI.saveCard(cardInstance, false);
      console.log('Card saved successfully');
    } catch (saveError) {
      console.error('Error in saveCard:', saveError);
      if (saveError instanceof Error) {
        console.error(
          'SaveCard error details:',
          saveError.message,
          saveError.stack,
        );
      }
      throw saveError;
    }
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
        {{! this is for update the column data with prerendered }}
        {{#each this.columns as |column columnIndex|}}
          {{#let
            (component @context.prerenderedCardSearchComponent)
            as |PrerenderedCardSearch|
          }}
            <PrerenderedCardSearch
              @query={{column.cardAPI.query}}
              @format='fitted'
              @realms={{this.realms}}
            >
              <:loading>
                loading
              </:loading>
              <:response as |cards|>
                {{this.updateColumnCards columnIndex cards}}
              </:response>
            </PrerenderedCardSearch>
          {{/let}}
        {{/each}}

        <DndKanbanBoard
          @columns={{this.columns}}
          @onMoveCard={{this.onMoveCardMutation}}
        >
          {{! this is the udpated columns with cardAPI Data, modifier is only work after prerendered API return data }}
          <:card as |card column actions|>
            <CardContainer
              {{@context.cardComponentModifier
                cardId=card.data.url
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
              data-test-cards-grid-item={{removeFileExtension card.data.url}}
              data-cards-grid-item={{removeFileExtension card.data.url}}
            >
              {{card.component}}
            </CardContainer>
          </:card>
        </DndKanbanBoard>

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
      .custom-kanban-layout {
        display: flex;
        gap: 1rem;
        padding: 1rem;
      }
      .custom-column {
        flex: 1;
        min-width: 250px;
        background-color: var(--dnd-kanban-header-bg, #f0f0f0);
        border-radius: 8px;
        padding: 1rem;
      }
      .column-title {
        margin-bottom: 1rem;
        font-size: 1.2rem;
        font-weight: bold;
      }
      .create-new-task-button {
        all: unset;
        cursor: pointer;
      }
      .custom-card {
        background-color: #ffffff;

        margin-bottom: 0.5rem;
        transition: all 0.3s ease;
      }
      .custom-card.is-on-target {
        transform: scale(0.95);
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
      }
      .custom-card.is-drop-target {
        background-color: #f0f0f0;
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

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
