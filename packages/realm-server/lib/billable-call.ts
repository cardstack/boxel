import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import {
  releaseBillableCall,
  renewBillableCall,
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

// A reservation stops counting this long after it was last renewed. The
// replica running a call renews its reservation every
// `RESERVATION_RENEW_INTERVAL_MS` until the call is settled, so a live call
// never expires however long its stream or its cost lookup runs. Only a
// reservation whose replica died stops being renewed, and it frees its slot
// within this long.
export const RESERVATION_TTL_MS = 5 * 60 * 1000;
export const RESERVATION_RENEW_INTERVAL_MS = 60 * 1000;

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

// How a call ended, as the timing line reports it:
// - `charged`: the upstream answered and its cost was recorded.
// - `uncharged`: the call ended with nothing to charge for — the upstream
//   failed, or reported no cost that could be resolved.
// - `denied`: the user lacked the credits to start.
// - `client-gone`: the client left before the call finished, whether it was
//   still waiting for a slot or already upstream.
// - `error`: the call threw.
// - `settle-failed`: the call was served but recording its cost failed.
type Outcome =
  | 'charged'
  | 'uncharged'
  | 'denied'
  | 'client-gone'
  | 'error'
  | 'settle-failed';

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
 *
 * Once `call` returns the client has been answered, so a failure to record the
 * cost is logged and reported here rather than thrown: there is no response
 * left to put it in.
 */
export async function withBillableCall(
  opts: BillableCallOptions,
  onDenied: (errorMessage: string) => Promise<void>,
  call: () => Promise<unknown>,
): Promise<void> {
  let { dbAdapter, matrixUserId, signal } = opts;
  let timing = {
    lockWaitMs: 0,
    capacityWaitMs: 0,
    upstreamMs: 0,
    costMs: 0,
  };
  let startedAt = Date.now();
  let inFlight: number | undefined;
  let outcome: Outcome = 'error';

  try {
    let admission = await admit(opts, timing);
    if (!admission.admitted) {
      outcome = 'denied';
      await onDenied(admission.errorMessage);
      return;
    }
    let { reservationId } = admission;
    inFlight = admission.inFlight;

    let stopRenewing = keepRenewed(dbAdapter, matrixUserId, reservationId);
    let released = false;
    try {
      let upstreamStartedAt = Date.now();
      let usage: unknown;
      try {
        usage = await call();
      } finally {
        timing.upstreamMs = Date.now() - upstreamStartedAt;
      }

      try {
        released = await settle(opts, reservationId, usage, timing);
        outcome = released ? 'charged' : 'uncharged';
      } catch (error) {
        outcome = 'settle-failed';
        log.error(
          `Failed to record the cost of a billable call for user ${matrixUserId}:`,
          error,
        );
        Sentry.captureException(error);
      }
    } finally {
      stopRenewing();
      if (!released) {
        await release(dbAdapter, matrixUserId, reservationId);
      }
    }
  } catch (error) {
    outcome = signal.aborted ? 'client-gone' : 'error';
    throw error;
  } finally {
    // A call the client left during reports as client-gone whichever way the
    // call itself surfaced it: a streamed call swallows the cancellation and
    // returns nothing to charge rather than throwing.
    if (signal.aborted && outcome === 'uncharged') {
      outcome = 'client-gone';
    }
    log.info(
      `billable call user=${matrixUserId} destination=${opts.destination} outcome=${outcome} inFlight=${
        inFlight ?? '-'
      } totalMs=${Date.now() - startedAt} lockWaitMs=${timing.lockWaitMs} capacityWaitMs=${
        timing.capacityWaitMs
      } upstreamMs=${timing.upstreamMs} costMs=${timing.costMs}`,
    );
  }
}

// Resolves the call's cost and, if there is one, spends it and gives the slot
// back in one critical section. Returns whether the slot was given back.
async function settle(
  { dbAdapter, matrixUserId, creditStrategy }: BillableCallOptions,
  reservationId: string,
  usage: unknown,
  timing: { lockWaitMs: number; costMs: number },
): Promise<boolean> {
  if (usage === undefined) {
    return false;
  }
  let costStartedAt = Date.now();
  let costInUsd: number | undefined;
  try {
    costInUsd = await creditStrategy.resolveUsageCost(matrixUserId, usage);
  } finally {
    timing.costMs = Date.now() - costStartedAt;
  }
  if (costInUsd === undefined) {
    return false;
  }
  let cost = costInUsd;
  let lockRequestedAt = Date.now();
  await dbAdapter.withUserCostLock(matrixUserId, async () => {
    timing.lockWaitMs += Date.now() - lockRequestedAt;
    await creditStrategy.spendUsageCost(dbAdapter, matrixUserId, cost);
    // Given back in the same critical section as the spend, so the next
    // admission sees either both or neither.
    await releaseBillableCall(dbAdapter, reservationId);
  });
  return true;
}

async function release(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  reservationId: string,
) {
  try {
    await releaseBillableCall(dbAdapter, reservationId);
  } catch (error) {
    // The slot is lost only until the reservation expires, so this is not
    // worth failing a request that has otherwise been served.
    log.error(
      `Failed to release billable-call reservation ${reservationId} for user ${matrixUserId}:`,
      error,
    );
    Sentry.captureException(error);
  }
}

// Pushes the reservation's expiry forward on an interval until the returned
// function is called. A failed renewal is only logged: the reservation stays
// valid until its current expiry, and the next renewal may succeed.
function keepRenewed(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  reservationId: string,
): () => void {
  let timer = setInterval(() => {
    renewBillableCall(
      dbAdapter,
      reservationId,
      Date.now() + RESERVATION_TTL_MS,
    ).catch((error) => {
      log.warn(
        `Failed to renew billable-call reservation ${reservationId} for user ${matrixUserId}:`,
        error,
      );
    });
  }, RESERVATION_RENEW_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
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
    try {
      await abortableDelay(pollMs, signal);
    } finally {
      timing.capacityWaitMs += Date.now() - waitStartedAt;
    }
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
