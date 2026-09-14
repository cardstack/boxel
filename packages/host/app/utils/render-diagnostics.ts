// Shared plumbing for the per-row render diagnostics the prerender's render
// routes persist onto `boxel_index.diagnostics`: attributing a rolling
// history to one visit, and bounding what a visit is allowed to record.

// Multiset diff over a bounded rolling history — the store's completed-load
// histories and the Loader's module-evaluation history. Both are kept per
// tab and outlive any one render, so "what did THIS render do" is the
// entries present in `after` beyond their multiplicity in `before`.
//
// Both histories keep only their slowest entries, so an entry evicted by
// slower siblings goes unreported; what survives is by construction the part
// worth attributing. Eviction on the `before` side is harmless too — the
// diff only ever reports a surplus, never a deficit.
//
// Entries are matched by `keyOf`, which must fold in the measured duration
// as well as the identity: the same URL twice is two entries, and two
// measurements of it that differ must not cancel each other out.
export function newHistoryEntries<T>(
  before: T[],
  after: T[],
  keyOf: (entry: T) => string,
): T[] {
  let seen = new Map<string, number>();
  for (let entry of before) {
    let key = keyOf(entry);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let fresh: T[] = [];
  for (let entry of after) {
    let key = keyOf(entry);
    let count = seen.get(key) ?? 0;
    if (count > 0) {
      seen.set(key, count - 1);
    } else {
      fresh.push(entry);
    }
  }
  return fresh;
}

// The `{ url, ms }` shape shared by the store's card-doc / file-meta load
// histories and the Loader's module-evaluation history.
export function newLoadEntries<T extends { url: string; ms: number }>(
  before: T[],
  after: T[],
): T[] {
  return newHistoryEntries(before, after, ({ url, ms }) => `${url}|${ms}`);
}

// Persistence bounds shared by every per-row timing breakdown (search-doc
// fields and link loads, hydration fields, module evaluations, settle
// waits). The raw collectors are unbounded; only the slowest entries at/over
// the floor land on the row, so a typical cheap card records nothing and a
// wide one can't bloat its diagnostics blob.
export const DIAGNOSTIC_TIMING_FLOOR_MS = 1;
export const DIAGNOSTIC_TIMING_MAX_ENTRIES = 20;

export const roundMs = (ms: number) => Math.round(ms * 100) / 100;

// Slowest-N-at/over-the-floor pruning for a path-keyed timing map. Rank by
// value when reading — jsonb normalizes key order, so the persisted object
// carries no ordering. An ancestor's inclusive time is >= any descendant's,
// so a kept entry's parent chain makes the cut with it (barring an
// exact-tie at the cut-off).
export function pruneTimingPaths(
  pathsMs: Record<string, number>,
): Record<string, number> | undefined {
  let kept = Object.entries(pathsMs)
    .filter(([, ms]) => ms >= DIAGNOSTIC_TIMING_FLOOR_MS)
    .sort(([, a], [, b]) => b - a)
    .slice(0, DIAGNOSTIC_TIMING_MAX_ENTRIES);
  return kept.length > 0
    ? Object.fromEntries(kept.map(([path, ms]) => [path, roundMs(ms)]))
    : undefined;
}

// The same pruning for a list of measured entries. The floor also drops the
// near-zero entries recorded for work that was already done (a link target
// resident in the store, a module already evaluated on this tab), so what
// survives is what actually cost something.
export function pruneTimingEntries<T extends { ms: number }>(
  entries: T[],
): T[] | undefined {
  let kept = entries
    .filter(({ ms }) => ms >= DIAGNOSTIC_TIMING_FLOOR_MS)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, DIAGNOSTIC_TIMING_MAX_ENTRIES)
    .map((entry) => ({ ...entry, ms: roundMs(entry.ms) }));
  return kept.length > 0 ? kept : undefined;
}
