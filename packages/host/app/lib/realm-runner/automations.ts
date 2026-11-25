import { tracked } from '@glimmer/tracking';

import { SupportedMimeType } from '@cardstack/runtime-common';
import {
  AUTOMATION_PREVIEW_PATH,
  AUTOMATION_RESOURCE_TYPE,
  AUTOMATION_ROUTE_AUTOMATION_PARAM,
  AUTOMATION_ROUTE_REALM_PARAM,
  AUTOMATION_ROUTE_RUN_PARAM,
  AUTOMATION_RUN_NOW_PATH,
  AUTOMATION_RUN_REPORT_PATH,
  AUTOMATION_SWITCH_ON_PATH,
} from '@cardstack/runtime-common/automation-routes';
import {
  isValidTimeZone,
  zonedDateTimeToUnixSeconds,
} from '@cardstack/runtime-common/automation-schedule';

// The `realm.automations.*` calls that start spending or change who pays:
// a Preview or a Run now starts a run charged to the person, and a
// switch-on makes the person the automation's payer. Each names its card by a
// literal path in the script, so the approval panel can show that card's
// triggers, estimate and monthly cap before the click, and the run refuses
// the call for any card the panel did not show.
export const AUTOMATION_START_CALLS = {
  'realm.automations.preview':
    'Previews an automation: runs the script once now, saves nothing, and charges the run to you.',
  'realm.automations.runNow':
    'Runs an automation once now, saves what the run writes, and charges the run to you.',
  'realm.automations.switchOn':
    'Switches an automation on: you become the automation’s payer, and every scheduled run spends your credits within the monthly cap.',
} as const;
export type AutomationStartCall = keyof typeof AUTOMATION_START_CALLS;

export function isAutomationStartCall(
  call: string,
): call is AutomationStartCall {
  return call in AUTOMATION_START_CALLS;
}

// One start call a script names, with the card it names by a literal path.
export interface NamedAutomationCall {
  call: AutomationStartCall;
  path: string;
}

const START_CALL_PATTERN =
  /realm\.automations\.(preview|runNow|switchOn)\s*\(\s*(?:'([^'\\\n]+)'|"([^"\\\n]+)"|`([^`\\$\n]+)`)/g;

// The start calls a script names with a literal card path, in the order they
// appear, each call and path once.
export function namedAutomationCalls(code: unknown): NamedAutomationCall[] {
  if (typeof code !== 'string') {
    return [];
  }
  let found = new Map<string, NamedAutomationCall>();
  for (let match of code.matchAll(START_CALL_PATTERN)) {
    let call = `realm.automations.${match[1]}` as AutomationStartCall;
    let path = (match[2] ?? match[3] ?? match[4]).trim();
    if (path) {
      found.set(`${call} ${path}`, { call, path });
    }
  }
  return [...found.values()];
}

// The card's URL for a path the script names, inside the run's realm: a
// card's path may carry `.json` or not.
export function automationCardURL(path: string, realmURL: string): string {
  let url = new URL(path.replace(/^\/+/, ''), realmURL);
  if (!url.href.startsWith(realmURL)) {
    throw new Error(
      `An automation is named by its path inside the workspace ${realmURL}, not ${path}`,
    );
  }
  url.search = '';
  url.hash = '';
  return url.href.replace(/\.json$/, '');
}

// A trigger as the Automation card holds it, read for a person: no field is
// trusted to be well formed, since the card is anyone's text.
export interface TriggerSummary {
  label: string;
  kind: 'cron' | 'once' | 'webhook' | 'unknown';
  // The trigger in words, in the trigger's own time zone.
  text: string;
  // For a `once` trigger in a zone other than the viewer's: the same instant
  // in the viewer's zone.
  viewerText?: string;
  // For a `once` trigger: when it fires, in unix seconds.
  at?: number;
}

export function summarizeTriggers(
  triggers: unknown,
  viewerTimeZone: string,
): TriggerSummary[] {
  if (!Array.isArray(triggers)) {
    return [];
  }
  return triggers.map((value, index) => {
    let trigger = (value ?? {}) as Record<string, unknown>;
    let label =
      typeof trigger.label === 'string' && trigger.label.trim()
        ? trigger.label.trim()
        : `trigger ${index + 1}`;
    let timeZone =
      typeof trigger.timeZone === 'string' && isValidTimeZone(trigger.timeZone)
        ? trigger.timeZone
        : undefined;
    switch (trigger.kind) {
      case 'once': {
        let at =
          timeZone &&
          typeof trigger.date === 'string' &&
          typeof trigger.time === 'string'
            ? safeUnixSeconds(`${trigger.date}T${trigger.time}`, timeZone)
            : undefined;
        if (at === undefined || !timeZone) {
          return {
            label,
            kind: 'once',
            text: 'Once, at a date, time or time zone Boxel can’t read',
          };
        }
        return {
          label,
          kind: 'once',
          at,
          text: `Once, ${formatInstant(at, timeZone)}`,
          ...(timeZone === viewerTimeZone
            ? {}
            : {
                viewerText: `${formatInstant(at, viewerTimeZone)}, your time`,
              }),
        };
      }
      case 'cron': {
        let expression =
          typeof trigger.expression === 'string' ? trigger.expression : '';
        let bounds = [
          typeof trigger.count === 'number'
            ? `at most ${trigger.count} ${trigger.count === 1 ? 'run' : 'runs'}`
            : undefined,
          typeof trigger.untilDate === 'string'
            ? `until ${trigger.untilDate}${typeof trigger.untilTime === 'string' ? ` ${trigger.untilTime}` : ''}`
            : undefined,
        ].filter(Boolean);
        return {
          label,
          kind: 'cron',
          text:
            `On the schedule ${expression || '(none)'} in ${timeZone ?? 'an unknown time zone'}` +
            (bounds.length ? `, ${bounds.join(', ')}` : ''),
        };
      }
      case 'webhook': {
        let path =
          typeof trigger.webhookPath === 'string' && trigger.webhookPath
            ? trigger.webhookPath
            : undefined;
        return {
          label,
          kind: 'webhook',
          text: path
            ? `On each delivery to the webhook ${path}`
            : 'On each delivery to a webhook the card doesn’t name yet',
        };
      }
      default:
        return {
          label,
          kind: 'unknown',
          text: 'A trigger Boxel can’t read',
        };
    }
  });
}

function safeUnixSeconds(local: string, timeZone: string) {
  try {
    return zonedDateTimeToUnixSeconds(local, timeZone);
  } catch {
    return undefined;
  }
}

// "Wednesday, November 25, 2026 at 3:45 PM CST (America/Chicago)": the
// weekday and the zone's name, so a wrong date or zone shows at a glance.
export function formatInstant(unixSeconds: number, timeZone: string): string {
  let when = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(unixSeconds * 1000));
  return `${when} (${timeZone})`;
}

// What the approval panel shows for one start call, all of it read from
// Boxel rather than from the assistant's words: the card's triggers and
// monthly cap from the card, and the estimate from the realm server.
export interface AutomationConfirmation {
  call: AutomationStartCall;
  path: string;
  cardURL: string;
  title?: string;
  triggers: TriggerSummary[];
  // The card's monthly credit cap, which a switch-on agrees to.
  monthlyCredits: number | null;
  // The realm server's estimate of a month's credits.
  estimatedCredits?: number;
  // Credits one run may cost at most.
  perRunCredits?: number;
  switchedOn?: boolean;
  // Why Boxel can't show the confirmation; the call can't run.
  problem?: string;
  // The id of the click that confirmed a Preview or a Run now, once the run
  // asked for it: the realm server starts one run per click.
  click?: string;
}

export interface AutomationIO {
  // The realm server's own fetch, with the user's session.
  realmServerFetch(url: string, init?: RequestInit): Promise<Response>;
  realmServerURL: string;
  // Reads a card's JSON:API document from its realm.
  readCardDocument(cardURL: string): Promise<Record<string, any>>;
  viewerTimeZone: string;
}

// The automation routes and card reads, as the signed-in person.
export function automationIOFor(services: {
  realmServer: {
    url: URL;
    authedFetch(url: string, init?: RequestInit): Promise<Response>;
  };
  network: { authedFetch: typeof globalThis.fetch };
}): AutomationIO {
  return {
    realmServerFetch: (url, init) =>
      services.realmServer.authedFetch(url, init),
    realmServerURL: services.realmServer.url.href,
    readCardDocument: async (cardURL) => {
      let response = await services.network.authedFetch(cardURL, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      if (!response.ok) {
        throw new Error(`the workspace answered ${response.status}`);
      }
      return await response.json();
    },
    viewerTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// The confirmations a script's gate shows, one per start call the script
// names, loaded once. `confirmations` is undefined while Boxel reads them.
export class AutomationGate {
  @tracked confirmations: AutomationConfirmation[] | undefined;
  // Settles with the confirmations once Boxel has read them.
  readonly loaded: Promise<AutomationConfirmation[]>;

  constructor(
    io: AutomationIO,
    readonly named: NamedAutomationCall[],
    realmURL: string,
  ) {
    this.loaded = Promise.all(
      named.map((call) => loadAutomationConfirmation(io, call, realmURL)),
    ).then(
      (confirmations) => (this.confirmations = confirmations),
      (error) =>
        (this.confirmations = named.map((call) => ({
          ...call,
          cardURL: call.path,
          triggers: [],
          monthlyCredits: null,
          problem: `Boxel couldn’t read the automation: ${(error as Error).message}`,
        }))),
    );
  }

  get isLoading() {
    return this.confirmations === undefined;
  }
}

export async function loadAutomationConfirmation(
  io: AutomationIO,
  named: NamedAutomationCall,
  realmURL: string,
): Promise<AutomationConfirmation> {
  let base = { call: named.call, path: named.path };
  let cardURL: string;
  try {
    cardURL = automationCardURL(named.path, realmURL);
  } catch (e) {
    return {
      ...base,
      cardURL: named.path,
      triggers: [],
      monthlyCredits: null,
      problem: (e as Error).message,
    };
  }
  let confirmation: AutomationConfirmation = {
    ...base,
    cardURL,
    triggers: [],
    monthlyCredits: null,
  };
  try {
    let doc = await io.readCardDocument(cardURL);
    let attributes = doc?.data?.attributes ?? {};
    confirmation.title =
      typeof attributes.cardInfo?.name === 'string' && attributes.cardInfo.name
        ? attributes.cardInfo.name
        : undefined;
    confirmation.triggers = summarizeTriggers(
      attributes.triggers,
      io.viewerTimeZone,
    );
    let monthly = attributes.caps?.monthlyCredits;
    confirmation.monthlyCredits = typeof monthly === 'number' ? monthly : null;
  } catch (e) {
    confirmation.problem = `Boxel couldn’t read the automation card ${named.path}: ${(e as Error).message}`;
    return confirmation;
  }
  let estimate = await automationEstimate(io, cardURL, realmURL);
  if (!estimate.ok) {
    confirmation.problem = estimate.error;
  } else {
    confirmation.estimatedCredits = estimate.attributes.estimate?.credits;
    confirmation.perRunCredits =
      estimate.attributes.estimate?.perRun?.totalCredits;
    confirmation.switchedOn = estimate.attributes.switchedOn === true;
  }
  return confirmation;
}

type RouteAnswer =
  | { ok: true; status: number; data: Record<string, any>; meta: any }
  | { ok: false; status: number; error: string; code?: string };

async function route(
  io: AutomationIO,
  path: string,
  init: {
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<RouteAnswer> {
  let url = new URL(path.replace(/^\//, ''), io.realmServerURL);
  for (let [name, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(name, value);
  }
  let response = await io.realmServerFetch(
    url.href,
    init.body === undefined
      ? { headers: { Accept: 'application/json' } }
      : {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(init.body),
        },
  );
  let json: any;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    let errors: unknown[] = Array.isArray(json?.errors) ? json.errors : [];
    let message = errors
      .map((e) =>
        typeof e === 'string'
          ? e
          : String((e as { detail?: string })?.detail ?? e),
      )
      .join('; ');
    return {
      ok: false,
      status: response.status,
      error: message || `The realm server answered ${response.status}`,
      code: json?.meta?.code,
    };
  }
  return {
    ok: true,
    status: response.status,
    data: json?.data ?? {},
    meta: json?.meta,
  };
}

export async function automationEstimate(
  io: AutomationIO,
  cardURL: string,
  realmURL: string,
): Promise<
  { ok: true; attributes: Record<string, any> } | { ok: false; error: string }
> {
  let answer = await route(io, AUTOMATION_SWITCH_ON_PATH, {
    query: {
      [AUTOMATION_ROUTE_REALM_PARAM]: realmURL,
      [AUTOMATION_ROUTE_AUTOMATION_PARAM]: cardURL,
    },
  });
  return answer.ok
    ? { ok: true, attributes: answer.data.attributes ?? {} }
    : { ok: false, error: answer.error };
}

function automationBody(
  cardURL: string,
  realmURL: string,
  attributes: Record<string, unknown>,
) {
  return {
    data: {
      type: AUTOMATION_RESOURCE_TYPE,
      id: cardURL,
      attributes: { realm: realmURL, ...attributes },
    },
  };
}

// Starts a Preview or a Run now, charged to the person. `click` is the id of
// the click that confirmed the run: the realm server answers the same run for
// the same click.
export async function startAutomationRun(
  io: AutomationIO,
  kind: 'preview' | 'runNow',
  cardURL: string,
  realmURL: string,
  click: string,
): Promise<RouteAnswer> {
  return await route(
    io,
    kind === 'preview' ? AUTOMATION_PREVIEW_PATH : AUTOMATION_RUN_NOW_PATH,
    { body: automationBody(cardURL, realmURL, { click }) },
  );
}

// Switches the automation on for the person, agreeing to `monthlyCredits`,
// the monthly cap the person confirmed. The realm server refuses it when the
// card's cap is no longer that.
export async function switchAutomationOn(
  io: AutomationIO,
  cardURL: string,
  realmURL: string,
  monthlyCredits: number,
): Promise<RouteAnswer> {
  return await route(io, AUTOMATION_SWITCH_ON_PATH, {
    body: automationBody(cardURL, realmURL, { monthlyCredits }),
  });
}

export async function automationRunReport(
  io: AutomationIO,
  realmURL: string,
  runId: string,
): Promise<RouteAnswer> {
  return await route(io, AUTOMATION_RUN_REPORT_PATH, {
    query: {
      [AUTOMATION_ROUTE_REALM_PARAM]: realmURL,
      [AUTOMATION_ROUTE_RUN_PARAM]: runId,
    },
  });
}

// One operation's missing key approval, as the realm server answers it
// after a switch-on.
interface MissingApproval {
  slot: string;
  canApprove: 'payer' | 'another-key-owner' | 'nobody-yet';
  shares?: {
    id: string;
    label?: string;
    owner: string | null;
    suspended?: boolean;
  }[];
}

export interface KeyApprovalReport {
  approved: boolean;
  // Approvals the person can give: the secure window opens for these.
  forYou: string[];
  // Approvals another key owner gives: the operation, the key's label and
  // its owner, when Boxel may name the owner to the person.
  byOthers: { operation: string; key?: string; owner?: string }[];
  // Operations whose slot has no key shared in the workspace: a realm
  // administrator shares one first.
  needShare: string[];
  // Approvals waiting on a suspended share: the share's owner resumes the
  // share first, then approves. `owner` is there when Boxel may name the
  // owner to the person.
  suspended: { operation: string; key?: string; owner?: string }[];
}

// The switch-on answer's key approvals, sorted by who acts on each.
export function keyApprovalReport(keyApprovals: unknown): KeyApprovalReport {
  let approvals = (keyApprovals ?? {}) as {
    approved?: boolean;
    operations?: {
      operation?: string;
      state?: string;
      missing?: MissingApproval[];
    }[];
  };
  let report: KeyApprovalReport = {
    approved: approvals.approved !== false,
    forYou: [],
    byOthers: [],
    needShare: [],
    suspended: [],
  };
  for (let entry of approvals.operations ?? []) {
    if (entry.state === 'approved') {
      continue;
    }
    let operation = entry.operation ?? 'an operation';
    for (let missing of entry.missing ?? []) {
      let suspended = (missing.shares ?? []).filter((share) => share.suspended);
      if (suspended.length && suspended.length === missing.shares?.length) {
        for (let share of suspended) {
          report.suspended.push({
            operation,
            ...(share.label ? { key: share.label } : {}),
            ...(share.owner ? { owner: share.owner } : {}),
          });
        }
      } else if (missing.canApprove === 'payer') {
        if (!report.forYou.includes(operation)) {
          report.forYou.push(operation);
        }
      } else if (missing.canApprove === 'another-key-owner') {
        let active = (missing.shares ?? []).filter((share) => !share.suspended);
        let shares = active.length ? active : [undefined];
        for (let share of shares) {
          report.byOthers.push({
            operation,
            ...(share?.label ? { key: share.label } : {}),
            ...(share?.owner ? { owner: share.owner } : {}),
          });
        }
      } else if (!report.needShare.includes(operation)) {
        report.needShare.push(operation);
      }
    }
  }
  return report;
}
