import stringify from 'safe-stable-stringify';

import { SYNTHETIC_SEARCH_DOC_KEYS } from './search-doc-keys.ts';

// Parity comparison between a store-driven search doc and a searchable-driven
// one. Shared by the realm-scale validator (`scripts/searchable-parity-diff.ts`)
// and the generation tests so both judge "parity" by exactly the same rule.
//
// A search doc captures every relationship as at least a bare reference. The
// searchable-driven generator keeps `{ id }` / `null` for every relationship,
// whereas the store-driven path omits relationships it never loaded. Under
// `ignoreShallowLinks` that omit-vs-keep-`{ id }` difference is treated as
// equivalent — at any nesting depth, since a card pulled into the doc carries
// the same base-card relationships (e.g. a contained `cardInfo`'s thumbnail
// link) that are likewise shallow. A CHANGED reference id or any real
// contained-data delta still reports.

type SearchDoc = Record<string, unknown>;

// A relationship slot is "shallow" when it carries no contained data beyond a
// bare reference: `null`, a bare `{ id }`, or a plural whose every element is
// shallow (an empty plural included).
export function isShallowLink(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.every(isShallowLink);
  if (typeof value !== 'object') return false;
  let keys = Object.keys(value as object);
  return keys.length === 1 && keys[0] === 'id';
}

// The bare reference ids carried by a shallow slot, flattened across a plural.
// A `null` / absent / empty slot contributes none — used to tell the intended
// omit-vs-keep-`{ id }` difference (one side has no ids) apart from a CHANGED
// reference (`{ id:A }` vs `{ id:B }`), which is a real divergence.
export function shallowIds(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(shallowIds);
  if (typeof value === 'object') {
    let id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  }
  return [];
}

let isObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

// Sentinel for a key present on one side but not the other, so present-vs-absent
// stays distinct from present-vs-null.
const ABSENT = Symbol('absent');

function diffValue(
  path: string,
  live: unknown,
  generated: unknown,
  ignoreShallowLinks: boolean,
  diffs: string[],
): void {
  let lAbsent = live === ABSENT;
  let gAbsent = generated === ABSENT;
  let lv = lAbsent ? undefined : live;
  let gv = gAbsent ? undefined : generated;

  // The intended omit-vs-keep-`{ id }` difference, ignored at any depth; a
  // changed reference id falls through to report.
  if (ignoreShallowLinks && isShallowLink(lv) && isShallowLink(gv)) {
    let lIds = shallowIds(lv);
    let gIds = shallowIds(gv);
    if (lIds.length === 0 || gIds.length === 0) return;
    if (stringify(lIds) === stringify(gIds)) return;
    diffs.push(
      `${path}: live=${stringify(lv) ?? 'null'} generated=${stringify(gv) ?? 'null'}`,
    );
    return;
  }

  if (lAbsent || gAbsent) {
    diffs.push(
      `${path}: live=${lAbsent ? 'absent' : (stringify(lv) ?? 'null')} generated=${gAbsent ? 'absent' : (stringify(gv) ?? 'null')}`,
    );
    return;
  }

  if (isObject(lv) && isObject(gv)) {
    let keys = new Set([...Object.keys(lv), ...Object.keys(gv)]);
    for (let syntheticKey of SYNTHETIC_SEARCH_DOC_KEYS) {
      keys.delete(syntheticKey);
    }
    for (let key of keys) {
      diffValue(
        path ? `${path}.${key}` : key,
        key in lv ? lv[key] : ABSENT,
        key in gv ? gv[key] : ABSENT,
        ignoreShallowLinks,
        diffs,
      );
    }
    return;
  }

  if (Array.isArray(lv) && Array.isArray(gv)) {
    if (lv.length !== gv.length) {
      diffs.push(
        `${path}: live=${stringify(lv) ?? 'null'} generated=${stringify(gv) ?? 'null'}`,
      );
      return;
    }
    for (let i = 0; i < lv.length; i++) {
      diffValue(`${path}[${i}]`, lv[i], gv[i], ignoreShallowLinks, diffs);
    }
    return;
  }

  if ((stringify(lv) ?? 'null') !== (stringify(gv) ?? 'null')) {
    diffs.push(
      `${path}: live=${stringify(lv) ?? 'null'} generated=${stringify(gv) ?? 'null'}`,
    );
  }
}

// Compare two search docs and return a list of human-readable divergences
// (empty when equivalent). Synthetic keys stamped after generation
// (SYNTHETIC_SEARCH_DOC_KEYS) are ignored; object key order is normalized.
export function diffDoc(
  live: SearchDoc,
  generated: SearchDoc,
  ignoreShallowLinks: boolean,
): string[] {
  let diffs: string[] = [];
  diffValue('', live ?? {}, generated ?? {}, ignoreShallowLinks, diffs);
  return diffs;
}
