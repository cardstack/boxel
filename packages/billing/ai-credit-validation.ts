import { type DBAdapter } from '@cardstack/runtime-common';
import { MINIMUM_AI_CREDITS_TO_CONTINUE } from '@cardstack/runtime-common';
import { getUserByMatrixUserId, sumUpCreditsLedger } from './billing-queries';

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
