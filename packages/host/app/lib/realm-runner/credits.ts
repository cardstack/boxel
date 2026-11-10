// What `room.credits()` answers: the signed-in user's plan and credit
// balance, as the profile popover shows them, and what the room's session has
// cost so far, as the answer footers add it up. Plan prices are not here:
// they change, and they belong with the Upgrade page.

import { creditsForCost, sessionCost } from '../format-token-usage';

import type { SubscriptionData } from '../../services/billing-service';
import type { TokenUsage } from '@cardstack/base/matrix-event';

export interface RoomCredits {
  // The plan's name, or null when the user has none.
  plan: string | null;
  // Everything the user can spend now: the monthly credits left plus the
  // extra credits.
  creditsLeft: number;
  // Null when the plan has no monthly allowance (the Free plan).
  monthlyCreditsLeft: number | null;
  monthlyCreditsIncluded: number | null;
  extraCredits: number | null;
  // The next daily grant, only while the balance is below what the grant
  // tops it up to, which is when the profile popover shows it too.
  nextDailyGrant: { at: string; topsUpTo: number } | null;
  // The answers in this room that reported their usage, and the credits they
  // cost. `credits` is null when one of them reported no cost: a partial sum
  // would read as the whole bill. The answer being written when the call is
  // made has not reported its cost yet, so it is not in the sum.
  session: { answers: number; credits: number | null };
}

export function roomCredits(
  subscription: Pick<
    SubscriptionData,
    | 'plan'
    | 'creditsAvailableInPlanAllowance'
    | 'creditsIncludedInPlanAllowance'
    | 'extraCreditsAvailableInBalance'
    | 'lowCreditThreshold'
    | 'nextDailyCreditGrantAt'
  >,
  usages: Iterable<TokenUsage | undefined>,
): RoomCredits {
  let creditsLeft =
    (subscription.creditsAvailableInPlanAllowance ?? 0) +
    (subscription.extraCreditsAvailableInBalance ?? 0);
  let { lowCreditThreshold, nextDailyCreditGrantAt } = subscription;
  let session = sessionCost(usages);
  return {
    plan: subscription.plan,
    creditsLeft,
    monthlyCreditsLeft: subscription.creditsAvailableInPlanAllowance,
    monthlyCreditsIncluded: subscription.creditsIncludedInPlanAllowance,
    extraCredits: subscription.extraCreditsAvailableInBalance,
    nextDailyGrant:
      lowCreditThreshold != null &&
      nextDailyCreditGrantAt != null &&
      creditsLeft < lowCreditThreshold
        ? {
            // The realm server gives the time in seconds.
            at: new Date(nextDailyCreditGrantAt * 1000).toISOString(),
            topsUpTo: lowCreditThreshold,
          }
        : null,
    session: {
      answers: session.turns,
      credits: session.costUsd != null ? creditsForCost(session.costUsd) : null,
    },
  };
}
