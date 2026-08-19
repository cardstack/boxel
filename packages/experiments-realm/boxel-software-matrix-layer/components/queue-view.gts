import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { consume } from 'ember-provide-consume-context';
import { debounce } from 'lodash-es';
import { slaClock } from '../utils/sla-clock';
import { concat } from '@ember/helper';
import { array } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  BoxelInput,
  Button,
  SkeletonPlaceholder,
} from '@cardstack/boxel-ui/components';
import {
  CardCrudFunctionsContextName,
  type CardCrudFunctions,
} from '@cardstack/runtime-common';

import { TransitionTicketStatusCommand } from '../commands/transition-ticket-status-command';
import { AutoAssignTicketCommand } from '../commands/auto-assign-ticket-command';
import type { CardContext } from '@cardstack/base/card-api';

import type { Ticket } from '../ticket';
import { SlaTimerBadge } from './sla-timer-badge';
import { StatePill } from './state-pill';
import { statusHue } from '../status-field';
import { priorityOption } from '../priority-field';
import Popover from '@cardstack/catalog/46f065-popover/popover';
import { guidFor } from '@ember/object/internals';
import {
  TicketStatusField,
  TicketPriorityField,
  ticketPriorityRank,
} from '../ticket-taxonomy';
import { LENSES, matchesLens, type Lens } from '../utils/queue-lens';

interface StatCell {
  key: Lens;
  label: string;
  count: number;
  tone?: 'bad' | 'warn' | 'ok' | 'hold';
}

interface Signature {
  Args: {
    tickets: Ticket[];
    isLoading?: boolean;
    /** Realm-level failure, if the query itself could not run. */
    error?: string;
    /** Shown when the realm holds no tickets at all. */
    zeroDataMessage?: string;
    /**
     * When present the list SELECTS rather than navigates — the wide layout's
     * whole point is that choosing a ticket must not cost the reader their
     * place in the queue.
     */
    onSelect?: (ticket: Ticket) => void;
    selectedId?: string;
    /**
     * The lens, when something outside owns it — the console's rail. Passing
     * `onLens` is also what removes the built-in stat strip: two copies of the
     * same six counts on one screen is the reader's problem, not a feature.
     * Omit both and the list keeps its own strip, which is what makes this
     * component still usable on its own.
     */
    lens?: Lens;
    onLens?: (lens: Lens) => void;
    /** Restrict to one queue. Owned by the rail when the rail is present. */
    queueName?: string;
    onClearQueue?: () => void;
    /** The search term, when the console's header owns the search box. */
    search?: string;
    onClearSearch?: () => void;
    /** Needed for the bulk actions, which run real commands. */
    context?: CardContext;
  };
  Element: HTMLElement;
}

/**
 * The queue: the surface an agent lives in.
 *
 * Three things this exists to fix, all of which the first version got wrong.
 *
 *  1. **The counts ARE the filter.** A stat that only reports is a stat you
 *     read and then go looking for; making each one a lens means "1 breached"
 *     and "show me the breach" are the same gesture. It is also the densest
 *     filter control available — six numbers in one strip.
 *  2. **Rows are 46px and carry eight fields.** Density comes from packing the
 *     same height harder, never from shrinking type below readable size.
 *  3. **Three different empties.** Zero data, filtered-to-nothing, and queue-
 *     cleared need three different next actions, so they are three different
 *     screens. Collapsing them into "No results were found" tells the reader
 *     nothing about which situation they are in.
 */
export class QueueView extends GlimmerComponent<Signature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  @tracked ownLens: Lens = 'open';
  @tracked ownSearch = '';
  @tracked priorityFilter: string | undefined;

  // The lens predicates below compute against the live clock, so this view
  // subscribes to it — otherwise the rows a lens selects would only change
  // when something else happened to be ticking.
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args as never);
    slaClock.subscribe();
  }

  willDestroy() {
    super.willDestroy();
    this.setSearchNow.cancel();
    slaClock.unsubscribe();
  }

  // Controlled when the console passes them, self-owned otherwise. The getters
  // are the only place that decision is made, so nothing below has to know
  // which mode it is in.
  get lens(): Lens {
    return this.args.lens ?? this.ownLens;
  }

  get search(): string {
    return this.args.search ?? this.ownSearch;
  }

  get ownsStrip(): boolean {
    return !this.args.onLens;
  }

  get ownsSearch(): boolean {
    return this.args.search === undefined;
  }

  private setSearchNow = debounce((value: string) => {
    this.ownSearch = value;
  }, 250);

  // Debounce the assignment to tracked state, not the input's own value: the
  // field must feel immediate, it is the filtering that waits.
  setSearch = (value: string) => {
    this.setSearchNow(value);
  };

  setLens = (lens: Lens, _event?: Event) => {
    let next = this.lens === lens && lens !== 'open' ? 'open' : lens;
    if (this.args.onLens) {
      this.args.onLens(next as Lens);
      return;
    }
    this.ownLens = next as Lens;
  };

  setPriority = (priority: string | undefined, _event?: Event) => {
    this.priorityFilter =
      this.priorityFilter === priority ? undefined : priority;
  };

  clearFilters = (_event?: Event) => {
    this.priorityFilter = undefined;
    this.ownLens = 'open';
    // Cancel the armed debounce BEFORE clearing. Pressing Clear within the
    // 250ms window otherwise lets the trailing invocation fire afterwards and
    // re-assign the term that was just cleared — the list re-filters itself
    // with no user input, which reads as the button not working.
    this.setSearchNow.cancel();
    this.ownSearch = '';
    // Clearing has to reach whoever owns each filter, or the button clears the
    // half this component holds and silently leaves the rail's half on.
    this.args.onLens?.('open');
    this.args.onClearQueue?.();
    this.args.onClearSearch?.();
  };

  open = (ticket: Ticket, _event?: Event) => {
    if (this.args.onSelect) {
      this.args.onSelect(ticket);
      return;
    }
    // No detail pane to select into (narrow layout) — fall back to pushing the
    // card onto the stack.
    if (ticket?.id) {
      this.cardCrudFunctions?.viewCard?.(new URL(ticket.id));
    }
  };

  isSelected = (ticket: Ticket) => ticket?.id === this.args.selectedId;

  /**
   * J / K / Enter, because working a run of tickets is the job.
   *
   * Every action on the ticket already had a shortcut (R / N / P) while the
   * half that happens more often than any of them — moving to the next one —
   * did not, so a shift of forty tickets meant forty reaches for the mouse
   * between keyboard actions. Arrow keys are handled too: nobody reads a help
   * screen to learn that a list moves with J.
   */
  moveBy = (delta: number) => {
    let rows = this.rows;
    if (!rows.length) {
      return;
    }
    let current = rows.findIndex((t) => t.id === this.args.selectedId);
    // No selection yet: J starts at the top, K at the bottom.
    let next =
      current === -1
        ? delta > 0
          ? 0
          : rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, current + delta));
    let ticket = rows[next];
    if (ticket) {
      this.open(ticket);
      // Keep the moving selection on screen; without this the highlight walks
      // out of view and the keyboard user is driving blind.
      document
        .querySelector(`[data-ticket-id="${ticket.id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  };

  // Typed as `Event` because that is what `on` hands a listener; the
  // narrowing happens here rather than in the signature, where it would
  // not be assignable.
  handleKey = (raw: Event) => {
    let event = raw as KeyboardEvent;
    let target = event.target as HTMLElement | null;
    // Never steal a key from someone typing — the search box is right here.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable
    ) {
      return;
    }
    switch (event.key) {
      case 'j':
      case 'J':
      case 'ArrowDown':
        this.moveBy(1);
        break;
      case 'k':
      case 'K':
      case 'ArrowUp':
        this.moveBy(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  get all(): Ticket[] {
    return (this.args.tickets ?? []).filter(Boolean);
  }

  get stats(): StatCell[] {
    return LENSES.map((spec) => ({
      key: spec.key,
      label: spec.label,
      tone: spec.tone,
      count: this.countFor(spec.key),
    }));
  }

  /**
   * Everything except the lens.
   *
   * The counts used to run over `this.all` while the list ran over `rows`,
   * which also applies search, priority and queue — so the strip could read
   * "Overdue 3" while pressing it rendered "Nothing matches these filters".
   * A count is a promise about what you get when you click it, and the only
   * way to keep that promise is to count the same set the click will show.
   */
  private get scoped(): Ticket[] {
    let query = this.search.trim().toLowerCase();
    return this.all.filter(
      (ticket) => this.matchesScope(ticket, query) === true,
    );
  }

  private matchesScope(ticket: Ticket, query: string): boolean {
    // Named predicates then &&, rather than one boolean expression — this is
    // where an AND/OR bug would otherwise hide.
    let priorityOk =
      !this.priorityFilter || ticket.priority === this.priorityFilter;
    let queueOk =
      !this.args.queueName ||
      (ticket.queueName?.trim() || 'Unrouted') === this.args.queueName;
    let textOk =
      !query ||
      [
        ticket.reference,
        ticket.subject,
        ticket.customerName,
        ticket.customerCompany,
        ticket.categoryName,
        ticket.queueName,
        ticket.assigneeName,
      ].some((field) => field?.toLowerCase().includes(query));
    return priorityOk && queueOk && Boolean(textOk);
  }

  private countFor(lens: Lens): number {
    return this.scoped.filter((t) => matchesLens(t, lens)).length;
  }

  get priorities() {
    return TicketPriorityField.priorityOptions;
  }

  /**
   * What P1 actually means, on hover and on focus.
   *
   * "P1" is system vocabulary. A new agent can filter by it long before they
   * can say which tickets belong in it, and the consequence — a P1 target is a
   * quarter of the standard one — is written nowhere in the interface. The
   * details popover carries both, and it opens on keyboard focus as well as
   * hover so it is not mouse-only trivia.
   */
  chipId = `qp-${guidFor(this)}`;
  @tracked hoveredPriority: string | undefined;

  anchorFor = (priority: string) => `${this.chipId}-${priority}`;

  get hoveredAnchor(): string {
    return `[data-bx-popover-anchor='${this.anchorFor(
      this.hoveredPriority ?? '',
    )}']`;
  }

  get hoveredOption() {
    return priorityOption(TicketPriorityField, this.hoveredPriority);
  }

  get hoveredFactor(): string | undefined {
    let factor = this.hoveredOption?.factor;
    if (factor == null || factor === 1) {
      return undefined;
    }
    return factor < 1
      ? `Targets shrink to ${factor * 100}% of the standard.`
      : `Targets stretch to ${factor}× the standard.`;
  }

  showPriority = (priority: string, _event?: Event) => {
    this.hoveredPriority = priority;
  };

  hidePriority = (_event?: Event) => {
    this.hoveredPriority = undefined;
  };

  get rows(): Ticket[] {
    // The lens on top of the same scope the counts use, so the two cannot
    // drift: one definition of "everything except the lens", read twice.
    //
    // ONE comparator, not two chained `.sort()` calls. A second sort re-sorts
    // from scratch and only preserves the first's order among elements it
    // considers equal — and a draft and a live ticket are never equal on
    // urgency, so chaining would have thrown the draft-first pass away
    // silently.
    return this.scoped
      .filter((ticket) => matchesLens(ticket, this.lens))
      .sort((a, b) => {
        // Drafts first, always. A ticket with no subject is one somebody
        // started and has not finished; sorting it by SLA like everything else
        // buried a brand-new ticket in the middle of the list the moment it
        // was created, or at the bottom when it had no policy at all. The one
        // row you certainly want next is the one you were just typing into.
        let draft =
          Number(Boolean(a.subject?.trim())) -
          Number(Boolean(b.subject?.trim()));
        if (draft) {
          return draft;
        }
        return (
          (a.urgencyOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.urgencyOrder ?? Number.MAX_SAFE_INTEGER) ||
          ticketPriorityRank(a.priority) - ticketPriorityRank(b.priority)
        );
      });
  }

  get hasFilters(): boolean {
    return Boolean(
      this.search.trim() ||
      this.priorityFilter ||
      this.args.queueName ||
      this.lens !== 'open',
    );
  }

  get isZeroData(): boolean {
    return this.all.length === 0;
  }

  /**
   * Skeletons are for a list that has nothing to show, not for one that is
   * refreshing.
   *
   * A live query reports `isLoading` on every REVALIDATION, not just the
   * first fetch — and saving any ticket reindexes it, which invalidates the
   * query. So linking a customer on one ticket threw away all six rows and
   * replaced them with grey bars for a second, as if the queue had emptied.
   * The rows on screen were still correct the whole time.
   *
   * Show what we have and mark it busy; only fall back to skeletons when
   * there is genuinely nothing behind them.
   */
  get showSkeleton(): boolean {
    return Boolean(this.args.isLoading) && this.all.length === 0;
  }

  get isRefreshing(): boolean {
    return Boolean(this.args.isLoading) && this.all.length > 0;
  }

  // ── Bulk actions ────────────────────────────────────────────────────────
  //
  // A shift ends with a dozen resolved tickets to close and a handful of
  // unclaimed ones to route. One at a time that is a dozen open-read-close
  // round trips through the detail pane, for an action that needs no reading
  // at all. The spec asks for exactly this (SERVICEDESK-SPEC.md:223).

  @tracked selected = new Set<string>();
  @tracked bulkBusy: string | undefined;
  @tracked bulkProblem: string | undefined;

  get selectedTickets(): Ticket[] {
    return this.rows.filter((t) => t.id && this.selected.has(t.id));
  }

  get hasSelection(): boolean {
    return this.selectedTickets.length > 0;
  }

  get allSelected(): boolean {
    return (
      this.rows.length > 0 && this.selectedTickets.length === this.rows.length
    );
  }

  isPicked = (ticket: Ticket) =>
    Boolean(ticket.id && this.selected.has(ticket.id));

  togglePick = (ticket: Ticket, _event?: Event) => {
    if (!ticket.id) {
      return;
    }
    // A new Set each time — mutating in place does not invalidate the getter.
    let next = new Set(this.selected);
    if (next.has(ticket.id)) {
      next.delete(ticket.id);
    } else {
      next.add(ticket.id);
    }
    this.selected = next;
  };

  toggleAll = (_event?: Event) => {
    this.selected = this.allSelected
      ? new Set()
      : new Set(this.rows.map((t) => t.id).filter(Boolean) as string[]);
  };

  clearSelection = (_event?: Event) => {
    this.selected = new Set();
    this.bulkProblem = undefined;
  };

  private get commandContext() {
    return this.args.context?.commandContext;
  }

  /**
   * Runs the same commands the single-ticket path runs — no bulk variant.
   *
   * Sequential, not parallel: each transition writes and reindexes, and a
   * dozen concurrent writes to the same realm is how the last one wins.
   * Failures are collected rather than thrown, because "three of twelve
   * could not close" is the useful answer; aborting on the first leaves the
   * user unable to tell which ones went through.
   */
  private async runBulk(label: string, run: (t: Ticket) => Promise<unknown>) {
    if (!this.commandContext) {
      this.bulkProblem = 'Actions are unavailable in this view.';
      return;
    }
    let targets = this.selectedTickets;
    this.bulkBusy = label;
    this.bulkProblem = undefined;
    let failed: string[] = [];
    for (let ticket of targets) {
      try {
        await run(ticket);
      } catch (error: any) {
        failed.push(`${ticket.reference || ticket.subject || 'a ticket'}`);
      }
    }
    this.bulkBusy = undefined;
    this.selected = new Set();
    if (failed.length) {
      this.bulkProblem = `${targets.length - failed.length} of ${
        targets.length
      } done. Not ${label.toLowerCase()}: ${failed.join(', ')}.`;
    }
  }

  bulkClose = async (_event?: Event) => {
    await this.runBulk('Closed', (ticket) =>
      new TransitionTicketStatusCommand(this.commandContext!).execute({
        ticket,
        toStatus: 'Closed',
      } as any),
    );
  };

  bulkResolve = async (_event?: Event) => {
    await this.runBulk('Resolved', (ticket) =>
      new TransitionTicketStatusCommand(this.commandContext!).execute({
        ticket,
        toStatus: 'Resolved',
      } as any),
    );
  };

  /**
   * There is deliberately NO bulk delete here.
   *
   * `cardCrudFunctions.deleteCard` is typed `(cardOrId) => Promise<void>`,
   * which reads as "deletes the card". It does not: the host implementation
   * only records the card as the pending deletion target and opens its OWN
   * confirmation modal, then resolves. So a loop over N tickets overwrites
   * that single target N times, shows one modal, and deletes exactly one —
   * while every iteration resolves successfully, so nothing reports a
   * failure. That is what "delete 2, one disappears" was.
   *
   * There is no API a card can call to delete more than one record: the
   * atomic-operations tool declares a `remove` op type but no handler
   * implements it. Rather than ship a control that can only ever do a
   * fraction of what its label says, the action is not offered. Deleting is
   * one ticket at a time, from the workspace, where the host's own confirm is
   * the second step.
   *
   * If this becomes a real requirement it needs a platform change, not a
   * workaround here.
   */
  bulkAssign = async (_event?: Event) => {
    await this.runBulk('Assigned', (ticket) =>
      new AutoAssignTicketCommand(this.commandContext!).execute({
        ticket,
      } as any),
    );
  };

  hueOf = (ticket: Ticket) => statusHue(TicketStatusField, ticket.status);

  priorityHueOf = (ticket: Ticket) =>
    priorityOption(TicketPriorityField, ticket.priority)?.hue ?? 'slate';

  // Split across two lines rather than one long one: at a fixed 400px the
  // whole point is that every field stays inside one glance, and a single
  // joined string just truncates.
  contextOf = (ticket: Ticket) =>
    [ticket.customerName, ticket.customerCompany].filter(Boolean).join(' · ');

  secondaryOf = (ticket: Ticket) =>
    [
      ticket.categoryName,
      ticket.queueName,
      ticket.assigneeName,
      ticket.ageLabel,
    ]
      .filter(Boolean)
      .join(' · ');

  <template>
    {{! tabindex='-1' so the section can hold focus for the shortcuts without
        entering the tab order as a stop of its own. }}
    <section
      class='qv'
      aria-label='Ticket queue'
      tabindex='-1'
      {{on 'keydown' this.handleKey}}
      ...attributes
    >
      {{! Only when nothing outside owns the lens. With the console's rail
          present these same six counts already stand to the left, and drawing
          them twice makes the reader check whether the two agree.
          Raw <button>: a stat is a two-line composite (big tabular figure +
          caption) acting as a toggle, which is not what boxel-ui's Button
          renders. Every plain action below uses Button. }}
      {{#if this.ownsStrip}}
        <div class='stats' role='group' aria-label='Filter by state'>
          {{#each this.stats as |stat|}}
            <button
              type='button'
              class='stat
                {{if stat.tone (concat "tone-" stat.tone)}}
                {{if (eq stat.key this.lens) "stat-on"}}'
              aria-pressed={{if (eq stat.key this.lens) 'true' 'false'}}
              {{on 'click' (fn this.setLens stat.key)}}
            >
              <span class='stat-n'>{{stat.count}}</span>
              <span class='stat-l'>{{stat.label}}</span>
            </button>
          {{/each}}
        </div>
      {{/if}}

      <div class='filters'>
        {{#if this.ownsSearch}}
          <label class='sr-only' for='queue-search'>Search tickets</label>
          <BoxelInput
            id='queue-search'
            class='qsearch'
            @type='search'
            @value={{this.search}}
            @onInput={{this.setSearch}}
            @placeholder='Search subject, customer, reference…'
          />
        {{/if}}
        {{#if @queueName}}
          <span class='scope'>{{@queueName}}</span>
        {{/if}}
        <div class='chips' role='group' aria-label='Filter by priority'>
          {{#each this.priorities key='value' as |option|}}
            <Button
              class='pchip'
              data-bx-popover-anchor={{this.anchorFor option.value}}
              @kind={{if
                (eq option.value this.priorityFilter)
                'primary'
                'secondary'
              }}
              @size='extra-small'
              aria-pressed={{if
                (eq option.value this.priorityFilter)
                'true'
                'false'
              }}
              {{on 'click' (fn this.setPriority option.value)}}
              {{on 'mouseenter' (fn this.showPriority option.value)}}
              {{on 'mouseleave' this.hidePriority}}
              {{on 'focus' (fn this.showPriority option.value)}}
              {{on 'blur' this.hidePriority}}
            >{{option.value}}</Button>
          {{/each}}
        </div>
        {{! One popover, re-anchored to whichever chip is hovered — four
            popovers would be four floating-UI subscriptions for a thing only
            one of which can ever be open. }}
        <Popover
          @anchor={{this.hoveredAnchor}}
          @open={{if this.hoveredPriority true false}}
          @kind='details'
          @anchoring='beside'
          @placement='bottom-start'
          @size='auto'
          @autoFocus={{false}}
          @label='Priority meaning'
        >
          <:details>
            <div class='pinfo'>
              <b class='pinfo-h'>{{this.hoveredOption.label}}</b>
              <p class='pinfo-p'>{{this.hoveredOption.meaning}}</p>
              {{#if this.hoveredFactor}}
                <p class='pinfo-f'>{{this.hoveredFactor}}</p>
              {{/if}}
            </div>
          </:details>
        </Popover>

        {{#if this.hasFilters}}
          <Button
            @kind='secondary'
            @size='extra-small'
            {{on 'click' this.clearFilters}}
          >Clear</Button>
        {{/if}}
      </div>

      {{#if @error}}
        <div class='state state-bad' role='alert'>
          <b>The queue could not load.</b>
          <p>{{@error}}</p>
        </div>

      {{else if this.showSkeleton}}
        {{! Skeleton rows at the real row height, so nothing shifts when the
            data lands. A spinner would tell the reader less and move more. }}
        <ul class='rows' aria-busy='true' aria-label='Loading tickets'>
          {{#each (array 1 2 3 4 5) as |placeholder|}}
            {{! boxel-ui's placeholder rather than three hand-drawn grey
                spans — it already owns the shimmer, and it stops animating
                when the reader has asked the OS to stop animating. }}
            <li class='row row-skeleton' data-key={{placeholder}}>
              <SkeletonPlaceholder class='sk sk-ref' />
              <span class='sk-main'>
                <SkeletonPlaceholder class='sk sk-title' />
                <SkeletonPlaceholder class='sk sk-sub' />
              </span>
            </li>
          {{/each}}
        </ul>

      {{else if this.isZeroData}}
        <div class='state'>
          <b>No tickets yet</b>
          <p>{{if
              @zeroDataMessage
              @zeroDataMessage
              'The first message written to the support address lands here. You can also raise one by hand.'
            }}</p>
        </div>

      {{else if this.rows.length}}
        {{#if this.hasSelection}}
          {{! Replaces nothing — it appears above the list only while a
              selection exists, so the toolbar is never chrome you scroll
              past on the way to the work. }}
          <div class='bulk' role='group' aria-label='Bulk actions'>
            <span class='bulk-n'>{{this.selectedTickets.length}}
              selected</span>
            <Button
              @kind='secondary'
              @size='extra-small'
              @loading={{if (eq this.bulkBusy 'Assigned') true false}}
              @disabled={{if this.bulkBusy true false}}
              {{on 'click' this.bulkAssign}}
            >Auto-assign</Button>
            <Button
              @kind='secondary'
              @size='extra-small'
              @loading={{if (eq this.bulkBusy 'Resolved') true false}}
              @disabled={{if this.bulkBusy true false}}
              {{on 'click' this.bulkResolve}}
            >Resolve</Button>
            <Button
              @kind='secondary'
              @size='extra-small'
              @loading={{if (eq this.bulkBusy 'Closed') true false}}
              @disabled={{if this.bulkBusy true false}}
              {{on 'click' this.bulkClose}}
            >Close</Button>
            <span class='bulk-grow'></span>
            <Button
              @kind='text-only'
              @size='extra-small'
              {{on 'click' this.clearSelection}}
            >Clear</Button>
          </div>
        {{/if}}
        {{#if this.bulkProblem}}
          {{! Partial success is the normal outcome — a transition the state
              machine refuses is not a crash, and the reader needs to know
              which ones did not move. }}
          <p class='bulk-bad' role='alert'>{{this.bulkProblem}}</p>
        {{/if}}
        <ul
          class='rows {{if this.isRefreshing "rows-busy"}}'
          aria-busy={{if this.isRefreshing 'true' 'false'}}
        >
          {{#each this.rows key='id' as |ticket|}}
            <li class='row-wrap'>
              {{! A real checkbox, outside the row button — nesting an input
                  inside a button is invalid markup and unreachable by
                  keyboard. }}
              <label class='pick'>
                <span class='sr-only'>Select {{ticket.subject}}</span>
                <input
                  type='checkbox'
                  checked={{this.isPicked ticket}}
                  {{on 'change' (fn this.togglePick ticket)}}
                />
              </label>
              {{! Also raw: a list row is a row, not a control with a control's
                  padding and chrome. Button would fight the row layout. }}
              <button
                type='button'
                class='row {{if (this.isSelected ticket) "row-on"}}'
                data-ticket-id={{ticket.id}}
                aria-current={{if (this.isSelected ticket) 'true' 'false'}}
                {{on 'click' (fn this.open ticket)}}
              >
                <span class='row-spine'></span>
                <span class='row-main'>
                  <span class='row-line'>
                    <span class='row-ref'>{{ticket.reference}}</span>
                    <span class='row-subject'>{{ticket.subject}}</span>
                  </span>
                  <span class='row-line'>
                    <StatePill
                      @label={{ticket.priority}}
                      @hue={{this.priorityHueOf ticket}}
                      @emphatic={{true}}
                    />
                    <SlaTimerBadge
                      @facts={{ticket.governingTimer}}
                      @live={{true}}
                    />
                    <span class='row-context'>{{ticket.customerName}}</span>
                  </span>
                  <span class='row-line'>
                    <span class='row-context'>{{this.secondaryOf ticket}}</span>
                  </span>
                </span>
              </button>
            </li>
          {{/each}}
        </ul>
        <p class='count'>{{this.rows.length}}
          shown ·
          {{this.all.length}}
          in the realm
          <span class='count-keys'>·
            <kbd>J</kbd>
            <kbd>K</kbd>
            to move</span></p>

      {{else}}
        {{! Two different empties: one is a filter problem, the other is good
            news, and they must not look the same. }}
        {{! The priority popover is NOT repeated here. It already lives beside
            the chips, which render whether or not the list has rows, so a
            second copy mounted two floating-UI subscriptions on the same
            anchor with the same open state — two popovers stacked on one
            chip, which is the exact duplication its own comment warns
            against. }}
        {{#if this.hasFilters}}
          <div class='state'>
            <b>Nothing matches these filters</b>
            <p>There are
              {{this.all.length}}
              tickets in the realm. Widen the filter to see them.</p>
            <Button
              @kind='secondary'
              @size='extra-small'
              {{on 'click' this.clearFilters}}
            >Clear filters</Button>
          </div>
        {{else}}
          <div class='state state-ok'>
            <b>This queue is clear</b>
            <p>Nothing is waiting. That is the whole point of the job.</p>
          </div>
        {{/if}}
      {{/if}}
    </section>

    <style scoped>
      .qv {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        font-family: var(--font-sans, var(--boxel-font-family));
        color: var(--foreground, var(--boxel-dark));
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 6px);
        overflow: hidden;
        background: var(--card, var(--boxel-light));
      }
      .stat {
        display: flex;
        flex-direction: column;
        gap: 1px;
        align-items: flex-start;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: none;
        border-right: 1px solid var(--border, var(--boxel-200));
        background: none;
        color: inherit;
        font-family: inherit;
        cursor: pointer;
        min-height: 44px;
      }
      .stat:last-child {
        border-right: none;
      }
      .stat:active {
        transform: scale(0.98);
      }
      .stat:hover {
        background: var(--muted, var(--boxel-100));
      }
      .stat:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .stat-on {
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 12%,
          var(--card, var(--boxel-light))
        );
        box-shadow: inset 0 -2px 0 var(--primary, var(--boxel-highlight));
      }
      .stat-n {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 1.15rem;
        font-weight: 700;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
      .stat-l {
        font-size: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .tone-bad .stat-n {
        color: var(--boxel-danger);
      }
      .tone-warn .stat-n {
        color: var(--boxel-warning);
      }
      .tone-ok .stat-n {
        color: var(--boxel-success);
      }
      .tone-hold .stat-n {
        color: var(--muted-foreground, var(--boxel-450));
      }

      .filters {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .qsearch {
        flex: 1;
        min-width: 12rem;
      }
      .chips {
        display: flex;
        gap: var(--boxel-sp-5xs, 3px);
      }
      /* An unpressed filter had no border and a pale grey fill, which is what
         a DISABLED control looks like — so four live toggles read as four
         dead ones. An outline is what says "pressable"; the fill is what says
         "pressed". Re-skinned through Button's own knobs, not around it. */
      /* `.chips .pchip` rather than `.pchip`: Button's own `.kind-secondary`
         sets --boxel-button-border at the same specificity, and a tie is
         decided by stylesheet order — which is not something to bet a border
         on. */
      .chips .pchip {
        --boxel-button-border: 1px solid var(--border, var(--boxel-300));
        --boxel-button-secondary-background: var(--card, var(--boxel-light));
        --boxel-button-min-width: 2.75rem;
        font-variant-numeric: tabular-nums;
      }
      .chips .pchip[aria-pressed='true'] {
        --boxel-button-border: 1px solid var(--primary, var(--boxel-highlight));
      }
      /* The queue the rail narrowed to, restated where the rows are — the rail
         is far enough away that "why is this list short" is otherwise a
         question the reader has to go and answer. */
      .scope {
        padding: 0.1em 0.45em;
        border-radius: 3px;
        background: var(--muted, var(--boxel-100));
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }

      /* A list, not a stack of cards. Boxing every row is the "borders quietly
         proliferated" failure: forty tickets became forty competing rectangles,
         and the eye spent its first pass on the boxes instead of the work. One
         border on the container, hairline dividers between rows. */
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 6px);
        overflow: hidden;
        background: var(--card, var(--boxel-light));
      }
      /* Refreshing, not empty: the rows stay readable and just lose a little
         contrast, so the reader can tell an update is landing without losing
         the thing they were reading. */
      .rows-busy {
        opacity: 0.72;
      }
      .row-wrap {
        display: flex;
        align-items: stretch;
        min-width: 0;
      }
      /* A <label> wrapping the row checkbox, so the whole strip is the hit area.
         The focus ring is the checkbox's own — the label is not focusable — but
         the hit area still needs to show itself, or a pointer sitting on it gets
         `cursor: pointer` and nothing else. */
      .pick {
        display: flex;
        align-items: center;
        padding-left: var(--boxel-sp-xs);
        cursor: pointer;
      }
      .pick:hover {
        background: color-mix(in oklch, var(--foreground) 5%, transparent);
      }
      /* The checkbox inside is what takes focus, so the visible ring is drawn
         from here when it does. */
      .pick:focus-within {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .bulk {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        flex-wrap: wrap;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border: 1px solid var(--primary, var(--boxel-highlight));
        border-radius: var(--boxel-border-radius-sm, 6px);
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 8%,
          var(--background, var(--boxel-light))
        );
      }
      .bulk-n {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .bulk-grow {
        flex: 1;
      }
      .bulk-bad {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-danger);
      }
      .row {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-4xs);
        width: 100%;
        padding: 8px var(--boxel-sp-sm);
        border: none;
        border-bottom: 1px solid var(--border, var(--boxel-200));
        overflow: hidden;
        background: none;
        color: inherit;
        font-family: inherit;
        text-align: start;
        cursor: pointer;
        transition: background 0.1s ease-out;
      }
      .rows li:last-child .row {
        border-bottom: none;
      }
      .row:active {
        transform: scale(0.995);
      }
      .row:hover {
        background: var(--muted, var(--boxel-100));
      }
      /* Selection has to survive alongside hover — the selected row stays
         marked while the pointer wanders down the list. */
      .row-on {
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 12%,
          var(--card, var(--boxel-light))
        );
        box-shadow: inset 2px 0 0 var(--primary, var(--boxel-highlight));
      }
      .row-line {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }
      .row:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .row-spine {
        width: 3px;
        height: 34px;
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

      .row-skeleton {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        height: 46px;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 4px);
      }
      .sk {
        --boxel-skeleton-placeholder-border-radius: 2px;
      }
      .sk-ref {
        width: 2.6rem;
        height: 0.55rem;
        flex: none;
      }
      .sk-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sk-title {
        width: 55%;
        height: 0.6rem;
      }
      .sk-sub {
        width: 78%;
        height: 0.5rem;
      }

      .state {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp) var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-left: 3px solid var(--muted-foreground, var(--boxel-450));
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: var(--card, var(--boxel-light));
      }
      .state b {
        font-size: var(--boxel-font-size);
      }
      .state p {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
        max-width: 60ch;
        line-height: 1.6;
      }
      /* An emptied queue is good news and has to look like good news. */
      .state-ok {
        border-left-color: var(--boxel-success);
      }
      .state-ok b {
        color: color-mix(
          in oklch,
          var(--boxel-success) 45%,
          var(--foreground, var(--boxel-dark))
        );
      }
      .state-bad {
        border-left-color: var(--boxel-danger);
      }
      .state-bad b {
        color: color-mix(
          in oklch,
          var(--boxel-danger) 45%,
          var(--foreground, var(--boxel-dark))
        );
      }

      .count {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        font-variant-numeric: tabular-nums;
      }
      .pinfo {
        display: flex;
        flex-direction: column;
        gap: 3px;
        max-width: 24rem;
        padding: var(--boxel-sp-xs);
      }
      .pinfo-h {
        font-size: var(--boxel-font-size-sm);
      }
      .pinfo-p,
      .pinfo-f {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.55;
      }
      /* The consequence, set apart: it is the part nobody can infer.
         It used to be set apart by `color: var(--primary)` — an accent used as
         TEXT, which boxel-theming §2 forbids for a structural reason: a theme
         guarantees the PAIR (`--primary` with `--primary-foreground`), and nobody
         ever checked `--primary` against `--background`. Teal-on-white was a
         contrast gamble here and could vanish entirely under a dark theme.
         The accent survives as a MARK — a rule down the left edge, which §2
         explicitly allows — while the text itself sits on `--foreground`, and the
         weight does the emphasis. */
      .pinfo-f {
        color: var(--foreground, var(--boxel-dark));
        font-weight: 600;
        padding-left: var(--boxel-sp-xxs);
        border-left: 2px solid
          color-mix(in oklch, var(--primary, var(--boxel-highlight)) 55%, transparent);
      }
      .count-keys {
        color: var(--muted-foreground, var(--boxel-450));
      }
      /* A hint, not a second label — same treatment as the workspace's. */
      kbd {
        padding: 0.1em 0.32em;
        border-radius: 3px;
        background: var(--muted, var(--boxel-100));
        color: var(--muted-foreground, var(--boxel-450));
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.5625rem;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
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

export default QueueView;
