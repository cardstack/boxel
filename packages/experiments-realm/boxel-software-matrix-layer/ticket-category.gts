import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import FolderIcon from '@cardstack/boxel-icons/folder';

import { Queue } from './queue';
import { TicketPriorityField } from './ticket-taxonomy';
import { StatePill } from './components/state-pill';

/**
 * What kind of problem this is, and what that implies.
 *
 * A category is not a label. It is where a new ticket's priority and queue
 * come from, which is why it is a card with links rather than a string on the
 * ticket: change "Outage" to route at P1 into L2, and every future outage
 * follows without anyone editing a rule.
 *
 * Both defaults are suggestions the ticket may override. A routing scheme that
 * cannot be overridden is one an agent will work around by mis-categorising,
 * and then the reports are wrong too.
 */
export class TicketCategory extends CardDef {
  static displayName = 'Category';
  static icon = FolderIcon;

  @field name = contains(StringField);
  @field parent = linksTo(() => TicketCategory);
  @field defaultPriority = contains(TicketPriorityField);
  @field defaultQueue = linksTo(() => Queue);

  @field title = contains(StringField, {
    computeVia: function (this: TicketCategory) {
      return this.name?.trim() || 'Uncategorised';
    },
  });

  // The trail, denormalized: a tile cannot walk `parent`, and "Authentication"
  // on its own does not tell you it lives under "Access issues".
  @field path = contains(StringField, {
    computeVia: function (this: TicketCategory) {
      let names: string[] = [];
      let node: TicketCategory | undefined = this;
      // Bounded rather than while(node): a category accidentally made its own
      // ancestor would otherwise hang the indexer instead of showing a mistake.
      for (let depth = 0; node && depth < 8; depth++) {
        names.unshift(node.name ?? '—');
        node = node.parent;
      }
      return names.join(' › ');
    },
  });

  @field defaultQueueName = contains(StringField, {
    computeVia: function (this: TicketCategory) {
      return this.defaultQueue?.title ?? '';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <header>
          <p class='trail'>{{@model.path}}</p>
          <h1>{{@model.title}}</h1>
        </header>
        <dl class='facts'>
          <div>
            <dt>New tickets start at</dt>
            <dd>
              {{#if @model.defaultPriority}}
                <@fields.defaultPriority @format='embedded' />
              {{else}}
                <span class='none'>No default — the agent picks</span>
              {{/if}}
            </dd>
          </div>
          <div>
            <dt>and land in</dt>
            <dd>
              {{#if @model.defaultQueue}}
                <@fields.defaultQueue @format='atom' />
              {{else}}
                <span class='none'>No default queue — they stay unrouted</span>
              {{/if}}
            </dd>
          </div>
        </dl>
        <p class='note'>Both are suggestions. A ticket may override either, and
          the override is deliberate: routing an agent cannot argue with is
          routing they work around by filing things in the wrong category.</p>
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
        .trail {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-family: var(--font-heading, inherit);
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
        }
        .facts {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
          gap: var(--boxel-sp);
          margin: 0;
        }
        .facts > div {
          min-width: 0;
        }
        .facts dt {
          font-size: 0.625rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .none {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .note {
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
        <span class='emb-path'>{{@model.path}}</span>
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
        .emb-path {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template><StatePill @label={{@model.title}} @hue='slate' /></template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <header class='r-head'>
          <h3 class='title'>{{@model.title}}</h3>
          <span class='badge'>{{@model.defaultPriority}}</span>
        </header>
        <div class='r-body'>
          <span class='line'>{{@model.path}}</span>
          <span class='line line-2'>{{@model.defaultQueueName}}</span>
          <p class='blurb'>{{@model.path}}</p>
          <span class='tail'>{{@model.defaultQueueName}}</span>
        </div>
        <footer class='r-meta'>{{@model.defaultQueueName}}</footer>
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
