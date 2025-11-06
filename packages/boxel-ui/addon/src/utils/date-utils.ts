const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type DateLike = Date | string | number;
export type DateUnit = 'ms' | 's';
export type SerialOrigin = 'excel1900' | 'excel1904';

export interface ParseDateOptions {
  serialOrigin?: SerialOrigin;
  unit?: DateUnit;
}

export interface ZonedDateParts {
  day: number;
  month: number;
  year: number;
}

export interface ISOWeekInfo {
  week: number;
  year: number;
}

export function parseDateValue(
  input: DateLike | null | undefined,
  options: ParseDateOptions = {},
): Date | null {
  if (input == null) {
    return null;
  }

  if (input instanceof Date) {
    return isFinite(input.getTime()) ? input : null;
  }

  if (typeof input === 'number') {
    const { serialOrigin, unit = 'ms' } = options;
    if (serialOrigin) {
      return parseExcelSerial(input, serialOrigin);
    }

    const factor = unit === 's' ? 1000 : 1;
    const candidate = new Date(input * factor);
    return isFinite(candidate.getTime()) ? candidate : null;
  }

  if (typeof input === 'string') {
    const candidate = new Date(input);
    return isFinite(candidate.getTime()) ? candidate : null;
  }

  return null;
}

export function isSameCalendarDay(
  a: Date,
  b: Date,
  timeZone?: string,
): boolean {
  const dateA = getZonedDateParts(a, timeZone);
  const dateB = getZonedDateParts(b, timeZone);

  return (
    dateA.year === dateB.year &&
    dateA.month === dateB.month &&
    dateA.day === dateB.day
  );
}

export function getZonedDateParts(
  date: Date,
  timeZone?: string,
): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const formatted = formatter.format(date);
  const [yearStr, monthStr, dayStr] = formatted.split('-');

  return {
    day: Number(dayStr),
    month: Number(monthStr),
    year: Number(yearStr),
  };
}

export function getISOWeekInfo(date: Date, timeZone?: string): ISOWeekInfo {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  const zonedDate = new Date(Date.UTC(year, month - 1, day));

  const zonedDay = zonedDate.getUTCDay() || 7;
  zonedDate.setUTCDate(zonedDate.getUTCDate() + 4 - zonedDay);
  const yearStart = new Date(Date.UTC(zonedDate.getUTCFullYear(), 0, 1));

  const diffDays =
    Math.floor((zonedDate.getTime() - yearStart.getTime()) / DAY_IN_MS) + 1;
  const week = Math.ceil(diffDays / 7);

  return {
    week,
    year: zonedDate.getUTCFullYear(),
  };
}

/**
 * Parses an Excel serial date number into a JavaScript Date
 * @param value - Excel serial date number
 * @param origin - The Excel date system to use (1900 or 1904)
 * @returns JavaScript Date object
 */
function parseExcelSerial(
  value: number,
  origin: 'excel1900' | 'excel1904',
): Date {
  if (origin === 'excel1900') {
    // Excel 1900 system: January 1, 1900 is day 1
    // Excel has a bug where it treats 1900 as a leap year
    // Adjust by one day to account for Excel's leap year bug
    const excel1900Base = new Date(1900, 0, 0); // Start from Dec 31, 1899
    return new Date(
      excel1900Base.getTime() + (value - 1) * 24 * 60 * 60 * 1000,
    );
  } else {
    // Excel 1904 system: January 1, 1904 is day 0
    const excel1904Base = new Date(1904, 0, 1);
    return new Date(excel1904Base.getTime() + value * 24 * 60 * 60 * 1000);
  }
}
