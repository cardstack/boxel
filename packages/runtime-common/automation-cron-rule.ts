// The rule an automation's cron trigger must meet: a valid expression that
// fires at most once every `MIN_CRON_INTERVAL_MINUTES`, in the trigger's time
// zone. The server reads every declaration with it, and the automation card's
// editor checks each expression with it as the author types, through the
// host's shim of `@cardstack/runtime-common/automation-cron-rule`. So an
// expression the editor accepts is one the server accepts.
//
// It depends only on `automation-schedule.ts` and `Intl`, so the host can
// serve it to a card without the rest of the declaration reader.

import {
  cronExpressionError,
  isValidTimeZone,
  parseCronExpression,
  type CronSchedule,
} from './automation-schedule.ts';

// A cron trigger may fire at most once every this many minutes.
export const MIN_CRON_INTERVAL_MINUTES = 5;

const DAY_MINUTES = 24 * 60;

export interface CronTriggerProblem {
  // `invalid-cron`: the expression doesn't parse, or names no day that ever
  // happens. `cron-too-frequent`: the trigger can fire more often than once
  // every `MIN_CRON_INTERVAL_MINUTES`.
  code: 'invalid-cron' | 'cron-too-frequent';
  message: string;
}

// What's wrong with a cron trigger's expression, as a code and a message for
// the person editing the card, or undefined when nothing is. A `timeZone`
// that `isValidTimeZone` refuses is ignored here, and the trigger's time zone
// is reported on its own; without one only the wall-clock spacing is checked.
export function cronTriggerProblem(
  expression: string,
  timeZone?: string,
): CronTriggerProblem | undefined {
  let error = cronExpressionError(expression);
  if (error) {
    return { code: 'invalid-cron', message: error };
  }
  let zone =
    timeZone !== undefined && isValidTimeZone(timeZone) ? timeZone : undefined;
  let frequency = cronFrequencyError(expression, zone);
  if (frequency) {
    return { code: 'cron-too-frequent', message: frequency };
  }
  return undefined;
}

// Whether a cron expression, in a time zone, can fire more often than once
// every `MIN_CRON_INTERVAL_MINUTES`, as a message, or undefined when it can't.
// Expects an expression `parseCronExpression` accepts and, when given, a time
// zone `isValidTimeZone` accepts.
//
// It reads the parsed minute, hour and day sets rather than sampling fire
// times. Two times on the same day are as far apart as their wall-clock
// minutes. The last time of one day and the first of the next are compared
// only when two consecutive days can both match.
//
// A daylight-saving change can bring two times closer, so each change the
// zone makes is applied to the days around it that the schedule matches, the
// way `automation-schedule.ts` fires them:
// - the clocks skip wall times, so the times either side of the gap are the
//   gap's length closer than on the wall clock. A wall-clock expression fires
//   a skipped time as far past the change as it was into the gap (02:58 fires
//   at 03:58, 3 minutes before 04:01, on a day 02:00 jumps to 03:00); an
//   expression that follows elapsed time doesn't fire it (00:58 and 02:00 are
//   2 minutes apart on a day 01:00 jumps to 02:00).
// - the clocks repeat wall times, and an expression that follows elapsed time
//   fires them twice, so the last of the first pass and the first of the
//   second can be close (02:58 and the repeated 02:01 are 3 minutes apart on a
//   day 03:00 falls back to 02:00).
// A change's window can cross midnight, so the next day's times are placed
// around it too, when the schedule matches that day.
// Without a time zone only the wall-clock spacing is checked.
export function cronFrequencyError(
  expression: string,
  timeZone?: string,
): string | undefined {
  let schedule = parseCronExpression(expression);
  let times: number[] = [];
  for (let hour of schedule.hours) {
    for (let minute of schedule.minutes) {
      times.push(hour * 60 + minute);
    }
  }
  times.sort((a, b) => a - b);
  let closest = closestGap(times);
  let acrossMidnight = times[0] + DAY_MINUTES - times[times.length - 1];
  if (
    acrossMidnight < MIN_CRON_INTERVAL_MINUTES &&
    consecutiveDaysCanMatch(schedule)
  ) {
    closest = Math.min(closest, acrossMidnight);
  }
  if (timeZone !== undefined && closest >= MIN_CRON_INTERVAL_MINUTES) {
    // A change's effect depends only on its shape and on which days around it
    // the schedule matches, which most of a zone's changes share.
    let checked = new Set<string>();
    for (let change of clockChanges(timeZone)) {
      let days = [-1, 0, 1, 2].map((offset) =>
        dayNumberMatches(schedule, change.day + offset) ? 1 : 0,
      );
      let key = `${change.kind}:${change.start}:${change.length}:${days.join('')}`;
      if (!checked.has(key)) {
        checked.add(key);
        closest = Math.min(closest, closestGapAround(schedule, times, change));
      }
    }
  }
  if (closest < MIN_CRON_INTERVAL_MINUTES) {
    return `"${expression}" can fire twice ${closest} minute${closest === 1 ? '' : 's'} apart, and Boxel runs an automation's cron trigger at most once every ${MIN_CRON_INTERVAL_MINUTES} minutes`;
  }
  return undefined;
}

// The smallest gap between distinct times in a sorted list. Two times at the
// same instant fire once, so a gap of 0 is no gap.
function closestGap(sorted: number[]): number {
  let closest = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    let gap = sorted[i] - sorted[i - 1];
    if (gap > 0) {
      closest = Math.min(closest, gap);
    }
  }
  return closest;
}

// The closest two fire times on the days around a clock change, from the day
// before it starts to the day after it ends. Each matching day's times are
// placed in elapsed minutes from the start of the change's day, on its clock
// before the change.
function closestGapAround(
  schedule: CronSchedule,
  times: number[],
  change: ClockChange,
): number {
  let gapEnd = change.start + change.length;
  // The change touches only its own day's times and, when its window crosses
  // midnight, the next day's. A schedule that matches neither isn't moved.
  let touched = gapEnd > DAY_MINUTES ? [0, 1] : [0];
  if (
    !touched.some((offset) => dayNumberMatches(schedule, change.day + offset))
  ) {
    return Infinity;
  }
  let fires: number[] = [];
  for (let offset = -1; offset <= 2; offset++) {
    if (!dayNumberMatches(schedule, change.day + offset)) {
      continue;
    }
    for (let t of times) {
      let wall = offset * DAY_MINUTES + t;
      if (wall < change.start) {
        fires.push(wall);
      } else if (wall >= gapEnd) {
        fires.push(
          change.kind === 'skip' ? wall - change.length : wall + change.length,
        );
      } else if (change.kind === 'skip') {
        // A skipped time fires as far past the change as it was into the gap,
        // which is the same instant on the clock before it; an expression that
        // follows elapsed time doesn't fire it.
        if (!schedule.followsElapsedTime) {
          fires.push(wall);
        }
      } else {
        // A repeated time fires on its first pass, and an expression that
        // follows elapsed time fires it again on the second.
        fires.push(wall);
        if (schedule.followsElapsedTime) {
          fires.push(wall + change.length);
        }
      }
    }
  }
  return closestGap(fires.sort((a, b) => a - b));
}

interface ClockChange {
  // `skip`: the clocks jump forward over these wall times. `repeat`: the
  // clocks fall back and these wall times happen twice.
  kind: 'skip' | 'repeat';
  // The local day the affected wall times start on, as days since
  // 1970-01-01.
  day: number;
  // Minute of that day the affected wall times start at.
  start: number;
  // Minutes.
  length: number;
}

// The window the zone's clock changes are read from. Rules change rarely, and
// a zone's recent and coming changes are the ones an automation meets.
const CLOCK_CHANGE_FROM = Date.UTC(2020, 0, 1);
const CLOCK_CHANGE_TO = Date.UTC(2060, 0, 1);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = DAY_MINUTES * MINUTE_MS;
const clockChangeCache = new Map<string, ClockChange[]>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

// The daylight-saving (or other offset) changes a zone makes, each with the
// local day it falls on and the wall times it skips or repeats. A zone changes
// its offset at most a few times a year, so weekly samples find every change,
// and a search to the minute finds when it happens.
function clockChanges(timeZone: string): ClockChange[] {
  let cached = clockChangeCache.get(timeZone);
  if (cached) {
    return cached;
  }
  let changes: ClockChange[] = [];
  let previousMs = CLOCK_CHANGE_FROM;
  let previousOffset = offsetMinutes(timeZone, previousMs);
  for (let ms = previousMs + WEEK_MS; ms <= CLOCK_CHANGE_TO; ms += WEEK_MS) {
    let offset = offsetMinutes(timeZone, ms);
    if (offset !== previousOffset) {
      let low = previousMs;
      let high = ms;
      while (high - low > MINUTE_MS) {
        let mid = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS;
        if (offsetMinutes(timeZone, mid) === previousOffset) {
          low = mid;
        } else {
          high = mid;
        }
      }
      let before = offsetMinutes(timeZone, low);
      let after = offsetMinutes(timeZone, high);
      let kind: ClockChange['kind'] = after > before ? 'skip' : 'repeat';
      // Skipped wall times start at the old offset's wall clock; repeated ones
      // at the new offset's.
      let wallStart = high + (kind === 'skip' ? before : after) * MINUTE_MS;
      changes.push({
        kind,
        day: Math.floor(wallStart / DAY_MS),
        start: Math.floor(wallStart / MINUTE_MS) % DAY_MINUTES,
        length: Math.abs(after - before),
      });
    }
    previousMs = ms;
    previousOffset = offset;
  }
  clockChangeCache.set(timeZone, changes);
  return changes;
}

// The zone's offset from UTC at an instant, in minutes.
function offsetMinutes(timeZone: string, ms: number): number {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    offsetFormatters.set(timeZone, formatter);
  }
  let parts: Record<string, number> = {};
  for (let part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  let wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return Math.round((wall - (ms - (ms % MINUTE_MS))) / MINUTE_MS);
}

// Whether two consecutive days can both match depends only on the parsed day
// and month sets, and `parseCronExpression` caches the parsed schedule, so the
// answer is kept per schedule.
const consecutiveDaysCache = new WeakMap<CronSchedule, boolean>();

// The Gregorian calendar repeats every 400 years, so whether any two
// consecutive days both match is settled by one 400-year cycle. Unrestricted
// day fields match every day of an allowed month, and every month has
// consecutive days, which settles it without the scan.
function consecutiveDaysCanMatch(schedule: CronSchedule): boolean {
  if (!schedule.daysOfMonthRestricted && !schedule.daysOfWeekRestricted) {
    return true;
  }
  let cached = consecutiveDaysCache.get(schedule);
  if (cached !== undefined) {
    return cached;
  }
  let start = Date.UTC(2000, 0, 1) / DAY_MS;
  let end = Date.UTC(2400, 0, 2) / DAY_MS;
  let previous = false;
  let result = false;
  for (let day = start; day < end; day++) {
    let matches = dayNumberMatches(schedule, day);
    if (matches && previous) {
      result = true;
      break;
    }
    previous = matches;
  }
  consecutiveDaysCache.set(schedule, result);
  return result;
}

// Whether the schedule matches a calendar day, given as days since
// 1970-01-01.
function dayNumberMatches(schedule: CronSchedule, day: number): boolean {
  let date = new Date(day * DAY_MS);
  return dayMatches(
    schedule,
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCDay(),
  );
}

function dayMatches(
  schedule: CronSchedule,
  month: number,
  dayOfMonth: number,
  dayOfWeek: number,
): boolean {
  if (!schedule.months.has(month)) {
    return false;
  }
  let domMatches = schedule.daysOfMonth.has(dayOfMonth);
  let dowMatches = schedule.daysOfWeek.has(dayOfWeek);
  if (schedule.daysOfMonthRestricted && schedule.daysOfWeekRestricted) {
    return domMatches || dowMatches;
  }
  return domMatches && dowMatches;
}
