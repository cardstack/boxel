// The shared filter verb: predicate builders every list view composes
// instead of re-deriving. A filter never throws on a hole — an unloaded
// link or empty field simply doesn't match, it doesn't crash the list.

export type Predicate<T> = (item: T) => boolean;

/** Case- and accent-insensitive "does any of these fields mention this?". */
export function textMatch<T>(
  needle: string | null | undefined,
  ...accessors: ((item: T) => unknown)[]
): Predicate<T> {
  let query = (needle ?? '').trim().toLocaleLowerCase();
  if (!query) {
    return () => true;
  }
  return (item: T) =>
    accessors.some((accessor) => {
      let value = accessor(item);
      return (
        value !== null &&
        value !== undefined &&
        String(value).toLocaleLowerCase().includes(query)
      );
    });
}

/** Keep items whose value is one of the allowed set; an empty set means "no filter". */
export function oneOf<T>(
  allowed: readonly unknown[] | null | undefined,
  accessor: (item: T) => unknown,
): Predicate<T> {
  if (!allowed?.length) {
    return () => true;
  }
  let set = new Set(allowed);
  return (item: T) => set.has(accessor(item));
}

/** Inclusive range on numbers or dates; either bound may be open. */
export function withinRange<T>(
  min: number | Date | null | undefined,
  max: number | Date | null | undefined,
  accessor: (item: T) => number | Date | null | undefined,
): Predicate<T> {
  let lo = min instanceof Date ? min.getTime() : min;
  let hi = max instanceof Date ? max.getTime() : max;
  return (item: T) => {
    let raw = accessor(item);
    if (raw === null || raw === undefined) {
      return false;
    }
    let value = raw instanceof Date ? raw.getTime() : raw;
    if (lo !== null && lo !== undefined && value < lo) return false;
    if (hi !== null && hi !== undefined && value > hi) return false;
    return true;
  };
}

/** AND-compose predicates, skipping holes in the item list. */
export default function filterBy<T>(
  items: readonly (T | null | undefined)[],
  ...predicates: Predicate<T>[]
): T[] {
  let present = (items ?? []).filter(Boolean) as T[];
  return present.filter((item) => predicates.every((p) => p(item)));
}
