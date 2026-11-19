import {
  getUserByMatrixUserId,
  spendCredits,
  sumUpAvailableCredits,
  type SpendResult,
} from './billing-queries.ts';
import {
  type ChargeUsage,
  type DBAdapter,
  type SpendCharge,
  CREDITS_PER_USD,
  MINIMUM_AI_CREDITS_TO_CONTINUE,
  logger,
  delay,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

const log = logger('ai-billing');

const MAX_FETCH_ATTEMPTS = 10;
const MAX_FETCH_RUNTIME_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_DELAY_MS = 60 * 1000; // 60 seconds

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

  return await sumUpAvailableCredits(dbAdapter, user.id);
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

// Charges an AI provider's reported cost, in USD, to the user. `charge` says
// what it paid for: an AI call, by default, or a batch billed when it ends.
// The charge records the provider's cost as its `ai_provider_usd` usage,
// beside any token counts the caller passes in `usage`.
export async function spendUsageCost(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  costInUsd: number,
  charge: Extract<SpendCharge, { kind: 'ai' | 'batched_ai' }> = { kind: 'ai' },
  usage: Pick<ChargeUsage, 'ai_input_tokens' | 'ai_output_tokens'> = {},
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

    await spendCredits(dbAdapter, user.id, creditsConsumed, charge, {
      ...usage,
      ai_provider_usd: costInUsd,
    });
  } catch (err) {
    log.error(
      `Failed to spend usage cost (matrixUserId: ${matrixUserId}, costInUsd: ${costInUsd}):`,
      err,
    );
    Sentry.captureException(err);
  }
}

// What charging a batch did: what `spendCredits` did (`charged`,
// `already-charged`, or `nothing-to-charge` when the payer's buckets held
// nothing, or the cost rounds to no credit), or `no-payer` when the person the
// batch is billed to has no `users` row.
export type AIBatchChargeResult = SpendResult | 'no-payer';

// Charges a batch of AI requests once it ends (ADR 030 §1.4): `usd` to
// `payer`, the Matrix user id its run acted as, at 1,000 credits to the dollar
// with no margin, rounded to the nearest credit as every AI charge is. `usd`
// is the cost the provider reported, recorded as `ai_provider_usd`, or, when
// `estimated`, the estimate made at submit, recorded as `ai_estimated_usd` so
// the cost coverage report can tell the two apart. A batch is charged once:
// a retry finds the charge in the ledger and writes nothing. Holds the payer's
// cost lock around the spend.
export async function chargeAIBatch(
  dbAdapter: DBAdapter,
  {
    payer,
    charge,
    usd,
    estimated,
  }: {
    payer: string;
    charge: Extract<SpendCharge, { kind: 'batched_ai' }>;
    usd: number;
    estimated: boolean;
  },
): Promise<AIBatchChargeResult> {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(
      `a batch is charged a finite number of USD, 0 or more, not ${usd}`,
    );
  }
  let user = await getUserByMatrixUserId(dbAdapter, payer);
  if (!user) {
    return 'no-payer';
  }
  let userId = user.id;
  let credits = Math.round(usd * CREDITS_PER_USD);
  return await dbAdapter.withUserCostLock(payer, () =>
    spendCredits(
      dbAdapter,
      userId,
      credits,
      charge,
      estimated ? { ai_estimated_usd: usd } : { ai_provider_usd: usd },
    ),
  );
}

// Sends the cost lookup. The realm-server passes its guarded outbound client;
// a caller that passes nothing uses `fetch`.
export type GenerationCostFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Response>;

export interface GenerationCostLookupOptions {
  fetch?: GenerationCostFetch;
  // Whether a failed attempt is worth repeating. A failure that will fail
  // the same way every time, such as the destination being refused, ends the
  // lookup at once instead of backing off for minutes.
  isRetryable?: (error: unknown) => boolean;
}

export async function fetchGenerationCostWithBackoff(
  generationId: string,
  openRouterApiKey: string,
  options: GenerationCostLookupOptions = {},
): Promise<number | null> {
  let sendLookup: GenerationCostFetch =
    options.fetch ?? ((url, init) => fetch(url, init));
  let isRetryable = options.isRetryable ?? (() => true);
  let startedAt = Date.now();
  let delayMs = INITIAL_BACKOFF_MS;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      let cost = await fetchGenerationCost(
        generationId,
        openRouterApiKey,
        sendLookup,
      );
      if (cost !== null) {
        return cost;
      }
    } catch (error) {
      log.warn(
        `Attempt ${attempt} to fetch generation cost failed (generationId: ${generationId})`,
        error,
      );
      if (!isRetryable(error)) {
        log.error(
          `Fetching generation cost failed in a way retrying cannot fix (generationId: ${generationId})`,
        );
        return null;
      }
    }

    let elapsed = Date.now() - startedAt;
    if (attempt === MAX_FETCH_ATTEMPTS || elapsed >= MAX_FETCH_RUNTIME_MS) {
      break;
    }

    let remainingTime = MAX_FETCH_RUNTIME_MS - elapsed;
    let sleepMs = Math.min(delayMs, remainingTime);
    await delay(sleepMs);
    delayMs = Math.min(delayMs * 2, MAX_BACKOFF_DELAY_MS);
  }

  log.error(
    `Failed to fetch generation cost within ${MAX_FETCH_ATTEMPTS} attempts or ${Math.round(MAX_FETCH_RUNTIME_MS / 60000)} minutes (generationId: ${generationId})`,
  );
  return null;
}

async function fetchGenerationCost(
  generationId: string,
  openRouterApiKey: string,
  sendLookup: GenerationCostFetch,
): Promise<number | null> {
  const response = await sendLookup(
    `https://openrouter.ai/api/v1/generation?id=${generationId}`,
    {
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
      },
    },
  );

  // The body of an answer that isn't read is cancelled, so the connection is
  // released at once.
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `OpenRouter API returned ${response.status}: ${response.statusText}`,
    );
  }

  const data = await response.json();

  if (data.error) {
    if (data.error.message?.includes('not found')) {
      return null;
    }
    throw new Error(`OpenRouter API error: ${data.error.message}`);
  }

  return data.data.total_cost;
}
