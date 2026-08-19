import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  StringField,
  realmURL,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
import MarkdownField from '@cardstack/base/markdown';
import TicketIcon from '@cardstack/boxel-icons/ticket';
import { htmlSafe } from '@ember/template';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import { SupportContact } from './support-contact';
import { SupportAgent } from './support-agent';
import { Queue } from './queue';
import { TicketCategory } from './ticket-category';
import { SlaPolicy } from './sla-policy';
import { KnowledgeArticle } from './knowledge-article';
import { SlaTimerField } from './sla-timer-field';
import { TicketMessageField } from './ticket-message-field';
import {
  TicketStatusField,
  TicketPriorityField,
  TicketChannelField,
  TicketTypeField,
} from './ticket-taxonomy';
import { SlaTimerBadge } from './components/sla-timer-badge';
import { StatePill } from './components/state-pill';
import { Feed, type FeedEntry } from './components/feed';
import { TicketWorkspace } from './components/ticket-workspace';
import { statusHue } from './status-field';
import { priorityOption } from './priority-field';
import { timerSnapshot, urgencyRank, type TimerSnapshot } from './utils/sla';
import { daysBetween, stateColor } from './utils/index';

/**
 * One request for help, from arrival to resolution.
 *
 * Incident and ServiceRequest extend this rather than being a `type` string on
 * it, which is what lets `linksTo(Ticket)` accept either and keeps an
 * incident's impact/urgency out of every service request. `ticketType` still
 * exists as a field because a subclass name is not something a prerendered
 * tile can read or a queue can sort by.
 */

/**
 * The ticket as a RECORD, not as a workbench.
 *
 * The isolated format used to mount the agent workspace — composer, action
 * bar, in-place link pickers. That was wrong twice over. It duplicated the
 * host's own chrome (the stack already gives this card a title bar with Edit
 * and Close, so the workspace's header drew a second one underneath), and it
 * assumed context a card opened on its own does not have: no realms means the
 * pickers open onto an empty list, which is a control that looks live and
 * cannot work.
 *
 * So the split is by role. **The workspace is the console's detail pane** —
 * it belongs to ServiceDesk, where the realm, the command context and the
 * CRUD functions all exist. **This is what a ticket looks like when you open
 * it**: everything that happened, laid out to be read. Changing it is what
 * the edit format is for.
 */
class TicketRecord extends Component<typeof Ticket> {
  get statusHue() {
    return statusHue(TicketStatusField, this.args.model?.status);
  }

  get priorityHue() {
    return (
      priorityOption(TicketPriorityField, this.args.model?.priority)?.hue ??
      'slate'
    );
  }

  get feedEntries(): FeedEntry[] {
    return (this.args.model?.messages ?? [])
      .filter(Boolean)
      .map((message) => message.feedEntry);
  }

  get firstResponseTimer() {
    return (this.args.model?.timers ?? []).find(
      (t) => t?.kind === 'First response',
    );
  }

  get resolutionTimer() {
    return (this.args.model?.timers ?? []).find(
      (t) => t?.kind === 'Resolution',
    );
  }

  get articles() {
    return (this.args.model?.linkedArticles ?? []).filter(Boolean);
  }

  <template>
    <article class='rec'>
      <header class='rec-head'>
        <span class='rec-ref'>{{if
            @model.reference
            @model.reference
            '—'
          }}</span>
        <h1 class='rec-title'>{{if
            @model.subject
            @model.subject
            'Untitled ticket'
          }}</h1>
        <div class='rec-pills'>
          <StatePill
            @label={{@model.priority}}
            @hue={{this.priorityHue}}
            @emphatic={{true}}
          />
          <StatePill
            @label={{@model.status}}
            @hue={{this.statusHue}}
            @dot={{true}}
          />
          {{#if @model.ticketType}}
            <StatePill @label={{@model.ticketType}} @chrome={{true}} />
          {{/if}}
        </div>
      </header>

      {{! The four facts, read-only. Live badges: a record open on a second
          screen is exactly where a stale countdown would mislead. }}
      <section class='rec-slab' aria-label='Summary'>
        <div class='rec-cell'>
          <span class='rec-lb'>Customer</span>
          <span class='rec-strong'>{{if
              @model.customerName
              @model.customerName
              'Unlinked'
            }}</span>
          <span class='rec-dim'>{{@model.customerCompany}}</span>
        </div>
        <div class='rec-cell'>
          <span class='rec-lb'>First response</span>
          <SlaTimerBadge
            @facts={{this.firstResponseTimer}}
            @live={{true}}
            @showBar={{true}}
          />
        </div>
        <div class='rec-cell'>
          <span class='rec-lb'>Resolution</span>
          <SlaTimerBadge
            @facts={{this.resolutionTimer}}
            @live={{true}}
            @showBar={{true}}
          />
        </div>
        <div class='rec-cell'>
          <span class='rec-lb'>Owner</span>
          <span class='rec-strong'>{{if
              @model.assigneeName
              @model.assigneeName
              'Unclaimed'
            }}</span>
          <span class='rec-dim'>{{if
              @model.queueName
              @model.queueName
              'Unrouted'
            }}</span>
        </div>
      </section>

      <div class='rec-body'>
        <main class='rec-thread'>
          <h2 class='rec-h'>Conversation</h2>
          {{#if @model.details}}
            <div class='rec-details'><@fields.details /></div>
          {{/if}}
          <Feed
            @entries={{this.feedEntries}}
            @emptyMessage='Nothing has been said on this ticket yet.'
          />
        </main>

        <aside class='rec-rail' aria-label='Details'>
          <section>
            <h2 class='rec-h'>Details</h2>
            <dl class='rec-facts'>
              <div><dt>Category</dt><dd>{{if
                    @model.categoryName
                    @model.categoryName
                    '—'
                  }}</dd></div>
              <div><dt>Channel</dt><dd>{{if
                    @model.channel
                    @model.channel
                    '—'
                  }}</dd></div>
              <div><dt>Opened</dt><dd>{{if
                    @model.ageLabel
                    @model.ageLabel
                    '—'
                  }}</dd></div>
            </dl>
            {{#if @model.tags.length}}
              <ul class='rec-tags'>
                {{#each @model.tags as |tag|}}<li>{{tag}}</li>{{/each}}
              </ul>
            {{/if}}
          </section>

          {{#if this.articles.length}}
            <section>
              <h2 class='rec-h'>Linked articles</h2>
              <ul class='rec-links'>
                {{#each this.articles key='id' as |article|}}
                  <li>{{article.title}}</li>
                {{/each}}
              </ul>
            </section>
          {{/if}}
        </aside>
      </div>
    </article>

    <style scoped>
      .rec {
        /* The container the `@container rec` rule below queries. An isolated card
           gets NO container from the host — every ancestor up to the panel is
           `container-type: normal` — so a bare `@container (max-width: 44rem)`
           here matched nothing and `.rec-body` never collapsed to one column in a
           narrow panel. Named, because an unnamed container is claimed by the
           nearest query and this template also renders fitted cards that query
           `fitted-card`. `inline-size` rather than `size`: the card scrolls, and
           `size` needs a definite block size. */
        container-name: rec;
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        min-height: 100%;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      /* No action bar and no second title: the host's own header already
         names this card and owns Edit / Close. */
      .rec-head {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
        padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-sm);
      }
      .rec-ref {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
        font-variant-numeric: tabular-nums;
      }
      .rec-title {
        margin: 0;
        flex: 1;
        min-width: 12rem;
        font-family: var(--font-heading, inherit);
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
        letter-spacing: -0.01em;
        text-wrap: balance;
      }
      .rec-pills {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        flex-wrap: wrap;
      }
      .rec-slab {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        border-block: 1px solid var(--border, var(--boxel-200));
        background: var(--muted, var(--boxel-100));
      }
      .rec-cell {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .rec-lb {
        font-size: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rec-strong {
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rec-dim {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rec-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 16rem;
        flex: 1;
        min-height: 0;
      }
      .rec-thread {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        min-width: 0;
      }
      /* Prose caps at a readable measure however wide the stack gets. */
      .rec-thread > * {
        max-width: 70ch;
        width: 100%;
      }
      .rec-details {
        font-size: var(--boxel-font-size-sm);
        line-height: 1.7;
        color: var(--muted-foreground, var(--boxel-450));
        border-left: 2px solid var(--border, var(--boxel-200));
        padding-left: var(--boxel-sp-sm);
      }
      .rec-rail {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp) 0;
      }
      .rec-h {
        margin: 0 0 var(--boxel-sp-4xs);
        font-size: 0.5625rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rec-facts {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .rec-facts > div {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .rec-facts dt {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rec-facts dd {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-align: end;
        overflow-wrap: anywhere;
      }
      .rec-tags,
      .rec-links {
        list-style: none;
        margin: var(--boxel-sp-xs) 0 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
      }
      .rec-links {
        flex-direction: column;
      }
      .rec-tags li {
        padding: 0.05em 0.4em;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 999px;
        font-size: 0.625rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rec-links li {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      @container rec (max-width: 44rem) {
        .rec-body {
          grid-template-columns: 1fr;
        }
        .rec-rail {
          padding: 0 var(--boxel-sp-lg) var(--boxel-sp);
        }
      }
    </style>
  </template>
}

/**
 * Editing a ticket IS the agent workspace.
 *
 * The default edit format — every field stacked in a form — is the wrong shape
 * for this card. A ticket is not filled in field by field; it is worked: you
 * read what the customer said, you answer, you route it, you resolve it. The
 * console's detail pane was already that surface, so the edit format mounts
 * the same component rather than a second, lesser one. One editing surface,
 * defined once, reached from two places — pressing Edit on a ticket anywhere
 * in Boxel, and selecting a row in the console.
 *
 * Its counterpart is `TicketRecord`, the isolated format: what a ticket looks
 * like when you are reading it rather than working it.
 */
class TicketEditor extends Component<typeof Ticket> {
  // The workspace queries this realm for the customers, agents, queues and
  // categories its pickers offer. Opened standalone there is no console to
  // hand it down, so it comes off the card itself.
  get realms(): string[] {
    let realm = (this.args.model as any)?.[realmURL];
    return realm ? [String(realm)] : [];
  }

  // `@model` in an edit format is a PartialFields proxy — every field is
  // optional until it is set — so it does not satisfy `Ticket` structurally
  // even though it IS one at runtime. Narrowed once here rather than loosening
  // the workspace's own argument type, which would cost every other caller.
  get ticket(): Ticket | undefined {
    return this.args.model as unknown as Ticket | undefined;
  }

  <template>
    <TicketWorkspace
      @ticket={{this.ticket}}
      @context={{@context}}
      @realms={{this.realms}}
    />
  </template>
}

export class Ticket extends CardDef {
  static displayName = 'Ticket';
  static icon = TicketIcon;
  // Same reason: the workspace wants conversation and context side by side.
  static prefersWideFormat = true;

  @field reference = contains(StringField, { description: 'e.g. #1234' });
  @field subject = contains(StringField);
  @field details = contains(MarkdownField);

  @field status = contains(TicketStatusField);
  @field priority = contains(TicketPriorityField);
  @field channel = contains(TicketChannelField);
  @field ticketType = contains(TicketTypeField);

  @field customer = linksTo(() => SupportContact);
  @field assignee = linksTo(() => SupportAgent);
  @field queue = linksTo(() => Queue);
  @field category = linksTo(() => TicketCategory);
  @field slaPolicy = linksTo(() => SlaPolicy);
  @field linkedArticles = linksToMany(() => KnowledgeArticle);
  @field relatedTickets = linksToMany(() => Ticket);

  @field timers = containsMany(SlaTimerField);
  @field messages = containsMany(TicketMessageField);
  @field tags = containsMany(StringField);

  @field openedAt = contains(DateTimeField);
  @field firstRespondedAt = contains(DateTimeField);
  @field resolvedAt = contains(DateTimeField);
  @field closedAt = contains(DateTimeField);

  @field title = contains(StringField, {
    computeVia: function (this: Ticket) {
      let ref = this.reference?.trim();
      let subject = this.subject?.trim() || 'Untitled ticket';
      return ref ? `${ref} ${subject}` : subject;
    },
  });

  // ------------------------------------------------------------------
  // Flattened display fields.
  //
  // Prerendered fitted views resolve no links, so every one of these exists
  // because a tile needs to say something a link would otherwise have told it.
  // They are also what the queue and the contact history query on — `eq` on a
  // stored string is something the index can answer, walking a relationship is
  // not.
  //
  // If these are wrong, every tile in the app is wrong and no linter will say
  // so. The sixteen-size walk is the only thing that catches it.
  // ------------------------------------------------------------------

  @field customerName = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.customer?.title ?? '';
    },
  });

  @field customerCompany = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.customer?.company ?? '';
    },
  });

  @field assigneeName = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.assignee?.title ?? '';
    },
  });

  @field queueName = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.queue?.title ?? '';
    },
  });

  @field categoryName = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.category?.title ?? '';
    },
  });

  /** The timer that decides the ticket's colour: the nearest one to breaching. */
  get governingTimer(): SlaTimerField | undefined {
    let live = (this.timers ?? []).filter(Boolean);
    if (!live.length) {
      return undefined;
    }
    return [...live].sort(
      (a, b) => urgencyRank(timerSnapshot(a)) - urgencyRank(timerSnapshot(b)),
    )[0];
  }

  get governingSnapshot(): TimerSnapshot | undefined {
    let timer = this.governingTimer;
    return timer ? timerSnapshot(timer) : undefined;
  }

  @field slaState = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.governingSnapshot?.state ?? '';
    },
  });

  @field slaLabel = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.governingSnapshot?.shortLabel ?? '';
    },
  });

  /**
   * The deadline written as a clock time, for surfaces that cannot tick.
   *
   * `slaLabel` is a COUNTDOWN — "2h 34m" — computed once and stored. In a live
   * view that is fine, because the badge recomputes every second. In
   * prerendered fitted HTML it is baked at index time and never updates, so a
   * tile rendered this morning still claims two hours remain at four in the
   * afternoon. A countdown is the one shape of value that cannot survive being
   * cached; a deadline can. Fitted shows this instead.
   */
  @field slaDueLabel = contains(StringField, {
    computeVia: function (this: Ticket) {
      let due = this.governingTimer?.deadlineAt;
      if (!due) {
        return this.governingSnapshot?.state === 'paused' ? 'Paused' : '';
      }
      let at = due instanceof Date ? due : new Date(due);
      if (isNaN(at.getTime())) {
        return '';
      }
      let when = formatDateTime(at, { preset: 'medium', fallback: '' }) ?? '';
      // No 'overdue' wording: whether it has passed is a fact about NOW, and
      // now is exactly what a cached tile does not know. The colour carries
      // the state; the text carries only the deadline, which never rots.
      return when ? `Due ${when}` : '';
    },
  });

  // Sorted on by every queue. A date sorts correctly in the index where a
  // formatted duration ('2h 34m') does not.
  @field slaDeadline = contains(DateTimeField, {
    computeVia: function (this: Ticket) {
      return this.governingTimer?.deadlineAt;
    },
  });

  // Sorting a queue by deadline alone is wrong in one specific, common way: a
  // PAUSED ticket whose deadline has already passed sorts ahead of a live
  // breach, even though nobody is waiting on it. This is the key the queue
  // actually orders by — breached first, then live clocks by time remaining,
  // then paused, then met.
  @field urgencyOrder = contains(NumberField, {
    computeVia: function (this: Ticket) {
      let snapshot = this.governingSnapshot;
      return snapshot ? urgencyRank(snapshot) : Number.MAX_SAFE_INTEGER;
    },
  });

  @field ageLabel = contains(StringField, {
    computeVia: function (this: Ticket) {
      let days = daysBetween(this.openedAt);
      if (days == null) {
        return '';
      }
      return days === 0 ? 'opened today' : `opened ${days}d ago`;
    },
  });

  @field latestMessage = contains(StringField, {
    computeVia: function (this: Ticket) {
      // Public entries only: the first line of an internal note must never
      // surface on a tile, where nobody can see it is internal.
      let publicOnes = (this.messages ?? []).filter(
        (m) => m?.visibility !== 'Internal' && !m?.isSlaEvent,
      );
      let last = publicOnes[publicOnes.length - 1];
      let text = (last?.body ?? '').replace(/\s+/g, ' ').trim();
      return text.length > 160 ? `${text.slice(0, 157)}…` : text;
    },
  });

  // Joined in the model, not the template: interpolating separators between
  // optional values in a template needs `{{#if}}` around each one, and that
  // whitespace is what the linter (correctly) flags as layout-by-spaces.
  @field customerSuffix = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.customerCompany ? ` · ${this.customerCompany}` : '';
    },
  });

  @field routeLabel = contains(StringField, {
    computeVia: function (this: Ticket) {
      return [this.categoryName, this.queueName, this.assigneeName]
        .filter(Boolean)
        .join(' · ');
    },
  });

  @field tagSummary = contains(StringField, {
    computeVia: function (this: Ticket) {
      return (this.tags ?? []).filter(Boolean).join(' · ');
    },
  });

  static isolated: BaseDefComponent = TicketRecord as BaseDefComponent;

  static edit: BaseDefComponent = TicketEditor as BaseDefComponent;

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get statusHue() {
      return statusHue(TicketStatusField, this.args.model?.status);
    }
    get priorityHue() {
      return (
        priorityOption(TicketPriorityField, this.args.model?.priority)?.hue ??
        'slate'
      );
    }
    // One line of context instead of a second row of chips. Density comes
    // from packing the same height harder, never from shrinking the type.
    get context() {
      let model = this.args.model;
      return [
        model?.customerName,
        model?.customerCompany,
        model?.categoryName,
        model?.queueName,
        model?.assigneeName,
        model?.ageLabel,
      ]
        .filter(Boolean)
        .join(' · ');
    }

    <template>
      <article class='row'>
        <span class='row-spine'></span>
        <span class='row-ref'>{{@model.reference}}</span>
        <span class='row-main'>
          <span class='row-subject'>{{@model.subject}}</span>
          <span class='row-context'>{{this.context}}</span>
        </span>
        <StatePill
          @label={{@model.priority}}
          @hue={{this.priorityHue}}
          @emphatic={{true}}
        />
        <StatePill @label={{@model.status}} @chrome={{true}} />
        <SlaTimerBadge @facts={{@model.governingTimer}} @live={{true}} />
      </article>
      <style scoped>
        /* 46px, down from 88. A screen of forty tickets is eleven rows
           instead of five, and it carries eight fields instead of five. */
        .row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          height: 46px;
          padding: 0 var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm, 6px);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        /* The one cue that stays readable down a long stacked list. */
        .row-spine {
          width: 3px;
          height: 26px;
          flex: none;
          border-radius: 1px;
          background: var(--primary, var(--boxel-highlight));
        }
        .row-ref {
          flex: none;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .row-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .row-subject {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-context {
          font-size: var(--boxel-font-size-xs);
          line-height: 1.3;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static atom: BaseDefComponent = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>
        <span class='atom-spine'></span>
        <span class='atom-ref'>{{@model.reference}}</span>
        <span class='atom-subject'>{{@model.subject}}</span>
        <SlaTimerBadge @facts={{@model.governingTimer}} @live={{false}} />
      </span>
      <style scoped>
        .atom {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          max-width: 100%;
          font-size: 0.8125rem;
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .atom-spine {
          width: 3px;
          height: 0.9rem;
          flex: none;
          border-radius: 1px;
          background: var(--primary, var(--boxel-highlight));
        }
        .atom-ref {
          flex: none;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .atom-subject {
          min-width: 0;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted: BaseDefComponent = class Fitted extends Component<
    typeof this
  > {
    get priorityHue() {
      return (
        priorityOption(TicketPriorityField, this.args.model?.priority)?.hue ??
        'slate'
      );
    }
    get spineStyle() {
      return htmlSafe(`background: ${stateColor(this.priorityHue).ring};`);
    }

    <template>
      {{! Single `.fit` grid, and it declares NO container of its own — it
          queries the host's `fitted-card`. Every region clips and can shrink
          (`min-height: 0`), so a tier that hides a row cannot push another one
          out of the box.

          Everything below reads FLATTENED string fields. A prerendered fitted
          view resolves no links, and reading through one there throws rather
          than returning blank — that is how a tile becomes a red error card. }}
      <article class='fit'>
        <span class='spine' style={{this.spineStyle}}></span>

        <header class='r-head'>
          <span class='ref'>{{@model.reference}}</span>
          <h3 class='title'>{{@model.subject}}</h3>
          {{! A due time, not a countdown — see `slaDueLabel`. }}
          <span
            class='sla sla-{{@model.slaState}}'
          >{{@model.slaDueLabel}}</span>
        </header>

        <div class='r-body'>
          <span class='line'>{{@model.customerName}}{{#if
              @model.customerCompany
            }}
              ·
              {{@model.customerCompany}}{{/if}}</span>
          <span class='line line-2'>{{@model.categoryName}}{{#if
              @model.queueName
            }}
              ·
              {{@model.queueName}}{{/if}}{{#if @model.assigneeName}}
              ·
              {{@model.assigneeName}}{{/if}}</span>
          <p class='snip'>{{@model.latestMessage}}</p>
          <span class='line line-3'>{{@model.tagSummary}}</span>
        </div>

        <footer class='r-meta'>
          <span class='pri'>{{@model.priority}}</span>
          <span class='status'>{{@model.status}}</span>
          <span class='age'>{{@model.ageLabel}}</span>
        </footer>
      </article>

      <style scoped>
        .fit {
          position: relative;
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 2px;
          padding: 7px 9px 7px 12px;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          /* One continuous type scale driven by the container, never stepped
             per tier: the @container blocks below change structure only. */
          --type-base: clamp(9.5px, 2.7cqi, 12px);
          --type-title: max(11px, calc(var(--type-base) * 1.25));
        }
        .fit > * {
          overflow: hidden;
          min-height: 0;
        }
        .spine {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }
        .ref {
          flex: none;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
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
        /* The one thing that survives every tier alongside the reference:
           together they answer "which ticket, how urgent" at 150x40. */
        .sla {
          flex: none;
          margin-left: auto;
          padding: 0 4px;
          border-radius: 4px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .sla-met,
        .sla-healthy {
          color: color-mix(
            in oklch,
            var(--boxel-success) 38%,
            var(--card-foreground, var(--boxel-dark))
          );
          background: color-mix(
            in oklch,
            var(--boxel-success) 13%,
            var(--card, var(--boxel-light))
          );
        }
        .sla-warning {
          color: color-mix(
            in oklch,
            var(--boxel-warning) 40%,
            var(--card-foreground, var(--boxel-dark))
          );
          background: color-mix(
            in oklch,
            var(--boxel-warning) 14%,
            var(--card, var(--boxel-light))
          );
        }
        .sla-urgent {
          color: color-mix(
            in oklch,
            var(--boxel-danger) 42%,
            var(--card-foreground, var(--boxel-dark))
          );
          background: color-mix(
            in oklch,
            var(--boxel-danger) 13%,
            var(--card, var(--boxel-light))
          );
        }
        .sla-breached {
          color: var(--background, var(--boxel-light));
          background: var(--boxel-danger);
        }
        .sla-paused {
          color: var(--muted-foreground, var(--boxel-450));
          background: var(--muted, var(--boxel-100));
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
        .line-3 {
          display: none;
          margin-top: auto;
        }
        .snip {
          display: none;
          margin: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .r-meta {
          grid-area: meta;
          display: none;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .pri {
          flex: none;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          font-weight: 700;
        }
        .status,
        .age {
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .age {
          margin-left: auto;
          flex: none;
        }

        /* Height quanta. Each tier ADDS a row rather than un-cropping one:
           up to 50px is the badge (identity only); past 50px priority and
           status return; past 105px the body says who it is about; past 240px
           there is finally room for the last thing said. */
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
            padding-block: 4px;
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
        /* 80px is where a body line first fits without crowding the meta row.
           Waiting until 105 left the Large Badge (150x105) with a visible void
           — the "empty-looking cell" the size walk exists to catch. */
        @container fitted-card (height > 80px) {
          .r-body {
            display: flex;
          }
        }
        @container fitted-card (height > 160px) {
          .snip {
            display: -webkit-box;
            -webkit-line-clamp: 2;
          }
        }
        /* Taller tiers ADD rather than un-crop: the excerpt grows and the tags
           appear, so a 275px tile is not a 170px tile with a hole in it. */
        @container fitted-card (height > 240px) {
          .snip {
            -webkit-line-clamp: 4;
          }
          .line-3 {
            display: block;
          }
        }
        /* Wide and short: two columns rather than a squeezed stack, with the
           content column held at >=200px so the title never becomes a word. */
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
          .age {
            margin-left: 0;
          }
        }
        /* Narrow: the second line would be two words and an ellipsis. */
        @container fitted-card (width <= 170px) {
          .line-2 {
            display: none;
          }
        }
      </style>
    </template>
  };
}
