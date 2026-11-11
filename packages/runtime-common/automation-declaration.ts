import {
  cronExpressionError,
  isValidTimeZone,
  parseCronExpression,
  zonedDateTimeToUnixSeconds,
  type CronSchedule,
  type CronTrigger,
  type OnceTrigger,
  type WebhookTrigger,
} from './automation-schedule.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import { rri } from './realm-identifiers.ts';
import type { CardResource } from './resource-types.ts';

// The catalog's `Automation` card type. An automation's definition is an
// instance of it, or of a type that descends from it.
export const automationRef: ResolvedCodeRef = {
  module: rri('@cardstack/catalog/automation/automation'),
  name: 'Automation',
};

const DAY_MINUTES = 24 * 60;

// A cron trigger may fire at most once every this many minutes.
export const MIN_CRON_INTERVAL_MINUTES = 5;

// The most a run's `seconds` cap may be: 20 minutes.
export const MAX_RUN_SECONDS = 20 * 60;

// The time an `untilDate` with no `untilTime` stops at: the end of that day.
// Cron fires on whole minutes, so 23:59 inclusive is the whole day.
const END_OF_DAY = '23:59';

// What the reader needs from an automation's index row. `IndexedInstanceSource`
// has this shape.
export interface AutomationIndexEntry {
  // The card's URL.
  url: string;
  realmURL: string;
  // The adoption chain, each type as `internalKeyFor` spells it.
  types: readonly string[] | null;
  // The stored document, as the index holds it.
  instance: CardResource | null;
}

export interface ReadAutomationOptions {
  // `automationRef` as `internalKeyFor` spells it in the reading realm, the
  // spelling the index records adoption chains in.
  automationTypeKey: string;
}

// Values a trigger or the automation hands the script.
export type AutomationParams = Record<string, string>;

export type AutomationTriggerDeclaration =
  | (CronTrigger & { params: AutomationParams })
  | (OnceTrigger & { timeZone: string; params: AutomationParams })
  | (WebhookTrigger & { webhookPath: string; params: AutomationParams });

export interface AutomationOperationDeclaration {
  targetType: ResolvedCodeRef;
  operation: string;
}

export interface AutomationCaps {
  callApiCalls: number;
  responseBytes: number;
  resolveCalls: number;
  writes: number;
  seconds: number;
  monthlyCredits: number;
}

export const AUTOMATION_CAP_NAMES: readonly (keyof AutomationCaps)[] = [
  'callApiCalls',
  'responseBytes',
  'resolveCalls',
  'writes',
  'seconds',
  'monthlyCredits',
];

export interface AutomationDeclaration {
  url: string;
  realmURL: string;
  // The script file's absolute URL, inside `realmURL`.
  script: string;
  triggers: AutomationTriggerDeclaration[];
  operations: AutomationOperationDeclaration[];
  caps: AutomationCaps;
  params: AutomationParams;
  milestones: string[];
  batchedAI: boolean;
}

export type AutomationProblemCode =
  | 'not-an-automation'
  | 'not-indexed'
  | 'missing-script'
  | 'script-outside-realm'
  | 'invalid-trigger-kind'
  | 'missing-label'
  | 'duplicate-label'
  | 'invalid-cron'
  | 'cron-too-frequent'
  | 'missing-time-zone'
  | 'invalid-time-zone'
  | 'invalid-date-time'
  | 'invalid-count'
  | 'missing-webhook-path'
  | 'invalid-operation'
  | 'missing-cap'
  | 'invalid-cap'
  | 'seconds-cap-too-high'
  | 'invalid-param'
  | 'invalid-milestone';

export interface AutomationProblem {
  code: AutomationProblemCode;
  // Where in the card's attributes or relationships, such as
  // `triggers.0.expression` or `caps.seconds`.
  path: string;
  message: string;
}

export type AutomationReadResult =
  | { ok: true; declaration: AutomationDeclaration }
  | { ok: false; problems: AutomationProblem[] };

// Turns an automation's index row into the declaration a run reads, or reports
// every problem with it. It reads stored fields only and never throws for
// anything the card says.
export function readAutomationDeclaration(
  entry: AutomationIndexEntry,
  { automationTypeKey }: ReadAutomationOptions,
): AutomationReadResult {
  if (!entry.types?.includes(automationTypeKey)) {
    return refuse(
      'not-an-automation',
      '',
      `${entry.url} is not an instance of the catalog Automation card or of a type that descends from it`,
    );
  }
  if (!entry.instance) {
    return refuse(
      'not-indexed',
      '',
      `${entry.url} has no indexed document to read`,
    );
  }
  let problems: AutomationProblem[] = [];
  let report = (code: AutomationProblemCode, path: string, message: string) =>
    problems.push({ code, path, message });

  let attributes = entry.instance.attributes ?? {};
  let cardURL = entry.instance.id ?? entry.url;

  let script = readScript(entry, cardURL, report);
  let triggers = readTriggers(attributes.triggers, report);
  let operations = readOperations(attributes.operations, cardURL, report);
  let caps = readCaps(attributes.caps, report);
  let params = readParams(attributes.params, 'params', report);
  let milestones = readMilestones(attributes.milestones, report);

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    declaration: {
      url: entry.url,
      realmURL: entry.realmURL,
      script: script!,
      triggers,
      operations,
      caps: caps!,
      params,
      milestones,
      batchedAI: attributes.batchedAI === true,
    },
  };
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
// zone makes is applied to the day's times as `automation-schedule.ts` fires
// them:
// - a wall-clock expression's time that the clocks skip fires as far past the
//   change as it was into the gap, which can land it just before a later time
//   (02:58 and 04:01 are 3 minutes apart on a day 02:00 jumps to 03:00);
// - an expression that follows elapsed time fires the repeated wall times
//   twice, so the last of the first pass and the first of the second can be
//   close (02:58 and the repeated 02:01 are 3 minutes apart on a day 03:00
//   falls back to 02:00).
// A change's window can cross midnight, so a time it moves is compared with
// the next day's times too when two consecutive days can both match.
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
  let nextDayCanMatch = consecutiveDaysCanMatch(schedule);
  let closest = closestGap(times);
  let acrossMidnight = times[0] + DAY_MINUTES - times[times.length - 1];
  if (acrossMidnight < MIN_CRON_INTERVAL_MINUTES && nextDayCanMatch) {
    closest = Math.min(closest, acrossMidnight);
  }
  if (timeZone !== undefined) {
    for (let change of clockChanges(timeZone)) {
      // How far into the change's window a time is, wrapping at midnight.
      let into = (t: number) => (t - change.start + DAY_MINUTES) % DAY_MINUTES;
      if (change.kind === 'skip' && !schedule.followsElapsedTime) {
        let moved = times.map((t) =>
          into(t) < change.length ? t + change.length : t,
        );
        if (nextDayCanMatch) {
          moved.push(...times.map((t) => t + DAY_MINUTES));
        }
        closest = Math.min(closest, closestGap(moved.sort((a, b) => a - b)));
      } else if (change.kind === 'repeat' && schedule.followsElapsedTime) {
        let repeated = times
          .map(into)
          .filter((p) => p < change.length)
          .sort((a, b) => a - b);
        if (repeated.length > 1) {
          closest = Math.min(
            closest,
            repeated[0] + change.length - repeated[repeated.length - 1],
          );
        }
      }
    }
  }
  if (closest < MIN_CRON_INTERVAL_MINUTES) {
    return `"${expression}" can fire ${closest} minute${closest === 1 ? '' : 's'} apart; an automation's cron trigger fires at most once every ${MIN_CRON_INTERVAL_MINUTES} minutes`;
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

interface ClockChange {
  // `skip`: the clocks jump forward over these wall times. `repeat`: the
  // clocks fall back and these wall times happen twice.
  kind: 'skip' | 'repeat';
  // Minute of the day the affected wall times start at.
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
const clockChangeCache = new Map<string, ClockChange[]>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

// The distinct daylight-saving (or other offset) changes a zone makes, as the
// wall times each skips or repeats. A zone changes its offset at most a few
// times a year, so weekly samples find every change, and a search to the
// minute finds when it happens.
function clockChanges(timeZone: string): ClockChange[] {
  let cached = clockChangeCache.get(timeZone);
  if (cached) {
    return cached;
  }
  let changes = new Map<string, ClockChange>();
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
      let start = Math.floor(wallStart / MINUTE_MS) % DAY_MINUTES;
      let change = { kind, start, length: Math.abs(after - before) };
      changes.set(`${kind}:${start}:${change.length}`, change);
    }
    previousMs = ms;
    previousOffset = offset;
  }
  let result = [...changes.values()];
  clockChangeCache.set(timeZone, result);
  return result;
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

// The Gregorian calendar repeats every 400 years, so whether any two
// consecutive days both match is settled by one 400-year cycle. Unrestricted
// day fields match every day of an allowed month, and every month has
// consecutive days, which settles it without the scan.
function consecutiveDaysCanMatch(schedule: CronSchedule): boolean {
  if (!schedule.daysOfMonthRestricted && !schedule.daysOfWeekRestricted) {
    return true;
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  let start = Date.UTC(2000, 0, 1);
  let end = Date.UTC(2400, 0, 2);
  let previous = false;
  for (let ms = start; ms < end; ms += DAY_MS) {
    let day = new Date(ms);
    let matches = dayMatches(
      schedule,
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      day.getUTCDay(),
    );
    if (matches && previous) {
      return true;
    }
    previous = matches;
  }
  return false;
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

type Report = (
  code: AutomationProblemCode,
  path: string,
  message: string,
) => void;

function refuse(
  code: AutomationProblemCode,
  path: string,
  message: string,
): AutomationReadResult {
  return { ok: false, problems: [{ code, path, message }] };
}

function readScript(
  entry: AutomationIndexEntry,
  cardURL: string,
  report: Report,
): string | undefined {
  let relationship = entry.instance?.relationships?.script;
  let self = Array.isArray(relationship)
    ? undefined
    : relationship?.links?.self;
  if (typeof self !== 'string' || self === '') {
    report('missing-script', 'script', 'An automation must link its script');
    return undefined;
  }
  let scriptURL: URL;
  try {
    scriptURL = new URL(self, cardURL);
  } catch {
    report(
      'script-outside-realm',
      'script',
      `The script link "${self}" is not a URL in the automation's realm`,
    );
    return undefined;
  }
  if (!scriptURL.href.startsWith(entry.realmURL)) {
    report(
      'script-outside-realm',
      'script',
      `The script ${scriptURL.href} is outside the automation's realm ${entry.realmURL}`,
    );
    return undefined;
  }
  return scriptURL.href;
}

function readTriggers(
  raw: unknown,
  report: Report,
): AutomationTriggerDeclaration[] {
  let triggers: AutomationTriggerDeclaration[] = [];
  let labels = new Set<string>();
  for (let [index, item] of asList(raw).entries()) {
    let path = `triggers.${index}`;
    let trigger = asRecord(item);
    let label = text(trigger.label);
    if (label === undefined) {
      report('missing-label', `${path}.label`, 'Every trigger needs a label');
    } else if (labels.has(label)) {
      report(
        'duplicate-label',
        `${path}.label`,
        `The label "${label}" names more than one trigger; each trigger's label must be unique within its automation`,
      );
    } else {
      labels.add(label);
    }
    let params = readParams(trigger.params, `${path}.params`, report);
    let kind = trigger.kind;
    if (kind === 'cron') {
      let cron = readCron(trigger, path, report);
      if (cron && label !== undefined) {
        triggers.push({ kind, label, ...cron, params });
      }
    } else if (kind === 'once') {
      let once = readOnce(trigger, path, report);
      if (once && label !== undefined) {
        triggers.push({ kind, label, ...once, params });
      }
    } else if (kind === 'webhook') {
      let webhookPath = text(trigger.webhookPath);
      if (webhookPath === undefined) {
        report(
          'missing-webhook-path',
          `${path}.webhookPath`,
          'A webhook trigger names one of the realm’s incoming webhooks by its path',
        );
      } else if (label !== undefined) {
        triggers.push({ kind, label, webhookPath, params });
      }
    } else {
      report(
        'invalid-trigger-kind',
        `${path}.kind`,
        `A trigger's kind is "cron", "once" or "webhook", not ${JSON.stringify(kind ?? null)}`,
      );
    }
  }
  return triggers;
}

function readTimeZone(
  trigger: Record<string, unknown>,
  path: string,
  report: Report,
): string | undefined {
  let timeZone = text(trigger.timeZone);
  if (timeZone === undefined) {
    report(
      'missing-time-zone',
      `${path}.timeZone`,
      'This trigger needs a time zone, such as America/Chicago',
    );
    return undefined;
  }
  if (!isValidTimeZone(timeZone)) {
    report(
      'invalid-time-zone',
      `${path}.timeZone`,
      `"${timeZone}" is not a time zone this server knows; use an IANA name such as America/Chicago`,
    );
    return undefined;
  }
  return timeZone;
}

function readCron(
  trigger: Record<string, unknown>,
  path: string,
  report: Report,
): Omit<CronTrigger, 'kind' | 'label'> | undefined {
  let ok = true;
  let expression = text(trigger.expression);
  let zone = text(trigger.timeZone);
  let knownZone =
    zone !== undefined && isValidTimeZone(zone) ? zone : undefined;
  if (expression === undefined) {
    report(
      'invalid-cron',
      `${path}.expression`,
      'A cron trigger needs a cron expression',
    );
    ok = false;
  } else {
    let error = cronExpressionError(expression);
    if (error) {
      report('invalid-cron', `${path}.expression`, error);
      ok = false;
    } else {
      let frequency = cronFrequencyError(expression, knownZone);
      if (frequency) {
        report('cron-too-frequent', `${path}.expression`, frequency);
        ok = false;
      }
    }
  }
  let timeZone = readTimeZone(trigger, path, report);

  let count: number | undefined;
  if (trigger.count !== null && trigger.count !== undefined) {
    let value = number(trigger.count);
    if (value === undefined || !Number.isInteger(value) || value < 1) {
      report(
        'invalid-count',
        `${path}.count`,
        `A trigger's count is a whole number of runs, at least 1, not ${JSON.stringify(trigger.count)}`,
      );
      ok = false;
    } else {
      count = value;
    }
  }

  let until: number | undefined;
  let untilDate = text(trigger.untilDate);
  let untilTime = text(trigger.untilTime);
  if (untilDate === undefined && untilTime !== undefined) {
    report(
      'invalid-date-time',
      `${path}.untilDate`,
      'An until time needs an until date',
    );
    ok = false;
  } else if (untilDate !== undefined && timeZone !== undefined) {
    until = localDateTime(
      untilDate,
      untilTime ?? END_OF_DAY,
      timeZone,
      `${path}.untilDate`,
      report,
    );
    if (until === undefined) {
      ok = false;
    }
  }

  if (!ok || expression === undefined || timeZone === undefined) {
    return undefined;
  }
  return {
    expression,
    timeZone,
    ...(until !== undefined ? { until } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

function readOnce(
  trigger: Record<string, unknown>,
  path: string,
  report: Report,
): { at: number; timeZone: string } | undefined {
  let timeZone = readTimeZone(trigger, path, report);
  let date = text(trigger.date);
  let time = text(trigger.time);
  if (date === undefined || time === undefined) {
    report(
      'invalid-date-time',
      `${path}.${date === undefined ? 'date' : 'time'}`,
      'A once trigger needs a date and a time',
    );
    return undefined;
  }
  if (timeZone === undefined) {
    return undefined;
  }
  let at = localDateTime(date, time, timeZone, `${path}.date`, report);
  return at === undefined ? undefined : { at, timeZone };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function localDateTime(
  date: string,
  time: string,
  timeZone: string,
  path: string,
  report: Report,
): number | undefined {
  if (!DATE.test(date) || !TIME.test(time)) {
    report(
      'invalid-date-time',
      path,
      `"${date} ${time}" isn't a date like 2026-11-09 and a time like 15:00`,
    );
    return undefined;
  }
  try {
    return zonedDateTimeToUnixSeconds(`${date}T${time}`, timeZone);
  } catch (e) {
    report(
      'invalid-date-time',
      path,
      e instanceof Error ? e.message : String(e),
    );
    return undefined;
  }
}

function readOperations(
  raw: unknown,
  cardURL: string,
  report: Report,
): AutomationOperationDeclaration[] {
  let operations: AutomationOperationDeclaration[] = [];
  for (let [index, item] of asList(raw).entries()) {
    let path = `operations.${index}`;
    let entry = asRecord(item);
    let targetType = asRecord(entry.targetType);
    let module = text(targetType.module);
    let name = text(targetType.name);
    let operation = text(entry.operation);
    if (module === undefined || name === undefined) {
      report(
        'invalid-operation',
        `${path}.targetType`,
        'An operation names the card type that declares it, by module and name',
      );
      continue;
    }
    if (operation === undefined) {
      report(
        'invalid-operation',
        `${path}.operation`,
        'An operation needs the name of a callApi operation on its card type',
      );
      continue;
    }
    operations.push({
      targetType: { module: rri(resolveModule(module, cardURL)), name },
      operation,
    });
  }
  return operations;
}

// A relative module is relative to the card; a URL or a prefix such as
// `@cardstack/catalog/` stays as written.
function resolveModule(module: string, cardURL: string): string {
  if (module.startsWith('./') || module.startsWith('../')) {
    return new URL(module, cardURL).href;
  }
  return module;
}

function readCaps(raw: unknown, report: Report): AutomationCaps | undefined {
  let stored = asRecord(raw);
  let caps: Partial<AutomationCaps> = {};
  let ok = true;
  for (let name of AUTOMATION_CAP_NAMES) {
    let path = `caps.${name}`;
    if (stored[name] === null || stored[name] === undefined) {
      report('missing-cap', path, `An automation must set its ${name} cap`);
      ok = false;
      continue;
    }
    let value = number(stored[name]);
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      report(
        'invalid-cap',
        path,
        `The ${name} cap is a whole number, 0 or more, not ${JSON.stringify(stored[name])}`,
      );
      ok = false;
      continue;
    }
    if (name === 'seconds' && value > MAX_RUN_SECONDS) {
      report(
        'seconds-cap-too-high',
        path,
        `A run may last at most ${MAX_RUN_SECONDS} seconds (20 minutes), not ${value}`,
      );
      ok = false;
      continue;
    }
    caps[name] = value;
  }
  return ok ? (caps as AutomationCaps) : undefined;
}

function readParams(
  raw: unknown,
  path: string,
  report: Report,
): AutomationParams {
  let params: AutomationParams = {};
  for (let [index, item] of asList(raw).entries()) {
    let param = asRecord(item);
    let name = text(param.name);
    if (name === undefined) {
      report(
        'invalid-param',
        `${path}.${index}.name`,
        'Every param needs a name',
      );
      continue;
    }
    if (Object.hasOwn(params, name)) {
      report(
        'invalid-param',
        `${path}.${index}.name`,
        `The param "${name}" is set more than once`,
      );
      continue;
    }
    params[name] = typeof param.value === 'string' ? param.value : '';
  }
  return params;
}

function readMilestones(raw: unknown, report: Report): string[] {
  let milestones: string[] = [];
  for (let [index, item] of asList(raw).entries()) {
    let name = text(item);
    if (name === undefined) {
      report(
        'invalid-milestone',
        `milestones.${index}`,
        'A milestone needs a name',
      );
    } else if (milestones.includes(name)) {
      report(
        'invalid-milestone',
        `milestones.${index}`,
        `The milestone "${name}" is listed more than once`,
      );
    } else {
      milestones.push(name);
    }
  }
  return milestones;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// A non-empty, trimmed string, or undefined.
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

// NumberField stores a number; a numeric string is read the same way.
function number(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    let parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
