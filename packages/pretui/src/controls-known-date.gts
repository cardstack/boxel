// Pretui — CONTROLS territory: KnownDate.
//
// A date the reader ALREADY KNOWS — a birthday, a passport issue date, an
// expiry — typed into three plain fields rather than browsed in a calendar.
// The GOV.UK date-input pattern, which is the right pattern here for a
// reason worth stating: nobody scrolls a calendar back forty years to find
// their own birthday, and a `<input type='date'>` makes them try.
//
// This is NOT a second date control. It does not browse, it has no popup,
// and it does not compete with `DatePicker` / `Calendar` / `DateRangePicker`
// (reading-extras.gts) — those are for a date you are CHOOSING. Reach for
// KnownDate when the reader is transcribing a date they can already recite.
//
// ── Better than the inspiration (Web Awesome's wa-known-date) ───────────
//
// Upstream's docs say, in as many words, "no clever parsing". That is a
// defensible line for a component that only has to round-trip a form value,
// and it is the wrong line for a component people type into: a reader who
// writes `Mar` in the month box, or pastes `1990-04-15` into the first box,
// has communicated the date perfectly well and being told off for it is the
// component's failure, not theirs. So:
//
//  1. **Permissive parts.** The month box takes `3`, `03`, `mar`, `March`,
//     or the month's name in the rendered locale. The year box takes `90`
//     and expands it through a sliding window anchored on the caller's
//     reference instant, so a birthday input does not read `90` as the year
//     ninety.
//  2. **A pasted whole date distributes itself.** Typing or pasting
//     `15/4/1990`, `1990-04-15` or `15 April 1990` into ANY of the three
//     boxes fills all three. This is handled in the value handler rather
//     than a paste listener, so it works for typing, pasting, autofill and
//     speech input alike — one path, not four.
//  3. **Real-calendar validation.** 31 February is refused with a reason
//     that names the problem, rather than silently rolling over into March,
//     which is what `new Date(y, m, d)` does and what most hand-written
//     date inputs therefore do.
//  4. **A confirmation the reader can check.** The parsed date is echoed
//     back in full, with a calendar-correct relative phrase. Transcription
//     errors are caught by reading the echo, not by submitting the form.
//  5. **Locale-ordered fields with unchanged labels.** Same as upstream, and
//     kept, because it is the part upstream got right.
//
// ── The reference instant, and why it is an argument ────────────────────
//
// `Date.now()` is forbidden in a realm: it makes a card's rendered output
// depend on when the indexer happened to run, so the same card indexes
// differently every time. Relative phrasing therefore derives ENTIRELY from
// a caller-supplied `@reference`. With no reference the component still
// works — it just does not claim to know how long ago the date was, and
// two-digit years expand against a documented constant instead. Nothing here
// ever reads the clock. `RelativeTime` (reading-extras.gts) is the same
// contract; this module's phrasing is separate only because it is calendar-
// correct rather than millisecond-divided (see `knownDatePhrase`).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Input } from './known-date-input.gts';

// ═══════════════════════════════════════════════════════════════════════
// Pure date maths and parsing. No DOM, no clock.
// Unit-tested in controls-known-date.test.gts
// ═══════════════════════════════════════════════════════════════════════

/** The three boxes, as raw text. Empty strings, never undefined. */
export interface KnownDateParts {
  day: string;
  month: string;
  year: string;
}

/** Which order the three boxes are drawn in. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** What a parse produced: an ISO date, or the reason there isn't one. */
export interface KnownDateResult {
  /** `YYYY-MM-DD`, present only when all three parts resolved to a real
   * calendar date inside any supplied range */
  iso?: string;
  /** a sentence naming what is missing or wrong; absent when `iso` is set
   * AND when the fields are simply still empty */
  issue?: string;
  /** true when nothing has been typed at all — an untouched control is not
   * an error, and telling a reader off before they have started is the most
   * common date-input failure there is */
  empty: boolean;
}

/** A fixed instant used only to ask `Intl` what order a locale writes dates
 * in. Constant so the question is asked the same way on every render and in
 * every index pass — a probe built from the current time would make field
 * ORDER a function of the clock. */
const ORDER_PROBE = new Date(Date.UTC(2001, 11, 22));

/** The century a bare two-digit year is read against when the caller gives
 * no reference instant. Documented rather than derived, because the
 * alternative is deriving it from the clock. */
export const DEFAULT_PIVOT_YEAR = 2000;

/**
 * The order a locale writes day, month and year in — asked of `Intl` rather
 * than kept as a table, so a locale nobody thought about still comes out
 * right.
 *
 * Falls back to `dmy` (the majority order worldwide) when `Intl` produces
 * something unrecognised or the tag is malformed.
 */
export function orderForLocale(locale: string): DateOrder {
  try {
    let parts = new Intl.DateTimeFormat(locale).formatToParts(ORDER_PROBE);
    let sequence = parts
      .filter(
        (p) => p.type === 'day' || p.type === 'month' || p.type === 'year',
      )
      .map((p) => p.type.charAt(0))
      .join('');
    if (sequence === 'dmy' || sequence === 'mdy' || sequence === 'ymd') {
      return sequence;
    }
  } catch {
    // A malformed tag is the caller's typo, not a reason to render nothing.
  }
  return 'dmy';
}

/** Month names for a locale, long and short, lowercased — the vocabulary the
 * month box accepts beyond digits. English is always included so a reader
 * typing `Mar` into a `de-DE` form is still understood. */
function monthVocabulary(locale: string): Map<string, number> {
  let vocabulary = new Map<string, number>();
  let tags = [locale, 'en-US'];
  for (let tag of tags) {
    for (let style of ['long', 'short'] as const) {
      let format: Intl.DateTimeFormat;
      try {
        format = new Intl.DateTimeFormat(tag, {
          month: style,
          timeZone: 'UTC',
        });
      } catch {
        continue;
      }
      for (let index = 0; index < 12; index++) {
        let name = format
          .format(new Date(Date.UTC(2001, index, 15)))
          .toLowerCase()
          .replace(/[.‎‏]/g, '')
          .trim();
        if (name.length > 0 && !vocabulary.has(name)) {
          vocabulary.set(name, index + 1);
        }
      }
    }
  }
  return vocabulary;
}

/**
 * A month number 1–12 from whatever was typed, or `undefined`.
 *
 * Digits win, then an exact name match, then a prefix match of at least
 * three characters — `sep` resolves, `s` does not, because `s` is ambiguous
 * between September and no month at all in several locales and guessing is
 * worse than asking.
 */
export function parseMonth(text: string, locale = 'en-US'): number | undefined {
  let trimmed = (text ?? '').trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^\d{1,2}$/.test(trimmed)) {
    let numeric = Number(trimmed);
    return numeric >= 1 && numeric <= 12 ? numeric : undefined;
  }
  let vocabulary = monthVocabulary(locale);
  let exact = vocabulary.get(trimmed);
  if (exact !== undefined) {
    return exact;
  }
  if (trimmed.length >= 3) {
    let hits = new Set<number>();
    for (let [name, index] of vocabulary) {
      if (name.startsWith(trimmed)) {
        hits.add(index);
      }
    }
    if (hits.size === 1) {
      return Array.from(hits)[0];
    }
  }
  return undefined;
}

/**
 * Expand a typed year through a sliding century window.
 *
 * `90` against a 2026 reference is 1990, not 2090 — the window puts
 * two-digit years from `00` to the reference's own two digits in the
 * reference century and everything above it in the century before. That is
 * the rule a birthday field needs and it is why the reference instant
 * matters even when no relative phrase is shown.
 *
 * Four-digit years pass through untouched; three-digit years are refused
 * rather than guessed at.
 */
export function expandYear(
  text: string,
  pivotYear = DEFAULT_PIVOT_YEAR,
): number | undefined {
  let trimmed = (text ?? '').trim();
  if (/^\d{4}$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (!/^\d{1,2}$/.test(trimmed)) {
    return undefined;
  }
  let short = Number(trimmed);
  let century = Math.floor(pivotYear / 100) * 100;
  let boundary = pivotYear - century;
  return short <= boundary ? century + short : century - 100 + short;
}

/** Days in a month, honouring the Gregorian leap rule. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    let leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].indexOf(month) === -1 ? 31 : 30;
}

/** Zero-pad to `width`. */
function pad(value: number, width: number): string {
  let text = String(Math.abs(value));
  while (text.length < width) {
    text = '0' + text;
  }
  return text;
}

/** `YYYY-MM-DD` from a Y/M/D triple. */
export function toIsoDate(year: number, month: number, day: number): string {
  return pad(year, 4) + '-' + pad(month, 2) + '-' + pad(day, 2);
}

/** A Y/M/D triple from `YYYY-MM-DD`, or `undefined`. Deliberately does NOT
 * go through `new Date(iso)`, which silently accepts `2024-02-31` by rolling
 * it into March. */
export function fromIsoDate(
  iso: string | undefined,
): { year: number; month: number; day: number } | undefined {
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!match) {
    return undefined;
  }
  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]);
  if (month < 1 || month > 12) {
    return undefined;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  return { year, month, day };
}

/**
 * Recognise a WHOLE date typed or pasted into one box, and split it into
 * three.
 *
 * Handles the ISO form, and any two-separator form built from digits and
 * month names — `15/4/1990`, `15 April 1990`, `4-15-1990`. A leading
 * four-digit group forces ISO ordering regardless of the locale, because a
 * four-digit day does not exist and a reader who wrote one meant the year.
 *
 * Returns `undefined` for anything that is not a complete date, which is the
 * common case — a reader typing a single digit into the day box must not
 * have it redistributed.
 */
export function splitWholeDate(
  text: string,
  order: DateOrder,
): KnownDateParts | undefined {
  let trimmed = (text ?? '').trim();
  if (trimmed.length < 5) {
    return undefined;
  }
  let groups = trimmed.split(/[^0-9A-Za-zÀ-ɏ]+/).filter(Boolean);
  if (groups.length !== 3) {
    return undefined;
  }
  let [a, b, c] = groups as [string, string, string];
  let effective: DateOrder = /^\d{4}$/.test(a) ? 'ymd' : order;
  if (effective === 'ymd') {
    return { year: a, month: b, day: c };
  }
  if (effective === 'mdy') {
    return { month: a, day: b, year: c };
  }
  return { day: a, month: b, year: c };
}

/**
 * Whether a whole-date match found WHILE THE READER IS STILL TYPING is
 * trustworthy, as opposed to a premature match on a group that has not
 * finished growing yet.
 *
 * Only the group with no separator after it yet — the one the caret is
 * still inside — can still grow; every earlier group is already closed off
 * by the separator the reader typed after it. That still-open group has a
 * hard ceiling (two digits for a day or month, four for a year, per this
 * component's own rules), and below that ceiling the match is ambiguous:
 * `15-04-1` looks like a complete date with a one-digit year, but the
 * reader may be four keystrokes from `15-04-1990`. Redistributing on that
 * ambiguous read is exactly the bug — it collapses the box's own value out
 * from under the caret before the reader has finished typing the year.
 *
 * A single delivered-in-one-shot value (paste, drop, autofill) never has a
 * "still open" group — the whole string is already there — so this check is
 * only meaningful, and only applied, while typing.
 */
export function isTerminalWholeDate(
  text: string,
  parts: KnownDateParts,
): boolean {
  let groups = (text ?? '')
    .trim()
    .split(/[^0-9A-Za-zÀ-ɏ]+/)
    .filter(Boolean);
  let last = groups[groups.length - 1] ?? '';
  if (last === parts.year) {
    return /^\d{4}$/.test(last);
  }
  return last.length === 2;
}

/**
 * Turn three boxes into a date, or into the reason there isn't one.
 *
 * Every message names the box it is about, because "invalid date" on a
 * three-field control tells a reader nothing about which field to look at.
 */
export function parseKnownDate(
  parts: KnownDateParts,
  options: {
    locale?: string;
    pivotYear?: number;
    min?: string;
    max?: string;
  } = {},
): KnownDateResult {
  let day = (parts.day ?? '').trim();
  let month = (parts.month ?? '').trim();
  let year = (parts.year ?? '').trim();
  let empty = day.length === 0 && month.length === 0 && year.length === 0;
  if (empty) {
    return { empty: true };
  }

  let missing: string[] = [];
  if (day.length === 0) {
    missing.push('day');
  }
  if (month.length === 0) {
    missing.push('month');
  }
  if (year.length === 0) {
    missing.push('year');
  }
  if (missing.length > 0) {
    return {
      empty: false,
      issue:
        missing.length === 1
          ? 'Add the ' + missing[0] + '.'
          : 'Add the ' +
            missing.slice(0, -1).join(', ') +
            ' and ' +
            missing[missing.length - 1] +
            '.',
    };
  }

  let monthNumber = parseMonth(month, options.locale ?? 'en-US');
  if (monthNumber === undefined) {
    return {
      empty: false,
      issue: 'That is not a month — try a number from 1 to 12, or a name.',
    };
  }
  let yearNumber = expandYear(year, options.pivotYear ?? DEFAULT_PIVOT_YEAR);
  if (yearNumber === undefined) {
    return {
      empty: false,
      issue: 'That is not a year — try two or four digits.',
    };
  }
  if (!/^\d{1,2}$/.test(day)) {
    return {
      empty: false,
      issue: 'That is not a day — try a number from 1 to 31.',
    };
  }
  let dayNumber = Number(day);
  let ceiling = daysInMonth(yearNumber, monthNumber);
  if (dayNumber < 1 || dayNumber > ceiling) {
    return {
      empty: false,
      issue:
        'That month has ' +
        ceiling +
        ' days in ' +
        yearNumber +
        ', so day ' +
        dayNumber +
        ' does not exist.',
    };
  }

  let iso = toIsoDate(yearNumber, monthNumber, dayNumber);
  // String comparison is exact for zero-padded ISO dates and needs no Date
  // object, so a range check cannot be knocked off by a time zone.
  if (options.min && fromIsoDate(options.min) && iso < options.min) {
    return { empty: false, issue: 'That is before the earliest date allowed.' };
  }
  if (options.max && fromIsoDate(options.max) && iso > options.max) {
    return { empty: false, issue: 'That is after the latest date allowed.' };
  }
  return { empty: false, iso };
}

// ── Relative phrasing, calendar-correct ─────────────────────────────────

/**
 * Whole calendar years between two ISO dates — an AGE, not a duration.
 *
 * Millisecond division by `365.25 * 24 * 3600e3` (which is how nearly every
 * relative-time helper does it, including this kit's own `RelativeTime`) is
 * wrong for a birthday: it reports someone born on 29 February as a year
 * older or younger than they are depending on which leap cycle you are in,
 * and it can report `35 years ago` on the morning of a 35th birthday and
 * `34 years ago` the evening before by less than a day's worth of drift.
 * Comparing the month/day pair is exact and needs no arithmetic at all.
 *
 * Negative for a date in the future.
 */
export function wholeYearsBetween(
  fromIso: string,
  toIso: string,
): number | undefined {
  let from = fromIsoDate(fromIso);
  let to = fromIsoDate(toIso);
  if (!from || !to) {
    return undefined;
  }
  let years = to.year - from.year;
  let beforeAnniversary =
    to.month < from.month || (to.month === from.month && to.day < from.day);
  return beforeAnniversary ? years - 1 : years + 0;
}

/** Days between two ISO dates, via the day number of a UTC midnight — the
 * one place a `Date` is genuinely the right tool, because it knows the
 * Gregorian calendar and no time zone can intrude on a UTC midnight. */
function daysBetween(fromIso: string, toIso: string): number | undefined {
  let from = fromIsoDate(fromIso);
  let to = fromIsoDate(toIso);
  if (!from || !to) {
    return undefined;
  }
  let a = Date.UTC(from.year, from.month - 1, from.day);
  let b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86400000);
}

/** Whole calendar months between two ISO dates, signed. */
function monthsBetween(fromIso: string, toIso: string): number | undefined {
  let from = fromIsoDate(fromIso);
  let to = fromIsoDate(toIso);
  if (!from || !to) {
    return undefined;
  }
  let months = (to.year - from.year) * 12 + (to.month - from.month);
  if (to.day < from.day) {
    months = months - 1;
  }
  return months;
}

/**
 * How the parsed date reads relative to a reference instant.
 *
 * Both arguments are ISO dates, and there is no default for the reference:
 * a phrase that silently falls back to the wall clock is exactly the
 * non-determinism the realm forbids, and the caller always knows which
 * instant they mean.
 *
 * Grain follows what a reader can hold: days below a fortnight, months below
 * two years, years above. Every phrase is calendar-correct.
 */
export function knownDatePhrase(iso: string, referenceIso: string): string {
  let days = daysBetween(referenceIso, iso);
  if (days === undefined) {
    return '';
  }
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'tomorrow';
  }
  if (days === -1) {
    return 'yesterday';
  }
  let ahead = days > 0;
  let magnitude = Math.abs(days);
  // Both month and year arithmetic count from the EARLIER date to the later
  // one. Calling them the other way round is not merely a sign flip: the
  // "has the anniversary passed" adjustment would then round away from zero,
  // which is how a 36-year-old birthday reads as 37.
  let earlier = ahead ? referenceIso : iso;
  let later = ahead ? iso : referenceIso;
  let phrase: string;
  if (magnitude < 14) {
    phrase = magnitude + ' days';
  } else {
    let months = monthsBetween(earlier, later) ?? 0;
    if (months < 24) {
      phrase = months <= 1 ? magnitude + ' days' : months + ' months';
    } else {
      let years = wholeYearsBetween(earlier, later) ?? 0;
      phrase = years === 1 ? '1 year' : years + ' years';
    }
  }
  return ahead ? 'in ' + phrase : phrase + ' ago';
}

// ═══════════════════════════════════════════════════════════════════════
// The component
// ═══════════════════════════════════════════════════════════════════════

/** One box in the row. */
interface KnownDateSlot {
  part: 'day' | 'month' | 'year';
  label: string;
  value: string;
  id: string;
  inputmode: string;
  autocomplete: string;
  placeholder: string;
}

export interface KnownDateSignature {
  Args: {
    /** the INITIAL date, `YYYY-MM-DD`. The component owns the three boxes
     * after mount and reports through `@onChange`; re-key the component to
     * seed it again. Named here rather than hidden: a re-seeding control
     * would have to write tracked state from a modifier during render,
     * which is a backtracking re-render waiting to happen. */
    value?: string;
    /** fires on every keystroke with the ISO date, or `undefined` while the
     * three boxes do not yet describe a real date. The second argument
     * carries the reason, so a form can decide when to show it. */
    onChange?: (iso: string | undefined, result: KnownDateResult) => void;
    /** the fieldset's legend */
    label?: string;
    /** example copy under the boxes, associated with all three */
    hint?: string;
    /** the instant relative phrasing and two-digit years are measured
     * against, as `YYYY-MM-DD` or a Date. Omit it and no relative phrase is
     * shown — nothing here ever reads the clock. */
    reference?: string | Date;
    /** earliest and latest accepted dates, `YYYY-MM-DD` */
    min?: string;
    max?: string;
    /** dimmed and inert */
    disabled?: boolean;
    /** BCP-47 tag deciding the field ORDER and the month vocabulary. Labels
     * stay in the interface language; only the order moves. */
    locale?: string;
    /** suppress the echoed confirmation line */
    quiet?: boolean;
  };
  Element: HTMLDivElement;
}

const SLOT_META = {
  day: {
    label: 'Day',
    inputmode: 'numeric',
    autocomplete: 'bday-day',
    placeholder: 'DD',
  },
  month: {
    label: 'Month',
    inputmode: 'text',
    autocomplete: 'bday-month',
    placeholder: 'MM',
  },
  year: {
    label: 'Year',
    inputmode: 'numeric',
    autocomplete: 'bday-year',
    placeholder: 'YYYY',
  },
} as const;

export class KnownDate extends Component<KnownDateSignature> {
  private guid = guidFor(this);

  @tracked private dayText = '';
  @tracked private monthText = '';
  @tracked private yearText = '';

  constructor(owner: unknown, args: KnownDateSignature['Args']) {
    // Glimmer owner is opaque here; the base class types it internally.
    super(owner as any, args);
    let seed = fromIsoDate(this.args.value);
    if (seed) {
      this.dayText = pad(seed.day, 2);
      this.monthText = pad(seed.month, 2);
      this.yearText = pad(seed.year, 4);
    }
  }

  get locale(): string {
    return this.args.locale ?? 'en-US';
  }
  get order(): DateOrder {
    return orderForLocale(this.locale);
  }
  get legend(): string {
    return this.args.label ?? 'Date';
  }
  get hintId(): string {
    return this.guid + '-known-hint';
  }
  get parts(): KnownDateParts {
    return { day: this.dayText, month: this.monthText, year: this.yearText };
  }

  /** The reference instant as an ISO date, or `undefined`. `Date` inputs are
   * read in UTC so a caller in any zone gets the same day. */
  get referenceIso(): string | undefined {
    let raw = this.args.reference;
    if (raw === undefined) {
      return undefined;
    }
    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) {
        return undefined;
      }
      return toIsoDate(
        raw.getUTCFullYear(),
        raw.getUTCMonth() + 1,
        raw.getUTCDate(),
      );
    }
    let trimmed = String(raw).slice(0, 10);
    return fromIsoDate(trimmed) ? trimmed : undefined;
  }
  get pivotYear(): number {
    let reference = fromIsoDate(this.referenceIso);
    return reference ? reference.year : DEFAULT_PIVOT_YEAR;
  }

  get result(): KnownDateResult {
    return parseKnownDate(this.parts, {
      locale: this.locale,
      pivotYear: this.pivotYear,
      min: this.args.min,
      max: this.args.max,
    });
  }
  get invalid(): boolean {
    return this.result.issue !== undefined;
  }

  /** The parsed date written out in full, for the reader to check against
   * what they meant to type. A `<time datetime>` in the template carries the
   * machine form alongside it. */
  get echo(): string {
    let iso = this.result.iso;
    let resolved = fromIsoDate(iso);
    if (!iso || !resolved) {
      return '';
    }
    try {
      return new Intl.DateTimeFormat(this.locale, {
        dateStyle: 'full',
        timeZone: 'UTC',
      }).format(
        new Date(Date.UTC(resolved.year, resolved.month - 1, resolved.day)),
      );
    } catch {
      return iso;
    }
  }
  get phrase(): string {
    let iso = this.result.iso;
    let reference = this.referenceIso;
    if (!iso || !reference) {
      return '';
    }
    return knownDatePhrase(iso, reference);
  }
  get verdict(): string {
    if (this.result.issue) {
      return this.result.issue;
    }
    if (!this.echo) {
      return '';
    }
    return this.phrase ? this.echo + ' — ' + this.phrase : this.echo;
  }

  get slots(): KnownDateSlot[] {
    let sequence: KnownDateSlot['part'][] =
      this.order === 'ymd'
        ? ['year', 'month', 'day']
        : this.order === 'mdy'
          ? ['month', 'day', 'year']
          : ['day', 'month', 'year'];
    return sequence.map((part) => ({
      part,
      label: SLOT_META[part].label,
      inputmode: SLOT_META[part].inputmode,
      autocomplete: SLOT_META[part].autocomplete,
      placeholder: SLOT_META[part].placeholder,
      value: this.parts[part],
      id: this.guid + '-' + part,
    }));
  }

  /** Set from the native `beforeinput` event, which always fires strictly
   * before the `input` event that follows it — so this is reliably
   * populated by the time `accept()` reads it, regardless of listener
   * registration order on `input` itself. Consumed (reset to `undefined`)
   * by every `accept()` call so a stale value never leaks into a LATER
   * programmatic assignment that does not fire `beforeinput` at all (a test
   * helper's `fillIn`, for instance). */
  private lastInputType: string | undefined;

  private noteInputType = (event: Event) => {
    this.lastInputType = (event as InputEvent).inputType;
  };

  private announce() {
    let result = this.result;
    this.args.onChange?.(result.iso, result);
  }

  private write(part: KnownDateSlot['part'], text: string) {
    if (part === 'day') {
      this.dayText = text;
    } else if (part === 'month') {
      this.monthText = text;
    } else {
      this.yearText = text;
    }
  }

  /** One handler for all three boxes: if what arrived is a WHOLE date, it
   * fills all three; otherwise it is that box's text. Doing this on value
   * rather than on a paste event covers typing, pasting, autofill and
   * dictation with one path.
   *
   * The one exception is a real keystroke (`inputType` `insertText`): there
   * the "whole date" read has to also be a TERMINAL one (see
   * `isTerminalWholeDate`), because typing delivers the value one character
   * at a time and a mid-typing match on an unfinished group is not the
   * reader's whole date, it is a snapshot of one still being typed. Paste,
   * drop and autofill deliver the whole string in a single event, so they
   * skip that extra check — the same as before this existed. */
  private accept(part: KnownDateSlot['part'], text: string) {
    let typedKeystroke = this.lastInputType === 'insertText';
    this.lastInputType = undefined;
    let whole = splitWholeDate(text, this.order);
    if (whole && typedKeystroke && !isTerminalWholeDate(text, whole)) {
      whole = undefined;
    }
    if (whole) {
      this.dayText = whole.day;
      this.monthText = whole.month;
      this.yearText = whole.year;
    } else {
      this.write(part, text);
    }
    this.announce();
  }

  onDay = (text: string) => this.accept('day', text);
  onMonth = (text: string) => this.accept('month', text);
  onYear = (text: string) => this.accept('year', text);

  handlerFor = (part: KnownDateSlot['part']): ((text: string) => void) => {
    if (part === 'day') {
      return this.onDay;
    }
    if (part === 'month') {
      return this.onMonth;
    }
    return this.onYear;
  };

  <template>
    <div
      class='pretui-knowndate'
      data-invalid={{if this.invalid 'true'}}
      data-test-pretui-known-date
      ...attributes
    >
      <fieldset class='pretui-knowndate-set' disabled={{@disabled}}>
        <legend class='pretui-knowndate-legend'>{{this.legend}}</legend>
        {{#if @hint}}
          <p class='pretui-knowndate-hint' id={{this.hintId}}>{{@hint}}</p>
        {{/if}}
        <div class='pretui-knowndate-row'>
          {{#each this.slots key='part' as |slot|}}
            <span class='pretui-knowndate-slot' data-part={{slot.part}}>
              <label class='pretui-knowndate-label' for={{slot.id}}>
                {{slot.label}}
              </label>
              <Input
                @controlId={{slot.id}}
                @value={{slot.value}}
                @placeholder={{slot.placeholder}}
                @invalid={{this.invalid}}
                @disabled={{@disabled}}
                @onInput={{this.handlerFor slot.part}}
                {{on 'beforeinput' this.noteInputType}}
                inputmode={{slot.inputmode}}
                autocomplete={{slot.autocomplete}}
                aria-describedby={{if @hint this.hintId}}
                data-test-pretui-known-date-part={{slot.part}}
              />
            </span>
          {{/each}}
        </div>
      </fieldset>
      {{#unless @quiet}}
        <p
          class='pretui-knowndate-verdict'
          role='status'
          aria-live='polite'
          data-test-pretui-known-date-verdict
        >
          {{#if this.result.iso}}
            <time datetime={{this.result.iso}}>{{this.verdict}}</time>
          {{else}}
            {{this.verdict}}
          {{/if}}
        </p>
      {{/unless}}
    </div>
    <style scoped>
      .pretui-knowndate {
        display: grid;
        gap: var(--space-2, 6px);
      }
      .pretui-knowndate-set {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        gap: var(--space-2, 6px);
      }
      .pretui-knowndate-legend {
        padding: 0;
        font-size: var(--text-ui, 12px);
        font-weight: var(--weight-medium, 500);
        color: var(--foreground, #272330);
      }
      .pretui-knowndate-hint {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground, #656a73);
      }
      .pretui-knowndate-row {
        display: flex;
        align-items: end;
        gap: var(--space-3, 8px);
        flex-wrap: wrap;
      }
      .pretui-knowndate-slot {
        display: grid;
        gap: 4px;
      }
      .pretui-knowndate-slot[data-part='day'] {
        width: var(--pretui-knowndate-day-width, 4.5rem);
      }
      .pretui-knowndate-slot[data-part='month'] {
        width: var(--pretui-knowndate-month-width, 7rem);
      }
      .pretui-knowndate-slot[data-part='year'] {
        width: var(--pretui-knowndate-year-width, 6rem);
      }
      .pretui-knowndate-label {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground, #656a73);
      }
      .pretui-knowndate-verdict {
        margin: 0;
        min-height: 1.4em;
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground, #656a73);
      }
      .pretui-knowndate[data-invalid='true'] .pretui-knowndate-verdict {
        color: var(--pretui-destructive-ink, var(--destructive, #e3474c));
        font-weight: var(--weight-medium, 500);
      }
      /* A card knows its pane, not the viewport. In a narrow pane the three
         boxes stack rather than shrink below a comfortable hit target. */
      @container (max-width: 320px) {
        .pretui-knowndate-slot {
          width: 100%;
        }
      }
    </style>
  </template>
}
