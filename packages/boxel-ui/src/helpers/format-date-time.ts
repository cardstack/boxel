import type { HelperLike } from '@glint/template';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
// Plugins need to be imported with .js extension
// https://github.com/iamkun/dayjs/issues/1167#issuecomment-972880586
import localizedFormat from 'dayjs/plugin/localizedFormat.js';
import quarterOfYear from 'dayjs/plugin/quarterOfYear.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

import type { DateLike, DateUnit, SerialOrigin } from '../utils/date-utils.ts';
import {
  getISOWeekInfo,
  getZonedDateParts,
  isSameCalendarDay,
  parseDateValue,
  resolveEffectiveTimeZone,
} from '../utils/date-utils.ts';
import formatRelativeTime from './format-relative-time.ts';

/**
 * Defines the size presets for date/time formatting
 */
type PresetSize = 'tiny' | 'short' | 'medium' | 'long';

/**
 * Specifies the type of date/time formatting to apply
 * @description Controls how the date/time value should be formatted and which components to include
 */
type DateTimeKind =
  | 'date'
  | 'time'
  | 'datetime'
  | 'month'
  | 'year'
  | 'monthYear'
  | 'week'
  | 'quarter'
  | 'monthDay';

/**
 * Available styles for date formatting in Intl.DateTimeFormat
 */
type IntlDateStyle = 'short' | 'medium' | 'long' | 'full';

/**
 * Available styles for time formatting in Intl.DateTimeFormat
 */
type IntlTimeStyle = 'short' | 'medium' | 'long' | 'full';
type WeekFormat = 'iso' | 'label';
type QuarterFormat = 'Qn' | 'long';
type FormatEngine = 'auto' | 'intl' | 'dayjs';

/**
 * Configuration options for date/time formatting
 * @interface FormatDateTimeOptions
 */
export interface FormatDateTimeOptions {
  /** The calendar system to use (e.g., 'gregory', 'chinese', 'japanese') */
  calendar?: string;
  /** The formatting style to use for the date portion */
  dateStyle?: IntlDateStyle;
  /** The formatting engine to use (auto selects based on format string presence) */
  engine?: FormatEngine;
  /** Value to return if formatting fails or input is invalid */
  fallback?: string;
  /** Custom format string (forces dayjs engine when provided) */
  format?: string;
  /** Whether to use 12-hour time format */
  hour12?: boolean;
  /** Specific hour cycle to use */
  hourCycle?: 'h11' | 'h12' | 'h23' | 'h24';
  /** The type of formatting to apply */
  kind?: DateTimeKind;
  /** The locale to use for formatting */
  locale?: string;
  /** How to display months when kind is 'month' */
  monthDisplay?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
  /** Reference date for relative formatting */
  now?: Date;
  /** The numbering system to use */
  numberingSystem?: string;
  numeric?: 'auto' | 'always';
  /** Options for parsing the input value */
  parse?: { serialOrigin?: SerialOrigin };
  precision?: number;
  preset?: PresetSize;
  quarterFormat?: QuarterFormat;
  /** Whether to show the date relative to now (e.g., "2 hours ago") */
  relative?: boolean;
  /** @deprecated Use preset instead */
  size?: PresetSize;
  timeStyle?: IntlTimeStyle;
  timeZone?: string;
  unit?: DateUnit;
  weekFormat?: WeekFormat;
}

interface DayjsFormatContext {
  locale?: string;
  timeZone?: string;
}

let dayjsConfigured = false;

/**
 * Helper function to format date in tiny size with today-awareness
 * @param date - The date to format
 * @param options - Formatting options including locale and timezone
 * @returns Formatted date string
 */
function formatTinyWithToday(
  date: Date,
  options: FormatDateTimeOptions,
): string {
  // Do not force a UTC fallback here — if no timeZone is provided we want
  // Intl to use the host environment's timezone. Pass through the
  // timeZone only when explicitly provided so the 'today' check and the
  // resulting formatting match caller intent.
  const timeZone = resolveEffectiveTimeZone(options.timeZone);
  const now = options.now ?? new Date();
  const isToday = isSameCalendarDay(date, now, timeZone);

  if (isToday) {
    const intlOpts: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: options.hour12,
      hourCycle: options.hourCycle,
    };
    if (timeZone) {
      intlOpts.timeZone = timeZone;
    }
    return new Intl.DateTimeFormat(options.locale ?? 'en-US', intlOpts).format(
      date,
    );
  }

  const formatterOpts: Intl.DateTimeFormatOptions = {
    month: 'numeric',
    day: 'numeric',
  };
  if (timeZone) {
    formatterOpts.timeZone = timeZone;
  }

  const formatter = new Intl.DateTimeFormat(
    options.locale ?? 'en-US',
    formatterOpts,
  );

  return formatter.format(date);
}

/**
 * Internal function to format date/time values using either Intl or Day.js
 * @param value - The date value to format (can be a Date, string, number, or undefined)
 * @param options - Configuration options for formatting
 * @returns Formatted date/time string or fallback value if provided
 * @example
 * ```ts
 * formatDateTimeInternal(new Date(), { preset: 'short' }) // "3/15/24"
 * formatDateTimeInternal(date, { kind: 'time', timeStyle: 'medium' }) // "3:45:00 PM"
 * ```
 */
function formatDateTimeInternal(
  value: DateLike | null | undefined,
  options: FormatDateTimeOptions = {},
): string {
  const effectiveTimeZone = resolveEffectiveTimeZone(options.timeZone);
  const optsWithTZ: FormatDateTimeOptions = {
    ...options,
    timeZone: effectiveTimeZone,
  };
  const parsed = parseDateValue(value, {
    unit: options.unit,
    serialOrigin: options.parse?.serialOrigin,
  });

  if (!parsed) {
    return options.fallback ?? '';
  }

  // Handle relative time formatting if requested by delegating to the
  // dedicated relative-time helper so behaviour is consistent across the
  // codebase. We forward a minimal set of options and ensure the absolute
  // fallback does not re-enable relative formatting (to avoid recursion).
  if (options.relative) {
    const relOptions = {
      locale: optsWithTZ.locale,
      now: optsWithTZ.now,
      // map deprecated size/preset -> size
      size: (optsWithTZ.size as any) ?? (optsWithTZ.preset as any),
      timeZone: optsWithTZ.timeZone,
      parse: optsWithTZ.parse as any,
      unit: optsWithTZ.unit,
      // forward control flags
      numeric: (optsWithTZ as any).numeric,
      round: (optsWithTZ as any).round,
      unitCeil: (optsWithTZ as any).unitCeil,
      nowThresholdMs: (optsWithTZ as any).nowThresholdMs,
      precision: (optsWithTZ as any).precision,
      switchToAbsoluteAfterMs: (optsWithTZ as any).switchToAbsoluteAfterMs,
      // Provide absoluteOptions that do not include `relative` so that when
      // the relative formatter switches to absolute it won't loop back.
      absoluteOptions: {
        locale: optsWithTZ.locale,
        timeZone: optsWithTZ.timeZone,
      },
    };

    return formatRelativeTime(parsed, relOptions as any);
  }

  // Handle size/preset with today-awareness
  const effectivePreset = options.size || options.preset;
  if (effectivePreset === 'tiny') {
    return formatTinyWithToday(parsed, optsWithTZ);
  }

  if (shouldUseDayjs(optsWithTZ)) {
    return formatWithDayjs(parsed, optsWithTZ) ?? optsWithTZ.fallback ?? '';
  }

  return formatWithIntl(parsed, optsWithTZ) ?? optsWithTZ.fallback ?? '';
}

function shouldUseDayjs(options: FormatDateTimeOptions): boolean {
  if (options.engine === 'dayjs') {
    return true;
  }
  if (options.engine === 'intl') {
    return false;
  }
  return Boolean(options.format);
}

function configureDayjs(): void {
  if (!dayjsConfigured) {
    dayjs.extend(utc);
    dayjs.extend(timezone);
    dayjs.extend(localizedFormat);
    dayjs.extend(advancedFormat);
    dayjs.extend(quarterOfYear);
    dayjsConfigured = true;
  }
}

function formatWithDayjs(
  date: Date,
  options: FormatDateTimeOptions,
): string | null {
  if (options.kind === 'week' || options.kind === 'quarter') {
    return formatSpecialKinds(date, options);
  }

  configureDayjs();

  const context: DayjsFormatContext = {
    locale: options.locale,
    timeZone: options.timeZone,
  };

  // Construct an instance that reflects the requested target zone's wall-clock
  // fields deterministically. We avoid relying on dayjs.tz at render-time and
  // instead derive the zone-local parts and then build a UTC Date that holds
  // those same fields. Formatting that UTC date with dayjs.utc(...) yields
  // stable token output independent of the host environment timezone.
  let instance;
  if (options.timeZone) {
    const parts = getZonedDateParts(date, options.timeZone);
    const utcDate = new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour ?? 0,
        parts.minute ?? 0,
        parts.second ?? 0,
        parts.millisecond ?? 0,
      ),
    );
    instance = dayjs.utc(utcDate);
  } else {
    instance = dayjs(date);
  }

  const locale = context.locale ? normalizeLocale(context.locale) : undefined;
  if (locale) {
    instance = instance.locale(locale);
  }

  const formatString = resolveDayjsFormat(options);
  return instance.format(formatString);
}

function normalizeLocale(locale: string): string {
  return locale.toLowerCase();
}

function resolveDayjsFormat(options: FormatDateTimeOptions): string {
  if (options.format) {
    return options.format;
  }

  switch (options.kind) {
    case 'time':
      return 'h:mm A';
    case 'date':
      return 'YYYY-MM-DD';
    case 'month':
      return options.monthDisplay === 'numeric'
        ? 'M'
        : options.monthDisplay === 'long'
          ? 'MMMM'
          : 'MMM';
    case 'monthDay':
      return options.monthDisplay === 'long' ? 'MMMM D' : 'MMM D';
    case 'monthYear':
      return options.monthDisplay === 'long' ? 'MMMM YYYY' : 'MMM YYYY';
    case 'year':
      return 'YYYY';
    case 'week':
      return 'GGGG-[W]WW';
    case 'quarter':
      return "YYYY-'Q'Q";
    default:
      break;
  }

  if (options.timeStyle && !options.dateStyle) {
    return 'HH:mm';
  }

  if (options.dateStyle && !options.timeStyle) {
    return 'YYYY-MM-DD';
  }

  return 'YYYY-MM-DD HH:mm';
}

function formatWithIntl(
  date: Date,
  options: FormatDateTimeOptions,
): string | null {
  const result = buildIntlFormat(date, options);

  if (result.type === 'literal') {
    return result.value;
  }

  const formatter = new Intl.DateTimeFormat(
    options.locale ?? 'en-US',
    result.options,
  );

  return formatter.format(date);
}

type IntlFormatResult =
  | { type: 'literal'; value: string }
  | { options: Intl.DateTimeFormatOptions; type: 'intl' };

function buildIntlFormat(
  date: Date,
  options: FormatDateTimeOptions,
): IntlFormatResult {
  if (options.kind === 'week' || options.kind === 'quarter') {
    return { type: 'literal', value: formatSpecialKinds(date, options) };
  }

  const intlOptions: Intl.DateTimeFormatOptions = {
    timeZone: options.timeZone,
    hour12: options.hour12,
    hourCycle: options.hourCycle,
    calendar: options.calendar,
    numberingSystem: options.numberingSystem,
  };

  let usesFieldOptions = false;
  const kind = options.kind;

  switch (kind) {
    case 'month':
      usesFieldOptions = true;
      intlOptions.month = options.monthDisplay ?? 'long';
      break;
    case 'monthDay':
      usesFieldOptions = true;
      intlOptions.month = options.monthDisplay ?? 'short';
      intlOptions.day = 'numeric';
      break;
    case 'monthYear':
      usesFieldOptions = true;
      intlOptions.month = options.monthDisplay ?? 'short';
      intlOptions.year = 'numeric';
      break;
    case 'year':
      usesFieldOptions = true;
      intlOptions.year = 'numeric';
      break;
    case 'time':
      intlOptions.timeStyle = options.timeStyle ?? 'short';
      break;
    case 'date':
      intlOptions.dateStyle = options.dateStyle ?? 'medium';
      break;
    case 'datetime':
      intlOptions.dateStyle = options.dateStyle ?? 'medium';
      intlOptions.timeStyle = options.timeStyle ?? 'short';
      break;
    default:
      break;
  }

  if (!usesFieldOptions) {
    if (options.dateStyle) {
      intlOptions.dateStyle = options.dateStyle;
    }
    if (options.timeStyle) {
      intlOptions.timeStyle = options.timeStyle;
    }
  }

  if (!usesFieldOptions && !intlOptions.dateStyle && !intlOptions.timeStyle) {
    applyPreset(intlOptions, date, options);
  }

  if (!usesFieldOptions && !intlOptions.dateStyle && !intlOptions.timeStyle) {
    intlOptions.dateStyle = 'medium';
  }

  return { type: 'intl', options: intlOptions };
}

function applyPreset(
  intlOptions: Intl.DateTimeFormatOptions,
  date: Date,
  options: FormatDateTimeOptions,
): void {
  const effectivePreset = options.size || options.preset;
  if (!effectivePreset) {
    return;
  }

  switch (effectivePreset) {
    case 'tiny': {
      const reference = options.now ?? new Date();
      if (isSameCalendarDay(date, reference, options.timeZone)) {
        intlOptions.timeStyle = 'short';
      } else {
        intlOptions.month = 'numeric';
        intlOptions.day = 'numeric';
      }
      break;
    }
    case 'short':
      intlOptions.dateStyle = 'short';
      break;
    case 'medium':
      intlOptions.dateStyle = 'medium';
      break;
    case 'long':
      intlOptions.dateStyle = 'long';
      break;
    default:
      break;
  }
}

function formatSpecialKinds(
  date: Date,
  options: FormatDateTimeOptions,
): string {
  if (options.kind === 'week') {
    return formatWeek(date, options);
  }

  if (options.kind === 'quarter') {
    return formatQuarter(date, options);
  }

  return '';
}

function formatWeek(date: Date, options: FormatDateTimeOptions): string {
  const { week, year } = getISOWeekInfo(date, options.timeZone);
  const locale = options.locale ?? 'en-US';
  const numberFormat = new Intl.NumberFormat(locale, {
    numberingSystem: options.numberingSystem,
    useGrouping: false,
  });
  const weekNumber = numberFormat.format(week);

  if (options.weekFormat === 'label') {
    const label = getDateTimeFieldLabel(locale, 'week');
    const yearLabel = new Intl.NumberFormat(locale, {
      numberingSystem: options.numberingSystem,
      useGrouping: false,
    }).format(year);
    return `${label} ${weekNumber}, ${yearLabel}`;
  }

  return `${year}-W${week.toString().padStart(2, '0')}`;
}

function formatQuarter(date: Date, options: FormatDateTimeOptions): string {
  const parts = getZonedDateParts(date, options.timeZone);
  const quarter = Math.floor((parts.month - 1) / 3) + 1;
  const locale = options.locale ?? 'en-US';
  const yearLabel = new Intl.NumberFormat(locale, {
    numberingSystem: options.numberingSystem,
    useGrouping: false,
  }).format(parts.year);

  if (options.quarterFormat === 'long') {
    const label = getDateTimeFieldLabel(locale, 'quarter');
    const quarterNumber = new Intl.NumberFormat(locale, {
      numberingSystem: options.numberingSystem,
      useGrouping: false,
    }).format(quarter);
    return `${label} ${quarterNumber}, ${yearLabel}`;
  }

  const quarterLabel = new Intl.NumberFormat(locale, {
    numberingSystem: options.numberingSystem,
    useGrouping: false,
  }).format(quarter);

  return `Q${quarterLabel} ${yearLabel}`;
}

function getDateTimeFieldLabel(
  locale: string,
  field: 'week' | 'quarter',
): string {
  if (typeof Intl.DisplayNames !== 'function') {
    return field;
  }

  try {
    const displayNames = new Intl.DisplayNames([locale], {
      type: 'dateTimeField',
    });
    return displayNames.of(field) ?? field;
  } catch {
    return field;
  }
}

type FormatDateTimeHelperSignature = {
  Args: {
    Named: FormatDateTimeOptions;
    Positional: [DateLike | null | undefined];
  };
  Return: string;
};

type FormatDateTimeHelper = HelperLike<FormatDateTimeHelperSignature> &
  ((
    value: DateLike | null | undefined,
    options?: FormatDateTimeOptions,
  ) => string);

export const formatDateTime = formatDateTimeInternal as FormatDateTimeHelper;

export default formatDateTime;
