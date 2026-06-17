import { logger, delay, type DBAdapter } from '@cardstack/runtime-common';
import {
  spendUsageCost,
  fetchGenerationCostWithBackoff,
} from '@cardstack/billing/ai-billing';

let log = logger('ai-bot');

const CREDIT_TRACKING_TIMEOUT_MS = 5_000;

/**
 * Waits for any pending fallback credit tracking to complete before starting
 * a new generation. The primary serialization is now the per-user
 * `withUserCostLock` barrier around generate → debit (see main.ts); this
 * remains a secondary net for the rare fallback path below, whose debit lands
 * outside the lock.
 *
 * Uses a timeout to avoid blocking indefinitely when
 * fetchGenerationCostWithBackoff is retrying with exponential backoff
 * (which can take up to 10 minutes). The real credit safety net is
 * validateAICredits() which checks the user's balance before every generation.
 */
export async function waitForPendingCreditTracking(
  trackAiUsageCostPromises: Map<string, Promise<void>>,
  matrixUserId: string,
): Promise<{ error?: unknown }> {
  let pendingCreditsConsumptionPromise =
    trackAiUsageCostPromises.get(matrixUserId);
  if (pendingCreditsConsumptionPromise) {
    try {
      await Promise.race([
        pendingCreditsConsumptionPromise,
        delay(CREDIT_TRACKING_TIMEOUT_MS),
      ]);
    } catch (e) {
      log.error(e);
      return { error: e };
    }
  }
  return {};
}

/**
 * Fire-and-forget fallback for the rare case where the stream reported no
 * inline cost. `fetchGenerationCostWithBackoff` can retry for up to 10
 * minutes, so this must NOT be awaited inside `withUserCostLock` — we cannot
 * pin a DB connection that long. The debit therefore lands outside the
 * per-user lock; `waitForPendingCreditTracking` is the best-effort net that
 * makes the next same-user request wait (bounded) for it.
 *
 * Each scheduled fallback always performs its own debit — unlike the old
 * per-process barrier it never early-returns when another debit is pending,
 * so concurrent costs are not coalesced away.
 *
 * The map entry is the chain of ALL pending fallback debits for the user
 * (the new work joined to whatever was already pending), so
 * waitForPendingCreditTracking waits for every still-in-flight debit. The
 * entry is removed only while it still points at this chain, so an earlier
 * debit settling can't unlink a newer fallback that overwrote it.
 */
export function scheduleFallbackCostTracking(opts: {
  dbAdapter: DBAdapter;
  matrixUserId: string;
  generationId: string;
  openRouterApiKey: string;
  trackAiUsageCostPromises: Map<string, Promise<void>>;
}): void {
  let {
    dbAdapter,
    matrixUserId,
    generationId,
    openRouterApiKey,
    trackAiUsageCostPromises,
  } = opts;

  let work = (async () => {
    log.info(
      `No inline cost for user ${matrixUserId}, falling back to generation cost API (generationId: ${generationId})`,
    );
    let fetchedCost = await fetchGenerationCostWithBackoff(
      generationId,
      openRouterApiKey,
    );
    if (fetchedCost !== null) {
      await spendUsageCost(dbAdapter, matrixUserId, fetchedCost);
    } else {
      log.warn(
        `Failed to fetch generation cost for user ${matrixUserId} (generationId: ${generationId}), credit deduction skipped`,
      );
    }
  })();

  let prior = trackAiUsageCostPromises.get(matrixUserId);
  let tracked: Promise<void> = (
    prior ? Promise.allSettled([prior, work]).then(() => undefined) : work
  ).finally(() => {
    if (trackAiUsageCostPromises.get(matrixUserId) === tracked) {
      trackAiUsageCostPromises.delete(matrixUserId);
    }
  });
  trackAiUsageCostPromises.set(matrixUserId, tracked);
}
