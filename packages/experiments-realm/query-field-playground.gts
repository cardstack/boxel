import {
  contains,
  field,
  linksTo,
  linksToMany,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';

import { Friend } from './friend';

const matchingFriendQuery = {
  filter: {
    contains: {
      firstName: '$this.nameFilter',
    },
  },
  sort: [
    {
      by: 'firstName',
      direction: '$this.sortDirection',
    },
  ],
  page: {
    size: '$this.pageSize',
  },
  realm: '$thisRealm',
};

export class QueryFieldPlayground extends CardDef {
  static displayName = 'Query Field Playground';

  @field nameFilter = contains(StringField);
  @field pageSize = contains(NumberField);
  @field sortDirection = contains(
    enumField(StringField, { options: ['asc', 'desc'] }),
  );

  @field matchingFriends = linksToMany(Friend, {
    query: matchingFriendQuery,
  });

  @field featuredFriend = linksTo(Friend, {
    query: matchingFriendQuery,
  });

  static isolated = class Isolated extends Component<typeof this> {
    get filterDisplay() {
      let value = this.args.model.nameFilter;
      if (!value?.length) {
        return '∅ (empty string)';
      }
      return value;
    }

    get directionLabel() {
      let direction = (this.args.model.sortDirection ?? '').toLowerCase();
      return direction === 'desc' ? 'descending' : 'ascending';
    }

    <template>
      <article class='query-playground'>
        <header>
          <h2>Query Field Playground</h2>
          <p>
            This card lives entirely in the experiments realm and exposes two
            query-backed fields:
            <code>matchingFriends</code>
            (linksToMany) and
            <code>featuredFriend</code>
            (linksTo). Update the controls to see how query field relationships
            react without writing any imperative resolver code.
          </p>
        </header>

        <section class='controls'>
          <h3>Controls</h3>
          <div class='control-grid'>
            <fieldset>
              <legend>Name contains</legend>
              <@fields.nameFilter @format='edit' />
              <p class='hint'>
                Matches against
                <code>Friend.firstName</code>
                using the search
                <code>contains</code>
                operator.
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
                to control the query&apos;s
                <code>sort</code>
                clause.
              </p>
            </fieldset>

            <fieldset>
              <legend>Max results</legend>
              <@fields.pageSize @format='edit' />
              <p class='hint'>
                The value feeds
                <code>page.size</code>
                for
                <code>matchingFriends</code>. For
                <code>featuredFriend</code>
                we still set page.size but the runtime forces it to 1.
              </p>
            </fieldset>
          </div>
        </section>

        <section class='summary'>
          <h3>Active query snapshot</h3>
          <ul>
            <li>realm: $thisRealm</li>
            <li>filter: contains(firstName: "{{this.filterDisplay}}")</li>
            <li>sort: firstName {{this.directionLabel}}</li>
            <li>page.size: {{@model.pageSize}}</li>
          </ul>
        </section>

        <section class='results'>
          <div class='result-panel'>
            <h3>
              linksToMany results
              <span class='meta'>({{@model.matchingFriends.length}}
                cards)</span>
            </h3>
            {{#if @fields.matchingFriends.length}}
              <div class='card-grid'>
                {{#each @fields.matchingFriends as |friend index|}}
                  <div class='friend-card'>
                    {{index}}
                    <friend />
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

          <div class='result-panel'>
            <h3>linksTo head result</h3>
            {{#if @fields.featuredFriend}}
              <@fields.featuredFriend />
            {{else}}
              <p class='empty'>No featured friend — add a filter that matches at
                least one record.</p>
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
