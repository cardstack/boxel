import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  every,
  param,
  query,
  separatedByCommas,
  type Expression,
} from './expression.ts';
import type { IncrementalChange } from './tasks/indexer.ts';
import {
  parseSpawningIndexPasses,
  prerenderHtmlConcurrencyGroup,
  type SpawningIndexPass,
} from './jobs/prerender-html.ts';
import { laneFamiliesPredicate, laneFamilyOf } from './jobs/lane-family.ts';
import {
  TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS,
  TRANSIENT_RENDER_FAILURE_RETRY_CAP,
  transientRenderErrorSQL,
} from './error.ts';

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

// How many consecutive visit-request failures a URL may record before the
// sweep stops retrying it. The retry lane exists because a
// `visitRequestFailure` error describes the request, not the content — the
// render never returned a verdict, so a retry can legitimately succeed once
// e.g. temporary prerender congestion clears. The cap is the fleet
// protection: each retry of a genuinely pathological visit occupies its
// realm's prerender affinity lane for the full request timeout, so after
// this many consecutive failures the row is terminal — the recorded error
// stands until the URL's next invalidation — rather than the sweep
// re-burning that lane indefinitely.
export const PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP = 3;
// A failed row becomes retry-eligible only once its recorded rendering is
// this old, so retries space out to the sweep's own cadence instead of a
// sweep tick that lands just after the failure immediately re-rendering it.
export const PRERENDER_HTML_VISIT_FAILURE_RETRY_MIN_AGE_MS = 45 * 60 * 1000;

// The declared-capture twin of the visit-failure bounds. A capture
// failure never errors its row — the row publishes with the manifest
// omitting the failed name and `diagnostics.captureErrors` recording why
// (the broken-links model) — so the retry lane keys off that diagnostics
// record rather than an `error_doc`. Same shape as the visit-failure lane:
// consecutive-failure runs are capped, and a failed row waits out a minimum
// age between attempts. The cap is enforced against the row-level
// `captureFailureRenders` counter (renders that recorded any
// capture failure), not only the per-slot runs: a per-slot run resets
// whenever the failing name changes, which is exactly the shape a
// struggling row takes (a roster-level '*' failure alternating with a
// per-name one, format groups failing on alternating renders), and the
// row counter is the term no name change can reset. At the cap, the
// absence is the recorded outcome — the card stays fully served and
// searchable, the capture simply stays missing until the URL's next
// invalidation re-renders it.
// A row whose render failure was withheld as stale-shell carries no
// `error_doc` and sits at the current generation, so it reads as a healthy
// fresh render while serving the last good pass's HTML. That is the point —
// the alternative was publishing a failure the environment caused — but it
// also removes the `has_error` that used to tell an operator to reindex. This
// lane re-drives those rows instead, so a deploy overlap that resolves gets
// the re-render it needs without anyone watching for it.
//
// Capped rather than unbounded: if the shells never agree, retrying forever
// buys nothing and the diagnostics remain for someone to read.
export const STALE_SHELL_FAILURE_RETRY_CAP = 3;
export const STALE_SHELL_FAILURE_RETRY_MIN_AGE_MS = 10 * 60 * 1000;

// The gateway-failure twin of the stale-shell bounds. A withheld gateway
// failure is the same shape of row — no `error_doc`, sitting at the current
// generation while serving the last good pass's HTML — so it reads as a
// healthy fresh render and nothing asks for the re-render once the network
// recovers. This lane re-drives those rows instead. The min age can be shorter
// than the stale-shell lane's: a stale shell may take a whole deploy overlap
// to resolve, but the gateway failures this withholds — a balancer keep-alive
// race, a task replacement, a brief upstream blip — have already passed by the
// time the row is written, so re-rendering promptly is safe and is what turns
// a days-long latch into a sweep-cadence one. Capped for the same reason:
// a gateway failure that keeps recurring stops costing renders once the cap is
// reached and leaves its diagnostics for someone to read.
export const GATEWAY_FAILURE_RETRY_CAP = 3;
export const GATEWAY_FAILURE_RETRY_MIN_AGE_MS = 5 * 60 * 1000;

// The transient-render-failure lane. The writer stamps a render that did not
// finish (`isTransientRenderError`: a render timeout, a prerender request that
// failed transiently) as `diagnostics.transientRenderFailure` instead of
// publishing it as the card's error, so the row reads as current and nothing
// else asks for the re-render. This lane re-drives it with backoff: retry n of
// `TRANSIENT_RENDER_FAILURE_RETRY_CAP` waits `transientRenderRetryBackoffMs(n)`
// after the last attempt, time for an overloaded prerender service to drain,
// which is the cause it expects. Past the cap the row keeps its stale render
// and `_indexing-errors` lists it. Both channels take these retries: the
// renderings (`findTransientRetryPrerenderedHtmlRows`) and the index rows
// (`findTransientIndexRetryRows`). The reconcile task runs them every minute
// on their own (`transientOnly`), and again within the hourly sweep.
export {
  TRANSIENT_RENDER_FAILURE_RETRY_CAP,
  TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS,
};

// A row stamped with a transient failure. The text matches the predicate of
// the partial indexes on `boxel_index` and `prerendered_html` (migration
// `add-transient-render-failure-indexes`), so the every-minute sweep reads
// only the stamped rows.
function transientRenderFailureStampedSQL(alias: string): string {
  return `jsonb_typeof(${alias}.diagnostics -> 'transientRenderFailure') = 'array'`;
}

// The attempts the lane made at a row that died before writing it: finished
// `jobType` jobs that took the row's URL after its last failed attempt was
// written (their ids are above `transientRenderFailureJobId`, the job that
// wrote it) but never rewrote it, as a rejected or timed-out retry leaves
// things. They count as failed attempts, so the cap and the backoff bound a
// retry that keeps dying the way they bound one that keeps failing; otherwise
// the row would stay due and be re-enqueued on every sweep. Read over a
// primary-key range from that write, and only until the attempts pass the cap:
// a row whose run has used up its retries reads no jobs at all, and one whose
// retries died stops at the one that used them up, so a row that stays stamped
// costs the same however long ago it was written. Joined as `unwritten`; a row
// with no recorded job counts none.
function unwrittenAttemptsJoin(
  alias: string,
  jobType: 'incremental-index' | 'prerender_html',
): string {
  return `LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS attempts, MAX(d.finished_at) AS last_finished_at
         FROM (
           SELECT (EXTRACT(EPOCH FROM j.finished_at) * 1000)::bigint AS finished_at
             FROM jobs j
            WHERE ${alias}.diagnostics ->> 'transientRenderFailureJobId' IS NOT NULL
              AND j.id > (${alias}.diagnostics ->> 'transientRenderFailureJobId')::int
              AND j.job_type = '${jobType}'
              AND j.status IN ('resolved', 'rejected')
              AND j.args->>'realmURL' = ${alias}.realm_url
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(j.args->'changes') AS c
                WHERE c->>'url' = ${alias}.url)
            ORDER BY j.id
            LIMIT GREATEST(${TRANSIENT_RENDER_FAILURE_RETRY_CAP} + 1 - ${transientRunSQL(alias)}, 0)
         ) AS d
     ) AS unwritten ON TRUE`;
}

// The row's run of failed renders as its writer recorded it.
function transientRunSQL(alias: string): string {
  return `COALESCE((${alias}.diagnostics->>'transientRenderFailureRenders')::int, 1)`;
}

// The attempts at a row stamped with a transient failure that died before
// writing it, and when the last of them finished (epoch ms), as the sweep
// counts them (`unwrittenAttemptsJoin`): for the writer about to record the
// row's next failed attempt, so the run it writes carries them
// (`continuesTransientRenderRun`). Postgres only.
export async function unwrittenTransientAttempts(
  dbAdapter: DBAdapter,
  row: {
    table: 'boxel_index' | 'prerendered_html';
    realmURL: string;
    url: string;
    type: string;
  },
): Promise<{ attempts: number; lastFinishedAt: number | null }> {
  let jobType: 'incremental-index' | 'prerender_html' =
    row.table === 'boxel_index' ? 'incremental-index' : 'prerender_html';
  let [found] = (await query(dbAdapter, [
    `SELECT unwritten.attempts, unwritten.last_finished_at
       FROM ${row.table} r
       ${unwrittenAttemptsJoin('r', jobType)}
      WHERE r.realm_url =`,
    param(row.realmURL),
    'AND r.url =',
    param(row.url),
    'AND r.type =',
    param(row.type),
  ] as Expression)) as {
    attempts: number | string | null;
    last_finished_at: number | string | null;
  }[];
  return {
    attempts: Number(found?.attempts ?? 0),
    lastFinishedAt:
      found?.last_finished_at == null ? null : Number(found.last_finished_at),
  };
}

// Whether a row stamped with a transient failure is due its next retry:
// `alias` is the row, joined with `unwrittenAttemptsJoin`, and `attemptedAt`
// its column holding when the last attempt was written (epoch ms). Its failed
// attempts are its run plus the retries that died, and the backoff runs from
// the later of its last write and the last of those. Postgres only.
function transientRetryDueSQL(alias: string, attemptedAt: string): string {
  let attempts = `(${transientRunSQL(alias)} + COALESCE(unwritten.attempts, 0))`;
  let lastAttempt = `GREATEST(${alias}.${attemptedAt}, COALESCE(unwritten.last_finished_at, 0))`;
  return `(${transientRenderFailureStampedSQL(alias)}
           AND ${attempts} <= ${TRANSIENT_RENDER_FAILURE_RETRY_CAP}
           AND ${lastAttempt}
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS} * power(2, GREATEST(${attempts} - 1, 0))::bigint)`;
}

export const DECLARED_CAPTURE_RETRY_CAP = 3;
export const DECLARED_CAPTURE_RETRY_MIN_AGE_MS = 45 * 60 * 1000;

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
//
// A third arm admits the bounded retry lane for visit-request failures: an
// HTML row whose `error_doc` carries the `visitRequestFailure` marker is
// repairable even at a current generation — the failure describes the
// request rather than the content — until its consecutive-failure run
// reaches `PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP`, after which it reads as
// terminal exactly like a deterministic render error. A row that also carries
// the writer's transient verdict is left to the transient lane, so one lane,
// schedule and cap govern each row.
//
// A fourth arm admits the declared-capture retry lane: a *healthy*
// published row (no `error_doc`) whose `diagnostics.captureErrors`
// records capture failures is repairable while its row-level
// `captureFailureRenders` counter AND some recorded slot's
// consecutive-failure run are both below
// `DECLARED_CAPTURE_RETRY_CAP`. The row counter is what makes
// the lane converge — a per-slot run resets whenever the failing name
// changes, and per-slot runs alone would retry such a row forever — while
// the per-slot term stops retrying a stable failure set once every name
// in it is capped. A value missing from a legacy row reads as one (a
// count-less error entry as a run of one, an absent counter as one
// failing render), so legacy rows still get their retries. The repair is
// a plain re-render of the URL; the capture rides the prerender-html
// visit, and a slot already at its cap that happens to recapture
// successfully along the way just heals early. A capped row is terminal —
// the captures stay absent (thumbnail consumers fall through their
// chain) until the URL's next invalidation.
//
// The fifth and sixth arms admit the withheld-failure lanes — stale-shell and
// gateway. Both withhold by clearing the `error_doc` and keeping the prior
// render at the current generation, so the row reads as healthy and no
// `has_error` is left asking for a reindex; these arms re-drive such rows
// while their `diagnostics.<verdict>` array is present and the matching
// `<verdict>Renders` counter is below its cap, so a transient cause that
// recovers gets its re-render without anyone watching and one that keeps
// recurring stops costing renders at the cap. Their caps and min ages are
// tuned per cause (see the constants above).
//
// The seventh arm re-renders, once, a legacy row: a transient render error
// stored as the row's error without the writer's verdict
// (`transientRenderErrorSQL` on a row without the stamp). The re-render's write
// either succeeds or carries the stamp, so the arm cannot fire for the same
// row twice. A visit-request failure is left to its own lane (the third arm)
// until that lane's cap, and re-rendered once here after it: the visit loop
// that recorded it marked every rejected request, so it may be a deterministic
// failure, and the search gate still counts it, but the re-render now tells
// the two apart. Rows that carry the verdict take the transient lane's retries
// instead (`findTransientRetryPrerenderedHtmlRows`), which the reconcile task
// adds to these.
//
// The jsonb operators here are Postgres-only, like the `jobs`-table scans
// in this module: the reconcile task that issues this query runs solely
// behind the Postgres queue.
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
       AND (ph.url IS NULL
         OR ph.generation < i.generation
         OR ((ph.error_doc->>'visitRequestFailure')::boolean IS TRUE
           AND ph.diagnostics->'transientRenderFailure' IS NULL
           AND COALESCE((ph.error_doc->>'consecutiveVisitFailures')::int, 1)
             < ${PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP}
           AND ph.rendered_at
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${PRERENDER_HTML_VISIT_FAILURE_RETRY_MIN_AGE_MS})
         OR (ph.error_doc IS NULL
           AND jsonb_typeof(ph.diagnostics->'captureErrors') = 'array'
           AND COALESCE((ph.diagnostics->>'captureFailureRenders')::int, 1)
             < ${DECLARED_CAPTURE_RETRY_CAP}
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(ph.diagnostics->'captureErrors') se
             WHERE COALESCE((se->>'consecutiveFailures')::int, 1)
               < ${DECLARED_CAPTURE_RETRY_CAP})
           AND ph.rendered_at
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${DECLARED_CAPTURE_RETRY_MIN_AGE_MS})
         OR (ph.error_doc IS NULL
           AND jsonb_typeof(ph.diagnostics->'staleShellFailure') = 'array'
           AND COALESCE((ph.diagnostics->>'staleShellFailureRenders')::int, 1)
             < ${STALE_SHELL_FAILURE_RETRY_CAP}
           AND ph.rendered_at
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${STALE_SHELL_FAILURE_RETRY_MIN_AGE_MS})
         OR (ph.error_doc IS NULL
           AND jsonb_typeof(ph.diagnostics->'gatewayFailure') = 'array'
           AND COALESCE((ph.diagnostics->>'gatewayFailureRenders')::int, 1)
             < ${GATEWAY_FAILURE_RETRY_CAP}
           AND ph.rendered_at
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${GATEWAY_FAILURE_RETRY_MIN_AGE_MS})
         OR (ph.error_doc IS NOT NULL
           AND ph.diagnostics->'transientRenderFailure' IS NULL
           AND NOT ((ph.error_doc->>'visitRequestFailure')::boolean IS TRUE
             AND COALESCE((ph.error_doc->>'consecutiveVisitFailures')::int, 1)
               < ${PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP})
           AND ${transientRenderErrorSQL('ph')}
           AND ph.rendered_at
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS}))`,
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

// Renderings due a retry of a transient failure: the writer kept the prior
// render over a render that did not finish (or, with none to keep, stored the
// failure as the row's error) and stamped `diagnostics.transientRenderFailure`.
// Due by `transientRetryDueSQL`, timed from the row's `rendered_at`, counting
// prerender_html repairs that died as attempts. Restricted, like the stale
// rows, to live index rows that are not errored. Postgres only; it reads only
// the stamped rows, through the partial index on their predicate, so the
// every-minute sweep can afford it.
export async function findTransientRetryPrerenderedHtmlRows(
  dbAdapter: DBAdapter,
): Promise<StalePrerenderedHtmlRow[]> {
  let rows = (await query(dbAdapter, [
    `SELECT i.realm_url, i.url, i.generation
     FROM prerendered_html ph
     JOIN boxel_index i
       ON i.url = ph.url AND i.realm_url = ph.realm_url AND i.type = ph.type
     ${unwrittenAttemptsJoin('ph', 'prerender_html')}
     WHERE ${transientRenderFailureStampedSQL('ph')}
       AND ph.is_deleted IS NOT TRUE
       AND i.is_deleted IS NOT TRUE
       AND i.has_error IS NOT TRUE
       AND i.error_doc IS NULL
       AND ${transientRetryDueSQL('ph', 'rendered_at')}
     ORDER BY i.realm_url, i.url`,
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

// Index rows due a retry of a transient failure: the index pass kept the
// file's or card's previous good row over a visit that timed out or whose
// prerender request failed transiently (or, with no good row, stored the
// failure as the row's error) and stamped `diagnostics.transientRenderFailure`.
// Same backoff and cap as the renderings' lane (`transientRetryDueSQL`), timed
// from the row's `indexed_at` and counting incremental passes that died as
// attempts; the repair is an incremental index of exactly those URLs. Rows an
// index job already queued or running for the realm names are left to it.
//
// With `includeLegacy` (the hourly sweep), it also re-indexes, once, a legacy
// row: a transient render error stored as the row's error without the
// writer's verdict. The re-index either succeeds or writes the verdict, and
// one that dies is not repeated (no finished incremental pass may have taken
// the URL since the row was written), so a row is re-driven at most once.
// That arm reads the errored rows, and jobs by creation time, which the
// every-minute sweep leaves alone. Postgres only.
export async function findTransientIndexRetryRows(
  dbAdapter: DBAdapter,
  opts: { includeLegacy?: boolean } = {},
): Promise<Map<string, string[]>> {
  let legacyArm = opts.includeLegacy
    ? `OR (i.has_error IS TRUE
           AND i.diagnostics -> 'transientRenderFailure' IS NULL
           AND ${transientRenderErrorSQL('i')}
           AND NOT EXISTS (
             SELECT 1 FROM jobs j
             WHERE j.job_type = 'incremental-index'
               AND j.status IN ('resolved', 'rejected')
               AND j.created_at > to_timestamp(i.indexed_at / 1000.0)
               AND j.args->>'realmURL' = i.realm_url
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(j.args->'changes') AS c
                 WHERE c->>'url' = i.url))
           AND i.indexed_at
             < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
               - ${TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS})`
    : '';
  let rows = (await query(dbAdapter, [
    `SELECT i.realm_url, i.url
     FROM boxel_index i
     ${unwrittenAttemptsJoin('i', 'incremental-index')}
     WHERE i.is_deleted IS NOT TRUE
       AND (${transientRetryDueSQL('i', 'indexed_at')} ${legacyArm})
       AND NOT EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.job_type IN ('incremental-index', 'from-scratch-index')
           AND j.status = 'unfulfilled'
           AND j.args->>'realmURL' = i.realm_url
           AND (j.job_type = 'from-scratch-index'
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(j.args->'changes') AS c
               WHERE c->>'url' = i.url)))
     ORDER BY i.realm_url, i.url`,
  ] as Expression)) as { realm_url: string; url: string }[];
  let byRealm = new Map<string, string[]>();
  for (let row of rows) {
    let urls = byRealm.get(row.realm_url) ?? [];
    if (!urls.includes(row.url)) {
      urls.push(row.url);
    }
    byRealm.set(row.realm_url, urls);
  }
  return byRealm;
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
// sweep frequency forever. A deterministic per-URL render error never reaches
// this path: the visit loop records an `error_doc` row at the current
// generation, which reads as fresh and so never appears stale. A
// visit-request failure records the same kind of row but re-enters the sweep
// through the bounded retry lane in `findStalePrerenderedHtmlRows` until its
// consecutive-failure cap. The per-row generation gate means an older job
// never masks residue the index has moved past.
//
// A job spawned by index passes stamps each row from the live index once its
// spawning passes have committed, so the generation it carries does not say
// what it covers. It covers a URL at the newest generation those passes
// committed, read from the `realm_index_commits` ledger — or at every
// generation while one of them has yet to commit, since the job has not read
// its stamps yet and will read them from a commit newer than any row the sweep
// sees now. A job enqueued from committed state (a reconcile repair, or a job
// from a worker predating `spawningIndexPasses`) covers at the generation it
// carries.
export async function findActivePrerenderHtmlJobCoverage(
  dbAdapter: DBAdapter,
): Promise<Map<string, Map<string, number>>> {
  let rows = (await query(dbAdapter, [
    `SELECT args FROM jobs
     WHERE job_type = 'prerender_html'
       AND status = 'unfulfilled'`,
  ] as Expression)) as { args: unknown }[];

  let jobs = rows
    .map((row) => parseCoverageArgs(row.args))
    .filter((parsed) => parsed !== undefined);
  let committedByPass = await committedGenerationsByPass(dbAdapter, jobs);
  let byRealm = new Map<string, Map<string, number>>();
  for (let parsed of jobs) {
    let { realmURL, changes } = parsed;
    let generation = coverageGeneration(parsed, committedByPass);
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

interface CoverageArgs {
  realmURL: string;
  generation: number;
  spawningIndexPasses: SpawningIndexPass[];
  changes: IncrementalChange[];
}

// The generation each spawning index pass committed, keyed by pass id, for
// the passes the given jobs wait on. One query per realm, so each is served by
// the ledger's `(realm_url, pass_id)` index.
async function committedGenerationsByPass(
  dbAdapter: DBAdapter,
  jobs: CoverageArgs[],
): Promise<Map<string, number>> {
  let passIdsByRealm = new Map<string, Set<string>>();
  for (let job of jobs) {
    for (let pass of job.spawningIndexPasses) {
      let passIds = passIdsByRealm.get(job.realmURL) ?? new Set<string>();
      passIds.add(pass.passId);
      passIdsByRealm.set(job.realmURL, passIds);
    }
  }
  let committed = new Map<string, number>();
  for (let [realmURL, passIds] of passIdsByRealm) {
    let rows = (await query(dbAdapter, [
      'SELECT pass_id, generation FROM realm_index_commits WHERE',
      ...every([
        ['realm_url =', param(realmURL)],
        [
          'pass_id IN',
          ...addExplicitParens(
            separatedByCommas([...passIds].map((id) => [param(id)])),
          ),
        ],
      ]),
    ] as Expression)) as { pass_id: string; generation: number | string }[];
    for (let row of rows) {
      committed.set(row.pass_id, Number(row.generation));
    }
  }
  return committed;
}

// The generation a pending job is on track to render its URLs at (see
// `findActivePrerenderHtmlJobCoverage`).
function coverageGeneration(
  job: CoverageArgs,
  committedByPass: Map<string, number>,
): number {
  if (job.spawningIndexPasses.length === 0) {
    return job.generation;
  }
  let newest = -1;
  for (let { passId } of job.spawningIndexPasses) {
    let committed = committedByPass.get(passId);
    if (committed === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    newest = Math.max(newest, committed);
  }
  return newest;
}

function parseCoverageArgs(args: unknown): CoverageArgs | undefined {
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
  let { realmURL, generation, spawningIndexPasses, changes } = obj;
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
  return {
    realmURL,
    generation,
    spawningIndexPasses: parseSpawningIndexPasses(spawningIndexPasses) ?? [],
    changes: normalized,
  };
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
  // Keyed by the realm's prerender-html lane family, so a job in any of the
  // realm's lanes counts toward the realm's streak.
  let realmByFamily = new Map(
    realmURLs.map((realmURL) => [
      prerenderHtmlConcurrencyGroup(realmURL),
      realmURL,
    ]),
  );
  let rows = (await query(dbAdapter, [
    `SELECT ${laneFamilyOf('jobs')} AS lane_family, status,
       (EXTRACT(EPOCH FROM (NOW() - finished_at)) * 1000)::bigint AS ms_since_finished
     FROM jobs
     WHERE job_type = 'prerender_html'
       AND status IN ('resolved', 'rejected')
       AND finished_at IS NOT NULL
       AND finished_at > NOW() - INTERVAL '${REJECTION_STREAK_LOOKBACK_HOURS} hours'
       AND`,
    ...laneFamiliesPredicate([...realmByFamily.keys()]),
    `ORDER BY finished_at DESC`,
  ] as Expression)) as {
    lane_family: string;
    status: string;
    ms_since_finished: number | string;
  }[];

  // Rows arrive newest-first across all realms; filtering per realm
  // preserves each realm's newest-first order, so a streak is the run of
  // rejections before that realm's first non-rejected row.
  let settled = new Set<string>();
  for (let row of rows) {
    let realmURL = realmByFamily.get(row.lane_family);
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
