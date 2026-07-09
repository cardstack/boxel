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
//   - index-errored rows (`error_doc` set, or a `*-error` type) have no card to
//     render; the index error is the recorded outcome and surfaces via the
//     read-side error union regardless of the HTML generation.
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
       AND i.error_doc IS NULL
       AND i.type NOT LIKE '%-error'
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

// The highest generation at which any not-yet-succeeded prerender_html job is
// on track to (re)render each URL, keyed realm → url → generation. Only
// `update` changes count: an `update` is what a repair enqueues, and a job's
// `delete` change tombstones rather than renders, so it must not suppress the
// repair of a live row (a consistent index cannot show a live row while a job
// is deleting it, so this never masks real coverage).
//
//   - `unfulfilled` (queued or running) — a repair is already scheduled or
//     in flight; re-enqueuing would only be absorbed by the coalescing.
//   - `rejected` — the render deterministically failed and was abandoned;
//     re-enqueuing it at the same generation would just fail again.
//
// `resolved` jobs are deliberately excluded: if a row is still stale after a
// job resolved (e.g. its lower-generation write lost to the monotonic swap
// guard), that is genuine residue this sweep exists to repair. The per-row
// generation gate means an old job (below the row's current generation) never
// masks residue whose content has since advanced.
export async function findActivePrerenderHtmlJobCoverage(
  dbAdapter: DBAdapter,
): Promise<Map<string, Map<string, number>>> {
  let rows = (await query(dbAdapter, [
    `SELECT args FROM jobs
     WHERE job_type = 'prerender_html'
       AND status IN ('unfulfilled', 'rejected')`,
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
