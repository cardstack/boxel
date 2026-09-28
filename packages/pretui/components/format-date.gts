// Pretui — FormatDate: a date or time through Intl that never reads the clock.
import Component from '@glimmer/component';
import { toIso } from '../internal/reading-extras';
import { FormattedValue } from './formatted-value';
import { defined, formatDate, toDate } from '../internal/reading-format';
import type { FormatOptionBag } from '../internal/reading-format';

// ── FormatDate ← wa-format-date ──────────────────────────────────────────
// Sibling of RelativeTime (reading-extras): RelativeTime says how long ago,
// FormatDate says when. Same conventions — a <time> root with a machine
// `datetime`, a `title` carrying the long form, no clock read, no auto-tick.
// Better than the inspiration:
//   - `datetime` is calendar-correct: date-only renderings emit `toIso(d)`
//     (local calendar date) instead of an ISO instant, which for a Berlin
//     morning would otherwise stamp the previous day.
//   - Intl throws when `dateStyle`/`timeStyle` meet component options
//     (`month`, `weekday`, …). Precedence is resolved BEFORE Intl sees it:
//     any component option present drops the styles.
//   - `@omitCurrentYear` with a caller-supplied `@now` renders this year's
//     dates as 'Mar 14' and older ones as 'Mar 14, 2025'. It never reads the
//     clock: without `@now` it is inert.
const STYLE_TO_PARTS: Record<string, FormatOptionBag> = {
  short: { month: 'numeric', day: 'numeric' },
  medium: { month: 'short', day: 'numeric' },
  long: { month: 'long', day: 'numeric' },
  full: { weekday: 'long', month: 'long', day: 'numeric' },
};

const DATE_PART_KEYS = [
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'dayPeriod',
];

export interface FormatDateSignature {
  Args: {
    /** the moment to render: a Date, an epoch number, or a string. A bare `YYYY-MM-DD` is read as a LOCAL calendar date, not UTC midnight. */
    date?: string | number | Date;
    /** BCP-47 locale tag; omit for the runtime default. An unknown tag falls back rather than throwing. */
    locale?: string;
    /** whole-date preset. Ignored the moment any component knob (@month, @weekday, …) is set — Intl refuses the combination, so precedence is resolved here. */
    dateStyle?: 'full' | 'long' | 'medium' | 'short';
    /** whole-time preset, same precedence rule as @dateStyle */
    timeStyle?: 'full' | 'long' | 'medium' | 'short';
    /** weekday component */
    weekday?: 'long' | 'short' | 'narrow';
    /** era component */
    era?: 'long' | 'short' | 'narrow';
    /** year component */
    year?: 'numeric' | '2-digit';
    /** month component */
    month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
    /** day component */
    day?: 'numeric' | '2-digit';
    /** hour component */
    hour?: 'numeric' | '2-digit';
    /** minute component */
    minute?: 'numeric' | '2-digit';
    /** second component */
    second?: 'numeric' | '2-digit';
    /** timezone label component */
    timeZoneName?: 'long' | 'short' | 'shortOffset' | 'longOffset';
    /** force 12- or 24-hour clock; leave unset to follow the locale */
    hour12?: boolean;
    /** finer-grained clock control than @hour12 */
    hourCycle?: 'h11' | 'h12' | 'h23' | 'h24';
    /** IANA zone, e.g. 'Asia/Shanghai'. An unknown zone falls back to local rather than throwing. */
    timeZone?: string;
    /** non-Gregorian calendar, e.g. 'japanese' */
    calendar?: string;
    /** digit system, e.g. 'arab' */
    numberingSystem?: string;
    /** reference instant for @omitCurrentYear. Caller-supplied, exactly as RelativeTime takes @now — this component never reads the clock. */
    now?: string | number | Date;
    /** drop the year when the date falls in the same year as @now. Inert without @now. */
    omitCurrentYear?: boolean;
    /** any Intl.DateTimeFormat option not named above; named knobs win over it */
    options?: FormatOptionBag;
    /** title attribute carrying the long form (default true). A caller-supplied title in ...attributes wins. */
    hint?: boolean;
    /** wear the Token dress (Law 3) — for machine contexts like a log line */
    token?: boolean;
    /** sr-only mirror policy: 'auto' mirrors when the visible form is numeric-heavy ('3/14/26' reads badly aloud), 'always' forces it, 'off' suppresses it */
    spoken?: 'auto' | 'always' | 'off';
    /** rendered when the date is missing or unparseable (default '—') */
    placeholder?: string;
  };
  Element: HTMLTimeElement;
}

export class FormatDate extends Component<FormatDateSignature> {
  get dateObj(): Date | undefined {
    return toDate(this.args.date);
  }
  get nowObj(): Date | undefined {
    return toDate(this.args.now);
  }
  /** the caller's knobs merged over @options, undefined entries stripped */
  get requested(): FormatOptionBag {
    let a = this.args;
    return defined({
      ...(a.options ?? {}),
      dateStyle: a.dateStyle,
      timeStyle: a.timeStyle,
      weekday: a.weekday,
      era: a.era,
      year: a.year,
      month: a.month,
      day: a.day,
      hour: a.hour,
      minute: a.minute,
      second: a.second,
      timeZoneName: a.timeZoneName,
      hour12: a.hour12,
      hourCycle: a.hourCycle,
      timeZone: a.timeZone,
      calendar: a.calendar,
      numberingSystem: a.numberingSystem,
    });
  }
  get options(): FormatOptionBag {
    let bag: FormatOptionBag = { ...this.requested };
    let hasParts = DATE_PART_KEYS.some((k) => bag[k] !== undefined);
    if (hasParts) {
      // Intl throws on dateStyle beside a component option — parts win.
      delete bag['dateStyle'];
      delete bag['timeStyle'];
    }
    let sameYear =
      this.args.omitCurrentYear === true &&
      this.dateObj !== undefined &&
      this.nowObj !== undefined &&
      this.dateObj.getFullYear() === this.nowObj.getFullYear();
    if (sameYear) {
      let style = bag['dateStyle'];
      if (typeof style === 'string' && STYLE_TO_PARTS[style]) {
        delete bag['dateStyle'];
        bag = { ...STYLE_TO_PARTS[style], ...bag };
      }
      delete bag['year'];
    }
    if (Object.keys(bag).length === 0) {
      return { dateStyle: 'medium' };
    }
    // A bag of only zone/system knobs still needs something to render.
    let renders =
      bag['dateStyle'] !== undefined ||
      bag['timeStyle'] !== undefined ||
      DATE_PART_KEYS.some((k) => bag[k] !== undefined);
    return renders ? bag : { ...bag, dateStyle: 'medium' };
  }
  get hasTime(): boolean {
    let bag = this.options;
    return (
      bag['timeStyle'] !== undefined ||
      bag['hour'] !== undefined ||
      bag['minute'] !== undefined ||
      bag['second'] !== undefined
    );
  }
  get text(): string {
    let d = this.dateObj;
    if (!d) {
      return this.args.placeholder ?? '—';
    }
    return formatDate(d, this.args.locale, this.options);
  }
  get datetimeAttr(): string | undefined {
    let d = this.dateObj;
    if (!d) {
      return undefined;
    }
    // A calendar date stays a calendar date; an instant stays an instant.
    return this.hasTime ? d.toISOString() : toIso(d);
  }
  get longText(): string | undefined {
    let d = this.dateObj;
    if (!d) {
      return undefined;
    }
    let bag: FormatOptionBag = { dateStyle: 'full' };
    if (this.hasTime) {
      bag['timeStyle'] = 'short';
    }
    let zone = this.options['timeZone'];
    if (zone !== undefined) {
      bag['timeZone'] = zone;
    }
    return formatDate(d, this.args.locale, bag);
  }
  get titleAttr(): string | undefined {
    if (this.args.hint === false) {
      return undefined;
    }
    let long = this.longText;
    return long === this.text ? undefined : long;
  }
  get numericLooking(): boolean {
    let bag = this.options;
    let month = bag['month'];
    return (
      bag['dateStyle'] === 'short' || month === 'numeric' || month === '2-digit'
    );
  }
  get spoken(): string | undefined {
    let mode = this.args.spoken ?? 'auto';
    if (mode === 'off' || !this.dateObj) {
      return undefined;
    }
    if (mode === 'always' || this.numericLooking) {
      let long = this.longText;
      return long === this.text ? undefined : long;
    }
    return undefined;
  }
  get isEmpty(): boolean {
    return this.dateObj === undefined;
  }
  <template>
    <time
      class='pretui-format-date'
      datetime={{this.datetimeAttr}}
      title={{this.titleAttr}}
      data-test-pretui-format-date
      ...attributes
    >
      <FormattedValue
        @text={{this.text}}
        @spoken={{this.spoken}}
        @token={{@token}}
        @empty={{this.isEmpty}}
      />
    </time>
    <style scoped>
      .pretui-format-date {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}
