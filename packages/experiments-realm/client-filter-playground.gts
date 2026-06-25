import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';

import { identifyCard, type getCards } from '@cardstack/runtime-common';

import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import {
  CardDef,
  Component,
  field,
  contains,
  realmURL,
} from 'https://cardstack.com/base/card-api';

// A single item the playground lists, creates, edits, and deletes. The status
// field drives which live query a widget belongs to; priority drives the sort.
export class PlaygroundWidget extends CardDef {
  static displayName = 'Playground Widget';
  @field label = contains(StringField);
  // status is either active or archived
  @field status = contains(StringField);
  @field priority = contains(NumberField);
}

// Demonstrates the client-side Store filtering step (CS-11416): two live,
// query-based searches over the same Store — one for status active, one for
// status archived, each sorted by priority. Creating, editing, or deleting a
// widget reconciles both lists against in-memory Store state immediately,
// before the realm reindexes — so a widget hops between the lists, sorts into
// place, or vanishes the instant you act, with no _federated-search round trip
// (watch the Network tab to confirm).
class Isolated extends Component<typeof ClientFilterPlayground> {
  <template>
    <section class='playground'>
      <header class='intro'>
        <h2>Client-side Store filtering — live demo</h2>
        <p>
          Two live searches share this tab's Store: <b>Active</b>
          (<code>status: active</code>) and <b>Archived</b>
          (<code>status: archived</code>), each sorted by <code>priority</code>.
          Create, archive/activate, re-prioritize, or delete a widget and watch
          both lists self-correct instantly. Open DevTools → Network, filter to
          <code>_federated-search</code>: the lists update with no request at
          the moment you act — the server's reindex catches up a beat later.
        </p>
        <div class='toolbar'>
          <button type='button' {{on 'click' this.addActive}}>
            + Add active widget
          </button>
          <button type='button' {{on 'click' this.addArchived}}>
            + Add archived widget
          </button>
        </div>
      </header>

      <div class='columns'>
        <div class='column'>
          <h3>Active
            <span class='count'>{{this.activeWidgets.length}}</span></h3>
          {{! Render results whenever we have them. A live search re-runs its
          server query in the background after every Store mutation; keying the
          loading state ahead of the list would blank it on each round-trip even
          though the client-side filter already reconciled it in place. Only
          fall back to "Loading…" when there is nothing to show yet. }}
          {{#if this.activeWidgets.length}}
            <ul class='list'>
              {{#each this.activeWidgets as |widget|}}
                <li class='row'>
                  <span class='pri'>p{{widget.priority}}</span>
                  <span class='label'>{{widget.label}}</span>
                  <span class='actions'>
                    <button type='button' {{on 'click' (fn this.bump widget)}}>
                      Bump
                    </button>
                    <button type='button' {{on 'click' (fn this.toggle widget)}}>
                      Archive
                    </button>
                    <button
                      type='button'
                      class='danger'
                      {{on 'click' (fn this.remove widget)}}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              {{/each}}
            </ul>
          {{else if this.activeList.isLoading}}
            <p class='muted'>Loading…</p>
          {{else}}
            <p class='muted'>No active widgets — add one above.</p>
          {{/if}}
        </div>

        <div class='column'>
          <h3>Archived
            <span class='count'>{{this.archivedWidgets.length}}</span></h3>
          {{! See the Active column: render results when present so a background
          live-refresh doesn't blank the list. }}
          {{#if this.archivedWidgets.length}}
            <ul class='list'>
              {{#each this.archivedWidgets as |widget|}}
                <li class='row'>
                  <span class='pri'>p{{widget.priority}}</span>
                  <span class='label'>{{widget.label}}</span>
                  <span class='actions'>
                    <button type='button' {{on 'click' (fn this.bump widget)}}>
                      Bump
                    </button>
                    <button type='button' {{on 'click' (fn this.toggle widget)}}>
                      Activate
                    </button>
                    <button
                      type='button'
                      class='danger'
                      {{on 'click' (fn this.remove widget)}}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              {{/each}}
            </ul>
          {{else if this.archivedList.isLoading}}
            <p class='muted'>Loading…</p>
          {{else}}
            <p class='muted'>No archived widgets.</p>
          {{/if}}
        </div>
      </div>
    </section>

    <style scoped>
      .playground {
        padding: 1.5rem;
        max-width: 60rem;
        margin: 0 auto;
        font:
          14px/1.5 system-ui,
          sans-serif;
      }
      .intro h2 {
        margin: 0 0 0.5rem;
      }
      .intro p {
        margin: 0 0 1rem;
        color: #444;
      }
      code {
        background: #eef;
        padding: 0 0.25rem;
        border-radius: 3px;
      }
      .toolbar {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
      }
      .columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
      }
      .column {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 1rem;
        background: #fafafa;
      }
      .column h3 {
        margin: 0 0 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .count {
        font-size: 0.75rem;
        background: #333;
        color: #fff;
        border-radius: 999px;
        padding: 0.1rem 0.5rem;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: #fff;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        padding: 0.4rem 0.6rem;
      }
      .pri {
        font-variant-numeric: tabular-nums;
        color: #888;
        min-width: 2.25rem;
      }
      .label {
        flex: 1;
        font-weight: 600;
      }
      .actions {
        display: flex;
        gap: 0.35rem;
      }
      button {
        font: inherit;
        padding: 0.2rem 0.55rem;
        border: 1px solid #bbb;
        border-radius: 5px;
        background: #fff;
        cursor: pointer;
      }
      button:hover {
        background: #f0f0f0;
      }
      button.danger {
        border-color: #e0b4b4;
        color: #a33;
      }
      .muted {
        color: #999;
        font-style: italic;
      }
    </style>
  </template>

  // `@context.getCards` is the default (CardDef) signature; the widget getters
  // below narrow `.instances` to PlaygroundWidget.
  private activeList: ReturnType<getCards> | undefined;
  private archivedList: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.activeList = this.args.context?.getCards(
      this,
      () => this.queryFor('active'),
      () => this.realms,
      { isLive: true },
    );
    this.archivedList = this.args.context?.getCards(
      this,
      () => this.queryFor('archived'),
      () => this.realms,
      { isLive: true },
    );
  }

  private get realms(): string[] | undefined {
    let url = this.args.model[realmURL];
    return url ? [url.href] : undefined;
  }

  private queryFor(status: 'active' | 'archived') {
    let ref = identifyCard(PlaygroundWidget);
    if (!ref) {
      return undefined;
    }
    return {
      filter: { on: ref, eq: { status } },
      sort: [{ on: ref, by: 'priority', direction: 'asc' as const }],
    };
  }

  private get activeWidgets(): PlaygroundWidget[] {
    return (this.activeList?.instances ?? []) as PlaygroundWidget[];
  }

  private get archivedWidgets(): PlaygroundWidget[] {
    return (this.archivedList?.instances ?? []) as PlaygroundWidget[];
  }

  private get nextPriority(): number {
    let all = [...this.activeWidgets, ...this.archivedWidgets];
    return all.reduce((max, w) => Math.max(max, w.priority ?? 0), 0) + 1;
  }

  private addWidget(status: 'active' | 'archived') {
    let store = this.args.context?.store;
    let ref = identifyCard(PlaygroundWidget);
    let realm = this.args.model[realmURL]?.href;
    if (!store || !ref) {
      return;
    }
    let priority = this.nextPriority;
    store.create(
      {
        data: {
          type: 'card',
          attributes: { label: `Widget ${priority}`, status, priority },
          meta: { adoptsFrom: ref },
        },
      },
      realm ? { realm } : undefined,
    );
  }

  @action private addActive() {
    this.addWidget('active');
  }

  @action private addArchived() {
    this.addWidget('archived');
  }

  // Edit through store.patch rather than assigning the field inline: patch
  // applies the change asynchronously (it awaits a fresh read first), so the
  // write lands outside the click's autotracking frame — and it mirrors how
  // cards are actually edited. The Store mutation then re-derives both live
  // lists with no server round trip.
  @action private toggle(widget: PlaygroundWidget) {
    let store = this.args.context?.store;
    if (!store || !widget.id) {
      return;
    }
    store.patch(widget.id, {
      attributes: { status: widget.status === 'active' ? 'archived' : 'active' },
    });
  }

  @action private bump(widget: PlaygroundWidget) {
    let store = this.args.context?.store;
    if (!store || !widget.id) {
      return;
    }
    store.patch(widget.id, {
      attributes: { priority: (widget.priority ?? 0) + 1 },
    });
  }

  @action private remove(widget: PlaygroundWidget) {
    if (widget.id) {
      this.args.context?.store?.delete(widget.id);
    }
  }
}

export class ClientFilterPlayground extends CardDef {
  static displayName = 'Client Filter Playground';
  static isolated = Isolated;
}
