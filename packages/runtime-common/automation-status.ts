// What an automation card's view shows from the server: whether the
// automation is switched on, its state, its payer, and how far each trigger
// has got. The card is the definition and the row is the state (ADR 028
// §1.3), so the view reads the row through the realm's
// `_automation-status` route, which answers only the realm's direct writers.
//
// The payer is a Matrix id, so the route names the payer only to a viewer
// who shares a realm grant with them (ADR 011 §1.2), or who is the payer.
// Anyone else learns that someone pays, never who.

import {
  readAutomationDeclaration,
  type AutomationDeclaration,
  type AutomationProblem,
} from './automation-declaration.ts';
import {
  computeAutomationSchedule,
  type TriggerRunState,
} from './automation-schedule.ts';
import {
  getAutomation,
  readAutomationFailures,
  type AutomationFailure,
  type AutomationFailures,
  type AutomationPauseReason,
  type AutomationRow,
  type AutomationRunResult,
  type AutomationState,
} from './automations.ts';
import {
  readCurrentRunMilestones,
  readLastRunMilestones,
  type RunMilestones,
} from './automation-run-milestones.ts';
import {
  automationCreditsSince,
  utcDayStart,
  utcMonthStart,
} from './automation-spend.ts';
import { WEBHOOK_DELIVERIES_START_RUNS } from './automation-webhooks.ts';
import { now as clockNow } from './clock.ts';
import type { DBAdapter } from './db.ts';
import { dbAdapterQuerier, param, type Querier } from './expression.ts';
import {
  isDirectWriter,
  shareARealmGrant,
} from './db-queries/realm-permission-queries.ts';
import type { IndexedInstanceSource } from './index-query-engine.ts';
import { RealmPaths } from './paths.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export { automationRef } from './automation-declaration.ts';

export const AUTOMATION_STATUS_PATH = '_automation-status';
// The query parameter naming the automation card, by its URL.
export const AUTOMATION_STATUS_PARAM = 'automation';
export const AUTOMATION_STATUS_TYPE = 'automation-status';

export interface AutomationTriggerStatus {
  label: string;
  // Runs the trigger has started.
  runs: number;
  // For a bounded trigger (`once`, or `cron` with `until` or `count`): runs
  // left, the next one included. Absent for an unbounded trigger, and when
  // the card no longer reads as a declaration.
  runsLeft?: number;
  // `runsLeft` stopped counting at its limit, so there are at least that
  // many left.
  runsLeftAtLeast?: boolean;
  // ISO time: the last instant the trigger may fire, for a cron trigger with
  // `until` or a `once` trigger.
  until?: string;
  // ISO time: the trigger's next run, absent when it has none.
  nextRun?: string;
  spent?: boolean;
}

// The automation's last run that started and has ended, with the milestones
// its script reported: what the card shows under _Run milestones_.
export type AutomationLastRun = RunMilestones;

// The automation's run in progress, with the milestones its script has
// reported so far: the card shows the one it is in as running.
export type AutomationCurrentRun = RunMilestones;

// What the automation's last ended run used of each per-run cap, read from
// the run's row: the counts the realm holds the run to, and the run's wall
// time, which the `seconds` cap bounds.
export interface AutomationRunUsage {
  callApiCalls: number;
  responseBytes: number;
  resolveCalls: number;
  aiCredits: number;
  writes: number;
  seconds: number | null;
}

export type AutomationStatusAttributes =
  | {
      switchedOn: false;
      // Whether Boxel starts runs from webhook deliveries; the card warns
      // under each webhook trigger while it is false.
      webhookDeliveriesStartRuns: boolean;
      lastRun: AutomationLastRun | null;
      currentRun: AutomationCurrentRun | null;
      // What `lastRun` used of each per-run cap, or null without a last run.
      lastRunUsage: AutomationRunUsage | null;
    }
  | {
      switchedOn: true;
      webhookDeliveriesStartRuns: boolean;
      lastRun: AutomationLastRun | null;
      currentRun: AutomationCurrentRun | null;
      lastRunUsage: AutomationRunUsage | null;
      state: AutomationState;
      pauseReason: AutomationPauseReason | null;
      // What the declaration reader found wrong with the card, when
      // `pauseReason` is `invalid-declaration`; null otherwise. Each problem
      // has a `path` into the card (`triggers.0.expression`) and a message
      // for a person.
      pauseProblems: AutomationProblem[] | null;
      // The payer's Matrix id, or null when the viewer may not see who pays.
      payer: string | null;
      viewerIsPayer: boolean;
      // ISO time: the earliest next run across the triggers, or null.
      nextRun: string | null;
      lastResult: AutomationRunResult | null;
      lastFinishedAt: string | null;
      // How many of the automation's own runs (not a Preview or a Run now)
      // have failed since its last complete one, counting from its
      // switch-on or last resume, and the latest of them. An automation
      // pauses itself with `repeated-failures` once the count reaches
      // `AUTOMATION_FAILURES_BEFORE_PAUSE`, and `lastFailure` then says
      // why its last run failed.
      failuresInARow: number;
      lastFailure: AutomationFailure | null;
      // The monthly credit cap the payer agreed to (the caps snapshot), or
      // null when the snapshot sets none, and what the automation was
      // charged this UTC month, the month that cap counts.
      monthlyCredits: number | null;
      spentThisMonth: number;
      // The daily credit cap the payer agreed to, or null when the snapshot
      // sets none, and what the automation was charged this UTC day.
      dailyCredits: number | null;
      spentToday: number;
      triggers: AutomationTriggerStatus[];
    };

export interface AutomationStatusDocument {
  data: {
    type: typeof AUTOMATION_STATUS_TYPE;
    id: string;
    attributes: AutomationStatusAttributes;
  };
}

export type AutomationStatusAnswer =
  | { status: 200; document: AutomationStatusDocument }
  | { status: 400 | 403; message: string };

// Answers `GET <realm>/_automation-status?automation=<card URL>` for
// `viewer`. Only a direct writer of the realm gets an answer, since direct
// writers are who switch automations on, pause them and pay for them. Any
// other caller, a reader or one a `*`, `users` or policy grant admits, is
// refused, and the card's view shows the card's own fields alone.
export async function answerAutomationStatus({
  dbAdapter,
  realmURL,
  matrixServerName,
  virtualNetwork,
  automationTypeKey,
  viewer,
  automation,
  readInstance,
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
  // The `automation` query parameter.
  automation: string | null;
  readInstance: (url: URL) => Promise<IndexedInstanceSource | undefined>;
  // Unix seconds; the realm's clock when absent.
  now?: number;
}): Promise<AutomationStatusAnswer> {
  if (
    !viewer ||
    !(await isDirectWriter(dbAdapter, realmURL, viewer, matrixServerName))
  ) {
    return {
      status: 403,
      message: `only a direct writer of ${realmURL.href} can read an automation's status`,
    };
  }
  let url: URL;
  try {
    url = new URL(automation ?? '');
  } catch {
    return {
      status: 400,
      message: `name the automation card by its URL in the "${AUTOMATION_STATUS_PARAM}" query parameter`,
    };
  }
  if (!new RealmPaths(realmURL).inRealm(url)) {
    return {
      status: 400,
      message: `${url.href} is not in ${realmURL.href}`,
    };
  }
  let automationId = virtualNetwork.unresolveURL(url.href);
  let row = await getAutomation(dbAdapter, automationId);
  // A run can end before the automation is switched on (a Preview, a Run
  // now), so the last run is read either way.
  let lastRun = (await readLastRunMilestones(dbAdapter, automationId)) ?? null;
  let currentRun =
    (await readCurrentRunMilestones(dbAdapter, automationId)) ?? null;
  let declaration: AutomationDeclaration | undefined;
  let payerShown = false;
  let failures: AutomationFailures | undefined;
  let spentThisMonth = 0;
  let spentToday = 0;
  let lastRunUsage = lastRun
    ? await readRunUsage(dbAdapterQuerier(dbAdapter), lastRun.runId)
    : null;
  if (row) {
    spentThisMonth = await automationCreditsSince(
      dbAdapterQuerier(dbAdapter),
      automationId,
      utcMonthStart(now),
    );
    spentToday = await automationCreditsSince(
      dbAdapterQuerier(dbAdapter),
      automationId,
      utcDayStart(now),
    );
    failures = await readAutomationFailures(
      dbAdapterQuerier(dbAdapter),
      automationId,
    );
    let entry = await readInstance(url);
    let read = entry
      ? readAutomationDeclaration(entry, { automationTypeKey, virtualNetwork })
      : undefined;
    declaration = read?.ok ? read.declaration : undefined;
    payerShown =
      row.payer === viewer ||
      (await shareARealmGrant(dbAdapter, viewer, row.payer));
  }
  return {
    status: 200,
    document: automationStatusDocument({
      url: url.href,
      row,
      declaration,
      viewer,
      payerShown,
      now,
      lastRun,
      currentRun,
      failures,
      spentThisMonth,
      spentToday,
      lastRunUsage,
    }),
  };
}

// Builds the route's answer for the automation at `url`. `row` is its
// automation row, absent when it isn't switched on. `declaration` is the
// card as indexed, absent when the card doesn't read as one; then each
// trigger reports only its run count. `payerShown` says whether the viewer
// may see the payer's Matrix id. `lastRun` is the automation's last ended
// run, if it has one, `failures` its failure streak, and `spentThisMonth`
// what it was charged this UTC month.
export function automationStatusDocument({
  url,
  row,
  declaration,
  viewer,
  payerShown,
  now,
  lastRun = null,
  currentRun = null,
  failures,
  spentThisMonth = 0,
  spentToday = 0,
  lastRunUsage = null,
}: {
  url: string;
  row: AutomationRow | undefined;
  declaration: AutomationDeclaration | undefined;
  viewer: string;
  payerShown: boolean;
  // Unix seconds.
  now: number;
  lastRun?: AutomationLastRun | null;
  currentRun?: AutomationCurrentRun | null;
  // Read only for a switched-on automation, so absent when `row` is.
  failures: AutomationFailures | undefined;
  spentThisMonth?: number;
  spentToday?: number;
  lastRunUsage?: AutomationRunUsage | null;
}): AutomationStatusDocument {
  return {
    data: {
      type: AUTOMATION_STATUS_TYPE,
      id: url,
      attributes: row
        ? {
            switchedOn: true,
            webhookDeliveriesStartRuns: WEBHOOK_DELIVERIES_START_RUNS,
            state: row.state,
            pauseReason: row.pauseReason,
            pauseProblems: row.pauseProblems,
            payer: payerShown || row.payer === viewer ? row.payer : null,
            viewerIsPayer: row.payer === viewer,
            nextRun: isoOrNull(row.nextRun),
            lastResult: lastRunResult(lastRun),
            lastFinishedAt: lastRun?.finishedAt ?? null,
            failuresInARow: failures?.inARow ?? 0,
            lastFailure: failures?.last ?? null,
            monthlyCredits:
              typeof row.capsSnapshot.monthlyCredits === 'number'
                ? row.capsSnapshot.monthlyCredits
                : null,
            spentThisMonth,
            dailyCredits:
              typeof row.capsSnapshot.dailyCredits === 'number'
                ? row.capsSnapshot.dailyCredits
                : null,
            spentToday,
            triggers: triggerStatuses(row, declaration, now),
            lastRun,
            currentRun,
            lastRunUsage,
          }
        : {
            switchedOn: false,
            webhookDeliveriesStartRuns: WEBHOOK_DELIVERIES_START_RUNS,
            lastRun,
            currentRun,
            lastRunUsage,
          },
    },
  };
}

// What a run used of each per-run cap, from its row.
async function readRunUsage(
  querier: Querier,
  runId: string,
): Promise<AutomationRunUsage | null> {
  let [run] = (await querier([
    'SELECT call_api_calls, call_api_response_bytes, resolve_calls, ai_credits_spent, writes,',
    'EXTRACT(EPOCH FROM finished_at - started_at) AS seconds',
    'FROM automation_runs WHERE id =',
    param(runId),
  ])) as {
    call_api_calls: number;
    call_api_response_bytes: number | string;
    resolve_calls: number;
    ai_credits_spent: number | string;
    writes: number;
    seconds: number | string | null;
  }[];
  if (!run) {
    return null;
  }
  return {
    callApiCalls: Number(run.call_api_calls),
    responseBytes: Number(run.call_api_response_bytes),
    resolveCalls: Number(run.resolve_calls),
    aiCredits: Number(run.ai_credits_spent),
    writes: Number(run.writes),
    seconds: run.seconds === null ? null : Math.round(Number(run.seconds)),
  };
}

// How the automation's last run ended, read from the run itself, which every
// path that ends a run writes.
function lastRunResult(
  run: AutomationLastRun | null,
): AutomationRunResult | null {
  return run &&
    (run.state === 'complete' ||
      run.state === 'error' ||
      run.state === 'canceled')
    ? run.state
    : null;
}

// How long one answer may spend counting runs left, in milliseconds. A
// bounded trigger's count scans each slot up to its `until`, which takes tens
// of milliseconds for a daily trigger decades out, and a card may declare any
// number of triggers. Past the budget, the remaining triggers report no
// `runsLeft`, and the view shows their runs so far and their end alone.
export const RUNS_LEFT_BUDGET_MS = 250;

// Each trigger the card declares, in the card's order, with its run count
// from the row. The next run and whether a trigger is spent are computed at
// `now`, as the tick computes them, so a slot that came due and isn't
// enqueued yet reads as due now. Runs left are counted without `now`, so such
// a slot still counts as left. Without a declaration, each trigger the row
// has counted.
function triggerStatuses(
  row: AutomationRow,
  declaration: AutomationDeclaration | undefined,
  now: number,
): AutomationTriggerStatus[] {
  if (!declaration) {
    return Object.entries(row.triggerRuns).map(([label, state]) => ({
      label,
      runs: runsOf(state),
    }));
  }
  let schedule = computeAutomationSchedule({
    triggers: declaration.triggers,
    since: row.scheduledSince,
    runState: row.triggerRuns,
    now,
  });
  let scheduledByLabel = new Map(schedule.triggers.map((t) => [t.label, t]));
  let countingStarted = performance.now();
  return declaration.triggers.map((trigger) => {
    let label = trigger.label;
    let status: AutomationTriggerStatus = {
      label,
      runs: runsOf(row.triggerRuns[label]),
    };
    let scheduled = scheduledByLabel.get(label);
    if (!scheduled) {
      return status;
    }
    if (
      trigger.kind !== 'webhook' &&
      performance.now() - countingStarted < RUNS_LEFT_BUDGET_MS
    ) {
      let [counted] = computeAutomationSchedule({
        triggers: [trigger],
        since: row.scheduledSince,
        runState: { [label]: row.triggerRuns[label] },
        includeRemainingRuns: true,
      }).triggers;
      if (counted?.remainingRuns !== undefined) {
        status.runsLeft = counted.remainingRuns;
        if (counted.remainingRunsAtLeast) {
          status.runsLeftAtLeast = true;
        }
      }
    }
    let until = trigger.kind === 'once' ? trigger.at : scheduled.until;
    if (until !== undefined) {
      status.until = unixSecondsToISO(until);
    }
    if (scheduled.nextRun !== undefined) {
      status.nextRun = unixSecondsToISO(scheduled.nextRun);
    }
    status.spent = scheduled.spent;
    return status;
  });
}

function runsOf(state: TriggerRunState | undefined): number {
  return state?.runs ?? 0;
}

function isoOrNull(seconds: number | null): string | null {
  return seconds === null ? null : unixSecondsToISO(seconds);
}

function unixSecondsToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
