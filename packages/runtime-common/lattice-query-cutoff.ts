import type { CodeRef } from './code-ref.ts';
import type { Filter } from './query.ts';

// The boundary of a sorted, paged Lattice query input: the sort value of the
// page's last row at the moment the owner published. Ziggrid read its
// leaderboards as a sorted view with `limit top`; this is the same key range,
// kept by the engine rather than by the card.
export interface LatticeQueryCutoff {
  by: string;
  on: CodeRef;
  direction: 'asc' | 'desc';
  value: string | number;
}

// The watch for a gated input. The gate is a predicate rather than a separate
// column so that the ordinary reverse matcher decides it: the range compiles
// through the same field expression that ordered the page, with the same
// casting, so "could this row reach the page" is answered by the code that
// put the page in that order.
//
// The bound is inclusive. A row tying the cutoff may or may not be in the
// page depending on the tiebreakers, so admitting the tie is the side that
// cannot miss an invalidation.
//
// Soundness: while the owner is clean, the page and this cutoff are exactly
// what it published. A row whose old and new sort values are both past the
// cutoff was not in the page, cannot enter it, and cannot change what the
// owner read. The first change that does reach the page dirties the owner,
// which republishes and records the cutoff afresh.
export function latticeCutoffFilter(
  filter: Filter | undefined,
  cutoff: LatticeQueryCutoff,
): Filter {
  const bound = {
    on: cutoff.on,
    range: {
      [cutoff.by]:
        cutoff.direction === 'desc'
          ? { gte: cutoff.value }
          : { lte: cutoff.value },
    },
  } as Filter;
  return filter ? ({ every: [filter, bound] } as Filter) : bound;
}
