// When an automation runs next, and which of its triggers are spent.
//
// Pure functions over an automation's triggers and the per-trigger run
// counts the server keeps. Every instant in and out is UTC unix seconds; a
// trigger's time zone is used only to work out which instants its cron
// expression names, so "daily at 05:30" stays at 05:30 local time across
// daylight-saving changes. No dependencies beyond `Intl`, so the realm
// server, the worker and the host (the card's view) all share it.
//
// Daylight-saving rules, which split expressions the way Vixie cron does and
// place times that don't exist the way RFC 5545 does:
//
// * A wall-clock expression (neither the minute nor the hour field starts
//   with `*`) names a time of day. When the clocks go forward past it, it
//   fires at the same distance past the change (02:30 in a 02:00→03:00 gap
//   fires at 03:30). When the clocks go back and the time happens twice, it
//   fires once, at the first.
// * An elapsed-time expression (the minute or the hour field starts with
//   `*`) follows elapsed time. A wall time inside a forward gap didn't happen
//   and is skipped; a wall time that happens twice fires twice.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The Gregorian calendar, weekdays included, repeats every 400 years. An
// expression that matches no day in one cycle never fires, and parsing
// rejects it, so any parsed expression fires within one cycle of any instant.
const GREGORIAN_CYCLE_DAYS = 146_097;
const SEARCH_HORIZON_DAYS = GREGORIAN_CYCLE_DAYS + 2;

// Runs left is counted at most this far, and at most this far ahead, so a
// distant `until` costs a bounded amount of work. A count that reaches
// either bound is reported as a lower bound.
export const REMAINING_RUNS_LIMIT = 10_000;
const REMAINING_RUNS_HORIZON_SECONDS = 100 * 366 * 24 * 60 * 60;

export class CronExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronExpressionError';
  }
}

export interface CronSchedule {
  readonly expression: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  // 0 is Sunday; a 7 in the expression is folded into 0.
  readonly daysOfWeek: ReadonlySet<number>;
  // When both day fields are restricted, a day matches if EITHER does
  // (Vixie cron); otherwise both must match. A field is restricted when it
  // doesn't start with `*`.
  readonly daysOfMonthRestricted: boolean;
  readonly daysOfWeekRestricted: boolean;
  // The minute or the hour field starts with `*`: the schedule follows
  // elapsed time across daylight-saving changes rather than naming a time of
  // day.
  readonly followsElapsedTime: boolean;
}

export interface CronTrigger {
  kind: 'cron';
  // Unique within the automation.
  label: string;
  expression: string;
  timeZone: string;
  // Unix seconds. The trigger fires at instants at or before this, never
  // after.
  until?: number;
  // The most runs the trigger starts.
  count?: number;
}

export interface OnceTrigger {
  kind: 'once';
  // Unique within the automation.
  label: string;
  // Unix seconds. `zonedDateTimeToUnixSeconds` turns the card's date, time
  // and time zone into this.
  at: number;
}

export interface WebhookTrigger {
  kind: 'webhook';
  // Unique within the automation.
  label: string;
}

export type AutomationTrigger = CronTrigger | OnceTrigger | WebhookTrigger;

export interface TriggerRunState {
  // Runs this trigger has started. A slot that joined a run already pending
  // didn't start one and isn't counted.
  runs: number;
  // Unix seconds: the last slot (scheduled instant) handled for this
  // trigger, whether it started a run or joined one already pending. The
  // trigger is never scheduled at or before it.
  lastSlot?: number;
  // Unix seconds: when this trigger's timing (expression, time zone, `at`,
  // `until`) last changed. The trigger is never scheduled at or before it,
  // so an edit doesn't make a slot that already passed due.
  since?: number;
}

export interface ScheduleInput {
  triggers: readonly AutomationTrigger[];
  // Unix seconds. Only instants after this are scheduled: the moment the
  // automation was switched on (or resumed).
  since: number;
  // Unix seconds: the current time. When given, a cron trigger with several
  // slots already past its cursor collapses them into one make-up run at the
  // latest of them, so an outage costs at most one late run per trigger.
  // Without it every slot after the cursor is scheduled in turn.
  now?: number;
  // Count runs left for bounded triggers. It scans up to `until`, so callers
  // that only need the next run leave it off.
  includeRemainingRuns?: boolean;
  // Keyed by trigger label, so editing a trigger's other fields keeps its
  // count, and a renamed label starts a new one.
  runState?: Readonly<Record<string, TriggerRunState | undefined>>;
}

export interface TriggerSchedule {
  label: string;
  kind: AutomationTrigger['kind'];
  // A spent trigger never fires again. Webhook triggers are never spent, and
  // neither is a trigger with an `error`.
  spent: boolean;
  // Why the trigger can't be scheduled: an invalid expression or time zone.
  // The other triggers are scheduled regardless.
  error?: string;
  // Unix seconds; absent for a spent trigger, a webhook trigger and a
  // trigger with an `error`. At or before `now` when the trigger is due (or
  // owes a make-up run).
  nextRun?: number;
  // With `includeRemainingRuns`, runs still to come for a bounded trigger: a
  // `once` trigger, or a cron trigger with `until` or `count`, the next run
  // included. Absent for an unbounded cron trigger and a webhook trigger.
  remainingRuns?: number;
  // `remainingRuns` hit `REMAINING_RUNS_LIMIT` or the counting horizon, so
  // there are at least that many.
  remainingRunsAtLeast?: boolean;
  // A cron trigger's `until`, when it has one.
  until?: number;
}

export interface AutomationSchedule {
  // Unix seconds: the earliest next run across unspent cron and once
  // triggers. Absent when none is left.
  nextRun?: number;
  // Labels of the triggers that fire at `nextRun`. Each starts its own run.
  dueTriggers: string[];
  // Every trigger is spent. An automation with a webhook trigger is never
  // done, because a delivery can always arrive, and neither is one with a
  // trigger in error.
  done: boolean;
  triggers: TriggerSchedule[];
}

export function computeAutomationSchedule(
  input: ScheduleInput,
): AutomationSchedule {
  let triggers = input.triggers.map((trigger) =>
    scheduleTrigger(trigger, input),
  );
  let nextRun: number | undefined;
  for (let t of triggers) {
    if (
      t.nextRun !== undefined &&
      (nextRun === undefined || t.nextRun < nextRun)
    ) {
      nextRun = t.nextRun;
    }
  }
  return {
    nextRun,
    dueTriggers:
      nextRun === undefined
        ? []
        : triggers.filter((t) => t.nextRun === nextRun).map((t) => t.label),
    done: triggers.every((t) => t.spent),
    triggers,
  };
}

function scheduleTrigger(
  trigger: AutomationTrigger,
  input: ScheduleInput,
): TriggerSchedule {
  let { label, kind } = trigger;
  let state = input.runState?.[label];
  // A trigger is scheduled strictly after its cursor, never after the
  // current time, so a slot that came due but wasn't enqueued yet stays due
  // however late the next recompute happens.
  let cursor = Math.max(
    input.since,
    state?.since ?? -Infinity,
    state?.lastSlot ?? -Infinity,
  );

  switch (trigger.kind) {
    case 'webhook':
      return { label, kind, spent: false };

    case 'once': {
      // Spent once its time is behind the cursor: it ran (its slot is the
      // last one handled), or it was set before the automation was switched
      // on or the trigger was edited. Editing it to a later time re-arms it.
      let spent = trigger.at <= cursor;
      let result: TriggerSchedule = { label, kind, spent };
      if (!spent) {
        result.nextRun = trigger.at;
      }
      if (input.includeRemainingRuns) {
        result.remainingRuns = spent ? 0 : 1;
      }
      return result;
    }

    case 'cron':
      try {
        return scheduleCronTrigger(trigger, state?.runs ?? 0, cursor, input);
      } catch (e) {
        if (e instanceof CronExpressionError || e instanceof RangeError) {
          return { label, kind, spent: false, error: e.message };
        }
        throw e;
      }
  }
}

function scheduleCronTrigger(
  trigger: CronTrigger,
  runs: number,
  cursor: number,
  input: ScheduleInput,
): TriggerSchedule {
  let { label, kind, timeZone, until, count } = trigger;
  let schedule = parseCronExpression(trigger.expression);
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`"${timeZone}" isn't a time zone this runtime knows`);
  }
  let left = count === undefined ? undefined : Math.max(0, count - runs);
  let next = left === 0 ? undefined : nextCronTime(schedule, timeZone, cursor);
  if (next !== undefined && until !== undefined && next > until) {
    next = undefined;
  }
  if (next !== undefined && input.now !== undefined && next <= input.now) {
    // Every slot that already passed collapses into one make-up run at the
    // latest of them, counted as one run.
    next =
      lastCronTime(
        schedule,
        timeZone,
        cursor,
        Math.min(input.now, until ?? Infinity),
      ) ?? next;
  }
  let result: TriggerSchedule = { label, kind, spent: next === undefined };
  if (next !== undefined) {
    result.nextRun = next;
  }
  if (until !== undefined) {
    result.until = until;
  }
  if (
    input.includeRemainingRuns &&
    (until !== undefined || left !== undefined)
  ) {
    if (next === undefined) {
      result.remainingRuns = 0;
    } else if (until === undefined) {
      result.remainingRuns = left;
    } else {
      // From the next run (inclusive) to `until`, within the bounds.
      let limit = Math.min(left ?? Infinity, REMAINING_RUNS_LIMIT);
      let horizon = next + REMAINING_RUNS_HORIZON_SECONDS;
      let counted = countCronTimes(
        schedule,
        timeZone,
        next - 1,
        Math.min(until, horizon),
        limit,
      );
      result.remainingRuns = counted;
      if (
        (counted >= REMAINING_RUNS_LIMIT && (left ?? Infinity) > counted) ||
        (until > horizon && counted < (left ?? Infinity))
      ) {
        result.remainingRunsAtLeast = true;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cron expressions

const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
  // The value of `names[0]`.
  namesBase?: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTH_NAMES, namesBase: 1 },
  { name: 'day-of-week', min: 0, max: 7, names: DAY_NAMES, namesBase: 0 },
];

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

// Expressions come from cards, so the cache is bounded. It holds the error
// message for an invalid expression too, so a validator or recompute that
// meets the same bad expression again doesn't repeat the work.
const PARSED_CACHE_LIMIT = 1000;
const parsedCache = new Map<string, CronSchedule | string>();

// Five fields (minute, hour, day of month, month, day of week) with `*`,
// lists, ranges, steps, and month and day names, or one of the `@hourly` …
// `@yearly` macros. Throws `CronExpressionError` for anything else, and for
// an expression that names no day that ever happens (`0 0 30 2 *`).
export function parseCronExpression(expression: string): CronSchedule {
  let cached = parsedCache.get(expression);
  if (typeof cached === 'string') {
    throw new CronExpressionError(cached);
  }
  if (cached) {
    return cached;
  }
  let result: CronSchedule | string;
  try {
    result = parseUncached(expression);
  } catch (e) {
    if (!(e instanceof CronExpressionError)) {
      throw e;
    }
    result = e.message;
  }
  if (typeof expression === 'string') {
    if (parsedCache.size >= PARSED_CACHE_LIMIT) {
      parsedCache.clear();
    }
    parsedCache.set(expression, result);
  }
  if (typeof result === 'string') {
    throw new CronExpressionError(result);
  }
  return result;
}

function parseUncached(expression: string): CronSchedule {
  if (typeof expression !== 'string') {
    throw new CronExpressionError('A cron expression must be a string');
  }
  let source = expression.trim();
  let expanded = MACROS[source.toLowerCase()] ?? source;
  if (expanded.startsWith('@')) {
    throw new CronExpressionError(
      `"${expression}" is not a supported cron macro (use one of ${Object.keys(MACROS).join(', ')})`,
    );
  }
  let parts = expanded.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    throw new CronExpressionError(
      `"${expression}" has ${parts.length} field${parts.length === 1 ? '' : 's'}; a cron expression has five: minute, hour, day of month, month and day of week`,
    );
  }
  let [minutes, hours, daysOfMonth, months, daysOfWeekRaw] = parts.map(
    (part, i) => parseField(expression, part, FIELDS[i]),
  );
  let daysOfWeek = new Set([...daysOfWeekRaw].map((d) => (d === 7 ? 0 : d)));
  let schedule: CronSchedule = {
    expression,
    minutes: [...minutes].sort((a, b) => a - b),
    hours: [...hours].sort((a, b) => a - b),
    daysOfMonth,
    months,
    daysOfWeek,
    daysOfMonthRestricted: !parts[2].startsWith('*'),
    daysOfWeekRestricted: !parts[4].startsWith('*'),
    followsElapsedTime: parts[0].startsWith('*') || parts[1].startsWith('*'),
  };
  // Most expressions match within the first few days of the cycle, so this
  // only scans far for one that matches rarely or never.
  let someDayMatches = false;
  for (let day = 0; day < GREGORIAN_CYCLE_DAYS && !someDayMatches; day++) {
    someDayMatches = dayMatches(schedule, day);
  }
  if (!someDayMatches) {
    throw new CronExpressionError(
      `"${expression}" names no day that ever happens, so it never fires`,
    );
  }
  return schedule;
}

// The problem with an expression, or undefined when it's valid. For
// validators that report rather than throw.
export function cronExpressionError(expression: string): string | undefined {
  try {
    parseCronExpression(expression);
    return undefined;
  } catch (e) {
    if (e instanceof CronExpressionError) {
      return e.message;
    }
    throw e;
  }
}

function parseField(
  expression: string,
  text: string,
  spec: FieldSpec,
): Set<number> {
  let fail = (why: string): never => {
    throw new CronExpressionError(
      `"${expression}": the ${spec.name} field "${text}" ${why}`,
    );
  };
  let values = new Set<number>();
  for (let item of text.split(',')) {
    if (item === '') {
      fail('has an empty list item');
    }
    let slash = item.split('/');
    if (slash.length > 2) {
      fail('has more than one "/"');
    }
    let [rangeText, stepText] = slash;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) {
        fail(`has a step "${stepText}" that isn't a positive whole number`);
      }
      step = Number(stepText);
    }
    let start: number;
    let end: number;
    if (rangeText === '*') {
      start = spec.min;
      end = spec.max;
    } else if (rangeText.includes('-')) {
      let bounds = rangeText.split('-');
      if (bounds.length !== 2) {
        fail(`has a malformed range "${rangeText}"`);
      }
      start = parseValue(bounds[0], spec, fail);
      end = parseValue(bounds[1], spec, fail);
      if (spec.name === 'day-of-week' && end === 0 && start > 0) {
        // Sunday ends a range as 7, as in Vixie cron: `FRI-SUN`.
        end = 7;
      }
      if (start > end) {
        fail(`has a range "${rangeText}" that runs backwards`);
      }
    } else {
      start = parseValue(rangeText, spec, fail);
      end = stepText === undefined ? start : spec.max;
    }
    for (let v = start; v <= end; v += step) {
      values.add(v);
    }
  }
  return values;
}

function parseValue(
  text: string,
  spec: FieldSpec,
  fail: (why: string) => never,
): number {
  let value: number | undefined;
  if (/^\d+$/.test(text)) {
    value = Number(text);
  } else if (spec.names) {
    let index = spec.names.indexOf(text.toUpperCase());
    if (index >= 0) {
      value = index + (spec.namesBase ?? 0);
    }
  }
  if (value === undefined) {
    return fail(
      `has "${text}", which isn't a number${spec.names ? ' or a name' : ''}`,
    );
  }
  if (value < spec.min || value > spec.max) {
    return fail(`has ${value}, outside ${spec.min}–${spec.max}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Time zones

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    if (typeof timeZone !== 'string' || timeZone === '') {
      throw new RangeError('A time zone must be a non-empty IANA name');
    }
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

// An IANA time zone name the runtime knows, such as `America/Chicago` or
// `UTC`.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

// The zone's UTC offset at an instant, in ms (local = utc + offset).
function offsetAt(timeZone: string, ms: number): number {
  let fields: Record<string, number> = {};
  for (let part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') {
      fields[part.type] = Number(part.value);
    }
  }
  let wall = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour === 24 ? 0 : fields.hour,
    fields.minute,
    fields.second,
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

// The instants a wall-clock time (expressed as ms as though it were UTC)
// names in a zone, given the offsets in force on either side of it: none in
// a forward gap, two when the clocks go back over it, otherwise one.
function instantsOf(
  timeZone: string,
  wall: number,
  offsetBefore: number,
  offsetAfter: number,
): number[] {
  if (offsetBefore === offsetAfter) {
    return [wall - offsetBefore];
  }
  let instants: number[] = [];
  for (let offset of [offsetBefore, offsetAfter]) {
    let instant = wall - offset;
    if (offsetAt(timeZone, instant) === offset) {
      instants.push(instant);
    }
  }
  return instants.sort((a, b) => a - b);
}

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// A wall-clock date and time (`2026-11-09T15:00`, seconds optional) in a
// zone, as unix seconds. A time skipped by a forward change resolves to the
// same distance past the change; a time that happens twice resolves to the
// first.
export function zonedDateTimeToUnixSeconds(
  localDateTime: string,
  timeZone: string,
): number {
  let match = LOCAL_DATE_TIME.exec(localDateTime);
  if (!match) {
    throw new RangeError(
      `"${localDateTime}" isn't a local date and time like 2026-11-09T15:00`,
    );
  }
  let [year, month, day, hour, minute, second = 0] = match
    .slice(1)
    .map((v) => (v === undefined ? 0 : Number(v)));
  let wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new RangeError(`"${localDateTime}" isn't a real date and time`);
  }
  let before = offsetAt(timeZone, wall - DAY_MS);
  let after = offsetAt(timeZone, wall + DAY_MS);
  let instants = instantsOf(timeZone, wall, before, after);
  let instant = instants.length ? instants[0] : wall - before;
  return instant / 1000;
}

// ---------------------------------------------------------------------------
// Cron times in a zone

function localDayOf(timeZone: string, ms: number): number {
  return Math.floor((ms + offsetAt(timeZone, ms)) / DAY_MS);
}

function dayMatches(schedule: CronSchedule, day: number): boolean {
  let date = new Date(day * DAY_MS);
  if (!schedule.months.has(date.getUTCMonth() + 1)) {
    return false;
  }
  let dom = schedule.daysOfMonth.has(date.getUTCDate());
  let dow = schedule.daysOfWeek.has(date.getUTCDay());
  return schedule.daysOfMonthRestricted && schedule.daysOfWeekRestricted
    ? dom || dow
    : dom && dow;
}

// Every instant (ms, ascending) the schedule names on one local calendar
// day, given as days since 1970-01-01.
function firesOnDay(
  schedule: CronSchedule,
  timeZone: string,
  day: number,
  boundaryOffsets = new Map<number, number>(),
): number[] {
  if (!dayMatches(schedule, day)) {
    return [];
  }
  let dayStart = day * DAY_MS;
  // Sampled a full day outside the local day on each side, which clears
  // every real UTC offset; a single transition in between shows as a
  // difference. Samples sit on day boundaries, so a scan over consecutive
  // days shares them through `boundaryOffsets`.
  let sample = (boundary: number) => {
    let offset = boundaryOffsets.get(boundary);
    if (offset === undefined) {
      offset = offsetAt(timeZone, boundary * DAY_MS);
      boundaryOffsets.set(boundary, offset);
    }
    return offset;
  };
  let before = sample(day - 1);
  let after = sample(day + 2);
  let instants: number[] = [];
  for (let hour of schedule.hours) {
    for (let minute of schedule.minutes) {
      let wall = dayStart + hour * HOUR_MS + minute * MINUTE_MS;
      let named = instantsOf(timeZone, wall, before, after);
      if (named.length === 0) {
        if (!schedule.followsElapsedTime) {
          // Forward gap: the same distance past the change.
          instants.push(wall - before);
        }
      } else if (named.length === 2 && !schedule.followsElapsedTime) {
        instants.push(named[0]);
      } else {
        instants.push(...named);
      }
    }
  }
  if (before !== after) {
    instants.sort((a, b) => a - b);
    instants = instants.filter((t, i) => i === 0 || t !== instants[i - 1]);
  }
  return instants;
}

function resolveSchedule(expression: string | CronSchedule): CronSchedule {
  return typeof expression === 'string'
    ? parseCronExpression(expression)
    : expression;
}

// The first instant after `after` (unix seconds) the expression names in the
// zone, as unix seconds.
export function nextCronTime(
  expression: string | CronSchedule,
  timeZone: string,
  after: number,
): number | undefined {
  let schedule = resolveSchedule(expression);
  let afterMs = after * 1000;
  let boundaryOffsets = new Map<number, number>();
  let earliest = (day: number) => {
    let found = firesOnDay(schedule, timeZone, day, boundaryOffsets).find(
      (t) => t > afterMs,
    );
    return found ?? Infinity;
  };
  // A wall-clock time in a forward gap resolves past the gap, which can carry
  // it past the start of the next local day (America/Nuuk's gap runs from
  // 23:00 to midnight). So the scan starts a day before `after`'s local day,
  // and the first day with a time is compared with the day after it.
  let first = localDayOf(timeZone, afterMs) - 1;
  for (let day = first; day <= first + SEARCH_HORIZON_DAYS; day++) {
    let found = earliest(day);
    if (found !== Infinity) {
      return Math.min(found, earliest(day + 1)) / 1000;
    }
  }
  return undefined;
}

// The latest instant in (after, atOrBefore] (unix seconds) the expression
// names in the zone, as unix seconds.
export function lastCronTime(
  expression: string | CronSchedule,
  timeZone: string,
  after: number,
  atOrBefore: number,
): number | undefined {
  let schedule = resolveSchedule(expression);
  let afterMs = after * 1000;
  let atOrBeforeMs = atOrBefore * 1000;
  if (atOrBeforeMs <= afterMs) {
    return undefined;
  }
  let boundaryOffsets = new Map<number, number>();
  let latest = (day: number) => {
    let inRange = firesOnDay(schedule, timeZone, day, boundaryOffsets).filter(
      (t) => t > afterMs && t <= atOrBeforeMs,
    );
    return inRange.length ? inRange[inRange.length - 1] : -Infinity;
  };
  // Mirrors `nextCronTime`: a gap can carry the previous day's last time
  // past this day's first.
  let first = localDayOf(timeZone, atOrBeforeMs) + 1;
  let last = Math.max(
    localDayOf(timeZone, afterMs) - 1,
    first - SEARCH_HORIZON_DAYS,
  );
  for (let day = first; day >= last; day--) {
    let found = latest(day);
    if (found !== -Infinity) {
      return Math.max(found, latest(day - 1)) / 1000;
    }
  }
  return undefined;
}

// How many instants in (after, until] the expression names in the zone,
// stopping early once `limit` is reached. It scans every day in the range.
export function countCronTimes(
  expression: string | CronSchedule,
  timeZone: string,
  after: number,
  until: number,
  limit = Infinity,
): number {
  let schedule = resolveSchedule(expression);
  let afterMs = after * 1000;
  let untilMs = until * 1000;
  if (untilMs <= afterMs || limit <= 0) {
    return 0;
  }
  let first = localDayOf(timeZone, afterMs) - 1;
  let last = localDayOf(timeZone, untilMs) + 1;
  let count = 0;
  let boundaryOffsets = new Map<number, number>();
  // A time resolved past a gap at midnight can coincide with the next day's
  // first time, so each day skips what the day before already counted.
  let previous = new Set<number>();
  for (let day = first; day <= last; day++) {
    let fires = firesOnDay(schedule, timeZone, day, boundaryOffsets);
    for (let t of fires) {
      if (t > afterMs && t <= untilMs && !previous.has(t)) {
        count++;
        if (count >= limit) {
          return count;
        }
      }
    }
    previous = new Set(fires);
  }
  return count;
}

// The next `limit` instants after `after` (unix seconds), ascending.
export function nextCronTimes(
  expression: string | CronSchedule,
  timeZone: string,
  after: number,
  limit: number,
): number[] {
  let schedule = resolveSchedule(expression);
  let times: number[] = [];
  let cursor = after;
  while (times.length < limit) {
    let next = nextCronTime(schedule, timeZone, cursor);
    if (next === undefined) {
      break;
    }
    times.push(next);
    cursor = next;
  }
  return times;
}
