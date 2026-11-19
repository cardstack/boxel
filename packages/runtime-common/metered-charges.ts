import type { ChargeUsage, SpendCharge } from './db-queries/db-types.ts';

// How a worker task writes a metered charge (ADR 029 §1.1): the hosting cost
// of the usage it measured, times the margin, at 1,000 credits to the dollar.
// Prices are read from the process's environment, which only the realm-server
// package reads, so the worker hands its tasks this interface rather than the
// tasks reading prices themselves.

// The GB that per-GB rates are quoted in, and that every per-GB quantity a
// charge records is measured in. AWS bills data transfer and storage in binary
// gigabytes, 2^30 bytes.
export const BYTES_PER_GB = 1024 ** 3;

// The units a pricing value prices, keyed by the unit names a charge records
// its usage under (`credit_charge_usage.unit`). AI units are not metered; an AI charge is
// billed at the provider's cost instead.
export type MeteredUsage = Pick<
  ChargeUsage,
  | 'prerender_tab_seconds'
  | 'worker_process_seconds'
  | 'downloaded_gb'
  | 'file_storage_gb_months'
  | 'database_storage_gb_months'
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

// A metered charge's kind and reference. The pricing version is the one the
// charge is priced at, so the charge takes it from the prices rather than the
// caller.
export type MeteredCharge = DistributiveOmit<
  Extract<SpendCharge, { kind: 'run' | 'run_indexing' | 'storage' }>,
  'pricingVersion'
>;

// What a metered charge did:
// - `charged`, `already-charged` and `nothing-to-charge` are what
//   `spendCredits` did (see `SpendResult`);
// - `no-payer`: the payer has no `users` row, so there is no balance to draw
//   on;
// - `no-prices`: the process's pricing check failed, so it has no prices to
//   charge at (ADR 029 §1.3). Nothing is written, and nothing records the
//   usage either.
export type MeteredChargeResult =
  | 'charged'
  | 'already-charged'
  | 'nothing-to-charge'
  | 'no-payer'
  | 'no-prices';

export interface MeteredCharges {
  // What `usage` costs in credits at this process's prices, before rounding
  // to a whole credit, or undefined when the process has no prices.
  exactCredits(usage: MeteredUsage): number | undefined;
  // Charges `usage` to `payer` (a Matrix user id) at this process's prices,
  // rounded up to a whole credit, holding the payer's cost lock around the
  // spend. A charge with an identity is written once (see `spendCredits`), so
  // a retry may call it again safely.
  charge(args: {
    payer: string;
    charge: MeteredCharge;
    usage: MeteredUsage;
  }): Promise<MeteredChargeResult>;
}
