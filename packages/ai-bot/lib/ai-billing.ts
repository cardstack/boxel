import {
  getCurrentActiveSubscription,
  getUserByMatrixUserId,
  spendCredits,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { PgAdapter, TransactionManager } from '@cardstack/postgres';
import { logger, retry } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

let log = logger('ai-bot');

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

    let creditsConsumed = Math.round(costInUsd / 0.001);

    let user = await getUserByMatrixUserId(pgAdapter, matrixUserId);

    // This check is for the transition period where we don't have subscriptions fully rolled out yet.
    // When we have assurance that all users who use the bot have subscriptions, we can remove this subscription check.
    let subscription = await getCurrentActiveSubscription(pgAdapter, user!.id);
    if (!subscription) {
      log.info(
        `user ${matrixUserId} has no subscription, skipping credit usage tracking`,
      );
      return Promise.resolve();
    }

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

export async function getAvailableCredits(
  pgAdapter: PgAdapter,
  matrixUserId: string,
) {
  let user = await getUserByMatrixUserId(pgAdapter, matrixUserId);

  if (!user) {
    throw new Error(
      `should not happen: user with matrix id ${matrixUserId} not found in the users table`,
    );
  }

  let availableCredits = await sumUpCreditsLedger(pgAdapter, {
    userId: user.id,
  });

  return availableCredits;
}

async function fetchGenerationCost(generationId: string) {
  let response = await (
    await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    })
  ).json();

  if (response.error && response.error.includes('not found')) {
    return null;
  }

  return response.data.total_cost;
}
