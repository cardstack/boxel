// When an automation runs next, and which of its triggers are spent.
//
// Pure functions over an automation's triggers and the per-trigger run
// counts the server keeps. Every instant in and out is UTC unix seconds; a
// trigger's time zone is used only to work out which instants its cron
// expression names, so "daily at 05:30" stays at 05:30 local time across
// daylight-saving changes. No dependencies beyond `Intl`, so the realm
// server, the worker and the host (the card's view) all share it.
//
// Daylight-saving rules, matching Vixie cron for fixed-hour schedules and
// RFC 5545 for times that don't exist:
//
// * A fixed-hour expression (any hour field that doesn't start with `*`)
//   names a wall-clock time. When the clocks go forward past it, it fires at
//   the same distance past the change (02:30 in a 02:00→03:00 gap fires at
//   03:30). When the clocks go back and the time happens twice, it fires
//   once, at the first.
// * An hourly-style expression (hour field `*` or `*/n`) follows elapsed
//   time. A wall time inside a forward gap didn't happen and is skipped; a
//   wall time that happens twice fires twice.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Feb 29 can be eight years from the next one (2096 → 2104), so any
// satisfiable expression fires within nine years of any instant.
const SEARCH_HORIZON_DAYS = 366 * 9;

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
  // Hour field starts with `*`: the schedule follows elapsed time across
  // daylight-saving changes rather than a wall-clock time.
  readonly hourly: boolean;
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
  // Runs this trigger has started. A trigger that joined a run already
  // pending didn't start one and isn't counted.
  runs: number;
  // Unix seconds: the scheduled instant (slot) of the last run this trigger
  // started.
  lastSlot?: number;
}

export interface ScheduleInput {
  triggers: readonly AutomationTrigger[];
  // Unix seconds. Only instants after this are scheduled: the moment the
  // automation was switched on (or resumed).
  since: number;
  // Keyed by trigger label, so editing a trigger's other fields keeps its
  // count, and a renamed label starts a new one.
  runState?: Readonly<Record<string, TriggerRunState | undefined>>;
}

export interface TriggerSchedule {
  label: string;
  kind: AutomationTrigger['kind'];
  // A spent trigger never fires again. Webhook triggers are never spent.
  spent: boolean;
  // Unix seconds; absent for a spent trigger and for a webhook trigger.
  nextRun?: number;
  // Runs still to come, for a bounded trigger: a `once` trigger, or a cron
  // trigger with `until` or `count`. Absent for an unbounded cron trigger
  // and for a webhook trigger.
  remainingRuns?: number;
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
  // done, because a delivery can always arrive.
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
  let label = trigger.label;
  let state = input.runState?.[label];
  let runs = state?.runs ?? 0;
  // A trigger never fires at or before its own last slot, so a slot that
  // came due but wasn't enqueued yet stays due however late the next
  // recompute happens.
  let cursor = Math.max(input.since, state?.lastSlot ?? -Infinity);

  switch (trigger.kind) {
    case 'webhook':
      return { label, kind: 'webhook', spent: false };

    case 'once': {
      let spent = runs >= 1 || trigger.at <= cursor;
      return spent
        ? { label, kind: 'once', spent, remainingRuns: 0 }
        : { label, kind: 'once', spent, nextRun: trigger.at, remainingRuns: 1 };
    }

    case 'cron': {
      let { expression, timeZone, until, count } = trigger;
      let bounded = until !== undefined || count !== undefined;
      let left = count === undefined ? undefined : Math.max(0, count - runs);
      let next =
        left === 0 ? undefined : nextCronTime(expression, timeZone, cursor);
      if (next !== undefined && until !== undefined && next > until) {
        next = undefined;
      }
      let result: TriggerSchedule = {
        label,
        kind: 'cron',
        spent: next === undefined,
      };
      if (next !== undefined) {
        result.nextRun = next;
      }
      if (until !== undefined) {
        result.until = until;
      }
      if (bounded) {
        if (next === undefined) {
          result.remainingRuns = 0;
        } else if (until === undefined) {
          result.remainingRuns = left;
        } else {
          result.remainingRuns = countCronTimes(
            expression,
            timeZone,
            cursor,
            until,
            left,
          );
        }
      }
      return result;
    }
  }
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

// The longest each month can be, Feb 29 included.
const MONTH_MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Expressions come from cards, so the cache is bounded.
const PARSED_CACHE_LIMIT = 1000;
const parsedCache = new Map<string, CronSchedule>();

// Five fields (minute, hour, day of month, month, day of week) with `*`,
// lists, ranges, steps, and month and day names, or one of the `@hourly` …
// `@yearly` macros. Throws `CronExpressionError` for anything else, and for
// an expression that names no day that exists (`0 0 30 2 *`).
export function parseCronExpression(expression: string): CronSchedule {
  let cached = parsedCache.get(expression);
  if (cached) {
    return cached;
  }
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
    hourly: parts[1].startsWith('*'),
  };
  if (schedule.daysOfMonthRestricted && !schedule.daysOfWeekRestricted) {
    let someDayExists = [...months].some((m) =>
      [...daysOfMonth].some((d) => d <= MONTH_MAX_DAYS[m - 1]),
    );
    if (!someDayExists) {
      throw new CronExpressionError(
        `"${expression}" names no day that exists in its months, so it never fires`,
      );
    }
  }
  if (parsedCache.size >= PARSED_CACHE_LIMIT) {
    parsedCache.clear();
  }
  parsedCache.set(expression, schedule);
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
        if (!schedule.hourly) {
          // Forward gap: the same distance past the change.
          instants.push(wall - before);
        }
      } else if (named.length === 2 && !schedule.hourly) {
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
  // Start a day early: a fixed-hour time in a forward gap late on the
  // previous local day can resolve past `after`.
  let first = localDayOf(timeZone, afterMs) - 1;
  let boundaryOffsets = new Map<number, number>();
  for (let day = first; day <= first + SEARCH_HORIZON_DAYS; day++) {
    let found = firesOnDay(schedule, timeZone, day, boundaryOffsets).find(
      (t) => t > afterMs,
    );
    if (found !== undefined) {
      // A gap at midnight can push this day's last time past the next
      // day's first.
      let following = firesOnDay(
        schedule,
        timeZone,
        day + 1,
        boundaryOffsets,
      ).find((t) => t > afterMs);
      let next =
        following !== undefined && following < found ? following : found;
      return next / 1000;
    }
  }
  return undefined;
}

// How many instants in (after, until] the expression names in the zone,
// stopping early once `limit` is reached.
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
  for (let day = first; day <= last; day++) {
    for (let t of firesOnDay(schedule, timeZone, day, boundaryOffsets)) {
      if (t > afterMs && t <= untilMs) {
        count++;
        if (count >= limit) {
          return count;
        }
      }
    }
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
