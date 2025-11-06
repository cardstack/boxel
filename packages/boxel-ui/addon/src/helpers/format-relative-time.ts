import type { HelperLike } from '@glint/template';

import type { DateLike, DateUnit, SerialOrigin } from '../utils/date-utils.ts';
import { parseDateValue } from '../utils/date-utils.ts';
import {
  type FormatDateTimeOptions,
  formatDateTime,
} from './format-date-time.ts';

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
    const absoluteOptions: FormatDateTimeOptions = {
      locale: options.locale,
      timeZone: options.timeZone,
      ...options.absoluteOptions,
    };
    return formatDateTime(parsed, absoluteOptions);
  }

  const nowThreshold = options.nowThresholdMs ?? DEFAULT_NOW_THRESHOLD;
  if (absDiffMs <= nowThreshold) {
    return formatNow(options);
  }

  const selection = selectRelativeUnit(absDiffMs, options);
  const size = options.size ?? 'medium';

  if (size === 'tiny') {
    return formatTiny(selection.value, selection.unit, diffMs > 0);
  }

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
  return rtf.format(signedValue, selection.unit);
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
