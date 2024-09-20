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
import { Query } from '@cardstack/runtime-common';

class TaskAppCardIsolated extends Component<typeof TaskAppCard> {
  @tracked isSheetOpen = false;

  get columnNumbers() {
    return [1, 2, 3, 4, 5, 6, 7, 8];
  }

  get taskNumbers() {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }
  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get assignedTaskCodeRef() {
    return {
      module: 'http://localhost:4201/experiments/productivity/task',
      name: 'AssignedTask',
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

  <template>
    <div class='task-app'>
      <div class='filter-section'>
        <div>Filter Section</div>
        <button class='sheet-toggle' {{on 'click' this.toggleSheet}}>
          {{if this.isSheetOpen 'Close' 'Open'}}
          Sheet
        </button>
      </div>
      <div class='columns-container'>
        <div class='column'>
          <div class='column-title'>Backlog </div>
          <div class='column-data'>
            <ColumnQuery
              @context={{@context}}
              @realms={{this.realms}}
              @query={{this.backlogQuery}}
            />
          </div>
        </div>
        <div class='column'>
          <div class='column-title'>Next Sprint</div>
          <div class='column-data'>
            <ColumnQuery
              @context={{@context}}
              @realms={{this.realms}}
              @query={{this.nextSprintQuery}}
            />
          </div>
        </div>
        // ... Add more columns as needed ...
      </div>
      <Sheet @onClose={{this.toggleSheet}} @isOpen={{this.isSheetOpen}}>
        <h2>Sheet Content</h2>
        <p>This is the content of the sheet.</p>
      </Sheet>
    </div>
    <style>
      .task-app {
        display: flex;
        position: relative;
        flex-direction: column;
        height: 100vh;
        font: var(--boxel-font);
        overflow: hidden; /* Add this to prevent scrolling when sheet is open */
      }

      .filter-section {
        flex-shrink: 0;
        padding: var(--boxel-sp);
        border-bottom: var(--boxel-border);
        display: flex;
        justify-content: space-between;
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
      }

      .column-data {
        flex-grow: 1;
        overflow-y: auto;
        padding: var(--boxel-sp);
      }

      .task-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        margin-bottom: var(--boxel-sp);
        background-color: var(--boxel-light);
      }

      h3 {
        position: sticky;
        top: 0;
        background-color: var(--boxel-light);
        margin: 0 0 var(--boxel-sp) 0;
        padding: var(--boxel-sp-xs) 0;
        font: var(--boxel-font-lg);
      }

      h4 {
        font: var(--boxel-font);
        margin: 0 0 var(--boxel-sp-sm) 0;
      }

      p {
        font: var(--boxel-font-sm);
        margin: 0;
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
  static displayName = 'Task App Card';
  static isolated = TaskAppCardIsolated;
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}

export interface ColumnQuerySignature {
  Args: {
    context: CardContext | undefined;
    realms: string[];
    query: Query;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

class ColumnQuery extends GlimmerComponent<ColumnQuerySignature> {
  <template>
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

          <:loading>
            Loading...
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
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
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
  </template>
}
