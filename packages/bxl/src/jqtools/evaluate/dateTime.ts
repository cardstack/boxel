import { JqArgumentError } from '../errors.js';

type TimeMode = 'utc' | 'local';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3));

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAY_ABBREVIATIONS = WEEKDAY_NAMES.map((name) => name.slice(0, 3));

function pad(value: number, width = 2): string {
  return Math.trunc(value).toString().padStart(width, '0');
}

function fractionalSeconds(epochSeconds: number): number {
  return epochSeconds - Math.floor(epochSeconds);
}

function makeDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  mode: TimeMode,
): Date {
  const date = new Date(0);
  if (mode === 'utc') {
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(hour, minute, second, millisecond);
  } else {
    date.setFullYear(year, month, day);
    date.setHours(hour, minute, second, millisecond);
  }
  return date;
}

function dayOfYear(date: Date, mode: TimeMode): number {
  const year = mode === 'utc' ? date.getUTCFullYear() : date.getFullYear();
  const start = makeDate(year, 0, 1, 0, 0, 0, 0, mode);
  return Math.floor((date.getTime() - start.getTime()) / 86400000);
}

function localOffsetMinutes(date: Date): number {
  return -date.getTimezoneOffset();
}

function localZoneName(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
    }).formatToParts(date);
    return (
      parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC'
    );
  } catch (_error) {
    return 'UTC';
  }
}

function offsetToString(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${pad(hours)}${pad(minutes)}`;
}

function assertFiniteDate(date: Date, label: string) {
  if (!Number.isFinite(date.getTime())) {
    throw new JqArgumentError(`Invalid epoch value for ${label}`);
  }
}

function normalizeBrokenDownInput(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new JqArgumentError('Expected an array');
  }

  const values = new Array<number>(8).fill(0);
  for (let index = 0; index < Math.min(input.length, 8); index++) {
    const value = input[index];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new JqArgumentError('Expected numeric parsed datetime values');
    }
    values[index] = value;
  }
  return values;
}

function brokenDownFromDate(
  date: Date,
  epochSeconds: number,
  mode: TimeMode,
): number[] {
  assertFiniteDate(date, mode === 'utc' ? 'strftime' : 'strflocaltime');

  const year = mode === 'utc' ? date.getUTCFullYear() : date.getFullYear();
  const month = mode === 'utc' ? date.getUTCMonth() : date.getMonth();
  const day = mode === 'utc' ? date.getUTCDate() : date.getDate();
  const hour = mode === 'utc' ? date.getUTCHours() : date.getHours();
  const minute = mode === 'utc' ? date.getUTCMinutes() : date.getMinutes();
  const secondWhole =
    mode === 'utc' ? date.getUTCSeconds() : date.getSeconds();
  const weekday = mode === 'utc' ? date.getUTCDay() : date.getDay();
  const yearDay = dayOfYear(date, mode);

  return [
    year,
    month,
    day,
    hour,
    minute,
    secondWhole + fractionalSeconds(epochSeconds),
    weekday,
    yearDay,
  ];
}

function brokenDownToDate(input: unknown, mode: TimeMode): Date {
  const values = normalizeBrokenDownInput(input);
  const year = values[0];
  const month = values[1];
  const day = values[2];
  const hour = values[3];
  const minute = values[4];
  const second = Math.trunc(values[5]);
  return makeDate(year, month, day, hour, minute, second, 0, mode);
}

function applyDirective(
  directive: string,
  date: Date,
  mode: TimeMode,
  epochSeconds: number,
): string {
  const parts = brokenDownFromDate(date, epochSeconds, mode);
  const [year, month, day, hour, minute, second, weekday, yearDay] = parts;

  switch (directive) {
    case '%':
      return '%';
    case 'Y':
      return pad(year, 4);
    case 'm':
      return pad(month + 1);
    case 'd':
      return pad(day);
    case 'e':
      return `${day}`.padStart(2, ' ');
    case 'H':
      return pad(hour);
    case 'M':
      return pad(minute);
    case 'S':
      return pad(Math.trunc(second));
    case 'I': {
      const clock = hour % 12 || 12;
      return pad(clock);
    }
    case 'p':
      return hour < 12 ? 'AM' : 'PM';
    case 'a':
      return WEEKDAY_ABBREVIATIONS[weekday]!;
    case 'A':
      return WEEKDAY_NAMES[weekday]!;
    case 'b':
    case 'h':
      return MONTH_ABBREVIATIONS[month]!;
    case 'B':
      return MONTH_NAMES[month]!;
    case 'w':
      return `${weekday}`;
    case 'u':
      return `${weekday === 0 ? 7 : weekday}`;
    case 'j':
      return pad(yearDay + 1, 3);
    case 'F':
      return `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}`;
    case 'R':
      return `${pad(hour)}:${pad(minute)}`;
    case 'T':
      return `${pad(hour)}:${pad(minute)}:${pad(Math.trunc(second))}`;
    case 'r': {
      const clock = hour % 12 || 12;
      const meridiem = hour < 12 ? 'AM' : 'PM';
      return `${pad(clock)}:${pad(minute)}:${pad(Math.trunc(second))} ${meridiem}`;
    }
    case 'z':
      return mode === 'utc'
        ? '+0000'
        : offsetToString(localOffsetMinutes(date));
    case 'Z':
      return mode === 'utc' ? 'UTC' : localZoneName(date);
    default:
      throw new JqArgumentError(`Unsupported strftime format directive: %${directive}`);
  }
}

function readNumber(
  input: string,
  start: number,
  minDigits: number,
  maxDigits: number,
): { value: number; nextIndex: number } {
  let end = start;
  while (end < input.length && /\d/.test(input[end]!) && end - start < maxDigits) {
    end += 1;
  }
  if (end - start < minDigits) {
    throw new JqArgumentError('Unexpected numeric field while parsing datetime');
  }
  return {
    value: Number(input.slice(start, end)),
    nextIndex: end,
  };
}

function readName(
  input: string,
  start: number,
  candidates: string[],
): { value: number; nextIndex: number } {
  const lowerInput = input.slice(start).toLowerCase();
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    if (lowerInput.startsWith(candidate.toLowerCase())) {
      return {
        value: index,
        nextIndex: start + candidate.length,
      };
    }
  }
  throw new JqArgumentError('Unexpected named field while parsing datetime');
}

export function gmtime(epochSeconds: number): number[] {
  const date = new Date(epochSeconds * 1000);
  assertFiniteDate(date, 'gmtime');
  return brokenDownFromDate(date, epochSeconds, 'utc');
}

export function localtime(epochSeconds: number): number[] {
  const date = new Date(epochSeconds * 1000);
  assertFiniteDate(date, 'localtime');
  return brokenDownFromDate(date, epochSeconds, 'local');
}

export function mktime(input: unknown): number {
  const values = normalizeBrokenDownInput(input);
  const date = brokenDownToDate(values, 'utc');
  assertFiniteDate(date, 'mktime');
  return Math.floor(date.getTime() / 1000);
}

export function strftime(input: unknown, format: string, mode: TimeMode): string {
  let date: Date;
  let epochSeconds = 0;

  if (typeof input === 'number') {
    epochSeconds = input;
    date = new Date(input * 1000);
  } else {
    date = brokenDownToDate(input, mode);
    epochSeconds = date.getTime() / 1000;
  }

  assertFiniteDate(date, mode === 'utc' ? 'strftime' : 'strflocaltime');

  let output = '';
  for (let index = 0; index < format.length; index++) {
    const char = format[index]!;
    if (char !== '%') {
      output += char;
      continue;
    }

    index += 1;
    if (index >= format.length) {
      throw new JqArgumentError('Trailing % in strftime format');
    }
    output += applyDirective(format[index]!, date, mode, epochSeconds);
  }

  return output;
}

export function strptime(input: string, format: string): unknown[] {
  const fields: {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    second?: number;
    weekday?: number;
    yearDay?: number;
    offsetMinutes?: number;
  } = {};

  let inputIndex = 0;

  function consumeWhitespace() {
    while (inputIndex < input.length && /\s/.test(input[inputIndex]!)) {
      inputIndex += 1;
    }
  }

  for (let formatIndex = 0; formatIndex < format.length; formatIndex++) {
    const char = format[formatIndex]!;

    if (char === '%') {
      formatIndex += 1;
      if (formatIndex >= format.length) {
        throw new JqArgumentError('Trailing % in strptime format');
      }

      const directive = format[formatIndex]!;
      switch (directive) {
        case '%':
          if (input[inputIndex] !== '%') {
            throw new JqArgumentError('Literal % did not match input');
          }
          inputIndex += 1;
          break;
        case 'Y': {
          const parsed = readNumber(input, inputIndex, 1, 4);
          fields.year = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'm': {
          const parsed = readNumber(input, inputIndex, 1, 2);
          fields.month = parsed.value - 1;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'd':
        case 'e': {
          if (directive === 'e') consumeWhitespace();
          const parsed = readNumber(input, inputIndex, 1, 2);
          fields.day = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'H': {
          const parsed = readNumber(input, inputIndex, 1, 2);
          fields.hour = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'M': {
          const parsed = readNumber(input, inputIndex, 1, 2);
          fields.minute = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'S': {
          const match = /^(\d{1,2}(?:\.\d+)?)/.exec(input.slice(inputIndex));
          if (!match) {
            throw new JqArgumentError('Unexpected seconds field while parsing datetime');
          }
          fields.second = Number(match[1]);
          inputIndex += match[1]!.length;
          break;
        }
        case 'a': {
          const parsed = readName(input, inputIndex, WEEKDAY_ABBREVIATIONS);
          fields.weekday = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'A': {
          const parsed = readName(input, inputIndex, WEEKDAY_NAMES);
          fields.weekday = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'b':
        case 'h': {
          const parsed = readName(input, inputIndex, MONTH_ABBREVIATIONS);
          fields.month = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'B': {
          const parsed = readName(input, inputIndex, MONTH_NAMES);
          fields.month = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'w': {
          const parsed = readNumber(input, inputIndex, 1, 1);
          fields.weekday = parsed.value;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'u': {
          const parsed = readNumber(input, inputIndex, 1, 1);
          fields.weekday = parsed.value % 7;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'j': {
          const parsed = readNumber(input, inputIndex, 1, 3);
          fields.yearDay = parsed.value - 1;
          inputIndex = parsed.nextIndex;
          break;
        }
        case 'F': {
          const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})/.exec(
            input.slice(inputIndex),
          );
          if (!match) {
            throw new JqArgumentError('Failed to parse %F datetime fragment');
          }
          fields.year = Number(match[1]);
          fields.month = Number(match[2]) - 1;
          fields.day = Number(match[3]);
          inputIndex += match[0].length;
          break;
        }
        case 'T': {
          const match = /^(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/.exec(
            input.slice(inputIndex),
          );
          if (!match) {
            throw new JqArgumentError('Failed to parse %T datetime fragment');
          }
          fields.hour = Number(match[1]);
          fields.minute = Number(match[2]);
          fields.second = Number(match[3]);
          inputIndex += match[0].length;
          break;
        }
        case 'z': {
          const offsetMatch = /^(Z|[+-]\d{2}:?\d{2})/.exec(input.slice(inputIndex));
          if (!offsetMatch) {
            throw new JqArgumentError('Failed to parse %z timezone offset');
          }
          if (offsetMatch[1] === 'Z') {
            fields.offsetMinutes = 0;
          } else {
            const raw = offsetMatch[1]!.replace(':', '');
            const sign = raw.startsWith('-') ? -1 : 1;
            const hours = Number(raw.slice(1, 3));
            const minutes = Number(raw.slice(3, 5));
            fields.offsetMinutes = sign * (hours * 60 + minutes);
          }
          inputIndex += offsetMatch[0].length;
          break;
        }
        case 'Z': {
          const zoneMatch = /^(UTC|GMT|Z)/i.exec(input.slice(inputIndex));
          if (!zoneMatch) {
            throw new JqArgumentError('Failed to parse %Z timezone name');
          }
          fields.offsetMinutes = 0;
          inputIndex += zoneMatch[0].length;
          break;
        }
        default:
          throw new JqArgumentError(`Unsupported strptime format directive: %${directive}`);
      }
      continue;
    }

    if (/\s/.test(char)) {
      consumeWhitespace();
      continue;
    }

    if (input[inputIndex] !== char) {
      throw new JqArgumentError('Input did not match the strptime format literal');
    }
    inputIndex += 1;
  }

  const remainder = input.slice(inputIndex);
  if (/[^\s]/.test(remainder)) {
    throw new JqArgumentError(`date "${input}" does not match format "${format}"`);
  }

  let year = fields.year ?? 0;
  let month = fields.month ?? 0;
  let day = fields.day ?? 0;
  const hour = fields.hour ?? 0;
  const minute = fields.minute ?? 0;
  let second = fields.second ?? 0;

  if (
    fields.yearDay !== undefined &&
    fields.day === undefined &&
    fields.month === undefined
  ) {
    const yearStart = makeDate(year, 0, 1, 0, 0, 0, 0, 'utc');
    yearStart.setUTCDate(yearStart.getUTCDate() + fields.yearDay);
    month = yearStart.getUTCMonth();
    day = yearStart.getUTCDate();
  }

  if (fields.offsetMinutes !== undefined) {
    const wholeSeconds = Math.trunc(second);
    const fractional = second - wholeSeconds;
    const utcDate = makeDate(
      year,
      month,
      day,
      hour,
      minute,
      wholeSeconds,
      Math.round(fractional * 1000),
      'utc',
    );
    utcDate.setUTCMinutes(utcDate.getUTCMinutes() - fields.offsetMinutes);
    const normalized = brokenDownFromDate(
      utcDate,
      utcDate.getTime() / 1000,
      'utc',
    );
    year = normalized[0]!;
    month = normalized[1]!;
    day = normalized[2]!;
    second = normalized[5]!;
    return remainder.length > 0
      ? [...normalized, remainder]
      : normalized;
  }

  const date = makeDate(
    year,
    month,
    day,
    hour,
    minute,
    Math.trunc(second),
    0,
    'utc',
  );

  const output = [
    year,
    month,
    day,
    hour,
    minute,
    second,
    fields.weekday ?? date.getUTCDay(),
    fields.yearDay ?? dayOfYear(date, 'utc'),
  ];

  return remainder.length > 0 ? [...output, remainder] : output;
}
