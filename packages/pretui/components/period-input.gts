// Pretui — PeriodInput: a named span of time — Q3, Jan 2026, W12 — typed and parsed.
//
// `Q3`, `Jan 2026`, `W12`, `Fall 2025`, `H1 2027`. People name spans of time
// with a handful of tiny conventions, and the whole product idea here is that
// typing one of them should give you a TYPED period — a kind, a year, an
// inclusive date range, and a key that sorts — rather than a string somebody
// has to parse later.
//
// ── What this is NOT ────────────────────────────────────────────────────
//
// Not a date picker: `DatePicker` and `Calendar` choose a
// day, `DateRangePicker` chooses two, and `KnownDate` transcribes one you can
// recite. A period is none of those — "Q3" is not a date range a reader wants
// to drag out on a calendar, it is a name they already know. Nor is it a
// duration: `Q3` is a position on the calendar, not a length of time.
//
// ── The determinism fix, which is also the correctness fix ──────────────
//
// The source this was distilled from appended the CURRENT YEAR to any partial
// input, so typing `Q3` produced a different period depending on when the
// indexer ran, and the same card indexed differently every time. Here the
// reference instant is an ARGUMENT. With one, `Q3` resolves against it; with
// none, `Q3` is refused with a message that names exactly what is missing.
// A component that silently invents the year is worse than one that asks.
//
// ── Better than the inspiration, itemised ───────────────────────────────
//
//  1. **The fiscal convention is a knob, not a baked-in assumption.** The
//     source hardcoded a US federal fiscal year (July start). Two knobs
//     replace it, because there is genuinely no universal answer: which month
//     the year starts in, and whether a fiscal year is named for the calendar
//     year it starts in or the one it ends in.
//  2. **Seasons do not overlap.** The source's `Spring` ran January to June
//     and its `Summer` started in the middle of it. These are the
//     meteorological seasons — three whole months each, no gaps, no overlaps —
//     with a hemisphere knob, because a southern reader's July is not summer.
//  3. **ISO weeks are ISO weeks.** Week 1 is the week containing 4 January, a
//     year has 52 or 53 of them, and week 1 can start in December. The source
//     shuffled regex capture slots in place and got none of that.
//  4. **You can step it.** Once a period resolves, previous and next move it
//     by one of its own kind — the affordance the whole idea implies and the
//     source did not have.
//  5. **The resolved range is shown.** `Q3 2026` means nothing until you can
//     see that it is 1 July to 30 September, 92 days.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';

// ═══════════════════════════════════════════════════════════════════════
// The pure layer. No DOM, no clock.
// Unit-tested in controls-period.test.gts
// ═══════════════════════════════════════════════════════════════════════

export type PeriodKind =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'half'
  | 'season'
  | 'year';

/** A named span of calendar time, resolved. */
export interface Period {
  kind: PeriodKind;
  /** the canonical token — `2026`, `2026-Q3`, `2026-08`, `2026-W12`,
   * `2026-08-13`, `2026-H1`, `2026-S2`. Sorts correctly within a kind. */
  id: string;
  /** the year the period is NAMED for, which for a fiscal or winter period is
   * not necessarily the year its start date falls in */
  year: number;
  /** 1-based position within the year, where the kind has one */
  index?: number;
  /** first day, inclusive, `YYYY-MM-DD` */
  start: string;
  /** last day, inclusive, `YYYY-MM-DD` */
  end: string;
  /** whole days in the period, inclusive of both ends */
  days: number;
  /** the tidy display name */
  label: string;
  /** the start date — sorts correctly ACROSS kinds, which `id` cannot */
  sortKey: string;
}

/** How the calendar is cut. Every convention that has no universal answer is
 * a named knob here rather than an assumption in the code. */
export interface PeriodOptions {
  /** the instant a bare `Q3` or `Jan` is resolved against, `YYYY-MM-DD`. With
   * none, a partial period is refused rather than guessed. */
  reference?: string;
  /** BCP-47 tag; decides which month names are understood and how the
   * resolved range is written */
  locale?: string;
  /** the calendar month a fiscal year starts in, 1–12. 1 is the calendar
   * year and is the default. */
  fiscalYearStart?: number;
  /** whether a fiscal year is named for the calendar year it STARTS in
   * (the common commercial convention) or the one it ENDS in (the US federal
   * and Australian one). Irrelevant when `fiscalYearStart` is 1. */
  fiscalYearLabel?: 'start' | 'end';
  /** which hemisphere the season names describe */
  hemisphere?: 'north' | 'south';
}

const DAY_MS = 86400000;

/** Days in a month, honouring the Gregorian leap rule. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    let leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].indexOf(month) === -1 ? 31 : 30;
}

function pad(value: number, width: number): string {
  let text = String(Math.abs(Math.floor(value)));
  while (text.length < width) {
    text = '0' + text;
  }
  return text;
}

/** `YYYY-MM-DD` from a Y/M/D triple. */
export function toIso(year: number, month: number, day: number): string {
  return pad(year, 4) + '-' + pad(month, 2) + '-' + pad(day, 2);
}

/** A UTC-midnight millisecond from `YYYY-MM-DD`, or `undefined` for a date the
 * calendar does not have. */
export function isoToDay(iso: string | undefined): number | undefined {
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!match) {
    return undefined;
  }
  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  return Date.UTC(year, month - 1, day);
}

function dayToIso(ms: number): string {
  let date = new Date(ms);
  return toIso(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

/** Inclusive whole days between two ISO dates. */
export function daysBetween(startIso: string, endIso: string): number {
  let a = isoToDay(startIso);
  let b = isoToDay(endIso);
  if (a === undefined || b === undefined) {
    return 0;
  }
  return Math.round((b - a) / DAY_MS) + 1;
}

/** The range covered by `months` whole months starting at a zero-based month
 * offset from January of `year`. Offsets past December roll into the next
 * year, which is how a fiscal quarter crosses the boundary. */
function monthSpan(
  year: number,
  offset: number,
  months: number,
): { start: string; end: string } {
  let startYear = year + Math.floor(offset / 12);
  let startMonth = ((offset % 12) + 12) % 12;
  let endOffset = offset + months - 1;
  let endYear = year + Math.floor(endOffset / 12);
  let endMonth = ((endOffset % 12) + 12) % 12;
  return {
    start: toIso(startYear, startMonth + 1, 1),
    end: toIso(endYear, endMonth + 1, daysInMonth(endYear, endMonth + 1)),
  };
}

/** The calendar year a fiscal period named for `year` starts in. */
function fiscalStartYear(year: number, options: PeriodOptions): number {
  let start = options.fiscalYearStart ?? 1;
  if (start === 1) {
    return year;
  }
  return (options.fiscalYearLabel ?? 'start') === 'start' ? year : year - 1;
}

/**
 * The Monday that ISO week 1 of a year begins on.
 *
 * ISO-8601 defines week 1 as the week containing 4 January, which means it can
 * begin as early as 29 December of the previous year. Getting this wrong is
 * the single most common week-number bug there is.
 */
export function isoWeekOneStart(year: number): number {
  let jan4 = Date.UTC(year, 0, 4);
  let weekday = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return jan4 - weekday * DAY_MS;
}

/** How many ISO weeks a year has — 52 or 53. */
export function isoWeeksInYear(year: number): number {
  return Math.round(
    (isoWeekOneStart(year + 1) - isoWeekOneStart(year)) / (7 * DAY_MS),
  );
}

// ── Vocabulary ──────────────────────────────────────────────────────────

/** Month names for a locale, long and short, lowercased. English is always
 * included, so `Jan` is understood in a form rendered in German. */
function monthVocabulary(locale: string): Map<string, number> {
  let vocabulary = new Map<string, number>();
  for (let tag of [locale, 'en-US']) {
    for (let style of ['long', 'short'] as const) {
      let format: Intl.DateTimeFormat;
      try {
        format = new Intl.DateTimeFormat(tag, { month: style, timeZone: 'UTC' });
      } catch {
        continue;
      }
      for (let index = 0; index < 12; index++) {
        let name = format
          .format(new Date(Date.UTC(2001, index, 15)))
          .toLowerCase()
          .replace(/[.]/g, '')
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
 * Season names, English only — named rather than hidden (Law 7).
 *
 * CLDR has no season vocabulary, so unlike month names these cannot be asked
 * of `Intl`. A caller whose readers name seasons in another language should
 * map them before this component sees them.
 */
const SEASON_WORDS: Record<string, number> = {
  spring: 1,
  summer: 2,
  autumn: 3,
  fall: 3,
  winter: 4,
};

const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'];

/**
 * The first calendar month of a meteorological season.
 *
 * Meteorological rather than astronomical, deliberately: three whole months
 * each, no gaps and no overlaps, which is what makes a season a PERIOD at all.
 * The southern hemisphere is the same cut, six months round.
 */
function seasonMonthOffset(index: number, options: PeriodOptions): number {
  let northern = [2, 5, 8, 11]; // March, June, September, December
  let base = northern[index - 1] ?? 2;
  return (options.hemisphere ?? 'north') === 'north' ? base : base + 6;
}

// ── Building a period ───────────────────────────────────────────────────

/**
 * A resolved period from its kind, year and index.
 *
 * Returns `undefined` when the index is out of range for the kind — week 54,
 * month 13, quarter 5 — rather than rolling it into the next year.
 */
export function makePeriod(
  kind: PeriodKind,
  year: number,
  index: number | undefined,
  options: PeriodOptions = {},
): Period | undefined {
  let locale = options.locale ?? 'en-US';
  let start = '';
  let end = '';
  let id = '';
  let label = '';

  if (kind === 'year') {
    start = toIso(year, 1, 1);
    end = toIso(year, 12, 31);
    id = pad(year, 4);
    label = String(year);
  } else if (kind === 'half') {
    if (index === undefined || index < 1 || index > 2) {
      return undefined;
    }
    let base = fiscalStartYear(year, options);
    let span = monthSpan(
      base,
      (options.fiscalYearStart ?? 1) - 1 + (index - 1) * 6,
      6,
    );
    start = span.start;
    end = span.end;
    id = pad(year, 4) + '-H' + index;
    label = 'H' + index + ' ' + year;
  } else if (kind === 'quarter') {
    if (index === undefined || index < 1 || index > 4) {
      return undefined;
    }
    let base = fiscalStartYear(year, options);
    let span = monthSpan(
      base,
      (options.fiscalYearStart ?? 1) - 1 + (index - 1) * 3,
      3,
    );
    start = span.start;
    end = span.end;
    id = pad(year, 4) + '-Q' + index;
    label = 'Q' + index + ' ' + year;
  } else if (kind === 'season') {
    if (index === undefined || index < 1 || index > 4) {
      return undefined;
    }
    let span = monthSpan(year, seasonMonthOffset(index, options), 3);
    start = span.start;
    end = span.end;
    id = pad(year, 4) + '-S' + index;
    label = (SEASON_LABELS[index - 1] ?? '') + ' ' + year;
  } else if (kind === 'month') {
    if (index === undefined || index < 1 || index > 12) {
      return undefined;
    }
    start = toIso(year, index, 1);
    end = toIso(year, index, daysInMonth(year, index));
    id = pad(year, 4) + '-' + pad(index, 2);
    try {
      label =
        new Intl.DateTimeFormat(locale, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(year, index - 1, 15))) || id;
    } catch {
      label = id;
    }
  } else if (kind === 'week') {
    if (index === undefined || index < 1 || index > isoWeeksInYear(year)) {
      return undefined;
    }
    let first = isoWeekOneStart(year) + (index - 1) * 7 * DAY_MS;
    start = dayToIso(first);
    end = dayToIso(first + 6 * DAY_MS);
    id = pad(year, 4) + '-W' + pad(index, 2);
    label = 'Week ' + index + ', ' + year;
  } else {
    // day — `index` is the day of the year's month encoding, so days are
    // built by `parsePeriod` from an explicit date instead.
    return undefined;
  }

  return {
    kind,
    id,
    year,
    index,
    start,
    end,
    days: daysBetween(start, end),
    label,
    sortKey: start,
  };
}

/** A single day as a period, so every branch of the parser returns the same
 * shape. */
function dayPeriod(iso: string, options: PeriodOptions): Period | undefined {
  if (isoToDay(iso) === undefined) {
    return undefined;
  }
  let locale = options.locale ?? 'en-US';
  let label = iso;
  try {
    label = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(isoToDay(iso) as number));
  } catch {
    label = iso;
  }
  return {
    kind: 'day',
    id: iso,
    year: Number(iso.slice(0, 4)),
    start: iso,
    end: iso,
    days: 1,
    label,
    sortKey: iso,
  };
}

/** What a parse produced: a period, or the reason there isn't one. */
export interface PeriodResult {
  period?: Period;
  /** a sentence naming what is missing or wrong; absent when `period` is set
   * AND when nothing has been typed */
  issue?: string;
  /** true when the box is empty — an untouched control is not an error */
  empty: boolean;
}

/** Accepted shapes, in the order the parser tries them. Also the copy the
 * component shows as a hint, so the two can never drift apart. */
export const PERIOD_FORMS = [
  '2026',
  'Q3 2026',
  'H1 2026',
  'Jan 2026',
  '2026-08',
  'W12 2026',
  'Summer 2026',
  '2026-08-13',
];

/**
 * A typed period from whatever a reader typed.
 *
 * The year may come first or last, the separator may be a space or a hyphen,
 * and the case does not matter. A bare `Q3`, `Jan`, `W12` or `Summer` resolves
 * against `options.reference` — and is REFUSED, with a message that says so,
 * when there is no reference. Nothing here reads the clock.
 */
export function parsePeriod(
  text: string,
  options: PeriodOptions = {},
): PeriodResult {
  let raw = (text ?? '').trim();
  if (raw.length === 0) {
    return { empty: true };
  }
  let referenceYear: number | undefined = undefined;
  let referenceDay = isoToDay(options.reference);
  if (referenceDay !== undefined) {
    referenceYear = new Date(referenceDay).getUTCFullYear();
  }

  const needYear = (): PeriodResult => ({
    empty: false,
    issue:
      'Add a year — nothing here reads the clock, so there is no year to assume.',
  });

  // A whole date, which is the only shape with no ambiguity at all.
  let dayMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (dayMatch) {
    let iso = toIso(
      Number(dayMatch[1]),
      Number(dayMatch[2]),
      Number(dayMatch[3]),
    );
    let period = dayPeriod(iso, options);
    return period
      ? { empty: false, period }
      : { empty: false, issue: 'That date does not exist.' };
  }

  let normalised = raw.toLowerCase().replace(/[,]/g, ' ');
  let year: number | undefined = undefined;
  let yearMatch = /(?:^|[\s-])(\d{4})(?:$|[\s-])/.exec(normalised);
  if (yearMatch) {
    year = Number(yearMatch[1]);
    normalised = (
      normalised.slice(0, yearMatch.index) +
      ' ' +
      normalised.slice(yearMatch.index + yearMatch[0].length)
    ).trim();
  }

  // Bare year.
  if (normalised.length === 0) {
    if (year === undefined) {
      return { empty: false, issue: 'Try a form like Q3 2026 or Jan 2026.' };
    }
    let period = makePeriod('year', year, undefined, options);
    return period ? { empty: false, period } : needYear();
  }

  let resolvedYear = year ?? referenceYear;

  const build = (kind: PeriodKind, index: number): PeriodResult => {
    if (resolvedYear === undefined) {
      return needYear();
    }
    let period = makePeriod(kind, resolvedYear, index, options);
    return period
      ? { empty: false, period }
      : {
          empty: false,
          issue:
            'There is no ' +
            kind +
            ' ' +
            index +
            ' in ' +
            resolvedYear +
            '.',
        };
  };

  let quarter = /^q\s*(\d{1,2})$/.exec(normalised);
  if (quarter) {
    return build('quarter', Number(quarter[1]));
  }
  let half = /^h\s*(\d{1,2})$/.exec(normalised);
  if (half) {
    return build('half', Number(half[1]));
  }
  let week = /^(?:w|wk|week)\s*(\d{1,2})$/.exec(normalised);
  if (week) {
    return build('week', Number(week[1]));
  }
  // `2026-08` — the year has already been lifted out, leaving the month.
  let bareMonth = /^(\d{1,2})$/.exec(normalised);
  if (bareMonth && year !== undefined) {
    return build('month', Number(bareMonth[1]));
  }
  let season = SEASON_WORDS[normalised];
  if (season !== undefined) {
    return build('season', season);
  }
  let months = monthVocabulary(options.locale ?? 'en-US');
  let exact = months.get(normalised);
  if (exact !== undefined) {
    return build('month', exact);
  }
  if (normalised.length >= 3) {
    let hits = new Set<number>();
    for (let [name, index] of months) {
      if (name.startsWith(normalised)) {
        hits.add(index);
      }
    }
    if (hits.size === 1) {
      return build('month', Array.from(hits)[0] as number);
    }
  }
  return {
    empty: false,
    issue: 'Not a period I recognise. Try ' + PERIOD_FORMS.slice(0, 4).join(', ') + '.',
  };
}

/**
 * The period `delta` places later, of the same kind.
 *
 * Stepping is done in the period's OWN units — the next quarter after Q4 2026
 * is Q1 2027, and the next week after week 52 may be week 53 or week 1,
 * depending on the year. Doing it by adding days to the start date would get
 * both of those wrong.
 */
export function shiftPeriod(
  period: Period,
  delta: number,
  options: PeriodOptions = {},
): Period | undefined {
  let step = Math.trunc(delta);
  if (step === 0) {
    return period;
  }
  if (period.kind === 'year') {
    return makePeriod('year', period.year + step, undefined, options);
  }
  if (period.kind === 'day') {
    let ms = isoToDay(period.start);
    return ms === undefined
      ? undefined
      : dayPeriod(dayToIso(ms + step * DAY_MS), options);
  }
  let sizes: Partial<Record<PeriodKind, number>> = {
    half: 2,
    quarter: 4,
    season: 4,
    month: 12,
  };
  let size = sizes[period.kind];
  if (size !== undefined) {
    let flat = (period.index ?? 1) - 1 + step;
    let year = period.year + Math.floor(flat / size);
    let index = ((flat % size) + size) % size;
    return makePeriod(period.kind, year, index + 1, options);
  }
  // Weeks: walk year by year, because a year has 52 or 53 of them.
  let year = period.year;
  let index = (period.index ?? 1) + step;
  let guard = 0;
  while (guard < 500) {
    let count = isoWeeksInYear(year);
    if (index < 1) {
      year = year - 1;
      index = index + isoWeeksInYear(year);
    } else if (index > count) {
      index = index - count;
      year = year + 1;
    } else {
      return makePeriod('week', year, index, options);
    }
    guard = guard + 1;
  }
  return undefined;
}

/** The resolved range, written the way this locale writes dates. */
export function periodRangeText(period: Period, locale = 'en-US'): string {
  let a = isoToDay(period.start);
  let b = isoToDay(period.end);
  if (a === undefined || b === undefined) {
    return period.start + ' – ' + period.end;
  }
  try {
    let format = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    });
    if (period.kind === 'day') {
      return format.format(new Date(a));
    }
    return format.format(new Date(a)) + ' – ' + format.format(new Date(b));
  } catch {
    return period.start + ' – ' + period.end;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// The component
// ═══════════════════════════════════════════════════════════════════════

export interface PeriodInputSignature {
  Args: {
    /** the period token (`2026-Q3`) or any recognised text, controlled */
    value?: string;
    /** uncontrolled seed */
    defaultValue?: string;
    /** the instant a partial period like `Q3` resolves against, `YYYY-MM-DD`.
     * With none, a partial period is refused with a message rather than
     * resolved against the wall clock. */
    reference?: string;
    /** BCP-47 tag for month names and the resolved range */
    locale?: string;
    /** the calendar month a fiscal year starts in, 1–12; 1 (the calendar
     * year) by default */
    fiscalYearStart?: number;
    /** whether a fiscal year is named for the year it starts in or ends in */
    fiscalYearLabel?: 'start' | 'end';
    /** which hemisphere the season names describe */
    hemisphere?: 'north' | 'south';
    /** the box's accessible name; ignored when `@controlId` is supplied */
    label?: string;
    /** ghost text behind an empty box. Not a `placeholder` attribute — a
     * placeholder doubles as the accessible name and vanishes on the first
     * keystroke. */
    hint?: string;
    /** supplied by `Field`; when absent the control owns its id and its
     * label */
    controlId?: string;
    /** dimmed and inert */
    disabled?: boolean;
    /** hide the previous / next stepper */
    noStep?: boolean;
    /** hide the accepted-forms line */
    quiet?: boolean;
    /** fires on every keystroke with the resolved period, or `undefined` and
     * the reason there isn't one */
    onChange?: (period: Period | undefined, result: PeriodResult) => void;
  };
  Element: HTMLDivElement;
}

export class PeriodInput extends Component<PeriodInputSignature> {
  private guid = guidFor(this);

  @tracked private draft: string | undefined = undefined;
  @tracked private own: string | undefined = undefined;
  @tracked private seeded = false;
  /** Validation waits for a commit. Telling a reader that `Ja` is not a month
   * while they are still typing `January` is the most common way a parsing
   * input becomes unusable. */
  @tracked private touched = false;

  get options(): PeriodOptions {
    return {
      reference: this.args.reference,
      locale: this.args.locale,
      fiscalYearStart: this.args.fiscalYearStart,
      fiscalYearLabel: this.args.fiscalYearLabel,
      hemisphere: this.args.hemisphere,
    };
  }

  get committed(): string {
    if (this.args.value !== undefined) {
      return this.args.value;
    }
    if (this.seeded) {
      return this.own ?? '';
    }
    return this.args.defaultValue ?? '';
  }

  get boxText(): string {
    return this.draft !== undefined ? this.draft : this.committed;
  }

  get empty(): boolean {
    return this.boxText.trim().length === 0;
  }

  get result(): PeriodResult {
    return parsePeriod(this.boxText, this.options);
  }

  get period(): Period | undefined {
    return this.result.period;
  }

  get resolved(): boolean {
    return this.result.period !== undefined;
  }

  /** The issue is computed always and SHOWN only after a commit. */
  get invalid(): boolean {
    return this.touched && this.result.issue !== undefined;
  }

  get rangeText(): string {
    let period = this.period;
    return period ? periodRangeText(period, this.args.locale ?? 'en-US') : '';
  }

  get daysText(): string {
    let period = this.period;
    if (!period) {
      return '';
    }
    return period.days === 1 ? '1 day' : period.days + ' days';
  }

  get kindText(): string {
    return this.period?.kind ?? '';
  }

  /** The confirmation row: what it resolved to, or why it did not. */
  get readout(): string {
    let period = this.period;
    if (period) {
      return period.label + ' · ' + this.rangeText + ' · ' + this.daysText;
    }
    if (this.invalid) {
      return this.result.issue ?? '';
    }
    return '';
  }

  get formsText(): string {
    return 'Try ' + PERIOD_FORMS.join(', ') + '.';
  }

  get canStep(): boolean {
    return this.args.noStep !== true;
  }
  get stepDisabled(): boolean | undefined {
    return this.resolved && this.args.disabled !== true ? undefined : true;
  }
  get previousLabel(): string {
    return this.period ? 'Previous ' + this.period.kind : 'Previous period';
  }
  get nextLabel(): string {
    return this.period ? 'Next ' + this.period.kind : 'Next period';
  }

  get inputId(): string {
    return this.args.controlId ?? this.guid + '-period';
  }
  get ownsLabel(): boolean {
    return this.args.controlId === undefined;
  }
  get fallbackLabel(): string {
    return this.args.label ?? 'Period';
  }
  get readoutId(): string {
    return this.guid + '-readout';
  }
  get formsId(): string {
    return this.guid + '-forms';
  }
  get describedBy(): string {
    return this.args.quiet
      ? this.readoutId
      : this.readoutId + ' ' + this.formsId;
  }

  private commit(text: string) {
    this.seeded = true;
    this.own = text;
    this.draft = undefined;
    let result = parsePeriod(text, this.options);
    this.args.onChange?.(result.period, result);
  }

  onInput = (event: Event) => {
    let target = event.target as HTMLInputElement | null;
    this.draft = target ? target.value : '';
    this.seeded = true;
    this.own = this.draft;
    let result = parsePeriod(this.draft, this.options);
    this.args.onChange?.(result.period, result);
  };

  onBlur = () => {
    this.touched = true;
    // Normalise on commit: a resolved period is rewritten as its own label, so
    // `q3 2026` becomes `Q3 2026` and the reader can see it was understood.
    let period = this.period;
    this.commit(period ? period.label : this.boxText);
  };

  onKey = (raw: Event) => {
    let event = raw as KeyboardEvent;
    if (event.key === 'Enter') {
      this.onBlur();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    let period = this.period;
    if (!period) {
      return;
    }
    event.preventDefault();
    this.step(event.key === 'ArrowUp' ? 1 : -1);
  };

  private step(delta: number) {
    let period = this.period;
    if (!period) {
      return;
    }
    let next = shiftPeriod(period, delta, this.options);
    if (next) {
      this.touched = true;
      this.commit(next.label);
    }
  }

  onPrevious = () => this.step(-1);
  onNext = () => this.step(1);

  <template>
    <div
      class='pretui-period'
      data-invalid={{if this.invalid 'true'}}
      data-kind={{this.kindText}}
      data-test-pretui-period
      ...attributes
    >
      {{#if this.ownsLabel}}
        <label class='pretui-period-sr' for={{this.inputId}}>
          {{this.fallbackLabel}}
        </label>
      {{/if}}
      <div class='pretui-period-shell'>
        <span class='pretui-period-box'>
          {{#if @hint}}
            {{#if this.empty}}
              <span class='pretui-period-ghost' aria-hidden='true'>
                {{@hint}}
              </span>
            {{/if}}
          {{/if}}
          <input
            class='pretui-period-input'
            id={{this.inputId}}
            type='text'
            autocomplete='off'
            spellcheck='false'
            value={{this.boxText}}
            disabled={{@disabled}}
            aria-invalid={{if this.invalid 'true'}}
            aria-describedby={{this.describedBy}}
            data-test-pretui-period-input
            {{on 'input' this.onInput}}
            {{on 'blur' this.onBlur}}
            {{on 'keydown' this.onKey}}
          />
        </span>
        {{#if this.canStep}}
          <span class='pretui-period-step'>
            {{! aria-disabled, never the attribute — a stepper that vanishes
                from the tab order the moment the box is unparseable is worse
                than one that is reachable and says it cannot act. }}
            <button
              type='button'
              class='pretui-period-arrow'
              aria-label={{this.previousLabel}}
              aria-disabled={{if this.stepDisabled 'true' 'false'}}
              data-test-pretui-period-previous
              {{on 'click' this.onPrevious}}
            >&minus;</button>
            <button
              type='button'
              class='pretui-period-arrow'
              aria-label={{this.nextLabel}}
              aria-disabled={{if this.stepDisabled 'true' 'false'}}
              data-test-pretui-period-next
              {{on 'click' this.onNext}}
            >+</button>
          </span>
        {{/if}}
      </div>
      <p
        class='pretui-period-readout'
        id={{this.readoutId}}
        role='status'
        aria-live='polite'
        data-test-pretui-period-readout
      >{{this.readout}}</p>
      {{#unless @quiet}}
        <p class='pretui-period-forms' id={{this.formsId}}>{{this.formsText}}</p>
      {{/unless}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-period {
          display: grid;
          gap: var(--space-2, 6px);
          container-type: inline-size;
        }
        .pretui-period-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
        .pretui-period-shell {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          min-height: var(--control-h, 32px);
          padding-inline: var(--space-3, 8px);
          border-radius: var(--radius);
          background: var(--field, var(--card));
          box-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
          transition: box-shadow 160ms
            var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        .pretui-period-shell:focus-within {
          box-shadow:
            var(--pretui-shadow-control, 0 0 0 1px var(--border)),
            0 0 0 2px var(--ring);
        }
        .pretui-period[data-invalid='true'] .pretui-period-shell {
          box-shadow: 0 0 0 1px var(--destructive);
        }
        .pretui-period-box {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
        }
        .pretui-period-ghost {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          pointer-events: none;
          font-size: var(--text-ui-md, 13px);
          color: var(--muted-foreground);
          opacity: 0.55;
        }
        .pretui-period-input {
          width: 100%;
          min-width: 0;
          border: 0;
          background: none;
          padding: 0;
          font: inherit;
          font-size: var(--text-ui-md, 13px);
          font-variant-numeric: tabular-nums;
          color: var(--foreground);
        }
        .pretui-period-input:focus {
          outline: none;
        }
        .pretui-period-step {
          flex: 0 0 auto;
          display: flex;
          gap: 2px;
        }
        /* Concentric radii (Appendix O.9): the arrows sit inside the shell at an
           inset, so their corner resolves against the shell's rather than
           fighting it. */
        .pretui-period-arrow {
          appearance: none;
          border: 0;
          min-width: 1.5rem;
          min-height: 1.5rem;
          padding: 0;
          border-radius: calc(
            var(--radius) - var(--pretui-radius-encroach, 0.35) *
              var(--radius)
          );
          background: transparent;
          font: inherit;
          font-size: var(--text-ui-md, 13px);
          color: var(--muted-foreground);
          cursor: pointer;
          transition:
            background-color 140ms
              var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1)),
            transform 140ms var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        .pretui-period-arrow:hover {
          background: var(--hover, color-mix(in oklch, var(--foreground) 7%, transparent));
          color: var(--foreground);
        }
        /* Appendix O.4 — one consistent press across everything pressable. */
        .pretui-period-arrow:active {
          transform: scale(0.96);
        }
        .pretui-period-arrow:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-period-arrow[aria-disabled='true'] {
          opacity: 0.4;
          cursor: default;
        }
        .pretui-period-arrow[aria-disabled='true']:hover {
          background: transparent;
          color: var(--muted-foreground);
        }
        .pretui-period-arrow[aria-disabled='true']:active {
          transform: none;
        }
        /* Reserved space: the readout fills as the box resolves, and a row that
           changes height while you type is exactly what this prevents. */
        .pretui-period-readout {
          margin: 0;
          min-height: 1.4em;
          font-size: var(--text-ui-sm, 11.5px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-period[data-invalid='true'] .pretui-period-readout {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          font-weight: var(--weight-medium, 500);
        }
        .pretui-period-forms {
          margin: 0;
          font-size: var(--text-ui-xs, 10.5px);
          font-family: var(--font-mono);
          color: color-mix(
            in oklch,
            var(--muted-foreground) 75%,
            transparent
          );
        }
        @media (pointer: coarse) {
          .pretui-period-shell {
            min-height: 44px;
          }
          .pretui-period-arrow {
            min-width: 44px;
            min-height: 44px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-period-shell,
          .pretui-period-arrow {
            transition: none;
          }
          .pretui-period-arrow:active {
            transform: none;
          }
        }
      }
    </style>
  </template>
}
