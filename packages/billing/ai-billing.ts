import {
  getUserByMatrixUserId,
  spendCredits,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import {
  type DBAdapter,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
  logger,
  retry,
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

export async function saveUsageCost(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  generationId: string,
  openRouterApiKey: string,
) {
  try {
    // Generation data is sometimes not immediately available, so we retry a couple of times until we are able to get the cost
    let costInUsd = await retry(
      () => fetchGenerationCost(generationId, openRouterApiKey),
      {
        retries: 10,
        delayMs: 500,
      },
    );

    if (costInUsd === null) {
      log.warn(`Could not fetch cost for generation ${generationId}`);
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

    log.info(
      `Deducted ${creditsConsumed} credits from user ${matrixUserId} for generation ${generationId} (cost: $${costInUsd})`,
    );

    // TODO: send a signal to the host app to update credits balance displayed in the UI
  } catch (err) {
    log.error(
      `Failed to track AI usage (matrixUserId: ${matrixUserId}, generationId: ${generationId}):`,
      err,
    );
    Sentry.captureException(err);
    // Don't throw, because we don't want to crash the application over this
  }
}

async function fetchGenerationCost(
  generationId: string,
  openRouterApiKey: string,
): Promise<number | null> {
  const response = await fetch(
    `https://openrouter.ai/api/v1/generation?id=${generationId}`,
    {
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
      },
    },
  );

  const data = await response.json();

  if (data.error && data.error.message.includes('not found')) {
    return null;
  }

  return data.data.total_cost;
}

export function extractGenerationIdFromResponse(
  response: any,
): string | undefined {
  // OpenRouter responses typically include a generation_id in the response
  // This might be in different places depending on the endpoint
  if (response.id) {
    return response.id;
  }

  if (response.choices && response.choices[0] && response.choices[0].id) {
    return response.choices[0].id;
  }

  // For chat completions, the generation ID might be in usage
  if (response.usage && response.usage.generation_id) {
    return response.usage.generation_id;
  }

  return undefined;
}
