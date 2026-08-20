import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import UrlField from '@cardstack/base/url';
import TextAreaField from '@cardstack/base/text-area';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import enumField from '@cardstack/base/enum';
import RecurringPatternField from '@cardstack/catalog/fields/recurring-pattern/recurring-pattern';
import ClipboardCheckIcon from '@cardstack/boxel-icons/clipboard-check';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';
import HistoryIcon from '@cardstack/boxel-icons/history';
import TriangleAlertIcon from '@cardstack/boxel-icons/triangle-alert';
import BanknoteIcon from '@cardstack/boxel-icons/banknote';
import ScrollTextIcon from '@cardstack/boxel-icons/scroll-text';

import { Contract } from './contract';
import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';

/**
 * A promise a contract compels, with a date and an owner.
 *
 * WHY NOT `Task`. The matrix realm has task-shaped blocks
 * (OnboardingChecklistTaskField) and they were considered and rejected: a task
 * is work somebody chose to do, an obligation is work a signed agreement
 * requires. Missing one is a breach, not a slipped sprint — so lateness here
 * carries a consequence sentence and an escalation, which a task has no place
 * for.
 *
 * WHAT IS CONSUMED. Recurrence is the catalog's `RecurringPatternField`
 * (@cardstack/catalog/fields/recurring-pattern) — a full pattern/interval/
 * end-condition rule that already ships with its own editor. Money is base
 * `AmountWithCurrency`. Neither is re-implemented here.
 *
 * WHAT IS DELIBERATELY NOT STORED. `status` and `nextDueDate` are computed. A
 * stored obligation status is the single most drift-prone value in a
 * compliance app: the dashboard buckets by date while the pill reads the
 * stored enum, and one contract shows "on track" inside the overdue column.
 */

export const OBLIGATION_TYPES = [
  'payment',
  'delivery',
  'notification',
  'compliance',
  'insurance',
  'audit',
];

export const OBLIGATION_TYPE_LABELS: Record<string, string> = {
  payment: 'Payment',
  delivery: 'Delivery',
  notification: 'Notification',
  compliance: 'Compliance',
  insurance: 'Insurance',
  audit: 'Audit',
};

export const ObligationTypeField = enumField(StringField, {
  options: OBLIGATION_TYPES.map((value) => ({
    value,
    label: OBLIGATION_TYPE_LABELS[value],
  })),
  displayName: 'Obligation Type',
  icon: ClipboardCheckIcon,
});

/**
 * Five states, none of them written by a human.
 *
 * There is deliberately no "in progress". Half-discharged is not a compliance
 * state — either the period's duty was met or it was not, and a partial credit
 * is how a 100% score comes to hide a breach.
 */
export const OBLIGATION_STATES = [
  'on_track',
  'due_soon',
  'due_today',
  'overdue',
  'closed',
];

export const OBLIGATION_STATE_LABELS: Record<string, string> = {
  on_track: 'On track',
  due_soon: 'Due soon',
  due_today: 'Due today',
  overdue: 'Overdue',
  closed: 'Closed',
};

export const OBLIGATION_STATE_HUE: Record<string, Hue> = {
  on_track: 'green',
  due_soon: 'amber',
  due_today: 'orange',
  overdue: 'red',
  closed: 'slate',
};

export function obligationStateLabel(value?: string | null): string {
  return OBLIGATION_STATE_LABELS[value ?? ''] ?? '—';
}

/** Days before the due date at which an obligation starts reading as urgent. */
export const DUE_SOON_DAYS = 7;

const MS_PER_DAY = 86_400_000;

function midnightOf(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntil(date?: Date | string | null): number | undefined {
  if (!date) return undefined;
  let t = new Date(date);
  if (!Number.isFinite(t.getTime())) return undefined;
  return Math.round((midnightOf(t) - midnightOf(new Date())) / MS_PER_DAY);
}

function calendarDay(d: Date): string {
  let m = `${d.getMonth() + 1}`.padStart(2, '0');
  let day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Advance a calendar date by `n` periods of the given pattern.
 *
 * Built from local year/month/day parts rather than millisecond arithmetic, so
 * a monthly obligation lands on the 5th of each month rather than drifting by
 * a day whenever a daylight-saving boundary falls inside the interval.
 */
function advance(
  start: Date,
  pattern: string | null | undefined,
  interval: number,
  n: number,
): Date {
  let step = Math.max(1, interval || 1) * n;
  let y = start.getFullYear();
  let m = start.getMonth();
  let d = start.getDate();
  switch (pattern) {
    case 'daily':
      return new Date(y, m, d + step);
    case 'weekly':
      return new Date(y, m, d + step * 7);
    case 'monthly':
      return new Date(y, m + step, d);
    case 'quarterly':
      return new Date(y, m + step * 3, d);
    case 'yearly':
      return new Date(y, m + step * 12, d);
    default:
      return new Date(y, m, d);
  }
}

/**
 * One discharged period, with the proof.
 *
 * Evidence lives here rather than on the obligation because the question an
 * auditor asks is "show me September", not "show me the contract". Without a
 * per-period artifact a completed obligation is a claim.
 */
export class ObligationCompletionField extends FieldDef {
  static displayName = 'Obligation Completion';

  /** Which occurrence this discharges, as a calendar day. */
  @field period = contains(StringField);
  @field completedAt = contains(DateField);
  @field completedBy = linksTo(() => Employee);
  /** Proof — a file in the realm, an invoice, a certificate URL. */
  @field evidenceUrl = contains(UrlField);
  @field note = contains(TextAreaField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='oc-row'>
        <span class='oc-period'>{{@model.period}}</span>
        {{#if @model.evidenceUrl}}
          <a
            class='oc-link'
            href={{@model.evidenceUrl}}
            target='_blank'
            rel='noopener noreferrer'
          >evidence</a>
        {{else}}
          <span class='oc-none'>no evidence</span>
        {{/if}}
      </div>
      <style scoped>
        .oc-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          font-size: var(--boxel-font-size-xs);
        }
        .oc-period {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .oc-none {
          color: var(--boxel-danger);
        }
      </style>
    </template>
  };
}

export class Obligation extends CardDef {
  static displayName = 'Obligation';
  static icon = ClipboardCheckIcon;

  @field contract = linksTo(() => Contract);
  @field obligationType = contains(ObligationTypeField);
  @field description = contains(StringField);
  /**
   * What breach costs, in one sentence.
   *
   * Rendered on the card wherever there is room, because a date alone does not
   * motivate anybody — "13 Aug" and "13 Aug, or it auto-renews at $612,400"
   * are read very differently.
   */
  @field consequence = contains(StringField);

  @field amount = contains(AmountWithCurrency);
  @field recurrence = contains(RecurringPatternField);
  @field firstDueDate = contains(DateField);
  @field completions = containsMany(ObligationCompletionField);

  @field owner = linksTo(() => Employee);
  /** Written once, when it first goes past the grace window. */
  @field escalatedTo = linksTo(() => Employee);

  /**
   * REMINDER LADDER — configured here, NOT YET FIRING.
   *
   * BLOCKED, with evidence. The matrix tracker records `Remind` as blocked on
   * two platform gaps: a card-reachable scheduler, and a notification identity
   * to send as. Neither exists in this realm, so nothing in this app can make
   * a reminder arrive.
   *
   * The schema ships anyway, and the UI says plainly that it is not firing.
   * The alternative — leaving the fields out — means every obligation already
   * created has to be edited once the scheduler lands. The alternative that
   * would be worse still is wiring a UI that looks like it sends reminders and
   * does not, which on a compliance deadline is an actively dangerous lie.
   *
   * Days BEFORE the due date, e.g. [7, 3, 1] or the renewal ladder [90, 60, 30].
   */
  @field reminderDaysBefore = containsMany(NumberField);
  @field reminderRecipients = linksToMany(() => Employee);
  @field closedAt = contains(DateField);

  @field nextDueDate = contains(StringField, {
    computeVia: function (this: Obligation) {
      if (this.closedAt) return undefined;
      if (!this.firstDueDate) return undefined;
      let start = new Date(this.firstDueDate);
      if (!Number.isFinite(start.getTime())) return undefined;
      let done = (this.completions ?? []).filter(Boolean).length;
      let pattern = this.recurrence?.pattern;
      // A one-time obligation has exactly one occurrence: once it is
      // discharged there is no next date, and reporting one would invent work.
      if (!pattern || pattern === 'none') {
        return done > 0 ? undefined : calendarDay(start);
      }
      let occurrences = this.recurrence?.occurrences;
      if (typeof occurrences === 'number' && done >= occurrences) {
        return undefined;
      }
      let next = advance(start, pattern, this.recurrence?.interval ?? 1, done);
      let end = this.recurrence?.endDate
        ? new Date(this.recurrence.endDate)
        : undefined;
      if (end && Number.isFinite(end.getTime()) && next > end) return undefined;
      return calendarDay(next);
    },
  });

  @field daysUntilDue = contains(NumberField, {
    computeVia: function (this: Obligation) {
      return daysUntil(this.nextDueDate);
    },
  });

  @field status = contains(StringField, {
    computeVia: function (this: Obligation) {
      if (this.closedAt) return 'closed';
      let d = this.daysUntilDue;
      // No next date and not explicitly closed means the schedule ran out —
      // there is nothing left to discharge.
      if (typeof d !== 'number') return 'closed';
      if (d < 0) return 'overdue';
      if (d === 0) return 'due_today';
      if (d <= DUE_SOON_DAYS) return 'due_soon';
      return 'on_track';
    },
  });

  @field isOverdue = contains(NumberField, {
    computeVia: function (this: Obligation) {
      let d = this.daysUntilDue;
      return typeof d === 'number' && d < 0 ? Math.abs(d) : 0;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Obligation) {
      return this.description?.trim()?.length
        ? this.description
        : 'Untitled obligation';
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: Obligation) {
      return [
        OBLIGATION_TYPE_LABELS[this.obligationType ?? ''],
        obligationStateLabel(this.status),
      ]
        .filter(Boolean)
        .join(' · ');
    },
  });


  /**
   * ATTRIBUTE-ONLY, deliberately.
   *
   * Prerendered fitted does not resolve `linksTo`, so a fitted that reaches for
   * a linked card renders as "Card Error" in any grid — the exact failure this
   * card would have hit without a fitted of its own, falling back to CardDef's
   * default. Everything below is a plain attribute or a computed string.
   *
   * The type scale is capped against `cqb` on `--type-base` itself rather than
   * per-role: in a wide+short cell the `cqi` term dominates and per-role `cqb`
   * caps never bind, which is how a headline outgrows its row and gets sheared.
   */

  /**
   * The domain question: "is this on track, and what does missing it cost?"
   *
   * So the hero is the countdown and the consequence — not the description with
   * a due date buried in row four of a definition list. Everything else on this
   * card is supporting detail and is quieter.
   */
  static isolated = class Isolated extends Component<typeof Obligation> {
    get hue(): Hue {
      return OBLIGATION_STATE_HUE[this.args.model?.status ?? ''] ?? 'slate';
    }
    get stateLabel() {
      return obligationStateLabel(this.args.model?.status);
    }
    /** The figure the reader came for: days, signed, in words. */
    get countdown(): { n: string; unit: string } {
      let d = this.args.model?.daysUntilDue;
      if (this.args.model?.status === 'closed') return { n: '—', unit: 'closed' };
      if (typeof d !== 'number') return { n: '—', unit: 'no schedule' };
      if (d < 0) return { n: `${Math.abs(d)}`, unit: Math.abs(d) === 1 ? 'day overdue' : 'days overdue' };
      if (d === 0) return { n: '0', unit: 'due today' };
      return { n: `${d}`, unit: d === 1 ? 'day left' : 'days left' };
    }
    get periods() {
      return (this.args.model?.completions ?? []).filter(Boolean);
    }
    get isOverdueNow() {
      return this.args.model?.status === 'overdue';
    }
    <template>
      <article class='ob-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'>
              <ClipboardCheckIcon role='presentation' />
              {{@model.obligationType}}
            </p>
            <h1>{{@model.cardTitle}}</h1>
            <StatePill @label={{this.stateLabel}} @hue={{this.hue}} @dot={{true}} />
          </div>
          <div class='hero-figure {{if this.isOverdueNow "is-late"}}'>
            <span class='fig-n'>{{this.countdown.n}}</span>
            <span class='fig-u'>{{this.countdown.unit}}</span>
          </div>
        </header>

        {{#if @model.consequence}}
          <p class='consequence'>
            <TriangleAlertIcon role='presentation' />
            {{@model.consequence}}
          </p>
        {{/if}}

        <dl class='glance'>
          <div>
            <dt>Next due</dt>
            <dd class='val'>{{if @model.nextDueDate @model.nextDueDate '—'}}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd class='val'>
              {{#if @model.amount.amount}}<@fields.amount @format='atom' />{{else}}—{{/if}}
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              {{#if @model.owner}}<@fields.owner
                  @format='atom'
                  @displayContainer={{false}}
                />{{else}}Unassigned{{/if}}
            </dd>
          </div>
        </dl>

        <section class='panel'>
          <h2><CalendarClockIcon role='presentation' />Schedule</h2>
          <@fields.recurrence @format='embedded' />
        </section>

        <section class='panel'>
          <h2><HistoryIcon role='presentation' />Evidence
            <span class='count'>{{this.periods.length}}</span></h2>
          {{#if this.periods.length}}
            <@fields.completions />
          {{else}}
            <p class='empty'>
              <BanknoteIcon role='presentation' />
              No period has been discharged yet. Attach proof when one is —
              a completed obligation with no evidence is a claim, not a record.
            </p>
          {{/if}}
        </section>

        {{#if @model.contract}}
          <section class='panel'>
            <h2><ScrollTextIcon role='presentation' />Comes from</h2>
            <@fields.contract @format='embedded' />
          </section>
        {{/if}}
      </article>

      <style scoped>
        .ob-page {
          /* No host container on an isolated card — declare our own or every
             @container rule below is inert. inline-size, not size: this scrolls. */
          container-type: inline-size;
          container-name: ob-page;

          --panel-bg: color-mix(in oklch, var(--foreground, #111) 3%, transparent);
          --panel-pad: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          --panel-radius: var(--radius, 8px);

          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          color: var(--foreground, #111);
          font-family: var(--font-sans, inherit);
        }
        .hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--boxel-sp-lg);
          border-bottom: 2px solid var(--foreground, #111);
          padding-bottom: var(--boxel-sp);
        }
        .hero-id { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .kicker {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, #6b7280);
        }
        .kicker :deep(svg) { width: max(14px, 1em); height: max(14px, 1em); }
        /* The heading is the one shout. The figure on the right supports it
           and is deliberately smaller — a card is opened for the thing it IS,
           and the number qualifies that rather than replacing it. */
        .hero h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          line-height: 1.15;
          letter-spacing: -0.015em;
        }
        /* The one dominant element: nothing else on the card comes near it. */
        .hero-figure {
          flex: none;
          text-align: right;
          line-height: 1;
        }
        .fig-n {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 1.45rem;
          font-weight: 600;
          letter-spacing: -0.03em;
        }
        .fig-u {
          display: block;
          margin-top: 4px;
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .is-late .fig-n { color: var(--boxel-danger, #b3261e); }

        .consequence {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          margin: 0;
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          background: color-mix(in oklch, var(--boxel-danger, #b3261e) 8%, transparent);
          font-size: var(--boxel-font-size-sm);
          line-height: 1.5;
        }
        .consequence :deep(svg) {
          width: max(16px, 1em);
          height: max(16px, 1em);
          flex: none;
          color: var(--boxel-danger, #b3261e);
        }

        .glance {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: var(--boxel-sp);
          margin: 0;
        }
        .glance dt {
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, #6b7280);
        }
        .glance dd {
          margin: 2px 0 0;
          font-size: var(--boxel-font-size-lg);
          font-weight: 600;
        }
        .val {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* One panel primitive — same inset and radius on every surfaced block,
           so their text all starts on the same line. */
        .panel {
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          background: var(--panel-bg);
        }
        .panel h2 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .panel h2 :deep(svg) {
          width: max(14px, 1em);
          height: max(14px, 1em);
          color: var(--muted-foreground, #6b7280);
        }
        .count {
          margin-left: auto;
          font-family: var(--font-mono, ui-monospace, monospace);
          color: var(--muted-foreground, #6b7280);
        }
        .empty {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.5;
          color: var(--muted-foreground, #6b7280);
        }
        .empty :deep(svg) {
          width: max(16px, 1em);
          height: max(16px, 1em);
          flex: none;
        }

        @container ob-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { text-align: left; }
          .fig-n { font-size: 2.4rem; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Obligation> {
    get hue(): Hue {
      return OBLIGATION_STATE_HUE[this.args.model?.status ?? ''] ?? 'slate';
    }
    get stateLabel() {
      return obligationStateLabel(this.args.model?.status);
    }
    <template>
      <article class='fit'>
        <header class='r-head'>
          <ClipboardCheckIcon role='presentation' />
          <span class='eyebrow'>{{@model.obligationType}}</span>
          <span class='head-chip'><StatePill @label={{this.stateLabel}} @hue={{this.hue}} /></span>
        </header>
        <div class='r-body'>
          <h3 class='anchor'>{{@model.cardTitle}}</h3>
          <p class='sub'>{{@model.consequence}}</p>
        </div>
        <footer class='r-meta'><span class='val'>{{@model.nextDueDate}}</span></footer>
      </article>
      <style scoped>
        .fit {
          --type-ratio: 1.24;
          --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb));
          --type-base: clamp(
            10px,
            min(calc(3px + 2.1cqi + 1cqb - 0.6 * var(--ar)), 10cqb),
            17px
          );
          --meta-size: max(10px, calc(var(--type-base) / var(--type-ratio)));
          --anchor-size: max(
            11px,
            min(calc(var(--type-base) * var(--type-ratio) * var(--type-ratio)), 26cqb)
          );
          --glyph: max(11px, min(3cqi, 14cqb));
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);

          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .r-head > :deep(svg) {
          width: var(--glyph);
          height: var(--glyph);
          flex: none;
          color: var(--accent, var(--boxel-highlight));
        }
        .eyebrow {
          font-size: max(9px, calc(var(--meta-size) * 0.85));
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .head-chip {
          margin-left: auto;
          flex: none;
        }
        .r-body {
          display: grid;
          align-content: start;
          gap: 2px;
        }
        /* The anchor: loudest thing at every size, and the only survivor at badge. */
        .anchor {
          margin: 0;
          font-size: var(--anchor-size);
          font-weight: 700;
          line-height: 1.18;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .sub {
          font-size: var(--meta-size);
          line-height: 1.3;
          color: var(--muted-foreground, var(--boxel-450));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .r-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: var(--meta-size);
          line-height: 1.3;
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* Values are all-or-nothing: hidden at a quantum, never ellipsised. */
        .val {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: var(--card-foreground, var(--boxel-dark));
          white-space: nowrap;
        }
        .tail {
          margin-left: auto;
          white-space: nowrap;
        }

        /* Badge: anchor only. */
        @container fitted-card (height <= 50px) {
          .fit { grid-template-rows: auto; }
          .r-body, .r-meta { display: none; }
        }
        /* Strip: anchor + meta, no body detail. */
        @container fitted-card (50px < height <= 80px) {
          .fit { grid-template-rows: auto minmax(0, 1fr); }
          .sub { display: none; }
          .r-meta { display: none; }
        }
        /* Thin tile: meta returns, secondary line still out. */
        @container fitted-card (80px < height <= 130px) {
          .sub { display: none; }
          .tail { display: none; }
        }
        @container fitted-card (width <= 150px) {
          .head-chip { display: none; }
          .tail { display: none; }
        }
        @container fitted-card (width <= 110px) {
          .eyebrow { display: none; }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Obligation> {
    get hue(): Hue {
      return OBLIGATION_STATE_HUE[this.args.model?.status ?? ''] ?? 'slate';
    }
    get label() {
      return obligationStateLabel(this.args.model?.status);
    }
    <template>
      <span class='ob-atom'>
        <span class='ob-name'>{{@model.cardTitle}}</span>
        <StatePill @label={{this.label}} @hue={{this.hue}} />
      </span>
      <style scoped>
        .ob-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
          max-width: 100%;
        }
        .ob-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Obligation> {
    get hue(): Hue {
      return OBLIGATION_STATE_HUE[this.args.model?.status ?? ''] ?? 'slate';
    }
    get label() {
      let m = this.args.model;
      if (m?.status === 'overdue' && m?.isOverdue) {
        return `${m.isOverdue}d overdue`;
      }
      return obligationStateLabel(m?.status);
    }
    <template>
      <article class='ob-row'>
        <div class='ob-main'>
          <h4 class='ob-title'>{{@model.cardTitle}}</h4>
          <p class='ob-sub'>{{@model.cardDescription}}</p>
          {{#if @model.consequence}}
            <p class='ob-cons'>{{@model.consequence}}</p>
          {{/if}}
        </div>
        <div class='ob-slot'>
          <span class='ob-lbl'>Due</span>
          {{#if @model.nextDueDate}}
            <span class='ob-due'>{{@model.nextDueDate}}</span>
          {{else}}
            <span class='ob-dash'>—</span>
          {{/if}}
        </div>
        <div class='ob-slot'>
          <span class='ob-lbl'>Amount</span>
          {{#if @model.amount.amount}}
            <@fields.amount @format='atom' />
          {{else}}
            <span class='ob-dash'>—</span>
          {{/if}}
        </div>
        <div class='ob-chip'>
          <StatePill @label={{this.label}} @hue={{this.hue}} @dot={{true}} />
        </div>
      </article>
      <style scoped>
        .ob-row {
        /* The host wraps a linked card in a CardContainer that draws a
           boundary and deliberately adds NO padding (base/field-component.gts),
           because padding there would shift the container-query breakpoints the
           inner card reasons about. So the inset has to come from here, or the
           text sits flush against the pill the host draws. */
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          display: grid;
          grid-template-columns: minmax(0, 1fr) 96px 92px auto;
          gap: var(--boxel-sp-xs);
          align-items: center;
        }
        .ob-title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          line-height: 1.25;
        }
        .ob-sub {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ob-cons {
          margin: 2px 0 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.4;
          color: var(--boxel-danger);
        }
        .ob-slot {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          font-size: var(--boxel-font-size-xs);
          font-variant-numeric: tabular-nums;
        }
        .ob-lbl {
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ob-due {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 600;
        }
        .ob-dash {
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container (width < 480px) {
          .ob-row {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .ob-slot {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Obligation;
