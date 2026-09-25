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
