export interface User {
  id: string;
  matrixUserId: string;
  stripeCustomerId: string;
  stripeCustomerEmail: string | null;
  matrixRegistrationToken: string | null;
  sessionRoomId: string | null;
  sessionsRevokedAt: number | null;
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

export type CreditType =
  | 'plan_allowance'
  | 'extra_credit'
  | 'daily_credit'
  | 'plan_allowance_used'
  | 'extra_credit_used'
  | 'daily_credit_used'
  | 'plan_allowance_expired';

// What a ledger entry paid for, or where its credits came from. The
// consumption kinds (`run`, `run_indexing`, `storage`, `ai`, `batched_ai`) are
// spends; `grant`, `purchase` and `expiry` add or take back credits.
export type LedgerChargeKind =
  | 'run'
  | 'run_indexing'
  | 'storage'
  | 'ai'
  | 'batched_ai'
  | 'grant'
  | 'purchase'
  | 'expiry';

// A charge's kind together with the reference it paid for. `realm` is the
// realm's canonical identifier, `runId` an `automation_runs` id,
// `automationId` the automation card's identifier, `batchId` the AI
// provider's batch id, and `day` a `YYYY-MM-DD` UTC date. The metered kinds
// (`run`, `run_indexing`, `storage`) carry the pricing version that priced
// them.
//
// A charge whose reference names exactly one charge (every consumption kind
// but `ai`) is written at most once: its kind and reference are its identity,
// shared by every ledger row it writes. An `ai` charge is one per call, and a
// run makes many, so it has no identity of its own.
export type LedgerCharge =
  | {
      kind: 'ai';
      realm?: string;
      runId?: string;
      pricingVersion?: string;
    }
  | {
      kind: 'batched_ai';
      realm: string;
      runId: string;
      batchId: string;
      pricingVersion?: string;
    }
  | {
      kind: 'run' | 'run_indexing';
      realm: string;
      runId: string;
      pricingVersion: string;
    }
  | {
      kind: 'storage';
      realm: string;
      automationId: string;
      day: string;
      pricingVersion: string;
    }
  | { kind: 'grant' | 'purchase' | 'expiry' };

export type SpendCharge = Extract<
  LedgerCharge,
  { kind: 'ai' | 'batched_ai' | 'run' | 'run_indexing' | 'storage' }
>;

export interface LedgerEntry {
  id: string;
  userId: string;
  creditAmount: number;
  creditType: CreditType;
  subscriptionCycleId: string | null;
}

// A ledger entry as read back, with what it paid for. An entry written
// without a charge kind reads the kind its credit type implies (see
// `chargeKindForCreditType`) and has no reference.
export interface ChargedLedgerEntry extends LedgerEntry {
  chargeKind: LedgerChargeKind;
  realm: string | null;
  runId: string | null;
  batchId: string | null;
  automationId: string | null;
  chargeDay: string | null;
  pricingVersion: string | null;
  createdAt: number;
}

// The charge kind an entry's credit type implies, for an entry that names no
// kind: a spend is AI, plan and daily allowances are grants, extra credit is a
// purchase, and an expired allowance is an expiry.
export function chargeKindForCreditType(
  creditType: CreditType,
): 'ai' | 'grant' | 'purchase' | 'expiry' {
  switch (creditType) {
    case 'plan_allowance_used':
    case 'extra_credit_used':
    case 'daily_credit_used':
      return 'ai';
    case 'plan_allowance':
    case 'daily_credit':
      return 'grant';
    case 'extra_credit':
      return 'purchase';
    case 'plan_allowance_expired':
      return 'expiry';
  }
}
