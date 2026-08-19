import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TimeField from '@cardstack/base/time';
import BooleanField from '@cardstack/base/boolean';
import enumField from '@cardstack/base/enum';
import CalendarCogIcon from '@cardstack/boxel-icons/calendar-cog';
import CalendarOffIcon from '@cardstack/boxel-icons/calendar-off';
import { htmlSafe } from '@ember/template';

import type { BusinessSchedule, DayWindow } from './utils/sla';

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 'Mon, Tue, Wed, Thu, Fri' is five things to read; 'Mon–Fri' is one. Only a
// genuinely contiguous run collapses — a Mon/Wed/Fri schedule stays listed, or
// the summary would claim the desk is open on days it is closed.
function contractDays(days: string[]): string {
  let indices = days
    .map((d) => WEEKDAYS.indexOf(d as never))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (!indices.length) {
    return '';
  }
  let contiguous = indices.every(
    (index, position) => position === 0 || index === indices[position - 1]! + 1,
  );
  if (contiguous && indices.length > 2) {
    return `${SHORT_DAYS[indices[0]!]}–${SHORT_DAYS[indices[indices.length - 1]!]}`;
  }
  return indices.map((i) => SHORT_DAYS[i]).join(', ');
}

const WeekdayField = enumField(StringField, {
  displayName: 'Weekday',
  options: WEEKDAYS as unknown as string[],
});

/** '09:00' → 540. Anything unparseable is treated as midnight. */
export function minutesOfClock(value?: string | null): number {
  let match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) {
    return 0;
  }
  let hours = Math.min(24, Math.max(0, Number(match[1])));
  let minutes = Math.min(59, Math.max(0, Number(match[2])));
  return hours * 60 + minutes;
}

/**
 * A holiday's calendar date as `YYYY-MM-DD`.
 *
 * Read in UTC, not local time. A `DateField` carries a calendar date rather
 * than an instant — it deserializes to UTC midnight — so reading it with the
 * local getters shifts the day backwards for anyone west of Greenwich, and a
 * public holiday would land on the wrong date for half the world. The value is
 * compared against `zonedParts().isoDate`, which is likewise a calendar date.
 */
function isoDay(at: Date): string {
  let month = String(at.getUTCMonth() + 1).padStart(2, '0');
  let day = String(at.getUTCDate()).padStart(2, '0');
  return `${at.getUTCFullYear()}-${month}-${day}`;
}

/** Read the clock string out of a TimeField, with an em dash for "unset". */
function clockOf(time?: { value?: string | null } | null): string {
  return time?.value?.trim() || '—';
}

export function clockOfMinutes(minutes: number): string {
  let m = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** One day's opening window. A day with no window never ticks. */
export class DayWindowField extends FieldDef {
  static displayName = 'Working Hours';
  static icon = CalendarCogIcon;

  @field day = contains(WeekdayField);
  // Base `TimeField`, not a raw string with an 'HH:MM' description. It already
  // owns the 24-hour picker, the locale-aware display and the validation this
  // field would otherwise restate — and restating it is how two spellings of
  // the same clock value end up in one realm.
  @field opensAt = contains(TimeField);
  @field closesAt = contains(TimeField);

  @field title = contains(StringField, {
    computeVia: function (this: DayWindowField) {
      if (!this.day) {
        return 'Unset day';
      }
      return `${this.day} ${clockOf(this.opensAt)}–${clockOf(this.closesAt)}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='dw'>
        <span class='dw-day'>{{@model.day}}</span>
        <span
          class='dw-hours'
        >{{@model.opensAt.value}}–{{@model.closesAt.value}}</span>
      </span>
      <style scoped>
        .dw {
          display: inline-flex;
          gap: var(--boxel-sp-xs);
          font-family: var(--font-sans, var(--boxel-font-family));
          font-size: var(--boxel-font-size-xs);
        }
        .dw-day {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .dw-hours {
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  // The three controls are the fields' own edit templates. TimeField already
  // renders the 24-hour picker and writes back through the model, so the
  // hand-wired BoxelInput pair this replaced was the same control built a
  // second time.
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='dw-edit'>
        <@fields.day />
        <@fields.opensAt />
        <span class='dw-dash'>to</span>
        <@fields.closesAt />
      </div>
      <style scoped>
        .dw-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .dw-dash {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

interface StripDay {
  short: string;
  isOpen: boolean;
  label: string;
  barStyle: ReturnType<typeof htmlSafe>;
}

/**
 * When the SLA clock is allowed to run.
 *
 * A ticket raised at 4:55pm on Friday against a four-hour target is not late
 * on Saturday morning — this card is what makes that true, and it is the piece
 * that separates a real helpdesk from a countdown widget.
 */
export class Schedule extends CardDef {
  static displayName = 'Business Hours';
  static icon = CalendarCogIcon;

  @field name = contains(StringField);
  @field timeZone = contains(StringField, {
    description: 'IANA zone, e.g. Asia/Kuala_Lumpur',
  });
  @field windows = containsMany(DayWindowField);
  @field holidays = containsMany(DateField);
  @field isDefault = contains(BooleanField);

  @field title = contains(StringField, {
    computeVia: function (this: Schedule) {
      return this.name?.trim() || 'Untitled schedule';
    },
  });

  // Denormalized for fitted and for queue rows: a prerendered view cannot walk
  // `windows`, and even where it can, 'Mon–Fri 09:00–17:00' is what a person
  // actually wants to read.
  @field summary = contains(StringField, {
    computeVia: function (this: Schedule) {
      let open = (this.windows ?? []).filter((w) => w?.day);
      if (!open.length) {
        return 'Always on';
      }
      let byHours = new Map<string, string[]>();
      for (let w of open) {
        let key = `${w.opensAt?.value ?? '00:00'}–${w.closesAt?.value ?? '24:00'}`;
        byHours.set(key, [...(byHours.get(key) ?? []), w.day!]);
      }
      return [...byHours.entries()]
        .map(([hours, days]) => `${contractDays(days)} ${hours}`)
        .join(', ');
    },
  });

  // The fitted footer used to repeat `summary`, which the body already showed —
  // measured against a real instance the hours string printed THREE times in one
  // cell. Whether this is the schedule new queues inherit is the one fact about a
  // Schedule that nothing else on the card states, so the footer carries it. Both
  // branches return text: an empty footer at 14 of 16 sizes is its own defect.
  @field defaultLabel = contains(StringField, {
    computeVia: function (this: Schedule) {
      return this.isDefault ? 'Default schedule' : 'Alternate schedule';
    },
  });

  @field holidayCount = contains(StringField, {
    computeVia: function (this: Schedule) {
      let n = (this.holidays ?? []).filter(Boolean).length;
      return n === 1 ? '1 holiday' : `${n} holidays`;
    },
  });

  /**
   * The plain shape `utils/sla` works in. Deliberately a getter, not a field:
   * commands read it at the moment they compute a deadline, and nothing about
   * it is worth storing twice.
   */
  get businessSchedule(): BusinessSchedule {
    let windows: DayWindow[] = (this.windows ?? [])
      .filter((w) => w?.day)
      .map((w) => ({
        day: WEEKDAYS.indexOf(w.day as never),
        openMinutes: minutesOfClock(w.opensAt?.value),
        closeMinutes: minutesOfClock(w.closesAt?.value),
      }))
      .filter((w) => w.day >= 0);
    return {
      timeZone: this.timeZone?.trim() || 'UTC',
      windows,
      holidays: (this.holidays ?? [])
        .filter(Boolean)
        .map((d) => isoDay(d as Date)),
    };
  }

  static isolated = class Isolated extends Component<typeof this> {
    get strip(): StripDay[] {
      let windows = this.args.model?.windows ?? [];
      return SHORT_DAYS.map((short, index) => {
        let match = windows.find(
          (w) => WEEKDAYS.indexOf(w?.day as never) === index,
        );
        if (!match) {
          return {
            short,
            isOpen: false,
            label: 'Closed',
            barStyle: htmlSafe('display:none'),
          };
        }
        let open = minutesOfClock(match.opensAt?.value);
        let close = minutesOfClock(match.closesAt?.value);
        let span = Math.max(0, close - open);
        return {
          short,
          isOpen: span > 0,
          label: `${clockOf(match.opensAt)}–${clockOf(match.closesAt)}`,
          // Drawn to scale on a 24-hour axis, so a Saturday half-day is
          // something you see rather than something you read.
          barStyle: htmlSafe(
            `top:${((open / (24 * 60)) * 100).toFixed(2)}%;height:${((span / (24 * 60)) * 100).toFixed(2)}%`,
          ),
        };
      });
    }

    <template>
      <article class='iso'>
        <header class='iso-head'>
          <div class='iso-id'>
            <h1>{{@model.title}}</h1>
            <p class='iso-sub'>{{@model.summary}}</p>
          </div>
          <dl class='iso-facts'>
            <div><dt>Time zone</dt><dd>{{if
                  @model.timeZone
                  @model.timeZone
                  'UTC'
                }}</dd></div>
            <div><dt>Holidays</dt><dd>{{@model.holidayCount}}</dd></div>
            {{#if @model.isDefault}}
              <div><dt>Role</dt><dd>Realm default</dd></div>
            {{/if}}
          </dl>
        </header>

        <section class='week' aria-label='Working week'>
          <h2 class='sr-only'>Working week</h2>
          <div class='week-axis' aria-hidden='true'>
            <span>00</span><span>06</span><span>12</span><span>18</span><span
            >24</span>
          </div>
          <ul class='week-days'>
            {{#each this.strip as |day|}}
              <li class='day {{unless day.isOpen "day-closed"}}'>
                <span class='day-track'>
                  <span class='day-bar' style={{day.barStyle}}></span>
                </span>
                <span class='day-name'>{{day.short}}</span>
                <span class='day-hours'>{{day.label}}</span>
              </li>
            {{/each}}
          </ul>
        </section>

        <section class='holidays'>
          <h2><CalendarOffIcon class='sec-icon' role='presentation' />Holidays</h2>
          {{#if @model.holidays.length}}
            <ul class='holiday-list'>
              {{#each @fields.holidays as |Holiday|}}
                <li><Holiday /></li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>No holidays set. The clock will tick on public
              holidays — add them here so it stops.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .iso {
          container-name: iso;
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          min-height: 100%;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .iso-head {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: var(--boxel-sp);
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
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
        .iso-facts {
          display: flex;
          gap: var(--boxel-sp-lg);
          margin: 0;
        }
        .iso-facts > div {
          min-width: 0;
        }
        .iso-facts dt {
          font-size: 0.625rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .iso-facts dd {
          margin: 0;
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
        .week-axis {
          display: flex;
          justify-content: space-between;
          font-size: 0.625rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          max-width: 3.5rem;
          flex-direction: column;
          height: 8rem;
        }
        .week {
          display: flex;
          gap: var(--boxel-sp-sm);
          align-items: stretch;
        }
        .week-days {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: var(--boxel-sp-xs);
          flex: 1;
          min-width: 0;
        }
        .day {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .day-track {
          position: relative;
          width: 100%;
          height: 8rem;
          border-radius: 3px;
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-200));
          overflow: hidden;
        }
        .day-bar {
          position: absolute;
          left: 0;
          right: 0;
          background: color-mix(
            in oklch,
            var(--primary, var(--boxel-highlight)) 55%,
            var(--card, var(--boxel-light))
          );
        }
        .day-name {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
        }
        .day-hours {
          font-size: 0.625rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          text-align: center;
        }
        .day-closed .day-name,
        .day-closed .day-hours {
          color: var(--muted-foreground, var(--boxel-450));
          opacity: 0.6;
        }
        .holidays h2 {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        /* Rule 5: one icon per section header, quiet by design — muted colour and
           ~1em with a px floor, so it identifies the section without competing
           with it. Same size in every header, which is what makes the card
           scannable by shape on a second visit. */
        .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: 0 0 auto;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .holiday-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .holiday-list li {
          padding: 0.15rem 0.5rem;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 3px;
          font-size: var(--boxel-font-size-xs);
          font-variant-numeric: tabular-nums;
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          max-width: 60ch;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        @container iso (max-width: 34rem) {
          .week-axis {
            display: none;
          }
          .day-hours {
            display: none;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='sch-emb'>
        <span class='sch-name'>{{@model.title}}</span>
        <span class='sch-sum'>{{@model.summary}}</span>
        <span class='sch-meta'>{{if @model.timeZone @model.timeZone 'UTC'}}
          ·
          {{@model.holidayCount}}</span>
      </div>
      <style scoped>
        .sch-emb {
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
        .sch-name {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
        }
        .sch-sum {
          font-size: var(--boxel-font-size-xs);
          font-variant-numeric: tabular-nums;
        }
        .sch-meta {
          font-size: 0.625rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='sch-atom'>{{@model.title}}{{#if @model.timeZone}}
          <span class='tz'>({{@model.timeZone}})</span>
        {{/if}}</span>
      <style scoped>
        .sch-atom {
          display: inline-flex;
          gap: 0.25rem;
          align-items: baseline;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .tz {
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.6875rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <header class='r-head'>
          <CalendarCogIcon class='fit-glyph' role='presentation' />
          <h3 class='title'>{{@model.title}}</h3>
          <span class='badge'>{{@model.timeZone}}</span>
        </header>
        {{! Five slots, five DISTINCT values. Previously `summary` filled .line,
            .blurb and .r-meta while `holidayCount` filled .line-2 and .tail, so
            11 of the 16 sizes repeated themselves. }}
        <div class='r-body'>
          <span class='line'>{{@model.summary}}</span>
          <p class='blurb'>{{@model.cardInfo.summary}}</p>
          <span class='tail'>{{@model.holidayCount}}</span>
        </div>
        <footer class='r-meta'>{{@model.defaultLabel}}</footer>
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
        /* fitted-card Rule 2: the anchor. Without it these cells were a title at
           weight 600 plus a badge — no image, no glyph, and 600 is not the
           "decisively loud" type the rule accepts as a substitute, so all 16
           sizes read as bare text. This is the card's OWN icon, the same one its
           isolated section headers use, which is what makes it identity rather
           than decoration.

           Sized in em with a px floor so it never shrinks to a dot; `align-self`
           because the head is a baseline row and an SVG has no baseline; muted so
           the title stays the loudest thing in the cell. */
        .fit-glyph {
          flex: none;
          align-self: center;
          width: max(11px, 1.1em);
          height: max(11px, 1.1em);
          color: var(--muted-foreground, var(--boxel-450));
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
          .fit-glyph {
            display: none;
          }
          /* The glyph is dropped just above, so from here down the anchor is
             type alone — and fitted-card Rule 2's typographic path wants real
             weight. Weight only, never size: at 150px the title is one word from
             wrapping and Rule 1 (nothing clipped) outranks Rule 2. */
          .title {
            font-weight: 700;
          }
        }
      </style>
    </template>
  };
}
