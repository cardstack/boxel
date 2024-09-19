import { Component, CardDef } from 'https://cardstack.com/base/card-api';

class TaskAppCardIsolated extends Component<typeof TaskAppCard> {
  get columnNumbers() {
    return [1, 2, 3, 4, 5, 6, 7, 8];
  }

  get taskNumbers() {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  <template>
    <div class='task-app'>
      <div class='filter-section'>
        <!-- Placeholder for filter section -->
        <div>Filter Section</div>
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
}

export class TaskAppCard extends CardDef {
  static isolated = TaskAppCardIsolated;
}
