// The `job` realm event: what tells a realm's direct writers that one of its
// automation runs moved. A run moves through its states (`automation-runs.ts`),
// through three steps within an attempt (admission, the script, the commit),
// and through the run milestones its script reports. Each process that moves a
// run reports it with a `ReportRunChange`, which reads the run's row as it
// stands and sends the event. Reading the row, rather than describing the
// change, means two changes reported in the wrong order still leave a
// subscriber with the run as it is.
//
// The event is delivered by `Realm.broadcastJobEvent`, which sends it only to
// the realm's direct writers' session rooms: the run's progress is theirs to
// watch, as the console that shows it is theirs.

import type { JobEventContent } from '@cardstack/base/matrix-event';

import type { AutomationRun } from './automation-runs.ts';
import { getAutomationRun } from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';
import { ensureTrailingSlash } from './paths.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export type AutomationRunStep = NonNullable<JobEventContent['step']>;

// Reports that a run moved: its state, its step or its run milestone changed.
// It never rejects, since a run's progress doesn't depend on anyone hearing
// about it; a report that fails is logged.
export type ReportRunChange = (runId: string) => Promise<void>;

// The step the run's row says it is in, or for an ended run the step it got
// to. A run no attempt has started has none. An attempt admits the run before
// it runs the script and claims the commit after, and an attempt that takes
// the run over from another clears the admission (unless the commit was
// claimed), so the row tells the three apart.
export function automationRunStep(
  run: Pick<AutomationRun, 'startedAt' | 'admittedAt' | 'commitStartedAt'>,
): AutomationRunStep | null {
  if (run.commitStartedAt) {
    return 'commit';
  }
  if (run.admittedAt) {
    return 'script';
  }
  return run.startedAt ? 'admission' : null;
}

// The `job` event for the run as its row stands, or undefined when there is
// no such run.
export async function readJobEvent(
  dbAdapter: DBAdapter,
  runId: string,
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>,
): Promise<JobEventContent | undefined> {
  let run = await getAutomationRun(dbAdapter, runId);
  if (!run) {
    return undefined;
  }
  let [last] = (await query(dbAdapter, [
    'SELECT name FROM automation_run_milestones WHERE run_id =',
    param(runId),
    'ORDER BY position DESC LIMIT 1',
  ])) as { name: string }[];
  return {
    eventName: 'job',
    runId: run.id,
    automation: virtualNetwork.toURLHref(run.automationId),
    state: run.state,
    step: automationRunStep(run),
    milestone: last ? String(last.name) : null,
    realmURL: ensureTrailingSlash(virtualNetwork.toURLHref(run.realm)),
  };
}

// A `ReportRunChange` that reads the run's event and hands it to `send`,
// which delivers it to the run's realm: `Realm.broadcastJobEvent` in the realm
// server, or the worker's request to the realm server to do that.
export function runChangeReporter({
  dbAdapter,
  virtualNetwork,
  send,
  log,
}: {
  dbAdapter: DBAdapter;
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  send: (event: JobEventContent) => void | Promise<void>;
  log: { warn: (...args: any[]) => void };
}): ReportRunChange {
  return async (runId) => {
    try {
      let event = await readJobEvent(dbAdapter, runId, virtualNetwork);
      if (event) {
        await send(event);
      }
    } catch (e: any) {
      log.warn(
        `could not send the job event for automation run ${runId}: ${e?.message ?? e}`,
      );
    }
  };
}

// The reporter a worker task uses. A worker holds no Matrix client, so the
// event goes to the realm server through `reportRealmEvent`, and the realm
// delivers it as `Realm.broadcastJobEvent` does. Undefined for a task given no
// way to send realm events, such as one a test harness runs.
export function taskRunChangeReporter({
  dbAdapter,
  virtualNetwork,
  reportRealmEvent,
  log,
}: {
  dbAdapter: DBAdapter;
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  reportRealmEvent: ((event: JobEventContent) => void) | undefined;
  log: { warn: (...args: any[]) => void };
}): ReportRunChange | undefined {
  return reportRealmEvent
    ? runChangeReporter({
        dbAdapter,
        virtualNetwork,
        send: reportRealmEvent,
        log,
      })
    : undefined;
}

// Reports each run, in order, when there is a reporter.
export async function reportRunChanges(
  report: ReportRunChange | undefined,
  runs: readonly Pick<AutomationRun, 'id'>[],
): Promise<void> {
  if (!report) {
    return;
  }
  for (let run of runs) {
    await report(run.id);
  }
}
