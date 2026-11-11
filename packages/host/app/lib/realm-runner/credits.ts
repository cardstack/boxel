// What `room.credits()` answers: the signed-in user's plan and credit
// balance, as the profile popover shows them, and the credits the room's model
// replies reported, as the answer footers add them up. Plan prices are not
// here: they change, and they belong with the Upgrade page.

import {
  availableCredits,
  awaitsDailyGrant,
  type SubscriptionData,
} from '../../services/billing-service';
import { creditsForCost, sessionUsage } from '../format-token-usage';

import type { TokenUsage } from '@cardstack/base/matrix-event';

export interface RoomCredits {
  // The plan's name, or null when the server names none.
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
  // The model replies in this room that reported their usage (one per tool
  // round, so an answer that calls tools is several), and the credits they
  // reported. The reply that called `room.credits` is among them: a reply
  // finishes, with its usage, before its tool calls run. `replyCredits` is
  // null when a counted reply reported no cost, since a partial sum would read
  // as the whole bill. It is not everything the session spent: image
  // generation, history compaction and stopped replies are charged to the
  // balance without appearing in any reply's usage.
  session: { replies: number; replyCredits: number | null };
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
  let { lowCreditThreshold, nextDailyCreditGrantAt } = subscription;
  let session = sessionUsage(usages);
  return {
    plan: subscription.plan,
    creditsLeft: availableCredits(subscription),
    monthlyCreditsLeft: subscription.creditsAvailableInPlanAllowance,
    monthlyCreditsIncluded: subscription.creditsIncludedInPlanAllowance,
    extraCredits: subscription.extraCreditsAvailableInBalance,
    nextDailyGrant:
      awaitsDailyGrant(subscription) &&
      lowCreditThreshold != null &&
      nextDailyCreditGrantAt != null
        ? {
            // The realm server gives the time in seconds.
            at: new Date(nextDailyCreditGrantAt * 1000).toISOString(),
            topsUpTo: lowCreditThreshold,
          }
        : null,
    session: {
      replies: session.turns,
      replyCredits:
        session.costUsd != null ? creditsForCost(session.costUsd) : null,
    },
  };
}
