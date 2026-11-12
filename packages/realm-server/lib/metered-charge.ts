import {
  getUserByMatrixUserId,
  spendCredits,
} from '@cardstack/billing/billing-queries';
import {
  CREDITS_PER_USD,
  type DBAdapter,
  type SpendCharge,
} from '@cardstack/runtime-common';
import type {
  MeteredCharge,
  MeteredChargeResult,
  MeteredCharges,
  MeteredUsage,
} from '@cardstack/runtime-common/metered-charges';

import { currentPricing, type Pricing } from './pricing.ts';

// Prices and writes a metered charge (ADR 029 §1.1): the hosting cost of the
// usage it measured, times the margin, at 1,000 credits to the dollar.

type MeteredUnit = keyof MeteredUsage;

function usdPerUnit(pricing: Pricing): Record<MeteredUnit, number> {
  return {
    prerender_tab_seconds: pricing.prerenderTabUsdPerSecond,
    worker_process_seconds: pricing.workerProcessUsdPerSecond,
    downloaded_gb: pricing.values.usdPerDownloadedGb,
    file_storage_gb_months: pricing.values.usdPerFileStorageGbMonth,
    database_storage_gb_months: pricing.values.usdPerDatabaseStorageGbMonth,
  };
}

// The hosting cost of `usage`, in USD, before the margin.
export function meteredUsd(usage: MeteredUsage, pricing: Pricing): number {
  let rates = usdPerUnit(pricing);
  let usd = 0;
  for (let [unit, quantity] of Object.entries(usage) as [
    MeteredUnit,
    number | undefined,
  ][]) {
    if (quantity === undefined) {
      continue;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(
        `metered usage for ${unit} must be a finite number of 0 or more, got ${quantity}`,
      );
    }
    usd += quantity * rates[unit];
  }
  return usd;
}

// What `usage` costs in credits, before rounding: its hosting cost times the
// margin, at `CREDITS_PER_USD`.
export function exactMeteredCredits(
  usage: MeteredUsage,
  pricing: Pricing,
): number {
  return meteredUsd(usage, pricing) * pricing.values.margin * CREDITS_PER_USD;
}

// What a metered charge for `usage` draws, in whole credits. A metered charge
// rounds up, so any usage at all costs at least one credit, and a charge never
// rounds down to less than its cost.
export function meteredCredits(usage: MeteredUsage, pricing: Pricing): number {
  return Math.ceil(exactMeteredCredits(usage, pricing));
}

// Charges `usage` to `payer` (a Matrix user id) at `pricing`, recording the
// usage and the pricing version with the charge. It holds the payer's cost
// lock around the spend, as every charge writer does, and is written once per
// identity (see `spendCredits`), so a retry may call it again safely.
export async function chargeMetered(
  dbAdapter: DBAdapter,
  {
    payer,
    charge,
    usage,
    pricing,
  }: {
    payer: string;
    charge: MeteredCharge;
    usage: MeteredUsage;
    pricing: Pricing;
  },
): Promise<Exclude<MeteredChargeResult, 'no-prices'>> {
  let credits = meteredCredits(usage, pricing);
  let user = await getUserByMatrixUserId(dbAdapter, payer);
  if (!user) {
    return 'no-payer';
  }
  return await dbAdapter.withUserCostLock(payer, () =>
    spendCredits(
      dbAdapter,
      user.id,
      credits,
      { ...charge, pricingVersion: pricing.version } as SpendCharge,
      usage,
    ),
  );
}

// The `MeteredCharges` a worker hands its tasks, at the prices this process
// checked at startup. `pricing` is read on each call, so a process that has no
// prices charges nothing (ADR 029 §1.3).
export function meteredChargesFor(
  dbAdapter: DBAdapter,
  pricing: () => Pricing | undefined = currentPricing,
): MeteredCharges {
  return {
    exactCredits(usage) {
      let prices = pricing();
      return prices ? exactMeteredCredits(usage, prices) : undefined;
    },
    async charge({ payer, charge, usage }) {
      let prices = pricing();
      if (!prices) {
        return 'no-prices';
      }
      return await chargeMetered(dbAdapter, {
        payer,
        charge,
        usage,
        pricing: prices,
      });
    },
  };
}
