export interface User {
  id: string;
  matrixUserId: string;
  stripeCustomerId: string;
  stripeCustomerEmail: string | null;
  matrixRegistrationToken: string | null;
}

export interface Plan {
  id: string;
  stripePlanId: string;
  name: string;
  monthlyPrice: number;
  creditsIncluded: number;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  stripeSubscriptionId: string;
}

export interface SubscriptionCycle {
  id: string;
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  creditAmount: number;
  creditType:
    | 'plan_allowance'
    | 'extra_credit'
    | 'plan_allowance_used'
    | 'extra_credit_used'
    | 'plan_allowance_expired';
  subscriptionCycleId: string | null;
}
