import { parseExcelNumber } from './common.ts';
import { EXCEL_ERROR, throwExcelError } from './errors.ts';
import { isoWeekNumber } from './isoWeek.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// A date string denotes a calendar day only when it names no zone at all, and
// only then may its civil fields be re-anchored to UTC. Spotting every way a
// zone can be written is a losing game — `Z`, `+05:30`, `GMT`, `EST`,
// `Europe/Paris` — and missing one silently reintroduces host dependence, so
// recognize the zone-less civil forms instead and leave anything else as the
// instant the parser produced. Covers `4/30/2026`, `2026/04/30`,
// `30-Apr-2026`, `April 30, 2026`, each with an optional time of day.
const ZONELESS_CIVIL_DATE =
  /^\s*(?:[A-Za-z]{3,},? )?(?:\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\d{1,2}[ -][A-Za-z]{3,}\.?[ -]\d{2,4}|[A-Za-z]{3,}\.? ?\d{1,2},? ?\d{2,4})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?: ?[AaPp]\.?[Mm]\.?)?)?\s*$/;
const WEEKEND_TYPES: Record<number, number[]> = {
  1: [0, 6],
  2: [0, 1],
  3: [1, 2],
  4: [2, 3],
  5: [3, 4],
  6: [4, 5],
  7: [5, 6],
  11: [0],
  12: [1],
  13: [2],
  14: [3],
  15: [4],
  16: [5],
  17: [6],
};

function utcDate(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
) {
  return new Date(
    Date.UTC(year, month, day, hours, minutes, seconds, milliseconds),
  );
}

export function serialToExcelDate(serial: number): Date {
  if (!Number.isFinite(serial)) {
    throwExcelError(EXCEL_ERROR.num);
  }

  let adjustedSerial = serial;
  if (adjustedSerial < 60) {
    adjustedSerial += 1;
  }

  const utcDays = Math.floor(adjustedSerial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = adjustedSerial - Math.floor(adjustedSerial) + 0.0000001;

  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  let days = dateInfo.getUTCDate();
  let month = dateInfo.getUTCMonth();

  if (serial >= 60 && serial < 61) {
    days = 29;
    month = 1;
  }

  return utcDate(
    dateInfo.getUTCFullYear(),
    month,
    days,
    hours,
    minutes,
    seconds,
  );
}

export function excelDateToSerial(date: Date): number {
  const d1900 = utcDate(1900, 0, 1).getTime();
  const addOn = date.getTime() > Date.UTC(1900, 1, 28) ? 2 : 1;
  return Math.ceil((date.getTime() - d1900) / MS_PER_DAY) + addOn;
}

export function parseExcelDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  if (typeof value === 'number') {
    if (value < 0 || value >= 2958466) {
      throwExcelError(EXCEL_ERROR.num);
    }
    return serialToExcelDate(value);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) {
      return parseExcelDate(numeric);
    }

    if (/^\d{4}-\d\d?-\d\d?$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    } else {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        // A date string naming no zone denotes a calendar day, not an
        // instant, but the runtime resolves it against the host zone. Read
        // back the civil fields it produced and re-anchor them to UTC, so
        // the serial names the same day wherever the expression runs.
        return ZONELESS_CIVIL_DATE.test(value)
          ? utcDate(
              parsed.getFullYear(),
              parsed.getMonth(),
              parsed.getDate(),
              parsed.getHours(),
              parsed.getMinutes(),
              parsed.getSeconds(),
              parsed.getMilliseconds(),
            )
          : parsed;
      }
    }
  }

  throwExcelError(EXCEL_ERROR.value);
}

export function parseExcelDateArray(value: unknown): Date[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => parseExcelDate(entry));
}

export function buildExcelDate(
  yearValue: number,
  monthValue: number,
  dayValue: number,
): number {
  const year = Math.trunc(yearValue);
  const month = Math.trunc(monthValue);
  const day = Math.trunc(dayValue);
  return excelDateToSerial(utcDate(year, month - 1, day));
}

export function excelYear(dateLike: unknown): number {
  return parseExcelDate(dateLike).getUTCFullYear();
}

export function excelMonth(dateLike: unknown): number {
  return parseExcelDate(dateLike).getUTCMonth() + 1;
}

export function excelDay(dateLike: unknown): number {
  return parseExcelDate(dateLike).getUTCDate();
}

export function daysBetween(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function isLeapYear(year: number) {
  return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
}

export function yearFrac(
  startLike: unknown,
  endLike: unknown,
  basisValue = 0,
): number {
  const startDate = parseExcelDate(startLike);
  const endDate = parseExcelDate(endLike);
  const basis = Math.trunc(Number(basisValue) || 0);

  let sd = startDate.getUTCDate();
  const sm = startDate.getUTCMonth() + 1;
  const sy = startDate.getUTCFullYear();
  let ed = endDate.getUTCDate();
  const em = endDate.getUTCMonth() + 1;
  const ey = endDate.getUTCFullYear();

  switch (basis) {
    case 0:
      if (sd === 31 && ed === 31) {
        sd = 30;
        ed = 30;
      } else if (sd === 31) {
        sd = 30;
      } else if (sd === 30 && ed === 31) {
        ed = 30;
      }
      return (ed + em * 30 + ey * 360 - (sd + sm * 30 + sy * 360)) / 360;
    case 1: {
      const feb29Between = (date1: Date, date2: Date) => {
        const year1 = date1.getUTCFullYear();
        const mar1year1 = utcDate(year1, 2, 1);

        if (isLeapYear(year1) && date1 < mar1year1 && date2 >= mar1year1) {
          return true;
        }

        const year2 = date2.getUTCFullYear();
        const mar1year2 = utcDate(year2, 2, 1);
        return isLeapYear(year2) && date2 >= mar1year2 && date1 < mar1year2;
      };

      let yearLength = 365;

      if (
        sy === ey ||
        (sy + 1 === ey && (sm > em || (sm === em && sd >= ed)))
      ) {
        if (
          (sy === ey && isLeapYear(sy)) ||
          feb29Between(startDate, endDate) ||
          (em === 1 && ed === 29)
        ) {
          yearLength = 366;
        }

        return daysBetween(startDate, endDate) / yearLength;
      }

      const years = ey - sy + 1;
      const days =
        (utcDate(ey + 1, 0, 1).getTime() - utcDate(sy, 0, 1).getTime()) /
        MS_PER_DAY;
      const average = days / years;
      return daysBetween(startDate, endDate) / average;
    }
    case 2:
      return daysBetween(startDate, endDate) / 360;
    case 3:
      return daysBetween(startDate, endDate) / 365;
    case 4:
      return (ed + em * 30 + ey * 360 - (sd + sm * 30 + sy * 360)) / 360;
    default:
      throwExcelError(EXCEL_ERROR.num);
  }
}

// ═══════════════════════════════════════════════════════════════
// Date helper functions
// ═══════════════════════════════════════════════════════════════

export function excelDatedif(
  startLike: unknown,
  endLike: unknown,
  unitLike: unknown,
) {
  const start = parseExcelDate(startLike);
  const end = parseExcelDate(endLike);
  const unit = String(unitLike).toUpperCase();
  if (end < start) throwExcelError(EXCEL_ERROR.num);

  const sy = start.getUTCFullYear(),
    sm = start.getUTCMonth(),
    sd = start.getUTCDate();
  const ey = end.getUTCFullYear(),
    em = end.getUTCMonth(),
    ed = end.getUTCDate();

  switch (unit) {
    case 'Y': {
      let years = ey - sy;
      if (em < sm || (em === sm && ed < sd)) years--;
      return years;
    }
    case 'M': {
      let months = (ey - sy) * 12 + (em - sm);
      if (ed < sd) months--;
      return months;
    }
    case 'D':
      return daysBetween(start, end);
    case 'MD':
      return ed >= sd
        ? ed - sd
        : new Date(Date.UTC(ey, em, 0)).getUTCDate() - sd + ed;
    case 'YM': {
      let m = em - sm;
      if (ed < sd) m--;
      return m < 0 ? m + 12 : m;
    }
    case 'YD': {
      const anniv = utcDate(ey, sm, sd);
      if (anniv <= end) return daysBetween(anniv, end);
      const prevAnniv = utcDate(ey - 1, sm, sd);
      return daysBetween(prevAnniv, end);
    }
    default:
      throwExcelError(EXCEL_ERROR.num);
  }
}

export function excelDatevalue(textLike: unknown) {
  const text = String(textLike);
  const date = parseExcelDate(text);
  // Return just the date serial (no time component)
  return excelDateToSerial(
    utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * The days from `start` to `end` on a 30/360 schedule, where every month is 30
 * days long and every year 360. The calendar reaches the count only through the
 * day numbers the two dates carry.
 *
 * A day-31 start always reads as the 30th. `bothEnds` decides the other end:
 * pulled back unconditionally, the count becomes a function of each date on its
 * own and so additive across any split, which is the European 30/360 and how a
 * schedule's own periods are sized. Left conditional — the end moves only once
 * the start has landed on the 30th — the count reads the two ends together and
 * need not be additive: a span between two month ends can come to 178 or 183
 * days where two clean months give 180. That is the US/NASD reading, and what
 * `DAYS360`'s default method counts.
 *
 * Neither reading carries the last-day-of-February clauses Microsoft documents,
 * which pull a February month end back to the 30th as well.
 */
export function days360(start: Date, end: Date, bothEnds: boolean): number {
  let startDay = start.getUTCDate();
  const startMonth = start.getUTCMonth() + 1;
  const startYear = start.getUTCFullYear();
  let endDay = end.getUTCDate();
  const endMonth = end.getUTCMonth() + 1;
  const endYear = end.getUTCFullYear();

  if (startDay === 31) startDay = 30;
  if (endDay === 31 && (bothEnds || startDay >= 30)) endDay = 30;

  return (
    (endYear - startYear) * 360 +
    (endMonth - startMonth) * 30 +
    (endDay - startDay)
  );
}

export function excelDays360(
  startLike: unknown,
  endLike: unknown,
  methodLike: unknown = false,
) {
  return days360(
    parseExcelDate(startLike),
    parseExcelDate(endLike),
    Boolean(methodLike),
  );
}

export function excelWeeknum(serialLike: unknown, returnTypeLike: unknown = 1) {
  const date = parseExcelDate(serialLike);
  // Not `Number(x) || 1`: that reads 0 and a non-numeric argument as the
  // default rather than as the errors they are, which would slip past the
  // return-type check below.
  const returnType = Math.floor(parseExcelNumber(returnTypeLike));
  // Return type 21 asks for the ISO week, which numbers from the week holding
  // the year's first Thursday rather than from the week holding January 1st.
  if (returnType === 21) {
    return isoWeekNumber(date);
  }
  // Every other return type says which weekday opens the week: 1 opens it on
  // Sunday, 2 and 11 on Monday, then 12 through 17 walk the start forward a
  // day at a time, back around to Sunday.
  const firstDay =
    returnType === 1
      ? 0
      : returnType === 2 || returnType === 11
        ? 1
        : returnType >= 12 && returnType <= 17
          ? (returnType - 10) % 7
          : undefined;
  if (firstDay === undefined) {
    throwExcelError(EXCEL_ERROR.num);
  }
  const jan1 = utcDate(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / MS_PER_DAY);
  const startOffset = (jan1.getUTCDay() - firstDay + 7) % 7;
  return Math.floor((dayOfYear + startOffset) / 7) + 1;
}

function isWeekend(date: Date) {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

function weekendDays(weekendLike: unknown = 1) {
  if (typeof weekendLike === 'string') {
    if (!/^[01]{7}$/.test(weekendLike) || weekendLike === '1111111') {
      throwExcelError(EXCEL_ERROR.value);
    }

    const maskIndex = [1, 2, 3, 4, 5, 6, 0];
    return new Set(
      weekendLike
        .split('')
        .flatMap((entry, index) => (entry === '1' ? [maskIndex[index]!] : [])),
    );
  }

  const weekendType = Math.trunc(parseExcelNumber(weekendLike));
  const days = WEEKEND_TYPES[weekendType];
  if (!days) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return new Set(days);
}

function holidaySerials(holidaysLike?: unknown) {
  const holidays = new Set<number>();
  if (holidaysLike === undefined) {
    return holidays;
  }

  for (const holiday of parseExcelDateArray(holidaysLike)) {
    holidays.add(excelDateToSerial(holiday));
  }
  return holidays;
}

function isWeekendIntl(date: Date, weekends: Set<number>) {
  return weekends.has(date.getUTCDay());
}

export function excelNetworkdays(
  startLike: unknown,
  endLike: unknown,
  holidaysLike?: unknown,
) {
  const start = parseExcelDate(startLike);
  const end = parseExcelDate(endLike);
  const holidays = holidaySerials(holidaysLike);

  const sign = end >= start ? 1 : -1;
  const s = sign === 1 ? start : end;
  const e = sign === 1 ? end : start;
  let count = 0;
  const current = new Date(s.getTime());
  while (current <= e) {
    if (!isWeekend(current) && !holidays.has(excelDateToSerial(current))) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return sign * count;
}

export function excelWorkday(
  startLike: unknown,
  daysLike: unknown,
  holidaysLike?: unknown,
) {
  const start = parseExcelDate(startLike);
  let days = Math.trunc(parseExcelNumber(daysLike));
  const holidays = holidaySerials(holidaysLike);

  const sign = days >= 0 ? 1 : -1;
  days = Math.abs(days);
  const current = new Date(start.getTime());
  let counted = 0;
  while (counted < days) {
    current.setUTCDate(current.getUTCDate() + sign);
    if (!isWeekend(current) && !holidays.has(excelDateToSerial(current))) {
      counted++;
    }
  }
  return excelDateToSerial(current);
}

export function excelNetworkdaysIntl(
  startLike: unknown,
  endLike: unknown,
  weekendLike: unknown = 1,
  holidaysLike?: unknown,
) {
  const start = parseExcelDate(startLike);
  const end = parseExcelDate(endLike);
  const weekends = weekendDays(weekendLike);
  const holidays = holidaySerials(holidaysLike);

  const sign = end >= start ? 1 : -1;
  const s = sign === 1 ? start : end;
  const e = sign === 1 ? end : start;
  let count = 0;
  const current = new Date(s.getTime());
  while (current <= e) {
    if (
      !isWeekendIntl(current, weekends) &&
      !holidays.has(excelDateToSerial(current))
    ) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return sign * count;
}

export function excelWorkdayIntl(
  startLike: unknown,
  daysLike: unknown,
  weekendLike: unknown = 1,
  holidaysLike?: unknown,
) {
  const start = parseExcelDate(startLike);
  let days = Math.trunc(parseExcelNumber(daysLike));
  const weekends = weekendDays(weekendLike);
  const holidays = holidaySerials(holidaysLike);

  const sign = days >= 0 ? 1 : -1;
  days = Math.abs(days);
  const current = new Date(start.getTime());
  let counted = 0;
  while (counted < days) {
    current.setUTCDate(current.getUTCDate() + sign);
    if (
      !isWeekendIntl(current, weekends) &&
      !holidays.has(excelDateToSerial(current))
    ) {
      counted++;
    }
  }
  return excelDateToSerial(current);
}
