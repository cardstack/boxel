// @ts-ignore - no types for @glimmer/validator
import { createCache, getValue } from '@glimmer/validator';

import { initSharedState } from './shared-state';

// Turn-scoped memo for computed fields read outside a compute pass.
//
// A template that reads a computed k times, directly or through the computeds
// derived from it, would run its `computeVia` k times per render. Within one
// synchronous turn this memo serves every read after the first, so a render
// pays one evaluation per computed per data change.
//
// Each entry is a Glimmer cache rather than a bare value:
// - a hit consumes the tags the evaluation consumed, so a template that reads
//   a memoized computed still re-renders when anything its `computeVia` read
//   changes (a linked card's field, a query result), exactly as it would had
//   it run the `computeVia` itself;
// - a tracked write between two reads invalidates the entry, so the read after
//   a setter assignment recomputes.
//
// Three things drop the whole memo, for state the tags do not see:
// - an assignment to an instance's realm meta (the `[meta]` accessor on
//   `BaseDef`), which computeds read untracked and which is written outside
//   `notifyCardTracking`;
// - a microtask queued when the memo opens. It runs after the microtasks
//   already queued at that point, so continuations resuming in that same
//   checkpoint share the memo, and none resuming later does. State a
//   `computeVia` reads without tracking (the clock, a plain object mutated in
//   place) is therefore never served stale past the microtask checkpoint it
//   was read in;
// - a `WatchedArray` mutation (`dropComputedTurnMemo`). The array's subscriber,
//   and so its `notifyCardTracking`, runs a microtask after the write, which
//   would otherwise leave a read in the same turn on the pre-mutation array.
//
// The holder lives in shared state so a drop raised through one loader's copy
// of this module reaches a memo held by another's.
interface ComputedTurnMemo {
  caches: WeakMap<object, Map<string, unknown>> | null;
}
const turnMemo = initSharedState<ComputedTurnMemo>('computedTurnMemo', () => ({
  caches: null,
}));

export function readComputedThroughTurnMemo<T>(
  instance: object,
  fieldName: string,
  compute: () => T,
): T {
  let caches = turnMemo.caches;
  if (!caches) {
    let opened = new WeakMap<object, Map<string, unknown>>();
    caches = turnMemo.caches = opened;
    queueMicrotask(() => {
      if (turnMemo.caches === opened) {
        turnMemo.caches = null;
      }
    });
  }
  let perInstance = caches.get(instance);
  if (!perInstance) {
    perInstance = new Map();
    caches.set(instance, perInstance);
  }
  let cache = perInstance.get(fieldName);
  if (!cache) {
    cache = createCache(compute);
    perInstance.set(fieldName, cache);
  }
  try {
    return getValue(cache) as T;
  } catch (err) {
    // Glimmer marks a cache valid even when its function throws, and would
    // serve the stored (undefined or previous) value on the next read. Drop
    // the entry so every read of a failing computed throws.
    if (perInstance.get(fieldName) === cache) {
      perInstance.delete(fieldName);
    }
    throw err;
  }
}

export function dropComputedTurnMemo(): void {
  turnMemo.caches = null;
}
