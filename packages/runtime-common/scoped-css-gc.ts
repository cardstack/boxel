import {
  type Expression,
  param,
  every,
  any,
  query,
  dbExpression,
  separatedByCommas,
  addExplicitParens,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { coerceTypes } from './index-structure.ts';
import {
  isHashedScopedCSSRequest,
  parseScopedCSSRequest,
} from './scoped-css.ts';

// How long a `scoped_css` row is protected from the sweep after its last
// intern, measured against `last_interned_at`. The window is what makes the
// sweep safe to run from a scheduled job instead of inside an index pass:
// interning happens during a pass's visit loop, before the pass promotes the
// rows that reference the hash, so a row can legitimately sit unreferenced
// (from the production tables' point of view) for as long as a pass — or a
// failed pass awaiting its resume, whose skipped rows never re-intern —
// remains unpromoted. Every intern refreshes `last_interned_at` (the upsert
// touches it even when the bytes were already stored), so "recently interned"
// bounds "possibly referenced by an unpromoted pass". A day comfortably
// exceeds any indexing job's timeout plus its queue wait; garbage just waits
// one extra sweep.
export const SCOPED_CSS_GC_GRACE_MS = 24 * 60 * 60 * 1000;

// Drop the realm's `scoped_css` rows that no live production row references
// and no in-flight index pass could still be about to reference.
//
// The reference set is complete after ANY promoted pass: the scan reads the
// whole realm's production `boxel_index` + `prerendered_html` (both `deps`
// and `last_known_good_deps`), not an invalidation slice. Two things keep the
// sweep from racing writers:
//
// - Callers run it inside the realm's indexing concurrency group
//   (`indexingConcurrencyGroup(realmURL)`), so it never overlaps a running
//   index pass for the realm.
// - The `last_interned_at` grace window (see above) covers what serialization
//   cannot: hashes interned by a pass that failed and has not yet resumed,
//   and hashes the prerender-html channel (a separate concurrency group)
//   interned but not yet promoted.
//
// Rows another realm interned for the same stylesheet are untouched — each
// realm ref-counts its own copy. Returns the number of rows removed.
export async function sweepUnreferencedScopedCSS(
  dbAdapter: DBAdapter,
  realmURL: string,
  opts?: { graceMs?: number },
): Promise<number> {
  let graceMs = opts?.graceMs ?? SCOPED_CSS_GC_GRACE_MS;
  let referenced = new Set<string>();
  for (let table of ['boxel_index', 'prerendered_html'] as const) {
    for (let column of ['deps', 'last_known_good_deps'] as const) {
      let rows = (await query(
        dbAdapter,
        [
          dbExpression({
            pg: `SELECT DISTINCT dep_entry.value AS dep FROM ${table} AS i CROSS JOIN LATERAL jsonb_array_elements_text(i.${column}) AS dep_entry(value) WHERE`,
            sqlite: `SELECT DISTINCT dep_entry.value AS dep FROM ${table} AS i CROSS JOIN json_each(i.${column}) AS dep_entry WHERE`,
          }),
          ...every([
            ['i.realm_url =', param(realmURL)],
            [`i.${column} IS NOT NULL`],
            any([['i.is_deleted = false'], ['i.is_deleted IS NULL']]),
            [`dep_entry.value LIKE '%.glimmer-scoped.css'`],
          ]),
        ] as Expression,
        coerceTypes,
      )) as unknown as { dep: string }[];
      for (let { dep } of rows) {
        if (isHashedScopedCSSRequest(dep)) {
          let parsed = parseScopedCSSRequest(dep);
          if (parsed.form === 'hashed') {
            referenced.add(parsed.cssHash);
          }
        }
      }
    }
  }
  let stored = (await query(
    dbAdapter,
    [
      `SELECT hash FROM scoped_css WHERE realm_url =`,
      param(realmURL),
      `AND last_interned_at <`,
      param(Date.now() - graceMs),
    ] as Expression,
    coerceTypes,
  )) as unknown as { hash: string }[];
  let unreferenced = stored
    .map(({ hash }) => hash)
    .filter((hash) => !referenced.has(hash));
  const hashesPerDelete = 100;
  for (let i = 0; i < unreferenced.length; i += hashesPerDelete) {
    let slice = unreferenced.slice(i, i + hashesPerDelete);
    await query(
      dbAdapter,
      [
        `DELETE FROM scoped_css WHERE`,
        ...every([
          ['realm_url =', param(realmURL)],
          [
            'hash IN',
            ...addExplicitParens(
              separatedByCommas(slice.map((hash) => [param(hash)])),
            ),
          ],
        ]),
      ] as Expression,
      coerceTypes,
    );
  }
  return unreferenced.length;
}
