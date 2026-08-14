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
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';
import { consume } from 'ember-provide-consume-context';
import {
  CardCrudFunctionsContextName,
  type CardCrudFunctions,
} from '@cardstack/runtime-common';
import ShieldIcon from '@cardstack/boxel-icons/shield-half';

import { Booking } from '../booking';
import ConfirmBookingCommand from '../confirm-booking';
import { Survey } from '../survey';
import { PointsTransaction } from '../loyalty-account';
import { tierOption } from '../loyalty-tier-field';
import { LoyaltyDashboard } from '../components/loyalty-dashboard';
import {
  BookingCalendar,
  type BookingCalendarEvent,
} from '../components/booking-calendar';
import { stateColor, type StateColor } from '../utils/index';
import { Member, MemberTierField } from './member';
import { Match } from './match';
import RecordAttendanceCommand from './record-attendance';

// Home fixtures sell the ground, away fixtures sell the trip — the calendar
// colors the two differently because a fan scans for exactly that split.
export const MATCH_KIND_COLORS: Record<string, StateColor> = {
  Home: stateColor('teal'),
  Away: stateColor('purple'),
};

type SectionId = 'members' | 'fixtures' | 'operations';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'members', label: 'Members' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'operations', label: 'Operations' },
];

interface ConsoleSignature {
  Args: {
    clubName?: string;
    realm?: string;
    context?: CardContext;
  };
  Element: HTMLElement;
}

class ClubConsole extends GlimmerComponent<ConsoleSignature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  sections = SECTIONS;
  @tracked sectionId: SectionId = 'members';
  @tracked selectedMemberId: string | undefined;
  @tracked actionProblem: string | undefined;
  @tracked checkingInId: string | undefined;

  @tracked private memberQuery: ReturnType<getCards> | undefined;
  @tracked private matchQuery: ReturnType<getCards> | undefined;
  @tracked private bookingQuery: ReturnType<getCards> | undefined;
  @tracked private transactionQuery: ReturnType<getCards> | undefined;
  @tracked private surveyQuery: ReturnType<getCards> | undefined;

  constructor(owner: unknown, args: ConsoleSignature['Args']) {
    super(owner as never, args as never);
    let live = { isLive: true };
    let realms = () => (this.args.realm ? [this.args.realm] : []);
    let queryFor = (cardClass: typeof CardDef) => () => {
      if (!this.isInteractive) {
        return undefined;
      }
      let ref = identifyCard(cardClass);
      return ref ? { filter: { type: ref } } : undefined;
    };
    this.memberQuery = this.args.context?.getCards(
      this,
      queryFor(Member),
      realms,
      live,
    );
    this.matchQuery = this.args.context?.getCards(
      this,
      queryFor(Match),
      realms,
      live,
    );
    this.bookingQuery = this.args.context?.getCards(
      this,
      queryFor(Booking),
      realms,
      live,
    );
    this.transactionQuery = this.args.context?.getCards(
      this,
      queryFor(PointsTransaction),
      realms,
      live,
    );
    this.surveyQuery = this.args.context?.getCards(
      this,
      queryFor(Survey),
      realms,
      live,
    );
  }

  /**
   * Prerender gets the static shell only — live queries and the interactive
   * console are gated on a person actually looking at this (see app-factory
   * notes on the prerender backtracking trap).
   */
  get isInteractive(): boolean {
    return Boolean(this.cardCrudFunctions?.viewCard);
  }

  get members(): Member[] {
    return ((this.memberQuery?.instances ?? []) as Member[]).filter(Boolean);
  }
  get matches(): Match[] {
    return ((this.matchQuery?.instances ?? []) as Match[]).filter(Boolean);
  }
  get bookings(): Booking[] {
    return ((this.bookingQuery?.instances ?? []) as Booking[]).filter(Boolean);
  }
  get surveys(): Survey[] {
    return ((this.surveyQuery?.instances ?? []) as Survey[]).filter(Boolean);
  }

  get selectedMember(): Member | undefined {
    return (
      this.members.find((m) => m.id === this.selectedMemberId) ??
      this.members[0]
    );
  }

  get selectedTier() {
    return tierOption(MemberTierField, this.selectedMember?.tier);
  }

  /** Newest first, sliced — the dashboard renders what it is handed. */
  get selectedTransactions(): PointsTransaction[] {
    let member = this.selectedMember;
    if (!member) {
      return [];
    }
    return (
      (this.transactionQuery?.instances ?? []) as PointsTransaction[]
    )
      .filter((t) => t?.account?.id === member.id)
      .sort(
        (a, b) =>
          new Date(b.occurredAt ?? 0).getTime() -
          new Date(a.occurredAt ?? 0).getTime(),
      )
      .slice(0, 8);
  }

  get selectedBookings(): Booking[] {
    let member = this.selectedMember;
    if (!member?.holder?.id) {
      return [];
    }
    return this.bookings.filter((b) => b.holder?.id === member.holder?.id);
  }

  bookingsFor = (match: Match): number => {
    return this.bookings
      .filter((b) => b.event?.id === match.id)
      .reduce((sum, b) => sum + (b.quantity ?? 1), 0);
  };

  get calendarEvents(): BookingCalendarEvent[] {
    return this.matches
      .filter((m) => m.startsAt)
      .map((m) => ({
        id: m.id,
        title: m.cardTitle ?? 'Match',
        date: m.startsAt!,
        kind: m.homeAway,
        capacity: m.capacity?.total ?? undefined,
        booked:
          m.capacity?.total != null
            ? (m.ticketsSold ?? 0) + this.bookingsFor(m)
            : undefined,
      }));
  }

  matchColors = MATCH_KIND_COLORS;

  selectSection = (id: SectionId, _event?: Event) => {
    this.sectionId = id;
  };

  selectMember = (member: Member, _event?: Event) => {
    this.selectedMemberId = member.id;
  };

  open = (card: CardDef | undefined, _event?: Event) => {
    if (card) {
      this.cardCrudFunctions?.viewCard?.(card as any, 'isolated');
    }
  };

  openCalendarEvent = (event: BookingCalendarEvent) => {
    let match = this.matches.find((m) => m.id === event.id);
    this.open(match);
  };

  canCheckIn = (booking: Booking): boolean => {
    return !booking.checkedInAt && booking.rsvp !== 'Declined';
  };

  needsConfirm = (booking: Booking): boolean => {
    return !booking.checkedInAt && booking.rsvp !== 'Going' &&
      booking.rsvp !== 'Declined';
  };

  @tracked confirmingId: string | undefined;

  confirm = async (booking: Booking, _event?: Event) => {
    let context = this.args.context?.commandContext;
    if (!context || !this.args.realm) {
      this.actionProblem = 'This console is not ready to confirm bookings.';
      return;
    }
    this.confirmingId = booking.id;
    this.actionProblem = undefined;
    try {
      await new ConfirmBookingCommand(context).execute({
        booking,
        realm: this.args.realm,
      } as any);
    } catch (error: any) {
      this.actionProblem = error?.message ?? String(error);
    } finally {
      this.confirmingId = undefined;
    }
  };

  checkIn = async (booking: Booking, _event?: Event) => {
    let member = this.selectedMember;
    let context = this.args.context?.commandContext;
    if (!member || !context || !this.args.realm) {
      this.actionProblem = 'This console is not ready to record attendance.';
      return;
    }
    this.checkingInId = booking.id;
    this.actionProblem = undefined;
    try {
      await new RecordAttendanceCommand(context).execute({
        booking,
        member,
        realm: this.args.realm,
      } as any);
    } catch (error: any) {
      this.actionProblem = error?.message ?? String(error);
    } finally {
      this.checkingInId = undefined;
    }
  };

  create = async (
    module: string,
    name: string,
    doc?: Record<string, unknown>,
    _event?: Event,
  ) => {
    let createCard = this.cardCrudFunctions?.createCard;
    if (!createCard || !this.args.realm) {
      this.actionProblem =
        'Save this console in a realm before creating records from it.';
      return;
    }
    this.actionProblem = undefined;
    try {
      await createCard(
        { module: new URL(module, this.args.realm).href, name },
        new URL(this.args.realm),
        doc
          ? ({ realmURL: new URL(this.args.realm), doc } as any)
          : { realmURL: new URL(this.args.realm) },
      );
    } catch (error: any) {
      this.actionProblem = error?.message ?? String(error);
    }
  };

  newMember = (_event?: Event) =>
    this.create('./club-membership/member', 'Member');
  newMatch = (_event?: Event) =>
    this.create('./club-membership/match', 'Match');
  newBooking = (_event?: Event) => this.create('./booking', 'Booking');

  responsesFor = (survey: Survey): string => {
    // Response counting needs its own query; until a real ops need demands
    // it, the survey row links through to the card where results live.
    return survey.questionCount != null
      ? `${survey.questionCount} questions`
      : '';
  };

  <template>
    <div class='club'>
      <header class='masthead'>
        <div class='crest'><ShieldIcon class='crest-icon' /></div>
        <div class='masthead-id'>
          <h1 class='club-name'>{{if
              @clubName
              @clubName
              'Club Membership'
            }}</h1>
          <p class='club-tagline'>Membership & Ticketing</p>
        </div>
        {{#if this.isInteractive}}
          <nav class='sections'>
            {{#each this.sections as |section|}}
              <button
                type='button'
                class='section-btn {{if (eq section.id this.sectionId) "on"}}'
                {{on 'click' (fn this.selectSection section.id)}}
              >{{section.label}}</button>
            {{/each}}
          </nav>
        {{/if}}
      </header>

      {{#if this.isInteractive}}
        {{#if this.actionProblem}}
          <p class='problem'>{{this.actionProblem}}</p>
        {{/if}}

        {{#if (eq this.sectionId 'members')}}
          <div class='members-layout'>
            <aside class='member-rail'>
              <div class='rail-head'>
                <h2 class='rail-title'>Members</h2>
                <Button
                  @kind='secondary-light'
                  @size='extra-small'
                  {{on 'click' this.newMember}}
                >New member</Button>
              </div>
              <ul class='member-list'>
                {{#each this.members key='id' as |member|}}
                  <li>
                    <button
                      type='button'
                      class='member-row
                        {{if (eq member.id this.selectedMember.id) "on"}}'
                      {{on 'click' (fn this.selectMember member)}}
                    >
                      <span class='member-name'>{{member.cardTitle}}</span>
                      <span class='member-tier'>{{member.tier}}</span>
                    </button>
                  </li>
                {{else}}
                  <li class='rail-empty'>No members yet</li>
                {{/each}}
              </ul>
            </aside>
            <section class='member-home'>
              {{#if this.selectedMember}}
                <button
                  type='button'
                  class='member-card-link'
                  title='Open member card'
                  {{on 'click' (fn this.open this.selectedMember)}}
                >Open card ↗</button>
                <LoyaltyDashboard
                  @account={{this.selectedMember}}
                  @tier={{this.selectedTier}}
                  @transactions={{this.selectedTransactions}}
                >
                  <:actions>
                    <Button
                      @kind='secondary-light'
                      @size='small'
                      {{on 'click' this.newBooking}}
                    >New booking</Button>
                  </:actions>
                </LoyaltyDashboard>
                <div class='member-bookings'>
                  <h3 class='panel-title'>Bookings</h3>
                  {{#each this.selectedBookings key='id' as |booking|}}
                    <div class='booking-row'>
                      <button
                        type='button'
                        class='booking-open'
                        {{on 'click' (fn this.open booking)}}
                      >
                        <span class='booking-ref'>{{booking.reference}}</span>
                        <span class='booking-event'>{{booking.event.cardTitle}}</span>
                      </button>
                      <span class='booking-state'>
                        {{#if booking.checkedInAt}}
                          <span class='checked-in'>✓ attended</span>
                        {{else if (this.needsConfirm booking)}}
                          <Button
                            @kind='secondary-light'
                            @size='extra-small'
                            @loading={{eq this.confirmingId booking.id}}
                            {{on 'click' (fn this.confirm booking)}}
                          >Confirm</Button>
                        {{else if (this.canCheckIn booking)}}
                          <Button
                            @kind='primary'
                            @size='extra-small'
                            @loading={{eq this.checkingInId booking.id}}
                            {{on 'click' (fn this.checkIn booking)}}
                          >Check in</Button>
                        {{else}}
                          <span class='declined'>declined</span>
                        {{/if}}
                      </span>
                    </div>
                  {{else}}
                    <p class='panel-empty'>No bookings for this member yet.</p>
                  {{/each}}
                </div>
              {{else}}
                <p class='panel-empty'>Add a member to see their loyalty
                  home.</p>
              {{/if}}
            </section>
          </div>
        {{else if (eq this.sectionId 'fixtures')}}
          <section class='fixtures'>
            <div class='rail-head'>
              <h2 class='rail-title'>Fixtures</h2>
              <Button
                @kind='secondary-light'
                @size='extra-small'
                {{on 'click' this.newMatch}}
              >New match</Button>
            </div>
            <BookingCalendar
              @events={{this.calendarEvents}}
              @kindColors={{this.matchColors}}
              @onSelectEvent={{this.openCalendarEvent}}
            />
            <ul class='fixture-list'>
              {{#each this.matches key='id' as |match|}}
                <li>
                  <button
                    type='button'
                    class='fixture-row'
                    {{on 'click' (fn this.open match)}}
                  >
                    <span class='fixture-title'>{{match.cardTitle}}</span>
                    <span class='fixture-meta'>{{match.competition}}
                      · {{match.status}}</span>
                  </button>
                </li>
              {{else}}
                <li class='rail-empty'>No fixtures yet</li>
              {{/each}}
            </ul>
          </section>
        {{else}}
          <section class='operations'>
            <div class='ops-panel'>
              <div class='rail-head'>
                <h2 class='rail-title'>All bookings</h2>
                <Button
                  @kind='secondary-light'
                  @size='extra-small'
                  {{on 'click' this.newBooking}}
                >New booking</Button>
              </div>
              {{#each this.bookings key='id' as |booking|}}
                <div class='booking-row'>
                  <button
                    type='button'
                    class='booking-open'
                    {{on 'click' (fn this.open booking)}}
                  >
                    <span class='booking-ref'>{{booking.reference}}</span>
                    <span class='booking-event'>{{booking.event.cardTitle}}</span>
                  </button>
                  <span class='booking-status'>{{booking.rsvp}}
                    · {{booking.paymentStatus}}</span>
                </div>
              {{else}}
                <p class='panel-empty'>No bookings yet.</p>
              {{/each}}
            </div>
            <div class='ops-panel'>
              <div class='rail-head'>
                <h2 class='rail-title'>Match-day surveys</h2>
              </div>
              {{#each this.surveys key='id' as |survey|}}
                <div class='booking-row'>
                  <button
                    type='button'
                    class='booking-open'
                    {{on 'click' (fn this.open survey)}}
                  >
                    <span class='booking-event'>{{survey.title}}</span>
                  </button>
                  <span class='booking-status'>{{this.responsesFor
                      survey
                    }}</span>
                </div>
              {{else}}
                <p class='panel-empty'>No surveys yet — fans earn points for
                  telling you about match day.</p>
              {{/each}}
            </div>
          </section>
        {{/if}}
      {{else}}
        <p class='shell-note'>Open this console in the app to manage members,
          fixtures and match-day bookings.</p>
      {{/if}}
    </div>

    <style scoped>
      .club {
        /* The club's identity enters through tokens: a linked theme can
           restate --primary and the tier metals; these are the defaults.
           The tier tokens feed the TierBadge hooks inside the loyalty
           blocks — token hand-off, never override CSS. */
        --club-band: color-mix(
          in oklch,
          var(--primary, var(--boxel-purple)) 88%,
          var(--foreground, var(--boxel-dark))
        );
        --tier-bronze-bg: linear-gradient(135deg, #b0703c, #8a5427);
        --tier-bronze-fg: #fff7ef;
        --tier-bronze-ring: #8a5427;
        --tier-silver-bg: linear-gradient(135deg, #c8cdd4, #9aa2ad);
        --tier-silver-fg: #1f242b;
        --tier-silver-ring: #9aa2ad;
        --tier-gold-bg: linear-gradient(135deg, #e8c258, #c49a2c);
        --tier-gold-fg: #2b2003;
        --tier-gold-ring: #c49a2c;
        --tier-legend-bg: linear-gradient(135deg, #7b2d8b, #4e1a59);
        --tier-legend-fg: #f8ecfb;
        --tier-legend-ring: #4e1a59;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        min-height: 100%;
        box-sizing: border-box;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      .masthead {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--club-band);
        color: var(--primary-foreground, var(--boxel-light));
      }
      .crest {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        background: color-mix(in oklch, currentColor 14%, transparent);
        flex-shrink: 0;
      }
      .crest-icon {
        width: 1.75rem;
        height: 1.75rem;
      }
      .masthead-id {
        flex: 1;
        min-width: 0;
      }
      .club-name {
        margin: 0;
        font-size: 1.375rem;
        line-height: 1.1;
        font-family: var(--font-heading, inherit);
      }
      .club-tagline {
        margin: 0.125rem 0 0;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        opacity: 0.75;
      }
      .sections {
        display: flex;
        gap: var(--boxel-sp-4xs);
        flex-shrink: 0;
      }
      .section-btn {
        border: 1px solid color-mix(in oklch, currentColor 35%, transparent);
        background: transparent;
        color: inherit;
        border-radius: 999px;
        padding: 0.3125rem 0.875rem;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.15s ease-out;
      }
      .section-btn:hover {
        background: color-mix(in oklch, currentColor 12%, transparent);
      }
      .section-btn.on {
        background: var(--primary-foreground, var(--boxel-light));
        color: var(--club-band);
        border-color: transparent;
      }
      .problem {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 12%,
          var(--background, var(--boxel-light))
        );
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 45%,
          var(--foreground, var(--boxel-dark))
        );
        font-size: var(--boxel-font-size-sm);
      }
      .members-layout {
        display: grid;
        grid-template-columns: minmax(14rem, 18rem) 1fr;
        gap: var(--boxel-sp);
        align-items: start;
      }
      .member-rail,
      .fixtures,
      .ops-panel {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-lg);
        background: var(--card, var(--boxel-light));
        padding: var(--boxel-sp);
      }
      .rail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }
      .rail-title {
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .member-list,
      .fixture-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .member-row,
      .fixture-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        width: 100%;
        border: none;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        cursor: pointer;
        font-size: var(--boxel-font-size-sm);
        font-family: inherit;
      }
      .member-row:hover,
      .fixture-row:hover {
        background: var(--muted, var(--boxel-100));
      }
      .member-row.on {
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 12%,
          var(--card, var(--boxel-light))
        );
        font-weight: 600;
      }
      .member-tier {
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rail-empty,
      .panel-empty {
        margin: 0;
        padding: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        font-style: italic;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .member-home {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-lg);
        background: var(--card, var(--boxel-light));
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        position: relative;
      }
      .member-card-link {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        border: none;
        background: none;
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-font-size-xs);
        cursor: pointer;
        font-family: inherit;
      }
      .member-card-link:hover {
        color: var(--foreground, var(--boxel-dark));
        text-decoration: underline;
      }
      .panel-title {
        margin: 0 0 var(--boxel-sp-4xs);
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .member-bookings {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .booking-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-4xs) 0;
        border-bottom: 1px solid var(--border, var(--boxel-100));
      }
      .booking-row:last-child {
        border-bottom: none;
      }
      .booking-open {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        min-width: 0;
        flex: 1;
        border: none;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 0;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
      }
      .booking-open:hover .booking-event {
        text-decoration: underline;
      }
      .booking-ref {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-xs);
        letter-spacing: 0.04em;
        color: var(--muted-foreground, var(--boxel-450));
        flex-shrink: 0;
      }
      .booking-event {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Constant-width action slot so booking rows column-align whether the
         row carries a button, a tick or nothing. */
      .booking-state {
        width: 7rem;
        display: inline-flex;
        justify-content: flex-end;
        flex-shrink: 0;
      }
      .checked-in {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: color-mix(
          in oklch,
          var(--boxel-success) 38%,
          var(--card-foreground, var(--boxel-dark))
        );
      }
      .declined {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .booking-status {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
        flex-shrink: 0;
      }
      .fixtures {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .fixture-title {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fixture-meta {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
        flex-shrink: 0;
      }
      .operations {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
        align-items: start;
      }
      @container (max-width: 700px) {
        .members-layout,
        .operations {
          grid-template-columns: 1fr;
        }
      }
      .shell-note {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
        max-width: 60ch;
      }
    </style>
  </template>
}

/**
 * The club's front office in one card: the loyalty home per member, the
 * fixture calendar read as a booking surface, and the operational lists.
 * Everything on screen is a consumed block — LoyaltyDashboard,
 * BookingCalendar, the loyalty/booking/survey cards and their commands —
 * composed under the club's own chrome; the club's arithmetic (tier rates,
 * attendance points) lives in its RecordAttendance command.
 */
export class ClubMembership extends CardDef {
  static displayName = 'Club Membership';
  static icon = ShieldIcon;
  static prefersWideFormat = true;

  @field clubName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ClubMembership) {
      return this.clubName?.trim()?.length
        ? `${this.clubName} — Membership`
        : 'Club Membership';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get realm(): string | undefined {
      return this.args.model?.[realmURL]?.href;
    }
    <template>
      <ClubConsole
        @clubName={{@model.clubName}}
        @realm={{this.realm}}
        @context={{@context}}
      />
    </template>
  };
}
