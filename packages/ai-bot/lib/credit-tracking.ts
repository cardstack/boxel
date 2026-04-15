import { logger, delay } from '@cardstack/runtime-common';

let log = logger('ai-bot');

const CREDIT_TRACKING_TIMEOUT_MS = 5_000;

/**
 * Waits for any pending credit tracking to complete before starting
 * a new generation. This prevents generating responses when the previous
 * generation's cost hasn't been recorded yet.
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
