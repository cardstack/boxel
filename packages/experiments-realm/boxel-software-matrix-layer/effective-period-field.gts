import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';

/**
 * Effective Period (EP) — the obligations window of an agreement, and the
 * one date a contracts manager is actually judged on: the notice deadline.
 *
 * `endDate` is when the term runs out. `noticeDeadline` is `endDate −
 * noticeDays`, the last day a party may still say "do not renew". Every
 * renewal that "nobody chose" was missed on the second date, not the first,
 * which is why it is computed here as a first-class value rather than left
 * to whoever is reading the calendar.
 *
 * Domain-neutral: nothing here knows what document it sits on. A lease, an
 * MSA, a licence and an insurance policy all carry one of these.
 */

const MS_PER_DAY = 86_400_000;

function toDate(v?: Date | string | null): Date | undefined {
  if (!v) return undefined;
  let d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** Whole days from today to `date`; negative once the date has passed. */
export function daysUntil(date?: Date | string | null): number | undefined {
  let t = toDate(date);
  if (!t) return undefined;
  let now = new Date();
  let a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * `endDate − noticeDays`, as a calendar day.
 *
 * Built from local calendar parts, NOT via `toISOString()`: a deadline is a
 * day, and `new Date('2027-05-15').toISOString()` yields the 14th anywhere
 * east of UTC. A notice served one day late is a renewal nobody chose.
 */
export function noticeDeadlineOf(
  endDate?: Date | string | null,
  noticeDays?: number | null,
): Date | undefined {
  let end = toDate(endDate);
  if (!end) return undefined;
  let days = typeof noticeDays === 'number' && Number.isFinite(noticeDays)
    ? noticeDays
    : 0;
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - days);
}

export function formatDay(d?: Date | string | null): string {
  let t = toDate(d);
  if (!t) return '—';
  return t.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Where the period stands today. Ordered by urgency for anyone sorting a
 * renewal board: the notice window is the state that needs a human.
 */
export type PeriodState =
  | 'not started'
  | 'in force'
  | 'notice window'
  | 'notice passed'
  | 'ended';

export const PERIOD_STATE_HUE: Record<PeriodState, Hue> = {
  'not started': 'slate',
  'in force': 'green',
  'notice window': 'amber',
  'notice passed': 'red',
  ended: 'slate',
};

export function periodStateOf(
  effectiveDate?: Date | string | null,
  endDate?: Date | string | null,
  noticeDays?: number | null,
  autoRenews?: boolean | null,
): PeriodState | undefined {
  let start = daysUntil(effectiveDate);
  let end = daysUntil(endDate);
  if (start === undefined && end === undefined) return undefined;
  if (start !== undefined && start > 0) return 'not started';
  if (end !== undefined && end < 0) return 'ended';
  let notice = daysUntil(noticeDeadlineOf(endDate, noticeDays));
  if (notice !== undefined && autoRenews) {
    if (notice < 0) return 'notice passed';
    // 30 days is the practical runway to get a termination letter approved
    // and delivered; inside it the deadline is live work, not a date.
    if (notice <= 30) return 'notice window';
  }
  return 'in force';
}

export class EffectivePeriodField extends FieldDef {
  static displayName = 'Effective Period';
  static icon = CalendarClockIcon;

  @field effectiveDate = contains(DateField);
  @field endDate = contains(DateField);
  @field autoRenews = contains(BooleanField);
  /** Length of each renewal term once it rolls. */
  @field renewalTermMonths = contains(NumberField);
  /** Days before endDate by which non-renewal notice must be given. */
  @field noticeDays = contains(NumberField);

  /** endDate − noticeDays. THE deadline. */
  @field noticeDeadline = contains(DateField, {
    computeVia: function (this: EffectivePeriodField) {
      return noticeDeadlineOf(this.endDate, this.noticeDays);
    },
  });

  /**
   * Wall-clock derived: fresh on render, only as fresh as the last reindex in
   * a query. Sort a loaded board by it; never filter the index on it.
   */
  @field daysToNotice = contains(NumberField, {
    computeVia: function (this: EffectivePeriodField) {
      return daysUntil(noticeDeadlineOf(this.endDate, this.noticeDays));
    },
  });

  @field daysToEnd = contains(NumberField, {
    computeVia: function (this: EffectivePeriodField) {
      return daysUntil(this.endDate);
    },
  });

  @field termMonths = contains(NumberField, {
    computeVia: function (this: EffectivePeriodField) {
      let s = toDate(this.effectiveDate);
      let e = toDate(this.endDate);
      if (!s || !e) return undefined;
      // A term is conventionally written "15 Jul 2026 – 14 Jul 2027": the end
      // date is the day BEFORE the anniversary. Counting from the day after the
      // end date makes that read as the 12 months it is.
      let inclusiveEnd = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
      let months =
        (inclusiveEnd.getFullYear() - s.getFullYear()) * 12 +
        (inclusiveEnd.getMonth() - s.getMonth()) +
        (inclusiveEnd.getDate() >= s.getDate() ? 0 : -1);
      return Math.max(0, months);
    },
  });

  @field periodState = contains(StringField, {
    computeVia: function (this: EffectivePeriodField) {
      return periodStateOf(
        this.effectiveDate,
        this.endDate,
        this.noticeDays,
        this.autoRenews,
      );
    },
  });

  static atom = class Atom extends Component<typeof this> {
    get label() {
      let m = this.args.model;
      if (!m?.effectiveDate && !m?.endDate) return 'No term set';
      return `${formatDay(m.effectiveDate)} – ${formatDay(m.endDate)}`;
    }
    get hue(): Hue {
      return PERIOD_STATE_HUE[(this.args.model?.periodState as PeriodState) ?? 'in force'] ?? 'slate';
    }
    <template>
      <span class='ep-atom'>
        <CalendarClockIcon class='ep-icon' role='presentation' />
        <span class='ep-range'>{{this.label}}</span>
        {{#if @model.autoRenews}}
          {{#if @model.noticeDeadline}}
            <StatePill
              @label='notice by {{formatDay @model.noticeDeadline}}'
              @hue={{this.hue}}
            />
          {{/if}}
        {{/if}}
      </span>
      <style scoped>
        .ep-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
          font-variant-numeric: tabular-nums;
        }
        .ep-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ep-range {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get state(): PeriodState | undefined {
      return this.args.model?.periodState as PeriodState | undefined;
    }
    get hue(): Hue {
      return this.state ? PERIOD_STATE_HUE[this.state] : 'slate';
    }
    get noticeLine(): string | undefined {
      let m = this.args.model;
      if (!m?.autoRenews) {
        return m?.endDate ? 'Fixed term — does not renew.' : undefined;
      }
      let d = m.daysToNotice;
      if (d === undefined || d === null) return 'Auto-renews; notice period not set.';
      if (d < 0) return `Notice deadline passed ${Math.abs(d)}d ago — renews for ${m.renewalTermMonths ?? '?'} months.`;
      if (d === 0) return 'Notice deadline is TODAY.';
      return `${d} days to give notice.`;
    }
    <template>
      <div class='ep'>
        <div class='ep-row'>
          <span class='ep-k'>Effective</span>
          <span class='ep-v'>{{formatDay @model.effectiveDate}}</span>
          <span class='ep-k'>Ends</span>
          <span class='ep-v'>{{formatDay @model.endDate}}</span>
          {{#if @model.termMonths}}
            <span class='ep-term'>{{@model.termMonths}} mo</span>
          {{/if}}
          {{#if this.state}}
            <StatePill @label={{this.state}} @hue={{this.hue}} @dot={{true}} />
          {{/if}}
        </div>
        {{#if @model.autoRenews}}
          <div class='ep-row ep-notice {{if (eqState this.state "notice passed") "is-late"}} {{if (eqState this.state "notice window") "is-live"}}'>
            <span class='ep-k'>Notice by</span>
            <span class='ep-v ep-deadline'>{{formatDay @model.noticeDeadline}}</span>
            <span class='ep-sub'>{{this.noticeLine}}</span>
          </div>
        {{else}}
          <div class='ep-row'>
            <span class='ep-sub'>{{this.noticeLine}}</span>
          </div>
        {{/if}}
      </div>
      <style scoped>
        .ep {
          --ep-warn-fg: color-mix(in oklch, var(--boxel-warning) 65%, var(--foreground, var(--boxel-dark)));
          --ep-late-fg: color-mix(in oklch, var(--boxel-danger) 70%, var(--foreground, var(--boxel-dark)));
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
          font-variant-numeric: tabular-nums;
        }
        .ep-row {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 0.35rem 0.6rem;
        }
        .ep-k {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ep-v {
          font-weight: 600;
        }
        .ep-term {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ep-deadline {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .ep-sub {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ep-notice.is-live .ep-deadline,
        .ep-notice.is-live .ep-sub {
          color: var(--ep-warn-fg);
        }
        .ep-notice.is-late .ep-deadline,
        .ep-notice.is-late .ep-sub {
          color: var(--ep-late-fg);
          font-weight: 600;
        }
      </style>
    </template>
  };
}

function eqState(a?: string, b?: string) {
  return a === b;
}

/**
 * Edit — the five stored inputs as one dated row plus the renewal terms,
 * with the computed notice deadline shown live underneath so the person
 * typing a notice period sees the date it produces.
 */
EffectivePeriodField.edit = class Edit extends Component<typeof EffectivePeriodField> {
  <template>
    <div class='ep-edit'>
      <div class='ep-dates'>
        <FieldContainer @label='Effective from' @vertical={{true}}>
          <@fields.effectiveDate />
        </FieldContainer>
        <FieldContainer @label='Ends on' @vertical={{true}}>
          <@fields.endDate />
        </FieldContainer>
      </div>
      <div class='ep-renew'>
        <FieldContainer @label='Auto-renews' @vertical={{true}}>
          <@fields.autoRenews />
        </FieldContainer>
        <FieldContainer @label='Renewal term (months)' @vertical={{true}}>
          <@fields.renewalTermMonths />
        </FieldContainer>
        <FieldContainer @label='Notice period (days before end)' @vertical={{true}}>
          <@fields.noticeDays />
        </FieldContainer>
      </div>
      <p class='ep-derived'>
        {{#if @model.noticeDeadline}}
          Notice deadline
          <strong>{{formatDay @model.noticeDeadline}}</strong>
          {{#if @model.termMonths}}· {{@model.termMonths}}-month term{{/if}}
          — computed; not stored.
        {{else}}
          Set an end date and a notice period to see the notice deadline.
        {{/if}}
      </p>
    </div>
    <style scoped>
      .ep-edit {
        container-type: inline-size;
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .ep-dates {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xs);
      }
      .ep-renew {
        display: grid;
        grid-template-columns: auto 1fr 1fr;
        gap: var(--boxel-sp-xs);
        align-items: start;
      }
      .ep-derived {
        margin: 0;
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-450));
        font-variant-numeric: tabular-nums;
      }
      .ep-derived strong {
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-mono, ui-monospace, monospace);
      }
      @container (max-width: 480px) {
        .ep-dates,
        .ep-renew {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
};

export default EffectivePeriodField;
