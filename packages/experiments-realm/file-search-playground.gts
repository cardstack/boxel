import {
  contains,
  field,
  linksToMany,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';
import { FileDef } from 'https://cardstack.com/base/file-api';

const fileSearchQuery = {
  filter: {
    every: [
      {
        type: {
          module: 'https://cardstack.com/base/file-api',
          name: 'FileDef',
        },
      },
      {
        on: {
          module: 'https://cardstack.com/base/file-api',
          name: 'FileDef',
        },
        contains: {
          name: '$this.nameFilter',
        },
      },
    ],
  },
  sort: [
    {
      by: 'name',
      direction: '$this.sortDirection',
    },
  ],
  page: {
    size: '$this.pageSize',
  },
  realm: '$thisRealm',
};

export class FileSearchPlayground extends CardDef {
  static displayName = 'File Search Playground';

  @field nameFilter = contains(StringField);
  @field pageSize = contains(NumberField);
  @field sortDirection = contains(
    enumField(StringField, { options: ['asc', 'desc'] }),
  );

  @field matchingFiles = linksToMany(FileDef, {
    query: fileSearchQuery,
  });

  static isolated = class Isolated extends Component<typeof this> {
    get filterDisplay() {
      let value = this.args.model.nameFilter;
      if (!value?.length) {
        return '(empty string)';
      }
      return value;
    }

    get directionLabel() {
      let direction = (this.args.model.sortDirection ?? '').toLowerCase();
      return direction === 'desc' ? 'descending' : 'ascending';
    }

    <template>
      <article class='file-search-playground'>
        <header>
          <h2>File Search Playground</h2>
          <p>
            This card exercises query-backed
            <code>linksToMany(FileDef)</code>
            fields. Update the controls to search for files in the current realm.
          </p>
        </header>

        <section class='controls'>
          <h3>Controls</h3>
          <div class='control-grid'>
            <fieldset>
              <legend>Name contains</legend>
              <@fields.nameFilter @format='edit' />
              <p class='hint'>
                Filters files whose
                <code>name</code>
                attribute contains this value.
              </p>
            </fieldset>

            <fieldset>
              <legend>Sort direction</legend>
              <@fields.sortDirection @format='edit' />
              <p class='hint'>
                Enter
                <code>asc</code>
                or
                <code>desc</code>
                to control sort order by file name.
              </p>
            </fieldset>

            <fieldset>
              <legend>Max results</legend>
              <@fields.pageSize @format='edit' />
              <p class='hint'>
                Controls
                <code>page.size</code>
                for the query.
              </p>
            </fieldset>
          </div>
        </section>

        <section class='summary'>
          <h3>Active query snapshot</h3>
          <ul>
            <li>realm: $thisRealm</li>
            <li>filter: type=FileDef, contains(name: "{{this.filterDisplay}}")</li>
            <li>sort: name {{this.directionLabel}}</li>
            <li>page.size: {{@model.pageSize}}</li>
          </ul>
        </section>

        <section class='results'>
          <div class='result-panel'>
            <h3>
              Matching files
              <span class='meta'>({{@model.matchingFiles.length}}
                files)</span>
            </h3>
            {{#if @fields.matchingFiles.length}}
              <div class='file-grid'>
                {{#each @fields.matchingFiles as |File index|}}
                  <div class='file-card'>
                    {{index}}
                    <File />
                  </div>
                {{/each}}
              </div>
            {{else}}
              <p class='empty'>
                Either the query short-circuited (no filter value) or the search
                returned zero results.
              </p>
            {{/if}}
          </div>
        </section>
      </article>

      <style scoped>
        .file-search-playground {
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
        .summary ul {
          background: var(--boxel-700);
          color: var(--boxel-100);
          padding: var(--boxel-sp-lg) var(--boxel-sp-xxl);
          border-radius: var(--boxel-border-radius);
          font-family: var(--boxel-font-monospace);
          user-select: text;
        }
        .results {
          display: grid;
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
        .file-grid {
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
