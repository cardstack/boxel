import {
  getUserByMatrixUserId,
  spendCredits,
} from '@cardstack/billing/billing-queries';
import { PgAdapter, TransactionManager } from '@cardstack/postgres';
import { logger, retry } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

let log = logger('ai-bot');

const CREDITS_PER_USD = 1000;

export async function saveUsageCost(
  pgAdapter: PgAdapter,
  matrixUserId: string,
  generationId: string,
) {
  try {
    // Generation data is sometimes not immediately available, so we retry a couple of times until we are able to get the cost
    let costInUsd = await retry(() => fetchGenerationCost(generationId), {
      retries: 10,
      delayMs: 500,
    });

    let creditsConsumed = Math.round(costInUsd * CREDITS_PER_USD);

    let user = await getUserByMatrixUserId(pgAdapter, matrixUserId);

    if (!user) {
      throw new Error(
        `should not happen: user with matrix id ${matrixUserId} not found in the users table`,
      );
    }

    let txManager = new TransactionManager(pgAdapter);

    await txManager.withTransaction(async () => {
      await spendCredits(pgAdapter, user!.id, creditsConsumed);

      // TODO: send a signal to the host app to update credits balance displayed in the UI
    });
  } catch (err) {
    log.error(
      `Failed to track AI usage (matrixUserId: ${matrixUserId}, generationId: ${generationId}):`,
      err,
    );
    Sentry.captureException(err);
    // Don't throw, because we don't want to crash the bot over this
  }
}

async function fetchGenerationCost(generationId: string) {
  let response = await (
    await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    })
  ).json();

  if (response.error && response.error.message.includes('not found')) {
    return null;
  }

  return response.data.total_cost;
}
