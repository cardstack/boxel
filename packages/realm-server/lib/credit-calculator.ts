import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

const log = logger('credit-calculator');
const CREDITS_PER_USD = 1000;

export async function calculateCreditsForOpenRouter(
  response: any,
  openRouterApiKey: string,
  generationId?: string,
): Promise<number> {
  // Try to extract generation ID from response if not provided
  const actualGenerationId =
    generationId || extractGenerationIdFromResponse(response);

  if (!actualGenerationId) {
    // If no generation ID in response, we can't calculate credits
    log.warn(
      'No generation ID found in OpenRouter response, cannot calculate credits',
    );
    return 0;
  }

  try {
    // Fetch cost from OpenRouter API using the same logic as AI bot
    const costInUsd = await fetchGenerationCost(
      actualGenerationId,
      openRouterApiKey,
    );

    if (costInUsd === null) {
      log.warn(`Could not fetch cost for generation ${actualGenerationId}`);
      return 0;
    }

    const creditsConsumed = Math.round(costInUsd * CREDITS_PER_USD);
    log.info(
      `Calculated ${creditsConsumed} credits for generation ${actualGenerationId} (cost: $${costInUsd})`,
    );

    return creditsConsumed;
  } catch (error) {
    log.error(
      `Error calculating credits for generation ${generationId}:`,
      error,
    );
    Sentry.captureException(error);
    return 0;
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
