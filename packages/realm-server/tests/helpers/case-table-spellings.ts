import type { ResolvedCodeRef } from '@cardstack/runtime-common';

export { definitionLookupOf, definitionsLookup } from './definition-lookup.ts';

// Shared by the query case tables: a type reference, a seeded sequence, a
// definition lookup over a fixed fixture (from definition-lookup), and the
// saved spelling of a query written in the newer one.

export type Q = Record<string, any>;

export function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

export const isObject = (v: unknown): v is Record<string, any> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

// A fixed pseudo-random sequence (mulberry32): every run draws the same
// numbers, so a failure names an input that fails again.
export function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the saved spelling -------------------------------------------------------

const GENERAL_SORTS = ['cardURL', 'lastModified', 'createdAt'];

// A filter with an `on` on every operator, as a query saved in a realm has.
export function anchorFilter(node: Q, on: ResolvedCodeRef): Q {
  if (Object.keys(node).length === 1 && 'type' in node) {
    return node;
  }
  for (let key of ['every', 'any']) {
    if (Array.isArray(node[key])) {
      return {
        on,
        ...node,
        [key]: node[key].map((child: Q) => anchorFilter(child, node.on ?? on)),
      };
    }
  }
  if (node.not) {
    return { on, ...node, not: anchorFilter(node.not, node.on ?? on) };
  }
  return { on, ...node };
}

interface SpellingOptions {
  // an expression sort entry is kept as written (it takes no `on`)
  expressions?: boolean;
}

// Whether a query in the newer spelling has a saved one. Signal sorts
// (`blend`, `boost`, `relevance`, `textRelevance`), `exists`/`missing` and,
// unless asked, `expression` sort entries have none.
function hasSavedSpelling(typed: Q, opts: SpellingOptions): boolean {
  let newerOnly = (node: unknown): boolean => {
    if (Array.isArray(node)) {
      return node.some(newerOnly);
    }
    if (!isObject(node)) {
      return false;
    }
    if (
      'blend' in node ||
      'boost' in node ||
      'relevance' in node ||
      'exists' in node ||
      node.by === 'textRelevance' ||
      (typeof node.missing === 'string' &&
        !['first', 'last'].includes(node.missing))
    ) {
      return true;
    }
    return Object.values(node).some(newerOnly);
  };
  return (
    !newerOnly(typed.filter) &&
    !newerOnly(typed.let) &&
    !(typed.sort ?? []).some(
      (s: Q) => ('expression' in s && !opts.expressions) || newerOnly(s),
    )
  );
}

// The saved spelling of a query written in the newer one, or undefined where
// it has none: no top-level `type`, an `on` on every filter operator, field
// sort and collapse, and a binding's `from` as a filter.
export function savedSpelling(
  typed: Q,
  opts: SpellingOptions = {},
): Q | undefined {
  if (!hasSavedSpelling(typed, opts)) {
    return undefined;
  }
  let { type, ...rest } = typed;
  let on = type as ResolvedCodeRef;
  if (!on || (isObject(rest.filter) && rest.filter.on)) {
    return undefined;
  }
  let anchorSort = (s: Q, anchor: ResolvedCodeRef) =>
    GENERAL_SORTS.includes(s.by) || s.on || 'expression' in s
      ? s
      : { on: anchor, ...s };
  let out: Q = {};
  for (let [k, v] of Object.entries(rest)) {
    if (k === 'filter') {
      out.filter = anchorFilter(v, on);
    } else if (k === 'sort') {
      out.sort = v.map((s: Q) => {
        let entry = anchorSort(s, on);
        // a window's comparison filter is a clause of its own
        return s.compare?.filter
          ? {
              ...entry,
              compare: {
                ...s.compare,
                filter: anchorFilter(s.compare.filter, on),
              },
            }
          : entry;
      });
    } else if (k === 'collapse') {
      out.collapse = typeof v === 'string' ? { by: v, on } : { on, ...v };
    } else if (k === 'let') {
      out.let = Object.fromEntries(
        Object.entries(v as Q).map(([name, binding]) => {
          let { type: from, filter, sort, ...more } = binding.from;
          return [
            name,
            {
              ...binding,
              from: {
                filter: filter ? anchorFilter(filter, from) : { type: from },
                ...(sort
                  ? { sort: sort.map((s: Q) => anchorSort(s, from)) }
                  : {}),
                ...more,
              },
            },
          ];
        }),
      );
    } else {
      out[k] = v;
    }
  }
  if (!out.filter) {
    out = { filter: { type: on }, ...out };
  }
  return out;
}
