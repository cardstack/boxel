import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  param,
  query,
  separatedByCommas,
  type Expression,
} from './expression.ts';
import type { IncrementalChange } from './tasks/indexer.ts';
import { prerenderHtmlConcurrencyGroup } from './jobs/prerender-html.ts';

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
// and a realm whose jobs keep rejecting is retried on the rejection-streak
// backoff schedule (`findPrerenderHtmlRejectionStreaks`) rather than at full
// sweep frequency forever. A per-URL failure — a render error, or the visit's
// own request failing outright — never reaches this path: the visit loop
// records an `error_doc` row at the current generation, which reads as fresh
// and so never appears stale. The per-row generation gate means an older job
// never masks residue the index has moved past.
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

export interface PrerenderHtmlRejectionStreak {
  // Rejected `prerender_html` jobs for the realm with no resolved job in
  // between, newest first, within the scan's lookback window.
  consecutiveRejections: number;
  // Milliseconds since the newest rejection finished, measured on the
  // database clock (the same clock that stamped `finished_at`) so callers
  // never compare across clock domains.
  msSinceLastRejection: number;
}

// The backoff schedule for repairing a realm whose prerender_html jobs keep
// rejecting: one rejection retries at the sweep's own cadence (whole-job
// failures are usually transient — an upstream outage, a job timeout — and a
// single one warrants a prompt retry), and each further consecutive rejection
// doubles the wait, capped so a persistently failing realm still gets a few
// renders a day rather than none. Every retry that fails extends the streak,
// so the interval keeps its shape however often the sweep itself runs; the
// first resolved job resets the realm to full frequency.
export const PRERENDER_HTML_REPAIR_BACKOFF_BASE_MS = 60 * 60 * 1000;
export const PRERENDER_HTML_REPAIR_BACKOFF_CAP_MS = 8 * 60 * 60 * 1000;

export function prerenderHtmlRepairBackoffMs(
  consecutiveRejections: number,
): number {
  if (consecutiveRejections <= 1) {
    return 0;
  }
  return Math.min(
    PRERENDER_HTML_REPAIR_BACKOFF_BASE_MS * 2 ** (consecutiveRejections - 1),
    PRERENDER_HTML_REPAIR_BACKOFF_CAP_MS,
  );
}

// Bounded lookback for the streak scan: long enough to hold a
// several-rejection streak even at the capped retry interval, short enough
// that the scan never trawls the full jobs history. A streak whose older
// rejections fall outside the window just under-counts — the backoff is
// already at (or near) its cap by then, so the clamp costs nothing.
const REJECTION_STREAK_LOOKBACK_HOURS = 48;

// Consecutive-rejection streaks for the given realms' prerender_html jobs,
// keyed by realm. A realm appears only when its most recent finished job
// within the lookback window was rejected; a newest-first walk stops at the
// first resolved job. Only finished jobs participate — an unfulfilled job is
// active coverage, which `findActivePrerenderHtmlJobCoverage` already
// accounts for.
export async function findPrerenderHtmlRejectionStreaks(
  dbAdapter: DBAdapter,
  realmURLs: string[],
): Promise<Map<string, PrerenderHtmlRejectionStreak>> {
  let streaks = new Map<string, PrerenderHtmlRejectionStreak>();
  if (realmURLs.length === 0) {
    return streaks;
  }
  let realmByGroup = new Map(
    realmURLs.map((realmURL) => [
      prerenderHtmlConcurrencyGroup(realmURL),
      realmURL,
    ]),
  );
  let rows = (await query(dbAdapter, [
    `SELECT concurrency_group, status,
       (EXTRACT(EPOCH FROM (NOW() - finished_at)) * 1000)::bigint AS ms_since_finished
     FROM jobs
     WHERE job_type = 'prerender_html'
       AND status IN ('resolved', 'rejected')
       AND finished_at IS NOT NULL
       AND finished_at > NOW() - INTERVAL '${REJECTION_STREAK_LOOKBACK_HOURS} hours'
       AND concurrency_group IN`,
    ...addExplicitParens(
      separatedByCommas(
        [...realmByGroup.keys()].map((group) => [param(group)]),
      ),
    ),
    `ORDER BY finished_at DESC`,
  ] as Expression)) as {
    concurrency_group: string;
    status: string;
    ms_since_finished: number | string;
  }[];

  // Rows arrive newest-first across all realms; filtering per realm
  // preserves each realm's newest-first order, so a streak is the run of
  // rejections before that realm's first non-rejected row.
  let settled = new Set<string>();
  for (let row of rows) {
    let realmURL = realmByGroup.get(row.concurrency_group);
    if (!realmURL || settled.has(realmURL)) {
      continue;
    }
    if (row.status !== 'rejected') {
      settled.add(realmURL);
      continue;
    }
    let streak = streaks.get(realmURL);
    if (streak) {
      streak.consecutiveRejections++;
    } else {
      streaks.set(realmURL, {
        consecutiveRejections: 1,
        msSinceLastRejection: Number(row.ms_since_finished),
      });
    }
  }
  return streaks;
}
