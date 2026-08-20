import type { Readable } from 'stream';
import { toNodeStream } from '#media-cache-stream';
import { createResponse } from './create-response.ts';
import type { DBAdapter } from './db.ts';
import { logger } from './log.ts';
import {
  touchMediaCacheEntry,
  type MediaCacheAdapter,
  type MediaCacheEntry,
} from './media-cache.ts';
import { ifNoneMatchMatches, type RequestContext } from './realm.ts';
import type { ResponseWithNodeStream } from './virtual-network.ts';

const log = logger('media-cache');

// The HTTP face of a MediaCache capture, shared by every route that serves
// one. The URL is the durable reference — what rendered HTML and
// `meta.screenshots` embed — and the content hash surfaces only as the
// validator: a re-capture changes what the URL serves (the ETag rotates),
// never the URL itself. So the cache policy is a short freshness window
// with cheap revalidation: an unchanged capture revalidates as a bodyless
// 304, a changed one arrives in the same response, and no client holds
// stale bytes for longer than the window.
export const MEDIA_CACHE_MAX_AGE_SECONDS = 60;
export const MEDIA_CACHE_STALE_WHILE_REVALIDATE_SECONDS = 3600;

// `public` exactly when the realm is world-readable — the same derivation as
// `serveLocalFile` — so a shared cache can hold a public realm's screenshots
// (og:image fetches, crawlers) while a private realm's stay per-client.
export function mediaCacheVisibility(
  requestContext: RequestContext,
): 'public' | 'private' {
  return requestContext.permissions['*']?.includes('read')
    ? 'public'
    : 'private';
}

function hitCacheControl(requestContext: RequestContext): string {
  return (
    `${mediaCacheVisibility(requestContext)}, ` +
    `max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}, ` +
    `stale-while-revalidate=${MEDIA_CACHE_STALE_WHILE_REVALIDATE_SECONDS}`
  );
}

// An uncaptured (or no-longer-captured) request. The 404 carries the same
// short freshness window as a hit rather than being uncacheable: an `<img>`
// pointing at a not-yet-captured name picks the image up on a later
// revalidation, and an image load is never made to wait synchronously on
// capture work.
export function mediaCacheMissResponse({
  requestContext,
}: {
  requestContext: RequestContext;
}): Response {
  return createResponse({
    body: null,
    init: {
      status: 404,
      headers: {
        'cache-control': `${mediaCacheVisibility(requestContext)}, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
      },
    },
    requestContext,
  });
}

// Streams one resolved ledger entry. The ETag is the entry's object key —
// the hash of the bytes themselves — so revalidation is exact: any
// `If-None-Match` echo of it answers as a bodyless 304, and a re-capture
// that changed the bytes rotates the validator. Content type comes from the
// ledger (the adapters store no metadata of their own). A hit — 200 or 304 —
// bumps the entry's last-accessed stamp, which is what keeps a capture out
// of the GC's on-demand age-out lane while it is in use.
//
// An entry whose object is gone from the store (reclaimed between this
// request's ledger read and its stream open) is served as an uncaptured
// miss, not an error: the ledger row is the GC's cleanup path and a
// re-capture heals the URL.
export async function serveMediaCacheEntry({
  request,
  requestContext,
  entry,
  mediaCacheAdapter,
  dbAdapter,
}: {
  request: Request;
  requestContext: RequestContext;
  entry: MediaCacheEntry;
  mediaCacheAdapter: MediaCacheAdapter;
  dbAdapter: DBAdapter;
}): Promise<ResponseWithNodeStream> {
  let etag = `"${entry.objectKey}"`;
  let headers = {
    'content-type': entry.contentType,
    etag,
    'cache-control': hitCacheControl(requestContext),
  };

  let ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, etag)) {
    await touch(dbAdapter, entry);
    return createResponse({
      body: null,
      init: { status: 304, headers },
      requestContext,
    });
  }

  let stream = await mediaCacheAdapter.getStream(entry.objectKey);
  if (!stream) {
    return mediaCacheMissResponse({ requestContext });
  }
  await touch(dbAdapter, entry);

  // The bytes MUST leave via `nodeStream` — the realm-server's Koa bridge
  // streams a `nodeStream` verbatim but drains every other body shape
  // (including a Response constructed over a Uint8Array) through text,
  // which corrupts binary. `toNodeStream` passes an adapter's node Readable
  // through and wraps a bare async iterable, so both interface-legal stream
  // shapes exit through the one safe path.
  let response: ResponseWithNodeStream = createResponse({
    body: null,
    init: {
      status: 200,
      headers: { ...headers, 'content-length': String(entry.sizeBytes) },
    },
    requestContext,
  });
  response.nodeStream = toNodeStream(stream) as Readable;
  return response;
}

// Best-effort: a failed last-accessed bump must never fail a serve — the
// worst case is an in-use on-demand capture looking idle to the GC one
// sweep early, and the next successful serve re-marks it.
async function touch(dbAdapter: DBAdapter, entry: MediaCacheEntry) {
  try {
    await touchMediaCacheEntry(dbAdapter, entry);
  } catch (e) {
    log.warn(
      `failed to bump last_accessed_at for media cache entry ${entry.objectKey}:`,
      e,
    );
  }
}
