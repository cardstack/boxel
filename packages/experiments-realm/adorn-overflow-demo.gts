import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class ProjectInitiativeTask extends CardDef {
  static displayName = 'Cross-Functional Strategic Initiative Planning Task';
  @field title = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='task' data-test-task-card>
        <@fields.title />
      </div>
      <style scoped>
        .task {
          padding: var(--boxel-sp-sm);
          font: 600 var(--boxel-font-sm);
          color: var(--boxel-700);
        }
      </style>
    </template>
  };
}

class AdornOverflowDemoIsolated extends Component<typeof AdornOverflowDemo> {
  <template>
    <div class='board'>
      <header class='explainer'>
        <h2>Adorn hover-label overflow demo</h2>
        <p>
          The Adorn type-label tab anchors above the card's top-left corner and
          grows rightward until its right edge hits the card's top-right corner
          radius. Past that point it pins the right edge to the corner-radius
          point and lets the extra width spill off the card's left edge.
        </p>
        <p>
          That spill assumes there's room to the left. A narrow kanban column
          with
          <code>overflow: hidden</code>
          (typical for vertically-scrolling columns) clips the leftward growth
          at the column boundary. Hover any task in the leftmost column to see
          the type-name truncate before it's fully readable, even though the
          card itself is rendered correctly.
        </p>
      </header>
      <div class='columns'>
        <div class='column'>
          <div class='column-header'>Backlog</div>
          <div class='column-stack'>
            <@fields.backlog />
          </div>
        </div>
        <div class='column'>
          <div class='column-header'>In Progress</div>
          <div class='column-stack'>
            <@fields.inProgress />
          </div>
        </div>
        <div class='column'>
          <div class='column-header'>Done</div>
          <div class='column-stack'>
            <@fields.done />
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .board {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
      }
      .explainer {
        max-width: 720px;
      }
      .explainer h2 {
        margin: 0 0 var(--boxel-sp-sm);
        font: 700 var(--boxel-font-lg);
      }
      .explainer p {
        margin: 0 0 var(--boxel-sp-sm);
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
      }
      .explainer code {
        background: var(--boxel-200);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.9em;
      }
      .columns {
        display: grid;
        grid-template-columns: repeat(3, 220px);
        gap: var(--boxel-sp);
        align-items: start;
      }
      .column {
        background: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
        /* The clip is what reproduces the bug: the leftward overflow of the
           Adorn label has nowhere to go and is cut off at the column edge. */
        overflow: hidden;
      }
      .column-header {
        padding: var(--boxel-sp-sm);
        font: 700 var(--boxel-font-sm);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--boxel-700);
        border-bottom: 1px solid var(--boxel-200);
      }
      .column-stack {
        padding: var(--boxel-sp-xxs);
        display: grid;
        gap: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

export class AdornOverflowDemo extends CardDef {
  static displayName = 'Adorn Overflow Demo';

  @field backlog = linksToMany(ProjectInitiativeTask, { searchable: true });
  @field inProgress = linksToMany(ProjectInitiativeTask, { searchable: true });
  @field done = linksToMany(ProjectInitiativeTask, { searchable: true });

  static isolated = AdornOverflowDemoIsolated;
}
