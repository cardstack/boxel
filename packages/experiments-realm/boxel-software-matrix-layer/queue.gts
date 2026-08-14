import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
  StringField,
  realmURL,
} from '@cardstack/base/card-api';
import {
  type Query,
  rri,
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import InboxIcon from '@cardstack/boxel-icons/inbox';

// The Ticket CodeRef, built from the REALM URL at read time.
//
// Two things it is deliberately not. Not an `import { Ticket }`: `ticket.gts`
// imports this module, so importing back closes a cycle, and a cycle in a card
// module fails as `Class extends value undefined` at index time across every
// instance in the realm. Not a `_cardType: 'Ticket'` string either: that is an
// EXACT display-name match and silently drops Incident and ServiceRequest, the
// two subclasses this mostly holds.
//
// It was `import.meta.url` until `import.meta` turned out to be unavailable
// under the checker's CommonJS inference (TS1470). The realm URL is already on
// the model, it is what `service-desk.gts` uses to create a ticket, and it
// makes the ref a per-instance value instead of a module-level constant — so
// the same module is correct in whichever realm it is copied into.
function ticketRefIn(realm: string | undefined) {
  return realm
    ? { module: rri(new URL('./ticket', realm).href), name: 'Ticket' }
    : undefined;
}

import {
  SupportAgent,
  AgentTierField,
  AGENT_TIER_LABELS,
} from './support-agent';
import { SlaPolicy } from './sla-policy';
import { StatePill } from './components/state-pill';
import { liveCount } from './utils/index';

/**
 * A basket of work with a team attached.
 *
 * The tickets in a queue are found by a live query, never held as a list of
 * links. A maintained list drifts the moment a ticket is escalated, merged or
 * closed, and it drifts silently — the queue keeps showing work that is not
 * there and hiding work that is.
 */
export class Queue extends CardDef {
  static displayName = 'Queue';
  static icon = InboxIcon;

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field tier = contains(AgentTierField);
  @field agents = linksToMany(() => SupportAgent);
  @field defaultPolicy = linksTo(() => SlaPolicy);

  @field title = contains(StringField, {
    computeVia: function (this: Queue) {
      return this.name?.trim() || 'Untitled queue';
    },
  });

  @field tierLabel = contains(StringField, {
    computeVia: function (this: Queue) {
      return AGENT_TIER_LABELS[this.tier ?? ''] ?? this.tier ?? '';
    },
  });

  // liveCount, not `agents.length`: deleting an agent leaves the link slot in
  // place reading as undefined, so a raw length reports people who are gone.
  @field agentCount = contains(StringField, {
    computeVia: function (this: Queue) {
      let n = liveCount(this.agents);
      return n === 1 ? '1 agent' : `${n} agents`;
    },
  });

  // Same reason as SlaPolicy: fitted cannot walk this link, and touching it
  // there throws.
  @field policyName = contains(StringField, {
    computeVia: function (this: Queue) {
      return this.defaultPolicy?.title ?? '';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get realms(): string[] {
      let url = this.args.model?.[realmURL];
      return url ? [url.href] : [];
    }

    // One query feeds every view of this queue. Two queries is how a board and
    // a table start disagreeing about how many tickets are open.
    get openQuery(): Query | undefined {
      let ticketRef = ticketRefIn(this.realms[0]);
      if (!ticketRef) {
        return undefined;
      }
      return {
        // ONE anchored node, not a bare type node beside an unanchored `eq`.
        //
        // `{ every: [{ type: ref }, { eq: {...} }] }` translates to a wire
        // node carrying only `item.on` next to an `eq` that names no type at
        // all, and the result is empty — which is how this list read "nothing
        // waiting" while the queue counted tickets three feet to the left.
        // `on` both anchors the field paths and constrains the type, and it
        // is adoption-aware, so Incident and ServiceRequest are included
        // where a `_cardType` display-name match dropped them.
        filter: {
          on: ticketRef,
          eq: { queueName: this.args.model?.title ?? '\u2014' },
        },
        // Nearest breach first. Created-date order only equals urgency order
        // when every ticket carries the same promise, which is never.
        //
        // `on` is not optional here either: a sort without it returns an
        // empty result rather than an unsorted one.
        sort: [{ by: 'slaDeadline', on: ticketRef, direction: 'asc' }],
      };
    }

    get wireQuery(): SearchEntryWireQuery | undefined {
      let query = this.openQuery;
      if (!this.realms.length || !query) {
        return undefined;
      }
      return {
        ...searchEntryWireQueryFromQuery(query),
        realms: this.realms,
      };
    }

    open = (id: string, _event?: Event) => {
      if (id) {
        (this.args as any).viewCard?.(new URL(id));
      }
    };

    <template>
      <article class='iso'>
        <header class='iso-head'>
          <div class='iso-id'>
            <h1>{{@model.title}}</h1>
            {{#if @model.description}}
              <p class='iso-sub'>{{@model.description}}</p>
            {{/if}}
          </div>
          {{#if @model.tier}}
            <StatePill @label={{@model.tierLabel}} @hue='teal' />
          {{/if}}
          <span class='iso-agents'>{{@model.agentCount}}</span>
        </header>

        <div class='queue-bar'>
          <span class='queue-sort'>Sorted by nearest breach</span>
        </div>

        {{#if @context.searchResultsComponent}}
          {{#let (component @context.searchResultsComponent) as |Search|}}
            <Search @query={{this.wireQuery}} @mode='none' as |results|>
              <ul class='q-grid'>
                {{#each results.entries key='id' as |entry|}}
                  <li class='q-tile'>
                    <entry.component />
                  </li>
                {{else}}
                  {{#if results.isLoading}}
                    <li class='q-note' role='status'>Loading…</li>
                  {{else}}
                    {{! An empty queue is GOOD NEWS and has to look like it.
                        This said "No results were found" — the base CardList's
                        generic string, which reads as a failed search on a
                        surface where nothing was searched for. }}
                    <li class='q-clear'>
                      <b>Nothing waiting in this queue</b>
                      <p>Everything routed here has been answered. New work
                        lands at the top of this list.</p>
                    </li>
                  {{/if}}
                {{/each}}
              </ul>
            </Search>
          {{/let}}
        {{else}}
          <p class='empty'>Open this queue in the console to see its live list.</p>
        {{/if}}

        <section class='team'>
          <h2>Who works this queue</h2>
          {{#if @model.agents.length}}
            <ul class='team-list'>
              {{#each @fields.agents as |Agent|}}
                <li><Agent @format='atom' /></li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>Nobody is assigned to this queue yet. Tickets
              routed here will sit unclaimed — and their clocks keep running.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .iso {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          min-height: 100%;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .iso-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          flex-wrap: wrap;
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .iso-id {
          flex: 1;
          min-width: 0;
        }
        .iso-head h1 {
          margin: 0;
          font-family: var(--font-heading, inherit);
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .iso-sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
        .iso-agents {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .queue-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }
        .queue-sort {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }

        /* The tile grid. This markup shipped with no CSS at all, which is why
           the empty state rendered as a bare bullet in the document flow —
           a state message indistinguishable from a line of data. */
        .q-grid {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
          gap: var(--boxel-sp-xs);
        }
        .q-tile {
          min-width: 0;
          height: 6.5rem;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm, 6px);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
        }
        /* A state message spans the whole grid and sits on its own ground, so
           it reads as "the list is telling you something" rather than as a
           row. Dashed, not solid: nothing is here, and nothing is wrong. */
        .q-note,
        .q-clear {
          grid-column: 1 / -1;
          padding: var(--boxel-sp) var(--boxel-sp-sm);
          border: 1px dashed var(--border, var(--boxel-300));
          border-radius: var(--boxel-border-radius-sm, 6px);
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
        /* An empty queue is good news, so the accent is the success hue —
           diluted as a ground and a stripe, never asked to carry the text. */
        .q-clear {
          border-inline-start: 3px solid
            color-mix(in oklch, var(--boxel-success) 60%, transparent);
          background: color-mix(
            in oklch,
            var(--boxel-success) 7%,
            var(--muted, var(--boxel-100))
          );
        }
        .q-clear b {
          display: block;
          color: var(--foreground, var(--boxel-dark));
          font-size: var(--boxel-font-size-sm);
        }
        .q-clear p {
          margin: 2px 0 0;
          font-size: var(--boxel-font-size-xs);
        }
        .team h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.625rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .team-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .note,
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          max-width: 62ch;
          line-height: 1.6;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='emb'>
        <span class='emb-name'>{{@model.title}}</span>
        <span class='emb-meta'>{{@model.tierLabel}}
          ·
          {{@model.agentCount}}</span>
      </div>
      <style scoped>
        .emb {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .emb-name {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
        }
        .emb-meta {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.title}}
        {{#if @model.tier}}<span class='atom-t'>{{@model.tier}}</span>{{/if}}
      </span>
      <style scoped>
        .atom {
          display: inline-flex;
          gap: 0.3rem;
          align-items: baseline;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .atom-t {
          font-size: 0.625rem;
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <header class='r-head'>
          <h3 class='title'>{{@model.title}}</h3>
          <span class='badge'>{{@model.tier}}</span>
        </header>
        <div class='r-body'>
          <span class='line'>{{@model.agentCount}}</span>
          <span class='line line-2'>{{@model.description}}</span>
          <p class='blurb'>{{@model.description}}</p>
          <span class='tail'>{{@model.policyName}}</span>
        </div>
        <footer class='r-meta'>{{@model.tierLabel}}</footer>
      </article>
      <style scoped>
        /* Same skeleton as ticket.gts: one `.fit` grid, no container declared
           here (the host provides `fitted-card`), one continuous type scale,
           and tiers that ADD a row rather than un-crop one. */
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 2px;
          padding: 7px 9px;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --type-base: clamp(9.5px, 2.7cqi, 12px);
          --type-title: max(11px, calc(var(--type-base) * 1.25));
        }
        .fit > * {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }
        .title {
          flex: 1;
          min-width: 0;
          margin: 0;
          font-size: var(--type-title);
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .badge {
          flex: none;
          margin-left: auto;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .r-body {
          grid-area: body;
          display: none;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .line {
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .blurb {
          display: none;
          margin: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tail {
          display: none;
          margin-top: auto;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .r-meta {
          grid-area: meta;
          display: none;
          align-items: center;
          gap: 6px;
          min-width: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 50px) {
          .r-meta {
            display: flex;
          }
        }
        @container fitted-card (height > 50px) and (height <= 105px) {
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 80px) {
          .r-body {
            display: flex;
          }
        }
        @container fitted-card (height > 160px) {
          .blurb {
            display: -webkit-box;
          }
        }
        @container fitted-card (height > 240px) {
          .blurb {
            -webkit-line-clamp: 4;
          }
          .tail {
            display: block;
          }
        }
        @container fitted-card (width > 300px) and (height <= 130px) {
          .fit {
            grid-template-columns: minmax(200px, 1fr) auto;
            grid-template-areas: 'head meta' 'body meta';
            align-items: center;
          }
          .r-meta {
            flex-direction: column;
            align-items: flex-end;
            gap: 1px;
          }
        }
        @container fitted-card (width <= 170px) {
          .line-2 {
            display: none;
          }
        }
      </style>
    </template>
  };
}
