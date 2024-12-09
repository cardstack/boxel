import { Plan } from './billing-queries';

export class ProrationCalculator {
  static centsToCredits(cents: number, plan: Plan): number {
    return Math.round(
      (cents / (plan.monthlyPrice * 100)) * plan.creditsIncluded,
    );
  }

  // Used when a user upgrades to a larger plan
  static calculateUpgradeProration(params: {
    currentPlan: Plan;
    newPlan: Plan;
    invoiceLines: Array<{
      amount: number;
      price: { product: string };
      period?: { start: number; end: number };
    }>;
    currentAllowance: number;
  }) {
    let { currentPlan, newPlan, invoiceLines, currentAllowance } = params;

    // Sum up monetary credit (refunds) given to the user by Stripe for unused time on previous plans
    // (there can be multiple such lines if user switches to larger plans multiple times in the same billing period)
    // and convert it to credits. In other words, take away the credits calculated from the money that Stripe
    // returned to the user for unused time.
    let creditsToExpireForUnusedTime = 0;
    for (let line of invoiceLines) {
      if (line.amount > 0) continue;
      creditsToExpireForUnusedTime += this.centsToCredits(
        -line.amount,
        currentPlan,
      );
    }

    // Find invoice line for the new plan the user is subscribing to
    let newPlanLine = invoiceLines.find(
      (line) => line.price.product === newPlan.stripePlanId,
    );

    if (!newPlanLine || !newPlanLine.period) {
      throw new Error(
        `No new plan subscription line found in invoice for plan ${newPlan.name} (stripe id: ${newPlan.stripePlanId})`,
      );
    }

    // Convert the amount Stripe charged the user for the remaining time on the new plan into credits
    // Stripe charges the user for the new plan in a prorated way, meaning that the user will be
    // charged for the time that is left in the billing period proportionally to the plan price
    let creditsToAddForRemainingTime = this.centsToCredits(
      newPlanLine.amount,
      newPlan,
    );

    return {
      creditsToAdd:
        currentAllowance -
        creditsToExpireForUnusedTime +
        creditsToAddForRemainingTime,
      periodStart: newPlanLine.period.start,
      periodEnd: newPlanLine.period.end,
    };
  }
}
