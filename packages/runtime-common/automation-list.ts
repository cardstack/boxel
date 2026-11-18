// Every automation in a realm at a glance, for the realm's direct writers:
// what the realm config's Automations entry and the automations console
// list. One entry per automation card the realm holds, switched on or not,
// plus any switched-on automation whose card doesn't read from the index, so
// a row whose runs go on is never hidden.
//
// The card is the definition and the row is the state (ADR 028 §1.3): each
// entry reads its title and triggers from the card as indexed, its state,
// next run and payer from the automation's row, and its last result and run
// in progress from the automation's runs. The payer is a
// Matrix id, so an entry names the payer only to a viewer who is the payer or
// shares a realm grant with them (ADR 011 §1.2).

import {
  automationCreditsSinceFor,
  utcMonthStart,
} from './automation-spend.ts';
import {
  automationsInRealm,
  type AutomationPauseReason,
  type AutomationRow,
  type AutomationRunResult,
  type AutomationState,
} from './automations.ts';
import { now as clockNow } from './clock.ts';
import type { DBAdapter } from './db.ts';
import {
  isDirectWriter,
  shareARealmGrant,
} from './db-queries/realm-permission-queries.ts';
import {
  addExplicitParens,
  dbAdapterQuerier,
  param,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
import type { IndexedInstanceSource } from './index-query-engine.ts';
import { ri, rri, type RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export const AUTOMATION_LIST_PATH = '_automations';
export const AUTOMATION_SUMMARY_TYPE = 'automation-summary';

// A trigger as the card declares it, read from the card's own fields so a
// card that doesn't read as a declaration lists its triggers too. Only the
// fields of the trigger's kind are present.
export interface AutomationSummaryTrigger {
  label: string;
  kind: 'cron' | 'once' | 'webhook' | null;
  // `cron`
  expression?: string;
  timeZone?: string;
  // `once`: the card's local date (`yyyy-MM-dd`) and wall-clock time
  // (`HH:MM`) in `timeZone`.
  date?: string;
  time?: string;
  // `webhook`
  webhookPath?: string;
}

// The run in progress, and where it is: the run milestone its script last
// reported, with the count inside it when the script counts.
export interface AutomationSummaryCurrentRun {
  runId: string;
  startedAt: string | null;
  milestone: string | null;
  done?: number;
  total?: number;
}

export interface AutomationSummaryAttributes {
  // The card's name, or null when the card has none or doesn't read from the
  // index.
  title: string | null;
  switchedOn: boolean;
  // The row's state; null when the automation isn't switched on.
  state: AutomationState | null;
  pauseReason: AutomationPauseReason | null;
  triggers: AutomationSummaryTrigger[];
  // ISO time: the earliest next run across the triggers, or null. Always
  // null for an automation that isn't switched on, since nothing runs it.
  nextRun: string | null;
  // The payer's Matrix id, or null when the viewer may not see who pays or
  // the automation isn't switched on.
  payer: string | null;
  viewerIsPayer: boolean;
  // The monthly credit cap: the one the payer agreed to when the automation
  // is switched on, the card's otherwise. Null when neither sets one.
  monthlyCredits: number | null;
  // What the automation was charged this UTC month, the month the monthly
  // cap counts, across every charge kind that names it.
  spentThisMonth: number;
  // How the automation's last run that started and ended finished, and when,
  // leaving out Previews: a run its triggers started, or a Run now.
  lastResult: AutomationRunResult | null;
  lastFinishedAt: string | null;
  // The automation's run in progress, leaving out a Preview, or null.
  currentRun: AutomationSummaryCurrentRun | null;
}

export interface AutomationSummaryResource {
  type: typeof AUTOMATION_SUMMARY_TYPE;
  // The automation card's URL.
  id: string;
  attributes: AutomationSummaryAttributes;
}

export interface AutomationListDocument {
  data: AutomationSummaryResource[];
}

export type AutomationListAnswer =
  | { status: 200; document: AutomationListDocument }
  | { status: 403; message: string };

// Answers `GET <realm>/_automations` for `viewer`. Only a direct writer of
// the realm gets an answer, since direct writers are who switch automations
// on, pause them and pay for them. Any other caller, a reader or one a `*`,
// `users` or policy grant admits, is refused, and the realm config shows no
// Automations entry.
export async function answerAutomationList({
  dbAdapter,
  realmURL,
  matrixServerName,
  virtualNetwork,
  automationTypeKey,
  viewer,
  listInstances,
  now = Math.floor(clockNow() / 1000),
}: {
  dbAdapter: DBAdapter;
  realmURL: URL;
  matrixServerName: string;
  virtualNetwork: VirtualNetwork;
  // `automationRef` as `internalKeyFor` spells it in this realm.
  automationTypeKey: string;
  // The Matrix id the request was authenticated as, if any.
  viewer: string | undefined;
  // Every live instance in the realm whose adoption chain carries
  // `automationTypeKey`.
  listInstances: (typeKey: string) => Promise<IndexedInstanceSource[]>;
  // Unix seconds; the realm's clock when absent.
  now?: number;
}): Promise<AutomationListAnswer> {
  if (
    !viewer ||
    !(await isDirectWriter(dbAdapter, realmURL, viewer, matrixServerName))
  ) {
    return {
      status: 403,
      message: `only a direct writer of ${realmURL.href} can list its automations`,
    };
  }
  let realm = ri(virtualNetwork.unresolveURL(realmURL.href));
  let rows = new Map<RealmResourceIdentifier, AutomationRow>(
    (await automationsInRealm(dbAdapter, realm)).map((row) => [
      row.automationId,
      row,
    ]),
  );
  let entries = new Map<
    RealmResourceIdentifier,
    IndexedInstanceSource | undefined
  >();
  // The index matches each card's adoption chain on `automationTypeKey`, the
  // key the declaration reader requires, so a local class that merely shares
  // the name `Automation` is never listed.
  for (let entry of await listInstances(automationTypeKey)) {
    // The index row names the card's file; the automation is the card's id,
    // which is the file's URL less `.json`.
    let cardURL = entry.url.replace(/\.json$/, '');
    entries.set(rri(virtualNetwork.unresolveURL(cardURL)), entry);
  }
  for (let automationId of rows.keys()) {
    if (!entries.has(automationId)) {
      entries.set(automationId, undefined);
    }
  }

  let querier = dbAdapterQuerier(dbAdapter);
  let ids = [...entries.keys()];
  // Each read below covers every listed automation at once, so a realm's
  // list costs the same handful of queries however many automations it has.
  let [lastRuns, currentRuns, spent] = await Promise.all([
    readLastRunsOf(querier, ids),
    readCurrentRunsOf(querier, ids),
    automationCreditsSinceFor(querier, ids, utcMonthStart(now)),
  ]);
  let payerShown = new Map<string, boolean>();
  let data: AutomationSummaryResource[] = [];
  for (let [automationId, entry] of entries) {
    let row = rows.get(automationId);
    let instance = entry?.instance ?? undefined;
    let attributes = (instance?.attributes ?? {}) as Record<string, unknown>;
    let lastRun = lastRuns.get(automationId);
    let shown = false;
    if (row) {
      if (row.payer === viewer) {
        shown = true;
      } else {
        if (!payerShown.has(row.payer)) {
          payerShown.set(
            row.payer,
            await shareARealmGrant(dbAdapter, viewer, row.payer),
          );
        }
        shown = payerShown.get(row.payer) === true;
      }
    }
    data.push({
      type: AUTOMATION_SUMMARY_TYPE,
      id: virtualNetwork.toURLHref(automationId),
      attributes: {
        title: cardTitle(attributes),
        switchedOn: Boolean(row),
        state: row?.state ?? null,
        pauseReason: row?.pauseReason ?? null,
        triggers: instance
          ? cardTriggers(attributes)
          : Object.keys(row?.triggerRuns ?? {}).map((label) => ({
              label,
              kind: null,
            })),
        nextRun:
          row && row.nextRun !== null
            ? new Date(row.nextRun * 1000).toISOString()
            : null,
        payer: row && shown ? row.payer : null,
        viewerIsPayer: row?.payer === viewer,
        monthlyCredits: monthlyCap(row, attributes),
        spentThisMonth: spent.get(automationId) ?? 0,
        lastResult: lastRun?.result ?? null,
        lastFinishedAt: lastRun?.finishedAt ?? null,
        currentRun: currentRuns.get(automationId) ?? null,
      },
    });
  }
  data.sort(
    (a, b) =>
      (a.attributes.title ?? '').localeCompare(b.attributes.title ?? '', 'en', {
        sensitivity: 'base',
      }) || a.id.localeCompare(b.id),
  );
  return { status: 200, document: { data } };
}

function cardTitle(attributes: Record<string, unknown>): string | null {
  let cardInfo = attributes.cardInfo as Record<string, unknown> | undefined;
  let name = cardInfo?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cardTriggers(
  attributes: Record<string, unknown>,
): AutomationSummaryTrigger[] {
  let triggers = Array.isArray(attributes.triggers) ? attributes.triggers : [];
  return triggers.map((value: unknown) => {
    let trigger = (value ?? {}) as Record<string, unknown>;
    let kind: AutomationSummaryTrigger['kind'] =
      trigger.kind === 'cron' ||
      trigger.kind === 'once' ||
      trigger.kind === 'webhook'
        ? trigger.kind
        : null;
    let summary: AutomationSummaryTrigger = {
      label: text(trigger.label) ?? '',
      kind,
    };
    if (kind === 'cron') {
      summary.expression = text(trigger.expression);
      summary.timeZone = text(trigger.timeZone);
    } else if (kind === 'once') {
      summary.date = text(trigger.date);
      summary.time = text(trigger.time);
      summary.timeZone = text(trigger.timeZone);
    } else if (kind === 'webhook') {
      summary.webhookPath = text(trigger.webhookPath);
    }
    return summary;
  });
}

function monthlyCap(
  row: AutomationRow | undefined,
  attributes: Record<string, unknown>,
): number | null {
  if (row) {
    let agreed = row.capsSnapshot.monthlyCredits;
    return typeof agreed === 'number' ? agreed : null;
  }
  let caps = attributes.caps as Record<string, unknown> | undefined;
  let declared = caps?.monthlyCredits;
  return typeof declared === 'number' ? declared : null;
}

function inList(ids: string[]): Expression {
  return addExplicitParens(
    separatedByCommas(ids.map((id) => [param(id)])),
  ) as Expression;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  let date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Each automation's last run that started and has ended, leaving out
// Previews, as `readLastRunMilestones` picks it: how it ended and when.
async function readLastRunsOf(
  querier: Querier,
  ids: string[],
): Promise<
  Map<string, { result: AutomationRunResult; finishedAt: string | null }>
> {
  let lastRuns = new Map<
    string,
    { result: AutomationRunResult; finishedAt: string | null }
  >();
  if (ids.length === 0) {
    return lastRuns;
  }
  let rows = (await querier([
    'SELECT DISTINCT ON (automation_id) automation_id, state, finished_at',
    'FROM automation_runs WHERE automation_id IN',
    ...inList(ids),
    'AND finished_at IS NOT NULL AND started_at IS NOT NULL AND NOT dry_run',
    'ORDER BY automation_id, finished_at DESC, id',
  ] as Expression)) as {
    automation_id: string;
    state: string;
    finished_at: unknown;
  }[];
  for (let row of rows) {
    if (
      row.state === 'complete' ||
      row.state === 'error' ||
      row.state === 'canceled'
    ) {
      lastRuns.set(row.automation_id, {
        result: row.state,
        finishedAt: iso(row.finished_at),
      });
    }
  }
  return lastRuns;
}

// Each automation's run in progress, leaving out Previews, as
// `readCurrentRunMilestones` picks it, with the milestone its script last
// reported and the count inside that milestone.
async function readCurrentRunsOf(
  querier: Querier,
  ids: string[],
): Promise<Map<string, AutomationSummaryCurrentRun>> {
  let currentRuns = new Map<string, AutomationSummaryCurrentRun>();
  if (ids.length === 0) {
    return currentRuns;
  }
  let rows = (await querier([
    'SELECT DISTINCT ON (r.automation_id) r.automation_id, r.id, r.started_at,',
    'm.name, m.count_done, m.count_total',
    'FROM automation_runs r LEFT JOIN LATERAL (',
    'SELECT name, count_done, count_total FROM automation_run_milestones',
    'WHERE run_id = r.id ORDER BY position DESC LIMIT 1',
    ') m ON TRUE',
    'WHERE r.automation_id IN',
    ...inList(ids),
    "AND r.state = 'running' AND NOT r.dry_run",
    'ORDER BY r.automation_id, r.started_at DESC NULLS LAST, r.id',
  ] as Expression)) as {
    automation_id: string;
    id: string;
    started_at: unknown;
    name: string | null;
    count_done: number | null;
    count_total: number | null;
  }[];
  for (let row of rows) {
    let run: AutomationSummaryCurrentRun = {
      runId: row.id,
      startedAt: iso(row.started_at),
      milestone: row.name ?? null,
    };
    if (row.name && row.count_done !== null && row.count_total !== null) {
      run.done = Number(row.count_done);
      run.total = Number(row.count_total);
    }
    currentRuns.set(row.automation_id, run);
  }
  return currentRuns;
}
