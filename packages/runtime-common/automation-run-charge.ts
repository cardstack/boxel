import { getAutomationRun, type AutomationRun } from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import {
  BYTES_PER_GB,
  type MeteredCharges,
  type MeteredUsage,
} from './metered-charges.ts';
import { withRunIndexingRetries } from './run-indexing.ts';

// A run's own compute and network, charged to the run's identity
// (`automation_runs.acts_as`: the payer for a scheduled run, the person who
// clicked for a Preview or Run now) as one `run` charge referencing the run,
// once the run has ended (ADR 029 §1.1):
//
// - compute: the prerender tab time its script took, summed over the
//   attempts that ran it (`prerender_tab_ms`), each held to the time the run
//   had left when it started, priced per tab-second. Every `callApi`
//   transform runs inside the script, so its time is part of the tab time.
// - network: the bytes its `callApi` calls downloaded
//   (`call_api_response_bytes`, metered by the realm server), in GB of
//   `BYTES_PER_GB`.
//
// The indexing the run's commit causes is a separate `run_indexing` charge
// (see `run-indexing.ts`), and its AI requests are billed as they are made.

type Log = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, ...args: unknown[]): void;
};

const ENDED_STATES = new Set<AutomationRun['state']>([
  'complete',
  'error',
  'canceled',
]);

// What a run's `run` charge prices, from its row.
export function automationRunUsage(
  run: Pick<AutomationRun, 'prerenderTabMs' | 'callApiResponseBytes'>,
): Required<Pick<MeteredUsage, 'prerender_tab_seconds' | 'downloaded_gb'>> {
  return {
    prerender_tab_seconds: run.prerenderTabMs / 1000,
    downloaded_gb: run.callApiResponseBytes / BYTES_PER_GB,
  };
}

// Charges the run's compute and network, priced from its row, once the run
// has ended: complete, an error or canceled, each for the tab time and bytes
// it used. A pending or running run is left uncharged: the attempt that
// runs it charges it when it ends, and a run closed without an attempt
// (`abandonAutomationRun`) is charged by whoever closes it. A run that used
// no tab time and downloaded nothing, such as one canceled before it
// started, has nothing to charge.
//
// The charge is written once per run (see `spendCredits`), so calling this
// again, from a retry or from an attempt that ends after another attempt
// charged the run, charges nothing more. It is priced from what the row holds
// when it is first written. Attempts usually run one after another, so that
// covers every attempt. An attempt a retry replaced can still be in its tab,
// though, and when its tab answers after the newer attempt has ended the run
// and charged it, its time reaches the row but isn't billed.
//
// It never throws. A transient failure is retried a few times (see
// `withRunIndexingRetries`), and a charge that still can't be written is
// logged, since the run has already ended and its work can't be undone.
export async function chargeAutomationRun({
  dbAdapter,
  meteredCharges,
  runId,
  log,
  attemptDelaysMs,
}: {
  dbAdapter: DBAdapter;
  meteredCharges: MeteredCharges | undefined;
  runId: string;
  log: Log;
  attemptDelaysMs?: readonly number[];
}): Promise<void> {
  try {
    await withRunIndexingRetries(async () => {
      let run = await getAutomationRun(dbAdapter, runId);
      if (!run) {
        log.warn(`not charging run ${runId}: the run no longer exists`);
        return;
      }
      if (!ENDED_STATES.has(run.state)) {
        return;
      }
      let usage = automationRunUsage(run);
      let measured = `${usage.prerender_tab_seconds.toFixed(3)} prerender-tab seconds and ${run.callApiResponseBytes} bytes downloaded`;
      if (usage.prerender_tab_seconds === 0 && usage.downloaded_gb === 0) {
        log.info(`not charging run ${runId}: it used nothing to charge for`);
        return;
      }
      if (!meteredCharges) {
        log.warn(
          `not charging run ${runId} (${measured}): this worker writes no metered charges`,
        );
        return;
      }
      let result = await meteredCharges.charge({
        payer: run.actsAs,
        charge: { kind: 'run', realm: run.realm, runId },
        usage,
      });
      let message = `run ${runId} in ${run.realm} for ${run.actsAs} (${measured}): ${result}`;
      if (result === 'no-prices' || result === 'no-payer') {
        log.error(`could not charge ${message}`);
      } else {
        log.info(`charged ${message}`);
      }
    }, attemptDelaysMs);
  } catch (e) {
    log.error(`failed to charge run ${runId}`, e);
  }
}
