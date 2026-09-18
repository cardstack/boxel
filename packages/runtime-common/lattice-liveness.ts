// Scheduling advice only. A tier, cost estimate or lag never establishes that
// inputs are current, satisfies a dirty obligation or authorizes publication.
export type LatticeLivenessTier = 'visible' | 'background' | 'progress';

export function assertLatticeLivenessTier(
  value: unknown,
): asserts value is LatticeLivenessTier | undefined {
  if (
    value !== undefined &&
    value !== 'visible' &&
    value !== 'background' &&
    value !== 'progress'
  )
    throw new Error('Invalid Lattice liveness tier');
}

export const latticeTierSeconds = (tier: LatticeLivenessTier): number | null =>
  tier === 'visible' ? 2 : tier === 'background' ? 15 : null;

export interface LatticeLivenessOwner {
  ownerURL: string;
  livenessTier?: LatticeLivenessTier;
  publishedAt?: number;
  dirtySince?: number;
  visible?: boolean;
  dirty?: boolean;
}

export interface LatticeLivenessState {
  at: number;
  arrival: number;
  backlog: number;
  smoothedBacklog: number;
  progressServiceMs: number;
  factors: { visible: number; background: number };
  capacity: number;
  demand: number;
  budget: number;
  refreshShare: number;
  settleSeconds: number;
  commitTickMs: number;
}

const smooth = (before: number, next: number, seconds: number, tau: number) =>
  before + (next - before) * (1 - Math.exp(-seconds / tau));

// Costs include the complete owner service, not just BXL arithmetic. The caller
// supplies bounded persisted cost estimates and pending identities. Coalesced
// writes to an already dirty owner are not counted as additional full jobs.
export function latticeLiveness(
  owners: readonly LatticeLivenessOwner[],
  costMs: (owner: LatticeLivenessOwner) => number,
  progressServiceMs: number,
  previous?: LatticeLivenessState,
  now = Date.now(),
  capacity = 1,
  horizonSeconds = 10,
  headroom = 0.2,
): LatticeLivenessState {
  if (!(capacity > 0 && horizonSeconds > 0 && headroom >= 0 && headroom < 1))
    throw new Error('Invalid Lattice liveness capacity');
  const dt = previous ? Math.max(0.001, (now - previous.at) / 1000) : 1;
  const cost = (owner: LatticeLivenessOwner) => {
    const value = costMs(owner);
    return Number.isFinite(value) ? Math.max(0.001, value / 1000) : 0.1;
  };
  const queued = owners.reduce(
    (sum, owner) => sum + (owner.dirty === false ? 0 : cost(owner)),
    0,
  );
  const completed = previous
    ? Math.max(0, progressServiceMs - previous.progressServiceMs) / 1000
    : 0;
  const incoming = previous
    ? Math.max(0, queued - previous.backlog + completed) / dt
    : 0;
  const arrival = previous
    ? smooth(previous.arrival, incoming, dt, 3)
    : incoming;
  // Do not smooth away a real backlog on burst arrival. The prior observation
  // plus completed service measures arrivals; the current backlog is a bound.
  const smoothedBacklog = previous
    ? smooth(previous.smoothedBacklog ?? previous.backlog, queued, dt, 3)
    : queued;
  const demand = arrival + Math.max(queued, smoothedBacklog) / horizonSeconds;
  const budget = Math.max(0, (1 - headroom) * capacity - demand);
  let remaining = budget;
  let paid = 0;
  const factors = { visible: 0, background: 0 };
  for (const tier of ['visible', 'background'] as const) {
    const rate = owners.reduce(
      (sum, owner) =>
        sum +
        (owner.livenessTier === tier && (tier !== 'visible' || owner.visible)
          ? cost(owner) / latticeTierSeconds(tier)!
          : 0),
      0,
    );
    const target = rate === 0 ? 1 : Math.min(1, remaining / rate);
    const prior = previous?.factors[tier] ?? target;
    const damped = smooth(prior, target, dt, target < prior ? 2 : 10);
    // A falling average must never spend capacity that no longer exists.
    const f = Math.max(0, Math.min(target, damped));
    factors[tier] = f;
    const spent = rate * f;
    remaining = Math.max(0, remaining - spent);
    paid += spent;
  }
  return {
    at: now,
    arrival,
    backlog: queued,
    smoothedBacklog,
    progressServiceMs,
    factors,
    capacity,
    demand,
    budget,
    refreshShare: Math.min(1 - headroom, paid / capacity),
    settleSeconds: queued / Math.max(0.001, capacity - arrival),
    commitTickMs: 400 / Math.max(factors.visible, 0.1),
  };
}

export function latticeEarlyRefreshDue(
  owner: LatticeLivenessOwner,
  governor: LatticeLivenessState,
  now = Date.now(),
): boolean {
  const tier = owner.livenessTier;
  // Legacy cards keep their existing grain contract until they opt into a tier.
  if (!tier) return true;
  if (tier === 'progress' || (tier === 'visible' && !owner.visible))
    return false;
  const f = governor.factors[tier];
  if (f <= 0) return false;
  const since = owner.publishedAt ?? owner.dirtySince ?? now;
  return now - since >= (latticeTierSeconds(tier)! * 1000) / f;
}
