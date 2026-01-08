import {
  contains,
  field,
  linksTo,
  linksToMany,
  CardDef,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Friend } from './friend';

class NestedQueryFields extends FieldDef {
  @field cardTitle = contains(StringField);

  // These query-backed relationships live inside a FieldDef, mirroring
  // the nesting pattern we exercise in host tests.
  @field favorite = linksTo(() => Friend, {
    query: {
      filter: {
        contains: { firstName: '$this.cardTitle' },
      },
    },
  });

  @field matches = linksToMany(() => Friend, {
    query: {
      filter: {
        contains: { firstName: '$this.cardTitle' },
      },
      page: { size: 10, number: 0 },
    },
  });
}

export class NestedQueryFieldPlayground extends CardDef {
  static displayName = 'Nested Query Field Playground';

  // Wrap the query-backed relationships inside a FieldDef to verify the
  // nested path gets hydrated correctly.
  @field queries = contains(NestedQueryFields);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='query-playground'>
        <header>
          <h2>Nested Query Field Playground</h2>
          <p>
            Demonstrates query-backed relationships declared within a
            <code>FieldDef</code>. Edit the nested
            <code>title</code>
            and watch both
            <code>favorite</code>
            (linksTo) and
            <code>matches</code>
            (linksToMany) resolve without writing custom loader code.
          </p>
        </header>

        <section class='controls'>
          <h3>Controls</h3>
          <div class='control-grid'>
            <fieldset>
              <legend>Nested title (used as filter)</legend>
              <@fields.queries.cardTitle @format='edit' />
              <p class='hint'>
                Resolves to
                <code>contains.firstName</code>
                inside both nested query fields. Leave empty to short-circuit
                the search.
              </p>
            </fieldset>
          </div>
        </section>

        <section class='results'>
          <div class='result-panel'>
            <h3>Nested linksTo result</h3>
            {{#if @model.queries.favorite}}
              <@fields.queries.favorite />
            {{else}}
              <p class='empty'>
                No favorite — set a title that matches a Friend&apos;s
                <code>firstName</code>.
              </p>
            {{/if}}
          </div>

          <div class='result-panel'>
            <h3>
              Nested linksToMany results
              <span class='meta'>
                ({{@model.queries.matches.length}}
                cards)
              </span>
            </h3>
            {{#if @fields.queries.matches.length}}
              <div class='card-grid'>
                {{#each @fields.queries.matches as |Friend index|}}
                  <div class='friend-card'>
                    {{index}}
                    <Friend />
                  </div>
                {{/each}}
              </div>
            {{else}}
              <p class='empty'>
                Either the query short-circuited (no title) or no results were
                returned.
              </p>
            {{/if}}
          </div>
        </section>
      </article>

      <style scoped>
        .query-playground {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
        }
        header p {
          margin: var(--boxel-sp-sm) 0 0;
          color: var(--boxel-700);
        }
        .controls {
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp-lg);
          background: var(--boxel-50);
        }
        .control-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: var(--boxel-sp);
        }
        fieldset {
          border: 1px solid var(--boxel-200);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius);
          background: white;
        }
        legend {
          font-weight: 600;
        }
        .hint {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: var(--boxel-font-xs);
          color: var(--boxel-600);
        }
        .results {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: var(--boxel-sp-lg);
        }
        .result-panel {
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp-lg);
          background: white;
        }
        .result-panel h3 {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .result-panel .meta {
          font-size: var(--boxel-font-sm);
          color: var(--boxel-600);
        }
        .card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: var(--boxel-sp);
        }
        .empty {
          color: var(--boxel-600);
          margin: var(--boxel-sp) 0 0;
        }
      </style>
    </template>
  };
}
