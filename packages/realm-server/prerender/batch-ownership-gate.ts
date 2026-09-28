import type { PrerenderVisitArgs } from '@cardstack/runtime-common';
import { toAffinityKey } from './affinity.ts';

// Pure policy function for `clearCache` batch ownership. Given the incoming
// visit args and the batches that currently hold the affinity, decides
// whether to strip `clearCache` or honor it, which batch the visit claims the
// affinity for, and which holders to drop as finished, and returns the gated
// args plus those mutations and an optional log message. Extracted from
// Prerenderer.#gateClearCache so the policy table is unit-testable without
// constructing a full Prerenderer (which would launch Chrome via
// PagePool.warmStandbys during its constructor).
//
//   ┌──────────────────────────────┬──────────────────┬──────────────────────┐
//   │ caller                       │ holders          │ action               │
//   ├──────────────────────────────┼──────────────────┼──────────────────────┤
//   │ batchId=A (clearCache or not)│ none, or A       │ run; claim A         │
//   │ batchId=B (clearCache or not)│ live others      │ run; claim B beside  │
//   │                              │                  │ them (concurrent)    │
//   │ batchId=B (clearCache or not)│ finished others  │ run; drop them,      │
//   │                              │                  │ claim B (successor)  │
//   │ no batchId + clearCache:true │ any live holder  │ STRIP clearCache     │
//   │ no batchId + clearCache:true │ none live        │ honor (no protect)   │
//   │ no batchId + clearCache:off  │ any              │ run; holders as-is   │
//   └──────────────────────────────┴──────────────────┴──────────────────────┘
//
// A batch's clearCache is always honored: it is the one with fresh module
// sources to pick up, and stripping it would silently regress the .gts
// invalidation semantic.
//
// Rationale: ownership answers one question — is a batch rendering on this
// affinity right now — and every batch visit answers it the same way, so any
// of them may claim or refresh its entry. Several batches holding one
// affinity at once is normal. Index passes for a realm run one per writer
// lane, and each pass's `prerender_html` job runs in a lane of its own family
// beside the pass that spawned it, so a realm's affinity routinely carries
// batches from different passes and jobs. Each holds its own entry, and a
// release removes only the releasing batch's, so one batch finishing never
// leaves another unprotected.
//
// A batch that dies without releasing (a crashed or cancelled job) would
// otherwise hold the affinity until the affinity is disposed. So a holder
// counts as finished once nothing of its is in flight on the affinity and it
// has started no visit for `staleAfterMs`, and the next batch to visit drops
// it. That batch is a successor, where one arriving beside a live holder is a
// concurrent batch, and the log says which. Nothing but this gate reads the
// holders' `since`, so dropping a live batch by mistake costs nothing but a
// re-claim on its next visit.
//
// Ownership cannot be made to depend on clearing. Only a pass whose
// invalidation set contains an executable clears, so a clearing-only claim
// would leave every other pass unprotected for the whole of its run.
//
// The `no batchId` rows cover the threat ownership exists for: user-initiated
// prerenders and cross-realm traffic that happen to land on the indexer's
// warm tab must not wipe a running batch's warm loader.
export type BatchOwner = { batchId: string; since: number };

// The batches holding one affinity: batch id → when it last started a visit
// there.
export type BatchOwners = ReadonlyMap<string, number>;

export interface BatchClearCacheDecision<
  T extends Pick<PrerenderVisitArgs, 'renderOptions'>,
> {
  gatedArgs: T;
  // The batch this visit claims the affinity for: added to the holders, or
  // its `since` refreshed. Absent leaves the holders as they are.
  claim?: BatchOwner;
  // Holders to drop as finished (see `staleAfterMs`).
  drop?: string[];
  log?: { level: 'debug' | 'info' | 'warn'; message: string };
}

export function computeBatchClearCacheGate<
  T extends Pick<
    PrerenderVisitArgs,
    'affinityType' | 'affinityValue' | 'renderOptions' | 'batchId'
  >,
>(
  args: T,
  owners: BatchOwners | undefined,
  nowMs: number,
  liveness: {
    // How long a holder with nothing in flight may go without starting a
    // visit before it counts as finished.
    staleAfterMs: number;
    // Whether any call of `batchId` is queued or running on the affinity.
    isInFlight: (batchId: string) => boolean;
  },
): BatchClearCacheDecision<T> {
  let wantsClearCache = args.renderOptions?.clearCache === true;
  let affinityKey = toAffinityKey({
    affinityType: args.affinityType,
    affinityValue: args.affinityValue,
  });
  let live: string[] = [];
  let finished: { batchId: string; idleMs: number }[] = [];
  for (let [batchId, since] of owners ?? []) {
    if (batchId === args.batchId) {
      continue;
    }
    let idleMs = nowMs - since;
    if (idleMs > liveness.staleAfterMs && !liveness.isInFlight(batchId)) {
      finished.push({ batchId, idleMs });
    } else {
      live.push(batchId);
    }
  }
  let drop = finished.length > 0 ? finished.map((f) => f.batchId) : undefined;

  if (args.batchId) {
    // Every batch visit runs as asked and claims the affinity for its own
    // batch. `since` is refreshed on each one, which is what keeps a live
    // batch from being taken for a finished one.
    let log: BatchClearCacheDecision<T>['log'];
    let alreadyHolds = owners?.has(args.batchId) ?? false;
    if (finished.length > 0) {
      log = {
        level: 'info',
        message: `batch ${args.batchId} succeeds finished batch(es) on ${affinityKey}: ${finished
          .map((f) => `${f.batchId} (idle ${Math.round(f.idleMs / 1000)}s)`)
          .join(', ')}`,
      };
    } else if (!alreadyHolds && live.length > 0) {
      log = {
        level: 'debug',
        message: `batch ${args.batchId} joins concurrent batch(es) on ${affinityKey}: ${live.join(', ')}`,
      };
    }
    return {
      gatedArgs: args,
      claim: { batchId: args.batchId, since: nowMs },
      ...(drop ? { drop } : {}),
      ...(log ? { log } : {}),
    };
  }

  // No batchId — user request / cross-realm traffic. While a live batch
  // holds the affinity, strip clearCache so its warm loader survives.
  if (wantsClearCache && live.length > 0) {
    let strippedRenderOptions = {
      ...(args.renderOptions ?? {}),
      clearCache: undefined,
    };
    return {
      gatedArgs: { ...args, renderOptions: strippedRenderOptions },
      ...(drop ? { drop } : {}),
      log: {
        level: 'warn',
        message: `stripping clearCache from non-batch request for ${affinityKey} (held by ${live.join(', ')})`,
      },
    };
  }

  // Nothing live to protect; run as asked.
  return { gatedArgs: args, ...(drop ? { drop } : {}) };
}
