import type Koa from 'koa';
import {
  ensureTrailingSlash,
  fetchRealmPermissions,
  param,
  query,
  SupportedMimeType,
  type DBAdapter,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import {
  prerenderHtmlConcurrencyGroup,
  publishedHtmlHasCaughtUp,
} from '@cardstack/runtime-common/jobs/prerender-html';
import {
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The stage of a publish a realm is currently in. `index` and `render` are the
// two waits `_readiness-check?awaitPrerenderHtml=true` performs, in the same
// order, so a publish's progress display and the moment it reports ready can't
// disagree; `done` is both having settled.
//
// `queued` is the case the other three can't express: work is outstanding but
// no worker holds it. Reporting that as `index` would render a stalled queue
// identically to a slow one — the exact ambiguity this endpoint exists to
// remove — so it is called out rather than folded in.
type PublishPhase = 'queued' | 'index' | 'render' | 'done';

// `total_files` / `files_completed` come from the LEFT JOIN against
// `job_progress`, so they are null for a job that hasn't reported yet.
interface PublishProgressRow {
  total_files?: number | null;
  files_completed?: number | null;
  has_worker?: boolean;
}

// Reports how far along a published realm's indexing and prerendering are, so
// a publish client can show real progress across the minutes those two passes
// take instead of an indeterminate spinner.
//
// Served from the realm server rather than the published realm: a published
// realm is world-readable, so a route there would expose a realm's file counts
// to any visitor, whereas here the realm-server session the caller already used
// to POST `_publish-realm` authorizes the read against the same `realm-owner`
// permission.
//
// Every field is read from Postgres — `jobs` / `job_progress`, written through
// by whichever worker holds the job (see IndexingEventSink) — so any replica
// answers identically, including one that had no part in the publish.
export default function handlePublishProgress({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      let token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to read publish progress',
        );
        return;
      }
      let { user: ownerUserId } = token;

      let publishedRealmURLParam = ctxt.query.published_realm_url as
        | string
        | undefined;
      if (!publishedRealmURLParam) {
        await sendResponseForBadRequest(
          ctxt,
          'published_realm_url query parameter is required',
        );
        return;
      }
      let publishedRealmURL: string;
      try {
        publishedRealmURL = ensureTrailingSlash(
          new URL(publishedRealmURLParam).href,
        );
      } catch (_error) {
        await sendResponseForBadRequest(
          ctxt,
          'published_realm_url is not a valid URL',
        );
        return;
      }

      // Publishing grants the publisher `realm-owner` on the published realm,
      // so this is the same authority that produced the work being reported on.
      // An unknown realm has no permissions rows and so is indistinguishable
      // from one the caller may not read — both answer 403, which keeps this
      // from confirming whether a given published URL exists.
      let permissions = await fetchRealmPermissions(
        dbAdapter,
        new URL(publishedRealmURL),
      );
      if (!permissions[ownerUserId]?.includes('realm-owner')) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to read publish progress for this realm`,
        );
        return;
      }

      let progress = await readPublishProgress(dbAdapter, publishedRealmURL);

      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            data: {
              type: 'publish-progress',
              id: publishedRealmURL,
              attributes: progress,
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': SupportedMimeType.JSONAPI,
              // Progress changes every second; a cached answer would freeze the
              // bar at whatever an intermediary happened to store.
              'cache-control': 'no-store',
            },
          },
        ),
      );
    } catch (error) {
      console.error('Error reading publish progress:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}

// Reports on whichever job holds the realm's index and prerender lanes. No
// publish or job identity is threaded through, and that is deliberate rather
// than an approximation: readiness gates on those same two lanes (see
// `awaitRealmIndexSettled` and `publishedHtmlHasCaughtUp`), so whatever occupies
// them is exactly the work a publish is waiting on, whether the publish
// enqueued it or not. A reindex triggered from elsewhere mid-publish does hold
// that publish up, and reporting its progress is the honest reading. Narrowing
// this to the publish's own job would report `done` while readiness kept waiting
// — the disagreement this endpoint exists to prevent.
//
// What lane scoping doesn't carry is intent. Polled with no publish in flight,
// this answers "how far along is this realm's indexing", which is a weaker claim
// than the endpoint's name makes; a caller outside a `waitForReady` window
// should read it that way.
async function readPublishProgress(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<{
  phase: PublishPhase;
  filesCompleted: number;
  totalFiles: number;
}> {
  let indexJob = await currentJobProgress(
    dbAdapter,
    indexingConcurrencyGroup(realmURL),
  );
  if (indexJob) {
    return indexJob.has_worker
      ? { phase: 'index', ...counts(indexJob) }
      : // Nothing is working the job, so it has no counts to report and none
        // are coming until a worker picks it up.
        { phase: 'queued', filesCompleted: 0, totalFiles: 0 };
  }

  // The index lane is clear, so anything outstanding is HTML. A job in the
  // prerender lane carries the counts.
  let htmlJob = await currentJobProgress(
    dbAdapter,
    prerenderHtmlConcurrencyGroup(realmURL),
  );
  if (htmlJob) {
    return htmlJob.has_worker
      ? { phase: 'render', ...counts(htmlJob) }
      : { phase: 'queued', filesCompleted: 0, totalFiles: 0 };
  }
  // An empty lane does not mean the render is done: the index pass enqueues its
  // prerender job fire-and-forget, so the work can be pending with nothing yet
  // in the lane. Fall back to the same landed-HTML signal readiness itself gates
  // on — shared with `awaitPublishedHtmlReady` rather than restated here, so the
  // two can't drift into disagreeing about whether a publish has finished — or a
  // publish would be told it had finished before its page existed.
  if (!(await publishedHtmlHasCaughtUp(dbAdapter, realmURL))) {
    return { phase: 'render', filesCompleted: 0, totalFiles: 0 };
  }

  return { phase: 'done', filesCompleted: 0, totalFiles: 0 };
}

// The job currently holding a realm's lane, and whether a worker is actually on
// it. Jobs in one concurrency group serialize, so at most one is held at a time;
// prefer the held one and fall back to the oldest queued, which is the one a
// worker will claim next.
//
// `has_worker` is a live reservation — uncompleted and not yet expired. An
// expired one means the worker that held the job died without finishing it, so
// the job is claimable again and, until something claims it, nobody is working
// on it; that reads the same as never having been claimed.
//
// A job claimed but yet to report its first event has no `job_progress` row —
// hence the LEFT JOIN and the null columns, which surface as 0/0 ("starting")
// rather than dropping the phase.
async function currentJobProgress(
  dbAdapter: DBAdapter,
  concurrencyGroup: string,
): Promise<PublishProgressRow | undefined> {
  let [row] = (await query(dbAdapter, [
    `SELECT jp.total_files, jp.files_completed,`,
    `EXISTS (SELECT 1 FROM job_reservations jr WHERE jr.job_id = j.id`,
    `AND jr.completed_at IS NULL AND jr.locked_until > NOW()) AS has_worker`,
    `FROM jobs j`,
    `LEFT JOIN job_progress jp ON jp.job_id = j.id`,
    `WHERE j.status = 'unfulfilled' AND j.concurrency_group =`,
    param(concurrencyGroup),
    `ORDER BY has_worker DESC, j.id ASC LIMIT 1`,
  ])) as PublishProgressRow[];
  return row;
}

// Postgres returns these as strings through the adapter's row shape; coerce
// once here so the wire contract is always numbers.
function counts(row: PublishProgressRow): {
  filesCompleted: number;
  totalFiles: number;
} {
  return {
    filesCompleted: Number(row.files_completed ?? 0),
    totalFiles: Number(row.total_files ?? 0),
  };
}
