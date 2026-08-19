import InboxIcon from '@cardstack/boxel-icons/inbox';
import PlusIcon from '@cardstack/boxel-icons/plus';
import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
  realmURL,
  type CardContext,
} from '@cardstack/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { type getCards, identifyCard } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { array, fn } from '@ember/helper';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';
import { consume } from 'ember-provide-consume-context';
import {
  CardCrudFunctionsContextName,
  type CardCrudFunctions,
} from '@cardstack/runtime-common';
import LifeBuoyIcon from '@cardstack/boxel-icons/life-buoy';

import { Ticket } from './ticket';
import { Queue } from './queue';
import { SlaPolicy } from './sla-policy';
import { Schedule } from './schedule';
import { TicketCategory } from './ticket-category';
import { SupportContact } from './support-contact';
import { SupportAgent } from './support-agent';
import { KnowledgeArticle } from './knowledge-article';
import { CollectionPanel } from './components/collection-panel';
import type { TableColumn } from './table';
import { QueueView } from './components/queue-view';
import { WorkRail } from './components/work-rail';
import { TicketWorkspace } from './components/ticket-workspace';
import type { Lens } from './utils/queue-lens';

interface Panel {
  id: string;
  label: string;
  /** The job this panel exists to do, in the words of whoever does it. */
  purpose: string;
  /**
   * The card CLASS, not its display name. A `_cardType` string filter is an
   * exact match and silently drops subclasses; a CodeRef derived from the
   * class includes them by construction.
   */
  cardClass?: typeof CardDef;
  /** Table columns for the catalogue panels. Keys read off the instance. */
  columns?: TableColumn[];
  searchPlaceholder?: string;
  /** Singular noun for the New button — "New" alone says nothing about what. */
  newLabel?: string;
  /** True for the one panel that renders the queue rather than a catalogue. */
  isQueue?: boolean;
}

interface Section {
  id: string;
  label: string;
  panels: Panel[];
}

// Three sections, not seven tabs. The previous nav mixed three different kinds
// of thing — work, reference and configuration — so an agent who only ever
// needs the first had to pick it out of seven every time. Now their whole
// world is the first section and the other two are somebody else's job.
const SECTIONS: Section[] = [
  {
    id: 'work',
    label: 'Work',
    panels: [
      {
        id: 'queue',
        label: 'Queue',
        purpose:
          'What needs attention right now. The counts are the filters — click one to narrow.',
        isQueue: true,
      },
      {
        id: 'queues',
        label: 'Teams',
        purpose:
          'Which baskets are healthy and which are drowning — the team lead’s view.',
        cardClass: Queue,
        searchPlaceholder: 'Search queues…',
        newLabel: 'queue',
        columns: [
          { key: 'title', label: 'Queue' },
          { key: 'tierLabel', label: 'Tier' },
          { key: 'agentCount', label: 'Agents' },
          { key: 'policyName', label: 'Default policy', showAbove: 640 },
        ],
      },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    panels: [
      {
        id: 'articles',
        label: 'Articles',
        purpose:
          'Answers worth writing down once. These are what the workspace suggests while an agent types.',
        cardClass: KnowledgeArticle,
        searchPlaceholder: 'Search articles, keywords…',
        newLabel: 'article',
        columns: [
          { key: 'title', label: 'Article' },
          { key: 'categoryName', label: 'Category' },
          { key: 'status', label: 'Status' },
          { key: 'visibility', label: 'Visibility', showAbove: 640 },
        ],
      },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    panels: [
      {
        id: 'sla',
        label: 'Commitments',
        purpose: 'What was promised, to whom, and how each priority scales it.',
        cardClass: SlaPolicy,
        searchPlaceholder: 'Search policies…',
        newLabel: 'policy',
        columns: [
          { key: 'title', label: 'Policy' },
          { key: 'conditionSummary', label: 'Applies when' },
          { key: 'targetSummary', label: 'Targets' },
          { key: 'businessHoursSummary', label: 'Hours', showAbove: 720 },
        ],
      },
      {
        id: 'hours',
        label: 'Business hours',
        purpose: 'The calendars every SLA deadline is calculated against.',
        cardClass: Schedule,
        searchPlaceholder: 'Search schedules…',
        newLabel: 'schedule',
        columns: [
          { key: 'title', label: 'Schedule' },
          { key: 'summary', label: 'Open' },
          { key: 'timeZone', label: 'Time zone' },
          { key: 'holidayCount', label: 'Holidays', showAbove: 640 },
        ],
      },
      {
        id: 'categories',
        label: 'Categories',
        purpose:
          'Where a new ticket’s priority and queue come from. Both stay overridable.',
        cardClass: TicketCategory,
        searchPlaceholder: 'Search categories…',
        newLabel: 'category',
        columns: [
          { key: 'path', label: 'Category' },
          { key: 'defaultPriority', label: 'Default priority' },
          { key: 'defaultQueueName', label: 'Routes to' },
        ],
      },
      {
        id: 'people',
        label: 'Customers',
        purpose: 'Who is asking, and what they were promised.',
        cardClass: SupportContact,
        searchPlaceholder: 'Search customers, companies…',
        newLabel: 'customer',
        columns: [
          { key: 'title', label: 'Customer' },
          { key: 'company', label: 'Company' },
          { key: 'tier', label: 'Tier' },
        ],
      },
      {
        id: 'agents',
        label: 'Agents',
        purpose: 'Who answers, at which tier, with which skills.',
        cardClass: SupportAgent,
        searchPlaceholder: 'Search agents, skills…',
        newLabel: 'agent',
        columns: [
          { key: 'title', label: 'Agent' },
          { key: 'tierLabel', label: 'Tier' },
          { key: 'skillSummary', label: 'Skills', showAbove: 640 },
        ],
      },
    ],
  },
];

/**
 * The console body.
 *
 * A top-level component rather than the format class itself, because reactive
 * state (`@tracked`) is not allowed inside a `static isolated = class { … }`
 * expression — the decorator has nowhere to install itself there.
 */
interface ConsoleSignature {
  Args: {
    title?: string;
    realm?: string;
    context?: CardContext;
  };
  Element: HTMLElement;
}

class ServiceDeskConsole extends GlimmerComponent<ConsoleSignature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  sections = SECTIONS;
  @tracked sectionId = SECTIONS[0]!.id;
  @tracked panelId = SECTIONS[0]!.panels[0]!.id;
  @tracked private ticketQuery: ReturnType<getCards> | undefined;

  constructor(owner: unknown, args: ConsoleSignature['Args']) {
    super(owner as never, args as never);
    // One live query feeds the counts AND the rows. Two queries is how a
    // header that says "1 breached" ends up disagreeing with the list below.
    this.ticketQuery = this.args.context?.getCards(
      this,
      () => {
        if (!this.isInteractive) {
          return undefined;
        }
        let ref = identifyCard(Ticket);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => (this.args.realm ? [this.args.realm] : []),
      { isLive: true },
    );
  }

  get section(): Section {
    return (
      this.sections.find((s) => s.id === this.sectionId) ?? this.sections[0]!
    );
  }

  /**
   * A catalogue panel needs both a type to query and a realm to query in.
   *
   * A getter rather than `(and this.panel.cardClass this.realms.length)` in the
   * template: the `and` helper infers its type parameter from the FIRST
   * argument, so every later argument gets checked against `typeof CardDef`
   * and a plain boolean fails.
   */
  get canShowPanel(): boolean {
    return Boolean(this.panel.cardClass) && this.realms.length > 0;
  }

  get panel(): Panel {
    return (
      this.section.panels.find((p) => p.id === this.panelId) ??
      this.section.panels[0]!
    );
  }

  get tickets(): Ticket[] {
    return ((this.ticketQuery?.instances ?? []) as Ticket[]).filter(Boolean);
  }

  get isLoadingTickets(): boolean {
    return Boolean(this.ticketQuery?.isLoading);
  }

  selectSection = (id: string, _event?: Event) => {
    this.sectionId = id;
    this.panelId =
      this.sections.find((s) => s.id === id)?.panels[0]?.id ?? this.panelId;
  };

  selectPanel = (id: string, _event?: Event) => {
    this.panelId = id;
  };

  @tracked selectedTicket: Ticket | undefined;

  // The three filters the console owns, because two surfaces read them: the
  // rail draws the counts and the list draws the rows.
  @tracked lens: Lens = 'open';
  @tracked queueName: string | undefined;

  setLens = (lens: Lens) => {
    this.lens = lens;
  };

  setQueue = (name: string | undefined) => {
    this.queueName = name;
  };

  clearQueue = () => {
    this.queueName = undefined;
  };

  @tracked creating = false;
  @tracked createProblem: string | undefined;

  // A ticket raised by hand opens in edit, in this console's own realm — the
  // agent is typing what a customer said on the phone, so the empty form IS
  // the point and there is nothing worth prefilling.
  newTicket = async (_event?: Event) => {
    let create = this.cardCrudFunctions?.createCard;
    if (!create || !this.args.realm) {
      this.createProblem =
        'This console is not saved in a realm yet, so there is nowhere to put a new ticket.';
      return;
    }
    this.creating = true;
    this.createProblem = undefined;
    try {
      await create(
        { module: new URL('./ticket', this.args.realm).href, name: 'Ticket' },
        new URL(this.args.realm),
        { realmURL: new URL(this.args.realm) },
      );
    } catch (error: any) {
      this.createProblem = error?.message ?? String(error);
    } finally {
      this.creating = false;
    }
  };

  // Selecting, not navigating. On a wide canvas the queue stays put and only
  // the right pane changes — an agent working a run of tickets never has to
  // find their place again.
  selectTicket = (ticket: Ticket) => {
    this.selectedTicket = ticket;
  };

  clearTicket = (_event?: Event) => {
    this.selectedTicket = undefined;
  };

  get realms(): string[] {
    return this.args.realm ? [this.args.realm] : [];
  }

  /**
   * Prerender gets a static shell, not the console.
   *
   * Indexing renders this card with no CRUD functions and no interaction, and
   * mounting the live queries there costs a full query fan-out per reindex for
   * a result nobody sees. Worse, app cards that mount heavy interactive UI
   * during prerender have been seen to trip a Glimmer backtracking assertion,
   * which is stored as an error_doc and then surfaces to a real user as
   * "Card Error" on a card that works perfectly when opened.
   *
   * The presence of `viewCard` is the honest test for "a person is looking at
   * this".
   */
  get isInteractive(): boolean {
    return Boolean(this.cardCrudFunctions?.viewCard);
  }

  <template>
    <div class='console'>
      <header class='console-head'>
        <h1>{{@title}}</h1>
        {{! A segmented control, not four pills.
            Before this the three sections were filled buttons in the same
            green as "New ticket", so the loudest things on the masthead were
            "where you are" and "what you can do", in the same colour — the
            reader had to work out which of four identical lozenges was the
            action. Now the nav is one quiet bordered group (the same segment
            treatment the grid/list/table toggle already uses, so the console
            has one vocabulary for "pick one of these") and exactly one thing
            on the masthead is filled: the action. }}
        <nav class='sections' aria-label='Sections'>
          {{#each this.sections as |section|}}
            <button
              type='button'
              class='sec {{if (eq section.id this.sectionId) "sec-on"}}'
              aria-current={{if (eq section.id this.sectionId) 'true' 'false'}}
              {{on 'click' (fn this.selectSection section.id)}}
            >{{section.label}}</button>
          {{/each}}
        </nav>
        {{! Only "raise one" lives in the masthead. The ticket search used to
            sit here too, and it was a lie: it filtered the queue and nothing
            else, so on the Knowledge and Setup tabs it looked global while
            doing nothing — and those panels have their own search box, which
            put two differently-scoped search fields on one screen. Every
            search now sits in the toolbar of the thing it searches. }}
        <div class='head-tools'>
          <Button
            class='new-ticket'
            @kind='primary'
            @size='small'
            @loading={{this.creating}}
            {{on 'click' this.newTicket}}
          >
            {{#unless this.creating}}
              <PlusIcon width='15' height='15' aria-hidden='true' />
            {{/unless}}
            New ticket
          </Button>
        </div>
      </header>

      {{#if this.createProblem}}
        <p class='banner' role='alert'>{{this.createProblem}}</p>
      {{/if}}

      {{#if (gt this.section.panels.length 1)}}
        {{! Underline sub-tabs, not buttons: the section buttons above are
            actions that switch context; these mark position within it. }}
        <nav class='panels' aria-label='{{this.section.label}} views'>
          {{#each this.section.panels as |panel|}}
            <button
              type='button'
              class='pan {{if (eq panel.id this.panelId) "pan-on"}}'
              aria-current={{if (eq panel.id this.panelId) 'true' 'false'}}
              {{on 'click' (fn this.selectPanel panel.id)}}
            >{{panel.label}}</button>
          {{/each}}
        </nav>
      {{/if}}

      <section class='panel' aria-label={{this.panel.label}}>
        <p class='purpose'>{{this.panel.purpose}}</p>

        {{#if this.isInteractive}}

          {{#if this.panel.isQueue}}
            {{! Master-detail. The list is a fixed column and the detail fills
              what is left; below 68rem the detail drops away entirely and the
              list falls back to pushing the card onto the stack. }}
            <div class='split {{if this.selectedTicket "split-picked"}}'>
              <WorkRail
                class='split-rail'
                @tickets={{this.tickets}}
                @lens={{this.lens}}
                @onLens={{this.setLens}}
                @queueName={{this.queueName}}
                @onQueue={{this.setQueue}}
              />
              <div class='split-list'>
                <QueueView
                  @tickets={{this.tickets}}
                  @isLoading={{this.isLoadingTickets}}
                  @onSelect={{this.selectTicket}}
                  @selectedId={{this.selectedTicket.id}}
                  @lens={{this.lens}}
                  @onLens={{this.setLens}}
                  @queueName={{this.queueName}}
                  @onClearQueue={{this.clearQueue}}
                />
              </div>
              <div class='split-detail'>
                {{#if this.selectedTicket}}
                  {{! Keyed on the ticket id, so selecting a different row
                      BUILDS A NEW WORKSPACE rather than swapping one argument
                      under the old one. The conditional around it
                  stays true across selections, so without the key every piece
                  of tracked editor state survived the switch: a reply typed
                  against ticket A was still in the box on ticket B, and
                  pressing Send posted A's text publicly on B. Same for an open
                  subject edit, and for the escalate/merge panels, which stayed
                  open over a ticket they were never opened for. }}
                  {{#each (array this.selectedTicket) key='id' as |picked|}}
                    <TicketWorkspace
                      @ticket={{picked}}
                      @context={{@context}}
                      @realms={{this.realms}}
                      @onLeftQueue={{this.clearTicket}}
                    />
                  {{/each}}
                {{else}}
                  {{! The empty detail pane used to be a small card pinned to
                      the top of a tall grey void; it now fills the pane and
                      centres. }}
                  <div class='pick'>
                    <InboxIcon
                      class='pick-i'
                      width='28'
                      height='28'
                      aria-hidden='true'
                    />
                    <b>Pick a ticket</b>
                    <p>It opens here, beside the queue — you keep your place in
                      the list while you work.</p>
                  </div>
                {{/if}}
              </div>
            </div>
          {{else if this.canShowPanel}}
            {{! Keyed on the panel so switching tabs builds a fresh panel with
              its own query and its own empty search box, rather than carrying
              the previous tab's search term into a different card type. }}
            {{#each (array this.panel) key='id' as |panel|}}
              <CollectionPanel
                @cardClass={{panel.cardClass}}
                @context={{@context}}
                @realms={{this.realms}}
                @columns={{panel.columns}}
                @label={{panel.label}}
                @searchPlaceholder={{panel.searchPlaceholder}}
                @newLabel={{panel.newLabel}}
              />
            {{/each}}
          {{else}}
            <p class='empty'>This console is not saved in a realm yet, so there
              is nothing to query.</p>
          {{/if}}
        {{else}}
          <p class='shell'>The console is live when you open it — queues, timers
            and search all read the realm directly.</p>
        {{/if}}
      </section>
    </div>

    <style scoped>
      .console {
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg);
        min-height: 100%;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      .console-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 2px solid var(--foreground, var(--boxel-dark));
      }
      .console-head h1 {
        margin: 0;
        flex: 1;
        min-width: 10rem;
        font-family: var(--font-heading, inherit);
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      /* One outline around the group, hairlines between the segments. Three
         separately-bordered buttons read as three controls; this reads as one
         control with three positions, which is what it is. */
      .sections {
        display: flex;
        flex: none;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 6px);
        overflow: hidden;
      }
      .sec {
        padding: 0.3rem 0.85rem;
        border: none;
        background: var(--card, var(--boxel-light));
        color: var(--muted-foreground, var(--boxel-450));
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        transition:
          background-color 0.12s ease-out,
          color 0.12s ease-out;
      }
      .sec + .sec {
        border-left: 1px solid var(--border, var(--boxel-200));
      }
      .sec:hover {
        color: var(--foreground, var(--boxel-dark));
      }
      .sec:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      /* Ink, not accent: the accent belongs to the one action on this bar. */
      .sec-on {
        background: var(--foreground, var(--boxel-dark));
        color: var(--background, var(--boxel-light));
      }
      /* Pushed away from the nav so the action does not read as a fourth
         section. */
      .new-ticket {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs, 5px);
        white-space: nowrap;
      }
      .head-tools {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-sm);
      }
      .banner {
        margin: 0;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm, 4px);
        font-size: var(--boxel-font-size-xs);
        background: color-mix(
          in oklch,
          var(--boxel-danger) 12%,
          var(--background, var(--boxel-light))
        );
        color: color-mix(
          in oklch,
          var(--boxel-danger) 45%,
          var(--foreground, var(--boxel-dark))
        );
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .panels {
        display: flex;
        gap: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .pan {
        padding: 0.25rem 0.1rem;
        margin-bottom: -1px;
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        color: var(--muted-foreground, var(--boxel-450));
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        cursor: pointer;
      }
      /* Hover previews the active state — the same colour the `.pan-on` tab
         takes, without claiming its underline. Focus-visible was already here;
         hover was not, and a tab that only responds once you have committed to
         clicking it gives the pointer nothing to aim at. */
      .pan:hover {
        color: var(--foreground, var(--boxel-dark));
      }
      .pan:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .pan-on {
        color: var(--foreground, var(--boxel-dark));
        border-bottom-color: var(--primary, var(--boxel-highlight));
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .split {
        display: grid;
        grid-template-columns: 11rem 24rem minmax(0, 1fr);
        gap: var(--boxel-sp-sm);
        align-items: start;
        min-height: 32rem;
      }
      .split-rail {
        position: sticky;
        top: var(--boxel-sp-sm);
        padding-right: var(--boxel-sp-xs);
        border-right: 1px solid var(--border, var(--boxel-200));
      }
      /* The back control only exists in the one-column mode. */
      .back {
        display: none;
        margin-bottom: var(--boxel-sp-xs);
      }
      .split-list {
        min-width: 0;
      }
      .split-detail {
        min-width: 0;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 4px);
        overflow: hidden;
        background: var(--card, var(--boxel-light));
        position: sticky;
        top: var(--boxel-sp-sm);
      }
      /* `.split` is align-items:start so the pane can be sticky, which is
         also why an empty pane collapsed to the height of its two lines. A
         min-height on the pane itself restores the fill without giving up
         sticky. */
      .split-detail:has(.pick) {
        min-height: min(60vh, 34rem);
        /* flex, not just min-height: `height: 100%` on the placeholder
           resolves against an `auto` height and silently falls back to
           content, so the pane grew and the message stayed pinned to the top
           anyway. Making the pane a flex column is what actually stretches
           it. */
        display: flex;
        flex-direction: column;
      }
      .pick {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-4xs);
        flex: 1;
        padding: var(--boxel-sp-lg);
        text-align: center;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .pick-i {
        margin-bottom: var(--boxel-sp-xs);
        color: var(--muted-foreground, var(--boxel-400));
        opacity: 0.7;
      }
      .pick b {
        color: var(--foreground, var(--boxel-dark));
        font-size: var(--boxel-font-size);
      }
      .pick p {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        max-width: 44ch;
        line-height: 1.6;
      }
      /* Narrow reflows; it never deletes.
         These two breakpoints used to `display: none` the detail pane and
         then the rail, which on a phone meant the conversation and the queue
         counts simply did not exist — not moved, not collapsed, gone. Now
         both survive: the rail becomes a horizontal strip above the list, and
         the detail becomes a mode you enter and leave. */
      @container (max-width: 68rem) {
        .split {
          grid-template-columns: minmax(0, 1fr);
          grid-template-areas: 'rail' 'list' 'detail';
        }
        .split-rail {
          grid-area: rail;
          position: static;
          padding: 0 0 var(--boxel-sp-xs);
          border-right: none;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .split-list {
          grid-area: list;
        }
        .split-detail {
          grid-area: detail;
          position: static;
        }
        /* Master–detail on one column: opening a ticket swaps the list for
           the conversation, with a control back. Stacking them instead would
           mean scrolling past forty rows to read a reply. */
        .split-picked .split-list {
          display: none;
        }
        .back {
          display: inline-flex;
        }
      }
      .purpose {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
        max-width: 72ch;
        line-height: 1.6;
      }
      .shell {
        margin: 0;
        padding: var(--boxel-sp-lg) 0;
        max-width: 60ch;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }

      /* Motion here is confirmation, never decoration — a hover tint, a
         pressed nudge. Someone who has asked the OS to stop animating gets
         the same interface with the confirmation delivered instantly. */
      @media (prefers-reduced-motion: reduce) {
        * {
          transition: none !important;
          animation: none !important;
        }
      }
    </style>
  </template>
}

/**
 * The ServiceDesk console.
 *
 * Every tab is a live query. Nothing here maintains a list of what belongs in
 * it, which is the difference between a dashboard that is true and one that
 * was true when somebody last remembered to update it.
 */
export class ServiceDesk extends CardDef {
  static displayName = 'ServiceDesk';
  static icon = LifeBuoyIcon;
  // The host caps a stacked card at 50rem unless the def asks for the full
  // canvas. A support console is a master-detail surface — capping it at 800px
  // is what forced every earlier layout into a single column.
  static prefersWideFormat = true;

  @field name = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: ServiceDesk) {
      return this.name?.trim() || 'ServiceDesk';
    },
  });

  /**
   * Away from its own canvas the console is a *door*, not a dashboard.
   *
   * These three formats used to be missing entirely, so a ServiceDesk in a
   * search result, a link or a grid rendered as the platform's default box
   * with a title in it. What a reader needs there is not a smaller console —
   * it is enough to recognise the desk and to know that opening it is where
   * the work happens.
   */
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='sd-emb'>
        <LifeBuoyIcon class='sd-glyph' role='presentation' />
        <span class='sd-main'>
          <span class='sd-name'>{{@model.title}}</span>
          <span class='sd-dim'>Support console — queues, commitments and the
            knowledge base</span>
        </span>
      </article>

      <style scoped>
        .sd-emb {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-width: 0;
          padding: var(--boxel-sp-4xs) 0;
          font-family: var(--font-sans, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
        .sd-glyph {
          flex: none;
          width: 1.5rem;
          height: 1.5rem;
          /* The accent MIXED TOWARD the foreground rather than used raw.
             `--primary` alone was never contrast-checked against this ground, and
             an icon is a glyph — §2's own word for the case it forbids. Mixing in
             oklch keeps the brand read while guaranteeing the glyph resolves on a
             light or a dark ground: --foreground flips with the theme, so the mix
             flips with it. */
          color: color-mix(
            in oklch,
            var(--primary, var(--boxel-highlight)) 62%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .sd-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .sd-name {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sd-dim {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='sd-atom'>
        <LifeBuoyIcon class='sd-atom-glyph' role='presentation' />
        {{@model.title}}
      </span>

      <style scoped>
        .sd-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.3em;
          min-width: 0;
          font-family: var(--font-sans, var(--boxel-font-family));
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .sd-atom-glyph {
          flex: none;
          width: 0.9rem;
          height: 0.9rem;
          /* The accent MIXED TOWARD the foreground rather than used raw.
             `--primary` alone was never contrast-checked against this ground, and
             an icon is a glyph — §2's own word for the case it forbids. Mixing in
             oklch keeps the brand read while guaranteeing the glyph resolves on a
             light or a dark ground: --foreground flips with the theme, so the mix
             flips with it. */
          color: color-mix(
            in oklch,
            var(--primary, var(--boxel-highlight)) 62%,
            var(--foreground, var(--boxel-dark))
          );
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      {{! One grid, three regions, no container-type of its own — the host
          provides the `fitted-card` container. Only structure changes across
          the height quanta; the type scale never steps. }}
      <article class='fit'>
        <header class='r-head'>
          <LifeBuoyIcon class='r-glyph' role='presentation' />
          <h3 class='r-title'>{{@model.title}}</h3>
        </header>
        <div class='r-body'>
          <p class='r-what'>Front line, queues, commitments, business hours,
            knowledge, customers and agents — every tab a live query.</p>
        </div>
        <footer class='r-meta'>Support console</footer>
      </article>

      <style scoped>
        .fit {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          width: 100%;
          height: 100%;
          padding: 8px 10px;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --type-base: clamp(9.5px, 2.7cqi, 12px);
          --type-title: max(11px, calc(var(--type-base) * 1.25));
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: center;
          gap: 0.35em;
          min-height: 0;
          overflow: hidden;
        }
        .r-glyph {
          flex: none;
          width: 1em;
          height: 1em;
          font-size: var(--type-title);
          /* The accent MIXED TOWARD the foreground rather than used raw.
             `--primary` alone was never contrast-checked against this ground, and
             an icon is a glyph — §2's own word for the case it forbids. Mixing in
             oklch keeps the brand read while guaranteeing the glyph resolves on a
             light or a dark ground: --foreground flips with the theme, so the mix
             flips with it. */
          color: color-mix(
            in oklch,
            var(--primary, var(--boxel-highlight)) 62%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .r-title {
          margin: 0;
          min-width: 0;
          font-family: var(--font-heading, inherit);
          font-size: var(--type-title);
          font-weight: 700;
          line-height: 1.25;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .r-body {
          grid-area: body;
          min-height: 0;
          overflow: hidden;
        }
        .r-what {
          margin: 0.35em 0 0;
          font-size: var(--type-base);
          line-height: 1.45;
          color: var(--muted-foreground, var(--boxel-450));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .r-meta {
          grid-area: meta;
          min-height: 0;
          overflow: hidden;
          font-size: max(9px, calc(var(--type-base) * 0.85));
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* Badge: the name only — at 40px high anything else is a clipped
           fragment pretending to be information. */
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            grid-template-areas: 'head';
            align-content: center;
          }
          .r-body,
          .r-meta {
            display: none;
          }
          .r-title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 50px) and (height <= 80px) {
          .fit {
            grid-template-rows: auto auto;
            grid-template-areas: 'head' 'meta';
          }
          .r-body {
            display: none;
          }
          .r-title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 160px) {
          .r-what {
            -webkit-line-clamp: 4;
          }
        }
        /* Wide and short is its own layout, not a squashed tall one: the
           description moves beside the title instead of under it, and the
           content column keeps its 200px floor so it never becomes a
           two-word fragment. */
        @container fitted-card (width > 300px) and (height <= 130px) {
          .fit {
            grid-template-columns: minmax(200px, 1fr) auto;
            grid-template-areas: 'head meta' 'body meta';
            align-items: center;
          }
          .r-body {
            display: block;
          }
          .r-what {
            margin-top: 0.15em;
            -webkit-line-clamp: 1;
          }
          .r-meta {
            align-self: center;
            text-align: end;
          }
        }
        /* No width rule hides the caption.
           There was one, twice — first at every narrow size, then only at
           narrow-and-tall — and the size walk killed both: "Support console"
           is fifteen characters at 9px, so it fits inside 150px everywhere,
           and hiding it just left the bottom of those cells empty. The rule
           was solving a wrapping problem this caption does not have. */
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    get realm(): string | undefined {
      return this.args.model?.[realmURL]?.href;
    }

    <template>
      <ServiceDeskConsole
        @title={{@model.title}}
        @realm={{this.realm}}
        @context={{@context}}
      />
    </template>
  };
}
