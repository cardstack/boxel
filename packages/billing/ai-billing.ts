import {
  getUserByMatrixUserId,
  spendCredits,
  sumUpCreditsLedger,
} from './billing-queries';
import {
  type DBAdapter,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
  logger,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

const log = logger('ai-billing');

const CREDITS_PER_USD = 1000;

export interface AICreditValidationResult {
  hasEnoughCredits: boolean;
  availableCredits: number;
}

/**
 * Gets the available credits for a user by their matrix user ID.
 * This is a private function used internally by validateAICredits.
 */
async function getAvailableCredits(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<number> {
  const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
  if (!user) {
    throw new Error(
      `should not happen: user with matrix id ${matrixUserId} not found in the users table`,
    );
  }

  return await sumUpCreditsLedger(dbAdapter, {
    userId: user.id,
    creditType: [
      'plan_allowance',
      'plan_allowance_used',
      'plan_allowance_expired',
      'daily_credit',
      'daily_credit_used',
      'extra_credit',
      'extra_credit_used',
    ],
  });
}

/**
 * Validates if a user has enough credits to continue using AI features.
 * This function can be reused across different packages that need AI credit validation.
 *
 * @param dbAdapter - Database adapter for querying user data
 * @param matrixUserId - Matrix user ID to check credits for
 * @returns Promise<AICreditValidationResult>
 */
export async function validateAICredits(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<AICreditValidationResult> {
  const availableCredits = await getAvailableCredits(dbAdapter, matrixUserId);

  return {
    hasEnoughCredits: availableCredits >= MINIMUM_AI_CREDITS_TO_CONTINUE,
    availableCredits,
  };
}

export async function spendUsageCost(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  costInUsd: number,
) {
  try {
    if (
      typeof costInUsd !== 'number' ||
      !Number.isFinite(costInUsd) ||
      costInUsd < 0
    ) {
      log.warn(
        `Invalid costInUsd value: ${costInUsd} for user ${matrixUserId}, skipping`,
      );
      return;
    }

    let creditsConsumed = Math.round(costInUsd * CREDITS_PER_USD);
    let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);

    if (!user) {
      throw new Error(
        `should not happen: user with matrix id ${matrixUserId} not found in the users table`,
      );
    }

    await spendCredits(dbAdapter, user.id, creditsConsumed);
  } catch (err) {
    log.error(
      `Failed to spend usage cost (matrixUserId: ${matrixUserId}, costInUsd: ${costInUsd}):`,
      err,
    );
    Sentry.captureException(err);
  }
}
