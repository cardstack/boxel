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
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';
import {
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The stage of a publish a realm is currently in. These are the same two waits
// `_readiness-check?awaitPrerenderHtml=true` performs, in the same order, so a
// publish's progress display and the moment it reports ready can't disagree:
// `index` while the realm's index lane still holds work, `render` until the
// prerendered HTML for the current generation is live, `done` once both have
// settled.
type PublishPhase = 'index' | 'render' | 'done';

// Both columns come from the LEFT JOIN against `job_progress`, so they are
// null for a job that hasn't reported yet.
interface PublishProgressRow {
  total_files?: number | null;
  files_completed?: number | null;
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
    return { phase: 'index', ...counts(indexJob) };
  }

  // The index lane is clear, so anything outstanding is HTML. A job in the
  // prerender lane carries the counts.
  let htmlJob = await currentJobProgress(
    dbAdapter,
    prerenderHtmlConcurrencyGroup(realmURL),
  );
  if (htmlJob) {
    return { phase: 'render', ...counts(htmlJob) };
  }
  // An empty lane does not mean the render is done: the index pass enqueues its
  // prerender job fire-and-forget, so the work can be pending with nothing yet
  // in the lane. Fall back to the generation signal readiness itself gates on,
  // or a publish would be told it had finished before its page existed.
  if (!(await publishedHtmlHasCaughtUp(dbAdapter, realmURL))) {
    return { phase: 'render', filesCompleted: 0, totalFiles: 0 };
  }

  return { phase: 'done', filesCompleted: 0, totalFiles: 0 };
}

// The progress of the job currently holding a realm's lane. Jobs in one
// concurrency group serialize and are claimed oldest-first, so the lowest
// unfulfilled id is the one running; any behind it have not started and have no
// progress to report. A job that has been claimed but hasn't reported its first
// event yet has no `job_progress` row — hence the LEFT JOIN and the null
// columns, which surface as 0/0 ("starting") rather than dropping the phase.
async function currentJobProgress(
  dbAdapter: DBAdapter,
  concurrencyGroup: string,
): Promise<PublishProgressRow | undefined> {
  let [row] = (await query(dbAdapter, [
    `SELECT jp.total_files, jp.files_completed FROM jobs j`,
    `LEFT JOIN job_progress jp ON jp.job_id = j.id`,
    `WHERE j.status = 'unfulfilled' AND j.concurrency_group =`,
    param(concurrencyGroup),
    `ORDER BY j.id ASC LIMIT 1`,
  ])) as PublishProgressRow[];
  return row;
}

// Mirrors `awaitPublishedHtmlReady`'s signal: a `prerendered_html` row at or
// beyond the realm's current generation means that generation's render batch
// has landed. A realm with no generation has never been indexed and has no
// render to wait on.
async function publishedHtmlHasCaughtUp(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<boolean> {
  let [genRow] = (await query(dbAdapter, [
    'SELECT current_generation FROM realm_generations WHERE realm_url =',
    param(realmURL),
  ])) as { current_generation: number }[];
  if (genRow?.current_generation == null) {
    return true;
  }
  let rows = await query(dbAdapter, [
    'SELECT 1 FROM prerendered_html WHERE realm_url =',
    param(realmURL),
    'AND generation >=',
    param(genRow.current_generation),
    'LIMIT 1',
  ]);
  return rows.length > 0;
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
