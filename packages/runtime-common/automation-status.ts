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
} from './automation-declaration.ts';
import {
  computeAutomationSchedule,
  type TriggerRunState,
} from './automation-schedule.ts';
import {
  getAutomation,
  type AutomationPauseReason,
  type AutomationRow,
  type AutomationRunResult,
  type AutomationState,
} from './automations.ts';
import type { DBAdapter } from './db.ts';
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

export type AutomationStatusAttributes =
  | { switchedOn: false }
  | {
      switchedOn: true;
      state: AutomationState;
      pauseReason: AutomationPauseReason | null;
      // The payer's Matrix id, or null when the viewer may not see who pays.
      payer: string | null;
      viewerIsPayer: boolean;
      // ISO time: the earliest next run across the triggers, or null.
      nextRun: string | null;
      lastResult: AutomationRunResult | null;
      lastFinishedAt: string | null;
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
  let row = await getAutomation(
    dbAdapter,
    virtualNetwork.unresolveURL(url.href),
  );
  let declaration: AutomationDeclaration | undefined;
  let payerShown = false;
  if (row) {
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
    }),
  };
}

// Builds the route's answer for the automation at `url`. `row` is its
// automation row, absent when it isn't switched on. `declaration` is the
// card as indexed, absent when the card doesn't read as one; then each
// trigger reports only its run count. `payerShown` says whether the viewer
// may see the payer's Matrix id.
export function automationStatusDocument({
  url,
  row,
  declaration,
  viewer,
  payerShown,
}: {
  url: string;
  row: AutomationRow | undefined;
  declaration: AutomationDeclaration | undefined;
  viewer: string;
  payerShown: boolean;
}): AutomationStatusDocument {
  return {
    data: {
      type: AUTOMATION_STATUS_TYPE,
      id: url,
      attributes: row
        ? {
            switchedOn: true,
            state: row.state,
            pauseReason: row.pauseReason,
            payer: payerShown || row.payer === viewer ? row.payer : null,
            viewerIsPayer: row.payer === viewer,
            nextRun: isoOrNull(row.nextRun),
            lastResult: row.lastResult,
            lastFinishedAt: row.lastFinishedAt,
            triggers: triggerStatuses(row, declaration),
          }
        : { switchedOn: false },
    },
  };
}

// Each trigger the card declares, in the card's order, with its run count
// from the row. The schedule runs from the row's `since` and run counts with
// no `now`, so a slot that has passed but hasn't been enqueued yet still
// counts as left, as the card's view wants. Without a declaration, each
// trigger the row has counted.
function triggerStatuses(
  row: AutomationRow,
  declaration: AutomationDeclaration | undefined,
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
    includeRemainingRuns: true,
  });
  let scheduledByLabel = new Map(schedule.triggers.map((t) => [t.label, t]));
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
    if (scheduled.remainingRuns !== undefined) {
      status.runsLeft = scheduled.remainingRuns;
      if (scheduled.remainingRunsAtLeast) {
        status.runsLeftAtLeast = true;
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
