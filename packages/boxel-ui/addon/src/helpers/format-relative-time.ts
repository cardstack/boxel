import type { HelperLike } from '@glint/template';

import type { DateLike, DateUnit, SerialOrigin } from '../utils/date-utils.ts';
import {
  parseDateValue,
  resolveEffectiveTimeZone,
} from '../utils/date-utils.ts';
import type { FormatDateTimeOptions } from './format-date-time.ts';

type RelativeSize = 'tiny' | 'short' | 'medium' | 'long';
type RelativeRound = 'floor' | 'ceil' | 'nearest';
type RelativeUnit =
  | 'year'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second';

interface ParseOptions {
  serialOrigin?: SerialOrigin;
}

export interface FormatRelativeTimeOptions {
  absoluteOptions?: FormatDateTimeOptions;
  fallback?: string;
  locale?: string;
  now?: Date;
  nowThresholdMs?: number;
  numeric?: 'auto' | 'always';
  parse?: ParseOptions;
  precision?: number;
  round?: RelativeRound;
  size?: RelativeSize;
  switchToAbsoluteAfterMs?: number;
  timeZone?: string;
  unit?: DateUnit;
  unitCeil?: RelativeUnit;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const UNIT_IN_MS: Record<RelativeUnit, number> = {
  year: 365 * DAY_IN_MS,
  month: 30 * DAY_IN_MS,
  week: 7 * DAY_IN_MS,
  day: DAY_IN_MS,
  hour: 60 * 60 * 1000,
  minute: 60 * 1000,
  second: 1000,
};

const UNIT_ORDER: RelativeUnit[] = [
  'year',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
];

const DEFAULT_NOW_THRESHOLD = 30_000;

function formatRelativeTimeInternal(
  value: DateLike | null | undefined,
  options: FormatRelativeTimeOptions = {},
): string {
  const parsed = parseDateValue(value, {
    unit: options.unit,
    serialOrigin: options.parse?.serialOrigin,
  });

  if (!parsed) {
    return options.fallback ?? '';
  }

  const now = options.now ?? new Date();
  const diffMs = parsed.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);

  if (shouldUseAbsolute(absDiffMs, options.switchToAbsoluteAfterMs)) {
    const effectiveTimeZone = resolveEffectiveTimeZone(options.timeZone);
    const absoluteOptions: FormatDateTimeOptions = {
      locale: options.locale,
      timeZone: effectiveTimeZone,
      ...options.absoluteOptions,
    };
    // Avoid runtime circular import by formatting the absolute date locally
    // with Intl.DateTimeFormat using the provided locale/timeZone. We keep
    // this simple because absoluteOptions coming from callers (via
    // formatDateTime) are typically just locale/timeZone in our usage.
    return formatAbsoluteWithIntl(parsed, absoluteOptions);
  }

  const nowThreshold = options.nowThresholdMs ?? DEFAULT_NOW_THRESHOLD;
  if (absDiffMs <= nowThreshold) {
    return formatNow(options);
  }

  const selection = selectRelativeUnit(absDiffMs, options);
  const size = options.size ?? 'medium';

  // Use 'long' style for month/year units even when size is 'short' so
  // larger calendar spans are spelled out (e.g. "2 months ago") instead of
  // abbreviated (e.g. "2 mo. ago"). For other units, use the resolved style
  // based on the requested size.
  const styleForUnit: Intl.RelativeTimeFormatStyle | undefined =
    size === 'short' &&
    (selection.unit === 'month' || selection.unit === 'year')
      ? 'long'
      : resolveRelativeStyle(size);
  const rtf = new Intl.RelativeTimeFormat(options.locale ?? 'en-US', {
    numeric: options.numeric ?? 'auto',
    style: styleForUnit,
  });

  const signedValue = diffMs > 0 ? selection.value : -selection.value;
  // If precision is greater than 1, build a multi-unit string like
  // "2 months, 15 days ago". Default precision is 1 (current behavior).
  const precision = Math.max(1, options.precision ?? 1);

  // If tiny size requested and precision is 1, return compact single-unit.
  // If precision > 1 and size is tiny, fall through to multi-unit builder
  // which will produce a compact tiny multi-unit using buildTinyMulti.
  if (size === 'tiny' && precision === 1) {
    return formatTiny(selection.value, selection.unit, diffMs > 0);
  }

  if (precision === 1) {
    return rtf.format(signedValue, selection.unit);
  }

  return buildMultiUnitRelativeString(
    absDiffMs,
    diffMs > 0,
    selection.unit,
    precision,
    options,
    styleForUnit,
  );
}

function buildMultiUnitRelativeString(
  absDiffMs: number,
  isFuture: boolean,
  baseUnit: RelativeUnit,
  precision: number,
  options: FormatRelativeTimeOptions,
  styleForUnit: Intl.RelativeTimeFormatStyle,
): string {
  const locale = options.locale ?? 'en-US';
  const roundMode = options.round ?? 'floor';
  const roundModeLocal = roundMode;

  // When showing multiple units, prefer predictable numeric forms.
  // Respect explicit caller choice if provided.
  const numericOption: 'auto' | 'always' =
    options.numeric ?? (precision > 1 ? 'always' : 'auto');

  // Start from the base unit (as selected by thresholds) and decompose the
  // remainder into smaller units greedily.
  const units: { unit: RelativeUnit; value: number }[] = [];
  let remainderMs = absDiffMs;

  // For the base unit, prefer the rounded value used by the selector to
  // keep behaviour consistent.
  const startIndex = UNIT_ORDER.indexOf(baseUnit);
  const firstValue = Math.max(
    applyRound(absDiffMs / UNIT_IN_MS[baseUnit], roundModeLocal),
    1,
  );
  units.push({ unit: baseUnit, value: firstValue });
  remainderMs = Math.max(0, remainderMs - firstValue * UNIT_IN_MS[baseUnit]);

  // Collect subsequent smaller units until we have enough or run out.
  for (
    let i = startIndex + 1;
    i < UNIT_ORDER.length && units.length < precision;
    i++
  ) {
    const u = UNIT_ORDER[i] as RelativeUnit;
    // Prefer days over weeks in multi-unit output to match spec:
    // e.g. "2 months, 15 days" rather than "2 months, 2 weeks".
    if (u === 'week') {
      continue;
    }
    const raw = Math.floor(remainderMs / UNIT_IN_MS[u]);
    if (raw > 0) {
      units.push({ unit: u, value: raw });
      remainderMs -= raw * UNIT_IN_MS[u];
    }
  }

  // If size is tiny, provide a compact multi-unit representation using short
  // labels (e.g. "+2d, 10h") so precision+tiny works.
  if ((options.size ?? 'medium') === 'tiny') {
    return buildTinyMulti(units, isFuture);
  }

  // Build localized component strings for each unit while preserving locale
  // ordering of number/unit (use formatToParts to respect locale rules but
  // strip only detected directional words like "ago"/"in").

  const rtfForParts = new Intl.RelativeTimeFormat(locale, {
    numeric: numericOption,
    style: styleForUnit,
  });

  // Detect directional literals/position for both past and future so we can
  // render the correct direction and strip only those literal tokens from
  // unit components.
  const directionInfo = detectDirectionForLocale(rtfForParts, baseUnit);

  const components = units.map((u) =>
    formatUnitWithLocale(
      u.value,
      u.unit,
      rtfForParts,
      locale,
      isFuture,
      directionInfo,
    ),
  );

  // Use the appropriate direction info based on whether this is future or past.
  const dir = isFuture ? directionInfo.future : directionInfo.past;

  const joined = components.join(', ');

  // Compose by splicing multi-unit into a localized single-unit template.
  // This preserves locale-specific direction words ("ago"/"in"/"hace") and ordering.
  try {
    const unitOne = formatUnitWithLocale(
      1,
      baseUnit,
      rtfForParts,
      locale,
      isFuture,
      directionInfo,
    );
    const template = rtfForParts.format(isFuture ? 1 : -1, baseUnit);
    if (template.includes(unitOne)) {
      // Replace the first occurrence only; keep any surrounding spaces intact.
      const esc = unitOne.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const result = template.replace(new RegExp(esc), joined).trim();
      if (result) {
        return result;
      }
    }
  } catch {
    // fall through if anything unexpected happens
  }

  if (dir.position === 'prefix' && dir.text) {
    return `${dir.text} ${joined}`.trim();
  }

  if (dir.position === 'suffix' && dir.text) {
    return `${joined} ${dir.text}`.trim();
  }

  // Locale-safe fallback: synthesize direction using formatToParts
  // without hardcoding English tokens. Filter out unit tokens to avoid
  // tails like "second ago".
  try {
    const parts = rtfForParts.formatToParts(isFuture ? 1 : -1, 'second');
    const firstSig = parts.findIndex(
      (p) => p.type === 'integer' || p.type === 'unit',
    );
    const lastSig = parts
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.type === 'integer' || p.type === 'unit')
      .map(({ idx }) => idx)
      .pop();

    // Build the set of localized unit tokens we must ignore if they appear
    // as lettered literals in some engines/polyfills (e.g., "second").
    const unitTokens = new Set<string>(
      parts
        .filter(
          (p) =>
            p.type === 'unit' ||
            (p.type === 'literal' && /\p{Letter}/u.test(p.value)),
        )
        .map((p) => p.value.trim().toLowerCase())
        .filter(Boolean),
    );

    const literalLetters = (arr: Intl.RelativeTimeFormatPart[] = []) => {
      const words = arr
        .filter((p) => p.type === 'literal' && /\p{Letter}/u.test(p.value))
        .map((p) => p.value.trim())
        .filter(Boolean)
        // Drop any token that matches the unit word, e.g., "second"
        .filter((w) => !unitTokens.has(w.toLowerCase()));
      return Array.from(new Set(words)).join(' ').trim();
    };

    const prefix = literalLetters(parts.slice(0, Math.max(0, firstSig)));
    const suffix = literalLetters(parts.slice((lastSig ?? -1) + 1));

    if (prefix) {
      return `${prefix} ${joined}`.trim();
    }
    if (suffix) {
      return `${joined} ${suffix}`.trim();
    }
  } catch {
    // ignore and fall through
  }

  // Final neutral fallback: return joined components without a direction word.
  // (Better than forcing English "ago"/"in".)
  return joined;
}

function formatUnitWithLocale(
  value: number,
  unit: RelativeUnit,
  rtf: Intl.RelativeTimeFormat,
  locale: string,
  isFuture: boolean,
  directionInfo: {
    future: {
      literals: string[];
      position: 'prefix' | 'suffix' | 'none';
      text: string;
    };
    past: {
      literals: string[];
      position: 'prefix' | 'suffix' | 'none';
      text: string;
    };
  },
): string {
  // Choose sign consistent with the intended direction so parts reflect the
  // correct number/unit ordering for the locale variant.
  const signedSample = isFuture ? value : -value;
  const parts = rtf.formatToParts(signedSample as any, unit as any);

  // Build formatted number using Intl.NumberFormat so grouping/locale are
  // respected.
  const nf = new Intl.NumberFormat(locale, { useGrouping: true });
  const formattedNumber = nf.format(value);

  // Fallback approach: format the full localized string and strip any
  // directional token (prefix/suffix) discovered for this locale. This is
  // more robust across different JS engines which may classify the unit as
  // a 'unit' part or a 'literal'. Using the precomputed parts above we can
  // still build a sane numeric formatting, but prefer the formatted full
  // string to preserve complex locale-specific unit rendering.
  try {
    const full = rtf.format(signedSample as any, unit as any);

    // Clean localized directional markers from formatted string.
    // Some locales (like 'es-ES') may repeat "hace"/"en" per unit.
    const cleanDirectionalMarkers = (text: string) => {
      const tokens = [
        directionInfo.past?.text,
        directionInfo.future?.text,
        'ago',
        'in',
        'hace',
        'en',
      ].filter(Boolean) as string[];

      let result = text.trim();
      for (const t of tokens) {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result
          .replace(new RegExp(`^\\s*${esc}\\s*`, 'iu'), '')
          .replace(new RegExp(`\\s*${esc}\\s*$`, 'iu'), '');
      }
      return result.trim();
    };

    const cleaned = cleanDirectionalMarkers(full);

    // If cleaning produced something non-empty, return it and
    // DO NOT fall through to parts-based assembly (prevents duplication).
    if (cleaned) {
      return cleaned;
    }
  } catch (e) {
    // Ignore and fall back to parts-based assembly below.
  }

  // Fallback to parts-based assembly if formatting/stripping above failed.
  let sawNumber = false;
  let sawUnit = false;
  let result = '';
  for (const p of parts) {
    if (
      p.type === 'integer' ||
      p.type === 'fraction' ||
      p.type === 'group' ||
      p.type === 'decimal'
    ) {
      if (!sawNumber) {
        result += formattedNumber;
        sawNumber = true;
      }
      continue;
    }

    if (p.type === 'unit' && !sawUnit) {
      if (
        result.length > 0 &&
        !/\s$/.test(result) &&
        !/^[\p{P}\p{S}]/u.test(p.value)
      ) {
        result += ' ';
      }
      result += p.value;
      sawUnit = true;
      continue;
    }

    if (p.type === 'literal') {
      // Drop lettered literals (likely direction words) here.
      if (/\p{Letter}/u.test(p.value)) {
        continue;
      }
      result += p.value;
    }

    if (p.type === 'plusSign' || p.type === 'minusSign') {
      result += p.value;
    }
  }

  if (!result) {
    return `${formattedNumber} ${unit}${value === 1 ? '' : 's'}`;
  }

  return result.trim();
}

function detectDirectionForLocale(
  rtf: Intl.RelativeTimeFormat,
  unit: RelativeUnit,
): {
  future: {
    literals: string[];
    position: 'prefix' | 'suffix' | 'none';
    text: string;
  };
  past: {
    literals: string[];
    position: 'prefix' | 'suffix' | 'none';
    text: string;
  };
} {
  // Helper to inspect a signed example and extract letter-only literal tokens
  // and whether they appear before or after the main numeric/unit parts.
  // IMPORTANT: Some JS engines/polyfills surface the localized unit word
  // (e.g., "month", "day") as a literal instead of a 'unit' part.
  // We detect and FILTER OUT those unit tokens so we only keep true
  // direction words like "ago"/"in"/"hace"/"en".
  function inspect(signedSample: number): {
    literals: string[];
    position: 'prefix' | 'suffix' | 'none';
    text: string;
  } {
    const parts = rtf.formatToParts(signedSample as any, unit as any);

    // Collect any visible unit tokens from parts (robust to odd engines).
    const unitTokens = new Set<string>(
      parts
        .filter(
          (p) =>
            p.type === 'unit' ||
            (p.type === 'literal' && /\p{Letter}/u.test(p.value)),
        )
        .map((p) => p.value.trim().toLowerCase())
        .filter((v) => !!v),
    );

    const firstSignificant = parts.findIndex(
      (p) => p.type === 'integer' || p.type === 'unit',
    );
    const lastSignificant = parts
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.type === 'integer' || p.type === 'unit')
      .map(({ idx }) => idx)
      .pop();

    if (firstSignificant === -1 || lastSignificant == null) {
      return { position: 'none' as const, text: '', literals: [] as string[] };
    }

    const prefixLiterals: string[] = [];
    const suffixLiterals: string[] = [];

    parts.forEach((p, idx) => {
      if (p.type === 'literal' && /\p{Letter}/u.test(p.value)) {
        const raw = p.value.trim();
        const val = raw;
        const lower = val.toLowerCase();
        // Filter out any literal that is actually the unit token
        // (e.g., "month", "day") to avoid "month ago" / "day ago" tails.
        if (unitTokens.has(lower)) {
          return;
        }
        if (idx < firstSignificant) {
          prefixLiterals.push(val);
        } else if (idx > (lastSignificant as number)) {
          suffixLiterals.push(val);
        }
      }
    });

    if (prefixLiterals.length === 0 && suffixLiterals.length === 0) {
      return { position: 'none' as const, text: '', literals: [] as string[] };
    }

    if (prefixLiterals.length > 0) {
      const text = prefixLiterals.join(' ').trim();
      const literals = Array.from(new Set(prefixLiterals));
      return { position: 'prefix', text, literals };
    }

    const text = suffixLiterals.join(' ').trim();
    const literals = Array.from(new Set(suffixLiterals));
    return { position: 'suffix', text, literals };
  }

  const past = inspect(-1);
  const future = inspect(1);

  return { past, future };
}

function buildTinyMulti(
  units: { unit: RelativeUnit; value: number }[],
  isFuture: boolean,
): string {
  if (units.length === 0) {
    return isFuture ? '+0s' : '0s';
  }
  const comps = units.map((u) => `${u.value}${tinyUnitLabel(u.unit)}`);
  const prefix = isFuture ? '+' : '';
  return `${prefix}${comps.join(', ')}`;
}

function shouldUseAbsolute(
  absDiffMs: number,
  thresholdMs: number | undefined,
): boolean {
  if (thresholdMs == null) {
    return false;
  }

  return absDiffMs >= thresholdMs;
}

function formatNow(options: FormatRelativeTimeOptions): string {
  if ((options.size ?? 'medium') === 'tiny') {
    return 'now';
  }

  const rtf = new Intl.RelativeTimeFormat(options.locale ?? 'en-US', {
    numeric: options.numeric ?? 'auto',
    style: resolveRelativeStyle(options.size ?? 'medium'),
  });

  return rtf.format(0, 'second');
}

function selectRelativeUnit(
  absDiffMs: number,
  options: FormatRelativeTimeOptions,
): { unit: RelativeUnit; value: number } {
  // Use human-friendly thresholds (inspired by Moment.js) so that
  // durations read naturally: seconds, minutes, hours, days, months, years.
  // Respect `unitCeil` by preventing selection of larger units when set.
  const roundMode = options.round ?? 'floor';
  const unitCeilIndex =
    options.unitCeil && UNIT_ORDER.includes(options.unitCeil)
      ? UNIT_ORDER.indexOf(options.unitCeil)
      : 0;

  const seconds = absDiffMs / UNIT_IN_MS.second;
  const minutes = absDiffMs / UNIT_IN_MS.minute;
  const hours = absDiffMs / UNIT_IN_MS.hour;
  const days = absDiffMs / UNIT_IN_MS.day;
  const months = absDiffMs / UNIT_IN_MS.month; // month uses 30*DAY as defined
  const years = absDiffMs / UNIT_IN_MS.year;

  // Thresholds (tuned for human-friendly display):
  // seconds < 45 -> seconds
  // seconds < 90 -> 1 minute
  // minutes < 45 -> minutes
  // minutes < 90 -> 1 hour
  // hours < 22 -> hours
  // hours < 36 -> 1 day
  // days < 45 -> days
  // days < 345 -> months
  // otherwise years

  // Helper to ensure we don't pick a unit above unitCeil
  const isAllowed = (unit: RelativeUnit) =>
    UNIT_ORDER.indexOf(unit) >= unitCeilIndex;

  // If a unitCeil is provided, prefer the largest allowed unit that is
  // >= 1 (after rounding). This guarantees that when callers restrict to
  // a smaller ceiling (e.g. 'minute') we still return a sensible value
  // like '120 minutes ago' for a 2-hour span instead of falling back to
  // seconds due to threshold rules.
  if (options.unitCeil) {
    const allowed = UNIT_ORDER.slice(unitCeilIndex);
    for (const unit of allowed) {
      const raw = absDiffMs / UNIT_IN_MS[unit];
      if (unit !== 'second' && raw < 1) {
        continue;
      }
      const rounded = applyRound(raw, roundMode);
      if (rounded === 0 && unit !== 'second') {
        continue;
      }
      return { unit, value: Math.max(rounded, 1) };
    }

    return { unit: 'second', value: 1 };
  }

  if (seconds < 45 && isAllowed('second')) {
    return {
      unit: 'second',
      value: Math.max(applyRound(seconds, roundMode), 1),
    };
  }

  if (seconds < 90 && isAllowed('minute')) {
    return { unit: 'minute', value: 1 };
  }

  if (minutes < 45 && isAllowed('minute')) {
    return {
      unit: 'minute',
      value: Math.max(applyRound(minutes, roundMode), 1),
    };
  }

  if (minutes < 90 && isAllowed('hour')) {
    return { unit: 'hour', value: 1 };
  }

  if (hours < 22 && isAllowed('hour')) {
    return { unit: 'hour', value: Math.max(applyRound(hours, roundMode), 1) };
  }

  if (hours < 36 && isAllowed('day')) {
    return { unit: 'day', value: 1 };
  }

  if (days < 45 && isAllowed('day')) {
    return { unit: 'day', value: Math.max(applyRound(days, roundMode), 1) };
  }

  if (days < 345 && isAllowed('month')) {
    return { unit: 'month', value: Math.max(applyRound(months, roundMode), 1) };
  }

  if (isAllowed('year')) {
    return { unit: 'year', value: Math.max(applyRound(years, roundMode), 1) };
  }

  // Fallback to seconds if nothing else matched / allowed
  return { unit: 'second', value: 1 };
}

function formatTiny(
  value: number,
  unit: RelativeUnit,
  isFuture: boolean,
): string {
  if (value <= 0) {
    return 'now';
  }

  const label = tinyUnitLabel(unit);
  const prefix = isFuture ? '+' : '';
  return `${prefix}${value}${label}`;
}

function tinyUnitLabel(unit: RelativeUnit): string {
  switch (unit) {
    case 'year':
      return 'y';
    case 'month':
      return 'mo';
    case 'week':
      return 'w';
    case 'day':
      return 'd';
    case 'hour':
      return 'h';
    case 'minute':
      return 'm';
    case 'second':
      return 's';
    default:
      return '';
  }
}

function resolveRelativeStyle(
  size: RelativeSize,
): Intl.RelativeTimeFormatStyle {
  switch (size) {
    case 'short':
      return 'short';
    case 'long':
      return 'long';
    case 'tiny':
      return 'narrow';
    case 'medium':
    default:
      return 'long';
  }
}

function applyRound(value: number, round: RelativeRound): number {
  switch (round) {
    case 'ceil':
      return Math.ceil(value);
    case 'nearest':
      return Math.round(value);
    case 'floor':
    default:
      return Math.floor(value);
  }
}

type FormatRelativeTimeHelperSignature = {
  Args: {
    Named: FormatRelativeTimeOptions;
    Positional: [DateLike | null | undefined];
  };
  Return: string;
};

type FormatRelativeTimeHelper = HelperLike<FormatRelativeTimeHelperSignature> &
  ((
    value: DateLike | null | undefined,
    options?: FormatRelativeTimeOptions,
  ) => string);

export const formatRelativeTime =
  formatRelativeTimeInternal as FormatRelativeTimeHelper;

export default formatRelativeTime;

function formatAbsoluteWithIntl(date: Date, options: FormatDateTimeOptions) {
  const locale = options.locale ?? 'en-US';
  const timeZone = resolveEffectiveTimeZone(options.timeZone);
  // If the caller provided dateStyle/timeStyle use those so we match
  // `formatDateTime` behavior (e.g. `dateStyle: 'long'` => full month name).
  // Otherwise default to a sensible date-only representation.
  const intlOpts: Intl.DateTimeFormatOptions = { timeZone };

  if (options.dateStyle || options.timeStyle) {
    if (options.dateStyle) {
      intlOpts.dateStyle = options.dateStyle;
    }
    if (options.timeStyle) {
      intlOpts.timeStyle = options.timeStyle;
    }
  } else {
    // Default to date-only output when no explicit styles were requested.
    intlOpts.year = 'numeric';
    intlOpts.month = 'short';
    intlOpts.day = 'numeric';
    // Include time only when the caller explicitly asked for a datetime kind.
    if ((options as any).kind === 'datetime') {
      intlOpts.hour = 'numeric';
      intlOpts.minute = '2-digit';
    }
  }

  try {
    return new Intl.DateTimeFormat(locale, intlOpts).format(date);
  } catch {
    // As a final fallback, use toISOString()
    return date.toISOString();
  }
}
