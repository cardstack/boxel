// Every automation in a realm at a glance, for the realm's direct writers:
// what the realm config's Automations entry and the automations console
// list. One entry per automation card the realm holds, switched on or not,
// plus any switched-on automation whose card doesn't read from the index, so
// a row whose runs go on is never hidden.
//
// The card is the definition and the row is the state (ADR 028 §1.3): each
// entry reads its title and triggers from the card as indexed, and its state,
// next run, payer and last result from the automation's row. The payer is a
// Matrix id, so an entry names the payer only to a viewer who is the payer or
// shares a realm grant with them (ADR 011 §1.2).

import {
  readCurrentRunMilestones,
  readLastRunMilestones,
  type RunMilestones,
} from './automation-run-milestones.ts';
import { automationCreditsSince, utcMonthStart } from './automation-spend.ts';
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
import { dbAdapterQuerier } from './expression.ts';
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
  // How the automation's last run ended, and when. For a switched-on
  // automation, the row's; otherwise the automation's last run that started
  // and ended (a Run now), leaving out Previews.
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
  let monthStart = utcMonthStart(now);
  let payerShown = new Map<string, boolean>();
  let data: AutomationSummaryResource[] = [];
  for (let [automationId, entry] of entries) {
    let row = rows.get(automationId);
    let instance = entry?.instance ?? undefined;
    let attributes = (instance?.attributes ?? {}) as Record<string, unknown>;
    let lastRun = row
      ? undefined
      : await readLastRunMilestones(dbAdapter, automationId);
    let currentRun = await readCurrentRunMilestones(dbAdapter, automationId, {
      now: now * 1000,
    });
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
        spentThisMonth: await automationCreditsSince(
          querier,
          automationId,
          monthStart,
        ),
        lastResult: row ? row.lastResult : lastRunResult(lastRun),
        lastFinishedAt: row
          ? row.lastFinishedAt
          : lastRun
            ? lastRun.finishedAt
            : null,
        currentRun: currentRun ? summarizeCurrentRun(currentRun) : null,
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

function lastRunResult(
  run: RunMilestones | undefined,
): AutomationRunResult | null {
  if (
    run &&
    (run.state === 'complete' ||
      run.state === 'error' ||
      run.state === 'canceled')
  ) {
    return run.state;
  }
  return null;
}

function summarizeCurrentRun(run: RunMilestones): AutomationSummaryCurrentRun {
  let summary: AutomationSummaryCurrentRun = {
    runId: run.runId,
    startedAt: run.startedAt,
    milestone: run.current,
  };
  let reached = run.milestones[run.milestones.length - 1];
  if (run.current && reached?.name === run.current) {
    if (reached.done !== undefined) {
      summary.done = reached.done;
    }
    if (reached.total !== undefined) {
      summary.total = reached.total;
    }
  }
  return summary;
}
