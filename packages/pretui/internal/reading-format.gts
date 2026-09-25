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
//
// (the reading-format group)

// Pretui — the value formatters' shared Intl plumbing: memoised formatters that never throw, the number and date coercions, and formatClock.
import { fromIso } from './reading-extras';
import { formatDuration } from '@cardstack/boxel-ui/helpers';

// ── shared Intl plumbing — memoised, and it never throws ─────────────────
// Constructing an Intl formatter is the expensive part, so both constructors
// are memoised on (locale, options). A construction that fails is memoised as
// a miss too, so a bad option set costs one throw for the life of the page.
export type FormatOptionBag = Record<string, unknown>;

const NUMBER_CACHE = new Map<string, Intl.NumberFormat | null>();
const DATE_CACHE = new Map<string, Intl.DateTimeFormat | null>();

/** Strip undefined/null so `{ year: undefined }` never reaches Intl. */
export function defined(bag: FormatOptionBag): FormatOptionBag {
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
export function toNumber(
  value: number | string | undefined,
): number | undefined {
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
export function toDate(
  value: string | number | Date | undefined,
): Date | undefined {
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

/** `m:ss`, or `h:mm:ss` past an hour. Never `NaN`; negatives read `0:00`. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  return formatDuration(seconds, { format: 'timer' });
}
