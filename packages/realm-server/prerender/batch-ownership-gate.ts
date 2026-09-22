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
//   │ batchId=A + clearCache:off  │ none or any │ run; owner := A      │
//   │ no batchId + clearCache:off │ any         │ run; owner unchanged │
//   └─────────────────────────────┴─────────────┴──────────────────────┘
//
// Rationale: ownership answers one question — is a batch rendering on this
// affinity right now — and every batch visit answers it the same way, so any
// of them may claim or refresh the entry. A different batchId is either a
// successor (crash recovery, or the next run) or a legitimate concurrent
// peer: an index pass and the `prerender_html` job it spawns sit in
// different concurrency groups (`indexing:<realm>` vs
// `prerender-html:<realm>`) over one realm's affinity, and the pass spawns
// that job the moment its invalidation set is known, precisely so the two
// overlap. Letting them trade the entry costs nothing, because no reader
// asks which batch owns it — only whether one does.
//
// Ownership therefore cannot be made to depend on clearing. Only a pass whose
// invalidation set contains an executable clears, so a clearing-only claim
// would leave every other pass unprotected for the whole of its run, and
// would leave a batch that died without releasing owning the affinity until
// something else displaced it.
//
// The `no batchId` row covers the threat the ticket names: user-initiated
// prerenders and cross-realm traffic that happen to land on the indexer's
// warm tab. A clearing successor is still honored rather than stripped —
// it's the one with fresh module sources to pick up, and stripping it would
// silently regress the .gts invalidation semantic.
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
    // Non-clearing visit is always OK, and claims the affinity for its own
    // batch — refreshing the entry when it already owns it, taking it over
    // when another batch holds one. Taking over is what keeps a batch that
    // died without releasing from owning the affinity forever: `since` has no
    // expiry and nothing else clears the entry but a matching release or the
    // affinity being disposed.
    if (args.batchId) {
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
