// Spilling a search doc's large values out of the promoted row (ADR 021).
//
// On Postgres a jsonb value larger than about 2 KB is stored out of line
// (TOAST), and every expression that reads one key of it fetches and
// decompresses the whole document. So when a card's search doc is large, the
// index writer replaces each of its large values with a small marker and
// stores the original in `boxel_index_spill`, keyed by the marker's `ref`.
// The full doc stays in `boxel_index_pending` (staged reads use it inline),
// and the SQLite index never spills.
//
// Readers resolve a marker by its `ref` alone: `spill_unmark` / `spill_text`
// in SQL (see the `add-boxel-index-spill` migration, which also teaches
// `jsonb_tree` to resolve markers as it walks), and `unspillSearchDoc` here.
// A ref is a hash of the row key and the value's position, so it names one
// value of one row and is the same every time that value is indexed.

import type { DBAdapter } from './db.ts';
import { isQueryableVector } from './serializers/vector.ts';
import { CARD_TITLE_KEY } from './search-doc-keys.ts';

// A search doc at or under this many bytes of JSON is promoted whole: it
// already fits inline, and spilling it would only add lookups.
export const SEARCH_DOC_INLINE_TARGET = 2000;
// In a doc over the target, a string longer than this many characters (UTF-16
// code units, as JavaScript counts them) spills. A query compiles on the same
// count: an `eq` value no longer than this can only equal an inline value.
export const SEARCH_DOC_INLINE_STRING_MAX = 256;
// In a doc over the target, an array with more elements than this spills
// whole.
export const SEARCH_DOC_INLINE_ARRAY_MAX = 64;

export const SPILL_MARKER_KEY = '$spilled';

export type SpillKind = 'vector' | 'value';

export interface SpillMarker {
  [SPILL_MARKER_KEY]: SpillKind;
  ref: string;
}

export interface SpillRow {
  ref: string;
  fieldPath: string;
  ordinal: number;
  kind: SpillKind;
  value: unknown;
}

// Root keys that never spill. The platform's own keys (a leading underscore:
// `_title`, `_typeahead`, `_passages`, …) are short and some are read straight
// from `search_doc` by expression indexes; the trigram-indexed title keys are
// read that way too, so a title stays where its index can see it.
const NEVER_SPILL_ROOT_KEYS = new Set<string>([CARD_TITLE_KEY, 'cardTitle']);

function neverSpills(rootKey: string): boolean {
  return rootKey.startsWith('_') || NEVER_SPILL_ROOT_KEYS.has(rootKey);
}

let spillEnabledOverride: boolean | undefined;

// Whether the index writer spills. Off unless the realm server's environment
// sets BOXEL_SPILL_SEARCH_DOCS=true: the readers that resolve markers ship a
// release before any writer spills (ADR 021 §1.9).
export function searchDocSpillEnabled(): boolean {
  if (spillEnabledOverride !== undefined) {
    return spillEnabledOverride;
  }
  let env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  return env?.BOXEL_SPILL_SEARCH_DOCS === 'true';
}

// For tests: force spilling on or off, or `undefined` to follow the
// environment again.
export function setSearchDocSpillEnabled(enabled: boolean | undefined) {
  spillEnabledOverride = enabled;
}

export function isSpillMarker(value: unknown): value is SpillMarker {
  return (
    typeof value === 'object' &&
    value != null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[SPILL_MARKER_KEY] === 'string' &&
    typeof (value as Record<string, unknown>).ref === 'string'
  );
}

export async function spillRef(
  url: string,
  type: string,
  fieldPath: string,
  ordinal: number,
): Promise<string> {
  let bytes = new TextEncoder().encode(
    `${url}\u0000${type}\u0000${fieldPath}\u0000${ordinal}`,
  );
  let digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  // 128 bits, base64url: unique per value in practice, and short enough that
  // markers don't undo the saving.
  let binary = '';
  for (let byte of digest.subarray(0, 16)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface PendingSpill {
  fieldPath: string;
  ordinal: number;
  kind: SpillKind;
  value: unknown;
  // Where the marker goes once its ref is known.
  place: (marker: SpillMarker) => void;
}

// The promoted form of `searchDoc` and the values it spilled, or `undefined`
// when the doc is promoted whole (it fits, or nothing in it is large).
// `searchDoc` is not modified.
export async function spillSearchDoc(
  searchDoc: Record<string, unknown> | null | undefined,
  key: { url: string; type: string },
): Promise<
  { searchDoc: Record<string, unknown>; rows: SpillRow[] } | undefined
> {
  if (searchDoc == null || typeof searchDoc !== 'object') {
    return undefined;
  }
  if (JSON.stringify(searchDoc).length <= SEARCH_DOC_INLINE_TARGET) {
    return undefined;
  }
  let pending: PendingSpill[] = [];
  let ordinals = new Map<string, number>();
  let spill = (
    fieldPath: string,
    kind: SpillKind,
    value: unknown,
    place: PendingSpill['place'],
  ) => {
    let ordinal = ordinals.get(fieldPath) ?? 0;
    ordinals.set(fieldPath, ordinal + 1);
    pending.push({ fieldPath, ordinal, kind, value, place });
  };

  // Returns the value to keep in place: the value itself, a copy with spilled
  // descendants replaced, or a placeholder the marker overwrites.
  let visit = (
    value: unknown,
    path: string[],
    place: PendingSpill['place'],
  ): unknown => {
    let fieldPath = path.join('.');
    if (typeof value === 'string') {
      // `isQueryableVector` narrows its argument, so test a widened copy:
      // otherwise the else branch reads `value` as `never`.
      let text: string = value;
      if (isQueryableVector(text as unknown)) {
        spill(fieldPath, 'vector', value, place);
      } else if (text.length > SEARCH_DOC_INLINE_STRING_MAX) {
        spill(fieldPath, 'value', value, place);
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > SEARCH_DOC_INLINE_ARRAY_MAX) {
        spill(fieldPath, 'value', value, place);
        return value;
      }
      let copy = [...value];
      copy.forEach((item, index) => {
        copy[index] = visit(item, path, (marker) => {
          copy[index] = marker;
        });
      });
      return copy;
    }
    if (typeof value === 'object' && value != null) {
      let copy: Record<string, unknown> = { ...value };
      for (let [childKey, child] of Object.entries(copy)) {
        if (path.length === 0 && neverSpills(childKey)) {
          continue;
        }
        copy[childKey] = visit(child, [...path, childKey], (marker) => {
          copy[childKey] = marker;
        });
      }
      return copy;
    }
    return value;
  };

  let promoted = visit(searchDoc, [], () => {
    throw new Error('a search doc root cannot spill');
  }) as Record<string, unknown>;
  if (pending.length === 0) {
    return undefined;
  }
  let rows: SpillRow[] = [];
  for (let { fieldPath, ordinal, kind, value, place } of pending) {
    let ref = await spillRef(key.url, key.type, fieldPath, ordinal);
    place({ [SPILL_MARKER_KEY]: kind, ref });
    rows.push({ ref, fieldPath, ordinal, kind, value });
  }
  return { searchDoc: promoted, rows };
}

// The refs of every marker in a promoted search doc.
export function collectSpillRefs(searchDoc: unknown): string[] {
  let refs: string[] = [];
  let visit = (value: unknown) => {
    if (isSpillMarker(value)) {
      refs.push(value.ref);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object' && value != null) {
      Object.values(value).forEach(visit);
    }
  };
  visit(searchDoc);
  return refs;
}

// A promoted search doc with each marker replaced by its spilled value. A
// marker whose value is missing stays a marker. `searchDoc` is not modified.
export function unspillSearchDoc<T>(
  searchDoc: T,
  values: ReadonlyMap<string, unknown>,
): T {
  let visit = (value: unknown): unknown => {
    if (isSpillMarker(value)) {
      return values.has(value.ref) ? values.get(value.ref) : value;
    }
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (typeof value === 'object' && value != null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, visit(v)]),
      );
    }
    return value;
  };
  return visit(searchDoc) as T;
}

// Restores the spilled values of each row's `search_doc` in place, reading
// them from `boxel_index_spill` in one query per 500 refs. Rows without
// markers are left alone, so this costs nothing where nothing spilled.
// Postgres only: the SQLite index never spills.
export async function restoreSpilledSearchDocs(
  dbAdapter: DBAdapter,
  rows: { search_doc?: unknown }[],
): Promise<void> {
  if (dbAdapter.kind !== 'pg') {
    return;
  }
  let refs = new Set<string>();
  let spilledRows = rows.filter((row) => {
    let found = collectSpillRefs(row.search_doc);
    found.forEach((ref) => refs.add(ref));
    return found.length > 0;
  });
  if (refs.size === 0) {
    return;
  }
  let values = new Map<string, unknown>();
  let all = [...refs];
  for (let start = 0; start < all.length; start += 500) {
    let chunk = all.slice(start, start + 500);
    let placeholders = chunk.map((_, i) => '$' + String(i + 1)).join(', ');
    let found = (await dbAdapter.execute(
      'SELECT ref, value FROM boxel_index_spill WHERE ref IN (' +
        placeholders +
        ')',
      { bind: chunk, coerceTypes: { value: 'JSON' } },
    )) as { ref: string; value: unknown }[];
    for (let { ref, value } of found) {
      values.set(ref, value);
    }
  }
  for (let row of spilledRows) {
    row.search_doc = unspillSearchDoc(row.search_doc, values);
  }
}
