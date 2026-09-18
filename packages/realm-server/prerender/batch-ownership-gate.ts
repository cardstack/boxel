import type { PrerenderVisitArgs } from '@cardstack/runtime-common';
import { toAffinityKey } from './affinity.ts';

// Pure policy function for CS-10758 step 3 `clearCache` batch ownership.
// Given the incoming visit args and the current owner entry (if any),
// decides whether to strip `clearCache`, honor it, or replace the owner,
// and returns the gated args plus an optional owner mutation and log
// message. Extracted from Prerenderer.#gateClearCache so the policy table
// is unit-testable without constructing a full Prerenderer (which would
// launch Chrome via PagePool.warmStandbys during its constructor).
//
//   ┌─────────────────────────────┬─────────────┬──────────────────────┐
//   │ caller                      │ owner state │ action               │
//   ├─────────────────────────────┼─────────────┼──────────────────────┤
//   │ batchId=A + clearCache:true │ none        │ honor; owner := A    │
//   │ batchId=A + clearCache:true │ A           │ honor (same batch)   │
//   │ batchId=B + clearCache:true │ A (B ≠ A)   │ replace owner := B,  │
//   │                             │             │ honor clearCache     │
//   │                             │             │ (legit successor)    │
//   │ no batchId + clearCache:true│ any owner   │ STRIP clearCache     │
//   │ no batchId + clearCache:true│ none        │ honor (no protect)   │
//   │ batchId=A + clearCache:off  │ none        │ run; owner := A      │
//   │ batchId=A + clearCache:off  │ A           │ run; refresh owner   │
//   │ batchId=B + clearCache:off  │ A (B ≠ A)   │ run; owner unchanged │
//   │ no batchId + clearCache:off │ any         │ run; owner unchanged │
//   └─────────────────────────────┴─────────────┴──────────────────────┘
//
// Rationale: indexing jobs are serialized per-realm through the queue, so
// two legitimate same-realm batches never run concurrently. The only
// source of a different-batchId + clearCache is a **successor** batch
// (crash recovery, or the next .gts-triggered run). That successor should
// win — it's the one with fresh module sources to pick up. Stripping its
// clearCache would silently regress the .gts invalidation semantic. The
// `no batchId` row covers the threat the ticket names: user-initiated
// prerenders and cross-realm traffic that happen to land on the
// indexer's warm tab.
export type BatchOwner = { batchId: string; since: number };

export interface BatchClearCacheDecision<
  T extends Pick<PrerenderVisitArgs, 'renderOptions'>,
> {
  gatedArgs: T;
  // `undefined`  — leave owner map unchanged
  // `null`       — (reserved; not used today — delete the owner entry)
  // { ... }      — set the owner entry for this affinity
  newOwner?: BatchOwner | null;
  log?: { level: 'info' | 'warn'; message: string };
}

export function computeBatchClearCacheGate<
  T extends Pick<
    PrerenderVisitArgs,
    'affinityType' | 'affinityValue' | 'renderOptions' | 'batchId'
  >,
>(
  args: T,
  owner: BatchOwner | undefined,
  nowMs: number,
): BatchClearCacheDecision<T> {
  let wantsClearCache = args.renderOptions?.clearCache === true;
  let affinityKey = toAffinityKey({
    affinityType: args.affinityType,
    affinityValue: args.affinityValue,
  });

  if (!wantsClearCache) {
    // Non-clearing visit is always OK. Touch the owner timestamp if
    // this visit belongs to the current owner (keeps-alive semantics),
    // and claim an unowned affinity so that a batch which never clears
    // the cache is still protected. Only a pass whose invalidation set
    // contains an executable asks for a clear, so requiring one to
    // establish ownership would leave every other pass exposed to the
    // `no batchId` row below — the threat that row exists for does not
    // care whether the batch it interrupts happened to clear.
    // Claiming only when the affinity is unowned keeps the takeover rule
    // where it is: an owner is replaced by a clearing successor, never by
    // a visit that merely arrived.
    if (args.batchId && (!owner || owner.batchId === args.batchId)) {
      return {
        gatedArgs: args,
        newOwner: { batchId: args.batchId, since: nowMs },
      };
    }
    return { gatedArgs: args };
  }

  if (args.batchId) {
    // batchId + clearCache is always honored. A different batchId means
    // a legit successor; replace ownership so subsequent visits in the
    // new batch own the affinity.
    let log: BatchClearCacheDecision<T>['log'];
    if (owner && owner.batchId !== args.batchId) {
      log = {
        level: 'info',
        message: `batch owner for ${affinityKey} changing from ${owner.batchId} to ${args.batchId}`,
      };
    }
    return {
      gatedArgs: args,
      newOwner: { batchId: args.batchId, since: nowMs },
      log,
    };
  }

  // No batchId — user request / cross-realm traffic. If an active owner
  // exists, strip clearCache so the owner's warm loader survives.
  if (owner) {
    let strippedRenderOptions = {
      ...(args.renderOptions ?? {}),
      clearCache: undefined,
    };
    return {
      gatedArgs: { ...args, renderOptions: strippedRenderOptions },
      log: {
        level: 'warn',
        message: `stripping clearCache from non-batch request for ${affinityKey} (owner=${owner.batchId})`,
      },
    };
  }

  // No batchId and no owner — nothing to protect; honor.
  return { gatedArgs: args };
}
