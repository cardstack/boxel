import { cronTriggerProblem } from './automation-cron-rule.ts';
import {
  isValidTimeZone,
  zonedDateTimeToUnixSeconds,
  type CronTrigger,
  type OnceTrigger,
  type WebhookTrigger,
} from './automation-schedule.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import { RealmPaths } from './paths.ts';
import {
  resolveRRIReference,
  ri,
  rri,
  type RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { CardResource } from './resource-types.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// The catalog's `Automation` card type. An automation's definition is an
// instance of it, or of a type that descends from it.
export const automationRef: ResolvedCodeRef = {
  module: rri('@cardstack/catalog/automation/automation'),
  name: 'Automation',
};

// The most a run's `seconds` cap may be: 20 minutes.
export const MAX_RUN_SECONDS = 20 * 60;

// How long a batch of AI requests may take before its requests are sent again
// at the normal price: at most 24 hours, and an hour when the card leaves it
// unset, long enough for nearly every batch to finish.
export const MAX_BATCH_DEADLINE_MINUTES = 24 * 60;
export const DEFAULT_BATCH_DEADLINE_MINUTES = 60;

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
  // Tells whether a script in prefix form (`@cardstack/catalog/...`) is inside
  // a realm known by its URL, and the reverse. Without it, only a script in
  // the same form as `realmURL` is found inside the realm.
  virtualNetwork?: Pick<VirtualNetwork, 'toURL' | 'toURLHref'>;
}

// Values the automation hands the script.
export type AutomationParams = Record<string, string>;

export type AutomationTriggerDeclaration =
  | CronTrigger
  | (OnceTrigger & { timeZone: string })
  | (WebhookTrigger & { webhookPath: string });

export interface AutomationOperationDeclaration {
  targetType: ResolvedCodeRef;
  operation: string;
}

export interface AutomationCaps {
  callApiCalls: number;
  responseBytes: number;
  resolveCalls: number;
  // Credits a run's AI requests may cost in all. A request is refused when
  // its most possible cost would take the run past it (ADR 029 §1.5).
  aiCredits: number;
  writes: number;
  seconds: number;
  // At least one of the two is set; a null one doesn't limit spending.
  dailyCredits: number | null;
  monthlyCredits: number | null;
}

export const AUTOMATION_CAP_NAMES: readonly (keyof AutomationCaps)[] = [
  'callApiCalls',
  'responseBytes',
  'resolveCalls',
  'aiCredits',
  'writes',
  'seconds',
  'dailyCredits',
  'monthlyCredits',
];

// Each limit as the automation card labels it, for messages a person reads.
const CAP_LABELS: Record<keyof AutomationCaps, string> = {
  callApiCalls: 'Outside calls',
  responseBytes: 'Data received',
  resolveCalls: 'AI requests',
  aiCredits: 'AI spending',
  writes: 'Saves',
  seconds: 'Run time',
  dailyCredits: 'Credits a day',
  monthlyCredits: 'Credits a month',
};

export interface AutomationDeclaration {
  url: string;
  realmURL: string;
  // The script file, inside `realmURL`, in the form of the card's id. A
  // prefix-form id is resolved to a URL where the run fetches the script.
  script: RealmResourceIdentifier;
  triggers: AutomationTriggerDeclaration[];
  operations: AutomationOperationDeclaration[];
  caps: AutomationCaps;
  params: AutomationParams;
  batchedAI: boolean;
  // Minutes a batch may take before its requests go again at the normal
  // price. Read only when `batchedAI` is on.
  batchDeadlineMinutes: number;
}

export type AutomationProblemCode =
  | 'not-an-automation'
  | 'not-indexed'
  | 'missing-script'
  | 'script-outside-realm'
  | 'invalid-trigger-kind'
  | 'missing-label'
  | 'duplicate-label'
  | 'reserved-label'
  | 'invalid-cron'
  | 'cron-too-frequent'
  | 'missing-time-zone'
  | 'invalid-time-zone'
  | 'invalid-date-time'
  | 'invalid-count'
  | 'missing-webhook-path'
  | 'invalid-operation'
  | 'missing-cap'
  | 'missing-credit-cap'
  | 'invalid-cap'
  | 'seconds-cap-too-high'
  | 'daily-credits-above-monthly'
  | 'invalid-param'
  | 'invalid-batch-deadline';

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
  { automationTypeKey, virtualNetwork }: ReadAutomationOptions,
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
  // Relative links are relative to the card's id, in whichever form it has.
  let cardId = entry.instance.id ?? rri(entry.url);

  let script = readScript(entry, cardId, virtualNetwork, report);
  let triggers = readTriggers(attributes.triggers, report);
  let operations = readOperations(attributes.operations, cardId, report);
  let caps = readCaps(attributes.caps, report);
  let params = readParams(attributes.params, 'params', report);
  let batchDeadlineMinutes = readBatchDeadline(
    attributes.batchDeadlineMinutes,
    report,
  );

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
      batchedAI: attributes.batchedAI === true,
      batchDeadlineMinutes,
    },
  };
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
  cardId: RealmResourceIdentifier,
  virtualNetwork: ReadAutomationOptions['virtualNetwork'],
  report: Report,
): RealmResourceIdentifier | undefined {
  let relationship = entry.instance?.relationships?.script;
  let self = Array.isArray(relationship)
    ? undefined
    : relationship?.links?.self;
  if (typeof self !== 'string' || self === '') {
    report('missing-script', 'script', 'An automation must link its script');
    return undefined;
  }
  let script: RealmResourceIdentifier;
  let inRealm: boolean;
  try {
    script = rri(resolveRRIReference(self, cardId));
    inRealm = new RealmPaths(ri(entry.realmURL), virtualNetwork).inRealm(
      script,
    );
  } catch {
    report(
      'script-outside-realm',
      'script',
      `The script link "${self}" doesn't name a file in the automation's workspace; link a script file from the automation's workspace`,
    );
    return undefined;
  }
  if (!inRealm) {
    report(
      'script-outside-realm',
      'script',
      `The script ${script} is outside the automation's workspace; link a script file from the automation's workspace`,
    );
    return undefined;
  }
  return script;
}

// The trigger label a Preview's or a Run now's run row carries, with the
// click as its slot. No trigger on a card may take it, so a click can never
// share a run's slot and dedupe key with a scheduled run.
export const MANUAL_RUN_TRIGGER = 'manual';

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
    } else if (label === MANUAL_RUN_TRIGGER) {
      report(
        'reserved-label',
        `${path}.label`,
        `The label "${label}" is reserved for runs started by hand (Preview and Run now); choose another label`,
      );
    } else if (labels.has(label)) {
      report(
        'duplicate-label',
        `${path}.label`,
        `More than one trigger has the label "${label}"; give each trigger a different label`,
      );
    } else {
      labels.add(label);
    }
    let kind = trigger.kind;
    if (kind === 'cron') {
      let cron = readCron(trigger, path, report);
      if (cron && label !== undefined) {
        triggers.push({ kind, label, ...cron });
      }
    } else if (kind === 'once') {
      let once = readOnce(trigger, path, report);
      if (once && label !== undefined) {
        triggers.push({ kind, label, ...once });
      }
    } else if (kind === 'webhook') {
      let webhookPath = text(trigger.webhookPath);
      if (webhookPath === undefined) {
        report(
          'missing-webhook-path',
          `${path}.webhookPath`,
          'A webhook trigger needs the path of one of the workspace’s incoming webhooks',
        );
      } else if (label !== undefined) {
        triggers.push({ kind, label, webhookPath });
      }
    } else {
      report(
        'invalid-trigger-kind',
        `${path}.kind`,
        `A trigger runs on a schedule ("cron"), once ("once") or from a webhook ("webhook"), not ${JSON.stringify(kind ?? null)}; pick one of those kinds`,
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
      'A trigger needs a time zone, such as America/Chicago',
    );
    return undefined;
  }
  if (!isValidTimeZone(timeZone)) {
    report(
      'invalid-time-zone',
      `${path}.timeZone`,
      `"${timeZone}" isn't a time zone Boxel knows; pick a name such as America/Chicago`,
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
  if (expression === undefined) {
    report(
      'invalid-cron',
      `${path}.expression`,
      'A schedule trigger needs a cron expression',
    );
    ok = false;
  } else {
    let problem = cronTriggerProblem(expression, zone);
    if (problem) {
      report(problem.code, `${path}.expression`, problem.message);
      ok = false;
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
  cardId: RealmResourceIdentifier,
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
        'An outside service needs the card type that declares the service, by module and name',
      );
      continue;
    }
    if (operation === undefined) {
      report(
        'invalid-operation',
        `${path}.operation`,
        'An outside service needs the name of an operation on the card type',
      );
      continue;
    }
    operations.push({
      targetType: { module: resolveModule(module, cardId), name },
      operation,
    });
  }
  return operations;
}

// A relative module is relative to the card's id, and keeps its form; a URL
// or a prefix such as `@cardstack/catalog/` stays as written.
function resolveModule(
  module: string,
  cardId: RealmResourceIdentifier,
): RealmResourceIdentifier {
  if (module.startsWith('./') || module.startsWith('../')) {
    return rri(resolveRRIReference(module, cardId));
  }
  return rri(module);
}

function readCaps(raw: unknown, report: Report): AutomationCaps | undefined {
  let stored = asRecord(raw);
  let caps: Partial<AutomationCaps> = {};
  let ok = true;
  for (let name of AUTOMATION_CAP_NAMES) {
    let path = `caps.${name}`;
    if (stored[name] === null || stored[name] === undefined) {
      if (name === 'dailyCredits' || name === 'monthlyCredits') {
        caps[name] = null;
        continue;
      }
      report('missing-cap', path, `Set the "${CAP_LABELS[name]}" limit`);
      ok = false;
      continue;
    }
    let value = number(stored[name]);
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      report(
        'invalid-cap',
        path,
        `"${CAP_LABELS[name]}" is a whole number, 0 or more, not ${JSON.stringify(stored[name])}`,
      );
      ok = false;
      continue;
    }
    if (name === 'seconds' && value > MAX_RUN_SECONDS) {
      report(
        'seconds-cap-too-high',
        path,
        `"Run time" is at most 20 minutes (${MAX_RUN_SECONDS} seconds), not ${value} seconds`,
      );
      ok = false;
      continue;
    }
    caps[name] = value;
  }
  // Spending needs a limit, a day's or a month's; either one is enough.
  if (caps.dailyCredits === null && caps.monthlyCredits === null) {
    report(
      'missing-credit-cap',
      'caps.monthlyCredits',
      'Set "Credits a day", "Credits a month", or both',
    );
    ok = false;
  }
  if (
    typeof caps.dailyCredits === 'number' &&
    typeof caps.monthlyCredits === 'number' &&
    caps.dailyCredits > caps.monthlyCredits
  ) {
    report(
      'daily-credits-above-monthly',
      'caps.dailyCredits',
      `"Credits a day" (${caps.dailyCredits}) can't be more than "Credits a month" (${caps.monthlyCredits})`,
    );
    ok = false;
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
    if (Object.prototype.hasOwnProperty.call(params, name)) {
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

function readBatchDeadline(
  value: unknown,
  report: (code: AutomationProblemCode, path: string, message: string) => void,
): number {
  if (value === undefined || value === null) {
    return DEFAULT_BATCH_DEADLINE_MINUTES;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_BATCH_DEADLINE_MINUTES
  ) {
    report(
      'invalid-batch-deadline',
      'batchDeadlineMinutes',
      `The batch deadline must be a whole number of minutes from 1 to ${MAX_BATCH_DEADLINE_MINUTES} (24 hours).`,
    );
    return DEFAULT_BATCH_DEADLINE_MINUTES;
  }
  return value;
}
