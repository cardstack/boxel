import type { DBAdapter } from './db.ts';
import { query, type Expression } from './expression.ts';
import type { IncrementalChange } from './tasks/indexer.ts';

// The catch-up sweep's read side. It reconciles two independently-advancing
// channels — the search-doc index (`boxel_index`) and the prerendered HTML
// (`prerendered_html`) — by finding index rows whose HTML has fallen behind
// (or was never produced) and that no prerender_html job is on track to fix,
// then leaves the repair enqueue to the caller. A healthy system finds nothing.

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export interface StalePrerenderedHtmlRow {
  realmURL: string;
  url: string;
  // The `boxel_index` generation this row's HTML must catch up to. A repair
  // is warranted only when no job already stamps HTML for this URL at or
  // beyond this generation.
  generation: number;
}

export interface RealmGenerationInfo {
  generation: number;
  loaderEpoch: string;
}

// Index rows whose prerendered HTML is behind the search-doc index, or absent
// entirely, restricted to live, non-errored rows:
//   - `is_deleted` rows are tombstones — a deletion's tombstone-render is not
//     served, so a lagging one is harmless and left to the deletion's own job.
//   - index-errored rows (`has_error` / `error_doc`) have no card to render; the
//     index error is the recorded outcome and surfaces via the read-side error
//     union regardless of the HTML generation.
// Staleness is measured per row against its own `boxel_index.generation`, not
// against the realm's current generation: a row the latest pass did not revisit
// keeps its own generation and its HTML at that generation is fresh for it.
export async function findStalePrerenderedHtmlRows(
  dbAdapter: DBAdapter,
): Promise<StalePrerenderedHtmlRow[]> {
  let rows = (await query(dbAdapter, [
    `SELECT i.realm_url, i.url, i.generation
     FROM boxel_index i
     LEFT JOIN prerendered_html ph
       ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
     WHERE i.is_deleted IS NOT TRUE
       AND i.has_error IS NOT TRUE
       AND i.error_doc IS NULL
       AND (ph.url IS NULL OR ph.generation < i.generation)`,
  ] as Expression)) as {
    realm_url: string;
    url: string;
    generation: number | string;
  }[];
  return rows.map((row) => ({
    realmURL: row.realm_url,
    url: row.url,
    generation: Number(row.generation),
  }));
}

// The highest generation at which a still-pending prerender_html job is on
// track to (re)render each URL, keyed realm → url → generation. Only queued or
// running (`unfulfilled`) jobs count, and only their `update` changes: an
// `update` is what a repair enqueues, while a `delete` change tombstones rather
// than renders, so it must not suppress the repair of a live row (a consistent
// index cannot show a live row while a job is deleting it).
//
// `resolved` and `rejected` jobs are both excluded, so both are eligible for
// repair. A resolved job that left a row stale (e.g. its lower-generation write
// lost the monotonic swap) is genuine residue. A `rejected` job is a whole-job
// failure: the handler threw — a transient upstream outage, a job timeout —
// before the swap, so its HTML never landed. That is exactly the residue this
// sweep repairs; re-enqueuing renders the row once the transient cause clears,
// and a job that keeps failing simply re-rejects at the background tier rather
// than pinning the row stale forever. A per-URL render that deterministically
// fails never reaches this path: it records an `error_doc` row at the current
// generation, which reads as fresh and so never appears stale. The per-row
// generation gate means an older job never masks residue the index has moved
// past.
export async function findActivePrerenderHtmlJobCoverage(
  dbAdapter: DBAdapter,
): Promise<Map<string, Map<string, number>>> {
  let rows = (await query(dbAdapter, [
    `SELECT args FROM jobs
     WHERE job_type = 'prerender_html'
       AND status = 'unfulfilled'`,
  ] as Expression)) as { args: unknown }[];

  let byRealm = new Map<string, Map<string, number>>();
  for (let row of rows) {
    let parsed = parseCoverageArgs(row.args);
    if (!parsed) {
      continue;
    }
    let { realmURL, generation, changes } = parsed;
    let urls = byRealm.get(realmURL);
    if (!urls) {
      urls = new Map<string, number>();
      byRealm.set(realmURL, urls);
    }
    for (let change of changes) {
      if (change.operation !== 'update') {
        continue;
      }
      let prior = urls.get(change.url);
      if (prior == null || generation > prior) {
        urls.set(change.url, generation);
      }
    }
  }
  return byRealm;
}

function parseCoverageArgs(
  args: unknown,
):
  | { realmURL: string; generation: number; changes: IncrementalChange[] }
  | undefined {
  let obj: unknown = args;
  if (typeof args === 'string') {
    try {
      obj = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (!isObjectLike(obj)) {
    return undefined;
  }
  let { realmURL, generation, changes } = obj;
  if (
    typeof realmURL !== 'string' ||
    typeof generation !== 'number' ||
    !Array.isArray(changes)
  ) {
    return undefined;
  }
  let normalized: IncrementalChange[] = [];
  for (let change of changes) {
    if (isObjectLike(change) && typeof change.url === 'string') {
      normalized.push({
        url: change.url,
        operation: change.operation === 'delete' ? 'delete' : 'update',
      });
    }
  }
  return { realmURL, generation, changes: normalized };
}

// The realm-level target for a repair: HTML is (re)rendered from current source
// and stamped at the realm's current generation, under the monotonic swap guard.
export async function fetchRealmGenerations(
  dbAdapter: DBAdapter,
): Promise<Map<string, RealmGenerationInfo>> {
  let rows = (await query(dbAdapter, [
    `SELECT realm_url, current_generation, loader_epoch FROM realm_generations`,
  ] as Expression)) as {
    realm_url: string;
    current_generation: number | string;
    loader_epoch: string | null;
  }[];
  let map = new Map<string, RealmGenerationInfo>();
  for (let row of rows) {
    map.set(row.realm_url, {
      generation: Number(row.current_generation),
      loaderEpoch: row.loader_epoch ?? '0',
    });
  }
  return map;
}

// Pure reconciliation: drop every stale URL a job already covers at or beyond
// the generation the row needs, and group the survivors by realm. Repeated
// sweeps over the same residue converge — a URL enqueued last tick is covered
// by that tick's still-active job this tick — and the job coalescing collapses
// any that slip through into existing queued work.
export function planPrerenderHtmlRepairs(
  staleRows: StalePrerenderedHtmlRow[],
  coverage: Map<string, Map<string, number>>,
): Map<string, string[]> {
  let byRealm = new Map<string, Set<string>>();
  for (let row of staleRows) {
    let coveredGeneration = coverage.get(row.realmURL)?.get(row.url);
    if (coveredGeneration != null && coveredGeneration >= row.generation) {
      continue;
    }
    let urls = byRealm.get(row.realmURL);
    if (!urls) {
      urls = new Set<string>();
      byRealm.set(row.realmURL, urls);
    }
    urls.add(row.url);
  }
  let plan = new Map<string, string[]>();
  for (let [realmURL, urls] of byRealm) {
    plan.set(realmURL, [...urls]);
  }
  return plan;
}
