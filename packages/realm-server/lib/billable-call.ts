import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import {
  releaseBillableCall,
  reserveBillableCall,
} from '@cardstack/billing/billing-queries';
import * as Sentry from '@sentry/node';

import type { CreditStrategy } from './credit-strategies.ts';

const log = logger('billable-call');

// How many billable upstream calls one user may have running at once, across
// every replica. A user's balance only reflects a call once its cost is
// recorded, so every call admitted while others are still running is checked
// against the same balance: this is the most a user can overspend by, counted
// in calls. It is sized so a page that asks for a handful of generations at
// once gets them all in parallel.
export const MAX_IN_FLIGHT_CALLS_PER_USER = 8;

// How long an admitted call counts toward that limit if the replica running it
// dies before releasing it. Longer than the slowest call that ends normally,
// which includes polling the provider for a cost the response did not carry
// (up to ten minutes).
export const RESERVATION_TTL_MS = 15 * 60 * 1000;

// A call arriving while the user is at the limit waits for one of their calls
// to finish. Those end on replicas this one cannot hear from, so the wait
// polls, backing off toward the ceiling.
const CAPACITY_POLL_INITIAL_MS = 100;
const CAPACITY_POLL_MAX_MS = 2000;

export interface BillableCallOptions {
  dbAdapter: DBAdapter;
  matrixUserId: string;
  creditStrategy: CreditStrategy;
  // Fires when the client that asked for the call goes away. A call still
  // waiting to be admitted stops waiting, rejecting with the signal's reason.
  signal: AbortSignal;
  // The allowlisted destination the call goes to, named in the timing line.
  destination: string;
}

/**
 * Runs one billable upstream call for a user: admit it against their credits,
 * run it, and record what it cost.
 *
 * The user's cost lock covers the two bookkeeping steps and nothing else.
 * Admission checks the balance and takes one of the user's in-flight slots in
 * the same critical section; recording spends the cost and gives the slot back
 * in the same critical section. The upstream call itself, and resolving its
 * cost, run outside the lock, so one user's calls proceed in parallel up to
 * `MAX_IN_FLIGHT_CALLS_PER_USER`.
 *
 * `onDenied` is called instead of `call` when the user lacks the credits to
 * start. `call` performs the upstream request, including answering the
 * client, and returns what the upstream sent back for the credit strategy to
 * price, or undefined when there is nothing to charge for.
 */
export async function withBillableCall(
  opts: BillableCallOptions,
  onDenied: (errorMessage: string) => Promise<void>,
  call: () => Promise<unknown>,
): Promise<void> {
  let { dbAdapter, matrixUserId, creditStrategy, signal, destination } = opts;
  let timing = {
    lockWaitMs: 0,
    capacityWaitMs: 0,
    upstreamMs: 0,
    costMs: 0,
  };
  let startedAt = Date.now();

  let admission = await admit(opts, timing);
  if (!admission.admitted) {
    await onDenied(admission.errorMessage);
    return;
  }
  let { reservationId, inFlight } = admission;

  let released = false;
  let outcome = 'ok';
  try {
    let upstreamStartedAt = Date.now();
    let usage: unknown;
    try {
      usage = await call();
    } finally {
      timing.upstreamMs = Date.now() - upstreamStartedAt;
    }

    if (usage !== undefined) {
      let costStartedAt = Date.now();
      let costInUsd = await creditStrategy.resolveUsageCost(
        matrixUserId,
        usage,
      );
      timing.costMs = Date.now() - costStartedAt;
      if (costInUsd !== undefined) {
        let lockRequestedAt = Date.now();
        await dbAdapter.withUserCostLock(matrixUserId, async () => {
          timing.lockWaitMs += Date.now() - lockRequestedAt;
          await creditStrategy.spendUsageCost(
            dbAdapter,
            matrixUserId,
            costInUsd,
          );
          // Given back in the same critical section as the spend, so the
          // next admission sees either both or neither.
          await releaseBillableCall(dbAdapter, reservationId);
          released = true;
        });
      }
    }
  } catch (error) {
    outcome = signal.aborted ? 'client-gone' : 'error';
    throw error;
  } finally {
    if (!released) {
      try {
        await releaseBillableCall(dbAdapter, reservationId);
      } catch (error) {
        // The slot is lost only until the reservation expires, so this is
        // not worth failing a request that has otherwise been served.
        log.error(
          `Failed to release billable-call reservation ${reservationId} for user ${matrixUserId}:`,
          error,
        );
        Sentry.captureException(error);
      }
    }
    log.info(
      `billable call user=${matrixUserId} destination=${destination} outcome=${outcome} inFlight=${inFlight} totalMs=${
        Date.now() - startedAt
      } lockWaitMs=${timing.lockWaitMs} capacityWaitMs=${timing.capacityWaitMs} upstreamMs=${timing.upstreamMs} costMs=${timing.costMs}`,
    );
  }
}

type Admission =
  | { admitted: true; reservationId: string; inFlight: number }
  | { admitted: false; errorMessage: string };

async function admit(
  { dbAdapter, matrixUserId, creditStrategy, signal }: BillableCallOptions,
  timing: { lockWaitMs: number; capacityWaitMs: number },
): Promise<Admission> {
  let pollMs = CAPACITY_POLL_INITIAL_MS;
  for (;;) {
    signal.throwIfAborted();
    let lockRequestedAt = Date.now();
    let attempt = await dbAdapter.withUserCostLock(
      matrixUserId,
      async (): Promise<Admission | 'at-capacity'> => {
        timing.lockWaitMs += Date.now() - lockRequestedAt;
        let validation = await creditStrategy.validateCredits(
          dbAdapter,
          matrixUserId,
        );
        if (!validation.hasEnoughCredits) {
          return {
            admitted: false,
            errorMessage: validation.errorMessage || 'Insufficient credits',
          };
        }
        let { reservationId, inFlight } = await reserveBillableCall(
          dbAdapter,
          matrixUserId,
          {
            maxInFlight: MAX_IN_FLIGHT_CALLS_PER_USER,
            expiresAt: Date.now() + RESERVATION_TTL_MS,
          },
        );
        return reservationId
          ? { admitted: true, reservationId, inFlight }
          : 'at-capacity';
      },
    );
    if (attempt !== 'at-capacity') {
      return attempt;
    }
    let waitStartedAt = Date.now();
    await abortableDelay(pollMs, signal);
    timing.capacityWaitMs += Date.now() - waitStartedAt;
    pollMs = Math.min(pollMs * 2, CAPACITY_POLL_MAX_MS);
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    let timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
