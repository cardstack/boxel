import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import {
  BoxelInput,
  BoxelDropdown,
  Button,
  IconButton,
} from '@cardstack/boxel-ui/components';
import TrashIcon from '@cardstack/boxel-icons/trash';
import PlusIcon from '@cardstack/boxel-icons/plus';
import OpenCardIcon from '@cardstack/boxel-icons/arrow-up-right';
import type { CardContext } from '@cardstack/base/card-api';

import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { identifyCard } from '@cardstack/runtime-common';
import type { CardDef } from '@cardstack/base/card-api';

import { consume } from 'ember-provide-consume-context';
import {
  CardCrudFunctionsContextName,
  type CardCrudFunctions,
} from '@cardstack/runtime-common';

import type { Ticket } from '../ticket';
import { SupportContact } from '../support-contact';
import { SupportAgent } from '../support-agent';
import { Queue } from '../queue';
import { SlaPolicy } from '../sla-policy';
import { TicketCategory } from '../ticket-category';
import { SlaTimerBadge } from './sla-timer-badge';
import { StatePill } from './state-pill';
import { LinkPicker } from './link-picker';
import { EnumSelect } from './enum-select';
import { Feed, type FeedEntry } from './feed';
import Popover from '@cardstack/catalog/46f065-popover/popover';
import { statusHue } from '../status-field';
import { priorityOption } from '../priority-field';
import {
  TicketStatusField,
  TicketPriorityField,
  TICKET_PRIORITIES,
  TICKET_CHANNELS,
  statusIsTerminal,
} from '../ticket-taxonomy';
import { nextStatuses, statusOption } from '../status-field';
import { ReplyToTicketCommand } from '../commands/reply-to-ticket-command';
import { TransitionTicketStatusCommand } from '../commands/transition-ticket-status-command';
import { ApplySlaPolicyCommand } from '../commands/apply-sla-policy-command';
import { AutoAssignTicketCommand } from '../commands/auto-assign-ticket-command';
import { EscalateTicketCommand } from '../commands/escalate-ticket-command';
import { MergeTicketsCommand } from '../commands/merge-tickets-command';
import { SuggestKbArticlesCommand } from '../commands/suggest-kb-articles-command';
import { KnowledgeArticle } from '../knowledge-article';

type ComposeMode = 'Public' | 'Internal';

interface Signature {
  Args: {
    ticket?: Ticket;
    context?: CardContext;
    realms?: string[];
    /**
     * Called when the ticket leaves the list the reader is working.
     * Resolving it, or deleting a draft, both mean the selection now points
     * at something the queue beside it no longer shows.
     */
    onLeftQueue?: () => void;
  };
  Element: HTMLElement;
}

/**
 * The agent workspace.
 *
 * A top-level component rather than the format class, for two reasons: the
 * interactive state it holds cannot live inside `static isolated = class {…}`
 * (decorators have nowhere to install there), and the whole surface is easier
 * to reason about when the card definition just says "render this".
 *
 * The layout is THREE ZONES, not two columns. The card stack in this host is
 * about 800px wide, so a two-column workspace collapses to one column
 * essentially always — the previous version was designed for a width that
 * never occurs. Header, then a horizontal SLA slab, then the conversation as
 * the main region with a narrow rail beside it that drops below at 760px.
 */
export class TicketWorkspace extends GlimmerComponent<Signature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args as never);
    void this.loadServiceRequestClass();
  }

  @tracked composeMode: ComposeMode = 'Public';
  @tracked draft = '';
  @tracked busy: string | undefined;
  @tracked notice: string | undefined;
  @tracked problem: string | undefined;

  get ticket() {
    return this.args.ticket;
  }

  get statusHue() {
    return statusHue(TicketStatusField, this.ticket?.status);
  }

  get priorityHue() {
    return (
      priorityOption(TicketPriorityField, this.ticket?.priority)?.hue ?? 'slate'
    );
  }

  get feedEntries(): FeedEntry[] {
    return (this.ticket?.messages ?? [])
      .filter(Boolean)
      .map((message) => message.feedEntry);
  }

  get firstResponseTimer() {
    return (this.ticket?.timers ?? []).find(
      (t) => t?.kind === 'First response',
    );
  }

  get resolutionTimer() {
    return (this.ticket?.timers ?? []).find((t) => t?.kind === 'Resolution');
  }

  get suggestions() {
    let question = [this.ticket?.subject, this.ticket?.details]
      .filter(Boolean)
      .join(' ');
    return (this.ticket?.linkedArticles ?? [])
      .filter(Boolean)
      .map((article) => ({ article, score: article.relevanceTo(question) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  get isInternal() {
    return this.composeMode === 'Internal';
  }

  get sendLabel() {
    return this.isInternal ? 'Add internal note' : 'Send & set pending';
  }

  get canSend() {
    return Boolean(this.draft.trim()) && !this.busy;
  }

  setMode = (mode: ComposeMode, _event?: Event) => {
    this.composeMode = mode;
  };

  setDraft = (value: string) => {
    this.draft = value;
  };

  // The panel computes a relevance score and then, before this, made the agent
  // go find the article themselves. Both actions write into the reply the
  // agent is already composing, which is the only place the suggestion is
  // worth anything.
  citeArticle = (title: string, _event?: Event) => {
    this.composeMode = 'Public';
    let line = `You may find this helpful: ${title}.`;
    this.draft = this.draft.trim() ? `${this.draft.trim()}\n\n${line}` : line;
  };

  noteArticle = (title: string, _event?: Event) => {
    this.composeMode = 'Internal';
    let line = `Checked against: ${title}.`;
    this.draft = this.draft.trim() ? `${this.draft.trim()}\n${line}` : line;
  };

  // Handed down from the console rather than derived from the ticket's URL:
  // a support desk chooses from its own realm's contacts, and the console is
  // the thing that knows which realm that is.
  get realms(): string[] {
    return this.args.realms ?? [];
  }

  private get commandContext() {
    return this.args.context?.commandContext;
  }

  // ── In-place editing of the ticket's links and enums ────────────────────
  //
  // What is edited is always the LINK, never the flattened mirror beside it.
  // `customerName` is `computeVia` off `customer`: writing to it would edit a
  // derived value, which cannot persist and would immediately disagree with
  // the card it claims to name. Set the link and the mirror follows.

  priorities = TICKET_PRIORITIES as unknown as string[];
  channels = TICKET_CHANNELS as unknown as string[];

  contactClass = SupportContact;
  agentClass = SupportAgent;
  queueClass = Queue;
  categoryClass = TicketCategory;

  private async persist(what: string, mutate: () => void) {
    if (!this.guard()) {
      return;
    }
    this.busy = what;
    this.notice = undefined;
    try {
      mutate();
      await new SaveCardCommand(this.commandContext!).execute({
        card: this.ticket,
      } as any);
      await this.ensureSla();
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    } finally {
      this.busy = undefined;
    }
  }

  /**
   * A ticket with no clocks is measured against nothing, so the moment it has
   * enough to be measured, start them.
   *
   * The chain is category → queue → the queue's default policy, which is the
   * same route `auto-assign` walks. It runs only when there are no timers
   * yet: re-applying a policy to a running ticket would move a deadline the
   * customer was already promised.
   */
  /** The flattened attributes a policy's conditions are checked against. */
  private get policySubject(): Record<string, unknown> {
    let ticket = this.ticket;
    return {
      customerTier: ticket?.customer?.tier ?? '',
      priority: ticket?.priority ?? '',
      categoryName: ticket?.categoryName ?? '',
      queueName: ticket?.queueName ?? '',
      channel: ticket?.channel ?? '',
      ticketType: ticket?.ticketType ?? '',
    };
  }

  /**
   * Pick the policy that actually applies, in the order a desk would.
   *
   * The queue's own default first — routing is the strongest signal about
   * which promise was made — but only if its conditions match. Then any other
   * policy that matches, with an explicitly-default one last as the catch-all.
   */
  private pickPolicy(): SlaPolicy | undefined {
    let subject = this.policySubject;
    let applies = (p?: SlaPolicy) => Boolean(p && p.applies(subject));

    let queueDefault = this.ticket?.queue?.defaultPolicy;
    if (applies(queueDefault)) {
      return queueDefault;
    }
    let specific = this.policies.find((p) => !p.isDefault && applies(p));
    if (specific) {
      return specific;
    }
    return this.policies.find((p) => p.isDefault && applies(p));
  }

  /** Said once per ticket, not once per keystroke. */
  @tracked private toldNoPolicy = false;

  /**
   * In-flight guard, because `timers.length` is not one.
   *
   * The only re-entrancy check was "does this ticket already have timers",
   * which is false for both callers until the FIRST command has finished
   * writing. Picking a Category and immediately picking a Priority runs two
   * saves whose `ensureSla` calls both read zero timers, so the policy is
   * applied twice and the ticket ends up with two "First response" and two
   * "Resolution" timers — invisible in the slab, since every reader finds the
   * first match and stops.
   */
  private slaInFlight: Promise<void> | undefined;

  private async ensureSla() {
    if (this.slaInFlight) {
      await this.slaInFlight;
      return;
    }
    this.slaInFlight = this.runEnsureSla().finally(() => {
      this.slaInFlight = undefined;
    });
    await this.slaInFlight;
  }

  private async runEnsureSla() {
    let ticket = this.ticket;
    if (!ticket || (ticket.timers ?? []).length) {
      return;
    }
    let policy = this.pickPolicy();
    if (!policy) {
      // Not an error, and not something the agent can fix from here: no
      // policy in this realm covers a ticket shaped like this one. Say it
      // once — repeating it after every field edit trains people to ignore
      // the banner that will one day carry something urgent.
      if (!this.toldNoPolicy) {
        this.toldNoPolicy = true;
        this.notice =
          'Saved. No SLA policy covers this ticket yet — Setup → Commitments is where that gets fixed.';
      }
      return;
    }
    try {
      await new ApplySlaPolicyCommand(this.commandContext!).execute({
        ticket,
        policy,
      } as any);
      this.notice = `SLA started from ${policy.title}.`;
      this.toldNoPolicy = false;
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    }
  }

  /**
   * Take a ticket from a caller nobody has on file yet.
   *
   * The contact is created with just the name and linked immediately, then the
   * agent can carry on with the call. Email, company and tier are filled in
   * later by opening the contact — a form demanded mid-call is a form filled
   * with guesses. The `incomplete` marker below is what stops "later" from
   * meaning "never".
   */
  createContact = async (name: string) => {
    if (!this.guard() || !this.realms.length) {
      this.problem =
        'This ticket is not in a realm yet, so there is nowhere to put a new contact.';
      return;
    }
    this.busy = 'customer';
    this.notice = undefined;
    try {
      let contact = new SupportContact({ name });
      let saved = (await new SaveCardCommand(this.commandContext!).execute({
        card: contact,
        realm: this.realms[0],
      } as any)) as SupportContact;
      this.ticket!.customer = saved;
      await new SaveCardCommand(this.commandContext!).execute({
        card: this.ticket,
      } as any);
      await this.ensureSla();
      this.notice = `Added ${name}. Open the customer to fill in their email and company.`;
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    } finally {
      this.busy = undefined;
    }
  };

  // A contact created mid-call has a name and nothing else. Saying so where
  // the company would sit is the only thing that gets anyone to go back.
  get customerDetail(): string {
    let customer = this.ticket?.customer;
    if (!customer) {
      return '';
    }
    return customer.company?.trim() || 'Details not filled in';
  }

  setCustomer = async (card: CardDef | undefined) => {
    await this.persist('customer', () => {
      this.ticket!.customer = card as any;
    });
  };

  setAssignee = async (card: CardDef | undefined) => {
    await this.persist('assignee', () => {
      this.ticket!.assignee = card as any;
    });
  };

  // Picking a queue also adopts that queue's default policy when the ticket
  // has none — routing and the promise that comes with it are one decision to
  // the person making it, and splitting them is how tickets end up routed but
  // untimed.
  setQueue = async (card: CardDef | undefined) => {
    await this.persist('queue', () => {
      this.ticket!.queue = card as any;
      if (!this.ticket!.slaPolicy && (card as any)?.defaultPolicy) {
        this.ticket!.slaPolicy = (card as any).defaultPolicy;
      }
    });
  };

  // A category carries the routing the desk agreed on, so choosing one fills
  // an empty queue rather than overriding a queue somebody chose by hand.
  setCategory = async (card: CardDef | undefined) => {
    await this.persist('category', () => {
      this.ticket!.category = card as any;
      let fallback = (card as any)?.defaultQueue;
      if (!this.ticket!.queue && fallback) {
        this.ticket!.queue = fallback;
        if (!this.ticket!.slaPolicy && fallback.defaultPolicy) {
          this.ticket!.slaPolicy = fallback.defaultPolicy;
        }
      }
      if (!this.ticket!.priority && (card as any)?.defaultPriority) {
        this.ticket!.priority = (card as any).defaultPriority;
      }
    });
  };

  setPriority = async (value: string | undefined) => {
    await this.persist('priority', () => {
      this.ticket!.priority = value as any;
    });
  };

  setChannel = async (value: string | undefined) => {
    await this.persist('channel', () => {
      this.ticket!.channel = value as any;
    });
  };

  private guard(): boolean {
    if (!this.ticket) {
      this.problem = 'No ticket loaded.';
      return false;
    }
    if (!this.commandContext) {
      this.problem =
        'Actions are unavailable in this view — open the ticket in the workspace to reply.';
      return false;
    }
    this.problem = undefined;
    return true;
  }

  send = async (_event?: Event) => {
    if (!this.canSend || !this.guard()) {
      return;
    }
    this.busy = 'send';
    this.notice = undefined;
    try {
      let result = await new ReplyToTicketCommand(this.commandContext!).execute(
        {
          ticket: this.ticket,
          body: this.draft,
          visibility: this.composeMode,
          // A public reply moves the ticket to Pending because the ball is now
          // in the customer's court; an internal note changes nothing, because
          // nobody outside has been told anything.
          thenStatus: this.isInternal ? undefined : 'Pending',
        } as any,
      );
      this.draft = '';
      this.notice = (result as any)?.message ?? 'Sent.';
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    } finally {
      this.busy = undefined;
    }
  };

  transition = async (toStatus: string, _event?: Event) => {
    if (!this.guard()) {
      return;
    }
    this.busy = toStatus;
    this.notice = undefined;
    try {
      let result = await new TransitionTicketStatusCommand(
        this.commandContext!,
      ).execute({ ticket: this.ticket, toStatus } as any);
      this.notice = (result as any)?.message;
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    } finally {
      this.busy = undefined;
    }
  };

  /**
   * A ticket with no subject was never raised — it is the empty card the
   * "New ticket" button makes, abandoned before anyone typed what happened.
   *
   * That is the ONLY thing here that can be deleted. A real ticket is the
   * record of a promise to a customer and of whether it was kept; Closed is
   * its terminal state, not gone. Offering Delete on one would let a bad
   * afternoon be erased rather than reported.
   */
  /**
   * Settled = the work is over: Resolved, Closed or Cancelled.
   *
   * The pane deliberately stays on the ticket rather than snapping back to
   * the placeholder. Clearing it would take away the confirmation the agent
   * just earned — you press Resolve and the thing you acted on vanishes, so
   * you cannot check it worked and you cannot undo it. What changes instead
   * is what the pane OFFERS: a settled ticket is a record, so the controls
   * that would edit it go read-only and the only actions left are the ones
   * the state machine actually allows.
   */
  get isSettled(): boolean {
    let status = this.ticket?.status;
    return statusIsTerminal(status) || status === 'Resolved';
  }

  /**
   * Settled locks everything; a save in flight locks only the field being
   * saved.
   *
   * This used to be one `editingLocked` = `busy || isSettled`, which meant
   * picking a category greyed out the customer, the owner, the queue, the
   * priority and the channel until the write came back — and a write here can
   * chain into `ensureSla` and a reindex, so the whole panel sat dead for
   * seconds after a single choice. Nothing about saving the category makes
   * the queue unsafe to change.
   *
   * A settled ticket is different and stays fully locked: it is history, and
   * changing its queue after the fact silently rewrites what the reports say
   * happened. Reopen first — that is a recorded transition.
   */
  /** Locked because the ticket is closed, or because this field is in flight. */
  lockedFor = (field: string) => this.isSettled || this.busy === field;

  get canClose(): boolean {
    return this.ticket?.status === 'Resolved';
  }

  get isDraft(): boolean {
    return Boolean(this.ticket) && !this.ticket?.subject?.trim();
  }

  /**
   * Two modes, because raising a ticket and working one are different jobs.
   *
   * A ticket with no subject and nothing said on it does not exist yet — the
   * agent is on the phone hearing what happened. Showing them a reply box
   * ("the first public reply is what stops the first-response clock") is
   * advice about a ticket that has not been raised, and it left the only two
   * fields that matter — what the problem is, and what the customer actually
   * said — with nowhere to type them. Every secondary field was editable and
   * these two were not, which is why every ticket raised here stayed
   * "Untitled draft".
   *
   * Intake asks those two questions and nothing else. Working is everything
   * that comes after.
   */
  get isIntake(): boolean {
    return this.isDraft && !(this.ticket?.messages ?? []).length;
  }

  @tracked subjectDraft = '';
  @tracked detailsDraft = '';
  @tracked editingSubject = false;

  setSubjectDraft = (value: string) => {
    this.subjectDraft = value;
  };

  setDetailsDraft = (value: string) => {
    this.detailsDraft = value;
  };

  get canRaise(): boolean {
    return Boolean(this.subjectDraft.trim()) && !this.busy;
  }

  /**
   * One button ends intake: it writes what the ticket is, files the
   * customer's own words as the first message so the thread starts where the
   * conversation started, and lets `ensureSla` start the clocks.
   */
  raise = async (_event?: Event) => {
    if (!this.canRaise || !this.guard()) {
      return;
    }
    let subject = this.subjectDraft.trim();
    let details = this.detailsDraft.trim();
    this.busy = 'raise';
    try {
      this.ticket!.subject = subject;
      if (details) {
        this.ticket!.details = details;
      }
      if (!this.ticket!.openedAt) {
        this.ticket!.openedAt = new Date();
      }
      if (!this.ticket!.status) {
        this.ticket!.status = 'New' as any;
      }
      await new SaveCardCommand(this.commandContext!).execute({
        card: this.ticket,
      } as any);
      await this.ensureSla();
      this.subjectDraft = '';
      this.detailsDraft = '';
      this.notice = 'Ticket raised. Reply to start the clock on a response.';
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    } finally {
      this.busy = undefined;
    }
  };

  // Renaming afterwards is a normal correction — a subject typed from a phone
  // call is often wrong by the end of it.
  startEditingSubject = (_event?: Event) => {
    if (this.isSettled) {
      return;
    }
    this.subjectDraft = this.ticket?.subject ?? '';
    this.editingSubject = true;
  };

  cancelEditingSubject = (_event?: Event) => {
    this.editingSubject = false;
    this.subjectDraft = '';
  };

  saveSubject = async (_event?: Event) => {
    let next = this.subjectDraft.trim();
    if (!next) {
      return;
    }
    this.editingSubject = false;
    await this.persist('subject', () => {
      this.ticket!.subject = next;
    });
    this.subjectDraft = '';
  };

  @tracked confirmingDelete = false;

  /**
   * Two steps, and the second one names what is about to go.
   *
   * Deleting a ticket destroys the record of what was promised and whether it
   * was kept — Close is the terminal state that keeps it. That argument was
   * made and overruled, so the control exists; what it must not be is a
   * single click sitting beside Resolve. The first press asks, the second
   * does it, and the question repeats the reference so a mis-selected row is
   * caught before the delete rather than after.
   *
   * A native `confirm()` was the other option and is worse: it cannot be
   * themed, it blocks the tab, and browsers increasingly suppress it.
   */
  /**
   * Push the ticket onto the stack as a card in its own right.
   *
   * The workspace is a working surface; this is the escape hatch to the card
   * itself — the record view, the schema, the raw fields, the format switcher.
   * Without it the only way to inspect a ticket you are looking at is to go
   * find it again by URL.
   */
  openCard = (_event?: Event) => {
    let id = this.ticket?.id;
    if (id) {
      this.cardCrudFunctions?.viewCard?.(new URL(id));
    }
  };

  // ── The rest of the lifecycle, reachable from the UI ─────────────────────
  //
  // These five commands existed and had Specs and had never been run by a
  // person: there was no control anywhere that invoked them. A command that
  // has only ever been called from a test is not finished — the block-factory
  // bar is "exercise it from the UI and read the artifact it produced".

  /**
   * Every policy in the realm, so one can be CHOSEN rather than assumed.
   *
   * `SlaPolicy.applies()` has existed since the first version and nothing
   * ever called it to select — the code took the queue's default and applied
   * it blind. On a VIP customer that default ("Customer tier is not VIP") is
   * rejected every time, while the VIP policy sits in the same realm and
   * would have matched. The visible symptom was an error banner on every
   * save; the actual defect was that nobody picked.
   */
  private policiesQuery = this.args.context?.getCards(
    this,
    () => {
      let ref = identifyCard(SlaPolicy);
      return ref ? { filter: { type: ref } } : undefined;
    },
    () => this.args.realms ?? [],
    { isLive: true },
  );

  get policies(): SlaPolicy[] {
    return ((this.policiesQuery?.instances ?? []) as SlaPolicy[]).filter(
      Boolean,
    );
  }

  articleClass = KnowledgeArticle;
  queueClass2 = Queue;
  agentClass2 = SupportAgent;

  /**
   * The merge picker's type, taken off the instance rather than imported.
   *
   * `ticket.gts` mounts this component as its edit format, so importing the
   * Ticket class back into here is a cycle — and a cycle in a card module
   * fails as `Class extends value undefined is not a constructor`, which is
   * a crash at index time rather than a warning. Reading the constructor also
   * happens to be more correct: merging an Incident offers Incidents.
   */
  get ticketClass(): any {
    return (this.ticket as any)?.constructor;
  }

  @tracked escalating = false;
  @tracked escalateReason = '';
  @tracked escalateTarget: Queue | undefined;
  @tracked merging = false;

  /**
   * The moves this ticket can actually make, read off the transition table.
   *
   * The header used to hardcode "Pending" and "Resolve". On a ticket already
   * in Pending, that first button was a control that looked live and whose
   * command rejected it — "A ticket cannot go from Pending to Pending" — and
   * meanwhile **On Hold and Cancelled were unreachable from anywhere in the
   * app**, despite being legal transitions the whole time. Two failures with
   * one cause: the buttons were a guess about the state machine instead of a
   * reading of it.
   */
  get moves() {
    return nextStatuses(TicketStatusField, this.ticket?.status).filter(
      (o) => o.value !== 'Resolved' && o.value !== 'Closed',
    );
  }

  get canResolve(): boolean {
    return nextStatuses(TicketStatusField, this.ticket?.status).some(
      (o) => o.value === 'Resolved',
    );
  }

  /** 'Cancelled' is a state; 'Cancel' is what you press. */
  moveLabel = (value: string) => (value === 'Cancelled' ? 'Cancel' : value);

  /**
   * The two actions that are neither a status move nor routine.
   *
   * Open-as-card and Delete are NOT here: they already sit at the end of the
   * bar as icons, deliberately set apart because neither moves the ticket
   * along, and listing them twice would be two routes to one thing.
   */
  get moreActions() {
    return [
      { key: 'escalate', label: 'Escalate…' },
      { key: 'merge', label: 'Merge…' },
    ];
  }

  /**
   * What every menu row MEANS, on hover and on focus.
   *
   * Statuses read theirs off the option itself, so the queue, the badge and
   * this menu cannot describe the same status differently. The two overflow
   * actions carry theirs here because they are this component's, not the
   * status field's.
   */
  private static MORE_MEANING: Record<string, string> = {
    escalate:
      'Hand this ticket to a higher tier. Asks which queue and why, and the reason is recorded on the ticket.',
    merge:
      'Fold a duplicate into this ticket. This one survives and keeps its number; the other is closed and its conversation is merged in by time.',
  };

  menuId = `wsm-${guidFor(this)}`;
  @tracked hovered: string | undefined;

  anchorFor = (key: string) => `${this.menuId}-${key}`;

  get hoveredAnchor(): string {
    return `[data-bx-popover-anchor='${this.anchorFor(this.hovered ?? '')}']`;
  }

  get hoveredLabel(): string {
    let key = this.hovered;
    if (!key) {
      return '';
    }
    let action = this.moreActions.find((a) => a.key === key);
    if (action) {
      return action.label.replace('…', '');
    }
    return statusOption(TicketStatusField, key)?.label ?? key;
  }

  get hoveredMeaning(): string {
    let key = this.hovered;
    if (!key) {
      return '';
    }
    return (
      TicketWorkspace.MORE_MEANING[key] ??
      statusOption(TicketStatusField, key)?.meaning ??
      ''
    );
  }

  showMeaning = (key: string, _event?: Event) => {
    this.hovered = key;
  };

  hideMeaning = (_event?: Event) => {
    this.hovered = undefined;
  };

  /** Close the dropdown first, then act — the menu is gone either way. */
  pickMove = (close: () => void, value: string, _event?: Event) => {
    this.hovered = undefined;
    close();
    void this.transition(value);
  };

  runMore = (close: () => void, key: string, _event?: Event) => {
    this.hovered = undefined;
    close();
    if (key === 'escalate') {
      this.startEscalate();
    } else if (key === 'merge') {
      this.startMerge();
    }
  };

  get isUnrouted(): boolean {
    return !this.ticket?.assignee || !this.ticket?.queue;
  }

  /**
   * The CLASS, not the `ticketType` string.
   *
   * This used to read `ticketType === 'Service Request'`, which is a
   * user-editable field on any base Ticket — so setting that dropdown on a
   * plain Ticket surfaced Approve/Decline for a command whose input is
   * `linksTo(() => ServiceRequest)`. Its guards read `approvalState`, which on
   * a base Ticket is `undefined`, so every state check passed and the command
   * then wrote `approvalState`/`approvedBy`/`approvedAt` onto fields the
   * instance does not have.
   *
   * Resolved by dynamic import for the same reason `decide` uses one: a static
   * import of `ServiceRequest extends Ticket` from here closes a module cycle
   * through `ticket.gts`, which mounts this component as its edit format.
   */
  @tracked private serviceRequestClass: any;

  private async loadServiceRequestClass() {
    let { ServiceRequest } = await import('../service-request.gts');
    this.serviceRequestClass = ServiceRequest;
  }

  get isServiceRequest(): boolean {
    let cls = this.serviceRequestClass;
    return Boolean(cls && this.ticket instanceof cls);
  }

  /**
   * Returns whether the command actually succeeded.
   *
   * It used to return `void`, so every caller that dismissed a panel after
   * awaiting it dismissed on failure too: an escalate that was rejected —
   * same queue, save conflict, offline — showed the banner and then threw away
   * the chosen queue and the typed reason, leaving nothing to retry from.
   */
  private async runCommand(
    what: string,
    run: () => Promise<any>,
  ): Promise<boolean> {
    if (!this.guard()) {
      return false;
    }
    this.busy = what;
    this.notice = undefined;
    this.problem = undefined;
    try {
      let result = await run();
      this.notice = (result as any)?.message ?? 'Done.';
      return true;
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
      return false;
    } finally {
      this.busy = undefined;
    }
  }

  autoAssign = async (_event?: Event) => {
    await this.runCommand('assign', () =>
      new AutoAssignTicketCommand(this.commandContext!).execute({
        ticket: this.ticket,
      } as any),
    );
  };

  startEscalate = (_event?: Event) => {
    this.escalating = true;
    this.escalateReason = '';
    this.escalateTarget = undefined;
  };

  cancelEscalate = (_event?: Event) => {
    this.escalating = false;
  };

  setEscalateTarget = (card: any) => {
    this.escalateTarget = card as Queue;
  };

  setEscalateReason = (value: string) => {
    this.escalateReason = value;
  };

  get canEscalate(): boolean {
    return Boolean(this.escalateTarget && this.escalateReason.trim());
  }

  confirmEscalate = async (_event?: Event) => {
    if (!this.canEscalate) {
      return;
    }
    let ok = await this.runCommand('escalate', () =>
      new EscalateTicketCommand(this.commandContext!).execute({
        ticket: this.ticket,
        toQueue: this.escalateTarget,
        reason: this.escalateReason.trim(),
      } as any),
    );
    // Keep the panel — and the reason the agent typed — when it failed.
    if (ok) {
      this.escalating = false;
    }
  };

  startMerge = (_event?: Event) => {
    this.merging = true;
  };

  cancelMerge = (_event?: Event) => {
    this.merging = false;
  };

  // This ticket survives; the one picked is folded into it and closed. Said
  // that way round in the label, because merge is the one action where
  // getting the direction backwards closes the wrong ticket.
  mergeInto = async (card: any) => {
    let ok = await this.runCommand('merge', () =>
      new MergeTicketsCommand(this.commandContext!).execute({
        primary: this.ticket,
        duplicate: card,
      } as any),
    );
    if (ok) {
      this.merging = false;
    }
  };

  @tracked linkingArticle = false;

  startLinkArticle = (_event?: Event) => {
    this.linkingArticle = true;
  };

  cancelLinkArticle = (_event?: Event) => {
    this.linkingArticle = false;
  };

  /**
   * Attach an article to the ticket — the spec's "Link KB".
   *
   * Distinct from re-scoring, which only ranks what is already attached. An
   * agent who finds the right article needs it ON the ticket, so the next
   * person reading the thread sees what was consulted.
   */
  linkArticle = async (card: any) => {
    this.linkingArticle = false;
    if (!card || !this.guard()) {
      return;
    }
    let existing = (this.ticket?.linkedArticles ?? []).filter(Boolean);
    if (existing.some((a) => a?.id === card.id)) {
      this.notice = `${card.title} is already linked.`;
      return;
    }
    await this.persist('kb', () => {
      this.ticket!.linkedArticles = [...existing, card];
    });
    this.notice = `Linked ${card.title}.`;
  };

  findArticles = async (_event?: Event) => {
    await this.runCommand('kb', () =>
      new SuggestKbArticlesCommand(this.commandContext!).execute({
        ticket: this.ticket,
        candidates: this.ticket?.linkedArticles ?? [],
      } as any),
    );
  };

  /**
   * Imported at click time, not at module load.
   *
   * The approve command imports `ServiceRequest`, which `extends Ticket`, and
   * `ticket.gts` mounts this component as its edit format — so a static
   * import closes a cycle in which `ServiceRequest extends Ticket` runs while
   * `Ticket` is still undefined. That fails as
   * "Class extends value undefined is not a constructor", at index time,
   * across every ticket in the realm. A dynamic import defers the edge until
   * both modules exist.
   */
  decide = async (decision: 'Approved' | 'Declined', _event?: Event) => {
    let { ApproveServiceRequestCommand } =
      await import('../commands/approve-service-request-command.gts');
    await this.runCommand(decision, () =>
      new ApproveServiceRequestCommand(this.commandContext!).execute({
        request: this.ticket,
        approver: this.ticket?.assignee,
        decision,
        note:
          decision === 'Declined'
            ? 'Declined from the service desk.'
            : undefined,
      } as any),
    );
  };

  askDelete = (_event?: Event) => {
    this.confirmingDelete = true;
    this.problem = undefined;
  };

  cancelDelete = (_event?: Event) => {
    this.confirmingDelete = false;
  };

  get deleteLabel(): string {
    return this.isDraft ? 'Discard draft' : 'Delete ticket';
  }

  get deleteSubject(): string {
    if (this.isDraft) {
      return 'this unwritten draft';
    }
    let reference = this.ticket?.reference?.trim();
    return reference ? `ticket ${reference}` : 'this ticket';
  }

  discard = async (_event?: Event) => {
    let remove = this.cardCrudFunctions?.deleteCard;
    let id = this.ticket?.id;
    if (!remove || !id) {
      this.problem = 'Deleting is unavailable in this view.';
      return;
    }
    this.busy = 'discard';
    this.problem = undefined;
    try {
      await remove(id);
      this.confirmingDelete = false;
      this.args.onLeftQueue?.();
    } catch (error: any) {
      this.problem = error?.message ?? String(error);
    } finally {
      this.busy = undefined;
    }
  };

  // R / N / E / P are in the spec's acceptance criteria. They are also printed
  // on the buttons rather than hidden in a help screen — a shortcut nobody can
  // discover is a shortcut nobody uses.
  // Typed as `Event` because that is what `on` hands a listener; the
  // narrowing happens here rather than in the signature, where it would
  // not be assignable.
  handleKey = (raw: Event) => {
    let event = raw as KeyboardEvent;
    let target = event.target as HTMLElement | null;
    if (
      event.metaKey ||
      event.ctrlKey ||
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable
    ) {
      return;
    }
    switch (event.key.toLowerCase()) {
      case 'r':
        this.composeMode = 'Public';
        this.focusComposer();
        break;
      case 'n':
        this.composeMode = 'Internal';
        this.focusComposer();
        break;
      case 'p':
        // Only when the table allows it — a shortcut that fires a rejected
        // command is a worse lie than a button, because nothing on screen
        // explained what it would do.
        if (this.moves.some((m) => m.value === 'Pending')) {
          this.transition('Pending');
        }
        break;
      case 'e':
        // Opens the panel rather than firing: escalation needs a target queue
        // and a reason, so the shortcut gets you to the form, not past it.
        // It used to set an error telling the reader to press a button
        // instead, which is a shortcut that exists only to refuse.
        this.startEscalate();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  private focusComposer() {
    let el = document.querySelector<HTMLElement>('[data-composer-input]');
    el?.focus();
  }

  <template>
    <article
      class='ws'
      tabindex='-1'
      {{on 'keydown' this.handleKey}}
      ...attributes
    >
      <header class='ws-head'>
        <span class='ws-ref'>{{@ticket.reference}}</span>
        {{#if this.editingSubject}}
          <BoxelInput
            class='ws-title-input'
            @value={{this.subjectDraft}}
            @onInput={{this.setSubjectDraft}}
            @onBlur={{this.saveSubject}}
            @placeholder='What is the problem?'
          />
        {{else if this.isIntake}}
          <h1 class='ws-title ws-untitled'>New ticket</h1>
        {{else}}
          {{! The subject is the one thing everyone reads, so it is also the
              one thing you can correct in place — a line typed during a phone
              call is often wrong by the time the call ends. }}
          <button
            type='button'
            class='ws-title ws-title-btn
              {{unless @ticket.subject "ws-untitled"}}'
            disabled={{this.lockedFor 'subject'}}
            title='Rename this ticket'
            {{on 'click' this.startEditingSubject}}
          >{{if @ticket.subject @ticket.subject 'Untitled draft'}}</button>
        {{/if}}
        <StatePill
          @label={{@ticket.priority}}
          @hue={{this.priorityHue}}
          @emphatic={{true}}
        />
        {{! Status and type are chrome: read once on arrival. Painting them
            costs priority and the SLA clock the contrast they need.
            They are told apart by SHAPE, not by colour. Two identical grey
            pills side by side read as one phrase — "Pending Incident" — and
            adding a hue to separate them would put a third colour on a bar
            whose whole point is that P1 and the SLA clock own the contrast.
            So status stays a pill, because it is a state that changes; the
            type becomes plain text after a divider, because it is a
            classification that does not. }}
        <StatePill @label={{@ticket.status}} @chrome={{true}} />
        {{#if @ticket.ticketType}}
          <span class='ws-type'>{{@ticket.ticketType}}</span>
        {{/if}}

        {{! Three routine moves in one segmented group, then the one that ends
            the ticket standing on its own.
            Before this they were four equal pills and the shortcut letters were
            jammed against their labels with no gap, so "ReplyR" read as a typo
            rather than a hint. Resolve was also the same green as the section
            nav, which meant the loudest thing on two different bars was a
            different kind of thing. Now: the group is quiet, Resolve is the
            only filled control on the ticket, and the letters sit apart from
            the words as the quiet chips they are.
            Raw buttons in the group for the same reason the view toggle uses
            them — joined segments with hairlines between, which is a container
            decision rather than a per-button one. Resolve stays boxel-ui's
            Button, which owns the loading and disabled semantics. }}
        <nav class='ws-actions' aria-label='Ticket actions'>
          {{#if this.isIntake}}
            {{! Nothing to reply to and nothing to resolve — the ticket has not
                been raised yet. The only move available is to abandon it. }}
          {{else if this.isSettled}}
            {{! The transition table allows Resolved → Closed | Open and
                Closed → Open, and nothing else. Rendering Reply / Pending /
                Resolve here would be four controls that look live and are
                rejected the moment they are pressed. }}
            <Button
              @kind='secondary'
              @size='small'
              @loading={{if (eq this.busy 'Open') true false}}
              @disabled={{if this.busy true false}}
              {{on 'click' (fn this.transition 'Open')}}
            >Reopen</Button>
            {{#if this.canClose}}
              <Button
                @kind='secondary'
                @size='small'
                @loading={{if (eq this.busy 'Closed') true false}}
                @disabled={{if this.busy true false}}
                {{on 'click' (fn this.transition 'Closed')}}
              >Close</Button>
            {{/if}}
          {{else}}
            {{! Reply / Note used to live here as two more pills. They are not
                actions on the ticket at all — they choose which tab the
                composer at the BOTTOM of this pane is on, and that composer
                already shows the same two choices where the typing happens.
                Two controls for one decision, one of them far from its
                effect. Removed; R and N still work as shortcuts. }}
            {{#if this.isUnrouted}}
              {{! Only offered while it would do something — a ticket that
                  already has an owner and a queue has nothing to auto-assign. }}
              <Button
                @kind='secondary'
                @size='small'
                @loading={{if (eq this.busy 'assign') true false}}
                @disabled={{if this.busy true false}}
                {{on 'click' this.autoAssign}}
              >Auto-assign</Button>
            {{/if}}
            {{#if this.isServiceRequest}}
              <Button
                @kind='secondary'
                @size='small'
                @loading={{if (eq this.busy 'Declined') true false}}
                @disabled={{if this.busy true false}}
                {{on 'click' (fn this.decide 'Declined')}}
              >Decline</Button>
              <Button
                @kind='secondary'
                @size='small'
                @loading={{if (eq this.busy 'Approved') true false}}
                @disabled={{if this.busy true false}}
                {{on 'click' (fn this.decide 'Approved')}}
              >Approve</Button>
            {{/if}}
            {{! Two menus instead of a row of status pills.
                Open / On Hold / Cancel were secondary buttons sitting between
                Reply and Merge, which said they were all the same kind of
                verb. They are not: a status move changes where the ticket IS,
                Escalate changes who OWNS it, Merge and Delete change what the
                record IS. Three kinds, three affordances. The menu is the
                transition table rendered — an illegal move is simply absent,
                which is why "Pending → Pending" can no longer be offered. }}
            {{#if this.moves.length}}
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <Button
                    class='ws-menu-trigger'
                    @kind='secondary'
                    @size='small'
                    @disabled={{if this.busy true false}}
                    {{bindings}}
                  >
                    Move to
                    <DropdownArrowDown width='11' height='11' />
                  </Button>
                </:trigger>
                <:content as |dd|>
                  {{! Own markup rather than boxel-ui's Menu, for one reason:
                      every row has to be a popover ANCHOR, and Menu renders
                      the row itself so there is nowhere to put the attribute.
                      Menu's `subtext` was the first attempt and it set the
                      label and the explanation side by side — a one-word
                      status next to a wrapped sentence, with the explanation
                      dominating the choice. Labels only now, meaning on
                      hover, exactly as the queue's P-chips do it. }}
                  <ul class='ws-menu' role='menu' aria-label='Move this ticket'>
                    {{#each this.moves key='value' as |move|}}
                      <li role='none'>
                        <button
                          type='button'
                          role='menuitem'
                          class='ws-mi'
                          data-bx-popover-anchor={{this.anchorFor move.value}}
                          disabled={{if this.busy true false}}
                          {{on 'click' (fn this.pickMove dd.close move.value)}}
                          {{on 'mouseenter' (fn this.showMeaning move.value)}}
                          {{on 'mouseleave' this.hideMeaning}}
                          {{on 'focus' (fn this.showMeaning move.value)}}
                          {{on 'blur' this.hideMeaning}}
                        >{{this.moveLabel move.value}}</button>
                      </li>
                    {{/each}}
                  </ul>
                </:content>
              </BoxelDropdown>
            {{/if}}
            {{! Escalate and Merge: rare, and each commits to more than a
                status move does. Behind an overflow rather than permanently
                occupying the bar. }}
            <BoxelDropdown>
              <:trigger as |bindings|>
                <Button
                  class='ws-menu-trigger ws-more'
                  @kind='secondary'
                  @size='small'
                  aria-label='More actions'
                  @disabled={{if this.busy true false}}
                  {{bindings}}
                >⋯</Button>
              </:trigger>
              <:content as |dd|>
                <ul class='ws-menu' role='menu' aria-label='More actions'>
                  {{#each this.moreActions key='key' as |item|}}
                    <li role='none'>
                      <button
                        type='button'
                        role='menuitem'
                        class='ws-mi'
                        data-bx-popover-anchor={{this.anchorFor item.key}}
                        disabled={{if this.busy true false}}
                        {{on 'click' (fn this.runMore dd.close item.key)}}
                        {{on 'mouseenter' (fn this.showMeaning item.key)}}
                        {{on 'mouseleave' this.hideMeaning}}
                        {{on 'focus' (fn this.showMeaning item.key)}}
                        {{on 'blur' this.hideMeaning}}
                      >{{item.label}}</button>
                    </li>
                  {{/each}}
                </ul>
              </:content>
            </BoxelDropdown>
            {{! One popover, re-anchored to whichever row is hovered — the
                same shape the queue's P-chips use, and for the same reason:
                only one can ever be open. }}
            <Popover
              @anchor={{this.hoveredAnchor}}
              @open={{if this.hovered true false}}
              @kind='details'
              @anchoring='beside'
              @placement='right-start'
              @size='auto'
              @autoFocus={{false}}
              @label='What this does'
            >
              <:details>
                <div class='minfo'>
                  <b class='minfo-h'>{{this.hoveredLabel}}</b>
                  <p class='minfo-p'>{{this.hoveredMeaning}}</p>
                </div>
              </:details>
            </Popover>
            {{#if this.canResolve}}
              <Button
                @kind='primary'
                @size='small'
                @loading={{if (eq this.busy 'Resolved') true false}}
                @disabled={{if this.busy true false}}
                {{on 'click' (fn this.transition 'Resolved')}}
              >Resolve</Button>
            {{/if}}
          {{/if}}
          {{! Set apart from the workflow controls: neither of these moves the
              ticket along — one leaves it, one ends it. }}
          <IconButton
            class='open-card'
            type='button'
            aria-label='Open this ticket as a card'
            @disabled={{if this.isIntake true false}}
            {{on 'click' this.openCard}}
          ><OpenCardIcon class='del-icon' /></IconButton>
          <IconButton
            class='del'
            type='button'
            aria-label={{this.deleteLabel}}
            @disabled={{if this.busy true false}}
            {{on 'click' this.askDelete}}
          ><TrashIcon class='del-icon' /></IconButton>
        </nav>
      </header>

      {{! The four facts an agent checks in the first three seconds, on one
          horizontal line. Stacked in a narrow rail the second timer always
          fell below the fold. }}
      <section class='slab' aria-label='Ticket summary'>
        {{! The two ends of the slab are editable in place. They are the
            fields an agent fills while the customer is still on the phone, so
            they have to be beside the conversation — not behind an Edit that
            replaces the whole screen. }}
        <div class='slab-cell'>
          <LinkPicker
            @label='Customer'
            @value={{@ticket.customer}}
            @emptyLabel='Unlinked'
            @detail={{this.customerDetail}}
            @cardClass={{this.contactClass}}
            @context={{@context}}
            @realms={{this.realms}}
            @onPick={{this.setCustomer}}
            @onCreate={{this.createContact}}
            @createNoun='customer'
            @disabled={{this.lockedFor 'customer'}}
          />
        </div>
        <div class='slab-cell'>
          <span class='lb'>First response</span>
          <SlaTimerBadge
            @facts={{this.firstResponseTimer}}
            @live={{true}}
            @showBar={{true}}
          />
        </div>
        <div class='slab-cell'>
          <span class='lb'>Resolution</span>
          <SlaTimerBadge
            @facts={{this.resolutionTimer}}
            @live={{true}}
            @showBar={{true}}
          />
        </div>
        <div class='slab-cell slab-pair'>
          <LinkPicker
            @label='Owner'
            @value={{@ticket.assignee}}
            @emptyLabel='Unclaimed'
            @cardClass={{this.agentClass}}
            @context={{@context}}
            @realms={{this.realms}}
            @onPick={{this.setAssignee}}
            @disabled={{this.lockedFor 'assignee'}}
          />
          <LinkPicker
            @label='Queue'
            @value={{@ticket.queue}}
            @emptyLabel='Unrouted'
            @cardClass={{this.queueClass}}
            @context={{@context}}
            @realms={{this.realms}}
            @onPick={{this.setQueue}}
            @disabled={{this.lockedFor 'queue'}}
          />
        </div>
      </section>

      {{#if this.escalating}}
        {{! Escalation is a handover: it needs somewhere to go and a reason
            the receiving tier can act on, so neither is optional. }}
        <div class='confirm confirm-neutral' role='group' aria-label='Escalate'>
          <span class='esc-field'>
            <LinkPicker
              @label='To queue'
              @value={{this.escalateTarget}}
              @emptyLabel='Pick a queue'
              @cardClass={{this.queueClass2}}
              @context={{@context}}
              @realms={{this.realms}}
              @onPick={{this.setEscalateTarget}}
            />
          </span>
          <span class='esc-why'>
            <label class='sr-only' for='esc-reason'>Why this tier cannot resolve
              it</label>
            <BoxelInput
              id='esc-reason'
              @value={{this.escalateReason}}
              @onInput={{this.setEscalateReason}}
              @placeholder='Why this tier cannot resolve it'
            />
          </span>
          <span class='confirm-acts'>
            <Button
              @kind='secondary'
              @size='small'
              {{on 'click' this.cancelEscalate}}
            >Cancel</Button>
            <Button
              @kind='primary'
              @size='small'
              @loading={{if (eq this.busy 'escalate') true false}}
              @disabled={{not this.canEscalate}}
              {{on 'click' this.confirmEscalate}}
            >Escalate</Button>
          </span>
        </div>
      {{/if}}

      {{#if this.merging}}
        <div class='confirm confirm-neutral' role='group' aria-label='Merge'>
          <span class='esc-field'>
            <LinkPicker
              @label='Fold into this one'
              @value={{undefined}}
              @emptyLabel='Pick the duplicate'
              @cardClass={{this.ticketClass}}
              @context={{@context}}
              @realms={{this.realms}}
              @onPick={{this.mergeInto}}
            />
          </span>
          <p class='confirm-q'>The ticket you pick is closed and its
            conversation is folded into this one.</p>
          <span class='confirm-acts'>
            <Button
              @kind='secondary'
              @size='small'
              {{on 'click' this.cancelMerge}}
            >Cancel</Button>
          </span>
        </div>
      {{/if}}

      {{#if this.confirmingDelete}}
        <div class='confirm' role='alertdialog' aria-label='Confirm delete'>
          <p class='confirm-q'>
            <b>Delete {{this.deleteSubject}}?</b>
            {{#unless this.isDraft}}
              This removes the conversation and the record of what was promised.
              It cannot be undone — Close keeps the ticket and its history
              instead.
            {{/unless}}
          </p>
          <span class='confirm-acts'>
            <Button
              @kind='secondary'
              @size='small'
              {{on 'click' this.cancelDelete}}
            >Cancel</Button>
            <Button
              @kind='destructive'
              @size='small'
              @loading={{if (eq this.busy 'discard') true false}}
              {{on 'click' this.discard}}
            >{{this.deleteLabel}}</Button>
          </span>
        </div>
      {{/if}}

      {{#if this.problem}}
        <p class='banner banner-bad' role='alert'>{{this.problem}}</p>
      {{else if this.notice}}
        <p class='banner banner-ok' role='status'>{{this.notice}}</p>
      {{/if}}

      <div class='ws-body'>
        <main class='thread'>
          {{#if this.isIntake}}
            <section class='intake' aria-label='Raise a ticket'>
              <h2 class='intake-h'>What happened?</h2>
              <p class='intake-lede'>Two things and the ticket exists. Routing
                and priority can follow — they are already filled in from the
                category.</p>

              <label class='intake-lb' for='intake-subject'>Subject</label>
              <BoxelInput
                id='intake-subject'
                class='intake-subject'
                @value={{this.subjectDraft}}
                @onInput={{this.setSubjectDraft}}
                @placeholder='One line, in the customer’s words'
              />

              <label class='intake-lb' for='intake-details'>What the customer
                said</label>
              <BoxelInput
                id='intake-details'
                @type='textarea'
                @value={{this.detailsDraft}}
                @onInput={{this.setDetailsDraft}}
                @placeholder='The detail as they gave it — symptoms, when it started, what they already tried.'
              />

              <div class='intake-foot'>
                <span class='intake-hint'>Raising it starts the clocks against
                  the queue’s policy.</span>
                <Button
                  @kind='primary'
                  @size='small'
                  @loading={{if (eq this.busy 'raise') true false}}
                  @disabled={{not this.canRaise}}
                  {{on 'click' this.raise}}
                >Raise ticket</Button>
              </div>
            </section>
          {{else}}
            <h2 class='sr-only'>Conversation</h2>
            <Feed
              @entries={{this.feedEntries}}
              @emptyMessage='No conversation yet. The first public reply is what stops the first-response clock.'
            />

            {{#if this.isSettled}}
              {{! Not a disabled textarea. A greyed-out box invites the reader to
                work out why they cannot type; a sentence tells them, and the
                one control offers the move that would let them. }}
              <div class='settled' role='status'>
                <b>This ticket is {{@ticket.status}}.</b>
                <p>The conversation is closed. Reopen it to reply — the reopen
                  is recorded, so the history stays true.</p>
                <Button
                  @kind='secondary'
                  @size='small'
                  @loading={{if (eq this.busy 'Open') true false}}
                  {{on 'click' (fn this.transition 'Open')}}
                >Reopen to reply</Button>
              </div>
            {{else}}
              <div class='composer {{if this.isInternal "composer-internal"}}'>
                {{! Raw buttons with role=tab: these are TABS, not actions —
                boxel-ui's Button would announce them as buttons and lose the
                selected state that carries the public/internal distinction. }}
                <div class='comp-tabs' role='tablist' aria-label='Reply mode'>
                  <button
                    type='button'
                    role='tab'
                    class='comp-tab {{unless this.isInternal "on"}}'
                    aria-selected={{if this.isInternal 'false' 'true'}}
                    {{on 'click' (fn this.setMode 'Public')}}
                  >Public reply<span
                      class='key'
                      aria-hidden='true'
                    >R</span></button>
                  <button
                    type='button'
                    role='tab'
                    class='comp-tab {{if this.isInternal "on"}}'
                    aria-selected={{if this.isInternal 'true' 'false'}}
                    {{on 'click' (fn this.setMode 'Internal')}}
                  >Internal note<span
                      class='key'
                      aria-hidden='true'
                    >N</span></button>
                  {{#if this.isInternal}}
                    <span class='comp-warn'>Only agents can see this</span>
                  {{/if}}
                </div>

                <label class='sr-only' for='ticket-draft'>
                  {{if this.isInternal 'Internal note' 'Reply to the customer'}}
                </label>
                <BoxelInput
                  id='ticket-draft'
                  data-composer-input
                  @type='textarea'
                  @value={{this.draft}}
                  @onInput={{this.setDraft}}
                  @placeholder={{if
                    this.isInternal
                    'What the customer should not see…'
                    'Write a reply…'
                  }}
                />

                <div class='comp-foot'>
                  <span class='comp-hint'>{{if
                      this.isInternal
                      'Does not stop the first-response clock.'
                      'Sending answers the customer and pauses the clock.'
                    }}</span>
                  <Button
                    @kind='primary'
                    @size='small'
                    @loading={{if (eq this.busy 'send') true false}}
                    @disabled={{not this.canSend}}
                    {{on 'click' this.send}}
                  >{{this.sendLabel}}</Button>
                </div>
              </div>
            {{/if}}
          {{/if}}
        </main>

        <aside class='rail' aria-label='Ticket context'>
          <section class='rail-block'>
            <h2>Suggested reading</h2>
            {{#unless this.isSettled}}
              <div class='kb-tools'>
                {{! Two different jobs, named as such: attach an article to
                    this ticket, versus re-rank the ones already attached.
                    They were two bare `text-only` buttons sitting under a
                    heading, which is indistinguishable from a second heading —
                    bold text with no edge reads as a label, not a control.
                    The attach action gets a real outline; re-ranking stays
                    quiet, because it is the rarer of the two and only makes
                    sense once something is attached. }}
                <Button
                  class='kb-add'
                  @kind='secondary'
                  @size='extra-small'
                  {{on 'click' this.startLinkArticle}}
                >
                  <PlusIcon width='12' height='12' aria-hidden='true' />
                  Link an article
                </Button>
                <Button
                  class='kb-rerank'
                  @kind='text-only'
                  @size='extra-small'
                  @disabled={{if (not this.suggestions.length) true false}}
                  @loading={{if (eq this.busy 'kb') true false}}
                  title='Score the attached articles against this ticket again'
                  {{on 'click' this.findArticles}}
                >Re-rank</Button>
              </div>
              {{#if this.linkingArticle}}
                <LinkPicker
                  @label='Article'
                  @emptyLabel='Search the knowledge base'
                  @cardClass={{this.articleClass}}
                  @context={{@context}}
                  @realms={{this.realms}}
                  @onPick={{this.linkArticle}}
                />
                <Button
                  @kind='text-only'
                  @size='extra-small'
                  {{on 'click' this.cancelLinkArticle}}
                >Cancel</Button>
              {{/if}}
            {{/unless}}
            {{#if this.suggestions.length}}
              <ul class='kb'>
                {{#each this.suggestions as |suggestion|}}
                  <li class='kb-item'>
                    <span class='kb-line'>
                      <span class='kb-title'>{{suggestion.article.title}}</span>
                      <span class='kb-score'>{{suggestion.score}}%</span>
                    </span>
                    {{! Hidden once the ticket is settled: both of these write
                        into the composer, and a settled ticket has no
                        composer to write into. }}
                    {{#unless this.isSettled}}
                      <span class='kb-acts'>
                        <Button
                          @kind='secondary'
                          @size='extra-small'
                          {{on
                            'click'
                            (fn this.citeArticle suggestion.article.title)
                          }}
                        >Cite in reply</Button>
                        <Button
                          @kind='secondary'
                          @size='extra-small'
                          {{on
                            'click'
                            (fn this.noteArticle suggestion.article.title)
                          }}
                        >Note it</Button>
                      </span>
                    {{/unless}}
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='rail-empty'>Nothing matched. That gap is an article
                somebody should write.</p>
            {{/if}}
          </section>

          <section class='rail-block'>
            <h2>Details</h2>
            <div class='edits'>
              <LinkPicker
                @label='Category'
                @value={{@ticket.category}}
                @emptyLabel='Uncategorised'
                @cardClass={{this.categoryClass}}
                @context={{@context}}
                @realms={{this.realms}}
                @onPick={{this.setCategory}}
                @disabled={{this.lockedFor 'category'}}
              />
              <EnumSelect
                @label='Priority'
                @value={{@ticket.priority}}
                @options={{this.priorities}}
                @emptyLabel='Unset'
                @onChange={{this.setPriority}}
                @disabled={{this.lockedFor 'priority'}}
              />
              <EnumSelect
                @label='Channel'
                @value={{@ticket.channel}}
                @options={{this.channels}}
                @emptyLabel='Unset'
                @onChange={{this.setChannel}}
                @disabled={{this.lockedFor 'channel'}}
              />
            </div>
            {{! Opened stays read-only: it is a fact about what happened, not
                a setting. }}
            <dl class='facts'>
              <div><dt>Opened</dt><dd>{{if
                    @ticket.ageLabel
                    @ticket.ageLabel
                    '—'
                  }}</dd></div>
            </dl>
            {{#if @ticket.tags.length}}
              <ul class='tags'>
                {{#each @ticket.tags as |tag|}}<li>{{tag}}</li>{{/each}}
              </ul>
            {{/if}}
          </section>
        </aside>
      </div>
    </article>

    <style scoped>
      .ws {
        container-name: ws;
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        min-height: 100%;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      .ws:focus {
        outline: none;
      }
      .ws-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        flex-wrap: wrap;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--border, var(--boxel-200));
        background: var(--card, var(--boxel-light));
        position: sticky;
        top: 0;
        z-index: 2;
      }
      .ws-ref {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        font-variant-numeric: tabular-nums;
      }
      .ws-title {
        margin: 0;
        flex: 1;
        min-width: 10rem;
        font-family: var(--font-heading, inherit);
        font-size: var(--boxel-font-size);
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      /* A draft says so in the title rather than showing a blank where the
         subject goes — a heading with nothing in it reads as a failure to
         load, not as a form nobody finished. */
      .ws-untitled {
        font-style: italic;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ws-title-btn {
        padding: 0;
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: text;
      }
      .ws-title-btn:disabled {
        cursor: default;
      }
      .ws-title-btn:hover:not(:disabled) {
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 3px;
      }
      .ws-title-input {
        flex: 1;
        min-width: 12rem;
      }
      /* Intake is a form, so it gets a form's rhythm: one question per line,
         the important one first and focused. */
      .intake {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 6px);
        background: var(--card, var(--boxel-light));
      }
      .intake-h {
        margin: 0;
        font-family: var(--font-heading, inherit);
        font-size: var(--boxel-font-size);
        font-weight: 700;
      }
      .intake-lede {
        margin: 0 0 var(--boxel-sp-xs);
        max-width: 56ch;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .intake-lb {
        margin-top: var(--boxel-sp-xs);
        font-size: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .intake-foot {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
      }
      .intake-hint {
        flex: 1;
        min-width: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      /* A divider rather than a gap: whitespace alone was what let the two
         run together into one phrase in the first place. */
      .ws-type {
        display: inline-flex;
        align-items: center;
        gap: 0.5em;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
      }
      .ws-type::before {
        content: '';
        width: 1px;
        height: 0.9em;
        background: var(--border, var(--boxel-300));
      }
      .ws-actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      /* The two menu triggers. Skinned to sit BELOW Resolve in weight —
         Resolve is the one filled control on this ticket and nothing else may
         compete with it — but above plain text, because both open something. */
      .ws-menu-trigger {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        --boxel-button-border: 1px solid var(--border, var(--boxel-300));
        --boxel-button-secondary-background: var(--card, var(--boxel-light));
        white-space: nowrap;
      }
      .ws-more {
        --boxel-button-min-width: 0;
        padding-inline: 0.55rem;
        font-size: var(--boxel-font-size);
        line-height: 1;
      }
      /* The menu list. Own markup (see the template), so the surface, radius
         and shadow come from the popover listing the dropdown renders into —
         only the rows are styled here. */
      .ws-menu {
        list-style: none;
        margin: 0;
        padding: var(--boxel-sp-5xs, 4px);
        min-width: 11rem;
      }
      .ws-mi {
        display: block;
        width: 100%;
        padding: 5px 9px;
        border: none;
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: none;
        color: var(--foreground, var(--boxel-dark));
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        text-align: start;
        white-space: nowrap;
        cursor: pointer;
      }
      .ws-mi:hover:not(:disabled),
      .ws-mi:focus-visible {
        background: var(--muted, var(--boxel-100));
      }
      .ws-mi:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .ws-mi:disabled {
        color: var(--muted-foreground, var(--boxel-450));
        cursor: default;
      }
      /* The hover explanation. Same shape as the queue's priority popover so
         the two teach the same way. */
      /* The popover listing deliberately owns NO padding — the editor panes
         it also hosts supply their own so a picker can reach the edges. Every
         content block therefore has to pad itself, the way the queue's
         `.pinfo` does. */
      .minfo {
        max-width: 19rem;
        padding: var(--boxel-sp-xs);
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      .minfo-h {
        display: block;
        font-size: var(--boxel-font-size-sm);
        color: var(--foreground, var(--boxel-dark));
      }
      .minfo-p {
        margin: 3px 0 0;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.5;
        color: var(--muted-foreground, var(--boxel-450));
      }
      /* A tab cannot contain semantic descendants, so the shortcut inside one
         is a span wearing kbd's clothes rather than a real <kbd>. Hidden from
         assistive tech: the letter is a visual affordance, and read aloud it
         turns "Internal note" into "Internal note N". */
      .key {
        margin-inline-start: 0.45em;
        padding: 0.1em 0.32em;
        border-radius: 3px;
        background: var(--muted, var(--boxel-100));
        color: var(--muted-foreground, var(--boxel-450));
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.625rem;
        font-weight: 700;
        line-height: 1.4;
      }
      /* A hint, not a second label: it sits apart from the word, in a filled
         chip rather than an outline, so it reads as belonging to the keyboard
         rather than to the sentence. */
      kbd {
        padding: 0.1em 0.32em;
        border-radius: 3px;
        background: var(--muted, var(--boxel-100));
        color: var(--muted-foreground, var(--boxel-450));
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.5625rem;
        line-height: 1.5;
      }

      .slab {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
        border-bottom: 1px solid var(--border, var(--boxel-200));
        background: var(--muted, var(--boxel-100));
      }
      /* No rules between the cells: they are already aligned columns with
         whitespace around them, so the vertical lines were decoration. */
      .slab-cell {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .lb {
        font-size: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .slab-strong {
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .slab-dim {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Two pickers share the Owner cell; they are one decision (who, and in
         which basket) and reading them apart costs a scan across the slab. */
      .slab-pair {
        display: flex;
        flex-direction: row;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
      }
      .edits {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }

      .open-card {
        --boxel-icon-button-width: 1.75rem;
        --boxel-icon-button-height: 1.75rem;
        --boxel-icon-button-color: var(--muted-foreground, var(--boxel-450));
        margin-left: var(--boxel-sp-4xs);
      }
      .open-card:hover:not(:disabled) {
        --boxel-icon-button-color: var(--primary, var(--boxel-highlight));
      }
      .del {
        --boxel-icon-button-width: 1.75rem;
        --boxel-icon-button-height: 1.75rem;
        --boxel-icon-button-color: var(--muted-foreground, var(--boxel-450));
        margin-left: var(--boxel-sp-4xs);
      }
      .del:hover:not(:disabled) {
        --boxel-icon-button-color: var(--boxel-danger);
      }
      .del-icon {
        width: 0.95rem;
        height: 0.95rem;
      }
      /* Sits across the top of the pane rather than in a floating dialog: the
         question is about the ticket you are looking at, and it should not
         cover it up while you decide. */
      .confirm {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--boxel-danger);
        background: color-mix(
          in oklch,
          var(--boxel-danger) 10%,
          var(--background, var(--boxel-light))
        );
      }
      .confirm-neutral {
        border-bottom-color: var(--border, var(--boxel-200));
        background: var(--muted, var(--boxel-100));
      }
      .esc-field {
        flex: none;
        min-width: 10rem;
      }
      .esc-why {
        flex: 1;
        min-width: 14rem;
      }
      .confirm-q {
        flex: 1;
        min-width: 16rem;
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.55;
        color: var(--foreground, var(--boxel-dark));
      }
      .confirm-acts {
        display: flex;
        gap: var(--boxel-sp-4xs);
      }
      .banner {
        margin: 0;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-xs);
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .banner-bad {
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
      .banner-ok {
        background: color-mix(
          in oklch,
          var(--boxel-success) 12%,
          var(--background, var(--boxel-light))
        );
        color: color-mix(
          in oklch,
          var(--boxel-success) 45%,
          var(--foreground, var(--boxel-dark))
        );
      }

      .ws-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 15rem;
        flex: 1;
        min-height: 0;
      }
      .thread {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
        min-width: 0;
      }
      /* The counter-intuitive part of a wide canvas: without a measure cap,
         wider is WORSE. At 1200px a message runs to ~150 characters a line and
         the eye loses the return sweep. 70ch is where prose reads fastest; the
         space to the right is the knowledge rail's, not wasted. */
      .thread > * {
        max-width: 70ch;
        width: 100%;
      }
      .rail {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-sm);
        border-left: 1px solid var(--border, var(--boxel-200));
        background: var(--muted, var(--boxel-100));
      }
      .rail-block {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      h2 {
        margin: 0;
        font-size: 0.5625rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rail-empty {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.55;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .kb-tools {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-4xs);
        margin-bottom: var(--boxel-sp-xxs);
      }
      .kb-add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        --boxel-button-border: 1px solid var(--border, var(--boxel-300));
        --boxel-button-secondary-background: var(--card, var(--boxel-light));
        white-space: nowrap;
      }
      /* Pushed to the far end and kept quiet: it is the secondary of the two,
         and butting them together made a pair of equals. */
      .kb-rerank {
        margin-inline-start: auto;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .kb {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .kb-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: var(--boxel-font-size-xs);
        padding: 4px 0;
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .kb-line {
        display: flex;
        gap: var(--boxel-sp-4xs);
        align-items: baseline;
        min-width: 0;
      }
      .kb-acts {
        display: flex;
        gap: 3px;
      }
      .kb-title {
        flex: 1;
        min-width: 0;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* A score is data, and data does not get a brand hue: `--primary` as text
         has no contrast guarantee against `--background` (boxel-theming §2).
         Tabular figures at weight 700 on `--foreground` is what makes a number
         read as a number. */
      .kb-score {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        color: var(--foreground, var(--boxel-dark));
      }
      .facts {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .facts > div {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .facts dt {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .facts dd {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        overflow-wrap: anywhere;
        text-align: end;
      }
      .tags {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
      }
      .tags li {
        padding: 0.05em 0.4em;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: 999px;
        font-size: 0.625rem;
        color: var(--muted-foreground, var(--boxel-450));
      }

      /* Reads as a closing note on the conversation, not as a broken form. */
      .settled {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-left: 3px solid var(--boxel-success);
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: var(--card, var(--boxel-light));
      }
      .settled p {
        margin: 0;
        max-width: 52ch;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .composer {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 4px);
        padding: var(--boxel-sp-4xs);
        background: var(--card, var(--boxel-light));
        position: sticky;
        bottom: 0;
      }
      /* Internal mode tints the whole composer. Public-versus-internal is the
         costliest mistake available in this interface, so the current mode is
         a place and a colour, not a word in a dropdown. */
      .composer-internal {
        background: color-mix(
          in oklch,
          var(--boxel-warning) 8%,
          var(--card, var(--boxel-light))
        );
        border-color: var(--boxel-warning);
      }
      .comp-tabs {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .comp-tab {
        padding: 0.2rem 0.55rem;
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        color: var(--muted-foreground, var(--boxel-450));
        font-family: inherit;
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        cursor: pointer;
      }
      .comp-tab.on {
        color: var(--foreground, var(--boxel-dark));
        border-bottom-color: var(--primary, var(--boxel-highlight));
      }
      /* Same reasoning as the panel tabs: hover previews what `.comp-tab.on`
         becomes. Reply mode is a choice made before typing, so the control has to
         look reachable at rest and respond on approach. */
      .comp-tab:hover {
        color: var(--foreground, var(--boxel-dark));
      }
      .comp-tab:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .comp-warn {
        margin-left: auto;
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--boxel-warning);
      }
      .comp-foot {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .comp-hint {
        flex: 1;
        min-width: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      /* The rail goes under the conversation before it gets too narrow to
         hold a value. 760px, not 832 — the stack is ~800 and the rail must
         survive there, which is the whole point of this rewrite. */
      @container ws (max-width: 47.5rem) {
        .ws-body {
          grid-template-columns: 1fr;
        }
        .rail {
          border-left: none;
          border-top: 1px solid var(--border, var(--boxel-200));
        }
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

export default TicketWorkspace;
