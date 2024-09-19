import { Component, CardDef } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';

class TaskAppCardIsolated extends Component<typeof TaskAppCard> {
  @tracked isSheetOpen = false;

  get columnNumbers() {
    return [1, 2, 3, 4, 5, 6, 7, 8];
  }

  get taskNumbers() {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
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
        {{#each this.columnNumbers as |columnNumber|}}
          <div class='column'>
            <h3>Column {{columnNumber}}</h3>
            {{#each this.taskNumbers as |taskNumber|}}
              <div class='task-card'>
                <h4>Task {{taskNumber}}</h4>
                <p>This is a longer description for Task
                  {{taskNumber}}
                  to demonstrate scrolling within the column.</p>
              </div>
            {{/each}}
          </div>
        {{/each}}
      </div>
      {{#if this.isSheetOpen}}
        <Sheet @onClose={{this.toggleSheet}}>
          <h2>Sheet Content</h2>
          <p>This is the content of the sheet.</p>
        </Sheet>
      {{/if}}
    </div>
    <style>
      .task-app {
        display: flex;
        flex-direction: column;
        height: 100vh;
        font: var(--boxel-font);
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
        overflow-y: auto;
        padding: var(--boxel-sp);
        border-right: var(--boxel-border);
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
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

class Sheet extends GlimmerComponent<SheetSignature> {
  <template>
    <div class='sheet-overlay' {{on 'click' @onClose}}>
      <div class='sheet-content' {{on 'click' this.stopPropagation}}>
        {{yield}}
      </div>

      <style>
        .sheet-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: flex-end;
        }

        .sheet-content {
          width: 300px;
          height: 100%;
          background-color: var(--boxel-light);
          padding: var(--boxel-sp);
          box-shadow: -2px 0 5px rgba(0, 0, 0, 0.1);
        }
      </style>
      <style>
        .sheet-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: flex-end;
        }

        .sheet-content {
          width: 300px;
          height: 100%;
          background-color: var(--boxel-light);
          padding: var(--boxel-sp);
          box-shadow: -2px 0 5px rgba(0, 0, 0, 0.1);
        }
      </style>
    </div>
  </template>

  stopPropagation = (event: Event) => {
    event.stopPropagation();
  };
}

export class TaskAppCard extends CardDef {
  static isolated = TaskAppCardIsolated;
}
