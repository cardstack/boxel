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
const MAX_FETCH_ATTEMPTS = 10;
const MAX_FETCH_RUNTIME_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_BACKOFF_MS = 1000;

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
    let costInUsd = await fetchGenerationCostWithBackoff(
      generationId,
      openRouterApiKey,
    );

    if (costInUsd === null) {
      let error = new Error(
        `Failed to fetch generation cost after retries (generationId: ${generationId})`,
      );
      log.error(error);
      Sentry.captureException(error);
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
      `Failed to track AI usage (matrixUserId: ${matrixUserId}, generationId: ${generationId}):`,
      err,
    );
    Sentry.captureException(err);
    // Don't throw, because we don't want to crash the application over this
  }
}

async function fetchGenerationCostWithBackoff(
  generationId: string,
  openRouterApiKey: string,
): Promise<number | null> {
  let startedAt = Date.now();
  let delayMs = INITIAL_BACKOFF_MS;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      let cost = await fetchGenerationCost(generationId, openRouterApiKey);
      if (cost !== null) {
        return cost;
      }
    } catch (error) {
      log.warn(
        `Attempt ${attempt} to fetch generation cost failed (generationId: ${generationId})`,
        error,
      );
    }

    let elapsed = Date.now() - startedAt;
    if (attempt === MAX_FETCH_ATTEMPTS || elapsed >= MAX_FETCH_RUNTIME_MS) {
      break;
    }

    let remainingTime = MAX_FETCH_RUNTIME_MS - elapsed;
    let sleepMs = Math.min(delayMs, remainingTime);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    delayMs = Math.min(delayMs * 2, MAX_FETCH_RUNTIME_MS);
  }

  throw new Error(
    `Failed to fetch generation cost within ${MAX_FETCH_ATTEMPTS} attempts or ${MAX_FETCH_RUNTIME_MS / 60000} minutes (generationId: ${generationId})`,
  );
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
