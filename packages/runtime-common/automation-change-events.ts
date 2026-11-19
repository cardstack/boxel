// The `automation` realm event: what tells a realm's direct writers that one
// of its automations changed without a run of it moving. An automation's row
// changes when a direct writer switches it on, pauses, resumes or removes it,
// when something pauses it without a person (a raised cap, the payer losing
// access, archiving the realm), when its card is deleted or stops being an
// automation, and when it moves between active, waiting for credits and done.
// Each process that changes a row reports it with a `ReportAutomationChange`
// once the change has committed. A change that moves a run reports that run
// with a `ReportRunChange` (`automation-run-events.ts`) as well.
//
// The event names the automation and nothing else, so it can't go stale: a
// subscriber reads the automation again on it. The realm delivers it as it
// delivers `job` (`Realm.broadcastAutomationEvent`), to its direct writers'
// session rooms alone, read as the event is sent.

import type { AutomationEventContent } from '@cardstack/base/matrix-event';

import type { AutomationRow } from './automations.ts';
import { ensureTrailingSlash } from './paths.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// The automation a change was made to: its card's identifier and its realm,
// which a removed automation's row no longer holds.
export type ChangedAutomation = Pick<AutomationRow, 'automationId' | 'realm'>;

// Reports that an automation's row changed. It never rejects, since the
// change doesn't depend on anyone hearing about it; a report that fails is
// logged.
export type ReportAutomationChange = (
  automation: ChangedAutomation,
) => Promise<void>;

// The `automation` event for an automation.
export function automationEvent(
  { automationId, realm }: ChangedAutomation,
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>,
): AutomationEventContent {
  return {
    eventName: 'automation',
    automation: automationId,
    realmURL: ensureTrailingSlash(virtualNetwork.toURLHref(realm)),
  };
}

// A `ReportAutomationChange` that hands the automation's event to `send`,
// which delivers it to the automation's realm: `Realm.broadcastAutomationEvent`
// in the realm server, or the worker's request to the realm server to do that.
export function automationChangeReporter({
  virtualNetwork,
  send,
  log,
}: {
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  send: (event: AutomationEventContent) => void | Promise<void>;
  log: { warn: (...args: any[]) => void };
}): ReportAutomationChange {
  return async (automation) => {
    try {
      await send(automationEvent(automation, virtualNetwork));
    } catch (e: any) {
      log.warn(
        `could not send the automation event for ${automation.automationId}: ${e?.message ?? e}`,
      );
    }
  };
}

// The reporter a worker task uses. A worker holds no Matrix client, so the
// event goes to the realm server through `reportRealmEvent`, and the realm
// delivers it as `Realm.broadcastAutomationEvent` does. Undefined for a task
// given no way to send realm events, such as one a test harness runs.
export function taskAutomationChangeReporter({
  virtualNetwork,
  reportRealmEvent,
  log,
}: {
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  reportRealmEvent: ((event: AutomationEventContent) => void) | undefined;
  log: { warn: (...args: any[]) => void };
}): ReportAutomationChange | undefined {
  return reportRealmEvent
    ? automationChangeReporter({ virtualNetwork, send: reportRealmEvent, log })
    : undefined;
}

// Reports each automation once, in order, when there is a reporter.
export async function reportAutomationChanges(
  report: ReportAutomationChange | undefined,
  automations: readonly ChangedAutomation[],
): Promise<void> {
  if (!report) {
    return;
  }
  let seen = new Set<string>();
  for (let automation of automations) {
    if (seen.has(automation.automationId)) {
      continue;
    }
    seen.add(automation.automationId);
    await report(automation);
  }
}
