import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  DURING_PRERENDER_HEADER,
  parseSearchRequestPayload,
  parseSearchEntryQueryFromPayload,
  sanitizeConsumingRealmHeader,
  SearchRequestError,
  searchEntryRealms,
  sanitizeLoggingCorrelationId,
  X_BOXEL_CONSUMING_REALM_HEADER,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  RequestTimings,
  emitSearchTiming,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  getMultiRealmAuthorization,
  getSearchRequestPayload,
} from '../middleware/multi-realm-authorization.ts';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import type { JobScopedSearchCache } from '../job-scoped-search-cache.ts';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_JOB_PRIORITY_HEADER,
  sanitizeJobPriorityHeader,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants.ts';
import { respondWithJobScopedSearchCache } from './handle-search.ts';

// The v2 federated search: the search-entry wire model over every requested
// realm. Parses the search-entry-rooted query (the `item.` membership query,
// the `htmlQuery` binding, the sparse fieldset), fans out to each realm's
// `searchEntries`, and merges the per-realm documents (`included` deduped by
// `(type, id)`). Cache + ETag ride the same job-scoped protocol as the
// existing federated handlers; the inner key folds every request member that
// changes the body — the membership query plus the applied htmlQuery, the
// fieldset, and any `cardUrls` subset — so two v2 requests differing on any
// of them get distinct entries + ETags, and the v2 keys can't collide with
// the other endpoints' (whose key opts carry different members).
export default function handleSearchV2(opts: {
  reconciler: RealmRegistryReconciler;
  searchCache?: JobScopedSearchCache;
}): (ctxt: Koa.Context) => Promise<void> {
  let { reconciler, searchCache } = opts;
  return async function (ctxt: Koa.Context) {
    let handlerStart = Date.now();
    let loggingCorrelationId = sanitizeLoggingCorrelationId(
      ctxt.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
    );
    let timings =
      loggingCorrelationId !== null ? new RequestTimings() : undefined;

    let { realmList } = getMultiRealmAuthorization(ctxt);

    let parsed;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let parseRequest = async () => {
        let payload = getSearchRequestPayload(ctxt);
        if (payload === undefined) {
          payload = await parseSearchRequestPayload(request);
        }
        return parseSearchEntryQueryFromPayload(payload);
      };
      parsed = timings
        ? await timings.time('parse', parseRequest)
        : await parseRequest();
    } catch (e) {
      if (e instanceof SearchRequestError) {
        // `invalid-query` / `invalid-render` are client request-shape errors
        // → the JSON:API search-error body; anything else (bad method / JSON)
        // → a plain bad request, the same split as the other search handlers.
        if (e.code === 'invalid-query' || e.code === 'invalid-render') {
          await setContextResponse(ctxt, buildSearchErrorResponse(e.message));
        } else {
          await sendResponseForBadRequest(ctxt, e.message);
        }
        return;
      }
      throw e;
    }

    let cacheOnlyDefinitions = ctxt.get(DURING_PRERENDER_HEADER).length > 0;
    // Inside a prerender the search skips the `loadLinks` relationship-
    // assembly pass entirely: the host re-resolves every result from its raw
    // card+source file, so the transitive `included[]` expansion is
    // throwaway work in this path. Same gating as `cacheOnlyDefinitions`.
    let omitIncluded = cacheOnlyDefinitions;
    let jobPriority = sanitizeJobPriorityHeader(
      ctxt.get(PRERENDER_JOB_PRIORITY_HEADER),
    );
    let prerenderJobId = sanitizePrerenderJobId(
      ctxt.get(PRERENDER_JOB_ID_HEADER),
    );
    let searchOpts: {
      cacheOnlyDefinitions?: true;
      omitIncluded?: true;
      priority?: number;
    } = {};
    if (cacheOnlyDefinitions) searchOpts.cacheOnlyDefinitions = true;
    if (omitIncluded) searchOpts.omitIncluded = true;
    if (jobPriority !== null) searchOpts.priority = jobPriority;

    // The inner cache key: the membership query is the key's `query` member
    // (canonicalized by the cache), and every other body-changing request
    // member folds into `opts` — the parsed fieldset, the applied (bound or
    // defaulted) htmlQuery, and any non-empty `cardUrls` subset (an empty
    // array is a no-op filter, so folding `[]` would fragment the cache
    // against an equivalent request that omits it). The htmlQuery folds only
    // when the fieldset puts the html branch in play: a fieldset without
    // `html` makes it inert — the body is identical regardless — so keying
    // on it would fragment the cache and split ETags across equivalent
    // responses.
    let cacheKeyOpts: Record<string, unknown> = {
      ...searchOpts,
      fieldset: parsed.fieldset,
    };
    if (parsed.fieldset.html) {
      cacheKeyOpts.htmlQuery = parsed.htmlQuery;
    }
    if (parsed.cardUrls?.length) {
      cacheKeyOpts.cardUrls = parsed.cardUrls;
    }

    // `loggingCorrelationId` / `timings` deliberately stay OUT of the
    // cache-key opts (per-request values would make every key unique) and
    // ride the run-time opts instead.
    let runSearchOpts = {
      ...searchOpts,
      ...(loggingCorrelationId !== null ? { loggingCorrelationId } : {}),
      ...(timings ? { timings } : {}),
    };

    let consumingRealm = sanitizeConsumingRealmHeader(
      ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER),
    );
    // Lazy-mount inside runSearch so cache hits (304 / cached body) skip the
    // lazy-mount work entirely.
    let runSearch = async () => {
      let resolveRealms = () =>
        resolveRealmsForFederatedRequest(reconciler, realmList, {
          consumingRealm,
        });
      let realmInstances = timings
        ? await timings.time('resolveRealms', resolveRealms)
        : await resolveRealms();
      let doc = await searchEntryRealms(realmInstances, parsed, runSearchOpts);
      // Serialize compact: a search-entry doc can run to many MB, so indentation
      // whitespace is pure wire overhead the consumer parses straight back off.
      let stringify = async () => JSON.stringify(doc);
      return timings ? await timings.time('stringify', stringify) : stringify();
    };

    let emitTimeline = () => {
      if (!timings || loggingCorrelationId === null) {
        return;
      }
      emitSearchTiming(
        `corr=${loggingCorrelationId}` +
          (prerenderJobId ? ` job=${prerenderJobId}` : '') +
          ` handler=${Date.now() - handlerStart}ms ` +
          timings.toLogFragment(),
      );
    };

    let jobId = searchCache ? prerenderJobId : null;
    await respondWithJobScopedSearchCache(ctxt, {
      searchCache,
      jobId,
      consumingRealm,
      realms: realmList,
      query: parsed.itemQuery,
      opts: cacheKeyOpts,
      runSearch,
      emitTimeline,
    });
  };
}
