// Pretui — reading FORMAT territory: the four value formatters every other
// component renders its numbers and dates with.
//
// Ported from the webawesome `wa-format-bytes` / `wa-format-date` /
// `wa-format-number` trio (thin `Intl` wrappers) plus the Law-5 Odometer
// mechanism. What the inspiration got wrong and this module fixes:
//
//   - wa-format-bytes divides by 1024 and labels the result "kB". That is the
//     classic bytes bug: binary math wearing decimal labels. Here `@base` is
//     an explicit knob — 'decimal' is true SI (÷1000, Intl `style: 'unit'`),
//     'binary' is IEC (÷1024, KiB/MiB) and says so in the label.
//   - The wa components throw or print `Invalid Date` / `NaN` on bad input, a
//     bad locale, or an option combination the engine refuses (`dateStyle`
//     beside `month`, `style: 'currency'` with no `currency`). Nothing here
//     throws: every formatter degrades down a documented ladder and, when it
//     runs out of ladder, renders `@placeholder` (default '—').
//   - Abbreviated output loses the real value for a screen reader. Every
//     component here can emit an sr-only MIRROR (`@spoken`) carrying the
//     full-precision / spelled-out value, with the abbreviated glyphs
//     `aria-hidden`. Mirror, not `aria-label`: `aria-label` on a roleless
//     <span> is ignored by most assistive tech.
//   - `new Date('2026-03-14')` parses as UTC and renders as the 13th west of
//     Greenwich. `toDate` routes bare ISO dates through `fromIso`
//     (reading-extras) so a calendar date stays that calendar date.
//   - The upstream surface is `Intl` options one-for-one and nothing else;
//     Law 7 wants every knob separately settable AND an escape hatch, so each
//     component has named knobs for the common surface plus `@options` for
//     anything not named. Named knobs win over `@options`.
//
// Law 3 decision (documented deliberately, not by accident): these render
// inside ordinary prose, so the DEFAULT dress is a prose numeral —
// `tabular-nums`, inheriting the surrounding type. `Token` (ink.gts) is a
// separately-settable `@token` knob, for the machine contexts where a size or
// an id-like number really is machine output (a build-artifact table, a log
// line, a version row). Odometer is always a prose numeral: a rolling mono
// pill fights itself.
//
// Realm laws: no timers, no clock reads. FormatDate NEVER reads the clock —
// `@date` is required and `@now` (the reference instant for
// `@omitCurrentYear`) is a caller-supplied argument, exactly as RelativeTime
// takes `@now`; omit it and the smart behaviour is simply inert. Odometer's
// motion is one CSS animation whose from-state is a custom property; base
// styles ARE the end state, so `animation: none` under
// `prefers-reduced-motion` is the complete kill switch.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { cssDeclaration } from './pretui-css';
import { modifier } from 'ember-modifier';
import { Token } from './ink';
import { fromIso, toIso } from './reading-extras';
import { formatDuration } from '@cardstack/boxel-ui/helpers';

// ── shared Intl plumbing — memoised, and it never throws ─────────────────
// Constructing an Intl formatter is the expensive part, so both constructors
// are memoised on (locale, options). A construction that fails is memoised as
// a miss too, so a bad option set costs one throw for the life of the page.
export type FormatOptionBag = Record<string, unknown>;

const NUMBER_CACHE = new Map<string, Intl.NumberFormat | null>();
const DATE_CACHE = new Map<string, Intl.DateTimeFormat | null>();

/** Strip undefined/null so `{ year: undefined }` never reaches Intl. */
function defined(bag: FormatOptionBag): FormatOptionBag {
  let out: FormatOptionBag = {};
  for (let key of Object.keys(bag)) {
    let value = bag[key];
    if (value !== undefined && value !== null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

function cacheKey(locale: string | undefined, bag: FormatOptionBag): string {
  let keys = Object.keys(bag).sort();
  return `${locale ?? ''}|${keys.map((k) => `${k}:${String(bag[k])}`).join(',')}`;
}

/**
 * Intl.NumberFormat, memoised, degrading: (locale, options) → (default
 * locale, options) → (locale, no options) → undefined.
 */
export function numberFormatter(
  locale: string | undefined,
  bag: FormatOptionBag,
): Intl.NumberFormat | undefined {
  let key = cacheKey(locale, bag);
  let hit = NUMBER_CACHE.get(key);
  if (hit !== undefined) {
    return hit ?? undefined;
  }
  let options = bag as Intl.NumberFormatOptions;
  let made: Intl.NumberFormat | null = null;
  try {
    made = new Intl.NumberFormat(locale || undefined, options);
  } catch {
    try {
      made = new Intl.NumberFormat(undefined, options);
    } catch {
      try {
        made = new Intl.NumberFormat(locale || undefined);
      } catch {
        made = null;
      }
    }
  }
  NUMBER_CACHE.set(key, made);
  return made ?? undefined;
}

/**
 * Intl.DateTimeFormat, memoised, degrading: (locale, options) → (default
 * locale, options) → (locale, no options) → undefined.
 */
export function dateFormatter(
  locale: string | undefined,
  bag: FormatOptionBag,
): Intl.DateTimeFormat | undefined {
  let key = cacheKey(locale, bag);
  let hit = DATE_CACHE.get(key);
  if (hit !== undefined) {
    return hit ?? undefined;
  }
  let options = bag as Intl.DateTimeFormatOptions;
  let made: Intl.DateTimeFormat | null = null;
  try {
    made = new Intl.DateTimeFormat(locale || undefined, options);
  } catch {
    try {
      made = new Intl.DateTimeFormat(undefined, options);
    } catch {
      try {
        made = new Intl.DateTimeFormat(locale || undefined);
      } catch {
        made = null;
      }
    }
  }
  DATE_CACHE.set(key, made);
  return made ?? undefined;
}

/** Coerce anything caller-shaped to a finite number, or undefined. */
export function toNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  let n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Coerce anything caller-shaped to a valid Date, or undefined.
 * A bare `YYYY-MM-DD` string goes through `fromIso` (reading-extras) so it
 * lands on LOCAL midnight — `new Date('2026-03-14')` is UTC midnight, which
 * renders as the 13th anywhere west of Greenwich.
 */
export function toDate(value: string | number | Date | undefined): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === 'number') {
    let d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  let iso = fromIso(value);
  if (iso) {
    return iso;
  }
  let d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Format a number through Intl without ever throwing. Guards the two option
 * combinations that throw in every engine (currency/unit style with no
 * currency/unit) by dropping the style rather than the whole format.
 */
export function formatNumber(
  value: number,
  locale?: string,
  bag: FormatOptionBag = {},
): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  let options = defined(bag);
  if (options['style'] === 'currency' && !options['currency']) {
    delete options['style'];
  }
  if (options['style'] === 'unit' && !options['unit']) {
    delete options['style'];
  }
  let fmt = numberFormatter(locale, options);
  if (!fmt) {
    return String(value);
  }
  try {
    return fmt.format(value);
  } catch {
    return String(value);
  }
}

/** Format a date through Intl without ever throwing. */
export function formatDate(
  value: Date,
  locale?: string,
  bag: FormatOptionBag = {},
): string {
  let fmt = dateFormatter(locale, defined(bag));
  if (!fmt) {
    return value.toISOString();
  }
  try {
    return fmt.format(value);
  } catch {
    return value.toISOString();
  }
}

// ── FormattedValue — the shared visible/spoken pair ──────────────────────
// Exported as its own primitive because all three formatters (and anything
// else in the kit that abbreviates a value) need the same three things: the
// visible text, the optional sr-only mirror, and the optional Token dress.
export interface FormattedValueSignature {
  Args: {
    /** the visible, already-formatted text */
    text?: string;
    /** full-precision or spelled-out mirror for screen readers; when present the visible text is aria-hidden */
    spoken?: string;
    /** wear the Token dress (Law 3) instead of a prose numeral */
    token?: boolean;
    /** hue forwarded to Token when @token is set */
    hue?: string;
    /** marks the value as absent so the placeholder renders muted */
    empty?: boolean;
  };
  Element: HTMLSpanElement;
}

export class FormattedValue extends Component<FormattedValueSignature> {
  get hideVisible(): string | undefined {
    return this.args.spoken ? 'true' : undefined;
  }
  get emptyFlag(): string | undefined {
    return this.args.empty ? 'true' : undefined;
  }
  <template>
    <span
      class='pretui-fv'
      data-empty={{this.emptyFlag}}
      data-test-pretui-formatted-value
      ...attributes
    >
      <span class='pretui-fv-vis' aria-hidden={{this.hideVisible}}>
        {{#if @token}}<Token @value={{@text}} @hue={{@hue}} />{{else}}{{@text}}{{/if}}
      </span>
      {{#if @spoken}}<span class='pretui-fv-sr'>{{@spoken}}</span>{{/if}}
    </span>
    <style scoped>
      .pretui-fv {
        font-variant-numeric: tabular-nums;
      }
      .pretui-fv[data-empty='true'] {
        color: var(--muted-foreground);
      }
      .pretui-fv-vis {
        white-space: nowrap;
      }
      .pretui-fv-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    </style>
  </template>
}

// ── FormatBytes ← wa-format-bytes ────────────────────────────────────────
// Better than the inspiration: `@base` separates IEC binary (÷1024, KiB) from
// SI decimal (÷1000, kB) instead of quietly conflating them; the decimal path
// runs through Intl `style: 'unit'` so the unit is localised and placed by
// CLDR data, and the binary path (Intl has no kibibyte unit — an honest,
// documented limit) formats the NUMBER through Intl and appends the IEC
// symbol with a non-breaking space, mirroring it sr-only as the spelled-out
// "2.4 mebibytes" because assistive tech reads "MiB" as noise.
const DECIMAL_BYTE_UNITS = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
  'petabyte',
];
// CLDR has no petabit, so the decimal bit ladder stops one step short — a
// value that big simply keeps counting in terabits.
const DECIMAL_BIT_UNITS = ['bit', 'kilobit', 'megabit', 'gigabit', 'terabit'];
const BINARY_BYTE_SYMBOLS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const BINARY_BIT_SYMBOLS = ['bit', 'Kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit'];
const BINARY_BYTE_WORDS = [
  'byte',
  'kibibyte',
  'mebibyte',
  'gibibyte',
  'tebibyte',
  'pebibyte',
];
const BINARY_BIT_WORDS = [
  'bit',
  'kibibit',
  'mebibit',
  'gibibit',
  'tebibit',
  'pebibit',
];

export interface ByteFormatOptions {
  unit?: 'byte' | 'bit';
  base?: 'binary' | 'decimal';
  locale?: string;
  display?: 'short' | 'narrow' | 'long';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface ByteFormatResult {
  /** the visible string, e.g. '2.4 MiB' */
  text: string;
  /** sr-only mirror when the visible string is not readable aloud, else undefined */
  spoken?: string;
  /** index into the unit ladder that was chosen (0 = bytes) */
  step: number;
}

/** `m:ss`, or `h:mm:ss` past an hour. Never `NaN`; negatives read `0:00`. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  return formatDuration(seconds, { format: 'timer' });
}

/**
 * Human-readable byte (or bit) size. Pure, memoised through the shared Intl
 * caches, never throws.
 */
export function formatBytes(
  value: number,
  options: ByteFormatOptions = {},
): ByteFormatResult {
  let base = options.base ?? 'binary';
  let bits = options.unit === 'bit';
  let display = options.display ?? 'short';
  let divisor = base === 'binary' ? 1024 : 1000;
  let magnitude = Math.abs(value);
  let step = 0;
  if (magnitude >= 1) {
    step = Math.floor(Math.log(magnitude) / Math.log(divisor));
  }
  let rungs =
    base === 'binary'
      ? (bits ? BINARY_BIT_SYMBOLS : BINARY_BYTE_SYMBOLS).length
      : (bits ? DECIMAL_BIT_UNITS : DECIMAL_BYTE_UNITS).length;
  step = Math.min(Math.max(step, 0), rungs - 1);
  let scaled = value / Math.pow(divisor, step);
  let maximumFractionDigits =
    options.maximumFractionDigits ?? (step === 0 ? 0 : 1);
  let minimumFractionDigits = options.minimumFractionDigits ?? 0;
  let digits: FormatOptionBag = {
    minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits),
    maximumFractionDigits,
  };

  // Bytes themselves, and every decimal step, are real CLDR units — let Intl
  // place and localise them.
  if (base === 'decimal' || step === 0) {
    let unit = bits ? DECIMAL_BIT_UNITS[step] : DECIMAL_BYTE_UNITS[step];
    let text = formatNumber(value / Math.pow(divisor, step), options.locale, {
      ...digits,
      style: 'unit',
      unit,
      unitDisplay: display,
    });
    let spoken =
      display === 'narrow'
        ? formatNumber(scaled, options.locale, {
            ...digits,
            style: 'unit',
            unit,
            unitDisplay: 'long',
          })
        : undefined;
    return { text, spoken, step };
  }

  // Binary steps: Intl has no IEC units, so the number is localised and the
  // symbol appended. NBSP keeps '2.4 MiB' from breaking across a line.
  let symbols = bits ? BINARY_BIT_SYMBOLS : BINARY_BYTE_SYMBOLS;
  let words = bits ? BINARY_BIT_WORDS : BINARY_BYTE_WORDS;
  let number = formatNumber(scaled, options.locale, digits);
  let word = words[step];
  let plural = Math.abs(scaled) === 1 ? word : `${word}s`;
  return {
    // The \u00a0 is deliberate: a size must never wrap between its
    // number and its unit. Written as an escape rather than the literal
    // character, which trips no-irregular-whitespace.
    text: `${number}\u00a0${symbols[step]}`,
    spoken: `${number} ${plural}`,
    step,
  };
}

export interface FormatBytesSignature {
  Args: {
    /** the size to render, counted in bytes (or bits when @unit='bit') */
    value?: number | string;
    /** what the raw number counts: bytes (default) or bits */
    unit?: 'byte' | 'bit';
    /** 'binary' = IEC ÷1024 with KiB/MiB labels (default); 'decimal' = SI ÷1000 with kB/MB labels. Conflating these is the classic bytes bug, so it is a knob, never an assumption. */
    base?: 'binary' | 'decimal';
    /** BCP-47 locale tag; omit to use the runtime default. An unknown tag falls back rather than throwing. */
    locale?: string;
    /** unit wording: 'short' (2.4 MB), 'narrow' (2.4MB), 'long' (2.4 megabytes). Decimal base only — binary always uses the IEC symbol. */
    display?: 'short' | 'narrow' | 'long';
    /** floor on fraction digits (default 0) */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits (default 0 for raw bytes, 1 once scaled) */
    maximumFractionDigits?: number;
    /** wear the Token dress (Law 3) — for machine contexts like an artifact table */
    token?: boolean;
    /** sr-only mirror policy: 'auto' mirrors only when the visible text is unreadable aloud (IEC symbols, narrow units), 'always' forces it, 'off' suppresses it */
    spoken?: 'auto' | 'always' | 'off';
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
  };
  Element: HTMLSpanElement;
}

export class FormatBytes extends Component<FormatBytesSignature> {
  get num(): number | undefined {
    return toNumber(this.args.value);
  }
  get result(): ByteFormatResult | undefined {
    let n = this.num;
    if (n === undefined) {
      return undefined;
    }
    return formatBytes(n, {
      unit: this.args.unit,
      base: this.args.base,
      locale: this.args.locale,
      display: this.args.display,
      minimumFractionDigits: this.args.minimumFractionDigits,
      maximumFractionDigits: this.args.maximumFractionDigits,
    });
  }
  get text(): string {
    return this.result?.text ?? (this.args.placeholder ?? '—');
  }
  get spoken(): string | undefined {
    let mode = this.args.spoken ?? 'auto';
    let result = this.result;
    if (mode === 'off' || !result) {
      return undefined;
    }
    if (mode === 'always') {
      let long = formatBytes(this.num ?? 0, {
        unit: this.args.unit,
        base: this.args.base,
        locale: this.args.locale,
        display: 'long',
        minimumFractionDigits: this.args.minimumFractionDigits,
        maximumFractionDigits: this.args.maximumFractionDigits,
      });
      return long.spoken ?? long.text;
    }
    return result.spoken;
  }
  get isEmpty(): boolean {
    return this.result === undefined;
  }
  <template>
    <FormattedValue
      @text={{this.text}}
      @spoken={{this.spoken}}
      @token={{@token}}
      @empty={{this.isEmpty}}
      data-test-pretui-format-bytes
      ...attributes
    />
  </template>
}

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

// ── FormatNumber ← wa-format-number ──────────────────────────────────────
// Better than the inspiration: the whole Intl.NumberFormat surface is named
// and separately settable (Law 7) with `@options` as the escape hatch for
// anything not named; `style: 'currency'` with no currency (and `'unit'` with
// no unit) degrades to a decimal instead of throwing; and compact/scientific
// notation keeps its full-precision value for a screen reader — '1.2M' is
// visible, '1,234,567' is spoken.
export interface FormatNumberSignature {
  Args: {
    /** the number to render (strings are coerced; anything non-finite renders @placeholder) */
    value?: number | string;
    /** BCP-47 locale tag; omit for the runtime default. An unknown tag falls back rather than throwing. */
    locale?: string;
    /** 'decimal' (default), 'currency', 'percent' (value 0.42 → 42%), or 'unit' */
    style?: 'decimal' | 'currency' | 'percent' | 'unit';
    /** ISO 4217 code, required by style='currency'; without it the style degrades to decimal instead of throwing */
    currency?: string;
    /** how the currency is written */
    currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
    /** how negative currency amounts are marked */
    currencySign?: 'standard' | 'accounting';
    /** CLDR unit identifier for style='unit', e.g. 'kilogram' or 'kilogram-per-hour' */
    unit?: string;
    /** unit wording for style='unit' */
    unitDisplay?: 'short' | 'narrow' | 'long';
    /** 'standard' (default), 'compact' (1.2M), 'scientific', 'engineering' */
    notation?: 'standard' | 'compact' | 'scientific' | 'engineering';
    /** compact wording: 'short' (1.2M) or 'long' (1.2 million) */
    compactDisplay?: 'short' | 'long';
    /** when the sign is shown */
    signDisplay?: 'auto' | 'never' | 'always' | 'exceptZero' | 'negative';
    /** grouping separators: true/false, or 'always' | 'auto' | 'min2' */
    useGrouping?: boolean | 'always' | 'auto' | 'min2';
    /** pad the integer part to at least this many digits */
    minimumIntegerDigits?: number;
    /** floor on fraction digits */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits */
    maximumFractionDigits?: number;
    /** floor on significant digits (wins over fraction digits) */
    minimumSignificantDigits?: number;
    /** ceiling on significant digits (wins over fraction digits) */
    maximumSignificantDigits?: number;
    /** digit system, e.g. 'deva' */
    numberingSystem?: string;
    /** any Intl.NumberFormat option not named above; named knobs win over it */
    options?: FormatOptionBag;
    /** wear the Token dress (Law 3) — for machine contexts like a parameter row */
    token?: boolean;
    /** sr-only mirror policy: 'auto' mirrors whenever the visible text is abbreviated (compact/scientific/engineering notation), 'always' forces it, 'off' suppresses it */
    spoken?: 'auto' | 'always' | 'off';
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
  };
  Element: HTMLSpanElement;
}

export class FormatNumber extends Component<FormatNumberSignature> {
  get num(): number | undefined {
    return toNumber(this.args.value);
  }
  get options(): FormatOptionBag {
    let a = this.args;
    return defined({
      ...(a.options ?? {}),
      style: a.style,
      currency: a.currency,
      currencyDisplay: a.currencyDisplay,
      currencySign: a.currencySign,
      unit: a.unit,
      unitDisplay: a.unitDisplay,
      notation: a.notation,
      compactDisplay: a.compactDisplay,
      signDisplay: a.signDisplay,
      useGrouping: a.useGrouping,
      minimumIntegerDigits: a.minimumIntegerDigits,
      minimumFractionDigits: a.minimumFractionDigits,
      maximumFractionDigits: a.maximumFractionDigits,
      minimumSignificantDigits: a.minimumSignificantDigits,
      maximumSignificantDigits: a.maximumSignificantDigits,
      numberingSystem: a.numberingSystem,
    });
  }
  get text(): string {
    let n = this.num;
    if (n === undefined) {
      return this.args.placeholder ?? '—';
    }
    return formatNumber(n, this.args.locale, this.options);
  }
  get abbreviated(): boolean {
    let notation = this.options['notation'];
    return (
      notation === 'compact' ||
      notation === 'scientific' ||
      notation === 'engineering'
    );
  }
  get spoken(): string | undefined {
    let mode = this.args.spoken ?? 'auto';
    let n = this.num;
    if (mode === 'off' || n === undefined) {
      return undefined;
    }
    if (mode !== 'always' && !this.abbreviated) {
      return undefined;
    }
    // Full precision: same currency/unit dress, standard notation, grouped.
    let bag: FormatOptionBag = { ...this.options };
    delete bag['notation'];
    delete bag['compactDisplay'];
    delete bag['maximumFractionDigits'];
    delete bag['minimumFractionDigits'];
    delete bag['maximumSignificantDigits'];
    delete bag['minimumSignificantDigits'];
    let full = formatNumber(n, this.args.locale, bag);
    return full === this.text ? undefined : full;
  }
  get isEmpty(): boolean {
    return this.num === undefined;
  }
  <template>
    <FormattedValue
      @text={{this.text}}
      @spoken={{this.spoken}}
      @token={{@token}}
      @empty={{this.isEmpty}}
      data-test-pretui-format-number
      ...attributes
    />
  </template>
}

// ── Odometer — the Law 5 canonical mechanism ─────────────────────────────
// "Each digit a 1ch window over a stacked 0–9 column, translateY sprung;
//  offset > 5 → offset -= 10 so every digit takes the shortest path around
//  the ring (9→0 rolls forward one, not backward nine)."
//
// That arithmetic is `rollPath` below, verbatim. Two implementation notes,
// both deliberate:
//
//  1. The rendered column is the SLICE of the 0–9 ring the digit must travel
//     (at most six cells), not the whole ring. A ring-plus-winding-offset
//     implementation drifts without bound — a counter that only ever ticks up
//     drives its units digit to +1 every update forever, and re-basing that
//     offset needs a second frame (rAF/timeout), which the realm forbids. The
//     slice keeps every position bounded, and the visible travel is identical:
//     8→3 rolls forward through 9-0-1-2, 7→3 rolls backward through 6-5-4.
//  2. The motion is ONE CSS animation whose from-state is the custom property
//     `--pretui-odo-start`; the resting transform (`--pretui-odo-rest`) is the
//     base style, so `animation: none` under prefers-reduced-motion lands on
//     the end state, never a frozen midpoint (Law 5). Replay on change comes
//     from a keyed {{#each}} — the digit's key encodes from>to, so a changed
//     digit is a new element and its animation starts fresh. No timers, no
//     JS animation loop, no transitionend bookkeeping.
//
// A11y: the whole digit track is aria-hidden with an sr-only mirror of the
// real value beside it. `@announce` defaults to 'off' — a value that rolls on
// every tick would otherwise spam a screen reader with every intermediate
// number; turn it on only where the value settles at human pace.
export interface RollFrame {
  /** the ring slice, top to bottom, as digit characters */
  cells: string[];
  /** index the window starts on (the old digit) */
  start: number;
  /** index the window rests on (the new digit) */
  rest: number;
}

/**
 * The Law 5 ring walk: shortest path from one digit to another.
 * `(to - from + 10) % 10`, then `offset > 5 → offset -= 10`.
 */
export function rollPath(from: number, to: number): RollFrame {
  let offset = (((to - from) % 10) + 10) % 10;
  if (offset > 5) {
    offset -= 10;
  }
  let steps = Math.abs(offset);
  let cells: string[] = [];
  if (offset >= 0) {
    // forward: the ring slice ascends from the old digit; the window rides up
    for (let i = 0; i <= steps; i++) {
      cells.push(String((from + i) % 10));
    }
    return { cells, start: 0, rest: steps };
  }
  // backward: the same ascending slice, entered from its bottom; window rides down
  for (let i = steps; i >= 0; i--) {
    cells.push(String((((from - i) % 10) + 10) % 10));
  }
  return { cells, start: steps, rest: 0 };
}

interface OdoSlot {
  key: string;
  digit: boolean;
  char: string;
  cells: string[];
  style: ReturnType<typeof htmlSafe>;
}

const DIGIT_RE = /[0-9]/;

export interface OdometerSignature {
  Args: {
    /** the value to display. A number is formatted through Intl; a string is used verbatim, so a pre-formatted value ('$12,480') rolls too. */
    value?: number | string;
    /** BCP-47 locale tag for number formatting; ignored when @value is a string */
    locale?: string;
    /** 'decimal' (default), 'currency', 'percent' or 'unit' */
    style?: 'decimal' | 'currency' | 'percent' | 'unit';
    /** ISO 4217 code for style='currency'; without it the style degrades to decimal */
    currency?: string;
    /** floor on fraction digits */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits */
    maximumFractionDigits?: number;
    /** grouping separators (default: the locale's own choice) */
    useGrouping?: boolean | 'always' | 'auto' | 'min2';
    /** any Intl.NumberFormat option not named above; named knobs win over it */
    options?: FormatOptionBag;
    /** roll duration in seconds (default 0.5) */
    duration?: number;
    /** CSS timing function for the roll (default a sprung cubic-bezier) */
    ease?: string;
    /** seconds of delay added per digit so the carry cascades (default 0.03; 0 rolls every digit together) */
    stagger?: number;
    /** which end the stagger counts from: 'right' (default — the units digit leads, like a carry) or 'left' */
    staggerFrom?: 'right' | 'left';
    /** height of one digit cell, any CSS length (default 1em) */
    cellHeight?: string;
    /** live-region politeness for the sr-only value. 'off' (default) because a value that rolls on every tick would spam a screen reader; use 'polite' only where the value settles at human pace. */
    announce?: 'off' | 'polite' | 'assertive';
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
  };
  Blocks: {
    /** static content before the digits — read aloud before the value */
    before: [];
    /** static content after the digits — read aloud after the value */
    after: [];
  };
  Element: HTMLSpanElement;
}

// Records what the odometer just rendered, AFTER the DOM has it, so the
// next render can diff against it. This bookkeeping used to live inside the
// slots getter; a getter that writes is a side effect (ember/no-side-effects
// flags it) and it is genuinely post-render state, not derivation. Args are
// positional: the text that was just rendered, and the sink that stores it.
const recordRendered = modifier(
  (_el: HTMLElement, [text, sink]: [string, (rendered: string) => void]) => {
    sink(text);
  },
);

export class Odometer extends Component<OdometerSignature> {
  // Untracked on purpose: this is "what the DOM currently shows". It is read
  // during render (by the slots getter) and written after render (by the
  // recordRendered modifier). Tracking it would make that write a
  // backtracking violation; leaving it untracked is correct, because a
  // change to it must never by itself schedule a re-render.
  private previous: string | undefined = undefined;

  // Called by the modifier once the browser is showing `text`.
  private remember = (rendered: string) => {
    this.previous = rendered;
  };

  get text(): string {
    let raw = this.args.value;
    if (typeof raw === 'string' && raw !== '') {
      return raw;
    }
    let n = toNumber(raw);
    if (n === undefined) {
      return this.args.placeholder ?? '—';
    }
    let a = this.args;
    return formatNumber(
      n,
      a.locale,
      defined({
        ...(a.options ?? {}),
        style: a.style,
        currency: a.currency,
        minimumFractionDigits: a.minimumFractionDigits,
        maximumFractionDigits: a.maximumFractionDigits,
        useGrouping: a.useGrouping,
      }),
    );
  }

  get rootStyle(): ReturnType<typeof htmlSafe> {
    let a = this.args;
    // Durations are numbers we formatted ourselves; `@cellHeight` and
    // `@ease` are caller strings and clear the kit-wide allowlist first
    // (pretui-css.gts) — a rejected one falls back to the stylesheet.
    let bits = [
      `--pretui-odo-duration: ${(a.duration ?? 0.5).toFixed(3)}s`,
      `--pretui-odo-stagger: ${(a.stagger ?? 0.03).toFixed(3)}s`,
      cssDeclaration('--pretui-odo-cell', a.cellHeight ?? '1em') ??
        '--pretui-odo-cell: 1em',
    ];
    let ease = cssDeclaration('--pretui-odo-ease', a.ease);
    if (ease) {
      bits.push(ease);
    }
    return htmlSafe(bits.join('; '));
  }

  /**
   * The rendered slots, right-anchored against what the DOM currently shows,
   * so a value that grows a digit keeps its columns aligned. Characters that
   * are digits on both sides roll; everything else (separators, currency
   * marks, compact suffixes) is static — a documented edge, since a value
   * crossing '999' → '1,000' re-shapes the string and those positions snap.
   */
  get slots(): OdoSlot[] {
    let next = this.text;
    // Pure read: `previous` is whatever the DOM is currently showing. The
    // recordRendered modifier advances it after this render commits.
    let prev = this.previous ?? next;
    let shift = next.length - prev.length;
    let digitIndex = 0;
    let total = 0;
    for (let ch of next) {
      if (DIGIT_RE.test(ch)) {
        total++;
      }
    }
    let out: OdoSlot[] = [];
    for (let i = 0; i < next.length; i++) {
      let ch = next[i] as string;
      let before = prev[i - shift];
      let isDigit = DIGIT_RE.test(ch);
      let frame: RollFrame = { cells: [ch], start: 0, rest: 0 };
      if (isDigit && before !== undefined && DIGIT_RE.test(before) && before !== ch) {
        frame = rollPath(Number(before), Number(ch));
      }
      let order =
        this.args.staggerFrom === 'left' ? digitIndex : total - 1 - digitIndex;
      out.push({
        key: `${i}:${before ?? ''}>${ch}`,
        digit: isDigit,
        char: ch,
        cells: frame.cells,
        style: htmlSafe(
          `--pretui-odo-start: ${frame.start}; --pretui-odo-rest: ${frame.rest}; --pretui-odo-i: ${Math.max(order, 0)}`,
        ),
      });
      if (isDigit) {
        digitIndex++;
      }
    }
    return out;
  }

  get liveAttr(): string | undefined {
    let mode = this.args.announce ?? 'off';
    return mode === 'off' ? undefined : mode;
  }
  get isEmpty(): string | undefined {
    return toNumber(this.args.value) === undefined &&
      !(typeof this.args.value === 'string' && this.args.value !== '')
      ? 'true'
      : undefined;
  }
  <template>
    <span
      class='pretui-odometer'
      style={{this.rootStyle}}
      data-empty={{this.isEmpty}}
      data-test-pretui-odometer
      {{recordRendered this.text this.remember}}
      ...attributes
    >
      {{yield to='before'}}
      <span class='pretui-odo-track' aria-hidden='true'>
        {{#each this.slots key='key' as |slot|}}
          {{#if slot.digit}}
            <span class='pretui-odo-digit'>
              <span class='pretui-odo-strut'>{{slot.char}}</span>
              <span class='pretui-odo-ring' style={{slot.style}}>
                {{#each slot.cells as |cell|}}
                  <span class='pretui-odo-cell'>{{cell}}</span>
                {{/each}}
              </span>
            </span>
          {{else}}
            <span class='pretui-odo-char'>{{slot.char}}</span>
          {{/if}}
        {{/each}}
      </span>
      <span class='pretui-odo-sr' aria-live={{this.liveAttr}}>{{this.text}}</span>
      {{yield to='after'}}
    </span>
    <style scoped>
      .pretui-odometer {
        display: inline-flex;
        align-items: baseline;
        font-variant-numeric: tabular-nums;
        line-height: var(--pretui-odo-cell, 1em);
      }
      .pretui-odometer[data-empty='true'] {
        color: var(--muted-foreground);
      }
      .pretui-odo-track {
        display: inline-flex;
        align-items: baseline;
      }
      .pretui-odo-char {
        white-space: pre;
      }
      .pretui-odo-digit {
        position: relative;
        display: inline-block;
        /* clip-path, not overflow: hidden — an overflow-clipped inline-block
           synthesises its baseline from the bottom margin edge, which drops
           the digits below the surrounding text. Clipping keeps the strut's
           real baseline. The small vertical bleed is intentional: display
           fonts can paint cap/bowl antialiasing just outside their fractional
           line box (Space Grotesk's 5 is the visible case). A zero inset
           sheared that ink off at every Odometer size. Horizontal clipping
           remains exact, so adjacent digit columns cannot overlap. */
        clip-path: inset(-0.08em 0);
      }
      .pretui-odo-strut {
        visibility: hidden;
      }
      .pretui-odo-ring {
        position: absolute;
        inset-inline: 0;
        top: 0;
        transform: translateY(
          calc(var(--pretui-odo-rest, 0) * var(--pretui-odo-cell, 1em) * -1)
        );
        animation: pretui-odo-roll var(--pretui-odo-duration, 0.5s)
          var(--pretui-odo-ease, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
        animation-delay: calc(
          var(--pretui-odo-i, 0) * var(--pretui-odo-stagger, 0.03s)
        );
      }
      @keyframes pretui-odo-roll {
        from {
          transform: translateY(
            calc(var(--pretui-odo-start, 0) * var(--pretui-odo-cell, 1em) * -1)
          );
        }
      }
      .pretui-odo-cell {
        display: block;
        height: var(--pretui-odo-cell, 1em);
        line-height: var(--pretui-odo-cell, 1em);
        text-align: center;
      }
      .pretui-odo-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-odo-ring {
          animation: none;
        }
      }
    </style>
  </template>
}
