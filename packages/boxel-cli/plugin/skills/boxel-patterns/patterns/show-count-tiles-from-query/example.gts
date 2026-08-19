// Pattern example: query metadata count tiles.
import {
  CardDef,
  Component,
  contains,
  field,
  type CardContext,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type Query,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import { optional } from '@cardstack/boxel-ui/helpers';

// @ts-expect-error import.meta is host-supported in Boxel realm modules.
const here: string = import.meta.url;

interface CountTileSignature {
  Args: {
    context?: CardContext;
    query: Query;
    realms: string[];
    label: string;
    hint?: string;
    tone?: 'neutral' | 'warning' | 'danger';
    onActivate?: () => void;
  };
}

class CountTile extends GlimmerComponent<CountTileSignature> {
  get tone() {
    return this.args.tone ?? 'neutral';
  }

  // Fold the legacy Query into a search-entry query: attach the realms
  // and pin the 'head' format (only one row is transferred anyway — the
  // count comes from results.meta.page.total, not the entries).
  get searchQuery(): SearchEntryWireQuery {
    let q = searchEntryWireQueryFromQuery(this.args.query);
    return {
      ...q,
      realms: this.args.realms,
      filter: {
        ...q.filter,
        eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'head' } } },
      },
    };
  }

  <template>
    <@context.searchResultsComponent
      @query={{this.searchQuery}}
      @mode='none'
      as |results|
    >
      {{#if results.isLoading}}
        <button class='count-tile loading {{this.tone}}' type='button'>
          <span class='value'>...</span>
          <span class='label'>{{@label}}</span>
        </button>
      {{else}}
        <button
          class='count-tile {{this.tone}}'
          type='button'
          {{on 'click' (optional @onActivate)}}
        >
          <span class='value'>{{results.meta.page.total}}</span>
          <span class='label'>{{@label}}</span>
          {{#if @hint}}
            <span class='hint'>{{@hint}}</span>
          {{/if}}
        </button>
      {{/if}}
    </@context.searchResultsComponent>

    <style scoped>
      .count-tile {
        width: 100%;
        min-height: 88px;
        display: grid;
        align-content: center;
        gap: 0.25rem;
        padding: 0.9rem;
        border: 1px solid var(--border, #d7dee8);
        border-radius: 8px;
        background: var(--card, #ffffff);
        color: var(--foreground, #17202a);
        text-align: left;
        cursor: pointer;
      }

      .count-tile:hover {
        border-color: var(--primary, #3563e9);
      }

      .value {
        font-size: 1.7rem;
        line-height: 1;
        font-weight: 800;
      }

      .label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, #677489);
      }

      .hint {
        font-size: 0.78rem;
        color: var(--muted-foreground, #677489);
      }

      .warning {
        border-color: #f5c451;
        background: #fff9e8;
      }

      .danger {
        border-color: #ef8585;
        background: #fff1f1;
      }

      .loading {
        background: linear-gradient(90deg, #f4f6f8 25%, #e9eef4 50%, #f4f6f8 75%);
        background-size: 200% 100%;
        animation: shimmer 1.4s infinite ease-in-out;
      }

      @keyframes shimmer {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
    </style>
  </template>
}

export class DashboardOverview extends CardDef {
  static displayName = 'Dashboard Overview';
  static prefersWideFormat = true;

  @field heading = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: DashboardOverview) {
      return this.heading ?? 'Dashboard Overview';
    },
  });

  static isolated = class Isolated extends Component<typeof DashboardOverview> {
    @tracked activeSection = 'all';

    get realmHrefs() {
      const currentRealm = this.args.model[realmURL];
      return currentRealm ? [currentRealm.href] : [];
    }

    countQuery(cardPath: string, exportName: string, filters: any[] = []): Query {
      const ref = codeRef(here, cardPath, exportName);
      return {
        filter:
          filters.length > 0
            ? { every: [{ type: ref }, ...filters] }
            : { type: ref },
        page: { size: 1, number: 0 },
      };
    }

    get allTasksQuery(): Query {
      return this.countQuery('./task', 'Task');
    }

    get openTasksQuery(): Query {
      const taskRef = codeRef(here, './task', 'Task');
      return this.countQuery('./task', 'Task', [
        { on: taskRef, eq: { status: 'Open' } },
      ]);
    }

    get blockedTasksQuery(): Query {
      const taskRef = codeRef(here, './task', 'Task');
      return this.countQuery('./task', 'Task', [
        { on: taskRef, eq: { status: 'Blocked' } },
      ]);
    }

    showAll = () => {
      this.activeSection = 'all';
    };

    showOpen = () => {
      this.activeSection = 'open';
    };

    showBlocked = () => {
      this.activeSection = 'blocked';
    };

    <template>
      <section class='dashboard'>
        <header>
          <p>Overview</p>
          <h1>{{if @model.heading @model.heading 'Operations'}}</h1>
        </header>

        <div class='tiles'>
          <CountTile
            @context={{@context}}
            @query={{this.allTasksQuery}}
            @realms={{this.realmHrefs}}
            @label='All Tasks'
            @hint='Browse everything'
            @onActivate={{this.showAll}}
          />

          <CountTile
            @context={{@context}}
            @query={{this.openTasksQuery}}
            @realms={{this.realmHrefs}}
            @label='Open'
            @hint='Needs action'
            @tone='warning'
            @onActivate={{this.showOpen}}
          />

          <CountTile
            @context={{@context}}
            @query={{this.blockedTasksQuery}}
            @realms={{this.realmHrefs}}
            @label='Blocked'
            @hint='Escalate'
            @tone='danger'
            @onActivate={{this.showBlocked}}
          />
        </div>

        <p class='active'>Current section: {{this.activeSection}}</p>
      </section>

      <style scoped>
        .dashboard {
          min-height: 100%;
          display: grid;
          gap: 1rem;
          align-content: start;
          padding: 1.25rem;
          background: var(--background, #f7f9fc);
          color: var(--foreground, #17202a);
        }

        header {
          display: grid;
          gap: 0.15rem;
        }

        h1,
        p {
          margin: 0;
        }

        header p,
        .active {
          color: var(--muted-foreground, #677489);
          font-size: 0.8rem;
        }

        h1 {
          font-size: 1.6rem;
        }

        .tiles {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 0.75rem;
        }
      </style>
    </template>
  };
}
