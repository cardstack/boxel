// The shared sort verb: one type-aware comparator so every list in every app
// orders the same way. Four shipped apps re-derived this before it existed —
// and a string sort puts "P10" before "P2" and 2026-02-01 after 2026-01-31T….

export type SortDirection = 'asc' | 'desc';

/**
 * Type-aware comparison: numbers numerically, Dates by time, strings with
 * numeric-aware locale rules ("2" before "10"), booleans false-first.
 * null/undefined sort LAST in either direction — a record nobody filled in
 * should not float to the top just because the column flipped.
 */
export function compareValues(a: unknown, b: unknown): number {
  let aEmpty = a === null || a === undefined || a === '';
  let bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Stable sort by an accessor. Empty values stay last regardless of
 * direction; ties keep their incoming order, so a secondary sort survives.
 */
export default function sortBy<T>(
  items: readonly (T | null | undefined)[],
  accessor: (item: T) => unknown,
  direction: SortDirection = 'asc',
): T[] {
  let present = (items ?? []).filter(Boolean) as T[];
  let sign = direction === 'desc' ? -1 : 1;
  return present
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      let a = accessor(x.item);
      let b = accessor(y.item);
      let aEmpty = a === null || a === undefined || a === '';
      let bEmpty = b === null || b === undefined || b === '';
      // Empties pin to the end in BOTH directions, outside the sign flip.
      if (aEmpty || bEmpty) {
        return compareValues(a, b) || x.index - y.index;
      }
      return sign * compareValues(a, b) || x.index - y.index;
    })
    .map((entry) => entry.item);
}
